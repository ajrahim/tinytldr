import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import { DESIGN_HISTORY_KEY } from "../src/lib/DesignHistory.js";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import {
  chooseAction,
  downloadSource,
  editTemplate,
  setSource,
  showSourceEditors,
} from "./SourceEditorFixture.js";
import { createTemplateJson } from "../src/lib/TemplateEditor.js";
import { artboardDocument } from "@tinytldr/core";
import { chooseDropdown } from "./DropdownFixture.js";

describe.skipIf(!hasFirebaseEmulators)("Personal workspace browser flow", () => {
  let site: Awaited<ReturnType<typeof startWorkspaceTestServer>>;
  let browser: Browser;
  beforeAll(async () => {
    site = await startWorkspaceTestServer();
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });
  async function waitForCanvas(page: Page, title = "Less, but better.") {
    await expect
      .poll(() => page.frameLocator('iframe[title="Design preview"]').locator("h1").textContent())
      .toContain(title);
    const welcome = page.getByRole("dialog", { name: "Welcome to tinytldr." });
    if (await welcome.isVisible())
      await welcome.getByRole("button", { name: "Start Creating" }).click();
    await showSourceEditors(page);
  }

  it("preserves unsaved owned sources through surface navigation and reloads the signed-in Library route", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${site.baseUrl}/library`);
      await page.getByRole("heading", { name: "Sign in to open your library." }).waitFor();
      await site.signIn(page);
      await page.getByLabel("Upload storage", { exact: true }).waitFor();
      expect(new URL(page.url()).pathname).toBe("/library");
      await page.reload();
      await page.getByLabel("Upload storage", { exact: true }).waitFor();
      expect(new URL(page.url()).pathname).toBe("/library");
      await page.getByRole("button", { name: "New design", exact: true }).click();
      await expect
        .poll(
          async () => ({
            path: new URL(page.url()).pathname,
            errors: await page.getByRole("alert").allTextContents(),
          }),
          { timeout: 10_000 },
        )
        .toMatchObject({
          path: expect.stringMatching(/^\/d\/[0-9a-f-]+$/),
          errors: [],
        });
      const path = new URL(page.url()).pathname;
      const id = path.split("/").at(-1)!;
      const saved = await site.design(id);
      const welcome = page.getByRole("dialog", { name: "Welcome to tinytldr." });
      if (await welcome.isVisible())
        await welcome.getByRole("button", { name: "Start Creating" }).click();
      await setSource(page, "HTML", "<h1>Unsaved owned content</h1>");
      await setSource(page, "CSS", "h1 { color: #654321; }");
      await setSource(page, "JSON", "{ unsaved owned JSON");
      await page.getByLabel("Describe your idea").fill("Keep this owned draft prompt.");
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      expect(new URL(page.url()).pathname).toBe("/library");
      await page
        .locator(".site-footer")
        .getByRole("link", { name: "Privacy", exact: true })
        .click();
      await page.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor();
      await page.goBack({ waitUntil: "commit" });
      await page.getByRole("region", { name: "My Library", exact: true }).waitFor();
      await page.goBack({ waitUntil: "commit" });
      await page.getByRole("textbox", { name: "Template JSON", exact: true }).waitFor();
      expect(new URL(page.url()).pathname).toBe(path);
      expect(
        await page.getByRole("textbox", { name: "Template HTML", exact: true }).textContent(),
      ).toBe("<h1>Unsaved owned content</h1>");
      expect(
        await page.getByRole("textbox", { name: "Template CSS", exact: true }).textContent(),
      ).toBe("h1 { color: #654321; }");
      expect(
        await page.getByRole("textbox", { name: "Template JSON", exact: true }).textContent(),
      ).toBe("{ unsaved owned JSON");
      expect(await page.getByLabel("Describe your idea").inputValue()).toBe(
        "Keep this owned draft prompt.",
      );
      expect((await site.design(id)).document).toEqual(saved.document);
      await page.goForward({ waitUntil: "commit" });
      await page.getByRole("region", { name: "My Library", exact: true }).waitFor();
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      expect(new URL(page.url()).pathname).toBe(path);
      expect(
        await page.getByRole("textbox", { name: "Template JSON", exact: true }).textContent(),
      ).toBe("{ unsaved owned JSON");
    } finally {
      await context.close();
    }
  });

  it("sections account and browser designs compactly, with accessible hover and keyboard help in both themes", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(site.baseUrl);
      await waitForCanvas(page);
      await site.signIn(page);
      const sidebar = page.getByRole("complementary", { name: "Your designs" });
      const account = sidebar.getByRole("region", { name: "Account", exact: true });
      const local = sidebar.getByRole("region", { name: "This browser", exact: true });
      await account.waitFor();
      expect(await account.locator(".design-section-count").textContent()).toBe("0");
      expect(await account.locator(".empty-list").textContent()).toBe("No designs yet");
      expect((await account.locator(".empty-list").boundingBox())!.height).toBeLessThanOrEqual(20);
      expect(
        await sidebar.getByText("Your claimed designs will live here.", { exact: true }).count(),
      ).toBe(0);
      expect(await local.locator(".design-section-count").textContent()).toBe("1");
      expect(await local.locator(".design-list-item.is-current").count()).toBe(1);
      expect(
        await local
          .locator(".design-list-item")
          .first()
          .evaluate((element) => ({
            top: getComputedStyle(element).paddingTop,
            bottom: getComputedStyle(element).paddingBottom,
          })),
      ).toEqual({ top: "9px", bottom: "9px" });
      const accountHelp = account.getByRole("button", { name: "About account designs" });
      const browserHelp = local.getByRole("button", { name: "About browser designs" });
      const tooltip = page.getByRole("tooltip");
      const before = (await downloadSource(page, "Download design JSON")).text;
      for (const theme of ["Day", "Night"] as const) {
        await page.getByRole("button", { name: theme, exact: true }).click();
        await accountHelp.hover();
        await tooltip.waitFor();
        expect(await tooltip.textContent()).toContain("Designs you own");
        expect(await accountHelp.getAttribute("aria-describedby")).toBe(
          await tooltip.getAttribute("id"),
        );
        const box = (await tooltip.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(8);
        expect(box.x + box.width).toBeLessThanOrEqual(1432);
        expect(box.y).toBeGreaterThanOrEqual(8);
        expect(box.y + box.height).toBeLessThanOrEqual(892);
        expect(
          await tooltip.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return (
              element.matches(":popover-open") &&
              element.contains(
                document.elementFromPoint(
                  bounds.x + bounds.width / 2,
                  bounds.y + bounds.height / 2,
                ),
              )
            );
          }),
        ).toBe(true);
        await tooltip.hover();
        await page.waitForTimeout(200);
        expect(await tooltip.isVisible()).toBe(true);
        await page.keyboard.press("Escape");
        await expect.poll(() => tooltip.isVisible()).toBe(false);
        await page.mouse.move(1200, 800);
        await accountHelp.focus();
        await tooltip.waitFor();
        await page.keyboard.press("Escape");
        await expect.poll(() => tooltip.isVisible()).toBe(false);
        await accountHelp.press("Tab");
        await tooltip.waitFor();
        expect(await tooltip.textContent()).toContain("unsaved drafts kept in this browser");
        expect(await browserHelp.evaluate((element) => element === document.activeElement)).toBe(
          true,
        );
        await browserHelp.press("Tab");
        await expect.poll(() => tooltip.isVisible()).toBe(false);
        expect((await downloadSource(page, "Download design JSON")).text).toBe(before);
      }
    } finally {
      await context.close();
    }
  });

  it("opens and dismisses section help by touch without clipping or closing the mobile drawer", async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await page.goto(site.baseUrl);
      await waitForCanvas(page);
      const tooltip = page.getByRole("tooltip");
      for (const theme of ["Day", "Night"] as const) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: theme, exact: true }).click();
        await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
        const drawer = page.getByRole("dialog", { name: "Your designs menu" });
        const sidebar = drawer.getByRole("complementary", { name: "Your designs" });
        expect(await sidebar.getByRole("region", { name: "Account", exact: true }).count()).toBe(0);
        const help = sidebar.getByRole("button", { name: "About browser designs" });
        await help.tap();
        await tooltip.waitFor();
        const box = (await tooltip.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(8);
        expect(box.x + box.width).toBeLessThanOrEqual(382);
        expect(box.y + box.height).toBeLessThanOrEqual(836);
        expect(
          await tooltip.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
            );
          }),
        ).toBe(true);
        await help.tap();
        await expect.poll(() => tooltip.isVisible()).toBe(false);
        await help.tap();
        await tooltip.waitFor();
        await page.keyboard.press("Escape");
        await expect.poll(() => tooltip.isVisible()).toBe(false);
        expect(await drawer.isVisible()).toBe(true);
        await help.tap();
        await tooltip.waitFor();
        await drawer.getByRole("heading", { name: "Designs", exact: true }).tap();
        await expect.poll(() => tooltip.isVisible()).toBe(false);
        await help.tap();
        await tooltip.waitFor();
        await page.setViewportSize({ width: 390, height: 740 });
        await expect.poll(() => tooltip.isVisible()).toBe(false);
        await drawer.getByRole("button", { name: "Close sidebar", exact: true }).tap();
      }
    } finally {
      await context.close();
    }
  });

  it("fills the viewport and resizes the preview with pointer and keyboard controls without changing the design or reloading its iframe", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await waitForCanvas(page);
    const size = page.locator(".canvas-navigation").getByRole("combobox", { name: "Canvas size" });
    const save = page.getByRole("button", { name: "Save", exact: true });
    expect((await size.boundingBox())!.y).toBeGreaterThan((await save.boundingBox())!.y);
    expect(await page.getByLabel("Starting point").count()).toBe(0);
    expect(await page.getByLabel("Design appearance").count()).toBe(0);
    const divider = page.getByRole("separator", { name: "Resize preview" });
    const frame = page.locator('iframe[title="Design preview"]');
    const originalDimensions = await frame.evaluate((element) => ({
      width: element.style.width,
      height: element.style.height,
    }));
    await page
      .frameLocator('iframe[title="Design preview"]')
      .locator("h1")
      .evaluate((element) => element.setAttribute("data-resize-check", "preserved"));
    const before = (await frame.boundingBox())!.height;
    const canvas = page.getByLabel("Artboard canvas", { exact: true });
    const canvasBefore = (await canvas.boundingBox())!.height;
    const editorsBefore = (await page.locator(".source-editors").boundingBox())!.height;
    const handle = (await divider.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 100, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await canvas.boundingBox())!.height)
      .toBeLessThan(canvasBefore - 90);
    expect((await frame.boundingBox())!.height).toBeLessThan(before);
    expect((await page.locator(".source-editors").boundingBox())!.height).toBeGreaterThan(
      editorsBefore + 90,
    );
    expect(
      await page
        .frameLocator('iframe[title="Design preview"]')
        .locator("h1")
        .getAttribute("data-resize-check"),
    ).toBe("preserved");
    expect(
      await frame.evaluate((element) => ({
        width: element.style.width,
        height: element.style.height,
      })),
    ).toEqual(originalDimensions);
    await divider.press("End");
    expect(await divider.getAttribute("aria-valuenow")).toBe("80");
    await divider.press("Home");
    expect(await divider.getAttribute("aria-valuenow")).toBe("20");
    await divider.press("ArrowDown");
    expect(await divider.getAttribute("aria-valuenow")).toBe("22");
    await divider.dblclick();
    expect(await divider.getAttribute("aria-valuenow")).toBe("55");
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    expect(await divider.getAttribute("aria-valuenow")).toBe("55");
    const panes = await page.locator(".source-editor").evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        const scroller = element.querySelector(".cm-scroller");
        return { bottom: box.bottom, scrollHeight: scroller?.clientHeight ?? 0 };
      }),
    );
    const footerTop = (await page.getByRole("contentinfo").boundingBox())!.y;
    expect(
      panes.every((pane) => Math.abs(pane.bottom - footerTop) < 1 && pane.scrollHeight > 0),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await context.close();
  });

  it("resizes with touch without scrolling the page and keeps stacked editors usable on short mobile viewports", async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await waitForCanvas(page);
    const divider = page.getByRole("separator", { name: "Resize preview" });
    const handle = (await divider.boundingBox())!;
    const session = await context.newCDPSession(page);
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 100, id: 1 }],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect
      .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
      .toBeLessThan(50);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await session.detach();
    for (const height of [844, 360]) {
      await page.setViewportSize({ width: 320, height });
      await expect
        .poll(() =>
          page
            .locator(".cm-scroller")
            .evaluateAll((elements) => elements.every((element) => element.clientHeight > 0)),
        )
        .toBe(true);
      const panes = await page.locator(".source-editor").evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { y: box.y, bottom: box.bottom, width: box.width };
        }),
      );
      expect(panes[0]!.y).toBeLessThan(panes[1]!.y);
      expect(panes[1]!.y).toBeLessThan(panes[2]!.y);
      expect(
        Math.abs(panes[2]!.bottom - (await page.getByRole("contentinfo").boundingBox())!.y),
      ).toBeLessThan(1);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollHeight <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await context.close();
  });

  it("adapts the preview grid to site appearance while JSON controls only the design theme and errors remain internally bounded", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await waitForCanvas(page);
    const grid = () =>
      page.locator(".studio-canvas").evaluate((element) => ({
        image: getComputedStyle(element).backgroundImage,
        color: getComputedStyle(element).backgroundColor,
      }));
    await page.getByRole("button", { name: "Day", exact: true }).click();
    const first = await grid();
    expect(first.image).toContain("linear-gradient");
    await page.getByRole("button", { name: "Night", exact: true }).click();
    // The Day/Night reveal applies the class inside a view transition, after the click resolves.
    await expect.poll(() => page.locator("html").getAttribute("class")).toContain("dark");
    const dark = await grid();
    expect(dark.color).not.toBe(first.color);
    expect(dark.image).not.toBe(first.image);
    await editTemplate(page, (manifest) => {
      manifest.defaultTheme = "custom";
      manifest.themes.custom = { ...manifest.themes.paper!, background: "#123456" };
    });
    await waitForCanvas(page);
    await expect
      .poll(() =>
        page
          .frameLocator('iframe[title="Design preview"]')
          .locator("main")
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe("rgb(18, 52, 86)");
    expect(await grid()).toEqual(dark);
    await setSource(page, "JSON", "{ unfinished");
    await page.getByRole("alert").filter({ hasText: /JSON/ }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
      true,
    );
    await context.close();
  });

  it("places three highlighted editors below the preview and preserves independent undo across edits and Library visits", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await waitForCanvas(page);
    expect(await page.getByLabel("Editor view").count()).toBe(0);
    const panels = await page.locator(".source-editor").evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width } = element.getBoundingClientRect();
        const colors = new Set(
          Array.from(element.querySelectorAll(".cm-content span")).map(
            (span) => getComputedStyle(span).color,
          ),
        );
        return { x, y, width, colors: colors.size };
      }),
    );
    expect(panels).toHaveLength(3);
    expect(
      panels.every(
        (panel) =>
          Math.abs(panel.y - panels[0]!.y) < 1 &&
          Math.abs(panel.width - panels[0]!.width) < 1 &&
          panel.colors > 1,
      ),
    ).toBe(true);
    expect(panels[0]!.x).toBeLessThan(panels[1]!.x);
    expect(panels[1]!.x).toBeLessThan(panels[2]!.x);
    const canvas = await page.locator(".studio-canvas").boundingBox();
    expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(panels[0]!.y);
    const html = "<main><h1>{{ headline }}</h1></main>";
    const css = "main { color: #123456; padding: 40px; }";
    await setSource(page, "HTML", html);
    await setSource(page, "CSS", css);
    await editTemplate(page, (manifest) => {
      manifest.sampleData.headline = "Written from JSON.";
    });
    await waitForCanvas(page, "Written from JSON.");
    expect((await downloadSource(page, "HTML / Liquid source")).text).toBe(html);
    expect((await downloadSource(page, "CSS source")).text).toBe(css);
    const editor = page.getByRole("textbox", { name: "Template HTML", exact: true });
    await editor.click();
    await editor.press("ControlOrMeta+z");
    await page.frameLocator('iframe[title="Design preview"]').locator(".eyebrow").waitFor();
    await waitForCanvas(page, "Written from JSON.");
    expect((await downloadSource(page, "CSS source")).text).toBe(css);
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await editor.click();
    await editor.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
    await waitForCanvas(page, "Written from JSON.");
    expect((await downloadSource(page, "HTML / Liquid source")).text).toBe(html);
    expect(
      await page.frameLocator('iframe[title="Design preview"]').locator(".eyebrow").count(),
    ).toBe(0);
    await context.close();
  });

  it("supports menu keyboard navigation, focus restoration, outside clicks, and constrained mobile placement", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await waitForCanvas(page);
    const trigger = page.getByRole("button", { name: "More", exact: true });
    const activeName = () => page.evaluate(() => document.activeElement?.textContent?.trim());
    await trigger.focus();
    await trigger.press("ArrowDown");
    await expect.poll(activeName).toBe("PNG image");
    await page.keyboard.press("End");
    await expect.poll(activeName).toBe("Safe area guides");
    await page.keyboard.press("Home");
    await expect.poll(activeName).toBe("PNG image");
    await page.keyboard.press("ArrowUp");
    await expect.poll(activeName).toBe("Safe area guides");
    await page.keyboard.press("Escape");
    expect(await page.getByRole("menu").count()).toBe(0);
    expect(await trigger.evaluate((button) => button === document.activeElement)).toBe(true);
    await trigger.press("ArrowUp");
    await expect.poll(activeName).toBe("Safe area guides");
    await page.keyboard.press("Escape");
    await trigger.click();
    await page.getByLabel("Design title", { exact: true }).click();
    expect(await page.getByRole("menu").count()).toBe(0);
    expect(
      await page
        .getByLabel("Design title", { exact: true })
        .evaluate((input) => input === document.activeElement),
    ).toBe(true);
    await trigger.click();
    await page.keyboard.press("Tab");
    expect(await page.getByRole("menu").count()).toBe(0);
    expect(
      await page
        .getByRole("region", { name: "Artboard canvas" })
        .evaluate((select) => select === document.activeElement),
    ).toBe(true);
    await page.setViewportSize({ width: 320, height: 360 });
    await trigger.click();
    const bounds = await page.getByRole("menu").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(360);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await trigger.click();
    expect(
      await page
        .getByRole("menuitemcheckbox", { name: "Safe area guides" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await context.close();
  });

  it("restores raw v2 recovery JSON and exports current examples without dirtying saved designs", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await waitForCanvas(page);
    const entry = await page.evaluate((key) => {
      const entry = JSON.parse(localStorage.getItem(key) ?? "[]")[0];
      entry.pageJson = { [entry.document.pages[0].id]: "{ unfinished JSON" };
      entry.document.title = "A current draft";
      entry.document.pages[0].data.headline = "Existing saved content.";
      localStorage.setItem(key, JSON.stringify([entry]));
      return entry;
    }, DESIGN_HISTORY_KEY);
    await page.goto(`${site.baseUrl}/local/${entry.id}`);
    await page.getByRole("alert").filter({ hasText: /JSON/ }).waitFor();
    const recovery = await downloadSource(page, "Download design JSON");
    const rawRecovery = JSON.parse(recovery.text);
    expect(rawRecovery.pageJson[rawRecovery.document.pages[0].id]).toContain("{ unfinished JSON");
    expect(JSON.parse(recovery.text)).not.toHaveProperty("editKey");
    await page.goto(`${site.baseUrl}/studio`);
    await waitForCanvas(page);
    await page.getByLabel("Import design JSON").setInputFiles({
      name: "recovery.json",
      mimeType: "application/json",
      buffer: Buffer.from(recovery.text),
    });
    await expect
      .poll(() => page.getByLabel("Design title", { exact: true }).inputValue())
      .toBe("A current draft");
    expect(JSON.parse((await downloadSource(page, "Download design JSON")).text).pageJson).toEqual(
      rawRecovery.pageJson,
    );
    await setSource(
      page,
      "JSON",
      createTemplateJson(artboardDocument(entry.document.pages[0], entry.document.size)),
    );
    await waitForCanvas(page, "Existing saved content.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9a-f-]+$/);
    await page.reload();
    await waitForCanvas(page, "Existing saved content.");
    expect(await page.locator(".save-caption").textContent()).toBe("Unclaimed design");
    const exported = JSON.parse((await downloadSource(page, "Template JSON")).text);
    expect(exported.sampleData.headline).toBe("Existing saved content.");
    const saved = JSON.parse((await downloadSource(page, "Download design JSON")).text);
    expect(saved.pages[0].template.manifest.sampleData.headline).toBe("Less, but better.");
    await context.close();
  });

  it("uses the JSON theme and header size when importing a standalone MCP manifest", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await waitForCanvas(page);
    const exported = await downloadSource(page, "Template JSON");
    const manifest = JSON.parse(exported.text);
    manifest.defaultTheme = "custom";
    manifest.themes = { custom: manifest.themes.paper };
    manifest.defaultSize = "x";
    manifest.supportedSizes = ["x"];
    manifest.sampleData.headline = "Imported MCP contract.";
    const pendingChooser = page.waitForEvent("filechooser");
    await chooseAction(page, "Import JSON");
    await (
      await pendingChooser
    ).setFiles({
      name: "template.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(manifest)),
    });
    await page
      .getByRole("alert")
      .filter({ hasText: /theme|size/ })
      .waitFor();
    await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "x");
    await waitForCanvas(page, "Imported MCP contract.");
    expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    await context.close();
  });

  it("preserves a raw JSON draft as a recoverable copy when the saved revision advances without changing the document", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await waitForCanvas(page);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9a-f-]+$/);
    await waitForCanvas(page);
    const id = page.url().split("/").pop()!;
    await setSource(page, "JSON", "{ pending source edit");
    await site.db.collection("designs").doc(id).update({ revision: 2 });
    await page.reload();
    await waitForCanvas(page);
    await page.getByRole("button", { name: /Recover it as a copy/ }).click();
    await page.waitForURL(/\/local\//);
    await showSourceEditors(page);
    await expect
      .poll(() => page.getByLabel("Template JSON").innerText())
      .toBe("{ pending source edit");
    const rawRecovery = JSON.parse((await downloadSource(page, "Download design JSON")).text);
    expect(rawRecovery.pageJson[rawRecovery.document.pages[0].id]).toBe("{ pending source edit");
    await context.close();
  });

  it("authors a custom template, saves a public link, restores guest history, forks as a visitor, and claims once", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${site.baseUrl}/studio`);
    await waitForCanvas(page);
    await page.getByLabel("Design title", { exact: true }).fill("Room for a thought");
    await setSource(
      page,
      "HTML",
      '<main class="my-layout"><h1 data-tt-slot="headline">{{ headline }}</h1><p>{{ body }}</p></main>',
    );
    await setSource(
      page,
      "CSS",
      ".my-layout { padding: 10%; height: 100%; display: flex; flex-direction: column; justify-content: center; } h1 { font: 80px Georgia; } p { font-size: 30px; margin-top: 50px; }",
    );
    await editTemplate(page, (manifest) => {
      manifest.slots.headline!.label = "Heading";
      manifest.sampleData.headline = "Hello, whitespace.";
    });
    await waitForCanvas(page, "Hello, whitespace.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9a-f-]+$/);
    await waitForCanvas(page, "Hello, whitespace.");
    const publicUrl = page.url();
    const id = publicUrl.split("/").pop()!;
    const history = JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY)) ?? "[]",
    );
    expect(history[0]).toMatchObject({ id, saved: true });
    expect(history[0].editKey).toMatch(/^[0-9a-f]{64}$/);
    expect(publicUrl).not.toContain(history[0].editKey);
    await page.reload();
    await waitForCanvas(page, "Hello, whitespace.");
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
      "Room for a thought",
    );

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(publicUrl);
    await waitForCanvas(visitor, "Hello, whitespace.");
    expect(await visitor.getByRole("button", { name: "Save copy", exact: true }).count()).toBe(1);
    expect(await visitor.getByRole("button", { name: /claim this design/i }).count()).toBe(0);
    await visitor.getByRole("button", { name: "More", exact: true }).click();
    expect(await visitor.getByRole("menuitem", { name: /claim/i }).count()).toBe(0);
    await visitor.keyboard.press("Escape");
    await editTemplate(visitor, (manifest) => {
      manifest.sampleData.headline = "A different thought.";
    });
    await visitor.getByRole("button", { name: "Save copy", exact: true }).click();
    await expect.poll(() => visitor.url()).not.toBe(publicUrl);
    await visitor.waitForURL(/\/d\/[0-9a-f-]+$/);
    expect((await site.design(id)).document.pages[0]?.data.headline).toBe("Hello, whitespace.");
    await visitorContext.close();

    const owner = await site.signIn(page);
    await page.reload();
    await waitForCanvas(page, "Hello, whitespace.");
    await editTemplate(page, (manifest) => {
      manifest.sampleData.headline = "Claim my latest edits.";
    });
    await chooseAction(page, "Claim this design");
    await expect
      .poll(async () => (await site.db.collection("designs").doc(id).get()).data())
      .toMatchObject({ owner_id: owner.uid, guest_key_hash: null });
    await expect
      .poll(async () =>
        JSON.parse(
          (await page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY)) ?? "[]",
        ).some((entry: { id: string }) => entry.id === id),
      )
      .toBe(false);
    await page.reload();
    await waitForCanvas(page, "Claim my latest edits.");
    await page.getByRole("button", { name: "More", exact: true }).click();
    expect(await page.getByRole("menuitem", { name: /Claim this design/i }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await editTemplate(page, (manifest) => {
      manifest.sampleData.headline = "Claimed, and still editable.";
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(async () => (await site.design(id)).document.pages[0]?.data.headline)
      .toBe("Claimed, and still editable.");
    expect(errors).toEqual([]);
    await context.close();
  });

  it("keeps new required JSON fields editable while content is invalid and roundtrips unfinished recovery exports", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${site.baseUrl}/studio`);
    await waitForCanvas(page);
    await editTemplate(page, (manifest) => {
      manifest.slots.note = {
        type: "string",
        label: "New note",
        description: "A required new field.",
        required: true,
      };
    });
    await page.getByRole("alert").filter({ hasText: /note/ }).waitFor();
    await editTemplate(page, (manifest) => {
      manifest.sampleData.note = "Now complete.";
    });
    await waitForCanvas(page);
    expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    await page.getByLabel("Design title", { exact: true }).fill("");
    await setSource(page, "HTML", "");
    await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "custom");
    await page.getByLabel("Custom width", { exact: true }).fill("0");
    const pendingDownload = page.waitForEvent("download");
    await chooseAction(page, "Download design JSON");
    const download = await pendingDownload;
    const path = await download.path();
    if (!path) throw new Error("Recovery download was not created.");
    const recovery = await readFile(path, "utf8");
    expect(JSON.parse(recovery).document.title).toBe("");
    await page.goto(`${site.baseUrl}/studio`);
    await waitForCanvas(page);
    await page.getByLabel("Import design JSON", { exact: true }).setInputFiles({
      name: "recovery.json",
      mimeType: "application/json",
      buffer: Buffer.from(recovery),
    });
    await expect.poll(() => page.getByLabel("Design title", { exact: true }).inputValue()).toBe("");
    expect((await page.getByLabel("Template HTML", { exact: true }).innerText()).trim()).toBe("");
    expect(await page.getByLabel("Custom width", { exact: true }).inputValue()).toBe("0");
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await context.close();
  });

  it("returns from sign-in only to valid same-site pages, even for malformed callback paths", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await site.signIn(page);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    for (const next of ["/studio", "https://outside.invalid", "http://[", "/auth/callback"]) {
      await page.goto(`${site.baseUrl}/auth/callback?next=${encodeURIComponent(next)}`);
      await page.waitForURL(`${site.baseUrl}${next === "/studio" ? "/studio" : "/"}`);
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  it("keeps invalid schema editable, restores browser drafts, and blocks invalid saves", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${site.baseUrl}/studio`);
    await waitForCanvas(page);
    await page.getByLabel("Design title", { exact: true }).fill("An unfinished thought");
    await setSource(page, "JSON", "{ unfinished");
    await page.getByRole("alert").filter({ hasText: /JSON/ }).waitFor();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    const entries = JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY)) ?? "[]",
    );
    const entry = entries.find(
      (candidate: { document: { title: string } }) =>
        candidate.document.title === "An unfinished thought",
    );
    expect(entry.pageJson[entry.document.pages[0].id]).toBe("{ unfinished");
    expect(await page.getByLabel("Starting point").count()).toBe(0);
    expect(await page.getByLabel("Template JSON").innerText()).toBe("{ unfinished");
    await page.goto(`${site.baseUrl}/local/${entry.id}`);
    await showSourceEditors(page);
    expect(await page.getByLabel("Template JSON").innerText()).toBe("{ unfinished");
    await setSource(
      page,
      "JSON",
      createTemplateJson(artboardDocument(entry.document.pages[0], entry.document.size)),
    );
    await waitForCanvas(page);
    await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "custom");
    await page.getByLabel("Custom width", { exact: true }).fill("");
    await page.getByRole("alert").filter({ hasText: /size/ }).waitFor();
    expect(await page.getByLabel("Custom width", { exact: true }).inputValue()).toBe("0");
    await page.getByLabel("Custom width", { exact: true }).fill("1080");
    await waitForCanvas(page);
    await context.close();
  });

  it("offers password and Google sign-in while preserving the current design", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${site.baseUrl}/`);
    await waitForCanvas(page);
    await page.getByRole("button", { name: /Sign in \/ Create account/ }).click();
    const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
    expect(await dialog.getByLabel("Email address").isVisible()).toBe(true);
    expect(await dialog.getByLabel("Password", { exact: true }).isVisible()).toBe(true);
    expect(await dialog.getByRole("button", { name: "Continue with Google" }).isVisible()).toBe(
      true,
    );
    expect(await dialog.getByRole("button", { name: "Sign in", exact: true }).isVisible()).toBe(
      true,
    );
    await page.getByRole("button", { name: "Close account dialog" }).click();
    await context.close();
  });

  it("reports missing render configuration without manufacturing media while local authoring and recovery exports still work", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await waitForCanvas(page);
    await site.signIn(page);
    await chooseAction(page, "PNG image");
    await page
      .getByRole("alert")
      .filter({ hasText: /VITE_TINYTLDR_API_URL/ })
      .waitFor();
    expect(
      await page
        .getByRole("status")
        .filter({ hasText: /saved to My Library/ })
        .count(),
    ).toBe(0);
    const downloaded = page.waitForEvent("download");
    await chooseAction(page, "Download design JSON");
    expect((await downloaded).suggestedFilename()).toBe("design.json");
    await page.getByRole("button", { name: "My Library", exact: true }).click();
    await page.getByText("A little room for your finished work.", { exact: true }).waitFor();
    expect(await page.locator(".media-card").count()).toBe(0);
    await context.close();
  });

  it("opens straight into one workspace, shows welcome only once, and can reopen it without losing edits", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${site.baseUrl}/`);
    const welcome = page.getByRole("dialog", { name: "Welcome to tinytldr." });
    await welcome.waitFor();
    expect(await page.getByLabel("Design toolbar", { exact: true }).count()).toBe(1);
    await welcome.getByRole("button", { name: "Start Creating" }).click();
    await waitForCanvas(page);
    await page.getByLabel("Design title", { exact: true }).fill("My own space");
    await page.getByRole("button", { name: "Welcome", exact: true }).click();
    await welcome.waitFor();
    await page.keyboard.press("Escape");
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
      "My own space",
    );
    expect(await page.locator(".design-list-item.is-current").textContent()).toContain(
      "My own space",
    );
    await page.reload();
    await expect
      .poll(() => page.frameLocator('iframe[title="Design preview"]').locator("h1").textContent())
      .toContain("Less, but better.");
    expect(await welcome.isVisible()).toBe(false);
    await page.goto(`${site.baseUrl}/designs`);
    await waitForCanvas(page);
    expect(await page.getByLabel("Design title", { exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole("complementary", { name: "Your designs" }).isVisible()).toBe(true);
    expect(await page.locator("header").count()).toBe(1);
    await context.close();
  });

  it("anchors agent and account cards below Designs and opens setup and documentation without replacing the editor", async () => {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    await page.goto(`${site.baseUrl}/`);
    await waitForCanvas(page);
    await page.getByLabel("Design title", { exact: true }).fill("Keep this draft");
    const card = page.getByRole("button", { name: "Connect an Agent" });
    const bounds = await card.boundingBox();
    const guestHeading = await page.getByRole("heading", { name: "This browser" }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThan(guestHeading!.y);
    const account = await page
      .getByRole("button", { name: /Sign in \/ Create account/ })
      .boundingBox();
    expect(account!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height);
    expect(account!.y + account!.height).toBeGreaterThan(
      (await page.getByRole("contentinfo").boundingBox())!.y - 25,
    );
    expect(
      await page
        .locator("header")
        .getByRole("button", { name: /Sign in|Account/ })
        .count(),
    ).toBe(0);
    await card.click();
    const setup = page.getByRole("dialog", { name: "Bring your agent." });
    await setup.waitFor();
    expect(await setup.locator("code").first().textContent()).toBe("https://mcp.tinytldr.com/mcp");
    expect(await setup.getByRole("combobox", { name: "MCP client" }).count()).toBe(0);
    await setup.getByRole("button", { name: "Copy", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("https://mcp.tinytldr.com/mcp");
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("Clipboard disabled");
      };
    });
    await setup.getByRole("button", { name: "Copy", exact: true }).click();
    await setup.getByRole("alert").filter({ hasText: "Clipboard disabled" }).waitFor();
    await setup.getByRole("button", { name: "Read the documentation" }).click();
    const docs = page.getByRole("dialog", { name: "Documentation" });
    await docs.getByRole("heading", { name: "Quickstart with Claude Code & Codex" }).waitFor();
    await docs
      .locator("code")
      .filter({ hasText: "codex mcp add tinytldr --url https://mcp.tinytldr.com/mcp" })
      .waitFor();
    await docs
      .locator("code")
      .filter({ hasText: "claude mcp add --transport http tinytldr" })
      .waitFor();
    await docs.getByRole("button", { name: "Template Authoring", exact: true }).click();
    await docs.getByRole("heading", { name: "Template Authoring Guide" }).waitFor();
    await docs.getByRole("button", { name: "Close guide" }).click();
    expect(page.url()).toBe(`${site.baseUrl}/`);
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
      "Keep this draft",
    );
    await context.close();
  });

  it("uses the same sidebar as an accessible mobile drawer for designs, welcome, and MCP setup", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${site.baseUrl}/`);
    await waitForCanvas(page);
    await page.getByLabel("Design title", { exact: true }).fill("First canvas");
    await page.getByRole("button", { name: "Open sidebar" }).click();
    const drawer = page.getByRole("dialog", { name: "Your designs menu" });
    await drawer.waitFor();
    await page.keyboard.press("Escape");
    expect(await drawer.isVisible()).toBe(false);
    expect(
      await page
        .getByRole("button", { name: "Open sidebar" })
        .evaluate((button) => button === document.activeElement),
    ).toBe(true);
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await drawer.getByRole("button", { name: "New design", exact: true }).click();
    await waitForCanvas(page);
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
      "Untitled design",
    );
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await drawer.getByRole("button", { name: "First canvas", exact: true }).click();
    await page.waitForURL(/\/local\//);
    await waitForCanvas(page);
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
      "First canvas",
    );
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await drawer.getByRole("button", { name: "About tinytldr", exact: true }).click();
    await page.getByRole("dialog", { name: "Welcome to tinytldr." }).waitFor();
    expect(await drawer.isVisible()).toBe(false);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await drawer.getByRole("button", { name: "Connect an Agent" }).click();
    await page.getByRole("dialog", { name: "Bring your agent." }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    expect(await page.getByRole("complementary", { name: "Your designs" }).isVisible()).toBe(true);
    expect(await page.locator("header").count()).toBe(1);
    await context.close();
  });

  it("sanitizes personal markup and blocks remote resources while retaining the trusted preview runtime", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const remoteRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("untrusted.invalid")) remoteRequests.push(request.url());
    });
    await page.goto(`${site.baseUrl}/studio`);
    await waitForCanvas(page);
    await setSource(
      page,
      "HTML",
      '<main><h1>Safe preview</h1><script>window.parent.postMessage("unsafe","*")</script><img src="https://untrusted.invalid/track" onerror="alert(1)"><iframe src="https://untrusted.invalid"></iframe></main>',
    );
    await waitForCanvas(page, "Safe preview");
    const frame = page.frameLocator('iframe[title="Design preview"]');
    expect(await frame.locator("script:not([nonce])").count()).toBe(0);
    expect(await frame.locator("[onerror], iframe").count()).toBe(0);
    expect(await frame.locator("meta[http-equiv='Content-Security-Policy']").count()).toBe(1);
    expect(remoteRequests).toEqual([]);
    await context.close();
  });

  it("surfaces corrupt or blocked localStorage without deleting history or losing the editor", async () => {
    const context = await browser.newContext();
    await context.addInitScript((key) => {
      if (window.top === window) localStorage.setItem(key, "{corrupt");
    }, DESIGN_HISTORY_KEY);
    const page = await context.newPage();
    await page.goto(`${site.baseUrl}/studio`);
    await waitForCanvas(page);
    await page.getByRole("alert").filter({ hasText: "Browser history" }).waitFor();
    expect(await page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY)).toBe(
      "{corrupt",
    );
    await context.close();
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => {
      if (window.top === window)
        Storage.prototype.setItem = () => {
          throw new Error("Storage disabled");
        };
    });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(`${site.baseUrl}/studio`);
    await waitForCanvas(blockedPage);
    await blockedPage.getByRole("alert").filter({ hasText: "Storage disabled" }).waitFor();
    await blocked.close();
  });

  it("keeps desktop and mobile layouts within the viewport in light and dark modes", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const mode of ["light", "dark"]) {
        await page.goto(`${site.baseUrl}/studio`);
        await waitForCanvas(page);
        await page
          .getByRole("button", { name: mode === "light" ? "Day" : "Night", exact: true })
          .click();
        await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "x");
        await waitForCanvas(page);
        const size = await page.evaluate(() => ({
          actual: document.documentElement.scrollWidth,
          viewport: innerWidth,
        }));
        expect(size.actual).toBeLessThanOrEqual(size.viewport);
        const actions = await page.locator(".workspace-actions").boundingBox();
        const title = await page.locator(".header-title").boundingBox();
        expect(title!.x + title!.width).toBeLessThanOrEqual(width);
        expect(actions!.x + actions!.width).toBeLessThanOrEqual(width);
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),
        ).toBe(true);
        const allWidth = await page
          .locator('iframe[title="Design preview"]')
          .evaluate((iframe) => iframe.getBoundingClientRect().width);
        expect(allWidth).toBeLessThan(width);
        if (width <= 390) {
          await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "custom");
          await page.getByLabel("Custom width", { exact: true }).fill("4096");
          await page.getByLabel("Custom height", { exact: true }).fill("4096");
          await waitForCanvas(page);
          const canvas = await page.locator('iframe[title="Design preview"]').boundingBox();
          const container = await page
            .getByRole("region", { name: "Artboard canvas" })
            .boundingBox();
          expect(canvas?.width).toBeLessThanOrEqual(container?.width ?? 0);
        }
      }
    }
    await context.close();
  });
});
