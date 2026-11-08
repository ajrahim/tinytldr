import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import { chooseSiteTheme } from "./SiteChromeFixture.js";

async function style(panel: Locator, item: Locator) {
  return {
    panel: await panel.evaluate((element) => {
      const css = getComputedStyle(element);
      return {
        background: css.backgroundColor,
        border: css.border,
        radius: css.borderRadius,
        shadow: css.boxShadow,
        padding: css.padding,
        fontSize: css.fontSize,
      };
    }),
    item: await item.evaluate((element) => {
      const css = getComputedStyle(element);
      return {
        padding: css.padding,
        radius: css.borderRadius,
        fontSize: css.fontSize,
        lineHeight: css.lineHeight,
      };
    }),
  };
}

async function fits(panel: Locator, page: Page) {
  const bounds = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(7.9);
  expect(bounds.y).toBeGreaterThanOrEqual(7.9);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 7.9);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 7.9);
}

describe.skipIf(!hasFirebaseEmulators)("Consistent website dropdowns", () => {
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

  it("shares exact panel and row styles across Export, context, provider, Versions and mentions in both themes and viewport sizes", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(site.baseUrl);
    await page.getByRole("button", { name: "Start Creating" }).click();
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const theme of ["Day", "Night"]) {
        await chooseSiteTheme(page, theme);
        await page.getByRole("button", { name: "More", exact: true }).click();
        const exports = page.getByRole("menu", { name: "Design actions" });
        const baseline = await style(
          exports,
          exports.getByRole("menuitem", { name: "Import JSON" }),
        );
        expect(baseline.panel.radius).toBe("9px");
        expect(baseline.panel.padding).toBe("5px");
        expect(baseline.item.fontSize).toBe("11px");
        await fits(exports, page);
        await page.keyboard.press("Escape");

        await page.getByRole("button", { name: "Add context", exact: true }).click();
        const add = page.getByRole("menu", { name: "Add context", exact: true });
        expect(
          await style(add, add.getByRole("menuitem", { name: "Add text", exact: true })),
        ).toEqual(baseline);
        await fits(add, page);
        await page.keyboard.press("Escape");

        await page.getByRole("combobox", { name: "Model", exact: true }).click();
        const providers = page.getByRole("listbox", { name: "Model", exact: true });
        expect(
          await style(
            providers,
            providers.getByRole("option", { name: "Connect AI...", exact: true }),
          ),
        ).toEqual(baseline);
        await fits(providers, page);
        expect(
          await providers
            .getByRole("option", { name: "Connect AI", exact: true })
            .getAttribute("aria-selected"),
        ).toBe("true");
        await page.keyboard.press("Escape");

        await page.getByRole("button", { name: "Versions", exact: true }).click();
        const versions = page.getByRole("dialog", { name: "Saved versions" });
        expect(await style(versions, versions.getByRole("button", { name: /^Latest/ }))).toEqual(
          baseline,
        );
        await fits(versions, page);
        await page.keyboard.press("Escape");

        await page.getByLabel("Describe your idea").fill("@");
        const mentions = page.getByRole("listbox", { name: "Choose artboards" });
        expect(await style(mentions, mentions.getByRole("option").first())).toEqual(baseline);
        await page.getByLabel("Describe your idea").press("Escape");
        await page.getByLabel("Describe your idea").fill("");
      }
    }
    await context.close();
  });

  it("preserves typed values, skips disabled rows, supports typeahead and keyboard dismissal, and scrolls long lists inside dialogs", async () => {
    const context = await browser.newContext({ viewport: { width: 320, height: 360 } });
    const page = await context.newPage();
    await page.goto(`${site.baseUrl}/test/DropdownShowcase.html?mode=dialog`);
    const dialog = page.getByRole("dialog", { name: "Dropdown dialog" });
    const trigger = dialog.getByRole("combobox", { name: "Long options" });
    await trigger.press("ArrowDown");
    const list = page.getByRole("listbox", { name: "Long options" });
    await fits(list, page);
    const activeValue = () =>
      page.evaluate(() => document.activeElement?.getAttribute("data-value"));
    await expect.poll(activeValue).toBe("1");
    await page.keyboard.press("ArrowDown");
    expect(await activeValue()).toBe("3");
    await page.keyboard.press("End");
    expect(await activeValue()).toBe("50");
    expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    expect(await page.getByLabel("Selected value").textContent()).toBe("50");
    expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(true);
    await trigger.click();
    expect(await activeValue()).toBe("50");
    await page.keyboard.press("Home");
    await page.keyboard.type("Choice 03");
    expect(await activeValue()).toBe("3");
    await page.keyboard.press("Escape");
    expect(await dialog.isVisible()).toBe(true);
    expect(await trigger.getAttribute("aria-expanded")).toBe("false");
    await trigger.press("ArrowDown");
    await page.keyboard.press("Space");
    expect(await page.getByLabel("Selected value").textContent()).toBe("1");
    expect(await list.isVisible()).toBe(false);
    await trigger.click();
    await page.keyboard.press("Tab");
    expect(await list.isVisible()).toBe(false);
    expect(
      await page
        .getByRole("button", { name: "After dropdowns" })
        .evaluate((element) => element === document.activeElement),
    ).toBe(true);
    expect(await dialog.getByRole("combobox", { name: "Disabled choice" }).isDisabled()).toBe(true);
    await trigger.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const bounds = (await list.boundingBox())!;
        return bounds.x >= 8 && bounds.x + bounds.width <= 382;
      })
      .toBe(true);
    await dialog.click({ position: { x: 2, y: 2 } });
    expect(await list.isVisible()).toBe(false);
    await context.close();
  });
});
