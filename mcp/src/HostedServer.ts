import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import {
  HOSTED_MCP_REQUEST_MAX_BYTES,
  HOSTED_MCP_SCOPE,
  HostedMcpConsentSchema,
  HostedMcpDecisionResultSchema,
  HostedMcpDecisionSchema,
  HostedMcpOwnerSchema,
  HostedMcpPacketSchema,
} from "@tinytldr/core";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidRequestError, OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { createTinytldrMcpServer } from "./index.js";
import type { FirebaseOAuthProvider } from "./FirebaseOAuthProvider.js";
import type { ArtifactStorage } from "./HostedArtifacts.js";
import type { SavedDesignReader } from "./SavedDesignReader.js";
import { HostedRenderGate, HostedRequestScope } from "./HostedRequestScope.js";
import { validateHostedRenderBudget } from "./HostedRenderBudget.js";

const renderTools = new Set([
  "preview_post",
  "validate_template_data",
  "render_post",
  "render_workspace",
]);

export async function startHostedMcpServer(options: {
  provider: FirebaseOAuthProvider;
  storage: ArtifactStorage;
  designs: SavedDesignReader;
  websiteDirectory: string;
  port?: number;
  host?: string;
  reportError: (code: string, requestId: string) => void;
}) {
  const app = express();
  app.disable("x-powered-by");
  const gate = new HostedRenderGate();
  const scopes = new Set<HostedRequestScope>();
  const provider = options.provider;
  const resource = new URL(provider.resource);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "tinytldr-mcp" });
  });
  app.use(express.json({ limit: HOSTED_MCP_REQUEST_MAX_BYTES }));
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.redirect(307, new URL(getOAuthProtectedResourceMetadataUrl(resource)).pathname);
  });
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: provider.issuer,
      resourceServerUrl: resource,
      scopesSupported: [HOSTED_MCP_SCOPE],
      resourceName: "tinytldr rendering tools",
    }),
  );
  app.get("/auth/callback", (req, res) => {
    if (typeof req.query.next !== "string")
      throw new InvalidRequestError("Sign-in return link is invalid.");
    const target = new URL(req.query.next, provider.issuer);
    if (
      target.origin !== provider.issuer.origin ||
      target.pathname !== "/connect" ||
      !/^[0-9a-f-]{36}$/i.test(target.searchParams.get("request") ?? "")
    )
      throw new InvalidRequestError("Sign-in return link is invalid.");
    res.redirect(303, target.href);
  });
  app.get("/connect", async (_req, res) => {
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    );
    res
      .type("html")
      .send(await fs.readFile(path.join(options.websiteDirectory, "McpAuthorization.html")));
  });
  app.use("/assets", (req, res, next) => {
    if (req.path.endsWith(".map")) {
      res.status(404).end();
      return;
    }
    next();
  });
  app.use(
    "/assets",
    express.static(path.join(options.websiteDirectory, "assets"), {
      dotfiles: "deny",
      index: false,
    }),
  );
  app.use(
    "/fonts",
    express.static(path.join(options.websiteDirectory, "fonts"), {
      dotfiles: "deny",
      index: false,
    }),
  );
  app.get("/consent/:request", async (req, res) => {
    const id = req.params.request;
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new InvalidRequestError("Authorization request is invalid.");
    res.json(HostedMcpConsentSchema.parse(await provider.consent(id)));
  });
  app.post("/consent/:request", async (req, res) => {
    const id = req.params.request;
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new InvalidRequestError("Authorization request is invalid.");
    const decision = HostedMcpDecisionSchema.parse(req.body);
    const authorization = req.headers.authorization;
    const firebaseToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    res.json(
      HostedMcpDecisionResultSchema.parse(
        await provider.decide(id, decision.approved, firebaseToken),
      ),
    );
  });
  app.use("/mcp", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Accept, MCP-Protocol-Version",
    );
    res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.all(
    "/mcp",
    requireBearerAuth({
      verifier: provider,
      requiredScopes: [HOSTED_MCP_SCOPE],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
      expectedResource: resource,
    }),
    async (req, res) => {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({ error: "This stateless MCP endpoint accepts POST requests." });
        return;
      }
      const packet = HostedMcpPacketSchema.parse(req.body);
      const owner = HostedMcpOwnerSchema.parse(req.auth?.extra);
      const name = packet.method === "tools/call" ? packet.params?.name : undefined;
      if (typeof name === "string" && renderTools.has(name)) {
        if (!(await provider.takeRender(owner.uid))) {
          res.setHeader("Retry-After", "60");
          res
            .status(429)
            .json({ error: "Six render requests per minute are allowed. Retry shortly." });
          return;
        }
        validateHostedRenderBudget(name, packet.params?.arguments);
      }
      const requestId = randomUUID();
      const scope = await HostedRequestScope.create(owner.uid, options.storage, gate);
      scopes.add(scope);
      const instance = createTinytldrMcpServer({
        renderer: scope.renderer,
        artifacts: scope.artifacts,
        signal: scope.controller.signal,
        runRender: (operation) => scope.run(operation),
        designs: {
          list: () => options.designs.list(owner.uid),
          get: (designId) => options.designs.get(owner.uid, designId),
        },
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.once("close", () => {
        void (async () => {
          try {
            try {
              await transport.close();
            } finally {
              try {
                await instance.close();
              } finally {
                await scope.close();
              }
            }
          } finally {
            scopes.delete(scope);
          }
        })().catch(() => options.reportError("request_cleanup_failed", requestId));
      });
      scope.controller.signal.addEventListener(
        "abort",
        () => {
          void scope
            .closeRenderer()
            .catch(() => options.reportError("renderer_cleanup_failed", requestId));
        },
        { once: true },
      );
      await instance.server.connect(transport);
      await transport.handleRequest(req, res, packet);
    },
  );
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const requestId = randomUUID();
    if (res.headersSent) {
      options.reportError("hosted_response_failed", requestId);
      res.destroy();
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Request does not match the MCP contract.",
      });
      return;
    }
    if (error instanceof Error && "type" in error) {
      if (error.type === "entity.too.large") {
        res
          .status(413)
          .json({ error: "invalid_request", error_description: "Request exceeds 2 MB." });
        return;
      }
      if (error.type === "entity.parse.failed") {
        res
          .status(400)
          .json({ error: "invalid_request", error_description: "Request JSON is invalid." });
        return;
      }
    }
    if (error instanceof OAuthError) {
      res.status(error.errorCode === "invalid_token" ? 401 : 400).json(error.toResponseObject());
      return;
    }
    options.reportError("hosted_request_failed", requestId);
    res.status(500).json({ error: "MCP request failed.", requestId });
  };
  app.use(handleError);
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8080, options.host ?? "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Hosted MCP did not bind a port.");
  return {
    server,
    port: address.port,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await Promise.all(Array.from(scopes, (scope) => scope.close()));
    },
  };
}
