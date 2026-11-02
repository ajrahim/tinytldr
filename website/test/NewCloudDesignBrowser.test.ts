import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { FirebaseDesignRequestSchema } from "@tinytldr/core";
import { DESIGN_HISTORY_KEY, LocalDesignSchema } from "../src/lib/DesignHistory.js";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import { setSource, showSourceEditors } from "./SourceEditorFixture.js";

describe.skipIf(!hasFirebaseEmulators)("New cloud designs", () => {
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

  async function drafts(page: Page) {
    const raw = await page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY);
    return LocalDesignSchema.array().parse(JSON.parse(raw ?? "[]"));
  }

  it("keeps guests local, creates signed-in designs in the account immediately, and saves later edits explicitly", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await open(page);
      await page.getByLabel("Design title", { exact: true }).fill("Guest source");
      await expect.poll(async () => (await drafts(page))[0]?.document.title).toBe("Guest source");
      await page.getByRole("button", { name: "New design", exact: true }).click();
      await expect.poll(async () => (await drafts(page)).length).toBe(2);
      expect(page.url()).toBe(`${site.baseUrl}/`);
      expect(await page.getByRole("button", { name: "Claim", exact: true }).count()).toBe(1);
      const owner = await site.signIn(page);
      const localIds = (await drafts(page)).map((entry) => entry.id);
      expect(await page.getByRole("button", { name: "Claim", exact: true }).count()).toBe(1);
      await page.getByRole("button", { name: "New design", exact: true }).click();
      await page.waitForURL(/\/d\/[0-9a-f-]+$/);
      const id = new URL(page.url()).pathname.split("/").at(-1)!;
      await page.getByRole("region", { name: "Artboard canvas", exact: true }).waitFor();
      const saved = await site.design(id);
      expect(saved).toMatchObject({ owner_id: owner.uid, revision: 1 });
      expect(await page.getByRole("button", { name: "Claim", exact: true }).count()).toBe(0);
      const account = page.getByRole("region", { name: "Account", exact: true });
      await expect.poll(() => account.locator(".design-list-item").count()).toBe(1);
      expect((await drafts(page)).map((entry) => entry.id)).toEqual(localIds);
      await page.getByLabel("Design title", { exact: true }).fill("Cloud design");
      await expect.poll(() => page.locator(".save-caption").textContent()).toBe("Unsaved changes");
      expect((await site.design(id)).revision).toBe(1);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => (await site.design(id)).revision).toBe(2);
      await page.reload();
      await page.getByRole("region", { name: "Artboard canvas", exact: true }).waitFor();
      expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
        "Cloud design",
      );
      expect(await page.getByRole("button", { name: "Claim", exact: true }).count()).toBe(0);
      expect((await drafts(page)).map((entry) => entry.id)).toEqual(localIds);
    } finally {
      await context.close();
    }
  });

  it("blocks duplicate clicks and retries the same cloud creation without losing unfinished source", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let release: (() => void) | undefined;
    try {
      await open(page);
      await site.signIn(page);
      await page.getByLabel("Design title", { exact: true }).fill("Keep this draft");
      await showSourceEditors(page);
      await setSource(page, "JSON", "{ unfinished");
      await expect
        .poll(async () => Object.values((await drafts(page))[0]?.pageJson ?? {}))
        .toContain("{ unfinished");
      const before = (await drafts(page))[0]!;
      const creations: string[] = [];
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      let committed = false;
      await page.route(site.apiUrl, async (route) => {
        const request = route.request();
        if (request.method() !== "POST") return route.continue();
        const action = FirebaseDesignRequestSchema.parse(request.postDataJSON());
        if (action.action !== "save" || action.revision !== undefined) return route.continue();
        creations.push(action.id);
        if (creations.length > 1) return route.continue();
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committed = true;
        await blocked;
        await route.fulfill({
          response,
          status: 503,
          json: { error: "Temporary creation failure. Retry New design." },
        });
      });
      const button = page.getByRole("button", { name: "New design", exact: true });
      await button.click();
      await expect.poll(() => committed).toBe(true);
      expect(await button.isDisabled()).toBe(true);
      await button.evaluate((element) => {
        if (!(element instanceof HTMLButtonElement)) throw new Error("Expected New design button.");
        element.click();
      });
      expect(creations).toHaveLength(1);
      release!();
      await expect
        .poll(() => page.locator(".workspace-notices").textContent())
        .toContain("Temporary creation failure");
      expect(page.url()).toBe(`${site.baseUrl}/`);
      expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
        "Keep this draft",
      );
      expect((await drafts(page))[0]).toMatchObject({
        document: before.document,
        pageJson: before.pageJson,
      });
      await button.click();
      await page.waitForURL(`${site.baseUrl}/d/${creations[0]}`);
      expect(creations).toEqual([creations[0], creations[0]]);
      const saved = await site.design(creations[0]!);
      expect(saved.revision).toBe(1);
      const owned = await site.db
        .collection("designs")
        .where("owner_id", "==", saved.owner_id)
        .get();
      expect(owned.size).toBe(1);
    } finally {
      release?.();
      await context.close();
    }
  });

  it.each(["navigation", "account change"] as const)(
    "does not redirect a later workspace after %s while creation is pending",
    async (change) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      let release: (() => void) | undefined;
      try {
        await open(page);
        const owner = await site.signIn(page);
        const local = (await drafts(page))[0]!;
        const blocked = new Promise<void>((resolve) => {
          release = resolve;
        });
        let createdId: string | undefined;
        let completed = false;
        await page.route(site.apiUrl, async (route) => {
          const request = route.request();
          if (request.method() !== "POST") return route.continue();
          const action = FirebaseDesignRequestSchema.parse(request.postDataJSON());
          if (action.action !== "save" || action.revision !== undefined) return route.continue();
          const response = await route.fetch();
          createdId = action.id;
          await blocked;
          await route.fulfill({ response });
          completed = true;
        });
        await page.getByRole("button", { name: "New design", exact: true }).click();
        await expect.poll(() => createdId).toBeTruthy();
        if (change === "navigation") {
          await page.getByRole("button", { name: "Untitled design", exact: true }).click();
          await page.waitForURL(`${site.baseUrl}/local/${local.id}`);
        } else {
          await site.signIn(page);
        }
        const destination = page.url();
        release!();
        await expect.poll(() => completed).toBe(true);
        await expect
          .poll(() => page.getByRole("button", { name: "New design", exact: true }).isEnabled())
          .toBe(true);
        expect(page.url()).toBe(destination);
        expect((await site.design(createdId!)).owner_id).toBe(owner.uid);
        const account = page.getByRole("region", { name: "Account", exact: true });
        await expect
          .poll(() => account.locator(".design-list-item").count())
          .toBe(change === "navigation" ? 1 : 0);
      } finally {
        release?.();
        await context.close();
      }
    },
  );
});
