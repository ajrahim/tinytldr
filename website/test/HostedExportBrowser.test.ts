import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { WorkspaceProjectSchema } from "@tinytldr/core";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import { chooseAction, downloadSource } from "./SourceEditorFixture.js";

describe.skipIf(!hasFirebaseEmulators)("Firebase-authenticated hosted exports", () => {
  let site: Awaited<ReturnType<typeof startWorkspaceTestServer>>;
  let browser: Browser;
  const renderUrl = "https://exports.example.test/v1/render";
  const assetUrl = `https://exports.example.test/v1/assets/${"a".repeat(64)}/6ae5b1ca-8a74-4d42-a08f-f53f28b08a55/design.png`;
  const corsHeaders = () => ({
    "Access-Control-Allow-Origin": site.baseUrl,
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  });

  beforeAll(async () => {
    site = await startWorkspaceTestServer({ renderApiUrl: "https://exports.example.test" });
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });

  async function open(page: Page) {
    await page.goto(site.baseUrl);
    await page
      .getByRole("dialog", { name: "Welcome to tinytldr." })
      .getByRole("button", { name: "Start Creating" })
      .click();
    await page.frameLocator('iframe[title="Design preview"]').locator("h1").waitFor();
  }

  async function previewPng(page: Page) {
    return page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#123456";
      context.fillRect(0, 0, 64, 64);
      return canvas.toDataURL("image/png");
    });
  }
  function rendered(previewDataUrl: string, url = assetUrl) {
    return {
      status: "completed",
      format: "png",
      assets: [{ url, filename: "design.png" }],
      previewDataUrl,
      width: 64,
      height: 64,
      pageCount: 1,
      warnings: [],
    };
  }

  it("blocks guest hosted rendering before sending a request and preserves local JSON downloads", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let requests = 0;
    await page.route(renderUrl, (route) => {
      requests++;
      return route.abort();
    });
    try {
      await open(page);
      const before = (await downloadSource(page, "Download design JSON")).text;
      await chooseAction(page, "PNG image");
      await page
        .getByRole("alert")
        .filter({ hasText: /Sign in.*export/i })
        .waitFor();
      expect(requests).toBe(0);
      expect((await downloadSource(page, "Download design JSON")).text).toBe(before);
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      expect(await page.locator(".media-card").count()).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("authenticates both hosted render POST and private artifact GET, retains the image, and blocks further exports after sign-out", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests: { method: string; url: string; authorization: string }[] = [];
    let png: string;
    await page.route("https://exports.example.test/**", async (route) => {
      const headers = corsHeaders();
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      requests.push({
        method: route.request().method(),
        url: route.request().url(),
        authorization: route.request().headers().authorization ?? "",
      });
      if (route.request().method() === "GET") {
        expect(route.request().url()).toBe(assetUrl);
        return route.fulfill({
          headers,
          contentType: "image/png",
          body: Buffer.from(png.split(",")[1]!, "base64"),
        });
      }
      const body = route.request().postDataJSON() as { document: unknown; format: string };
      expect(WorkspaceProjectSchema.parse(body.document).version).toBe(2);
      expect(body.format).toBe("png");
      return route.fulfill({
        headers,
        contentType: "application/json",
        body: JSON.stringify(rendered(png)),
      });
    });
    try {
      await open(page);
      png = await previewPng(page);
      const owner = await site.signIn(page);
      await chooseAction(page, "PNG image");
      await page.getByRole("status").filter({ hasText: "saved to My Library" }).waitFor();
      expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
        { method: "POST", url: renderUrl },
        { method: "GET", url: assetUrl },
      ]);
      for (const request of requests) {
        expect(request.authorization).toMatch(/^Bearer /);
        const identity = await site.auth.verifyIdToken(
          request.authorization.slice("Bearer ".length),
        );
        expect(identity.uid).toBe(owner.uid);
      }
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      await expect.poll(() => page.locator(".media-card").count()).toBe(1);
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      await page.getByRole("button", { name: /^Account/ }).click();
      await page
        .getByRole("dialog", { name: "Account & settings" })
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await chooseAction(page, "PNG image");
      await page
        .getByRole("alert")
        .filter({ hasText: /Sign in.*export/i })
        .waitFor();
      expect(requests).toHaveLength(2);
    } finally {
      await context.close();
    }
  });

  it("rejects a foreign artifact origin before sending its Firebase token or retaining any file", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const foreignRequests: string[] = [];
    let png: string;
    await page.route("https://attacker.example.test/**", (route) => {
      foreignRequests.push(route.request().headers().authorization ?? "");
      return route.abort();
    });
    await page.route(renderUrl, (route) => {
      const headers = corsHeaders();
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      return route.fulfill({
        headers,
        contentType: "application/json",
        body: JSON.stringify(rendered(png, "https://attacker.example.test/v1/assets/stolen.png")),
      });
    });
    try {
      await open(page);
      png = await previewPng(page);
      await site.signIn(page);
      await chooseAction(page, "PNG image");
      await page.getByRole("alert").filter({ hasText: "invalid private artifact URL" }).waitFor();
      expect(foreignRequests).toEqual([]);
      await page.getByRole("button", { name: "My Library", exact: true }).click();
      expect(await page.locator(".media-card").count()).toBe(0);
    } finally {
      await context.close();
    }
  });
});
