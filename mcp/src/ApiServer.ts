import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { RenderRequestSchema } from "@tinytldr/core";
import { ChromiumRenderer, renderTemplatePost, renderWorkspaceProject } from "@tinytldr/renderer";
import { getTemplateManifest } from "@tinytldr/templates";
import { HostedArtifacts } from "./HostedArtifacts.js";
import { validateHostedRenderBudget } from "./HostedRenderBudget.js";
import { isOwnedApiArtifact, type ApiArtifactStorage } from "./ApiArtifacts.js";

export const ApiOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  }, "Expected an HTTPS origin without a trailing slash.");

export async function startWebsiteApiServer(options: {
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  takeRender: (uid: string) => Promise<boolean>;
  storage: ApiArtifactStorage;
  allowedOrigins: readonly string[];
  outputDirectory: string;
  reportError: (code: string, requestId: string) => void;
  port?: number;
  host?: string;
  timeoutMs?: number;
}) {
  const allowedOrigins = new Set(z.array(ApiOriginSchema).min(1).parse(options.allowedOrigins));
  const outputRoot = path.resolve(options.outputDirectory);
  await fs.mkdir(outputRoot, { recursive: true });
  const app = express();
  app.disable("x-powered-by");
  let busy = false;
  const active = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  const timeoutMs = options.timeoutMs ?? 55_000;

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.vary("Origin");
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Retry-After");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "tinytldr-website-api" });
  });
  app.use(async (req, res, next) => {
    const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!token || token.length > 16_384) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    try {
      const identity = await options.verifyIdToken(token);
      if (!identity.uid) throw new Error("Missing Firebase user ID.");
      res.locals.uid = identity.uid;
      next();
    } catch {
      res.status(401).json({ error: "unauthenticated" });
    }
  });
  app.use(express.json({ limit: 2_000_000, strict: true }));
  app.get(/^\/v1\/assets\/(.+)$/, async (req, res) => {
    const key = req.params[0] ?? "";
    const uid = z.string().parse(res.locals.uid);
    if (!isOwnedApiArtifact(key, uid)) {
      res.status(404).json({ error: "artifact_not_found" });
      return;
    }
    const artifact = await options.storage.read(key);
    if (!artifact) {
      res.status(404).json({ error: "artifact_not_found" });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(key)}"`);
    res.type(artifact.contentType).send(artifact.bytes);
  });
  app.post("/v1/render", async (req, res) => {
    const body = RenderRequestSchema.parse(req.body);
    validateHostedRenderBudget("document" in body ? "render_workspace" : "render_post", body);
    if (busy) {
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "renderer_busy" });
      return;
    }
    const uid = z.string().parse(res.locals.uid);
    if (!(await options.takeRender(uid))) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "render_rate_limit" });
      return;
    }
    if (req.aborted || res.destroyed) return;
    // Recheck after the distributed rate-limit transaction yields.
    if (busy) {
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "renderer_busy" });
      return;
    }
    busy = true;
    const controller = new AbortController();
    controllers.add(controller);
    const renderer = new ChromiumRenderer(controller.signal);
    const requestId = randomUUID();
    let directory: string | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort(new Error("Export request closed."));
    const close = () => {
      if (!res.writableEnded) abort();
    };
    req.once("aborted", abort);
    res.once("close", close);
    controller.signal.addEventListener(
      "abort",
      () => {
        void renderer
          .close()
          .catch(() => options.reportError("renderer_cleanup_failed", requestId));
      },
      { once: true },
    );
    const operation = (async () => {
      try {
        deadline = setTimeout(() => {
          controller.abort(new Error("Export time limit exceeded."));
          if (!res.headersSent) res.status(504).json({ error: "render_timeout" });
        }, timeoutMs);
        directory = await fs.mkdtemp(path.join(outputRoot, "request-"));
        const artifacts = new HostedArtifacts(directory, uid, options.storage, controller.signal);
        const manifest =
          "document" in body
            ? body.document.pages[0]!.template.manifest
            : getTemplateManifest(body.templateId);
        const format =
          body.format ??
          (manifest.kind === "video" ? "mp4" : manifest.kind === "carousel" ? "pdf" : "png");
        const common = {
          format,
          scale: body.scale,
          outputPath: artifacts.path(format),
          renderer,
          signal: controller.signal,
        };
        const workspaceResult =
          "document" in body
            ? await renderWorkspaceProject({ ...common, document: body.document })
            : null;
        const result =
          workspaceResult ??
          (await renderTemplatePost({
            ...("templateId" in body ? body : { templateId: manifest.id }),
            ...common,
          }));
        controller.signal.throwIfAborted();
        const published = await artifacts.publish(result.outputPaths);
        controller.signal.throwIfAborted();
        const assets = published.map((asset, index) => ({
          ...asset,
          durationMs: workspaceResult?.assetMetadata[index]?.durationMs ?? result.durationMs,
        }));
        res.json({
          status: "completed",
          jobId: requestId,
          url: assets[0]!.url,
          assets,
          format,
          previewDataUrl: result.previewDataUrl,
          width: result.width,
          height: result.height,
          pageCount: result.pageCount,
          durationMs: result.durationMs,
          bytes: result.bytes,
          warnings: result.warnings,
        });
      } catch {
        if (!res.headersSent && !res.destroyed) {
          if (controller.signal.aborted) res.status(504).json({ error: "render_cancelled" });
          else {
            options.reportError("render_failed", requestId);
            res.status(500).json({ error: "render_failed", requestId });
          }
        }
      } finally {
        clearTimeout(deadline);
        controller.abort();
        req.off("aborted", abort);
        res.off("close", close);
        try {
          await renderer.close();
        } finally {
          try {
            if (directory) await fs.rm(directory, { recursive: true, force: true });
          } finally {
            controllers.delete(controller);
            busy = false;
          }
        }
      }
    })();
    active.add(operation);
    try {
      await operation;
    } finally {
      active.delete(operation);
    }
  });
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof ZodError || error instanceof InvalidRequestError) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (error instanceof Error && "type" in error) {
      if (error.type === "entity.too.large") {
        res.status(413).json({ error: "request_too_large" });
        return;
      }
      if (error.type === "entity.parse.failed") {
        res.status(400).json({ error: "invalid_json" });
        return;
      }
    }
    const requestId = randomUUID();
    options.reportError("api_request_failed", requestId);
    res.status(500).json({ error: "request_failed", requestId });
  };
  app.use(handleError);
  const server = http.createServer(app);
  server.requestTimeout = timeoutMs + 10_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8080, options.host ?? "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Website API did not bind a port.");
  return {
    server,
    port: address.port,
    async close() {
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await Promise.allSettled(active);
    },
  };
}
