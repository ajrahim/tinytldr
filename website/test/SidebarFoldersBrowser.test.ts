import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { DESIGN_HISTORY_KEY } from "../src/lib/DesignHistory.js";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";

describe.skipIf(!hasFirebaseEmulators)("Sidebar folders", () => {
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

  async function open(page: Page) {
    await page.addInitScript(() => localStorage.setItem("tinytldr:welcome:v1", "seen"));
    await page.goto(site.baseUrl);
    await page.getByRole("region", { name: "Artboard canvas", exact: true }).waitFor();
    await expect
      .poll(() => page.getByRole("button", { name: "New design", exact: true }).isEnabled())
      .toBe(true);
  }

  async function createAccountDesign(page: Page, title: string) {
    await page.getByRole("button", { name: "New design", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9a-f-]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByRole("region", { name: "Artboard canvas", exact: true }).waitFor();
    await page.getByLabel("Design title", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await site.design(id)).revision).toBe(2);
    return id;
  }

  const count = (page: Page, name: string) =>
    page
      .getByRole("region", { name, exact: true })
      .locator(".design-section-heading .design-section-count")
      .textContent();

  it("creates, fills by drag and menu, searches, renames, and deletes account folders while Local stays fixed", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await open(page);
      expect(await page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY)).toBe(
        null,
      );
      const sidebar = page.getByRole("complementary", { name: "Your designs" });
      expect(await sidebar.getByRole("button", { name: "Create Folder" }).count()).toBe(0);
      await site.signIn(page);
      await createAccountDesign(page, "Alpha poster");
      await createAccountDesign(page, "Beta deck");
      const all = sidebar.getByRole("region", { name: "All", exact: true });
      await expect.poll(() => all.locator(".design-list-item").count()).toBe(2);

      const search = sidebar.getByRole("searchbox", { name: "Search designs" });
      const create = sidebar.getByRole("button", { name: "Create Folder" });
      expect((await search.boundingBox())!.y).toBeLessThan((await create.boundingBox())!.y);
      expect((await create.boundingBox())!.y).toBeLessThan((await all.boundingBox())!.y);

      await create.click();
      const name = sidebar.getByRole("textbox", { name: "New folder name" });
      await name.fill("Discarded");
      await name.press("Escape");
      expect(await name.count()).toBe(0);
      await create.click();
      await name.fill("Clients");
      await name.press("Enter");
      const clients = sidebar.getByRole("region", { name: "Clients", exact: true });
      await clients.waitFor();
      expect(await count(page, "Clients")).toBe("0");
      const local = sidebar.getByRole("region", { name: "Local", exact: true });
      const order = await sidebar
        .locator(".design-group h3")
        .evaluateAll((items) =>
          items.map((item) => item.getAttribute("aria-label") ?? item.textContent),
        );
      expect(order).toEqual(["All", "Clients", "Local"]);

      const alphaRow = all.locator(".design-list-row", { hasText: "Alpha poster" });
      expect(await alphaRow.getAttribute("draggable")).toBe("true");
      await alphaRow.dragTo(clients.locator(".design-section-heading"));
      await expect.poll(() => count(page, "Clients")).toBe("1");
      expect(await count(page, "All")).toBe("2");
      await page.reload();
      await clients.waitFor();
      await expect.poll(() => count(page, "Clients")).toBe("1");
      await clients.getByRole("button", { name: "Expand Clients section" }).click();
      await expect
        .poll(() => clients.locator(".design-list-item").textContent())
        .toBe("Alpha poster");

      await clients
        .locator(".design-list-row", { hasText: "Alpha poster" })
        .dragTo(all.locator(".design-section-heading"));
      await expect.poll(() => count(page, "Clients")).toBe("0");

      await all.getByRole("button", { name: "Actions for Beta deck" }).click();
      await page.getByRole("menuitem", { name: "Move to folder…" }).click();
      const move = page.getByRole("dialog", { name: "Move to folder" });
      await move.getByRole("combobox", { name: "Folder" }).selectOption({ label: "Clients" });
      await move.getByRole("button", { name: "Move", exact: true }).click();
      await expect.poll(() => move.count()).toBe(0);
      await expect.poll(() => count(page, "Clients")).toBe("1");

      await page.goto(site.baseUrl);
      await page.getByRole("region", { name: "Artboard canvas", exact: true }).waitFor();
      expect(await count(page, "Local")).toBe("0");
      await page.getByLabel("Design title", { exact: true }).fill("Local sketch");
      await expect.poll(() => count(page, "Local")).toBe("1");
      const localRow = local.locator(".design-list-row");
      expect(await localRow.getAttribute("draggable")).toBe(null);
      await all
        .locator(".design-list-row", { hasText: "Beta deck" })
        .dragTo(local.locator(".design-section-heading"));
      expect(await local.evaluate((element) => element.classList.contains("is-drop-target"))).toBe(
        false,
      );
      expect(await count(page, "Clients")).toBe("1");
      expect(await count(page, "Local")).toBe("1");
      await localRow.dragTo(clients.locator(".design-section-heading"));
      expect(await count(page, "Clients")).toBe("1");

      await search.fill("alpha");
      await expect
        .poll(() => all.locator(".design-list-item").allTextContents())
        .toEqual(["Alpha poster"]);
      expect(await clients.count()).toBe(0);
      expect(await local.locator(".empty-list").textContent()).toBe("No matches");
      await search.fill("beta");
      await clients.waitFor();
      expect(await clients.locator(".design-list-item").allTextContents()).toEqual(["Beta deck"]);
      await search.fill("");

      await clients.getByRole("button", { name: "Actions for folder Clients" }).click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      const rename = page.getByRole("dialog", { name: "Rename folder" });
      await rename.getByLabel("Folder name").fill("Work");
      await rename.getByRole("button", { name: "Rename", exact: true }).click();
      const work = sidebar.getByRole("region", { name: "Work", exact: true });
      await work.waitFor();
      await work.getByRole("button", { name: "Actions for folder Work" }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      const remove = page.getByRole("dialog", { name: "Delete folder?" });
      await remove.getByRole("button", { name: "Delete folder", exact: true }).click();
      await expect.poll(() => work.count()).toBe(0);
      expect(await all.locator(".design-list-item").count()).toBe(2);
    } finally {
      await context.close();
    }
  });

  it("fits search and folders in the phone drawer", async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => localStorage.setItem("tinytldr:welcome:v1", "seen"));
      await page.goto(site.baseUrl);
      await page.getByRole("region", { name: "Artboard canvas", exact: true }).waitFor();
      await site.signIn(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
      const drawer = page.getByRole("dialog", { name: "Your designs menu" });
      const width = (await drawer.boundingBox())!.width;
      await drawer.getByRole("button", { name: "Create Folder" }).tap();
      const name = drawer.getByRole("textbox", { name: "New folder name" });
      await name.fill("A folder name that is deliberately rather long");
      await name.press("Enter");
      const folder = drawer.getByRole("region", {
        name: "A folder name that is deliberately rather long",
        exact: true,
      });
      await folder.waitFor();
      for (const element of [
        drawer.getByRole("searchbox", { name: "Search designs" }),
        drawer.getByRole("button", { name: "Create Folder" }),
        drawer.getByRole("region", { name: "All", exact: true }),
        folder,
        folder.getByRole("button", { name: /^Actions for folder/ }),
        drawer.getByRole("region", { name: "Local", exact: true }),
      ]) {
        const box = (await element.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      }
      expect(
        await drawer
          .locator(".design-sidebar")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
});
