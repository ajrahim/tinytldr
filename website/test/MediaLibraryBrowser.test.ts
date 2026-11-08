import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  ChromiumRenderer,
  inspectPdfBuffer,
  inspectPngHeader,
  probeVideoFile,
} from "@tinytldr/renderer";
import { RenderedExportSchema, projectFromDocument, type MediaFormat } from "@tinytldr/core";
import { startTinytldrHttpServer } from "../../mcp/src/index.js";
import { createBlankDocument } from "../src/lib/WorkspaceTemplates.js";
import { DESIGN_HISTORY_KEY } from "../src/lib/DesignHistory.js";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import { chooseAction, editTemplate, setSource } from "./SourceEditorFixture.js";
import { chooseDropdown } from "./DropdownFixture.js";
import { expectDialogLayout } from "./DialogBrowserFixture.js";
import type { inspectLibrary } from "./MediaLibraryFixture.js";
import { chooseSiteTheme } from "./SiteChromeFixture.js";

describe.skipIf(!hasFirebaseEmulators)("Rendered media library", () => {
  let browser: Browser;
  let site: Awaited<ReturnType<typeof startWorkspaceTestServer>>;
  let api: Awaited<ReturnType<typeof startTinytldrHttpServer>>;
  let renderer: ChromiumRenderer;
  let outputDir: string;

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(process.cwd(), ".test-media-library-"));
    renderer = new ChromiumRenderer();
    api = await startTinytldrHttpServer({
      host: "127.0.0.1",
      port: 0,
      outputDir,
      renderer,
      rateLimitPerMinute: 1000,
    });
    site = await startWorkspaceTestServer({ renderApiUrl: api.url });
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
    await api?.close();
    await renderer?.close();
    if (outputDir) await fs.rm(outputDir, { recursive: true, force: true });
  });

  async function openEditor(page: Page, signedIn = true) {
    await page.goto(site.baseUrl);
    await page
      .getByRole("dialog", { name: "Welcome to tinytldr." })
      .getByRole("button", { name: "Start Creating" })
      .click();
    await expect
      .poll(() => page.frameLocator('iframe[title="Design preview"]').locator("h1").textContent())
      .toContain("Less, but better.");
    if (signedIn) return site.signIn(page);
  }
  async function expectEmptyCentered(page: Page) {
    const measure = () =>
      page.locator(".media-library-empty").evaluate((empty) => {
        const library = empty.parentElement!;
        const bounds = library.getBoundingClientRect();
        const style = getComputedStyle(library);
        const toolbar = library.querySelector(".media-library-toolbar")!;
        const top =
          toolbar.getBoundingClientRect().bottom +
          parseFloat(getComputedStyle(toolbar).marginBottom);
        const footer = library.querySelector(".media-capacity");
        const bottom = footer
          ? footer.getBoundingClientRect().top
          : bounds.bottom - parseFloat(style.paddingBottom);
        const children = Array.from(empty.children).map((child) => child.getBoundingClientRect());
        const left = Math.min(...children.map((child) => child.left));
        const right = Math.max(...children.map((child) => child.right));
        return {
          x: (left + right) / 2 - (bounds.left + bounds.right) / 2,
          y: (children[0]!.top + children.at(-1)!.bottom) / 2 - (top + bottom) / 2,
          clearance: Math.min(
            ...children.flatMap((child) => [
              child.left - bounds.left,
              bounds.right - child.right,
              child.top - top,
              bottom - child.bottom,
            ]),
          ),
        };
      });
    await expect
      .poll(async () => {
        const { x, y } = await measure();
        return Math.abs(x) <= 1 && Math.abs(y) <= 1;
      })
      .toBe(true);
    const offsets = await measure();
    expect(Math.abs(offsets.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(offsets.y)).toBeLessThanOrEqual(1);
    expect(
      offsets.clearance,
      JSON.stringify({ viewport: page.viewportSize(), offsets }),
    ).toBeGreaterThanOrEqual(-1);
  }

  it("centers an accessible loading spinner in the available library area across themes, sizes and motion preferences", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await openEditor(page);
      await page.route(site.mediaUrl, async (route) => {
        const body = route.request().postDataJSON() as { action: string };
        if (body.action === "list") await pending;
        await route.continue();
      });
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      const status = page.locator(".media-library-loading");
      const spinner = status.locator("svg");
      await spinner.waitFor();
      expect(await status.getAttribute("role")).toBe("status");
      expect(await status.locator(".sr-only").textContent()).toBe("Opening your library...");
      expect(
        await status.locator(".sr-only").evaluate((element) => getComputedStyle(element).position),
      ).toBe("absolute");
      expect(await spinner.getAttribute("aria-hidden")).toBe("true");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 320, height: 568 },
        { width: 640, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        for (const theme of ["Day", "Night"]) {
          await chooseSiteTheme(page, theme);
          const geometry = () =>
            spinner.evaluate((element) => {
              const library = element.closest(".media-library")!;
              const bounds = library.getBoundingClientRect();
              const toolbar = library.querySelector(".media-library-toolbar")!;
              const top =
                toolbar.getBoundingClientRect().bottom +
                parseFloat(getComputedStyle(toolbar).marginBottom);
              const bottom = library.querySelector(".media-capacity")!.getBoundingClientRect().top;
              const indicator = element.getBoundingClientRect();
              return {
                x: (indicator.left + indicator.right - bounds.left - bounds.right) / 2,
                y: (indicator.top + indicator.bottom - top - bottom) / 2,
                clearance: Math.min(
                  indicator.left - bounds.left,
                  bounds.right - indicator.right,
                  indicator.top - top,
                  bottom - indicator.bottom,
                ),
                animation: getComputedStyle(element).animationName,
                overflow: document.documentElement.scrollWidth > innerWidth,
              };
            });
          await expect
            .poll(async () => {
              const { x, y } = await geometry();
              return Math.abs(x) <= 1 && Math.abs(y) <= 1;
            })
            .toBe(true);
          const measured = await geometry();
          expect(measured.clearance).toBeGreaterThanOrEqual(0);
          expect(measured.animation).toBe("spin");
          expect(measured.overflow).toBe(false);
          expect(await spinner.getAttribute("width")).toBe("24");
          expect(await spinner.getAttribute("height")).toBe("24");
        }
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect
        .poll(() => spinner.evaluate((element) => getComputedStyle(element).animationName))
        .toBe("none");
      release();
      await page.getByRole("heading", { name: "A little room for your finished work." }).waitFor();
      expect(await status.count()).toBe(0);
    } finally {
      release();
      await context.close();
    }
  });

  it("centers empty and filtered-empty library content beneath the toolbar across themes and viewport sizes", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openEditor(page);
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      await page.getByText("A little room for your finished work.", { exact: true }).waitFor();
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 320, height: 568 },
        { width: 640, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        for (const theme of ["Day", "Night"]) {
          await chooseSiteTheme(page, theme);
          await expectEmptyCentered(page);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      const sources = page.getByRole("group", { name: "Library source", exact: true });
      expect(await sources.getByRole("button").allInnerTexts()).toEqual([
        "Everything",
        "Uploads",
        "Exports",
      ]);
      expect(
        await sources.getByRole("button", { name: "Everything" }).getAttribute("aria-pressed"),
      ).toBe("true");
      expect(await page.getByText(/Rendered exports/).count()).toBe(0);
      for (const [label, heading] of [
        ["Uploads", "No uploads yet."],
        ["Exports", "No exports yet."],
      ] as const) {
        await sources.getByRole("button", { name: label, exact: true }).click();
        await page.getByRole("heading", { name: heading, exact: true }).waitFor();
        for (const viewport of [
          { width: 1440, height: 900 },
          { width: 320, height: 568 },
        ]) {
          await page.setViewportSize(viewport);
          await expectEmptyCentered(page);
          await expect
            .poll(
              () =>
                page.locator(".media-library-toolbar").evaluate((element) => {
                  const sources = element
                    .querySelector(".media-library-sources")!
                    .getBoundingClientRect();
                  const type = element.lastElementChild!.getBoundingClientRect();
                  return {
                    sameRow: Math.abs(sources.top - type.top) <= 1,
                    heights: Math.abs(sources.height - type.height),
                    sourcesLeft: sources.left - element.getBoundingClientRect().left,
                    typeRight: element.getBoundingClientRect().right - type.right,
                  };
                }),
              { message: JSON.stringify({ viewport, label }) },
            )
            .toEqual({ sameRow: true, heights: 0, sourcesLeft: 0, typeRight: 0 });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await sources.getByRole("button", { name: "Everything", exact: true }).click();
      const back = page.getByRole("button", { name: "Back to your design", exact: true });
      expect(await back.innerText()).toBe("Back to your design");
      await back.click();
      await prepareSmallDesign(page);
      await exportFormat(page, "png");
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      await page.getByRole("button", { name: "Preview A real image", exact: true }).waitFor();
      await chooseDropdown(page.getByRole("combobox", { name: "Library file type" }), "mp4");
      await page.getByRole("heading", { name: "Nothing here yet." }).waitFor();
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 320, height: 568 },
        { width: 640, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        for (const theme of ["Day", "Night"]) {
          await chooseSiteTheme(page, theme);
          await expectEmptyCentered(page);
        }
      }
      await chooseDropdown(page.getByRole("combobox", { name: "Library file type" }), "all");
      expect(await page.getByRole("button", { name: "Preview A real image" }).isVisible()).toBe(
        true,
      );
      expect(await storedItems(page)).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  it("saves prompt reference images once under Uploads and keeps them separate from exports", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openEditor(page);
      const png = async (color: string) =>
        Buffer.from(
          await page.evaluate((fill) => {
            const canvas = document.createElement("canvas");
            canvas.width = 4;
            canvas.height = 3;
            const context = canvas.getContext("2d")!;
            context.fillStyle = fill;
            context.fillRect(0, 0, 4, 3);
            return canvas.toDataURL("image/png").split(",")[1]!;
          }, color),
          "base64",
        );
      const attach = page.getByLabel("Attach reference files");
      const composerAlert = page.locator(".ai-composer [role='alert']");
      await attach.setInputFiles({
        name: "broken.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgo=", "base64"),
      });
      await composerAlert
        .filter({
          hasText: "My Library could not read broken.png as an image. It is still attached.",
        })
        .waitFor();
      expect(await page.getByRole("button", { name: "Remove context broken.png" }).count()).toBe(1);
      await page.getByRole("button", { name: "Remove context broken.png" }).click();

      const logo = await png("#3b2bd9");
      const photo = await png("#ff8800");
      const countSaves = () =>
        page.evaluate(() => {
          Reflect.set(window, "librarySaves", Number(Reflect.get(window, "librarySaves") ?? 0));
          addEventListener("tinytldr:media-saved", () =>
            Reflect.set(window, "librarySaves", Number(Reflect.get(window, "librarySaves")) + 1),
          );
        });
      const saves = () => page.evaluate(() => Number(Reflect.get(window, "librarySaves")));
      await countSaves();
      await attach.setInputFiles([
        { name: "brand-logo.png", mimeType: "image/png", buffer: logo },
        { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Brand notes.") },
      ]);
      await expect.poll(saves).toBe(1);
      expect((await storedItems(page)).map((item) => item.metadata.title)).toEqual(["brand-logo"]);
      await attach.setInputFiles([
        { name: "logo-copy.png", mimeType: "image/png", buffer: logo },
        { name: "photo.png", mimeType: "image/png", buffer: photo },
      ]);
      await expect.poll(saves).toBe(2);
      await page.getByRole("button", { name: "Remove context photo.png" }).waitFor();
      await page.waitForTimeout(300);
      expect(await saves()).toBe(2);
      expect(await composerAlert.count()).toBe(0);
      const uploads = await storedItems(page);
      expect(uploads.map((item) => item.metadata.title).sort()).toEqual(["brand-logo", "photo"]);
      for (const item of uploads) {
        expect(item.source).toBe("upload");
        expect(item.type).toBe("image/png");
        expect(item.metadata).toMatchObject({ format: "png", width: 4, height: 3 });
        expect(item.metadata.sourcePath).toMatch(/^\/local\/[0-9a-f-]{36}$/);
      }
      expect(uploads.find((item) => item.metadata.title === "brand-logo")!.bytes).toEqual(
        Array.from(logo),
      );

      await prepareSmallDesign(page);
      await exportFormat(page, "png");
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      const sources = page.getByRole("group", { name: "Library source", exact: true });
      const titles = () =>
        page
          .locator(".media-card-open")
          .evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label")).sort());
      await expect
        .poll(titles)
        .toEqual(["Preview A real image", "Preview brand-logo", "Preview photo"]);
      const meter = page.getByRole("meter");
      expect(await meter.getAttribute("aria-valuemax")).toBe(String(100 * 1024 * 1024));
      const uploadBytes = (await storedItems(page))
        .filter((item) => item.source === "upload")
        .reduce((total, item) => total + item.bytes.length, 0);
      expect(Number(await meter.getAttribute("aria-valuenow"))).toBe(uploadBytes);
      expect(await page.locator(".media-capacity-label").innerText()).toMatch(/of 100 MB$/);
      await sources.getByRole("button", { name: "Uploads", exact: true }).click();
      expect(await titles()).toEqual(["Preview brand-logo", "Preview photo"]);
      await chooseDropdown(page.getByRole("combobox", { name: "Library file type" }), "mp4");
      await page.getByRole("heading", { name: "Nothing here yet.", exact: true }).waitFor();
      await chooseDropdown(page.getByRole("combobox", { name: "Library file type" }), "all");
      await sources.getByRole("button", { name: "Exports", exact: true }).click();
      expect(await titles()).toEqual(["Preview A real image"]);
      expect(
        await sources.getByRole("button", { name: "Exports" }).getAttribute("aria-pressed"),
      ).toBe("true");
      await page.reload();
      expect(new URL(page.url()).pathname).toBe("/library");
      await page.getByRole("region", { name: "My Library", exact: true }).waitFor();
      await sources.getByRole("button", { name: "Uploads", exact: true }).click();
      await expect.poll(titles).toEqual(["Preview brand-logo", "Preview photo"]);
      await page.getByRole("button", { name: "Preview brand-logo", exact: true }).click();
      const preview = page.getByRole("dialog", { name: "Preview: brand-logo" });
      await preview.waitFor();
      expect(await preview.getByRole("link", { name: "Download" }).getAttribute("download")).toBe(
        "brand-logo.png",
      );
    } finally {
      await context.close();
    }
  });

  async function prepareSmallDesign(page: Page) {
    await page.getByLabel("Design title", { exact: true }).fill("A real image");
    await setSource(
      page,
      "HTML",
      '<main class="cover"><h1>{{ headline }}</h1></main><script>document.body.style.setProperty("--tt-bg","#ff0000");</script>',
    );
    await setSource(
      page,
      "CSS",
      ".cover { width:100%; height:100%; background:var(--tt-bg); padding:20px; } h1 {font:16px Inter; color:white;}",
    );
    await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "custom");
    await page.getByLabel("Custom width", { exact: true }).fill("160");
    await page.getByLabel("Custom height", { exact: true }).fill("96");
    await editTemplate(page, (manifest) => {
      manifest.themes.paper!.background = "#123456";
    });
    await expect
      .poll(() => page.getByRole("button", { name: "Save", exact: true }).isEnabled())
      .toBe(true);
  }
  async function exportFormat(page: Page, format: MediaFormat) {
    const labels = {
      png: "PNG image",
      jpg: "JPEG image",
      webp: "WebP image",
      pdf: "PDF document",
      mp4: "MP4 video",
    };
    await chooseAction(page, labels[format]);
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[role="status"],[role="alert"]')).some(
          (element) =>
            element.getAttribute("role") === "alert" ||
            element.textContent?.includes("saved to My Library"),
        ),
      undefined,
      { timeout: 60_000 },
    );
    expect(await page.getByRole("alert").allTextContents()).toEqual([]);
    expect(
      await page
        .getByRole("status")
        .filter({ hasText: /saved to My Library/ })
        .count(),
    ).toBe(1);
  }
  async function storedItems(page: Page) {
    return page.evaluate<Awaited<ReturnType<typeof inspectLibrary>>>(
      'import("/test/MediaLibraryFixture.ts").then(({ inspectLibrary }) => inspectLibrary())',
    );
  }

  it("opens the same Firebase files in a fresh browser, clears another account's preview, and deletes across devices", async () => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    try {
      const page = await first.newPage();
      const owner = await openEditor(page);
      if (!owner) throw new Error("Missing test owner.");
      await prepareSmallDesign(page);
      await exportFormat(page, "png");
      const original = await storedItems(page);
      const other = await second.newPage();
      await openEditor(other, false);
      const token = await site.auth.createCustomToken(owner.uid);
      const signIn = () =>
        other.evaluate(
          `import("/test/FirebaseSessionFixture.ts").then(({ signInTestAccount }) => signInTestAccount(${JSON.stringify(token)}))`,
        );
      await signIn();
      expect(await storedItems(other)).toEqual(original);
      expect(
        await other.evaluate(async () =>
          (await indexedDB.databases()).some(
            (database) => database.name === "tinytldr-rendered-media",
          ),
        ),
      ).toBe(false);
      await other.getByRole("button", { name: "My Library", exact: true }).click();
      await other.getByRole("button", { name: "Preview A real image", exact: true }).click();
      const preview = other.getByRole("dialog", { name: "Preview: A real image", exact: true });
      await preview.getByRole("link", { name: "Download" }).waitFor();
      await site.signIn(other);
      await expect.poll(() => other.locator(".media-card").count()).toBe(0);
      expect(await preview.count()).toBe(0);
      expect(await storedItems(other)).toEqual([]);
      expect(await storedItems(page)).toEqual(original);
      await signIn();
      await expect.poll(() => other.locator(".media-card").count()).toBe(1);
      await other.getByRole("button", { name: "Delete A real image", exact: true }).click();
      await other
        .getByRole("dialog", { name: "Delete file?", exact: true })
        .getByRole("button", { name: "Delete permanently", exact: true })
        .click();
      await expect.poll(() => other.locator(".media-card").count()).toBe(0);
      expect(await storedItems(page)).toEqual([]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("retains all artboards in ordered PNG/PDF/video batches with independent pixels and actual per-page video durations", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openEditor(page);
    await prepareSmallDesign(page);
    await editTemplate(page, (manifest) => {
      manifest.kind = "video";
      manifest.durationMs = 500;
    });
    await page
      .getByLabel("Page 1 purpose", { exact: true })
      .fill("Hook the reader; never render this description.");
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await setSource(page, "HTML", '<main class="second"><h1>{{ headline }}</h1></main>');
    await setSource(
      page,
      "CSS",
      ".second { width:100%;height:100%;padding:20px;background:#abcdef } h1{font:16px Inter;}",
    );
    await editTemplate(page, (manifest) => {
      manifest.kind = "video";
      manifest.durationMs = 1000;
    });
    await exportFormat(page, "png");
    await exportFormat(page, "pdf");
    await exportFormat(page, "mp4");
    const saved = await storedItems(page);
    expect(saved).toHaveLength(5);
    const images = saved
      .filter((item) => item.metadata.format === "png")
      .sort((a, b) => a.metadata.filename.localeCompare(b.metadata.filename));
    expect(images.map((item) => item.pixel)).toEqual([
      [18, 52, 86, 255],
      [171, 205, 239, 255],
    ]);
    expect(images.map((item) => inspectPngHeader(Buffer.from(item.bytes)))).toEqual([
      { width: 160, height: 96 },
      { width: 160, height: 96 },
    ]);
    const pdf = saved.find((item) => item.metadata.format === "pdf")!;
    expect(pdf.metadata.pageCount).toBe(2);
    expect(inspectPdfBuffer(Buffer.from(pdf.bytes))).toMatchObject({
      pageCount: 2,
      widthPxAt96Dpi: 160,
      heightPxAt96Dpi: 96,
    });
    const videos = saved
      .filter((item) => item.metadata.format === "mp4")
      .sort((a, b) => a.metadata.filename.localeCompare(b.metadata.filename));
    expect(videos.map((item) => item.metadata.durationMs)).toEqual([500, 1000]);
    for (const [index, video] of videos.entries()) {
      const actual = await probeVideoFile(path.join(outputDir, video.metadata.filename));
      expect(actual).toMatchObject({
        codecName: "h264",
        pixFmt: "yuv420p",
        width: 160,
        height: 96,
      });
      expect(actual.durationSeconds).toBeCloseTo((index + 1) * 0.5, 1);
    }
    await context.close();
  }, 90_000);

  it("renders and retains real PNG, PDF, and MP4 files in the account, previews/downloads them, filters, and survives reload", async () => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const active = new Set<string>();
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        active.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        active.delete(url);
        revoke(url);
      };
      Object.defineProperty(window, "activeLibraryUrls", { get: () => active.size });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openEditor(page);
    await prepareSmallDesign(page);
    await exportFormat(page, "png");
    await page
      .frameLocator('iframe[title="Design preview"]')
      .locator("h1")
      .evaluate((element) => element.setAttribute("data-kept", "yes"));
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await page.getByRole("button", { name: "Preview A real image", exact: true }).waitFor();
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    expect(
      await page
        .frameLocator('iframe[title="Design preview"]')
        .locator("h1")
        .getAttribute("data-kept"),
    ).toBe("yes");
    expect(await page.getByLabel("Template CSS", { exact: true }).count()).toBe(1);
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
      "A real image",
    );
    await page.getByLabel("Design title", { exact: true }).fill("A real PDF");
    await exportFormat(page, "pdf");
    await page.getByLabel("Design title", { exact: true }).fill("A real video");
    await editTemplate(page, (manifest) => {
      manifest.kind = "video";
      manifest.durationMs = 500;
    });
    await exportFormat(page, "mp4");
    const saved = await storedItems(page);
    expect(saved).toHaveLength(3);
    const png = saved.find((item) => item.metadata.format === "png")!;
    expect(png.type).toBe("image/png");
    expect(png.pixel).toEqual([18, 52, 86, 255]);
    expect(inspectPngHeader(Buffer.from(png.bytes))).toEqual({ width: 160, height: 96 });
    const pdf = saved.find((item) => item.metadata.format === "pdf")!;
    expect(inspectPdfBuffer(Buffer.from(pdf.bytes))).toMatchObject({
      pageCount: 1,
      widthPxAt96Dpi: 160,
      heightPxAt96Dpi: 96,
    });
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await expect.poll(() => page.locator(".media-card").count()).toBe(3);
    await expect
      .poll(() => page.evaluate(() => Number(Reflect.get(window, "activeLibraryUrls"))))
      .toBe(3);
    await chooseDropdown(page.getByRole("combobox", { name: "Library file type" }), "images");
    expect(await page.locator(".media-card").count()).toBe(1);
    await page.getByRole("button", { name: "Preview A real image", exact: true }).click();
    let preview = page.getByRole("dialog", { name: "Preview: A real image", exact: true });
    await preview.waitFor();
    await expect
      .poll(() => preview.locator("img").evaluate((image) => image.naturalWidth))
      .toBe(160);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 640, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      for (const theme of ["Day", "Night"]) {
        await chooseSiteTheme(page, theme);
        await expect
          .poll(() => page.locator("html").getAttribute("class"))
          .toContain(theme === "Day" ? "light" : "dark");
        await expectDialogLayout(preview, viewport);
        await preview.getByRole("button", { name: "Close preview" }).focus();
        await page.keyboard.press("Shift+Tab");
        expect(
          await preview
            .getByRole("link", { name: "Download", exact: true })
            .evaluate((element) => element === document.activeElement),
        ).toBe(true);
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    expect(
      await page
        .getByRole("button", { name: "Preview A real image", exact: true })
        .evaluate((button) => button === document.activeElement),
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => Number(Reflect.get(window, "activeLibraryUrls"))))
      .toBe(1);
    await chooseDropdown(page.getByRole("combobox", { name: "Library file type" }), "pdf");
    await page.getByRole("button", { name: "Preview A real PDF", exact: true }).click();
    preview = page.getByRole("dialog", { name: "Preview: A real PDF", exact: true });
    await preview.waitFor();
    expect(await preview.getByTitle("PDF preview").getAttribute("src")).toMatch(/^blob:/);
    await expectDialogLayout(preview, page.viewportSize()!);
    const pdfDownload = page.waitForEvent("download");
    await preview.getByRole("link", { name: "Download", exact: true }).click();
    expect(await fs.readFile((await (await pdfDownload).path())!)).toEqual(Buffer.from(pdf.bytes));
    await preview.getByRole("button", { name: "Close preview" }).click();
    await chooseDropdown(page.getByRole("combobox", { name: "Library file type" }), "mp4");
    await page.getByRole("button", { name: "Preview A real video", exact: true }).click();
    preview = page.getByRole("dialog", { name: "Preview: A real video", exact: true });
    await preview.waitFor();
    await expectDialogLayout(preview, page.viewportSize()!);
    await expect
      .poll(() => preview.locator("video").evaluate((video) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    expect(await preview.locator("video").evaluate((video) => video.duration)).toBeCloseTo(0.5, 1);
    const videoDownload = page.waitForEvent("download");
    await preview.getByRole("link", { name: "Download", exact: true }).click();
    const videoPath = await (await videoDownload).path();
    expect(await probeVideoFile(videoPath!)).toMatchObject({
      width: 160,
      height: 96,
      codecName: "h264",
      pixFmt: "yuv420p",
      avgFrameRate: "30/1",
    });
    await preview.getByRole("button", { name: "Close preview" }).click();
    await chooseDropdown(page.getByRole("combobox", { name: "Library file type" }), "all");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await chooseSiteTheme(page, theme === "light" ? "Day" : "Night");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          await page.getByRole("heading", { name: "My Library", exact: true }).isVisible(),
        ).toBe(true);
      }
    }
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => Number(Reflect.get(window, "activeLibraryUrls"))))
      .toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await expect.poll(() => page.locator(".media-card").count()).toBe(3);
    expect(
      await page
        .getByRole("group", { name: "Library source", exact: true })
        .getByRole("button", { name: "Everything" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(errors).toEqual([]);
    await context.close();
  }, 90_000);

  it("retains JPEG and WebP originals with bounded real thumbnails and keeps originals accessible when a thumbnail is damaged", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openEditor(page);
    await prepareSmallDesign(page);
    await page.getByLabel("Custom width", { exact: true }).fill("1024");
    await page.getByLabel("Custom height", { exact: true }).fill("640");
    for (const format of ["jpg", "webp"] as const) {
      await page.getByLabel("Design title", { exact: true }).fill(`A real ${format}`);
      await exportFormat(page, format);
    }
    const saved = await storedItems(page);
    expect(saved.map((item) => item.type).sort()).toEqual(["image/jpeg", "image/webp"]);
    expect(
      saved.every((item) => item.posterSize.width === 512 && item.posterSize.height === 320),
    ).toBe(true);
    expect(saved.find((item) => item.metadata.format === "jpg")!.bytes.slice(0, 3)).toEqual([
      255, 216, 255,
    ]);
    expect(
      Buffer.from(saved.find((item) => item.metadata.format === "webp")!.bytes).toString(
        "ascii",
        0,
        4,
      ),
    ).toBe("RIFF");
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await expect.poll(() => page.locator(".media-card").count()).toBe(2);
    for (const format of ["jpg", "webp"]) {
      await page.getByRole("button", { name: `Preview A real ${format}`, exact: true }).click();
      const preview = page.getByRole("dialog", { name: `Preview: A real ${format}`, exact: true });
      await expect
        .poll(() => preview.locator("img").evaluate((image) => image.naturalWidth))
        .toBe(1024);
      await preview.getByRole("button", { name: "Close preview" }).click();
    }
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await page.route(site.mediaUrl, async (route) => {
      const body = route.request().postDataJSON() as { action: string; kind?: string };
      if (body.action === "read" && body.kind === "poster")
        return route.fulfill({ contentType: "image/png", body: Buffer.from("damaged") });
      return route.continue();
    });
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /incomplete library file/ })
      .waitFor();
    expect(await page.locator(".media-card").count()).toBe(2);
    await page.getByRole("button", { name: "Preview A real jpg", exact: true }).click();
    await expect
      .poll(() =>
        page
          .getByRole("dialog", { name: "Preview: A real jpg", exact: true })
          .locator("img")
          .evaluate((image) => image.naturalWidth),
      )
      .toBe(1024);
    await context.close();
  });

  it("keeps every carousel output with its own actual thumbnail and rejects malformed personal requests instead of falling back to a built-in", async () => {
    const document = createBlankDocument();
    document.size = { width: 160, height: 96 };
    document.template.manifest.kind = "carousel";
    document.template.liquidTemplate =
      '<section class="tt-slide first">One</section><section class="tt-slide second">Two</section>';
    document.template.stylesCss = ".first{background:#123456}.second{background:#abcdef}";
    const response = await fetch(`${api.url}/v1/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: projectFromDocument(document), format: "png" }),
    });
    expect(response.status).toBe(200);
    const rendered = RenderedExportSchema.parse(await response.json());
    expect(rendered.assets).toHaveLength(2);
    expect(rendered.pageCount).toBe(2);
    const pdfResponse = await fetch(`${api.url}/v1/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: projectFromDocument(document), format: "pdf" }),
    });
    expect(pdfResponse.status).toBe(200);
    const pdf = RenderedExportSchema.parse(await pdfResponse.json());
    expect(pdf.assets).toHaveLength(1);
    expect(
      inspectPdfBuffer(Buffer.from(await (await fetch(pdf.assets[0]!.url)).arrayBuffer())),
    ).toMatchObject({ pageCount: 2, widthPxAt96Dpi: 160, heightPxAt96Dpi: 96 });
    const context = await browser.newContext();
    const page = await context.newPage();
    await openEditor(page);
    await page.getByLabel("Import design JSON").setInputFiles({
      name: "carousel.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(projectFromDocument(document))),
    });
    await exportFormat(page, "png");
    const saved = await storedItems(page);
    expect(saved).toHaveLength(2);
    expect(saved.map((item) => item.pixel?.slice(0, 3)).sort()).toEqual(
      [
        [18, 52, 86],
        [171, 205, 239],
      ].sort(),
    );
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await expect.poll(() => page.locator(".media-card").count()).toBe(2);
    await expect
      .poll(() =>
        page.locator(".media-card img").evaluateAll((images) => ({
          loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
          unique: new Set(images.map((image) => image.currentSrc)).size,
        })),
      )
      .toEqual({ loaded: 2, unique: 2 });
    const invalid = await fetch(`${api.url}/v1/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: "quote-card",
        document: { ...document, theme: "nonexistent" },
        format: "png",
      }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain("failed");
    await context.close();
  });

  it("aborts the whole batch on a quota failure, surfaces render errors, and never shows failed exports as library cards", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openEditor(page);
    await prepareSmallDesign(page);
    await page.route(`${api.url}/v1/render`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Renderer unavailable" }),
      }),
    );
    await chooseAction(page, "PNG image");
    await page
      .getByRole("alert")
      .filter({ hasText: /Renderer unavailable/ })
      .waitFor();
    await page.unroute(`${api.url}/v1/render`);
    await editTemplate(page, (manifest) => {
      manifest.kind = "carousel";
    });
    await setSource(
      page,
      "HTML",
      '<section class="tt-slide">One</section><section class="tt-slide">Two</section>',
    );
    let puts = 0;
    await page.route(site.mediaUrl, async (route) => {
      const body = route.request().postDataJSON() as { action: string };
      if (body.action === "put" && ++puts === 2)
        return route.fulfill({
          status: 413,
          contentType: "application/json",
          body: JSON.stringify({ error: "Storage quota exceeded" }),
        });
      return route.continue();
    });
    await chooseAction(page, "PNG image");
    await page.getByRole("alert").filter({ hasText: /quota/i }).waitFor();
    expect(await storedItems(page)).toHaveLength(0);
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await page.getByText("A little room for your finished work.", { exact: true }).waitFor();
    expect(await page.locator(".media-card").count()).toBe(0);
    expect(await page.locator(".media-library-loading").count()).toBe(0);
    await context.close();
  });

  it("reports unavailable and corrupt cloud responses without creating a device-only fallback", async () => {
    const unavailable = await browser.newContext();
    const page = await unavailable.newPage();
    await openEditor(page);
    await page.route(site.mediaUrl, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Firebase storage unavailable" }),
      }),
    );
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /Firebase storage unavailable/ })
      .waitFor();
    expect(await page.locator(".media-card").count()).toBe(0);
    await unavailable.close();

    const context = await browser.newContext();
    const corrupt = await context.newPage();
    await openEditor(corrupt);
    await corrupt.getByRole("button", { name: "My Library", exact: true }).click();
    await corrupt.getByText("A little room for your finished work.", { exact: true }).waitFor();
    await corrupt.route(site.mediaUrl, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { items: [{ metadata: { id: "corrupt" } }] } }),
      }),
    );
    await corrupt.getByRole("button", { name: "My Library", exact: true }).click();
    await corrupt.getByRole("button", { name: "My Library", exact: true }).click();
    await corrupt.getByRole("alert").waitFor();
    expect(await corrupt.getByRole("button", { name: "Retry", exact: true }).isVisible()).toBe(
      true,
    );
    expect(await corrupt.locator(".media-card").count()).toBe(0);
    expect(await corrupt.locator(".media-library-loading").count()).toBe(0);
    await context.close();
  });

  it("keeps bottom cards visible with a long design list and switches the mobile drawer to Library or account without stacking modals", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openEditor(page, false);
    await page.getByLabel("Design title", { exact: true }).fill("Seed draft");
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY))
      .not.toBe(null);
    await page.evaluate((key) => {
      const first = JSON.parse(localStorage.getItem(key) ?? "[]")[0];
      if (!first) throw new Error("No draft to seed history");
      localStorage.setItem(
        key,
        JSON.stringify(
          Array.from({ length: 60 }, (_, index) => ({
            ...first,
            id: crypto.randomUUID(),
            document: { ...first.document, title: `Draft ${index}` },
          })),
        ),
      );
    }, DESIGN_HISTORY_KEY);
    await page.reload();
    const account = page.getByRole("button", { name: /Sign in \/ Create account/ });
    const before = await account.boundingBox();
    const historyCount = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "[]").length,
      DESIGN_HISTORY_KEY,
    );
    expect(
      await page
        .getByRole("region", { name: "Local", exact: true })
        .locator(".design-section-count")
        .textContent(),
    ).toBe(String(historyCount));
    await page.getByRole("button", { name: "About local designs" }).hover();
    await page.getByRole("tooltip").waitFor();
    await page.locator(".design-sidebar nav").evaluate((nav) => {
      nav.scrollTop = nav.scrollHeight;
    });
    await expect.poll(() => page.getByRole("tooltip").isVisible()).toBe(false);
    expect(await account.boundingBox()).toEqual(before);
    expect(before!.y + before!.height).toBeLessThanOrEqual(720);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open sidebar" }).click();
    const drawer = page.getByRole("dialog", { name: "Your designs menu" });
    await drawer.getByRole("button", { name: "My Library", exact: true }).click();
    await page.getByRole("heading", { name: "My Library", exact: true }).waitFor();
    expect(await drawer.isVisible()).toBe(false);
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await drawer.getByRole("button", { name: /Sign in \/ Create account/ }).click();
    await page.getByRole("dialog", { name: "Sign in", exact: true }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(1);
    await context.close();
  });
});
