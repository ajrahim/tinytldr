import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { WorkspaceProjectSchema } from "@tinytldr/core";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import {
  downloadSource,
  editTemplate,
  setSource,
  showSourceEditors,
} from "./SourceEditorFixture.js";
import { DESIGN_HISTORY_KEY } from "../src/lib/DesignHistory.js";
import { chooseDropdown } from "./DropdownFixture.js";
import { chooseSiteTheme } from "./SiteChromeFixture.js";

describe.skipIf(!hasFirebaseEmulators)("Horizontal artboard workspace", () => {
  let site: Awaited<ReturnType<typeof startWorkspaceTestServer>>;
  let browser: Browser;
  beforeAll(async () => {
    site = await startWorkspaceTestServer();
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });
  async function open(page: Page, sourcesOpen = true) {
    await page.goto(site.baseUrl);
    await page
      .getByRole("dialog", { name: "Welcome to tinytldr." })
      .getByRole("button", { name: "Start Creating" })
      .click();
    await expect
      .poll(() => page.frameLocator('iframe[title="Design preview"]').locator("h1").textContent())
      .toBe("Less, but better.");
    if (sourcesOpen) await showSourceEditors(page);
  }
  async function project(page: Page) {
    return WorkspaceProjectSchema.parse(
      JSON.parse((await downloadSource(page, "Download design JSON")).text),
    );
  }

  it("centers animated opening status in both themes and reduced motion without masking load errors", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let releaseRequest!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    try {
      await open(page);
      await page.route(site.apiUrl, async (route) => {
        if (route.request().method() !== "POST" || route.request().postDataJSON().action !== "get")
          return route.continue();
        await pending;
        await route.continue();
      });
      await page.goto(`${site.baseUrl}/d/00000000-0000-4000-8000-000000000001`);
      const opening = page.getByRole("status").filter({ hasText: "Opening your canvas..." });
      const spinner = opening.locator(".workspace-loading-spinner");
      await opening.waitFor();
      expect(await spinner.getAttribute("aria-hidden")).toBe("true");
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 320, height: 568 },
        { width: 640, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        for (const theme of ["Day", "Night"]) {
          await chooseSiteTheme(page, theme);
          const offset = await opening.evaluate((element) => {
            const pane = element.parentElement!.getBoundingClientRect();
            const indicator = element.querySelector<HTMLElement>(".workspace-loading-spinner")!;
            const message = element.querySelector("p")!.getBoundingClientRect();
            const loader = indicator.getBoundingClientRect();
            return {
              x: (message.left + message.right) / 2 - (pane.left + pane.right) / 2,
              y:
                ((loader.top + loader.bottom - indicator.offsetHeight) / 2 + message.bottom) / 2 -
                (pane.top + pane.bottom) / 2,
              animation: getComputedStyle(indicator).animationName,
            };
          });
          expect(Math.abs(offset.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(offset.y)).toBeLessThanOrEqual(1);
          expect(offset.animation).toBe("workspace-opening-spin");
          const elapsed = () =>
            spinner.evaluate((element) => {
              const time = element.getAnimations()[0]?.currentTime;
              if (typeof time !== "number") throw new Error("Opening loader is not animated.");
              return time;
            });
          const initialTime = await elapsed();
          await expect.poll(elapsed).toBeGreaterThan(initialTime + 25);
          await page.emulateMedia({ reducedMotion: "reduce" });
          await expect
            .poll(() => spinner.evaluate((element) => getComputedStyle(element).animationName))
            .toBe("none");
          expect(await opening.isVisible()).toBe(true);
          await page.emulateMedia({ reducedMotion: "no-preference" });
        }
      }
      releaseRequest();
      await page.getByRole("heading", { name: "Could not open this design." }).waitFor();
      expect(await opening.count()).toBe(0);
      expect(await page.getByRole("alert").isVisible()).toBe(true);
      await page.getByRole("button", { name: /Start a new design/ }).click();
      await page.getByRole("region", { name: "Artboard canvas" }).waitFor();
      expect(await page.locator(".workspace-loading").count()).toBe(0);
    } finally {
      releaseRequest();
      await page.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  });

  it("draws no canvas focus border while retaining keyboard focus, selection and camera controls", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await open(page, false);
      const canvas = page.getByRole("region", { name: "Artboard canvas" });
      const title = page.getByLabel("Page 1 title", { exact: true });
      const sheet = page.locator(".artboard-sheet");
      const shadow = () => canvas.evaluate((element) => getComputedStyle(element).boxShadow);
      const outline = () =>
        sheet.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.outlineColor, style.outlineStyle, style.outlineWidth];
        });
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 320, height: 568 },
      ]) {
        await page.setViewportSize(viewport);
        for (const theme of ["Day", "Night"]) {
          await chooseSiteTheme(page, theme);
          await title.click();
          await page.keyboard.press("ArrowRight");
          expect(await title.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
          await canvas.click({ position: { x: 8, y: 8 } });
          expect(await canvas.evaluate((element) => element === document.activeElement)).toBe(true);
          await expect.poll(shadow).toBe("none");
          const beforePan = Number(await canvas.getAttribute("data-pan-x"));
          await canvas.press("ArrowRight");
          await expect
            .poll(async () => Number(await canvas.getAttribute("data-pan-x")))
            .toBe(beforePan - 40);
          expect(await shadow()).toBe("none");
          await canvas.press("0");
          const selectionOutline = await outline();
          await sheet.click();
          expect(await shadow()).toBe("none");
          expect(await outline()).toEqual(selectionOutline);
          expect(await sheet.getAttribute("aria-pressed")).toBe("true");
          await title.focus();
          await page.keyboard.press("Shift+Tab");
          expect(await canvas.evaluate((element) => element === document.activeElement)).toBe(true);
          expect(await shadow()).toBe("none");
        }
      }
    } finally {
      await context.close();
    }
  });

  it("initializes offscreen artboards without false overflow warnings", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      // Simulate stale viewport metrics while native offscreen frames initialize.
      if (window.parent !== window) {
        Object.defineProperty(window, "innerWidth", { value: 300 });
        Object.defineProperty(window, "innerHeight", { value: 150 });
      }
    });
    const page = await context.newPage();
    await open(page);
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await expect.poll(() => page.locator(".artboard").count()).toBe(3);
    const warnings = async () =>
      Promise.all(
        page
          .frames()
          .slice(1)
          .map((frame) =>
            frame.evaluate(async () => {
              if (!("__tinytldr" in window)) throw new Error("Missing preview runtime.");
              const runtime = window.__tinytldr;
              if (
                !runtime ||
                typeof runtime !== "object" ||
                !("ready" in runtime) ||
                !("warnings" in runtime)
              ) {
                throw new Error("Invalid preview runtime.");
              }
              await runtime.ready;
              return runtime.warnings;
            }),
          ),
      );
    await expect.poll(warnings).toEqual([[], [], []]);
    await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "story");
    await expect
      .poll(() =>
        page
          .frameLocator('iframe[title="Design preview"]')
          .locator("body")
          .getAttribute("data-tt-preset"),
      )
      .toBe("story");
    await expect.poll(warnings).toEqual([[], [], []]);
    await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "square");
    await expect
      .poll(() =>
        page
          .frameLocator('iframe[title="Design preview"]')
          .locator("body")
          .getAttribute("data-tt-preset"),
      )
      .toBe("square");
    await setSource(
      page,
      "HTML",
      '<h1 data-tt-slot="headline" style="position:absolute;left:1100px">{{ headline }}</h1>',
    );
    await expect.poll(warnings).toEqual([
      [],
      [],
      [
        {
          code: "overflow",
          message: "Slot 'headline' overflows its container.",
          selector: '[data-tt-slot="headline"]',
        },
      ],
    ]);
    await context.close();
  });

  it("edits independent artboards, persists titles/purposes and shared size, reloads, and forks every page", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await page.getByLabel("Design title", { exact: true }).fill("An artboard story");
    await page.getByLabel("Page 1 title", { exact: true }).fill("Cover");
    await page
      .getByLabel("Page 1 purpose", { exact: true })
      .fill("Hook the reader without explaining everything.");
    await setSource(page, "HTML", '<main class="cover"><h1>{{ headline }}</h1></main>');
    await setSource(
      page,
      "CSS",
      ".cover { width:100%; height:100%; background:#123456; } h1 { color:white; font:80px Inter; }",
    );
    await editTemplate(page, (manifest) => {
      manifest.sampleData.headline = "The opening thought.";
    });
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await expect.poll(() => page.locator(".artboard").count()).toBe(2);
    await page.getByLabel("Page 2 title", { exact: true }).fill("Evidence");
    await page
      .getByLabel("Page 2 purpose", { exact: true })
      .fill("Explain why the first page matters.");
    await setSource(page, "HTML", '<section class="evidence"><h1>{{ headline }}</h1></section>');
    await setSource(
      page,
      "CSS",
      ".evidence { width:100%; height:100%; background:#abcdef; } h1 { font:60px Georgia; }",
    );
    await editTemplate(page, (manifest) => {
      manifest.sampleData.headline = "The supporting facts.";
    });
    await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "portrait");
    expect(
      await page
        .locator(".artboard iframe")
        .evaluateAll((frames) =>
          frames.every(
            (frame) => frame.style.width === "1080px" && frame.style.height === "1350px",
          ),
        ),
    ).toBe(true);
    const boxes = await page.locator(".artboard-sheet").evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width };
      }),
    );
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width);
    expect(boxes[1]!.y).toBe(boxes[0]!.y);
    await page.getByRole("button", { name: "Select Cover", exact: true }).click();
    expect((await downloadSource(page, "HTML / Liquid source")).text).toContain('class="cover"');
    expect((await downloadSource(page, "CSS source")).text).toContain("#123456");
    expect(JSON.parse((await downloadSource(page, "Template JSON")).text).sampleData.headline).toBe(
      "The opening thought.",
    );
    const design = await project(page);
    expect(design.pages.map((item) => [item.title, item.description])).toEqual([
      ["Cover", "Hook the reader without explaining everything."],
      ["Evidence", "Explain why the first page matters."],
    ]);
    expect(design.size).toBe("portrait");
    const html = (await downloadSource(page, "Rendered HTML")).text;
    const output = await context.newPage();
    await output.setContent(html);
    await expect
      .poll(() => output.frameLocator('iframe[title="Page 1"]').locator("h1").textContent())
      .toBe("The opening thought.");
    await expect
      .poll(() => output.frameLocator('iframe[title="Page 2"]').locator("h1").textContent())
      .toBe("The supporting facts.");
    expect(await output.locator("body").innerText()).not.toContain("Hook the reader");
    await output.close();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9a-f-]+$/);
    const original = page.url();
    await page.reload();
    await expect.poll(() => page.locator(".artboard").count()).toBe(2);
    expect(await page.getByLabel("Page 2 purpose", { exact: true }).inputValue()).toBe(
      "Explain why the first page matters.",
    );
    await expect.poll(() => page.locator(".save-caption").textContent()).toBe("Unclaimed design");
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(original);
    await visitor
      .getByRole("dialog", { name: "Welcome to tinytldr." })
      .getByRole("button", { name: "Start Creating" })
      .click();
    await visitor
      .getByLabel("Page 2 purpose", { exact: true })
      .fill("A visitor's changed purpose.");
    await visitor.getByRole("button", { name: "Save copy", exact: true }).click();
    await expect.poll(() => visitor.url()).not.toBe(original);
    expect((await project(visitor)).pages[1]!.description).toBe("A visitor's changed purpose.");
    await page.reload();
    await expect
      .poll(() => page.getByLabel("Page 2 purpose", { exact: true }).inputValue())
      .toBe("Explain why the first page matters.");
    expect(errors).toEqual([]);
    await visitorContext.close();
    await context.close();
  });

  it("retains invalid JSON on inactive pages through local recovery/import and removes only the requested page", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page);
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await page
      .getByLabel("Page 2 purpose", { exact: true })
      .fill("This unfinished page is intentional.");
    await setSource(page, "JSON", "{ unfinished second page");
    await page.getByRole("button", { name: "Select Page 1", exact: true }).click();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole("alert").innerText()).toContain("Page 2");
    const recovery = await downloadSource(page, "Download design JSON");
    const envelope = JSON.parse(recovery.text);
    expect(envelope.pageJson[envelope.document.pages[1].id]).toBe("{ unfinished second page");
    expect(envelope).not.toHaveProperty("editKey");
    const id = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "[]")[0].id,
      DESIGN_HISTORY_KEY,
    );
    await page.goto(`${site.baseUrl}/local/${id}`);
    await expect.poll(() => page.locator(".artboard").count()).toBe(2);
    await page.getByRole("button", { name: "Select Page 2", exact: true }).click();
    await showSourceEditors(page);
    expect(await page.getByLabel("Template JSON", { exact: true }).innerText()).toBe(
      "{ unfinished second page",
    );
    await page.goto(`${site.baseUrl}/studio`);
    await showSourceEditors(page);
    await page.getByLabel("Import design JSON").setInputFiles({
      name: "recovery.json",
      mimeType: "application/json",
      buffer: Buffer.from(recovery.text),
    });
    await expect.poll(() => page.locator(".artboard").count()).toBe(2);
    await page.getByRole("button", { name: "Select Page 2", exact: true }).click();
    expect(await page.getByLabel("Template JSON", { exact: true }).innerText()).toBe(
      "{ unfinished second page",
    );
    expect(await page.getByLabel("Page 2 purpose", { exact: true }).inputValue()).toBe(
      "This unfinished page is intentional.",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove page 2", exact: true }).click();
    await expect.poll(() => page.locator(".artboard").count()).toBe(1);
    expect(await page.locator(".artboard-remove").isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    await context.close();
  });

  it("uses a subtle blue-white Day grid, a 10% dimmer Night canvas, and zoom-stable glass metadata", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await open(page);
    await page.getByRole("button", { name: "Source editors", exact: true }).click();
    const canvas = page.getByRole("region", { name: "Artboard canvas" });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const appearance of ["Day", "Night"]) {
        await chooseSiteTheme(page, appearance);
        // The Day/Night reveal applies the class inside a view transition, after the click resolves.
        await expect
          .poll(() => page.locator("html").getAttribute("class"))
          .toContain(appearance === "Day" ? "light" : "dark");
        const actual = await canvas.evaluate((element) => {
          const style = getComputedStyle(element);
          const zoom = Number(element.dataset.zoom);
          const sample = document.createElement("canvas").getContext("2d");
          if (!sample) throw new Error("Canvas color sampling is unavailable.");
          const color = (value: string) => {
            sample.clearRect(0, 0, 1, 1);
            sample.fillStyle = value;
            sample.fillRect(0, 0, 1, 1);
            return [...sample.getImageData(0, 0, 1, 1).data];
          };
          const background = color(style.backgroundColor);
          const gridColor = style.backgroundImage.match(/rgba?\([^)]+\)/)?.[0];
          if (!gridColor) throw new Error("The canvas grid has no color.");
          sample.fillStyle = gridColor;
          sample.fillRect(0, 0, 1, 1);
          const grid = [...sample.getImageData(0, 0, 1, 1).data];
          return {
            background,
            grid,
            line: color(gridColor),
            labels: [...element.querySelectorAll(".artboard-heading, .artboard textarea")].map(
              (label) => {
                const glass = getComputedStyle(label);
                return {
                  radius: parseFloat(glass.borderTopLeftRadius) * zoom,
                  blur: parseFloat(glass.backdropFilter.replace("blur(", "")) * zoom,
                  alpha: color(glass.backgroundColor)[3],
                };
              },
            ),
            overflow:
              document.documentElement.scrollWidth > innerWidth ||
              document.documentElement.scrollHeight > innerHeight,
          };
        });
        if (appearance === "Day") {
          expect(actual.background).toEqual([245, 247, 251, 255]);
          for (let channel = 0; channel < 3; channel++) {
            const difference = actual.background[channel]! - actual.grid[channel]!;
            expect(difference).toBeGreaterThan(0);
            expect(difference).toBeLessThanOrEqual(12);
          }
        } else {
          expect(actual.background).toEqual([11, 11, 13, 255]);
          expect(actual.line).toEqual([255, 255, 255, 18]);
        }
        expect(actual.labels).toHaveLength(2);
        for (const label of actual.labels) {
          expect(label.radius).toBeCloseTo(8);
          expect(label.blur).toBeCloseTo(8);
          expect(label.alpha).toBeGreaterThan(0);
          expect(label.alpha).toBeLessThan(255);
        }
        expect(actual.overflow).toBe(false);
      }
    }
    await context.close();
  });

  it("pans and zooms around the pointer with a moving, continuously visible grid and unchanged native preview/iframe", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await open(page);
    const canvas = page.getByRole("region", { name: "Artboard canvas" });
    const frame = page.frameLocator('iframe[title="Design preview"]');
    await frame
      .locator("h1")
      .evaluate((element) => element.setAttribute("data-camera-check", "preserved"));
    const read = () =>
      canvas.evaluate((element) => ({
        x: Number(element.dataset.panX),
        y: Number(element.dataset.panY),
        zoom: Number(element.dataset.zoom),
        grid: getComputedStyle(element).backgroundPosition,
        image: getComputedStyle(element).backgroundImage,
      }));
    const before = await read();
    const rect = (await canvas.boundingBox())!;
    await page.mouse.move(rect.x + 20, rect.y + 20);
    await page.mouse.wheel(80, 0);
    await expect.poll(async () => (await read()).x).toBeCloseTo(before.x - 80);
    expect((await read()).y).toBeCloseTo(before.y);
    expect((await read()).zoom).toBe(before.zoom);
    expect((await read()).grid).not.toBe(before.grid);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 45);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await read()).x).toBeCloseTo(before.x - 125);
    expect((await read()).zoom).toBe(before.zoom);
    await canvas.focus();
    const dragged = await read();
    await page.keyboard.down("Space");
    await page.mouse.down();
    await page.mouse.move(rect.x + 100, rect.y + 60, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    expect((await read()).x).toBeCloseTo(dragged.x + 80);
    expect((await read()).y).toBeCloseTo(dragged.y + 40);
    const sheet = (await page.locator(".artboard-sheet").boundingBox())!;
    const anchor = {
      x: Math.round(sheet.x + sheet.width / 2) - rect.x,
      y: Math.round(sheet.y + sheet.height / 2) - rect.y,
    };
    await page.mouse.move(rect.x + anchor.x, rect.y + anchor.y);
    const preZoom = await read();
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await read()).zoom).toBeGreaterThan(preZoom.zoom);
    const zoomed = await read();
    expect((anchor.x - zoomed.x) / zoomed.zoom).toBeCloseTo(
      (anchor.x - preZoom.x) / preZoom.zoom,
      4,
    );
    expect((anchor.y - zoomed.y) / zoomed.zoom).toBeCloseTo(
      (anchor.y - preZoom.y) / preZoom.zoom,
      4,
    );
    expect(zoomed.image).toContain("linear-gradient");
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => (await read()).zoom).toBeCloseTo(preZoom.zoom, 6);
    expect((await read()).x).toBeCloseTo(preZoom.x, 4);
    expect((await read()).y).toBeCloseTo(preZoom.y, 4);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await read()).zoom).toBeCloseTo(zoomed.zoom, 6);
    await canvas.press("ArrowRight");
    expect((await read()).x).toBeCloseTo(zoomed.x - 40);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    expect((await read()).zoom).toBeGreaterThan(zoomed.zoom);
    await page.getByRole("button", { name: "Fit all pages", exact: true }).click();
    await expect.poll(async () => (await read()).zoom).toBeCloseTo(before.zoom);
    expect(await frame.locator("h1").getAttribute("data-camera-check")).toBe("preserved");
    expect(
      await page
        .locator('iframe[title="Design preview"]')
        .evaluate((element) => [element.style.width, element.style.height]),
    ).toEqual(["1080px", "1080px"]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight === innerHeight &&
          document.documentElement.scrollWidth === innerWidth,
      ),
    ).toBe(true);
    await context.close();
  });

  it("normalizes wheel units, clamps zoom, and leaves metadata and composer scrolling alone", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await open(page);
    const canvas = page.getByRole("region", { name: "Artboard canvas" });
    const zoom = async () => Number(await canvas.getAttribute("data-zoom"));
    const rect = (await canvas.boundingBox())!;
    const anchor = { clientX: rect.x + 40, clientY: rect.y + 40 };
    const initial = await zoom();
    await canvas.dispatchEvent("wheel", { ...anchor, deltaY: -2, deltaMode: 1 });
    await expect.poll(zoom).toBeCloseTo(initial * Math.exp(32 * 0.005), 6);
    const pageHeight = await canvas.evaluate((element) => element.clientHeight);
    await canvas.dispatchEvent("wheel", { ...anchor, deltaY: 32 / pageHeight, deltaMode: 2 });
    await expect.poll(zoom).toBeCloseTo(initial, 6);
    await canvas.dispatchEvent("wheel", { ...anchor, deltaY: -100_000 });
    expect(await zoom()).toBe(3);
    await canvas.dispatchEvent("wheel", { ...anchor, deltaY: 100_000 });
    expect(await zoom()).toBe(0.01);
    await page.getByRole("button", { name: "Fit all pages", exact: true }).click();
    const before = await canvas.getAttribute("style");
    for (const label of ["Page 1 title", "Page 1 purpose", "Describe your idea", "Model"]) {
      const control =
        label === "Model"
          ? page.getByRole("combobox", { name: label, exact: true })
          : page.getByLabel(label, { exact: true });
      await control.dispatchEvent("wheel", { deltaY: -100, bubbles: true });
      expect(await canvas.getAttribute("style")).toBe(before);
    }
    await context.close();
  });

  it("supports real touch pan/pinch and keeps page metadata, canvas controls, and internal editors usable on mobile", async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await open(page);
    await page.getByRole("button", { name: "Add page", exact: true }).tap();
    await page
      .getByLabel("Page 2 purpose", { exact: true })
      .fill("An explanation below the second artboard.");
    const canvas = page.getByRole("region", { name: "Artboard canvas" });
    const rect = (await canvas.boundingBox())!;
    const session = await context.newCDPSession(page);
    const zoom = Number(await canvas.getAttribute("data-zoom"));
    // Pinch on empty canvas below the artboards; page metadata inputs keep their own gestures.
    const y = rect.y + rect.height - 24;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, x: 120, y },
        { id: 2, x: 220, y },
      ],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 1, x: 90, y: y + 20 },
        { id: 2, x: 250, y: y + 20 },
      ],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-zoom")))
      .toBeGreaterThan(zoom * 1.3);
    const before = Number(await canvas.getAttribute("data-pan-x"));
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: 20, y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 1, x: 70, y: y - 20 }],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-pan-x")))
      .toBeCloseTo(before + 50);
    await session.detach();
    await page.getByRole("button", { name: "Fit all pages", exact: true }).tap();
    const controls = (await page.locator(".canvas-navigation").boundingBox())!;
    expect(controls.x).toBeGreaterThanOrEqual(0);
    expect(controls.x + controls.width).toBeLessThanOrEqual(390);
    expect(await page.getByLabel("Page 2 purpose", { exact: true }).inputValue()).toBe(
      "An explanation below the second artboard.",
    );
    expect(
      await page
        .locator(".cm-scroller")
        .evaluateAll((items) => items.every((item) => item.clientHeight > 0)),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          scrollY === 0 &&
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await context.close();
  });
});
