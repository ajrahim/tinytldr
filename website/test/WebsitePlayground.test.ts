import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileBrowserPreview,
  createInitialPlaygroundState,
  getCatalogTemplates,
  parseLocationRoute,
  playgroundStateReducer,
} from "../src/index.js";

const WEBSITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function startStaticSpaServer(rootDir: string): Promise<{
  readonly server: http.Server;
  readonly baseUrl: string;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const relativePath = decodeURIComponent(reqUrl.pathname).replace(/^\/+/, "");
      let filePath = path.join(rootDir, relativePath);

      if (!relativePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(rootDir, "index.html");
      }

      if (!fs.existsSync(filePath)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
      res.end(fs.readFileSync(filePath));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe("Phase 4: tinytldr.com Website & Interactive Playground", () => {
  let server: http.Server | null = null;
  let baseUrl = "";
  let browser: Browser | null = null;
  let testBuildDir: string | undefined;

  beforeAll(async () => {
    testBuildDir = await fs.promises.mkdtemp(path.join(WEBSITE_DIR, ".test-offline-website-"));
    await build({
      root: WEBSITE_DIR,
      configFile: path.join(WEBSITE_DIR, "vite.config.ts"),
      define: {
        "import.meta.env.VITE_TINYTLDR_FIREBASE_API_KEY": JSON.stringify(""),
        "import.meta.env.VITE_TINYTLDR_FIREBASE_PROJECT_ID": JSON.stringify(""),
        "import.meta.env.VITE_TINYTLDR_FIREBASE_APP_ID": JSON.stringify(""),
        "import.meta.env.VITE_TINYTLDR_FIREBASE_AUTH_DOMAIN": JSON.stringify(""),
        "import.meta.env.VITE_TINYTLDR_FIREBASE_DESIGNS_URL": JSON.stringify(""),
        "import.meta.env.VITE_TINYTLDR_FIREBASE_AI_URL": JSON.stringify(""),
        "import.meta.env.VITE_TINYTLDR_API_URL": JSON.stringify(""),
      },
      build: { outDir: testBuildDir, emptyOutDir: false },
      logLevel: "error",
    });
    const started = await startStaticSpaServer(testBuildDir);
    server = started.server;
    baseUrl = started.baseUrl;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (testBuildDir) await fs.promises.rm(testBuildDir, { recursive: true, force: true });
  });

  it("parses all website routes and query parameters cleanly", () => {
    expect(parseLocationRoute("/", "").page).toBe("playground");
    expect(parseLocationRoute("/designs", "").page).toBe("playground");
    expect(parseLocationRoute("/templates", "?size=story&theme=light")).toMatchObject({
      page: "playground",
      initialSize: "story",
      initialTheme: "light",
    });
    expect(parseLocationRoute("/templates/kinetic-quote", "?size=square")).toMatchObject({
      page: "playground",
      templateId: "kinetic-quote",
      initialSize: "square",
    });
    expect(parseLocationRoute("/playground", "?template=stat-counter&size=story")).toMatchObject({
      page: "playground",
      templateId: "stat-counter",
      initialSize: "story",
    });
    expect(parseLocationRoute("/studio", "?template=carousel-slides")).toMatchObject({
      page: "playground",
      templateId: "carousel-slides",
    });
    expect(parseLocationRoute("/docs/self-host", "")).toMatchObject({
      page: "docs",
      docsSection: "selfHost",
    });
    expect(parseLocationRoute("/contribute", "")).toMatchObject({
      page: "docs",
      docsSection: "contribute",
    });
  });

  it("compiles all 12 built-in templates across every declared size preset via BrowserCompiler", () => {
    const templates = getCatalogTemplates();
    expect(templates).toHaveLength(12);

    for (const tpl of templates) {
      const state = createInitialPlaygroundState({ templateId: tpl.id });
      for (const preset of tpl.supportedSizes) {
        const nextState = playgroundStateReducer(state, {
          type: "SET_SIZE_PRESET",
          sizePreset: preset,
        });
        const compiled = compileBrowserPreview({
          templateId: nextState.templateId,
          size: nextState.sizePreset,
          theme: nextState.theme,
          data: nextState.slotData,
          activeSlideIndex: 1,
          revision: nextState.revision,
        });

        expect(compiled.validationErrors).toEqual([]);
        expect(compiled.html).toContain("window.__tinytldr");
        expect(compiled.dimensions.width).toBeGreaterThan(0);
        expect(compiled.dimensions.height).toBeGreaterThan(0);
      }
    }
  });

  it("renders one workspace, legacy starter links, modal docs, and all 12 templates with zero console errors", async () => {
    expect(browser).not.toBeNull();
    const page = await browser!.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.getByRole("dialog", { name: "Welcome to tinytldr." }).waitFor();
    await page.getByRole("button", { name: "Start Creating" }).click();
    expect(await page.locator("header").count()).toBe(1);
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
      "Untitled design",
    );
    expect(await page.getByRole("complementary", { name: "Your designs" }).isVisible()).toBe(true);

    await page.goto(`${baseUrl}/designs`, { waitUntil: "networkidle" });
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
      "Untitled design",
    );

    await page.goto(`${baseUrl}/templates`, { waitUntil: "networkidle" });
    expect(await page.getByLabel("Starting point").count()).toBe(0);
    expect(await page.getByLabel("Template HTML", { exact: true }).isVisible()).toBe(false);
    await page.getByRole("button", { name: "Source editors", exact: true }).click();
    expect(await page.getByLabel("Template HTML", { exact: true }).isVisible()).toBe(true);

    await page.goto(`${baseUrl}/templates/kinetic-quote`, { waitUntil: "networkidle" });
    expect(
      await page.getByRole("button", { name: "Play animation", exact: true }).isVisible(),
    ).toBe(true);

    await page.goto(`${baseUrl}/docs`, { waitUntil: "networkidle" });
    expect(
      await page.getByRole("dialog", { name: "Documentation" }).locator("h1").textContent(),
    ).toContain("Quickstart");
    await page.goto(`${baseUrl}/docs/self-host`, { waitUntil: "networkidle" });
    expect(
      await page.getByRole("dialog", { name: "Documentation" }).locator("h1").textContent(),
    ).toContain("Self-Hosting");
    await page.goto(`${baseUrl}/contribute`, { waitUntil: "networkidle" });
    expect(
      await page.getByRole("dialog", { name: "Documentation" }).locator("h1").textContent(),
    ).toContain("Contribute");

    await page.goto(`${baseUrl}/playground`, { waitUntil: "networkidle" });
    expect(await page.locator("h1").first().textContent()).toContain("Untitled design");

    const templates = getCatalogTemplates();
    for (const tpl of templates) {
      await page.goto(`${baseUrl}/templates/${tpl.id}`, { waitUntil: "networkidle" });
      await page.waitForSelector("iframe");
      expect(await page.locator("iframe").first().isVisible()).toBe(true);
    }

    await page.goto(`${baseUrl}/playground`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("region", { name: "Design workspace" })
      .getByRole("alert")
      .filter({ hasText: "not configured" })
      .waitFor();
    expect(page.url()).toBe(`${baseUrl}/playground`);
    expect(
      await page.evaluate(() => localStorage.getItem("tinytldr:unclaimed-designs:v1")),
    ).toContain("editKey");

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    await page.close();
  });
});
