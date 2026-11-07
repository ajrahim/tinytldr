import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { projectFromDocument } from "@tinytldr/core";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import { setSource, downloadSource, showSourceEditors } from "./SourceEditorFixture.js";
import { createBlankDocument } from "../src/lib/WorkspaceTemplates.js";
import { DESIGN_HISTORY_KEY } from "../src/lib/DesignHistory.js";
import { chooseDropdown } from "./DropdownFixture.js";

describe.skipIf(!hasFirebaseEmulators)("Compact icon header and editable saved versions", () => {
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
  async function open(page: Page, path = "", revealEditors = true) {
    await page.goto(`${site.baseUrl}${path}`);
    await page
      .getByRole("dialog", { name: "Welcome to tinytldr." })
      .getByRole("button", { name: "Start Creating" })
      .click();
    if (revealEditors) await showSourceEditors(page);
    else await page.getByRole("region", { name: "Artboard canvas" }).waitFor();
  }
  async function save(page: Page) {
    const response = page.waitForResponse(
      (result) =>
        result.url() === site.apiUrl &&
        result.request().method() === "POST" &&
        result.request().postDataJSON().action === "save",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await page.waitForURL(/\/d\/[0-9a-f-]+$/);
    await expect.poll(() => page.locator(".save-caption").textContent()).toBe("Unclaimed design");
  }
  async function versions(page: Page) {
    await page.getByRole("button", { name: "Versions", exact: true }).click();
    return page.getByRole("dialog", { name: "Saved versions", exact: true });
  }

  it("keeps the labeled header, hidden-by-default editors, and bottom bar inside desktop and narrow mobile viewports", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page, "", false);
    expect(
      await page
        .getByRole("button", { name: "Source editors", exact: true })
        .evaluate(
          (button) => !!document.getElementById(button.getAttribute("aria-controls") ?? ""),
        ),
    ).toBe(true);
    expect(await page.getByLabel("Template HTML", { exact: true }).isVisible()).toBe(false);
    expect(await page.getByRole("separator", { name: "Resize preview" }).isVisible()).toBe(false);
    await page
      .getByLabel("Design title", { exact: true })
      .fill("A long title that must shrink instead of wrapping the toolbar controls");
    for (const theme of ["Day", "Night"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const header = page.locator('header[aria-label="Design toolbar"]');
        await expect.poll(async () => (await header.boundingBox())!.y).toBe(0);
        const bounds = (await header.boundingBox())!;
        expect(bounds.height).toBeLessThanOrEqual(48.1);
        const controls = [
          ...["Save", "Versions", "More"].map((name) =>
            page.getByRole("button", { name, exact: true }),
          ),
        ];
        const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
        for (const [index, box] of boxes.entries()) {
          expect(box!.height).toBe(32);
          expect(box!.y).toBe(boxes[0]!.y);
          if (index) expect(box!.x).toBeGreaterThan(boxes[index - 1]!.x);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        }
        for (const name of ["Save", "Versions", "More"])
          expect(
            await page.getByRole("button", { name, exact: true }).locator("svg").isVisible(),
          ).toBe(true);
        for (const name of ["Source editors", "Save", "Versions", "More"])
          expect(
            await page.getByRole("button", { name, exact: true }).getAttribute("title"),
          ).toBeTruthy();
        expect(
          await header.getByRole("button", { name: "Source editors", exact: true }).count(),
        ).toBe(0);
        expect(
          await header.getByRole("combobox", { name: "Canvas size", exact: true }).count(),
        ).toBe(0);
        const navigation = page.locator(".canvas-navigation");
        const navigationBounds = (await navigation.boundingBox())!;
        expect(navigationBounds.x).toBeGreaterThanOrEqual(0);
        expect(navigationBounds.x + navigationBounds.width).toBeLessThanOrEqual(width);
        const canvasControls = [
          navigation.getByRole("button", { name: "Prompt history", exact: true }),
          navigation.getByRole("button", { name: "Source editors", exact: true }),
          navigation.getByRole("combobox", { name: "Canvas size", exact: true }),
        ];
        const canvasBoxes = await Promise.all(
          canvasControls.map((control) => control.boundingBox()),
        );
        for (const [index, box] of canvasBoxes.entries()) {
          expect(box!.y).toBeGreaterThan(bounds.y + bounds.height);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          if (index)
            expect(box!.x).toBeGreaterThanOrEqual(
              canvasBoxes[index - 1]!.x + canvasBoxes[index - 1]!.width,
            );
        }
        expect(
          await navigation.locator(".canvas-editor-control").evaluateAll((elements) =>
            elements.map((element) => {
              const css = getComputedStyle(element);
              return { width: css.borderLeftWidth, style: css.borderLeftStyle };
            }),
          ),
        ).toEqual([
          { width: "1px", style: "solid" },
          { width: "1px", style: "solid" },
        ]);
        expect(await page.locator(".header-save-button .header-action-label").innerText()).toBe(
          "Save",
        );
        expect(
          await page.locator(".version-history-trigger .header-action-label").innerText(),
        ).toBe("Latest");
        expect(
          await page
            .getByLabel("Design title", { exact: true })
            .evaluate((el) => getComputedStyle(el).fontSize),
        ).toBe("14px");
        const sidebarToggle = (await page.locator(".sidebar-toggle").boundingBox())!;
        const title = (await page.getByLabel("Design title", { exact: true }).boundingBox())!;
        expect(sidebarToggle.x + sidebarToggle.width).toBeLessThanOrEqual(title.x);
        const footer = (await page.getByRole("contentinfo").boundingBox())!;
        expect(footer).toMatchObject({ x: 0, width, height: 48, y: 852 });
        const preview = (await page.locator(".preview-split-preview").boundingBox())!;
        expect(preview.y + preview.height).toBe(footer.y);
        expect(
          await page.locator(".save-caption").evaluate((el) => getComputedStyle(el).position),
        ).toBe("absolute");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(
          0,
        );
      }
    }
    await chooseDropdown(page.getByRole("combobox", { name: "Canvas size" }), "story");
    expect(await page.locator(".canvas-size-control").getAttribute("title")).toContain(
      "Story / Reel",
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    const picker = await versions(page);
    await page.setViewportSize({ width: 320, height: 900 });
    await expect
      .poll(async () => {
        const bounds = (await picker.boundingBox())!;
        return bounds.x >= 7.9 && bounds.x + bounds.width <= 312.1;
      })
      .toBe(true);
    expect(await picker.getByRole("button", { name: /^Latest/ }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(await picker.innerText()).toContain("Save this design to start");
    await page.keyboard.press("Escape");
    expect(
      await page
        .getByRole("button", { name: "Versions", exact: true })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await page.getByRole("button", { name: "More", exact: true }).click();
    expect(await page.getByRole("menuitem", { name: "PNG image" }).isVisible()).toBe(true);
    await context.close();
  });

  it("keeps footer resources and persisted Day/Night appearance available while the desktop sidebar is collapsed", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await open(page, "", false);
    const footer = page.getByRole("contentinfo", { name: "Site footer" });
    const github = footer.getByRole("link", { name: "GitHub", exact: true });
    expect(await github.getAttribute("href")).toBe("https://github.com/ajrahim/tinytldr");
    expect(await github.getAttribute("target")).toBe("_blank");
    expect(await github.getAttribute("rel")).toBe("noreferrer");
    await context.route("https://github.com/ajrahim/tinytldr", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>tinytldr repository</title>" }),
    );
    const [repository] = await Promise.all([page.waitForEvent("popup"), github.click()]);
    await repository.waitForLoadState("domcontentloaded");
    expect(repository.url()).toBe("https://github.com/ajrahim/tinytldr");
    await repository.close();
    expect(await page.locator(".sidebar-help").count()).toBe(0);
    expect(await page.getByRole("link", { name: /^MIT/ }).count()).toBe(0);
    await page.getByLabel("Design title", { exact: true }).fill("Keep this footer draft");
    await page
      .frameLocator('iframe[title="Design preview"]')
      .locator("h1")
      .evaluate((node) => node.setAttribute("data-sidebar-check", "preserved"));
    await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
    expect(await page.getByRole("complementary", { name: "Your designs" }).isVisible()).toBe(false);
    expect(
      (await page.getByRole("region", { name: "Design workspace", exact: true }).boundingBox())!.x,
    ).toBe(0);
    await footer.getByRole("button", { name: "Welcome", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Welcome to tinytldr." })
      .getByRole("button", { name: "Start Creating" })
      .click();
    await footer.getByRole("button", { name: "MCP", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Bring your agent." })
      .getByRole("button", { name: "Read the documentation" })
      .click();
    await page
      .getByRole("dialog", { name: "Documentation" })
      .getByRole("heading", { name: "Quickstart with Claude Code & Codex" })
      .waitFor();
    await page.keyboard.press("Escape");
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
      "Keep this footer draft",
    );
    await footer.getByRole("button", { name: "Night", exact: true }).click();
    await expect.poll(() => page.locator("html").getAttribute("class")).toContain("dark");
    expect(
      await footer.getByRole("button", { name: "Night", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
    expect(await page.getByRole("complementary", { name: "Your designs" }).isVisible()).toBe(true);
    expect(
      await page
        .frameLocator('iframe[title="Design preview"]')
        .locator("h1")
        .getAttribute("data-sidebar-check"),
    ).toBe("preserved");
    await page.reload();
    await page.getByRole("region", { name: "Artboard canvas" }).waitFor();
    expect(
      await footer.getByRole("button", { name: "Night", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      await page
        .getByRole("button", { name: "Source editors", exact: true })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    await page.setViewportSize({ width: 320, height: 844 });
    await footer.getByRole("button", { name: "Day", exact: true }).click();
    await expect.poll(() => page.locator("html").getAttribute("class")).toContain("light");
    expect(await page.getByRole("button", { name: "Open sidebar", exact: true }).isVisible()).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await context.close();
  });

  it("places GitHub badges beside the welcome close button and the Day/Night toggle, and reveals the theme from the clicked control", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const reveals: { clipPath: string[] }[] = [];
      Object.assign(window, { themeReveals: reveals });
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        if (typeof options === "object" && options.pseudoElement === "::view-transition-new(root)")
          reveals.push(keyframes as { clipPath: string[] });
        return animate.call(this, keyframes, options);
      };
    });
    const reveals = () =>
      page.evaluate(
        () => (window as unknown as { themeReveals: { clipPath: string[] }[] }).themeReveals,
      );
    const center = (box: { x: number; y: number; width: number; height: number }) => ({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    async function expectBadgeBeside(
      badge: ReturnType<Page["getByRole"]>,
      control: ReturnType<Page["getByRole"]>,
    ) {
      expect(await badge.getAttribute("href")).toBe("https://github.com/ajrahim/tinytldr");
      expect(await badge.getAttribute("target")).toBe("_blank");
      const badgeBox = (await badge.boundingBox())!;
      const controlBox = (await control.boundingBox())!;
      const gap = controlBox.x - (badgeBox.x + badgeBox.width);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(12);
      expect(Math.abs(center(badgeBox).y - center(controlBox).y)).toBeLessThanOrEqual(1);
    }

    await page.goto(site.baseUrl);
    const welcome = page.getByRole("dialog", { name: "Welcome to tinytldr." });
    await expectBadgeBeside(
      welcome.getByRole("link", { name: "GitHub", exact: true }),
      welcome.getByRole("button", { name: "Close guide", exact: true }),
    );
    await welcome.getByRole("button", { name: "Start Creating" }).click();
    await page.getByRole("region", { name: "Artboard canvas" }).waitFor();

    const footer = page.getByRole("contentinfo", { name: "Site footer" });
    expect(await footer.getByRole("link", { name: "GitHub", exact: true }).count()).toBe(1);
    await expectBadgeBeside(
      footer.getByRole("link", { name: "GitHub", exact: true }),
      footer.getByRole("group", { name: "Site appearance" }),
    );

    const night = footer.getByRole("button", { name: "Night", exact: true });
    const origin = center((await night.boundingBox())!);
    await night.click();
    await expect.poll(() => page.locator("html").getAttribute("class")).toContain("dark");
    await expect.poll(async () => (await reveals()).length).toBe(1);
    const [from, to] = (await reveals())[0]!.clipPath;
    const circle = /^circle\(([\d.]+)px at ([\d.]+)px ([\d.]+)px\)$/;
    const [, startRadius, startX, startY] = circle.exec(from!)!.map(Number);
    const [, endRadius, endX, endY] = circle.exec(to!)!.map(Number);
    expect(startRadius).toBe(0);
    expect(startX).toBeCloseTo(origin.x, 0);
    expect(startY).toBeCloseTo(origin.y, 0);
    expect([endX, endY]).toEqual([startX, startY]);
    // The final circle covers the farthest viewport corner from the button.
    expect(endRadius).toBeGreaterThanOrEqual(Math.hypot(origin.x, origin.y) - 1);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await footer.getByRole("button", { name: "Day", exact: true }).click();
    await expect.poll(() => page.locator("html").getAttribute("class")).toContain("light");
    expect((await reveals()).length).toBe(1);

    await page.setViewportSize({ width: 320, height: 844 });
    expect(await footer.getByRole("link", { name: "GitHub", exact: true }).isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await context.close();
  });

  it("preserves mounted editor undo, split ratio, and iframe across visibility changes, and reports hidden invalid drafts after reload", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await open(page, "", false);
    const toggle = page.getByRole("button", { name: "Source editors", exact: true });
    await showSourceEditors(page);
    const original = (await downloadSource(page, "HTML / Liquid source")).text;
    const edited = original.replace("A SMALL THOUGHT", "A NEW THOUGHT");
    expect(edited).not.toBe(original);
    await setSource(page, "HTML", edited);
    await page.frameLocator('iframe[title="Design preview"]').getByText("A NEW THOUGHT").waitFor();
    await page
      .frameLocator('iframe[title="Design preview"]')
      .locator("h1")
      .evaluate((node) => node.setAttribute("data-visibility-check", "preserved"));
    const editor = page.getByRole("textbox", { name: "Template HTML", exact: true });
    const editorNode = (await editor.elementHandle())!;
    const divider = page.getByRole("separator", { name: "Resize preview" });
    await divider.press("ArrowDown");
    const ratio = await divider.getAttribute("aria-valuenow");
    const height = (await page.locator(".preview-split-preview").boundingBox())!.height;
    await toggle.click();
    expect(await editor.isVisible()).toBe(false);
    expect(await editorNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await divider.isVisible()).toBe(false);
    expect((await page.locator(".preview-split-preview").boundingBox())!.height).toBeGreaterThan(
      height + 100,
    );
    await toggle.click();
    expect(await divider.getAttribute("aria-valuenow")).toBe(ratio);
    expect(await editor.evaluate((node, previous) => node === previous, editorNode)).toBe(true);
    expect(
      await page
        .frameLocator('iframe[title="Design preview"]')
        .locator("h1")
        .getAttribute("data-visibility-check"),
    ).toBe("preserved");
    await editor.press("ControlOrMeta+z");
    expect((await downloadSource(page, "HTML / Liquid source")).text).toBe(original);
    await editor.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
    expect((await downloadSource(page, "HTML / Liquid source")).text).toBe(edited);
    await save(page);
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    await setSource(page, "JSON", "{");
    await expect
      .poll(() => page.getByRole("textbox", { name: "Template JSON", exact: true }).innerText())
      .toBe("{");
    await toggle.click();
    await page
      .locator(".workspace-notices")
      .getByRole("alert")
      .filter({ hasText: "Open source editors to fix this design" })
      .waitFor();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await page.reload();
    await page
      .locator(".workspace-notices")
      .getByRole("alert")
      .filter({ hasText: "Open source editors to fix this design" })
      .waitFor();
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    await showSourceEditors(page);
    expect(
      await page.getByRole("textbox", { name: "Template JSON", exact: true }).innerText(),
    ).toBe("{");
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await editorNode.dispose();
    await context.close();
  });

  it("loads a whole historical design as editable source, clears undo, and saves a new latest without rewriting history", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page);
    await page.getByLabel("Design title", { exact: true }).fill("First version");
    const originalHtml = (await downloadSource(page, "HTML / Liquid source")).text;
    await save(page);
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await page.getByLabel("Page 2 purpose", { exact: true }).fill("Only in the second version.");
    await page.getByLabel("Design title", { exact: true }).fill("Second version");
    await save(page);
    let picker = await versions(page);
    await picker.getByRole("button", { name: /^Version 1\b/ }).click();
    await expect
      .poll(() => page.getByLabel("Design title", { exact: true }).inputValue())
      .toBe("First version");
    expect(await page.locator(".version-history-trigger .header-action-label").innerText()).toBe(
      "Version 1",
    );
    expect(await page.locator(".artboard").count()).toBe(1);
    const editor = page.getByLabel("Template HTML", { exact: true });
    await editor.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    expect((await downloadSource(page, "HTML / Liquid source")).text).toBe(originalHtml);
    await setSource(page, "HTML", '<h1 data-tt-slot="headline">Restored and edited.</h1>');
    await save(page);
    await expect
      .poll(() => page.getByRole("button", { name: "Versions", exact: true }).getAttribute("title"))
      .toBe("Versions: Latest");
    picker = await versions(page);
    expect(await picker.getByRole("button", { name: /^Latest/ }).innerText()).toContain("v3");
    await picker.getByRole("button", { name: /^Version 1\b/ }).click();
    expect((await downloadSource(page, "HTML / Liquid source")).text).toBe(originalHtml);
    picker = await versions(page);
    page.once("dialog", (dialog) => dialog.accept());
    await picker.getByRole("button", { name: /^Latest/ }).click();
    await expect
      .poll(async () => (await downloadSource(page, "HTML / Liquid source")).text)
      .toContain("Restored and edited.");
    await context.close();
  });

  it("confirms before replacing invalid source, preserves it on cancel/fetch failure, and retries explicit history errors", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page);
    await save(page);
    await page.getByLabel("Design title", { exact: true }).fill("Second save");
    await save(page);
    const listUrl = site.apiUrl;
    await page.route(listUrl, (route) => {
      if (
        route.request().method() !== "POST" ||
        route.request().postDataJSON().action !== "versions"
      )
        return route.continue();
      return route.fulfill({
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({ error: "History unavailable" }),
      });
    });
    let picker = await versions(page);
    await expect
      .poll(() => picker.getByRole("alert").textContent())
      .toContain("History unavailable");
    await page.unroute(listUrl);
    await picker.getByRole("button", { name: "Try again" }).click();
    await picker.getByRole("button", { name: /^Version 1\b/ }).waitFor();
    await page.keyboard.press("Escape");
    await setSource(page, "JSON", "{ unfinished draft");
    picker = await versions(page);
    page.once("dialog", (dialog) => dialog.dismiss());
    await picker.getByRole("button", { name: /^Version 1\b/ }).click();
    expect(await page.getByLabel("Template JSON", { exact: true }).innerText()).toBe(
      "{ unfinished draft",
    );
    const versionUrl = site.apiUrl;
    await page.route(versionUrl, (route) => {
      if (
        route.request().method() !== "POST" ||
        route.request().postDataJSON().action !== "version"
      )
        return route.continue();
      return route.fulfill({
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({ error: "Snapshot unavailable" }),
      });
    });
    page.once("dialog", (dialog) => dialog.accept());
    await picker.getByRole("button", { name: /^Version 1\b/ }).click();
    await expect
      .poll(() => page.getByRole("alert").allTextContents())
      .toContain("Snapshot unavailable");
    expect(await page.getByLabel("Template JSON", { exact: true }).innerText()).toBe(
      "{ unfinished draft",
    );
    await page.unroute(versionUrl);
    page.once("dialog", (dialog) => dialog.accept());
    await picker.getByRole("button", { name: /^Version 1\b/ }).click();
    await expect
      .poll(() => page.getByRole("button", { name: "Save", exact: true }).isEnabled())
      .toBe(true);
    expect(await page.getByLabel("Template JSON", { exact: true }).innerText()).not.toBe(
      "{ unfinished draft",
    );
    await context.close();
  });

  it("does not request private history for public-link visitors", async () => {
    const owner = await browser.newContext();
    const page = await owner.newPage();
    await open(page);
    await save(page);
    const visitorContext = await browser.newContext({ viewport: { width: 320, height: 844 } });
    const visitor = await visitorContext.newPage();
    let requests = 0;
    visitor.on("request", (request) => {
      if (request.url().includes("/get_design_versions")) requests++;
    });
    await open(visitor, new URL(page.url()).pathname);
    const picker = await versions(visitor);
    expect(await picker.innerText()).toContain("private to this design's editor");
    expect(requests).toBe(0);
    expect(await visitor.locator(".header-save-button .header-action-label").innerText()).toBe(
      "Save copy",
    );
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    expect(
      await visitor
        .getByRole("button", { name: "Save copy", exact: true })
        .locator("svg")
        .isVisible(),
    ).toBe(true);
    await visitorContext.close();
    await owner.close();
  });

  it("keeps historical drafts on concurrent-save conflicts and explicitly reloads the latest server version", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page);
    const firstTitle = await page.getByLabel("Design title", { exact: true }).inputValue();
    await save(page);
    await page.getByLabel("Design title", { exact: true }).fill("Second version");
    await save(page);
    let picker = await versions(page);
    await picker.getByRole("button", { name: /^Version 1\b/ }).click();
    await expect
      .poll(() => page.getByLabel("Design title", { exact: true }).inputValue())
      .toBe(firstTitle);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const editKey = await page.evaluate(
      ({ key, id }) =>
        JSON.parse(localStorage.getItem(key) ?? "[]").find(
          (entry: { id: string }) => entry.id === id,
        ).editKey as string,
      { key: DESIGN_HISTORY_KEY, id },
    );
    const latest = await site.design(id);
    await site.service.execute(
      {
        action: "save",
        id,
        document: { ...latest.document, title: "Concurrent update" },
        revision: latest.revision,
        editKey,
      },
      null,
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => page.getByRole("alert").allTextContents())
      .toEqual([expect.stringContaining("Save refused")]);
    expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(firstTitle);
    expect(await site.design(id)).toMatchObject({
      revision: 3,
      document: { title: "Concurrent update" },
    });
    picker = await versions(page);
    page.once("dialog", (dialog) => dialog.accept());
    await picker.getByRole("button", { name: /^Latest/ }).click();
    await expect
      .poll(() => page.getByLabel("Design title", { exact: true }).inputValue())
      .toBe("Concurrent update");
    expect(
      await page.getByRole("button", { name: "Versions", exact: true }).getAttribute("title"),
    ).toBe("Versions: Latest");
    await context.close();
  });

  it("loads additional pages of real saved versions and selects an older snapshot", async () => {
    const id = crypto.randomUUID();
    const key = "ac".repeat(32);
    const document = projectFromDocument(createBlankDocument());
    await site.service.execute({ action: "save", id, document, editKey: key }, null);
    for (let revision = 1; revision < 24; revision++)
      await site.service.execute({ action: "save", id, document, revision, editKey: key }, null);
    const context = await browser.newContext();
    await context.addInitScript(
      ({ storageKey, entry }) => localStorage.setItem(storageKey, JSON.stringify([entry])),
      {
        storageKey: DESIGN_HISTORY_KEY,
        entry: {
          id,
          editKey: key,
          saved: true,
          revision: 24,
          updatedAt: new Date().toISOString(),
          document,
        },
      },
    );
    const page = await context.newPage();
    await open(page, `/d/${id}`);
    const picker = await versions(page);
    await picker.getByRole("button", { name: "Load more" }).click();
    await picker.getByRole("button", { name: /^Version 1\b/ }).click();
    await expect
      .poll(() => page.getByRole("button", { name: "Versions", exact: true }).getAttribute("title"))
      .toContain("Version 1");
    expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    await context.close();
  });
});
