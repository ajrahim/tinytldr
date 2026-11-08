import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ChromiumRenderer,
  inspectPdfBuffer,
  inspectPngHeader,
  probeVideoFile,
  renderWorkspaceProject,
} from "@tinytldr/renderer";
import { WorkspaceProjectSchema } from "@tinytldr/core";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import { downloadSource, setSource, showSourceEditors } from "./SourceEditorFixture.js";
import { DESIGN_HISTORY_KEY, LocalDesignSchema } from "../src/lib/DesignHistory.js";
import { chooseDropdown } from "./DropdownFixture.js";
import { chooseSiteTheme } from "./SiteChromeFixture.js";

describe.skipIf(!hasFirebaseEmulators)("Floating AI composer", () => {
  let browser: Browser;
  let site: Awaited<ReturnType<typeof startWorkspaceTestServer>>;
  let mode: "normal" | "deferred" | "error" | "invalid-template" | "image" = "normal";
  let release: (() => void) | undefined;
  const key = "test-private-provider-token-4101";
  beforeAll(async () => {
    site = await startWorkspaceTestServer({
      aiProviderFetch: async (_url, init) => {
        if (init?.method === "GET") return Response.json({ data: [{ id: "gpt-test" }] });
        const body = JSON.parse(String(init?.body)) as {
          messages: { content: string | { type: string; text?: string }[] }[];
        };
        const user = body.messages[1]!.content;
        const text =
          typeof user === "string" ? user : user.find((part) => part.type === "text")!.text!;
        if (text === "Reply with OK.")
          return Response.json({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
          });
        const packet = JSON.parse(text) as {
          currentProject: unknown;
          imageAssets: { name: string; source: string }[];
        };
        const project = WorkspaceProjectSchema.parse(packet.currentProject);
        const currentMode = mode;
        if (currentMode === "deferred")
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        if (currentMode === "error")
          return Response.json({ error: { message: key } }, { status: 429 });
        for (const board of project.pages) {
          board.data.headline = `AI ${board.title}`;
          board.template.manifest.sampleData = board.data;
          board.template.stylesCss += "\nh1 { letter-spacing: 1px; }";
          if (currentMode === "invalid-template") board.template.liquidTemplate = "{% if %}";
          if (currentMode === "image") {
            project.size = { width: 160, height: 96 };
            board.data.logo = packet.imageAssets[0]!.source;
            board.template.manifest.slots.logo = {
              type: "image",
              label: "Logo",
              description: "The original uploaded logo",
              required: true,
            };
            board.template.manifest.kind = "video";
            board.template.manifest.durationMs = 500;
            board.template.manifest.fps = 12;
            board.template.manifest.sampleData = board.data;
            board.template.liquidTemplate = '<img id="placed-logo" src="{{ logo }}" alt="Logo">';
            board.template.stylesCss =
              "#placed-logo { position:absolute; inset:0; width:100%; height:100%; object-fit:fill; }";
          }
        }
        return Response.json({
          choices: [{ message: { content: JSON.stringify(project) }, finish_reason: "stop" }],
        });
      },
    });
    browser = await chromium.launch();
  });
  beforeEach(async () => {
    release?.();
    release = undefined;
    mode = "normal";
    site.aiRequests.length = 0;
    await site.resetAi();
  });
  afterAll(async () => {
    release?.();
    await browser?.close();
    await site?.close();
  });
  async function open(page: Page, signedIn = true) {
    await page.goto(site.baseUrl);
    await page
      .getByRole("dialog", { name: "Welcome to tinytldr." })
      .getByRole("button", { name: "Start Creating" })
      .click();
    if (signedIn) await site.signIn(page);
    await expect
      .poll(() => page.frameLocator('iframe[title="Design preview"]').locator("h1").textContent())
      .toBe("Less, but better.");
    await expect
      .poll(() => page.getByRole("combobox", { name: "Model", exact: true }).isEnabled(), {
        timeout: 10_000,
      })
      .toBe(true);
  }
  async function connect(page: Page) {
    await chooseDropdown(page.getByRole("combobox", { name: "Model", exact: true }), "manage");
    const dialog = page.getByRole("dialog", { name: "AI connection", exact: true });
    await dialog.getByLabel("Provider API key").fill(key);
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect
      .poll(() => dialog.innerText(), { timeout: 10_000 })
      .toContain("Connected · Key ending");
    await chooseDropdown(dialog.getByRole("combobox", { name: "Model", exact: true }), "gpt-test");
    await expect
      .poll(() => dialog.getByRole("combobox", { name: "Model", exact: true }).textContent())
      .toContain("gpt-test");
    await dialog.getByRole("button", { name: "Close AI connection" }).click();
    await page.getByRole("combobox", { name: "Model", exact: true }).click();
    await expect
      .poll(() =>
        page
          .getByRole("listbox", { name: "Model", exact: true })
          .getByRole("option")
          .allTextContents(),
      )
      .toContain("gpt-test");
    await page.keyboard.press("Escape");
    expect(
      await page.getByRole("combobox", { name: "Model", exact: true }).getAttribute("title"),
    ).toContain(
      "OpenAI · gpt-test · Sends prompts, design sources & attached context to the provider",
    );
    expect(await page.locator(".ai-composer").innerText()).not.toContain("Sent to OpenAI");
  }
  async function project(page: Page) {
    return WorkspaceProjectSchema.parse(
      JSON.parse((await downloadSource(page, "Download design JSON")).text),
    );
  }
  it("keeps guest authoring available and fits light/dark desktop/mobile without document scrolling or camera gestures", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await open(page, false);
    await page.getByLabel("Describe your idea").fill("Create a design");
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const theme of ["Day", "Night"]) {
        await chooseSiteTheme(page, theme);
        const prompt = page.getByLabel("Describe your idea");
        const focusStyle = () =>
          prompt.evaluate((element) => ({
            focused: element === document.activeElement,
            outline: getComputedStyle(element).outlineStyle,
          }));
        await prompt.click();
        expect(await focusStyle()).toEqual({ focused: true, outline: "none" });
        await prompt.press("Tab");
        expect(
          await page
            .getByRole("button", { name: "Add context", exact: true })
            .evaluate((element) => ({
              focused: element === document.activeElement,
              outline: getComputedStyle(element).outlineStyle,
            })),
        ).toEqual({ focused: true, outline: "none" });
        await page.keyboard.press("Shift+Tab");
        expect(await focusStyle()).toEqual({ focused: true, outline: "none" });
        const canvas = (await page.getByLabel("Artboard canvas", { exact: true }).boundingBox())!;
        const composer = (await page.locator(".ai-composer").boundingBox())!;
        const form = (await page.getByRole("form", { name: "AI design composer" }).boundingBox())!;
        expect(composer.height).toBeCloseTo(form.height);
        expect(await page.locator(".ai-composer").innerText()).not.toContain(
          "Prompts, design sources",
        );
        expect(await page.locator(".ai-composer").innerText()).not.toContain(
          "Connect your own provider",
        );
        const nav = (await page.locator(".canvas-navigation").boundingBox())!;
        expect(composer.x).toBeGreaterThanOrEqual(canvas.x);
        expect(composer.x + composer.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
        expect(composer.y + composer.height).toBeLessThanOrEqual(canvas.y + canvas.height);
        expect(nav.y).toBeLessThan(canvas.y + 25);
        expect(nav.x + nav.width).toBeGreaterThan(canvas.x + canvas.width - 30);
        const purpose = (await page.getByLabel("Page 1 purpose", { exact: true }).boundingBox())!;
        expect(purpose.y + purpose.height).toBeLessThanOrEqual(composer.y - 8);
        expect(
          await page.evaluate(() => ({
            x: document.documentElement.scrollWidth > innerWidth,
            y: document.documentElement.scrollHeight > innerHeight,
          })),
        ).toEqual({ x: false, y: false });
      }
    }
    const transform = await page.locator(".artboard-world").getAttribute("style");
    await page.getByLabel("Describe your idea").press("Space");
    await page.getByLabel("Describe your idea").press("ArrowLeft");
    expect(await page.locator(".artboard-world").getAttribute("style")).toBe(transform);
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect.poll(() => page.getByRole("dialog").count()).toBe(1);
    expect(site.aiRequests).toHaveLength(0);
    await context.close();
  });
  it("toggles the preserved prompt and fits its history dropdown across desktop/mobile Day/Night without resetting the camera", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    try {
      await open(page, false);
      const prompt = page.getByLabel("Describe your idea");
      const toggle = page.getByRole("button", { name: "Prompt", exact: true });
      const trigger = page.getByRole("button", { name: "Prompt history", exact: true });
      const history = page.getByRole("dialog", { name: "Prompt history", exact: true });
      expect(await toggle.getAttribute("aria-expanded")).toBe("true");
      expect(await trigger.getAttribute("aria-expanded")).toBe("false");
      await prompt.fill("Preserved prompt @Page");
      await page.getByRole("listbox", { name: "Choose artboards" }).getByRole("option").click();
      const preserved = await prompt.inputValue();
      await page.getByLabel("Attach reference files").setInputFiles({
        name: "hidden-context.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Preserved context."),
      });
      await page.getByRole("button", { name: "Remove context hidden-context.txt" }).waitFor();
      await page
        .frameLocator('iframe[title="Design preview"]')
        .locator("body")
        .evaluate((element) => element.setAttribute("data-prompt-preview", "preserved"));
      const zoom = () =>
        page
          .getByLabel("Canvas zoom", { exact: true })
          .textContent()
          .then((value) => Number.parseInt(value!));
      const initialZoom = await zoom();
      await toggle.click();
      await expect.poll(() => prompt.isVisible()).toBe(false);
      await expect.poll(zoom).toBeGreaterThan(initialZoom);
      await toggle.click();
      await expect.poll(() => prompt.isVisible()).toBe(true);
      expect(await prompt.inputValue()).toBe(preserved);
      expect(
        await page.getByRole("button", { name: "Remove context hidden-context.txt" }).count(),
      ).toBe(1);
      expect(await page.locator(".composer-chips").innerText()).toContain("@Page 1");
      expect(
        await page
          .frameLocator('iframe[title="Design preview"]')
          .locator("body")
          .getAttribute("data-prompt-preview"),
      ).toBe("preserved");
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.getByLabel("Artboard canvas", { exact: true }).press("ArrowLeft");
      const manual = await page.locator(".artboard-world").getAttribute("style");
      await toggle.click();
      await toggle.click();
      expect(await page.locator(".artboard-world").getAttribute("style")).toBe(manual);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        for (const theme of ["Day", "Night"]) {
          await chooseSiteTheme(page, theme);
          const add = (await page
            .getByRole("button", { name: "Add page", exact: true })
            .boundingBox())!;
          const control = (await toggle.boundingBox())!;
          expect(control.x).toBeGreaterThanOrEqual(add.x + add.width);
          expect(Math.abs(control.y - add.y)).toBeLessThanOrEqual(1);
          expect(
            await page.locator(".canvas-prompt-controls").evaluate((element) => {
              const css = getComputedStyle(element);
              return { width: css.borderLeftWidth, style: css.borderLeftStyle };
            }),
          ).toEqual({ width: "1px", style: "solid" });
          await trigger.press("ArrowDown");
          await history.waitFor();
          expect(await history.evaluate((element) => element === document.activeElement)).toBe(
            true,
          );
          expect(await history.innerText()).toContain("No prompts yet.");
          const bounds = (await history.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(8);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(844 - 8);
          await page.keyboard.press("Tab");
          expect(
            await page
              .getByRole("button", { name: "Close prompt history" })
              .evaluate((element) => element === document.activeElement),
          ).toBe(true);
          await page.keyboard.press("Escape");
          await expect.poll(() => history.isVisible()).toBe(false);
          expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(
            true,
          );
          await trigger.click();
          await page.getByRole("button", { name: "Fit all pages", exact: true }).click();
          await expect.poll(() => history.isVisible()).toBe(false);
          expect(
            await page.evaluate(() => ({
              x: document.documentElement.scrollWidth > innerWidth,
              y: document.documentElement.scrollHeight > innerHeight,
            })),
          ).toEqual({ x: false, y: false });
          const navigation = (await page.locator(".canvas-navigation").boundingBox())!;
          expect(navigation.x).toBeGreaterThanOrEqual(0);
          expect(navigation.x + navigation.width).toBeLessThanOrEqual(width);
        }
      }
      expect(site.aiRequests).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("auto-opens session history for requests and outcomes, respects manual hiding and preserves hidden-prompt generation, cancellation and undo", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    try {
      await open(page);
      await connect(page);
      const original = await project(page);
      const prompt = page.getByLabel("Describe your idea");
      const toggle = page.getByRole("button", { name: "Prompt", exact: true });
      const trigger = page.getByRole("button", { name: "Prompt history", exact: true });
      const history = page.getByRole("dialog", { name: "Prompt history", exact: true });
      const log = page.getByRole("log", { name: "Generation history", exact: true });
      const sent = "Session-only successful prompt.";
      mode = "deferred";
      await prompt.fill(sent);
      await page.getByRole("button", { name: "Generate design" }).click();
      await expect.poll(() => !!release).toBe(true);
      await expect.poll(() => history.isVisible()).toBe(true);
      expect(await log.innerText()).toContain(sent);
      expect(await log.innerText()).toContain("Thinking...");
      expect(await page.locator(".ai-composer .composer-feedback:not(.notice-error)").count()).toBe(
        0,
      );
      expect(
        await page.locator(".ai-composer [role=status]").evaluate((element) => {
          const css = getComputedStyle(element);
          return { position: css.position, width: css.width, height: css.height };
        }),
      ).toEqual({ position: "absolute", width: "1px", height: "1px" });
      expect(await history.evaluate((element) => element.contains(document.activeElement))).toBe(
        false,
      );
      await trigger.click();
      await expect.poll(() => history.isVisible()).toBe(false);
      await toggle.click();
      await expect.poll(() => prompt.isVisible()).toBe(false);
      expect(await prompt.inputValue()).toBe(sent);
      expect(await history.isVisible()).toBe(false);
      expect(site.aiRequests).toHaveLength(1);
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      release!();
      release = undefined;
      await expect
        .poll(() => page.locator('.composer-history-log [data-status="succeeded"]').count())
        .toBe(1);
      expect(await history.isVisible()).toBe(false);
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      await expect.poll(() => history.isVisible()).toBe(true);
      await expect.poll(() => log.locator('[data-status="succeeded"]').count()).toBe(1);
      expect(await prompt.isVisible()).toBe(false);
      await expect.poll(() => prompt.inputValue()).toBe("");
      expect(await log.innerText()).toContain(sent);
      expect((await page.locator(".ai-composer").boundingBox())!.height).toBe(0);
      expect(
        await page.locator(".ai-composer").getByRole("button", { name: "Undo generation" }).count(),
      ).toBe(0);
      expect(await history.evaluate((element) => element.contains(document.activeElement))).toBe(
        false,
      );
      expect(await page.getByRole("button", { name: "Undo generation" }).count()).toBe(1);
      await toggle.click();
      await prompt.fill("Follow-up prompt I have not sent.");
      await toggle.click();
      await trigger.click();
      await page.getByRole("button", { name: "Undo generation" }).click();
      await expect.poll(() => log.locator('[data-status="undone"]').count()).toBe(1);
      expect(await prompt.inputValue()).toBe("Follow-up prompt I have not sent.");
      expect(await project(page)).toEqual(original);
      await toggle.click();
      await prompt.fill("Session-only cancelled prompt.");
      await page.getByRole("button", { name: "Generate design" }).click();
      await expect.poll(() => !!release).toBe(true);
      await toggle.click();
      if (!(await history.isVisible())) await trigger.click();
      await history.getByRole("button", { name: "Cancel generation", exact: true }).click();
      await expect.poll(() => log.locator('[data-status="cancelled"]').count()).toBe(1);
      expect(await log.innerText()).toContain("Generation cancelled.");
      expect(await prompt.inputValue()).toBe("Session-only cancelled prompt.");
      release!();
      release = undefined;
      expect(await project(page)).toEqual(original);
      await toggle.click();
      const longPrompt = `Session-only failed prompt. ${"Wrap this long history line. ".repeat(200)}`;
      mode = "error";
      await prompt.fill(longPrompt);
      await page.getByRole("button", { name: "Generate design" }).click();
      await expect.poll(() => log.locator('[data-status="failed"]').count()).toBe(1);
      expect(await history.isVisible()).toBe(true);
      expect(await log.locator("li").count()).toBe(3);
      expect(await log.innerText()).toContain("quota or rate limit");
      expect(await log.innerText()).not.toContain(key);
      expect(await prompt.inputValue()).toBe(longPrompt);
      expect(site.aiRequests.map((request) => request.prompt)).toEqual([
        sent,
        "Session-only cancelled prompt.",
        longPrompt.trim(),
      ]);
      await page.getByRole("button", { name: "Fit all pages", exact: true }).click();
      await trigger.click();
      await expect
        .poll(() => log.evaluate((element) => element.scrollHeight > element.clientHeight))
        .toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const camera = await page.locator(".artboard-world").getAttribute("style");
      await log.hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => log.evaluate((element) => element.scrollTop > 0)).toBe(true);
      expect(await page.locator(".artboard-world").getAttribute("style")).toBe(camera);
      await page.setViewportSize({ width: 320, height: 568 });
      await expect
        .poll(async () => {
          const bounds = (await history.boundingBox())!;
          return bounds.x >= 8 && bounds.x + bounds.width <= 312 && bounds.y + bounds.height <= 560;
        })
        .toBe(true);
      const bounds = (await history.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(8);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(312);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(560);
      expect(await log.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain(
        "Session-only",
      );
      expect(JSON.stringify(await project(page))).not.toContain("Session-only");
    } finally {
      release?.();
      release = undefined;
      await context.close();
    }
  });

  it("saves a masked connection, generates all pages, undoes safely, and targets duplicate names with real text/image context", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await open(page);
    await connect(page);
    await page.getByLabel("Page 1 title", { exact: true }).fill("Cover");
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await page.getByLabel("Page 2 title", { exact: true }).fill("Cover");
    const original = await project(page);
    await page.getByLabel("Describe your idea").fill("Improve every artboard.");
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect
      .poll(() => page.getByRole("button", { name: "Undo generation" }).isVisible())
      .toBe(true);
    expect(site.aiRequests[0]!.targetPageIds).toEqual([]);
    const generated = await project(page);
    expect(await page.getByLabel("Describe your idea").inputValue()).toBe("");
    expect(await page.locator(".ai-composer .composer-feedback:not(.notice-error)").count()).toBe(
      0,
    );
    expect(generated.pages.map((board) => board.data.headline)).toEqual(["AI Cover", "AI Cover"]);
    expect(generated.pages[0]!.template.stylesCss).toContain("letter-spacing");
    await page.getByRole("button", { name: "Prompt history", exact: true }).click();
    await page.getByRole("button", { name: "Undo generation" }).click();
    expect(await project(page)).toEqual(original);
    await page.getByLabel("Page 1 title", { exact: true }).click();
    const rawJson = JSON.stringify(JSON.parse((await downloadSource(page, "Template JSON")).text));
    await setSource(page, "JSON", rawJson);
    await page.getByRole("button", { name: "Source editors", exact: true }).click();
    await page.getByLabel("Describe your idea").fill("Change just this one. @Cover");
    const options = page.getByRole("listbox", { name: "Choose artboards" }).getByRole("option");
    await expect.poll(() => options.count()).toBe(2);
    await options.nth(1).click();
    await page.getByRole("button", { name: "Add context", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await page.getByLabel("Context name", { exact: true }).fill("Creative brief");
    await page.getByLabel("Text context", { exact: true }).fill("Make the second page expressive.");
    await page
      .locator(".composer-text-context")
      .getByRole("button", { name: "Add context", exact: true })
      .click();
    await page.getByLabel("Attach reference files").setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await expect
      .poll(() => page.getByRole("button", { name: "Remove context reference.png" }).count())
      .toBe(1);
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect
      .poll(() => page.getByRole("button", { name: "Undo generation" }).isVisible())
      .toBe(true);
    const targeted = await project(page);
    expect(await page.getByLabel("Describe your idea").inputValue()).toBe("");
    expect(await page.getByRole("button", { name: "Remove context reference.png" }).count()).toBe(
      0,
    );
    expect(await page.getByRole("button", { name: "Remove context Creative brief" }).count()).toBe(
      0,
    );
    expect(await page.locator(".composer-chips").innerText()).toContain("@Cover");
    expect(targeted.pages[0]).toEqual(original.pages[0]);
    expect(targeted.pages[1]!.data.headline).toBe("AI Cover");
    expect(site.aiRequests[1]!.targetPageIds).toEqual([original.pages[1]!.id]);
    expect(site.aiRequests[1]!.context.map((item) => item.kind)).toEqual(["text", "image"]);
    await expect
      .poll(async () => {
        const raw = await page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY);
        return LocalDesignSchema.array().parse(JSON.parse(raw ?? "null"))[0]!.pageJson?.[
          original.pages[0]!.id
        ];
      })
      .toBe(rawJson);
    expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain(key);
    expect(JSON.stringify(targeted)).not.toContain(key);
    await page.getByLabel("Page 2 purpose", { exact: true }).fill("Manual edits after generation.");
    await page.getByRole("button", { name: "Prompt history", exact: true }).click();
    await expect.poll(() => page.getByRole("button", { name: "Undo generation" }).count()).toBe(0);
    await chooseDropdown(page.getByRole("combobox", { name: "Model", exact: true }), "manage");
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page
      .getByRole("dialog", { name: "AI connection", exact: true })
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "AI connection", exact: true })
      .getByRole("button", { name: "Connect", exact: true })
      .waitFor();
    const accounts = await site.db.collection("aiAccounts").get();
    expect(accounts.docs.every((doc) => !JSON.stringify(doc.data()).includes(key))).toBe(true);
    await context.close();
  });
  it("places the original logo, clears submitted context, saves/reloads it and renders its pixels in PNG/PDF/video", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const renderer = new ChromiumRenderer();
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "tinytldr-ai-image-"));
    try {
      await open(page);
      await connect(page);
      await page.getByRole("button", { name: "New design", exact: true }).click();
      await page.waitForURL(/\/d\/[0-9a-f-]+$/);
      const logo = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 8;
        canvas.height = 4;
        const drawing = canvas.getContext("2d")!;
        drawing.fillStyle = "rgb(24,136,208)";
        drawing.fillRect(0, 0, 8, 4);
        return canvas.toDataURL("image/png");
      });
      await page.getByLabel("Attach reference files").setInputFiles({
        name: "exact-logo.png",
        mimeType: "image/png",
        buffer: Buffer.from(logo.split(",")[1]!, "base64"),
      });
      const chip = page.getByRole("button", { name: "Remove context exact-logo.png" });
      await chip.waitFor();
      await expect
        .poll(() => page.getByText("Reading context...", { exact: true }).count())
        .toBe(0);
      mode = "image";
      await page.getByLabel("Describe your idea").fill("Add this exact image as my logo.");
      await page.getByRole("button", { name: "Generate design" }).click();
      await expect.poll(() => chip.count()).toBe(0);
      const preview = page.frameLocator('iframe[title="Design preview"]').locator("#placed-logo");
      await expect
        .poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBe(8);
      expect(await preview.getAttribute("src")).toBe(logo);
      const generated = await project(page);
      expect(generated.pages[0]!.data.logo).toBe(logo);
      expect(generated.pages[0]!.template.manifest.sampleData.logo).toBe(logo);
      expect(JSON.stringify(generated)).not.toContain("tinytldr-image:");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const designId = new URL(page.url()).pathname.split("/").at(-1)!;
      await expect.poll(async () => (await site.design(designId)).document).toEqual(generated);
      await page.reload();
      await expect
        .poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBe(8);
      expect(await preview.getAttribute("src")).toBe(logo);
      const restored = await project(page);
      expect(restored).toEqual(generated);
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      await page.getByRole("button", { name: "Preview exact-logo", exact: true }).waitFor();
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      for (const format of ["png", "pdf", "mp4"] as const) {
        const outputPath = path.join(outputDir, `logo.${format}`);
        const rendered = await renderWorkspaceProject({
          document: restored,
          format,
          outputPath,
          renderer,
        });
        expect(rendered.outputPaths).toEqual([outputPath]);
        const bytes = await fs.readFile(outputPath);
        if (format === "pdf") {
          expect(inspectPdfBuffer(bytes)).toMatchObject({
            pageCount: 1,
            widthPxAt96Dpi: 160,
            heightPxAt96Dpi: 96,
          });
          expect(bytes.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
          continue;
        }
        let png = bytes;
        if (format === "mp4") {
          expect(await probeVideoFile(outputPath)).toMatchObject({
            width: 160,
            height: 96,
            avgFrameRate: "12/1",
            durationSeconds: 0.5,
            codecName: "h264",
            pixFmt: "yuv420p",
          });
          const decoded = await promisify(execFile)(
            "ffmpeg",
            [
              "-v",
              "error",
              "-i",
              outputPath,
              "-frames:v",
              "1",
              "-f",
              "image2pipe",
              "-vcodec",
              "png",
              "-",
            ],
            { encoding: "buffer", windowsHide: true },
          );
          png = decoded.stdout;
        }
        expect(inspectPngHeader(png)).toEqual({ width: 160, height: 96 });
        const pixel = await page.evaluate(
          async (dataUrl) => {
            const image = new Image();
            image.src = dataUrl;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const drawing = canvas.getContext("2d")!;
            drawing.drawImage(image, 0, 0);
            return [...drawing.getImageData(80, 48, 1, 1).data];
          },
          `data:image/png;base64,${png.toString("base64")}`,
        );
        for (const [index, value] of [24, 136, 208, 255].entries())
          expect(Math.abs(pixel[index]! - value)).toBeLessThanOrEqual(format === "png" ? 0 : 3);
      }
    } finally {
      await context.close();
      await renderer.close();
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });
  it("preserves pending generation and attachments across legal and Library surface navigation", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await open(page);
      await connect(page);
      await page.getByLabel("Attach reference files").setInputFiles({
        name: "route-context.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Context that survives legal and Library navigation."),
      });
      await page.getByRole("button", { name: "Remove context route-context.txt" }).waitFor();
      await page.getByLabel("Describe your idea").fill("Apply this after I read the policy.");
      mode = "deferred";
      await page.getByRole("button", { name: "Generate design" }).click();
      await expect.poll(() => !!release).toBe(true);
      await page
        .locator(".site-footer")
        .getByRole("link", { name: "Privacy", exact: true })
        .click();
      await page.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor();
      expect(
        await page.getByRole("dialog", { name: "Prompt history", exact: true }).isVisible(),
      ).toBe(false);
      await page.locator(".site-footer").getByRole("link", { name: "Terms", exact: true }).click();
      const historyLength = await page.evaluate(() => window.history.length);
      release!();
      release = undefined;
      await expect
        .poll(() => page.locator('.composer-history-log [data-status="succeeded"]').count())
        .toBe(1);
      await expect
        .poll(() => page.frameLocator('iframe[title="Design preview"]').locator("h1").textContent())
        .toBe("AI Page 1");
      expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
      expect(
        await page.getByRole("heading", { name: "Terms and Conditions", exact: true }).isVisible(),
      ).toBe(true);
      expect(
        await page.getByRole("dialog", { name: "Prompt history", exact: true }).isVisible(),
      ).toBe(false);
      await page.goBack({ waitUntil: "commit" });
      await page.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor();
      await page.goBack({ waitUntil: "commit" });
      await expect.poll(() => page.getByLabel("Describe your idea").inputValue()).toBe("");
      expect(
        await page.getByRole("button", { name: "Remove context route-context.txt" }).count(),
      ).toBe(0);
      const generated = await project(page);
      expect(generated.pages[0]!.data.headline).toBe("AI Page 1");
      const input = page.getByLabel("Attach reference files");
      await input.setInputFiles({
        name: "next-route.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("The next unsent context."),
      });
      await page.getByRole("button", { name: "Remove context next-route.txt" }).waitFor();
      await page.getByLabel("Describe your idea").fill("An unsent follow-up prompt.");
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      expect(new URL(page.url()).pathname).toBe("/library");
      await page
        .locator(".site-footer")
        .getByRole("link", { name: "Privacy", exact: true })
        .click();
      await page.getByRole("link", { name: "Back to workspace", exact: true }).click();
      expect(await page.getByLabel("Describe your idea").inputValue()).toBe(
        "An unsent follow-up prompt.",
      );
      expect(
        await page.getByRole("button", { name: "Remove context next-route.txt" }).count(),
      ).toBe(1);
      expect(await project(page)).toEqual(generated);
      expect(site.aiRequests).toHaveLength(1);
      expect(site.aiRequests[0]!.context.map((item) => item.name)).toEqual(["route-context.txt"]);
    } finally {
      release?.();
      release = undefined;
      await context.close();
    }
  });

  it("clears only submitted attachments when new context arrives during a successful request", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await open(page);
      await connect(page);
      const input = page.getByLabel("Attach reference files");
      await input.setInputFiles({
        name: "submitted.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("The submitted context"),
      });
      await page.getByRole("button", { name: "Remove context submitted.txt" }).waitFor();
      await page.getByLabel("Describe your idea").fill("Update this design.");
      mode = "deferred";
      await page.getByRole("button", { name: "Generate design" }).click();
      await expect.poll(() => !!release).toBe(true);
      await input.setInputFiles({
        name: "next-prompt.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Keep this for the next prompt"),
      });
      await page.getByRole("button", { name: "Remove context next-prompt.txt" }).waitFor();
      release!();
      release = undefined;
      await expect
        .poll(() => page.getByRole("button", { name: "Remove context submitted.txt" }).count())
        .toBe(0);
      expect(
        await page.getByRole("button", { name: "Remove context next-prompt.txt" }).count(),
      ).toBe(1);
      expect(site.aiRequests[0]!.context.map((item) => item.name)).toEqual(["submitted.txt"]);
    } finally {
      await context.close();
    }
  });
  it("rejects late results after source edits, supports cancellation, and preserves drafts on provider or compilation failures", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await open(page);
    await connect(page);
    await page.getByLabel("Attach reference files").setInputFiles({
      name: "preserved.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Keep this context on every failed or cancelled result."),
    });
    const preserved = page.getByRole("button", { name: "Remove context preserved.txt" });
    await preserved.waitFor();
    await expect.poll(() => preserved.isEnabled()).toBe(true);
    mode = "deferred";
    await page.getByLabel("Describe your idea").fill("Make a change");
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect.poll(() => !!release).toBe(true);
    await page.getByLabel("Page 1 purpose", { exact: true }).fill("Do not overwrite this.");
    await expect
      .poll(() => page.locator(".ai-composer [role=alert]").textContent())
      .toContain("edits were preserved");
    release!();
    release = undefined;
    expect((await project(page)).pages[0]!.data.headline).toBe("Less, but better.");
    expect(await preserved.count()).toBe(1);
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect.poll(() => !!release).toBe(true);
    await page.getByRole("button", { name: "Cancel generation" }).click();
    release!();
    release = undefined;
    await expect
      .poll(() => page.locator(".ai-composer").textContent())
      .toContain("Generation cancelled");
    expect(await preserved.count()).toBe(1);
    mode = "error";
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect
      .poll(() => page.locator(".ai-composer [role=alert]").textContent())
      .toContain("quota or rate limit");
    expect(await preserved.count()).toBe(1);
    expect(await page.locator(".ai-composer").textContent()).not.toContain(key);
    const unchanged = await project(page);
    mode = "invalid-template";
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect.poll(() => page.locator(".ai-composer [role=alert]").count()).toBe(1);
    await expect
      .poll(() => page.getByRole("button", { name: "Generate design" }).isEnabled())
      .toBe(true);
    expect(await project(page)).toEqual(unchanged);
    expect(await preserved.count()).toBe(1);
    await showSourceEditors(page);
    await setSource(page, "JSON", "{ unfinished");
    const before = site.aiRequests.length;
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect
      .poll(() => page.locator(".ai-composer [role=alert]").textContent())
      .toContain("Fix the source errors");
    expect(site.aiRequests.length).toBe(before);
    await context.close();
  });
  it("discards pending output on navigation and sign-out, clearing account-scoped composer state", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await open(page);
    await connect(page);
    mode = "deferred";
    await page.getByLabel("Describe your idea").fill("An old design request");
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect.poll(() => !!release).toBe(true);
    await page.getByRole("button", { name: "New design", exact: true }).click();
    await expect.poll(() => page.getByLabel("Describe your idea").inputValue()).toBe("");
    expect(
      await page
        .getByRole("button", { name: "Prompt history", exact: true })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    await page.getByRole("button", { name: "Prompt history", exact: true }).click();
    expect(await page.getByRole("log", { name: "Generation history" }).innerText()).toBe(
      "No prompts yet.",
    );
    await page.keyboard.press("Escape");
    release!();
    release = undefined;
    await page.getByLabel("Describe your idea").fill("An account-only request");
    await page.getByRole("button", { name: "Generate design" }).click();
    await expect.poll(() => !!release).toBe(true);
    await page.locator(".sidebar-account-card").click();
    await page
      .getByRole("dialog", { name: "Account & settings" })
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect.poll(() => page.getByLabel("Describe your idea").inputValue()).toBe("");
    expect(
      await page
        .getByRole("button", { name: "Prompt history", exact: true })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    await page.getByRole("button", { name: "Prompt history", exact: true }).click();
    expect(await page.getByRole("log", { name: "Generation history" }).innerText()).toBe(
      "No prompts yet.",
    );
    await page.keyboard.press("Escape");
    release!();
    release = undefined;
    expect(await page.getByRole("button", { name: "Undo generation" }).count()).toBe(0);
    expect((await project(page)).pages[0]!.data.headline).toBe("Less, but better.");
    await page.getByRole("combobox", { name: "Model", exact: true }).click();
    expect(
      await page
        .getByRole("listbox", { name: "Model", exact: true })
        .getByRole("option")
        .allTextContents(),
    ).toEqual(["Connect AI", "Connect AI..."]);
    await page.keyboard.press("Escape");
    await context.close();
  });
});
