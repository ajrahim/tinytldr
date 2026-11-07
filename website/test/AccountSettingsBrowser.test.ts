import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import { downloadSource, setSource } from "./SourceEditorFixture.js";

describe.skipIf(!hasFirebaseEmulators)("Account settings", () => {
  let browser: Browser;
  let site: Awaited<ReturnType<typeof startWorkspaceTestServer>>;
  beforeAll(async () => {
    site = await startWorkspaceTestServer();
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });

  async function open(page: Page, verified = true) {
    await page.addInitScript(() => {
      if (window.top !== window) return;
      localStorage.setItem("tinytldr:welcome:v1", "seen");
    });
    await page.goto(site.baseUrl);
    return site.signIn(page, { verified });
  }

  async function settings(page: Page) {
    const desktopAccount = page.getByRole("button", { name: /^Account/ });
    if (page.viewportSize()!.width <= 900) {
      const toggle = page.getByRole("button", { name: "Open sidebar" });
      await toggle.waitFor();
      await toggle.click();
    }
    await desktopAccount.click();
    const dialog = page.getByRole("dialog", { name: "Account & settings" });
    await dialog.waitFor();
    return dialog;
  }

  it("persists and clears a trimmed name, keeps email read-only, and preserves an unsaved design and iframe", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const user = await open(page);
    await setSource(page, "CSS", "h1 { color: #4939db; }");
    const originalSource = (await downloadSource(page, "Download design JSON")).text;
    const heading = page.frameLocator('iframe[title="Design preview"]').locator("h1");
    await heading.waitFor();
    await heading.evaluate((element) => {
      element.dataset.settingsProbe = "unchanged";
    });
    const dialog = await settings(page);
    expect(await dialog.getByLabel("Email address").inputValue()).toBe(user.email);
    expect(await dialog.getByLabel("Email address").getAttribute("readonly")).not.toBeNull();
    expect(await dialog.getByText("Verified", { exact: true }).isVisible()).toBe(true);
    await dialog.getByText("AI is not connected.", { exact: true }).waitFor();
    expect(await dialog.getByLabel("Display name").getAttribute("maxlength")).toBe("80");
    await dialog.getByLabel("Display name").fill("  Tiny Author  ");
    await dialog.getByRole("button", { name: "Save name" }).click();
    await dialog.getByRole("status").filter({ hasText: "Profile saved." }).waitFor();
    expect((await site.auth.getUser(user.uid)).displayName).toBe("Tiny Author");
    expect(await dialog.getByLabel("Display name").inputValue()).toBe("Tiny Author");
    await dialog.getByRole("button", { name: "Night", exact: true }).click();
    // The Day/Night reveal applies the theme inside a view transition, after the click resolves.
    await expect
      .poll(() =>
        dialog.getByRole("button", { name: "Night", exact: true }).getAttribute("aria-pressed"),
      )
      .toBe("true");
    expect(await heading.getAttribute("data-settings-probe")).toBe("unchanged");
    await dialog.getByRole("button", { name: "Close account dialog" }).click();
    expect((await downloadSource(page, "Download design JSON")).text).toBe(originalSource);
    await page.reload();
    const restored = await settings(page);
    expect(await restored.getByLabel("Display name").inputValue()).toBe("Tiny Author");
    expect(
      await restored
        .getByRole("button", { name: "Night", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await restored.getByLabel("Display name").fill("");
    await restored.getByRole("button", { name: "Save name" }).click();
    await expect.poll(() => restored.innerText(), { timeout: 10_000 }).toContain("Profile saved.");
    expect((await site.auth.getUser(user.uid)).displayName ?? "").toBe("");
    await restored.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: /Sign in \/ Create account/ }).waitFor();
    await context.close();
  });

  it("retries Firebase profile failures and signs out locally without a remote logout endpoint", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page);
    await page.route("**/accounts:update?*", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: 400, message: "PROFILE_SAVE_UNAVAILABLE" } }),
        });
        return;
      }
      await route.continue();
    });
    const dialog = await settings(page);
    await dialog.getByLabel("Display name").fill("Retry name");
    await dialog.getByRole("button", { name: "Save name" }).click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: /profile-save-unavailable/ })
      .waitFor();
    expect(await dialog.getByLabel("Display name").getAttribute("aria-invalid")).toBe("true");
    expect(await dialog.getByLabel("Display name").inputValue()).toBe("Retry name");
    expect(await dialog.getByRole("status").filter({ hasText: "Profile saved." }).count()).toBe(0);
    await page.unroute("**/accounts:update?*");
    await dialog.getByRole("button", { name: "Save name" }).click();
    await dialog.getByRole("status").filter({ hasText: "Profile saved." }).waitFor();
    await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: /Sign in \/ Create account/ }).waitFor();
    expect(await dialog.count()).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: /Sign in \/ Create account/ }).waitFor();
    await context.close();
  });

  it("reports provider loading and errors rather than claiming an empty successful result", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(site.aiUrl, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await waiting;
      await route.fulfill({
        status: 503,
        headers: { "Access-Control-Allow-Origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({ error: "Connections temporarily unavailable", code: "unavailable" }),
      });
    });
    await open(page, false);
    const dialog = await settings(page);
    await dialog.getByRole("status").filter({ hasText: "Loading connections..." }).waitFor();
    expect(await dialog.getByText("Not verified", { exact: true }).isVisible()).toBe(true);
    release();
    await dialog
      .getByRole("alert")
      .filter({ hasText: "Connections temporarily unavailable" })
      .waitFor();
    expect(await dialog.getByText("AI is not connected.", { exact: true }).count()).toBe(0);
    await dialog.getByRole("button", { name: "Manage AI connection" }).click();
    const providers = page.getByRole("dialog", { name: "AI connection", exact: true });
    await providers.getByRole("button", { name: "Retry", exact: true }).waitFor();
    await page.unroute(site.aiUrl);
    await page.route(site.aiUrl, (route) =>
      route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({
          connections: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              name: "Test connection",
              provider: "openai",
              base_url: "https://api.openai.com/v1",
              model: "gpt-4o",
              model_name: "GPT-4o",
              models: [{ id: "gpt-4o", name: "GPT-4o" }],
              key_suffix: "1234",
              is_default: true,
              updated_at: new Date().toISOString(),
            },
          ],
        }),
      }),
    );
    await providers.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => providers.getByRole("alert").count()).toBe(0);
    await providers.getByRole("button", { name: "Close AI connection" }).click();
    const recovered = await settings(page);
    await recovered.getByText("Connected to OpenAI.", { exact: true }).waitFor();
    await context.close();
  });

  it("fits desktop, mobile, and short screens in both themes, contains focus, and restores it on Escape", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 640, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      const dialog = await settings(page);
      for (const theme of ["Day", "Night"]) {
        await dialog.getByRole("button", { name: theme, exact: true }).click();
        const geometry = await dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const body = element.querySelector(".app-dialog-body")!;
          return {
            x: bounds.x,
            y: bounds.y,
            right: bounds.right,
            bottom: bounds.bottom,
            overflow: element.scrollWidth - element.clientWidth,
            bodyOverflow: body.scrollHeight - body.clientHeight,
          };
        });
        expect(geometry.x).toBeGreaterThanOrEqual(0);
        expect(geometry.y).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(viewport.width);
        expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        if (viewport.height === 360) expect(geometry.bodyOverflow).toBeGreaterThan(0);
        const footer = await dialog
          .getByRole("button", { name: "Sign out", exact: true })
          .boundingBox();
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height);
        await dialog.getByRole("button", { name: "Close account dialog" }).focus();
        await page.keyboard.press("Shift+Tab");
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
      await page.keyboard.press("Escape");
      await expect.poll(() => dialog.count()).toBe(0);
      expect(
        await page
          .getByRole("button", { name: viewport.width <= 900 ? "Open sidebar" : /^Account/ })
          .evaluate((element) => element === document.activeElement),
      ).toBe(true);
    }
    await context.close();
  });
});
