import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RenderRequestSchema, SIZE_PRESETS, SizeSpecSchema, type SizeSpec } from "@tinytldr/core";
import {
  ChromiumRenderer,
  previewTemplatePost,
  renderTemplatePost,
  renderWorkspaceProject,
  validateTemplatePost,
  type RenderOutputFormat,
} from "@tinytldr/renderer";
import { getTemplateManifest, listTemplates } from "@tinytldr/templates";
import { createTinytldrMcpServer } from "./index.js";

export interface RenderJobRecord {
  readonly id: string;
  readonly status: "completed" | "failed";
  readonly templateId: string;
  readonly format: RenderOutputFormat;
  readonly url?: string;
  readonly error?: string;
  readonly createdAt: string;
}

export interface TinytldrHttpServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly apiKey?: string;
  readonly rateLimitPerMinute?: number;
  readonly outputDir?: string;
  readonly renderer?: ChromiumRenderer;
}

export interface TinytldrHttpServerHandle {
  readonly server: http.Server;
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

const ASSET_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
};

function readRequestBody(req: http.IncomingMessage, maxBytes = Infinity): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        chunks.length = 0;
        reject(new Error("Render requests must be smaller than 2 MB."));
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function startTinytldrHttpServer(
  options: TinytldrHttpServerOptions = {},
): Promise<TinytldrHttpServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? Number(process.env.PORT ?? 8787);
  const configuredApiKey = options.apiKey ?? process.env.TINYTLDR_API_KEY?.trim();
  const rateLimitMax = options.rateLimitPerMinute ?? 120;
  const outputDir = options.outputDir ?? path.join(os.tmpdir(), "tinytldr-http-renders");
  fs.mkdirSync(outputDir, { recursive: true });

  const ownsRenderer = !options.renderer;
  const renderer = options.renderer ?? new ChromiumRenderer();

  const jobs = new Map<string, RenderJobRecord>();
  const rateBuckets = new Map<string, { count: number; resetAtMs: number }>();

  let resolvedBaseUrl = `http://${host}:${requestedPort}`;

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const clientIp = req.socket.remoteAddress ?? "127.0.0.1";
    const now = Date.now();
    let bucket = rateBuckets.get(clientIp);
    if (!bucket || now >= bucket.resetAtMs) {
      bucket = { count: 0, resetAtMs: now + 60_000 };
      rateBuckets.set(clientIp, bucket);
    }
    bucket.count += 1;

    res.setHeader("X-RateLimit-Limit", String(rateLimitMax));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, rateLimitMax - bucket.count)));

    if (bucket.count > rateLimitMax) {
      sendJson(res, 429, { error: "Rate limit exceeded. Try again in 60 seconds." });
      return;
    }

    const urlObj = new URL(req.url ?? "/", resolvedBaseUrl);
    const pathname = urlObj.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "tinytldr",
        version: "0.1.0",
        templatesCount: listTemplates().length,
      });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/v1/assets/")) {
      const rawName = decodeURIComponent(pathname.slice("/v1/assets/".length));
      const safeName = path.basename(rawName);
      const filePath = path.join(outputDir, safeName);
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: "Asset not found" });
        return;
      }
      const ext = path.extname(safeName).toLowerCase();
      res.statusCode = 200;
      res.setHeader("Content-Type", ASSET_MIME_TYPES[ext] ?? "application/octet-stream");
      res.end(fs.readFileSync(filePath));
      return;
    }

    // Optional Bearer API Key enforcement for /v1/* and /mcp
    if (configuredApiKey && configuredApiKey.length > 0) {
      const authHeader = req.headers.authorization ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (token !== configuredApiKey) {
        sendJson(res, 401, { error: "Unauthorized: valid Bearer TINYTLDR_API_KEY required." });
        return;
      }
    }

    // Streamable HTTP MCP Endpoint (/mcp)
    if (pathname === "/mcp") {
      try {
        const rawBody = req.method === "POST" ? await readRequestBody(req) : "";
        const parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : undefined;
        const mcpInstance = createTinytldrMcpServer({ renderer });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        res.on("close", () => {
          void transport.close();
        });
        await mcpInstance.server.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }

    if (req.method === "GET" && pathname === "/v1/templates") {
      const kindParam = urlObj.searchParams.get("kind") as "static" | "carousel" | "video" | null;
      const tagParam = urlObj.searchParams.get("tag") ?? undefined;
      const aspectParam = urlObj.searchParams.get("aspect") ?? undefined;
      sendJson(res, 200, {
        templates: listTemplates({
          kind: kindParam ?? undefined,
          tag: tagParam,
          aspect: aspectParam,
        }),
        sizePresets: SIZE_PRESETS,
      });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/v1/templates/")) {
      const templateId = decodeURIComponent(pathname.slice("/v1/templates/".length));
      try {
        const manifest = getTemplateManifest(templateId);
        sendJson(res, 200, manifest);
      } catch (err) {
        sendJson(res, 404, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/v1/jobs/")) {
      const jobId = decodeURIComponent(pathname.slice("/v1/jobs/".length));
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(res, 404, { error: `Job '${jobId}' not found.` });
        return;
      }
      sendJson(res, 200, job);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/validate") {
      try {
        const body = JSON.parse(await readRequestBody(req)) as {
          templateId: string;
          data?: Record<string, unknown>;
          size?: unknown;
          theme?: string;
        };
        const size: SizeSpec | undefined = body.size ? SizeSpecSchema.parse(body.size) : undefined;
        const manifest = getTemplateManifest(body.templateId);
        const result = await validateTemplatePost({
          templateId: body.templateId,
          data: body.data ?? manifest.sampleData,
          size,
          theme: body.theme,
          renderer,
        });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/v1/preview") {
      try {
        const body = JSON.parse(await readRequestBody(req)) as {
          templateId: string;
          data?: Record<string, unknown>;
          size?: unknown;
          theme?: string;
          pageOrTimestamp?: number;
        };
        const size: SizeSpec | undefined = body.size ? SizeSpecSchema.parse(body.size) : undefined;
        const preview = await previewTemplatePost({
          templateId: body.templateId,
          data: body.data,
          size,
          theme: body.theme,
          pageOrTimestamp: body.pageOrTimestamp,
          renderer,
        });
        sendJson(res, 200, {
          width: preview.width,
          height: preview.height,
          slideCount: preview.slideCount,
          warnings: preview.warnings,
          previewDataUrl: preview.previewDataUrl,
        });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/v1/render") {
      const jobId = crypto.randomUUID();
      try {
        const body = RenderRequestSchema.parse(JSON.parse(await readRequestBody(req, 2_000_000)));
        const document = "document" in body ? body.document : null;
        const manifest = document
          ? document.pages[0]!.template.manifest
          : getTemplateManifest("templateId" in body ? body.templateId : "");
        const templateId = manifest.id;
        const format: RenderOutputFormat =
          body.format ??
          (manifest.kind === "video" ? "mp4" : manifest.kind === "carousel" ? "pdf" : "png");
        const size = document ? document.size : "size" in body ? body.size : undefined;

        const fileName = `${templateId}-${jobId.slice(0, 8)}.${format}`;
        const outPath = path.join(outputDir, fileName);

        const workspaceResult = document
          ? await renderWorkspaceProject({
              document,
              format,
              scale: body.scale,
              outputPath: outPath,
              renderer,
            })
          : null;
        const renderRes =
          workspaceResult ??
          (await renderTemplatePost({
            templateId,
            data: "data" in body ? body.data : undefined,
            size,
            theme: "theme" in body ? body.theme : undefined,
            format,
            scale: body.scale ?? 1,
            outputPath: outPath,
            renderer,
          }));

        if (document && renderRes.outputPaths.some((file) => path.extname(file) !== `.${format}`))
          throw new Error(
            "This export requires ffmpeg. Install it and retry; a frame sequence is not a finished MP4.",
          );
        const assets = renderRes.outputPaths.map((file, index) => ({
          filename: path.basename(file),
          url: `${resolvedBaseUrl}/v1/assets/${encodeURIComponent(path.basename(file))}`,
          durationMs: workspaceResult?.assetMetadata[index]?.durationMs ?? renderRes.durationMs,
        }));
        const primaryPath = renderRes.outputPaths[0] ?? outPath;
        const primaryName = path.basename(primaryPath);
        const downloadUrl = `${resolvedBaseUrl}/v1/assets/${encodeURIComponent(primaryName)}`;

        const jobRecord: RenderJobRecord = {
          id: jobId,
          status: "completed",
          templateId,
          format,
          url: downloadUrl,
          createdAt: new Date().toISOString(),
        };
        jobs.set(jobId, jobRecord);

        sendJson(res, 200, {
          jobId,
          status: "completed",
          url: downloadUrl,
          assets,
          previewDataUrl: renderRes.previewDataUrl,
          format,
          width: renderRes.width,
          height: renderRes.height,
          pageCount: renderRes.pageCount,
          durationMs: renderRes.durationMs,
          bytes: renderRes.bytes,
          warnings: renderRes.warnings,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        jobs.set(jobId, {
          id: jobId,
          status: "failed",
          templateId: "unknown",
          format: "png",
          error: message,
          createdAt: new Date().toISOString(),
        });
        sendJson(res, 400, { jobId, status: "failed", error: message });
      }
      return;
    }

    sendJson(res, 404, { error: `Route ${req.method} ${pathname} not found.` });
  });

  return new Promise((resolve) => {
    server.listen(requestedPort, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
      resolvedBaseUrl = `http://${host}:${actualPort}`;
      resolve({
        server,
        url: resolvedBaseUrl,
        port: actualPort,
        async close() {
          await new Promise<void>((resClose) => server.close(() => resClose()));
          if (ownsRenderer) {
            await renderer.close();
          }
        },
      });
    });
  });
}
