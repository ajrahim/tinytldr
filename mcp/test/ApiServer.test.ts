import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as rendering from "@tinytldr/renderer";
import { RenderedExportSchema } from "@tinytldr/core";
import { getTemplateBundle } from "@tinytldr/templates";
import { startWebsiteApiServer } from "../src/ApiServer.js";
import { apiArtifactOwner, type ApiArtifactStorage } from "../src/ApiArtifacts.js";
import { startTinytldrHttpServer } from "../src/HttpServer.js";

describe("Firebase-authenticated website export API", () => {
  let directory: string;
  let service: Awaited<ReturnType<typeof startWebsiteApiServer>>;
  let base: string;
  let storage: ApiArtifactStorage;
  let verifyIdToken: ReturnType<typeof vi.fn<(token: string) => Promise<{ uid: string }>>>;
  let takeRender: ReturnType<typeof vi.fn<(uid: string) => Promise<boolean>>>;
  const site = "https://www.tinytldr.com";
  const headers = {
    Origin: site,
    Authorization: "Bearer owner-token",
    "Content-Type": "application/json",
  };
  const body = { templateId: "quote-card", format: "png", size: { width: 320, height: 320 } };
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();

  beforeEach(async () => {
    directory = path.resolve(`.ApiServerTest-${randomUUID()}`);
    objects.clear();
    storage = {
      async upload(file, key, contentType) {
        objects.set(key, { bytes: await fs.readFile(file), contentType });
      },
      async signedUrl(key) {
        return `${base}/v1/assets/${key}`;
      },
      async delete(key) {
        objects.delete(key);
      },
      async read(key) {
        return objects.get(key);
      },
    };
    verifyIdToken = vi.fn(async (token: string) => {
      if (token === "owner-token") return { uid: "owner-one" };
      if (token === "other-token") return { uid: "owner-two" };
      throw new Error("Invalid or revoked Firebase token.");
    });
    takeRender = vi.fn(async () => true);
    service = await startWebsiteApiServer({
      storage,
      verifyIdToken,
      takeRender,
      allowedOrigins: [site],
      outputDirectory: directory,
      reportError: vi.fn(),
      port: 0,
    });
    base = `http://127.0.0.1:${service.port}`;
  });

  afterEach(async () => {
    await service.close();
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const render = (payload: unknown = body, requestHeaders = headers) =>
    fetch(`${base}/v1/render`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(payload),
    });

  it("renders with the existing Chromium pipeline and restricts every download to its owner", async () => {
    const response = await render();
    expect(response.status).toBe(200);
    const result = RenderedExportSchema.parse(await response.json());
    expect(result.width).toBe(320);
    expect(result.height).toBe(320);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.url).toContain(apiArtifactOwner("owner-one"));
    expect(response.headers.get("access-control-allow-origin")).toBe(site);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const asset = result.assets[0]!.url;
    expect((await fetch(asset)).status).toBe(401);
    expect((await fetch(asset, { headers: { Authorization: "Bearer other-token" } })).status).toBe(
      404,
    );
    const download = await fetch(asset, { headers });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("content-type")).toContain("image/png");
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(rendering.inspectPngHeader(bytes)).toMatchObject({ width: 320, height: 320 });
    await expect.poll(() => fs.readdir(directory)).toEqual([]);
    expect(takeRender).toHaveBeenCalledWith("owner-one");
  });

  it("rejects absent, invalid, expired or revoked tokens before parsing or rendering", async () => {
    const spy = vi.spyOn(rendering, "renderTemplatePost");
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await render(body, { ...headers, Authorization: "" })).status).toBe(401);
    expect((await render(body, { ...headers, Authorization: "Bearer revoked" })).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    expect(takeRender).not.toHaveBeenCalled();
  });

  it("exports current v2 workspaces in page order without accepting legacy documents", async () => {
    const template = getTemplateBundle("quote-card");
    const document = {
      version: 2,
      title: "Website workspace",
      size: { width: 320, height: 320 },
      pages: ["first", "second"].map((id) => ({
        id,
        title: id,
        description: "",
        template,
        data: template.manifest.sampleData,
        theme: template.manifest.defaultTheme,
        tokenOverrides: {},
      })),
    };
    const response = await render({ document, format: "png" });
    expect(response.status).toBe(200);
    const result = RenderedExportSchema.parse(await response.json());
    expect(result.assets).toHaveLength(2);
    expect(result.assets.map((asset) => asset.filename)).toEqual([
      expect.stringContaining("-page-01.png"),
      expect.stringContaining("-page-02.png"),
    ]);
    expect((await render({ document: { ...document, version: 1 }, format: "png" })).status).toBe(
      400,
    );
  });

  it("allows only configured CORS origins, with no wildcard or credentials", async () => {
    expect((await render(body, { ...headers, Origin: "https://untrusted.example" })).status).toBe(
      403,
    );
    expect(verifyIdToken).not.toHaveBeenCalled();
    const preflight = await fetch(`${base}/v1/render`, {
      method: "OPTIONS",
      headers: {
        Origin: site,
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(site);
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("rejects invalid JSON, output paths, oversized requests and excessive render work", async () => {
    const spy = vi.spyOn(rendering, "renderTemplatePost");
    const invalid = await fetch(`${base}/v1/render`, {
      method: "POST",
      headers,
      body: "{",
    });
    expect(invalid.status).toBe(400);
    expect((await render({ ...body, outputPath: "escape.png" })).status).toBe(400);
    expect((await render({ ...body, size: { width: 4096, height: 4096 }, scale: 2 })).status).toBe(
      400,
    );
    expect((await render({ ...body, data: { quote: "x".repeat(2_000_001) } })).status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
    expect(takeRender).not.toHaveBeenCalled();
  });

  it("enforces the distributed per-owner quota", async () => {
    takeRender.mockResolvedValue(false);
    const response = await render();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(objects.size).toBe(0);
  });

  it("never publishes an unfinished MP4 frame fallback", async () => {
    vi.spyOn(rendering, "renderTemplatePost").mockImplementation(async (options) => {
      const frame = options.outputPath.replace(/\.mp4$/, ".jpg");
      await fs.writeFile(frame, "fixture");
      return {
        outputPaths: [frame],
        width: 320,
        height: 320,
        bytes: 7,
        previewDataUrl: "data:image/png;base64,Zml4dHVyZQ==",
        warnings: [],
      };
    });
    expect((await render({ ...body, format: "mp4" })).status).toBe(500);
    await expect.poll(() => fs.readdir(directory)).toEqual([]);
    expect(objects.size).toBe(0);
  });

  it("rolls back both successful and uncertain cloud uploads on publication failure", async () => {
    vi.spyOn(rendering, "renderTemplatePost").mockImplementation(async (options) => {
      const files = [options.outputPath, options.outputPath.replace(".png", "-second.png")];
      await Promise.all(files.map((file) => fs.writeFile(file, "fixture")));
      return {
        outputPaths: files,
        width: 320,
        height: 320,
        bytes: 14,
        previewDataUrl: "data:image/png;base64,Zml4dHVyZQ==",
        warnings: [],
      };
    });
    const upload = storage.upload;
    storage.upload = async (...args) => {
      await upload(...args);
      if (objects.size === 2) throw new Error("Uncertain second upload.");
    };
    expect((await render()).status).toBe(500);
    expect(objects.size).toBe(0);
    await expect.poll(() => fs.readdir(directory)).toEqual([]);
  });

  it("caps concurrent Chromium requests and cleans each request directory", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const blocked = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(rendering, "renderTemplatePost").mockImplementation(async (options) => {
      entered();
      await blocked;
      await fs.writeFile(options.outputPath, "fixture");
      return {
        outputPaths: [options.outputPath],
        width: 320,
        height: 320,
        bytes: 7,
        previewDataUrl: "data:image/png;base64,Zml4dHVyZQ==",
        warnings: [],
      };
    });
    const first = render();
    await started;
    expect((await render()).status).toBe(503);
    release();
    expect((await first).status).toBe(200);
    await service.close();
    service = await startWebsiteApiServer({
      storage,
      verifyIdToken,
      takeRender,
      allowedOrigins: [site],
      outputDirectory: directory,
      reportError: vi.fn(),
      port: 0,
    });
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("aborts deadline-exceeded render work and returns no artifacts", async () => {
    await service.close();
    service = await startWebsiteApiServer({
      storage,
      verifyIdToken,
      takeRender,
      allowedOrigins: [site],
      outputDirectory: directory,
      reportError: vi.fn(),
      timeoutMs: 30,
      port: 0,
    });

    base = `http://127.0.0.1:${service.port}`;
    let signal: AbortSignal | undefined;
    vi.spyOn(rendering, "renderTemplatePost").mockImplementation(async (options) => {
      signal = options.signal;
      await new Promise<void>((resolve) =>
        signal!.addEventListener("abort", () => resolve(), { once: true }),
      );
      signal!.throwIfAborted();
      throw new Error("Unreachable");
    });
    const response = await render();
    expect(response.status).toBe(504);
    expect(signal?.aborted).toBe(true);
    expect(objects.size).toBe(0);
    await service.close();
    service = await startWebsiteApiServer({
      storage,
      verifyIdToken,
      takeRender,
      allowedOrigins: [site],
      outputDirectory: directory,
      reportError: vi.fn(),
      port: 0,
    });
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("cancels work on browser disconnect before uploading any artifacts", async () => {
    let entered!: () => void;
    let signal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => (entered = resolve));
    vi.spyOn(rendering, "renderTemplatePost").mockImplementation(async (options) => {
      signal = options.signal;
      entered();
      await new Promise<void>((resolve) =>
        signal!.addEventListener("abort", () => resolve(), { once: true }),
      );
      signal!.throwIfAborted();
      throw new Error("Unreachable");
    });
    const controller = new AbortController();
    const response = fetch(`${base}/v1/render`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const cancelled = expect(response).rejects.toMatchObject({ name: "AbortError" });
    await started;
    controller.abort();
    await cancelled;
    await expect.poll(() => signal?.aborted).toBe(true);
    await expect.poll(() => fs.readdir(directory)).toEqual([]);
    expect(objects.size).toBe(0);
  });

  it("keeps loopback guest exports and health independent of removed Supabase configuration", async () => {
    const local = await startTinytldrHttpServer({
      port: 0,
      outputDir: path.join(directory, "local"),
    });
    try {
      const response = await fetch(`${local.url}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("supabaseConfigured");
      const rendered = await fetch(`${local.url}/v1/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(rendered.status).toBe(200);
      const result = RenderedExportSchema.parse(await rendered.json());
      expect(result.assets[0]!.url).toContain(`${local.url}/v1/assets/`);
      expect((await fetch(result.assets[0]!.url)).status).toBe(200);
    } finally {
      await local.close();
    }
  });
});
