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
import { resolveAuthReturnPath } from "../src/state/RouterState.js";
import { DESIGN_HISTORY_KEY, LocalDesignSchema } from "../src/lib/DesignHistory.js";
import { setSource } from "./SourceEditorFixture.js";

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
    for (const page of ["privacy", "terms", "library"]) {
      for (const suffix of ["", "/", "///"]) {
        expect(parseLocationRoute(`/${page}${suffix}`, "?size=story&theme=light")).toEqual({
          page,
          pathname: `/${page}`,
        });
      }
      expect(resolveAuthReturnPath(`/${page}?return=1`, "https://www.tinytldr.com")).toBe(
        `/${page}?return=1`,
      );
      expect(parseLocationRoute(`/${page}/unknown`, "").page).toBe("playground");
    }
  });

  it("serves public legal pages without backend configuration, background drafts or layout overflow", async () => {
    const context = await browser!.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      for (const [pathname, title] of [
        ["/privacy", "Privacy Policy"],
        ["/terms", "Terms and Conditions"],
      ]) {
        await page.goto(`${baseUrl}${pathname}`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: title, exact: true }).waitFor();
        await page.reload({ waitUntil: "networkidle" });
        const heading = page.getByRole("heading", { name: title, exact: true });
        await expect
          .poll(() => heading.evaluate((element) => element === document.activeElement))
          .toBe(true);
        expect(await page.title()).toBe(`${title} | tinytldr`);
        expect(await page.locator("iframe").count()).toBe(0);
        expect(await page.getByRole("dialog").count()).toBe(0);
        expect(await page.getByRole("alert").count()).toBe(0);
        expect(await page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY)).toBe(
          null,
        );
        const article = page.getByRole("article", { name: title });
        const text = await article.innerText();
        expect(text).toContain("AJR Creative LLC");
        expect(text).toContain("aj@ajr.co");
        expect(text).toContain("18");
        expect(text).toMatch(/public.+link/);
        expect(text).toContain("Library");
        expect(text).not.toMatch(/\b(TODO|TBD)\b|lorem ipsum|your company|\[(company|email)\]/i);
        expect(await article.locator("time").getAttribute("datetime")).toBe("2026-11-03");
        expect(
          await article.getByRole("link", { name: "aj@ajr.co" }).last().getAttribute("href"),
        ).toBe("mailto:aj@ajr.co");
        if (pathname === "/privacy") {
          expect(text).toContain("not end-to-end encryption");
          expect(text).toContain("does not revoke the key");
          expect(text).toContain("does not remove copies");
        } else {
          expect(text).toContain("Virginia, United States");
          expect(text).toContain("MIT license");
          expect(text).toContain("does not automatically license it to the public");
        }
        for (const viewport of [
          { width: 1440, height: 900 },
          { width: 390, height: 844 },
          { width: 320, height: 568 },
          { width: 640, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          for (const theme of ["Day", "Night"]) {
            await page.getByRole("button", { name: theme, exact: true }).click();
            const geometry = await page.locator(".legal-page").evaluate((element) => {
              const footer = document.querySelector(".site-footer")!.getBoundingClientRect();
              const bounds = element.getBoundingClientRect();
              return {
                overflows: element.scrollWidth > element.clientWidth,
                scrolls: element.scrollHeight > element.clientHeight,
                fits: bounds.bottom <= footer.top + 1,
                documentFits: document.documentElement.scrollWidth <= window.innerWidth,
                controlsFit: [
                  ...document.querySelectorAll(".site-footer a, .site-footer button"),
                ].every((control) => {
                  const box = control.getBoundingClientRect();
                  return (
                    box.left >= 0 &&
                    box.right <= window.innerWidth &&
                    box.top >= footer.top &&
                    box.bottom <= footer.bottom
                  );
                }),
              };
            });
            expect(geometry, JSON.stringify({ pathname, viewport, theme, geometry })).toEqual({
              overflows: false,
              scrolls: true,
              fits: true,
              documentFits: true,
              controlsFit: true,
            });
            await page.locator(".legal-page").evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            const contact = (await article
              .getByRole("link", { name: "aj@ajr.co" })
              .last()
              .boundingBox())!;
            expect(contact.y).toBeGreaterThanOrEqual(0);
            expect(contact.y + contact.height).toBeLessThanOrEqual(
              (await page.locator(".site-footer").boundingBox())!.y,
            );
          }
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("keeps legal links native for new tabs and uses focused, scroll-resetting same-tab navigation", async () => {
    const context = await browser!.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/privacy`, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        document.documentElement.dataset.routeProbe = "same-document";
      });
      const terms = page.locator(".site-footer").getByRole("link", { name: "Terms", exact: true });
      expect(await terms.getAttribute("href")).toBe("/terms");
      const pendingTab = context.waitForEvent("page");
      await terms.click({ modifiers: ["ControlOrMeta"] });
      const tab = await pendingTab;
      await tab.getByRole("heading", { name: "Terms and Conditions", exact: true }).waitFor();
      expect(new URL(page.url()).pathname).toBe("/privacy");
      expect(new URL(tab.url()).pathname).toBe("/terms");
      await tab.close();
      await page.getByRole("link", { name: "Terms and Conditions", exact: true }).click();
      expect(new URL(page.url()).pathname).toBe("/terms");
      await page.locator(".legal-page").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page
        .locator(".site-footer")
        .getByRole("link", { name: "Privacy", exact: true })
        .click();
      await expect.poll(() => page.locator(".legal-page").evaluate((el) => el.scrollTop)).toBe(0);
      expect(
        await page
          .getByRole("heading", { name: "Privacy Policy", exact: true })
          .evaluate((element) => element === document.activeElement),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.dataset.routeProbe)).toBe(
        "same-document",
      );
      await page.goBack({ waitUntil: "commit" });
      await page.getByRole("heading", { name: "Terms and Conditions", exact: true }).waitFor();
      await page.goForward({ waitUntil: "commit" });
      await page.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor();
      expect(
        await page
          .locator(".site-footer")
          .getByRole("link", { name: "Privacy", exact: true })
          .getAttribute("aria-current"),
      ).toBe("page");
    } finally {
      await context.close();
    }
  });

  it("preserves unfinished source and prompts through Library/legal navigation, history and return links", async () => {
    const context = await browser!.newContext();
    const page = await context.newPage();
    const workspacePath = "/playground?template=kinetic-quote&size=story&theme=light";
    const sources = {
      HTML: "<h1>Unfinished local content</h1>{% if %}",
      CSS: "h1 { color: #123456; }",
      JSON: "{ unfinished JSON",
    } as const;
    try {
      await page.goto(`${baseUrl}${workspacePath}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Start Creating", exact: true }).click();
      await page.getByLabel("Design title", { exact: true }).fill("Unfinished design");
      await setSource(page, "HTML", sources.HTML);
      await setSource(page, "CSS", sources.CSS);
      await setSource(page, "JSON", sources.JSON);
      await page
        .getByRole("textbox", { name: "Template JSON", exact: true })
        .evaluate((element) => {
          element.setAttribute("data-route-probe", "same-editor");
        });
      await page.getByLabel("Describe your idea").fill("A prompt I have not sent.");
      const snapshot = () =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "[]") as { id: string }[],
          DESIGN_HISTORY_KEY,
        );
      await expect.poll(async () => (await snapshot()).length).toBe(1);
      const id = (await snapshot())[0]!.id;
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      expect(new URL(page.url()).pathname).toBe("/library");
      expect(
        await page
          .getByRole("button", { name: "My Library", exact: true })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      await page.getByRole("heading", { name: "Sign in to open your library." }).waitFor();
      await page
        .locator(".site-footer")
        .getByRole("link", { name: "Privacy", exact: true })
        .click();
      await page.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor();
      expect(
        await page.getByRole("textbox", { name: "Template JSON", exact: true }).isVisible(),
      ).toBe(false);
      await page.locator(".site-footer").getByRole("link", { name: "Terms", exact: true }).click();
      await page.goBack({ waitUntil: "commit" });
      await page.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor();
      await page.goBack({ waitUntil: "commit" });
      await page.getByRole("region", { name: "My Library", exact: true }).waitFor();
      await page.goBack({ waitUntil: "commit" });
      await page.getByRole("textbox", { name: "Template JSON", exact: true }).waitFor();
      expect(page.url()).toBe(`${baseUrl}${workspacePath}`);
      for (const [language, source] of Object.entries(sources))
        expect(
          await page
            .getByRole("textbox", { name: `Template ${language}`, exact: true })
            .textContent(),
        ).toBe(source);
      expect(await page.getByLabel("Describe your idea").inputValue()).toBe(
        "A prompt I have not sent.",
      );
      expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
        "Unfinished design",
      );
      expect(
        await page
          .getByRole("textbox", { name: "Template JSON", exact: true })
          .getAttribute("data-route-probe"),
      ).toBe("same-editor");
      await page.goForward({ waitUntil: "commit" });
      await page.getByRole("region", { name: "My Library", exact: true }).waitFor();
      await page.getByRole("button", { name: "Back to your design", exact: true }).click();
      expect(page.url()).toBe(`${baseUrl}${workspacePath}`);
      await page
        .locator(".site-footer")
        .getByRole("link", { name: "Privacy", exact: true })
        .click();
      await page.getByRole("link", { name: "Back to workspace", exact: true }).click();
      expect(page.url()).toBe(`${baseUrl}${workspacePath}`);
      expect((await snapshot()).map((entry) => entry.id)).toEqual([id]);
      const history = LocalDesignSchema.array().parse(await snapshot());
      expect(history[0]!.pageJson![history[0]!.document.pages[0]!.id]).toBe(sources.JSON);
      await page.getByRole("button", { name: "New design", exact: true }).click();
      await expect.poll(() => page.getByLabel("Describe your idea").inputValue()).toBe("");
      await page.getByLabel("Describe your idea").fill("Another draft at root.");
      await page.getByRole("button", { name: "New design", exact: true }).click();
      await expect.poll(() => page.getByLabel("Describe your idea").inputValue()).toBe("");
      expect(page.url()).toBe(`${baseUrl}/`);
    } finally {
      await context.close();
    }
  });

  it("opens the Library route directly and after refresh for guests, including the mobile drawer", async () => {
    const context = await browser!.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/library`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Sign in to open your library." }).waitFor();
      expect(await page.getByRole("dialog").count()).toBe(0);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Sign in to open your library." }).waitFor();
      expect(new URL(page.url()).pathname).toBe("/library");
      await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Your designs menu" });
      const library = drawer.getByRole("button", { name: "My Library", exact: true });
      expect(await library.getAttribute("aria-pressed")).toBe("true");
      await library.click();
      await page.getByRole("button", { name: "Start Creating", exact: true }).click();
      expect(new URL(page.url()).pathname).toBe("/");
      expect(await drawer.isVisible()).toBe(false);
      await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
      await library.click();
      expect(new URL(page.url()).pathname).toBe("/library");
      expect(await drawer.isVisible()).toBe(false);
      await page.getByRole("heading", { name: "Sign in to open your library." }).waitFor();
    } finally {
      await context.close();
    }
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
