import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChromiumRenderer, inspectPngHeader } from "@tinytldr/renderer";
import {
  scaffoldNewTemplate,
  startTinytldrHttpServer,
  validateTemplateFullSuite,
  type TinytldrHttpServerHandle,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

describe("Phase 5 — HTTP MCP + REST Server, Template Authoring & Release Artifacts", () => {
  let renderer: ChromiumRenderer;
  let httpHandle: TinytldrHttpServerHandle;
  let tempDir: string;
  const testApiKey = "tt-test-secret-key";

  beforeAll(async () => {
    renderer = new ChromiumRenderer();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytldr-phase5-"));
    httpHandle = await startTinytldrHttpServer({
      port: 0,
      host: "127.0.0.1",
      apiKey: testApiKey,
      outputDir: path.join(tempDir, "renders"),
      renderer,
    });
  }, 60_000);

  afterAll(async () => {
    await httpHandle.close();
    await renderer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves GET /health publicly with rate-limit and CORS headers", async () => {
    const res = await fetch(`${httpHandle.url}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-ratelimit-limit")).toBe("120");

    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      templatesCount: number;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("tinytldr");
    expect(body.templatesCount).toBeGreaterThanOrEqual(12);
  });

  it("enforces Bearer TINYTLDR_API_KEY on /v1/* and /mcp routes", async () => {
    const unauthRes = await fetch(`${httpHandle.url}/v1/templates`);
    expect(unauthRes.status).toBe(401);

    const authRes = await fetch(`${httpHandle.url}/v1/templates?kind=video`, {
      headers: { Authorization: `Bearer ${testApiKey}` },
    });
    expect(authRes.status).toBe(200);
    const data = (await authRes.json()) as { templates: Array<{ id: string; kind: string }> };
    expect(data.templates.length).toBe(3);
    expect(data.templates.every((t) => t.kind === "video")).toBe(true);
  });

  it("serves POST /v1/validate, POST /v1/preview, POST /v1/render, GET /v1/jobs/:id, and GET /v1/assets/:name", async () => {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${testApiKey}`,
    };

    const valRes = await fetch(`${httpHandle.url}/v1/validate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        templateId: "quote-card",
        data: {
          quote: "Deterministic HTML/CSS templates beat AI image generators for text.",
          author: "AJ Rahim",
        },
        size: "square",
      }),
    });
    expect(valRes.status).toBe(200);
    const valJson = (await valRes.json()) as { valid: boolean; width: number; height: number };
    expect(valJson.valid).toBe(true);
    expect(valJson.width).toBe(1080);

    const prevRes = await fetch(`${httpHandle.url}/v1/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        templateId: "stat-callout",
        size: "square",
      }),
    });
    expect(prevRes.status).toBe(200);
    const prevJson = (await prevRes.json()) as { previewDataUrl: string; width: number };
    expect(prevJson.previewDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(prevJson.width).toBe(1080);

    const renderRes = await fetch(`${httpHandle.url}/v1/render`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        templateId: "quote-card",
        size: "square",
        format: "png",
      }),
    });
    expect(renderRes.status).toBe(200);
    const renderJson = (await renderRes.json()) as {
      jobId: string;
      status: string;
      url: string;
      width: number;
      height: number;
    };
    expect(renderJson.status).toBe("completed");
    expect(renderJson.url).toContain("/v1/assets/");

    const jobRes = await fetch(`${httpHandle.url}/v1/jobs/${renderJson.jobId}`, {
      headers: { Authorization: `Bearer ${testApiKey}` },
    });
    expect(jobRes.status).toBe(200);
    const jobJson = (await jobRes.json()) as { id: string; status: string; url: string };
    expect(jobJson.id).toBe(renderJson.jobId);
    expect(jobJson.status).toBe("completed");

    const assetRes = await fetch(renderJson.url);
    expect(assetRes.status).toBe(200);
    const pngBuffer = Buffer.from(await assetRes.arrayBuffer());
    const meta = inspectPngHeader(pngBuffer);
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
  }, 60_000);

  it("handles Streamable HTTP MCP requests on POST /mcp", async () => {
    const res = await fetch(`${httpHandle.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${testApiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "phase5-test", version: "0.1.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    const rawText = await res.text();
    expect(rawText).toContain("tinytldr");
  });

  it("scaffolds a new MIT template and validates sample + max-length across all sizes", async () => {
    const customDir = path.join(tempDir, "custom-templates");
    const scaffolded = scaffoldNewTemplate({
      templateId: "founder-note",
      kind: "static",
      author: "AJ Rahim",
      targetRootDir: customDir,
    });

    expect(scaffolded.filesCreated.length).toBe(4);
    for (const file of scaffolded.filesCreated) {
      expect(fs.existsSync(file)).toBe(true);
    }

    const suiteResult = await validateTemplateFullSuite({
      templateId: "founder-note",
      targetRootDir: customDir,
      renderer,
    });

    expect(suiteResult.ok).toBe(true);
    expect(suiteResult.checkedSizes).toEqual(["square", "portrait", "story", "x", "og"]);
    expect(suiteResult.issues).toEqual([]);
  }, 60_000);

  it("ships Agent Skill (SKILL.md), MCP Registry server.json, Dockerfile, and self-host docs", () => {
    const skillPath = path.join(repoRoot, "skills", "tinytldr", "SKILL.md");
    const serverJsonPath = path.join(repoRoot, "server.json");
    const dockerfilePath = path.join(repoRoot, "Dockerfile");
    const selfHostDocPath = path.join(repoRoot, ".agents", "docs", "self-host.md");

    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.existsSync(serverJsonPath)).toBe(true);
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    expect(fs.existsSync(selfHostDocPath)).toBe(true);

    const serverManifest = JSON.parse(fs.readFileSync(serverJsonPath, "utf8")) as {
      name: string;
      license: string;
      packages: Array<{ name: string }>;
    };
    expect(serverManifest.name).toBe("io.github.ajrahim/tinytldr");
    expect(serverManifest.license).toBe("MIT");
    expect(serverManifest.packages[0]?.name).toBe("tinytldr");
  });
});
