import http from "node:http";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDesignGateway } from "../src/DesignGateway.js";
import { DesignService } from "../src/DesignService.js";
import { chooseAction } from "../../test/SourceEditorFixture.js";
import { expectDialogLayout } from "../../test/DialogBrowserFixture.js";
import { createAiGateway } from "../../server/AiGateway.js";
import { AiConnectionService } from "../src/AiConnectionService.js";
import { createFirebaseUserVerifier } from "../src/FirebaseIdentity.js";
import { WorkspaceProjectSchema } from "@tinytldr/core";
import { chooseDropdown } from "../../test/DropdownFixture.js";
import { downloadSource, setSource } from "../../test/SourceEditorFixture.js";
import { LocalDesignSchema, DESIGN_HISTORY_KEY } from "../../src/lib/DesignHistory.js";
import { SavedWorkspaceDesignSchema } from "@tinytldr/core";
import { chooseSiteTheme } from "../../test/SiteChromeFixture.js";

const SourceRecoverySchema = z.object({
  document: WorkspaceProjectSchema,
  pageJson: z.record(z.string()),
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)(
  "Firebase workspace browser against real emulators",
  () => {
    const app = initializeApp({ projectId: "demo-tinytldr" }, "firebase-browser-tests");
    const database = getFirestore(app);
    let api: http.Server;
    let site: ViteDevServer;
    let browser: Browser;
    let baseUrl: string;
    let cacheDir: string | undefined;
    const origins: string[] = [];
    const requests = new Set<Promise<void>>();
    const providerKey = "firebase-browser-test-key-never-for-network";
    const aiRequests: RequestInit[] = [];
    let rejectCatalog = false;
    let generationWait: Promise<void> | undefined;
    let generationEntered: (() => void) | undefined;
    let finishedGenerations = 0;
    const aiService = new AiConnectionService(database, () => "ab".repeat(32));

    beforeAll(async () => {
      const gateway = createDesignGateway({
        service: new DesignService(database),
        allowedOrigins: origins,
        verifyUser: async (token) => (await getAuth(app).verifyIdToken(token)).uid,
        reportError: (error) => {
          console.error("Firebase browser test gateway error", error);
        },
      });
      const aiGateway = createAiGateway({
        store: aiService,
        allowedOrigins: origins,
        customBaseUrls: [],
        verifyUser: createFirebaseUserVerifier(getAuth(app)),
        reportError: (code) => console.error("Firebase AI browser gateway failed:", code),
        fetch: async (_url, options) => {
          aiRequests.push(options!);
          if (options?.method === "GET") {
            return rejectCatalog
              ? Response.json({ error: providerKey }, { status: 401 })
              : Response.json({ data: [{ id: "gpt-test" }, { id: "gpt-next" }] });
          }
          generationEntered?.();
          await generationWait;
          const body = z
            .object({
              messages: z.array(
                z.object({
                  content: z.union([
                    z.string(),
                    z.array(z.object({ type: z.string(), text: z.string().optional() })),
                  ]),
                }),
              ),
            })
            .parse(JSON.parse(String(options?.body)));
          const content = body.messages[1]!.content;
          const text =
            typeof content === "string"
              ? content
              : content.find((part) => part.type === "text")!.text!;
          let output = "OK";
          if (text !== "Reply with OK.") {
            const project = WorkspaceProjectSchema.parse(
              z.object({ currentProject: z.unknown() }).parse(JSON.parse(text)).currentProject,
            );
            project.pages[0]!.data.headline = "Firebase generated draft";
            project.pages[0]!.template.manifest.sampleData = project.pages[0]!.data;
            output = JSON.stringify(project);
          }
          finishedGenerations++;
          return Response.json({
            choices: [{ finish_reason: "stop", message: { content: output } }],
          });
        },
      });
      api = http.createServer((request, response) => {
        const handling = (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers))
            if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
          const result = await (request.url === "/ai" ? aiGateway : gateway)(
            new Request("http://designs.test", {
              method: request.method,
              headers,
              ...(request.method === "POST"
                ? { body: Buffer.concat(chunks).toString("utf8") }
                : {}),
            }),
          );
          response.writeHead(result.status, Object.fromEntries(result.headers));
          response.end(await result.text());
        })().catch((error: unknown) => {
          console.error("Firebase browser test HTTP failure", error);
          response.writeHead(500).end();
        });
        requests.add(handling);
        void handling.finally(() => requests.delete(handling));
      });
      await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
      const address = api.address();
      if (!address || typeof address === "string")
        throw new Error("Firebase test API did not bind.");
      cacheDir = await mkdtemp(join(process.cwd(), ".test-firebase-browser-"));
      site = await createServer({
        cacheDir,
        configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
        root: fileURLToPath(new URL("../../", import.meta.url)),
        define: {
          "import.meta.env.VITE_TINYTLDR_FIREBASE_API_KEY": JSON.stringify("test-web-key"),
          "import.meta.env.VITE_TINYTLDR_FIREBASE_PROJECT_ID": JSON.stringify("demo-tinytldr"),
          "import.meta.env.VITE_TINYTLDR_FIREBASE_APP_ID": JSON.stringify("test-app"),
          "import.meta.env.VITE_TINYTLDR_FIREBASE_AUTH_DOMAIN": JSON.stringify(
            "demo-tinytldr.firebaseapp.com",
          ),
          "import.meta.env.VITE_TINYTLDR_FIREBASE_AUTH_EMULATOR_URL": JSON.stringify(
            `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,
          ),
          "import.meta.env.VITE_TINYTLDR_FIREBASE_DESIGNS_URL": JSON.stringify(
            `http://127.0.0.1:${address.port}`,
          ),
          "import.meta.env.VITE_TINYTLDR_FIREBASE_AI_URL": JSON.stringify(
            `http://127.0.0.1:${address.port}/ai`,
          ),
        },
        server: { host: "127.0.0.1", port: 0, hmr: false },
        logLevel: "error",
      });
      await site.listen();
      const siteAddress = site.httpServer?.address();
      if (!siteAddress || typeof siteAddress === "string")
        throw new Error("Firebase test website did not bind.");
      baseUrl = `http://127.0.0.1:${siteAddress.port}`;
      origins.push(baseUrl);
      browser = await chromium.launch({ headless: true });
    });
    afterAll(async () => {
      await browser?.close();
      await site?.close();
      if (api)
        await new Promise<void>((resolve, reject) =>
          api.close((error) => (error ? reject(error) : resolve())),
        );
      await Promise.all(requests);
      await database.terminate();
      await deleteApp(app);
      if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
    });

    // Fresh windows stay out of Local until edited; restore the title after a real edit.
    async function touchDraft(page: Page) {
      const title = page.getByLabel("Design title", { exact: true });
      const value = await title.inputValue();
      await title.fill(`${value} `);
      await title.fill(value);
      await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), DESIGN_HISTORY_KEY))
        .not.toBe(null);
    }
    async function openLogin(page: Page) {
      if (page.viewportSize()!.width <= 900)
        await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
      await page.getByRole("button", { name: /Sign in \/ Create account/ }).click();
      await page.getByRole("dialog", { name: "Sign in", exact: true }).waitFor();
    }

    async function newLoginContext() {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        if (window.top === window) localStorage.setItem("tinytldr:welcome:v1", "seen");
      });
      // The Auth emulator does not implement this SDK endpoint.
      await context.route(
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v2/passwordPolicy?*`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              customStrengthOptions: { minPasswordLength: 6, maxPasswordLength: 4096 },
              enforcementState: "ENFORCE",
              schemaVersion: 1,
            }),
          }),
      );
      return context;
    }

    it("uses compact context menus and aligns sidebar edges outside short/long-list scrollbars, with a real New design button", async () => {
      const context = await newLoginContext();
      const page = await context.newPage();
      const uid = `sidebar-context-${randomUUID()}`;
      await getAuth(app).createUser({ uid });
      try {
        await page.goto(baseUrl);
        await touchDraft(page);
        const token = await getAuth(app).createCustomToken(uid);
        await page.evaluate(
          `import("/test/FirebaseSessionFixture.ts").then(({ signInTestAccount }) => signInTestAccount(${JSON.stringify(token)}))`,
        );
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        await expect
          .poll(() => page.getByRole("button", { name: "Claim", exact: true }).isEnabled())
          .toBe(true);
        const original = LocalDesignSchema.array().parse(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
            DESIGN_HISTORY_KEY,
          ),
        )[0]!;
        let seededIds: string[] = [];
        for (const count of [1, 106]) {
          seededIds = await page.evaluate(
            ({ entry, count, key }) => {
              const drafts = Array.from({ length: count }, (_, index) => ({
                ...entry,
                id: index === 0 ? entry.id : crypto.randomUUID(),
                document: { ...entry.document, title: `Context-menu draft ${index}` },
              }));
              localStorage.setItem(key, JSON.stringify(drafts));
              window.dispatchEvent(new StorageEvent("storage", { key }));
              return drafts.map((draft) => draft.id);
            },
            { entry: original, count, key: DESIGN_HISTORY_KEY },
          );
          for (const width of [1440, 390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            for (const theme of ["Day", "Night"] as const) {
              await chooseSiteTheme(page, theme);
              if (width <= 900)
                await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
              const sidebar = page.getByRole("complementary", {
                name: "Your designs",
                exact: true,
              });
              const nav = sidebar.locator("nav");
              expect(
                await sidebar
                  .getByRole("button", { name: "About tinytldr" })
                  .evaluate((element) => ({
                    size: getComputedStyle(element).fontSize,
                    text: element.textContent,
                    children: element.childElementCount,
                    monochrome:
                      getComputedStyle(element).color ===
                      getComputedStyle(element.closest("aside")!).color,
                  })),
              ).toEqual({ size: "15.2px", text: "tinytldr.", children: 0, monochrome: true });
              await nav.evaluate((element) => {
                element.scrollTop = 0;
              });
              const geometry = await sidebar.evaluate((element) => {
                const required = (selector: string) => {
                  const child = element.querySelector(selector);
                  if (!child) throw new Error(`Missing sidebar geometry target: ${selector}`);
                  return child;
                };
                const right = (child: Element) => child.getBoundingClientRect().right;
                const labelLeft = (child: Element) => {
                  const label = child.lastChild;
                  if (!label) throw new Error("Missing sidebar button label");
                  const range = document.createRange();
                  range.selectNodeContents(label);
                  return range.getBoundingClientRect().left;
                };
                const nav = required("nav");
                const agentIcon = required(".sidebar-mcp-card .lucide-sparkles");
                const accountIcon = required(".sidebar-account-card .lucide-user-round");
                const card = required(".sidebar-mcp-card");
                const newButton = required(".new-design-button");
                const libraryButton = required(".library-button");
                return {
                  cardRight: right(card),
                  agentIconRight: right(agentIcon),
                  accountIconRight: right(accountIcon),
                  accountSubtitleRight: right(required(".sidebar-account-card small")),
                  accountSubtitleBelowIcon:
                    required(".sidebar-account-card small").getBoundingClientRect().top >
                    accountIcon.getBoundingClientRect().bottom,
                  iconsHidden: [agentIcon, accountIcon].every(
                    (icon) => icon.getAttribute("aria-hidden") === "true",
                  ),
                  iconWidths: [agentIcon, accountIcon].map(
                    (icon) => icon.getBoundingClientRect().width,
                  ),
                  rowRight: right(required(".design-list-row")),
                  ellipsisRight: right(required(".design-row-actions svg")),
                  countRights: Array.from(element.querySelectorAll(".design-section-count"), right),
                  cardLeft: card.getBoundingClientRect().left,
                  newButtonLeft: newButton.getBoundingClientRect().left,
                  newButtonWidth: newButton.getBoundingClientRect().width,
                  cardWidth: card.getBoundingClientRect().width,
                  plusLeft: required(".new-design-button svg").getBoundingClientRect().left,
                  libraryIconLeft: required(".library-button svg").getBoundingClientRect().left,
                  newLabelLeft: labelLeft(newButton),
                  libraryLabelLeft: labelLeft(libraryButton),
                  navRight: right(nav),
                  sidebarRight: right(element),
                  overflowsVertically: nav.scrollHeight > nav.clientHeight,
                  overflowsHorizontally: nav.scrollWidth > nav.clientWidth,
                };
              });
              expect(Math.abs(geometry.rowRight - geometry.cardRight)).toBeLessThanOrEqual(1);
              expect(
                Math.abs(geometry.accountIconRight - geometry.agentIconRight),
              ).toBeLessThanOrEqual(1);
              expect(
                Math.abs(geometry.accountSubtitleRight - geometry.agentIconRight),
              ).toBeLessThanOrEqual(1);
              expect(geometry.accountSubtitleBelowIcon).toBe(true);
              expect(geometry.iconsHidden).toBe(true);
              expect(geometry.iconWidths).toEqual([14, 14]);
              expect(Math.abs(geometry.newButtonLeft - geometry.cardLeft)).toBeLessThanOrEqual(1);
              expect(Math.abs(geometry.plusLeft - geometry.libraryIconLeft)).toBeLessThanOrEqual(1);
              expect(
                Math.abs(geometry.newLabelLeft - geometry.libraryLabelLeft),
              ).toBeLessThanOrEqual(1);
              expect(geometry.newButtonWidth).toBeLessThan(geometry.cardWidth);
              expect(geometry.newButtonWidth).toBeLessThanOrEqual(120);
              expect(
                Math.abs(geometry.ellipsisRight - geometry.agentIconRight),
              ).toBeLessThanOrEqual(1);
              expect(
                geometry.countRights.every(
                  (right) => Math.abs(right - geometry.agentIconRight) <= 1,
                ),
              ).toBe(true);
              expect(geometry.navRight).toBeGreaterThan(geometry.cardRight);
              expect(geometry.navRight).toBeLessThanOrEqual(geometry.sidebarRight);
              expect(geometry.overflowsVertically).toBe(count > 1);
              expect(geometry.overflowsHorizontally).toBe(false);
              const button = sidebar.getByRole("button", { name: "New design", exact: true });
              const buttonStyle = await button.evaluate((element) => {
                const css = getComputedStyle(element);
                return {
                  background: css.backgroundColor,
                  color: css.color,
                  border: css.borderStyle,
                  radius: css.borderRadius,
                  weight: css.fontWeight,
                  height: css.height,
                  fontSize: css.fontSize,
                  alignment: css.justifyContent,
                };
              });
              expect(buttonStyle).toEqual({
                background: theme === "Day" ? "rgb(17, 17, 19)" : "rgb(244, 244, 245)",
                color: theme === "Day" ? "rgb(255, 255, 255)" : "rgb(17, 17, 19)",
                border: "solid",
                radius: "6px",
                weight: "600",
                height: "32px",
                fontSize: "11px",
                alignment: "flex-start",
              });
              const preceding =
                width <= 900
                  ? sidebar.getByRole("button", { name: "Close sidebar", exact: true })
                  : sidebar.getByRole("button", { name: "About tinytldr", exact: true });
              await preceding.press("Tab");
              expect(
                await button.evaluate(
                  (element) =>
                    element === document.activeElement &&
                    getComputedStyle(element).outlineWidth === "2px",
                ),
              ).toBe(true);
              const trigger = sidebar.getByRole("button", {
                name: "Actions for Context-menu draft 0",
                exact: true,
              });
              await trigger.press("ArrowDown");
              const menu = page.getByRole("menu", {
                name: "Actions for Context-menu draft 0",
                exact: true,
              });
              const bounds = (await menu.boundingBox())!;
              expect(bounds.width).toBe(140);
              expect(bounds.x).toBeGreaterThanOrEqual(8);
              expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8);
              expect(await menu.evaluate((element) => getComputedStyle(element).borderRadius)).toBe(
                "6px",
              );
              expect(
                await menu
                  .getByRole("menuitem", { name: "Claim", exact: true })
                  .evaluate((element) => element === document.activeElement),
              ).toBe(true);
              await page.keyboard.press("End");
              expect(
                await menu
                  .getByRole("menuitem", { name: "Delete", exact: true })
                  .evaluate((element) => element === document.activeElement),
              ).toBe(true);
              await page.keyboard.press("Escape");
              expect(await trigger.getAttribute("aria-expanded")).toBe("false");
              expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(
                true,
              );
              await trigger.press("ArrowDown");
              await page.keyboard.press("Tab");
              await expect.poll(() => menu.isVisible()).toBe(false);
              await trigger.click();
              await sidebar.getByRole("searchbox", { name: "Search designs" }).click();
              await expect.poll(() => menu.isVisible()).toBe(false);
              const bottomBefore = await sidebar.locator(".sidebar-bottom").boundingBox();
              await nav.evaluate((element) => {
                element.scrollTop = element.scrollHeight;
              });
              expect(await sidebar.locator(".sidebar-bottom").boundingBox()).toEqual(bottomBefore);
              if (width <= 900)
                await sidebar.getByRole("button", { name: "Close sidebar", exact: true }).click();
              const claim = page.getByRole("button", { name: "Claim", exact: true });
              const claimStyle = await claim.evaluate((element) => {
                const css = getComputedStyle(element);
                const header = element.closest(".site-header");
                const icon = element.querySelector("svg");
                const label = element.querySelector(".header-action-label");
                if (!header || !icon || !label) throw new Error("Missing Claim button structure");
                return {
                  border: css.borderStyle,
                  borderWidth: css.borderWidth,
                  visibleBorder:
                    css.borderColor !== getComputedStyle(header).backgroundColor &&
                    css.borderColor !== "rgba(0, 0, 0, 0)",
                  height: css.height,
                  children: Array.from(element.children, (child) => child.tagName.toLowerCase()),
                  circle: icon.querySelector("circle") !== null,
                  check: icon.querySelector("path") !== null,
                  hiddenIcon: icon.getAttribute("aria-hidden"),
                  labelDisplay: getComputedStyle(label).display,
                  iconAfterLabel:
                    icon.getBoundingClientRect().left >= label.getBoundingClientRect().right,
                };
              });
              expect(claimStyle).toMatchObject({
                border: "solid",
                borderWidth: "1px",
                visibleBorder: true,
                height: "32px",
                children: ["span", "svg"],
                circle: true,
                check: true,
                hiddenIcon: "true",
              });
              expect(claimStyle.labelDisplay === "none").toBe(width <= 450);
              if (width > 450) expect(claimStyle.iconAfterLabel).toBe(true);
              const claimBox = (await claim.boundingBox())!;
              const saveBox = (await page
                .getByRole("button", { name: "Save", exact: true })
                .boundingBox())!;
              expect(claimBox.height).toBe(saveBox.height);
              expect(claimBox.x + claimBox.width).toBeLessThanOrEqual(saveBox.x);
              expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(width);
              expect(
                await page
                  .locator(".site-header")
                  .evaluate((element) => element.scrollWidth <= element.clientWidth),
              ).toBe(true);
              await page.getByRole("button", { name: "More", exact: true }).click();
              const ordinary = page.getByRole("menu", { name: "Design actions", exact: true });
              expect((await ordinary.boundingBox())!.width).toBe(236);
              expect(
                await ordinary.evaluate((element) => getComputedStyle(element).borderRadius),
              ).toBe("9px");
              await page.keyboard.press("Escape");
            }
          }
        }
        await page.setViewportSize({ width: 1440, height: 844 });
        const button = page.getByRole("button", { name: "New design", exact: true });
        await button.hover();
        expect(await button.evaluate((element) => getComputedStyle(element).filter)).toBe(
          "brightness(0.93)",
        );
        await page.mouse.down();
        try {
          expect(await button.evaluate((element) => getComputedStyle(element).filter)).toBe(
            "brightness(0.85)",
          );
        } finally {
          await page.mouse.move(600, 30);
          await page.mouse.up();
        }
        await button.press("Enter");
        await page.waitForURL(/\/d\/[0-9a-f-]+$/);
        const cloudId = new URL(page.url()).pathname.split("/").at(-1)!;
        const created = SavedWorkspaceDesignSchema.parse(
          await new DesignService(database).execute({ action: "get", id: cloudId }, uid),
        );
        expect(created.owner_id).toBe(uid);
        await page.getByRole("region", { name: "Artboard canvas", exact: true }).waitFor();
        expect(await page.getByRole("button", { name: "Claim", exact: true }).count()).toBe(0);
        const retained = LocalDesignSchema.array().parse(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
            DESIGN_HISTORY_KEY,
          ),
        );
        expect(retained).toHaveLength(106);
        expect(seededIds.every((id) => retained.some((entry) => entry.id === id))).toBe(true);
        await database.recursiveDelete(database.collection("designs").doc(cloudId));
      } finally {
        await context.close();
      }
    });

    it("offers title tooltips and sibling menus, preserves raw edits on rename/claim, and confirms permanent deletion", async () => {
      const context = await newLoginContext();
      const page = await context.newPage();
      const uid = `design-controls-${randomUUID()}`;
      await getAuth(app).createUser({ uid });
      try {
        await page.goto(baseUrl);
        await page.getByLabel("Design title", { exact: true }).waitFor();
        await touchDraft(page);
        const claim = page.getByRole("button", { name: "Claim", exact: true });
        const save = page.getByRole("button", { name: "Save", exact: true });
        await expect.poll(() => claim.isEnabled()).toBe(true);
        const claimBox = (await claim.boundingBox())!;
        expect(claimBox.x + claimBox.width).toBeLessThanOrEqual((await save.boundingBox())!.x);
        await claim.click();
        await page.getByRole("dialog", { name: "Sign in", exact: true }).waitFor();
        await page.getByRole("button", { name: "Close account dialog" }).click();
        const originalTitle = await page.getByLabel("Design title", { exact: true }).inputValue();
        const originalJson = (await downloadSource(page, "Template JSON")).text;
        const original = WorkspaceProjectSchema.parse(
          JSON.parse((await downloadSource(page, "Download design JSON")).text),
        );
        const local = LocalDesignSchema.array().parse(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
            DESIGN_HISTORY_KEY,
          ),
        )[0]!;
        await setSource(page, "JSON", "{ unfinished raw source");
        await expect.poll(() => claim.isDisabled()).toBe(true);
        const actions = page.getByRole("button", {
          name: `Actions for ${originalTitle}`,
          exact: true,
        });
        expect(
          await actions.evaluate((button) =>
            button.parentElement?.parentElement
              ?.querySelector(".design-list-item")
              ?.contains(button),
          ),
        ).toBe(false);
        expect(await page.locator(".draft-dot").count()).toBe(0);
        expect(await page.locator(".info-tooltip-trigger svg").count()).toBe(0);
        await actions.press("ArrowDown");
        await page.getByRole("menuitem", { name: "Claim", exact: true }).press("ArrowDown");
        await page.getByRole("menuitem", { name: "Rename", exact: true }).press("Enter");
        const rename = page.getByRole("dialog", { name: "Rename design", exact: true });
        await expectDialogLayout(rename, page.viewportSize()!);
        await rename.getByLabel("Design name").fill(" ");
        expect(await rename.getByRole("button", { name: "Rename", exact: true }).isDisabled()).toBe(
          true,
        );
        await rename.getByLabel("Design name").fill("Renamed browser draft");
        await rename.getByRole("button", { name: "Rename", exact: true }).click();
        await expect.poll(() => rename.count()).toBe(0);
        const recovery = SourceRecoverySchema.parse(
          JSON.parse((await downloadSource(page, "Download design JSON")).text),
        );
        expect(recovery.document).toEqual({ ...original, title: "Renamed browser draft" });
        expect(recovery.pageJson?.[original.pages[0]!.id]).toBe("{ unfinished raw source");
        await page
          .getByRole("button", { name: "Actions for Renamed browser draft", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Claim", exact: true }).click();
        await page.getByRole("dialog", { name: "Sign in", exact: true }).waitFor();
        await page.getByRole("button", { name: "Close account dialog" }).click();
        const token = await getAuth(app).createCustomToken(uid);
        await page.evaluate(
          `import("/test/FirebaseSessionFixture.ts").then(({ signInTestAccount }) => signInTestAccount(${JSON.stringify(token)}))`,
        );
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        await page
          .getByRole("button", { name: "Actions for Renamed browser draft", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Claim", exact: true }).click();
        await page.getByText("Fix the page errors before saving.", { exact: true }).waitFor();
        expect((await database.collection("designs").doc(local.id).get()).exists).toBe(false);
        await setSource(page, "JSON", originalJson);
        await expect.poll(() => claim.isEnabled()).toBe(true);
        await claim.click();
        await page
          .getByRole("region", { name: "All", exact: true })
          .getByRole("button", { name: "Renamed browser draft", exact: true })
          .waitFor();
        expect(await claim.count()).toBe(0);
        expect((await database.collection("designs").doc(local.id).get()).get("owner_id")).toBe(
          uid,
        );
        await setSource(page, "JSON", "{ keep this owned raw edit");
        await page
          .getByRole("button", { name: "Actions for Renamed browser draft", exact: true })
          .click();
        expect(await page.getByRole("menuitem", { name: "Claim", exact: true }).count()).toBe(0);
        await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
        await rename.getByLabel("Design name").fill("Renamed saved design");
        await rename.getByRole("button", { name: "Rename", exact: true }).click();
        await expect.poll(() => rename.count()).toBe(0);
        const saved = SavedWorkspaceDesignSchema.parse(
          await new DesignService(database).execute({ action: "get", id: local.id }, null),
        );
        expect(saved.document).toEqual({ ...original, title: "Renamed saved design" });
        expect(saved.revision).toBe(2);
        expect(
          SourceRecoverySchema.parse(
            JSON.parse((await downloadSource(page, "Download design JSON")).text),
          ).pageJson?.[original.pages[0]!.id],
        ).toBe("{ keep this owned raw edit");
        const account = page.getByRole("region", { name: "All", exact: true });
        await account
          .getByRole("button", { name: "Actions for Renamed saved design", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
        const deletion = page.getByRole("dialog", { name: "Delete design?", exact: true });
        expect(
          await deletion
            .getByRole("button", { name: "Cancel" })
            .evaluate((button) => button === document.activeElement),
        ).toBe(true);
        await deletion.getByRole("button", { name: "Cancel" }).click();
        expect(
          (await database.collection("designs").doc(local.id).collection("versions").get()).size,
        ).toBe(2);
        await account
          .getByRole("button", { name: "Actions for Renamed saved design", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
        await deletion.getByRole("button", { name: "Delete permanently" }).click();
        await expect.poll(() => new URL(page.url()).pathname).toBe("/");
        await expect
          .poll(() =>
            account.getByRole("button", { name: "Renamed saved design", exact: true }).count(),
          )
          .toBe(0);
        expect(
          (await database.collection("designs").doc(local.id).collection("versions").get()).size,
        ).toBe(0);
        expect(
          (await database.collection("designs").doc(local.id).get()).get("deleted_at"),
        ).toBeTruthy();
      } finally {
        await context.close();
      }
    });

    it("claims inactive saved recovery without navigating, protects conflicts, and manages invalid local drafts on mobile", async () => {
      const context = await newLoginContext();
      const page = await context.newPage();
      const uid = `inactive-controls-${randomUUID()}`;
      const service = new DesignService(database);
      await getAuth(app).createUser({ uid });
      try {
        await page.goto(baseUrl);
        await touchDraft(page);
        const token = await getAuth(app).createCustomToken(uid);
        await page.evaluate(
          `import("/test/FirebaseSessionFixture.ts").then(({ signInTestAccount }) => signInTestAccount(${JSON.stringify(token)}))`,
        );
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        const before = (await downloadSource(page, "Download design JSON")).text;
        const active = LocalDesignSchema.array().parse(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
            DESIGN_HISTORY_KEY,
          ),
        )[0]!;
        const savedId = randomUUID();
        const conflictId = randomUUID();
        const invalidId = randomUUID();
        for (const id of [savedId, conflictId])
          await service.execute(
            { action: "save", id, editKey: active.editKey, document: active.document },
            null,
          );
        await service.execute(
          {
            action: "rename",
            id: conflictId,
            editKey: active.editKey,
            revision: 1,
            title: "Newer server title",
          },
          null,
        );
        const drafts = [
          {
            ...active,
            id: savedId,
            saved: true,
            revision: 1,
            document: { ...active.document, title: "Pending saved title" },
          },
          {
            ...active,
            id: conflictId,
            saved: true,
            revision: 1,
            document: { ...active.document, title: "Conflicting browser title" },
          },
          {
            ...active,
            id: invalidId,
            saved: false,
            document: { ...active.document, title: "Invalid browser draft" },
            pageJson: { [active.document.pages[0]!.id]: "{ invalid inactive raw" },
          },
        ];
        await page.evaluate(`import("/src/lib/DesignHistory.ts").then(({ rememberLocalDesign, DESIGN_HISTORY_KEY }) => {
          for (const draft of ${JSON.stringify(drafts)}) rememberLocalDesign(localStorage, draft);
          window.dispatchEvent(new StorageEvent("storage", { key: DESIGN_HISTORY_KEY }));
        })`);
        await page
          .getByRole("button", { name: "Actions for Pending saved title", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Claim", exact: true }).click();
        await page
          .getByRole("region", { name: "All", exact: true })
          .getByRole("button", { name: "Pending saved title", exact: true })
          .waitFor();
        const saved = SavedWorkspaceDesignSchema.parse(
          await service.execute({ action: "get", id: savedId }, null),
        );
        expect(saved.owner_id).toBe(uid);
        expect(saved.document.title).toBe("Pending saved title");
        expect(saved.revision).toBe(3);
        expect(new URL(page.url()).pathname).toBe("/");
        expect((await downloadSource(page, "Download design JSON")).text).toBe(before);
        await page
          .getByRole("button", { name: "Actions for Conflicting browser title", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Claim", exact: true }).click();
        await page
          .getByText(
            "Claim refused: the design changed. Open it and recover your browser draft first.",
            { exact: true },
          )
          .waitFor();
        expect(
          SavedWorkspaceDesignSchema.parse(
            await service.execute({ action: "get", id: conflictId }, null),
          ).owner_id,
        ).toBeNull();
        await page
          .getByRole("button", { name: "Actions for Invalid browser draft", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Claim", exact: true }).click();
        expect((await database.collection("designs").doc(invalidId).get()).exists).toBe(false);
        await page.setViewportSize({ width: 390, height: 844 });
        for (const theme of ["Day", "Night"] as const) {
          await chooseSiteTheme(page, theme);
          await page.setViewportSize({ width: 320, height: 844 });
          for (const button of await page.locator(".site-header button").all()) {
            const bounds = await button.boundingBox();
            if (bounds) {
              expect(bounds.x).toBeGreaterThanOrEqual(0);
              expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
            }
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
          const drawer = page.getByRole("dialog", { name: "Your designs menu" });
          const title = theme === "Day" ? "Invalid browser draft" : "Renamed invalid draft";
          await drawer.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
          const menu = page.getByRole("menu", { name: `Actions for ${title}`, exact: true });
          const box = (await menu.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(8);
          expect(box.x + box.width).toBeLessThanOrEqual(382);
          await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
          const rename = page.getByRole("dialog", { name: "Rename design", exact: true });
          await expectDialogLayout(rename, page.viewportSize()!);
          await rename.getByLabel("Design name").fill("Renamed invalid draft");
          await rename.getByRole("button", { name: "Rename", exact: true }).click();
          await expect.poll(() => rename.count()).toBe(0);
        }
        const locals = LocalDesignSchema.array().parse(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
            DESIGN_HISTORY_KEY,
          ),
        );
        expect(
          locals.find((draft) => draft.id === invalidId)?.pageJson?.[active.document.pages[0]!.id],
        ).toBe("{ invalid inactive raw");
        await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
        await page
          .getByRole("dialog", { name: "Your designs menu" })
          .getByRole("button", { name: "Actions for Renamed invalid draft", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
        await page
          .getByRole("dialog", { name: "Delete design?", exact: true })
          .getByRole("button", { name: "Delete permanently" })
          .click();
        await expect
          .poll(async () =>
            JSON.parse(
              await page.evaluate((key) => localStorage.getItem(key) ?? "[]", DESIGN_HISTORY_KEY),
            ).some((draft: { id: string }) => draft.id === invalidId),
          )
          .toBe(false);
        expect((await downloadSource(page, "Download design JSON")).text).toBe(before);
      } finally {
        await context.close();
      }
    });

    it("does not redirect a newly opened workspace when an earlier active deletion finishes", async () => {
      const context = await newLoginContext();
      const page = await context.newPage();
      const uid = `late-delete-${randomUUID()}`;
      await getAuth(app).createUser({ uid });
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await page.goto(baseUrl);
        await touchDraft(page);
        const token = await getAuth(app).createCustomToken(uid);
        await page.evaluate(
          `import("/test/FirebaseSessionFixture.ts").then(({ signInTestAccount }) => signInTestAccount(${JSON.stringify(token)}))`,
        );
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        const original = LocalDesignSchema.array().parse(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
            DESIGN_HISTORY_KEY,
          ),
        )[0]!;
        await page.getByRole("button", { name: "Claim", exact: true }).click();
        await page.waitForURL(/\/d\//);
        const next = {
          ...original,
          id: randomUUID(),
          document: { ...original.document, title: "Keep this workspace" },
        };
        await page.evaluate(`import("/src/lib/DesignHistory.ts").then(({ rememberLocalDesign, DESIGN_HISTORY_KEY }) => {
          rememberLocalDesign(localStorage, ${JSON.stringify(next)});
          window.dispatchEvent(new StorageEvent("storage", { key: DESIGN_HISTORY_KEY }));
        })`);
        const address = api.address();
        if (!address || typeof address === "string") throw new Error("Test API is unavailable.");
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        await page.route(`http://127.0.0.1:${address.port}/**`, async (route) => {
          const request = route.request();
          if (
            request.method() === "POST" &&
            z.object({ action: z.string() }).parse(request.postDataJSON()).action === "delete"
          ) {
            entered();
            await waiting;
          }
          await route.continue();
        });
        await page
          .getByRole("region", { name: "All", exact: true })
          .getByRole("button", { name: `Actions for ${original.document.title}`, exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
        await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
        await started;
        const path = `/local/${next.id}`;
        await page.evaluate((target) => {
          window.history.pushState({}, "", target);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, path);
        await expect
          .poll(() => page.getByLabel("Design title", { exact: true }).inputValue())
          .toBe(next.document.title);
        const response = page.waitForResponse(
          (result) =>
            result.request().method() === "POST" &&
            result.url().startsWith(`http://127.0.0.1:${address.port}/`) &&
            z.object({ action: z.string() }).parse(result.request().postDataJSON()).action ===
              "delete",
        );
        release();
        await (await response).finished();
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        expect(new URL(page.url()).pathname).toBe(path);
        expect(await page.getByLabel("Design title", { exact: true }).inputValue()).toBe(
          next.document.title,
        );
        expect(
          (await database.collection("designs").doc(original.id).get()).get("deleted_at"),
        ).toBeTruthy();
        const locals = LocalDesignSchema.array().parse(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
            DESIGN_HISTORY_KEY,
          ),
        );
        expect(locals.find((draft) => draft.id === next.id)?.document).toEqual(next.document);
      } finally {
        release();
        await context.close();
      }
    });

    it("uses Firebase sessions for encrypted connections and generation without leaking keys or losing the original draft", async () => {
      const context = await newLoginContext();
      const page = await context.newPage();
      const uid = `ai-browser-${randomUUID()}`;
      await getAuth(app).createUser({ uid, displayName: "AI test author" });
      try {
        const token = await getAuth(app).createCustomToken(uid);
        await page.goto(baseUrl);
        await page.evaluate(
          `import("/test/FirebaseSessionFixture.ts").then(({ signInTestAccount }) => signInTestAccount(${JSON.stringify(token)}))`,
        );
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        await expect
          .poll(() => page.getByRole("combobox", { name: "Model", exact: true }).isEnabled(), {
            timeout: 10_000,
          })
          .toBe(true);
        await chooseDropdown(page.getByRole("combobox", { name: "Model", exact: true }), "manage");
        const dialog = page.getByRole("dialog", { name: "AI connection", exact: true });
        expect(await dialog.getByLabel("Connection name", { exact: true }).count()).toBe(0);
        expect(await dialog.getByLabel("Model ID", { exact: true }).count()).toBe(0);
        expect(await dialog.getByLabel("API base URL", { exact: true }).count()).toBe(0);
        await expectDialogLayout(dialog, page.viewportSize()!);
        const beforeConnect = aiRequests.length;
        await dialog.getByLabel("Provider API key").fill(providerKey);
        await dialog.getByRole("button", { name: "Connect", exact: true }).click();
        await expect.poll(() => dialog.locator(".provider-connection").count()).toBe(1);
        expect(aiRequests.slice(beforeConnect).map((request) => request.method)).toEqual(["GET"]);
        expect(await dialog.getByLabel("Provider API key").count()).toBe(0);
        expect((await aiService.list(uid))[0]!.model).toBeNull();
        await chooseDropdown(
          dialog.getByRole("combobox", { name: "Model", exact: true }),
          "gpt-test",
        );
        await expect.poll(async () => (await aiService.list(uid))[0]!.model).toBe("gpt-test");
        for (const theme of ["Day", "Night"] as const) {
          await dialog.getByRole("button", { name: "Close AI connection" }).click();
          await chooseSiteTheme(page, theme);
          await chooseDropdown(
            page.getByRole("combobox", { name: "Model", exact: true }),
            "manage",
          );
          await expectDialogLayout(dialog, page.viewportSize()!);
        }
        await dialog.getByRole("button", { name: "Close AI connection" }).click();
        await page.reload();
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        await expect.poll(async () => (await aiService.list(uid)).length).toBe(1);
        await expect
          .poll(() => page.getByRole("combobox", { name: "Model", exact: true }).textContent())
          .toContain("gpt-test");
        expect(
          await page
            .getByText("Firebase AI connections are not deployed yet.", { exact: false })
            .count(),
        ).toBe(0);
        const original = (await downloadSource(page, "Download design JSON")).text;
        await page.getByLabel("Describe your idea").fill("Create a clear title.");
        await page.getByRole("button", { name: "Generate design" }).click();
        await page.getByRole("button", { name: "Undo generation" }).waitFor();
        const history = page.getByRole("dialog", { name: "Prompt history", exact: true });
        const historyLog = page.getByRole("log", { name: "Generation history", exact: true });
        await history.waitFor();
        expect(await historyLog.innerText()).toContain("Create a clear title.");
        expect(await historyLog.locator('[data-status="succeeded"]').count()).toBe(1);
        expect(await page.getByLabel("Describe your idea").inputValue()).toBe("");
        expect(
          await page.locator(".ai-composer .composer-feedback:not(.notice-error)").count(),
        ).toBe(0);
        await page.getByRole("button", { name: "Prompt", exact: true }).click();
        expect(await page.getByLabel("Describe your idea").isVisible()).toBe(false);
        const generated = (await downloadSource(page, "Download design JSON")).text;
        expect(generated).toContain("Firebase generated draft");
        expect(generated).not.toContain(providerKey);
        expect(
          await page.evaluate(() =>
            JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
          ),
        ).not.toContain(providerKey);
        expect(new Headers(aiRequests.at(-1)!.headers).get("Authorization")).toBe(
          `Bearer ${providerKey}`,
        );
        await page.getByRole("button", { name: "Prompt history", exact: true }).click();
        await page.getByRole("button", { name: "Undo generation" }).click();
        await expect.poll(() => historyLog.locator('[data-status="undone"]').count()).toBe(1);
        expect((await downloadSource(page, "Download design JSON")).text).toBe(original);
        await page.getByRole("button", { name: "Prompt", exact: true }).click();

        let release!: () => void;
        const entered = new Promise<void>((resolve) => {
          generationEntered = resolve;
        });
        generationWait = new Promise<void>((resolve) => {
          release = resolve;
        });
        const completedBefore = finishedGenerations;
        try {
          await page.getByLabel("Describe your idea").fill("A slow request.");
          await page.getByRole("button", { name: "Generate design" }).click();
          await entered;
          await expect.poll(() => historyLog.locator('[data-status="thinking"]').count()).toBe(1);
          await page.getByRole("button", { name: /^Account/ }).click();
          await page
            .getByRole("dialog", { name: "Account & settings" })
            .getByRole("button", { name: "Manage AI connection" })
            .click();
          await chooseDropdown(
            dialog.getByRole("combobox", { name: "Model", exact: true }),
            "gpt-next",
          );
          await expect
            .poll(() => dialog.getByRole("combobox", { name: "Model", exact: true }).textContent())
            .toContain("gpt-next");
          expect(await history.isVisible()).toBe(false);
          release();
          await expect.poll(() => finishedGenerations).toBe(completedBefore + 1);
          await dialog.getByRole("button", { name: "Close AI connection" }).click();
          await page
            .getByRole("alert")
            .filter({
              hasText: "The AI connection or model changed while generating. Nothing was applied.",
            })
            .waitFor();
          await expect.poll(() => historyLog.locator('[data-status="cancelled"]').count()).toBe(1);
          expect(await page.getByLabel("Describe your idea").inputValue()).toBe("A slow request.");
          expect((await downloadSource(page, "Download design JSON")).text).toBe(original);
        } finally {
          release();
          generationWait = undefined;
          generationEntered = undefined;
        }
        expect((await aiService.secret(uid, (await aiService.list(uid))[0]!.id))!.model).toBe(
          "gpt-next",
        );
        await chooseDropdown(page.getByRole("combobox", { name: "Model", exact: true }), "manage");
        rejectCatalog = true;
        await dialog.getByRole("button", { name: "Refresh models", exact: true }).click();
        await dialog
          .getByRole("alert")
          .getByText("The provider rejected the key or its permissions.", { exact: true })
          .waitFor();
        expect(
          await dialog.getByRole("button", { name: "Replace key", exact: true }).isEnabled(),
        ).toBe(true);
        expect((await aiService.list(uid))[0]!.model).toBe("gpt-next");
        rejectCatalog = false;
        await dialog.getByRole("button", { name: "Replace key", exact: true }).click();
        await dialog.getByLabel("Provider API key").fill("discard-this-key-on-provider-change");
        await chooseDropdown(dialog.getByRole("combobox", { name: "AI provider" }), "anthropic");
        expect(await dialog.getByLabel("Provider API key").inputValue()).toBe("");
        await chooseDropdown(dialog.getByRole("combobox", { name: "AI provider" }), "openai");
        await dialog.getByLabel("Provider API key").fill(`${providerKey}-replacement`);
        await dialog.getByRole("button", { name: "Replace key", exact: true }).click();
        await expect.poll(() => dialog.locator(".provider-connection").count()).toBe(1);
        expect(
          (await aiService.credentials(uid, (await aiService.list(uid))[0]!.id)).secret.api_key,
        ).toBe(`${providerKey}-replacement`);
        expect((await aiService.list(uid))[0]!.model).toBe("gpt-next");
        page.once("dialog", (confirmation) => void confirmation.accept());
        await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
        await dialog.getByLabel("Provider API key").waitFor();
        expect(await aiService.list(uid)).toEqual([]);
        await page.setViewportSize({ width: 390, height: 844 });
        for (const theme of ["Day", "Night"] as const) {
          await dialog.getByRole("button", { name: "Close AI connection" }).click();
          await chooseSiteTheme(page, theme);
          await chooseDropdown(
            page.getByRole("combobox", { name: "Model", exact: true }),
            "manage",
          );
          await expectDialogLayout(dialog, page.viewportSize()!);
        }
      } finally {
        rejectCatalog = false;
        await context.close();
        await aiService.deleteAccount(uid);
        await getAuth(app).deleteUser(uid);
      }
    });

    async function actionFor(email: string, requestType: string) {
      const schema = z.object({
        oobCodes: z.array(
          z
            .object({
              email: z.string(),
              requestType: z.string(),
              oobCode: z.string(),
              oobLink: z.string(),
            })
            .passthrough(),
        ),
      });
      const response = await fetch(
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/demo-tinytldr/oobCodes`,
      );
      if (!response.ok) throw new Error(`Could not read emulator actions: ${response.status}`);
      return schema
        .parse(await response.json())
        .oobCodes.find((entry) => entry.email === email && entry.requestType === requestType);
    }

    it("keeps Firebase sign-in, signup, and recovery consistent in both themes and constrained viewports", async () => {
      const context = await newLoginContext();
      const page = await context.newPage();
      try {
        await page.goto(baseUrl);
        const heading = page.frameLocator('iframe[title="Design preview"]').locator("h1");
        await heading.waitFor();
        await heading.evaluate((element) => {
          element.dataset.authProbe = "preserved";
        });
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
            await openLogin(page);
            const dialog = page.locator("dialog[open]");
            for (const mode of ["signin", "signup", "reset"]) {
              if (mode === "signup")
                await dialog.getByRole("button", { name: "Create account", exact: true }).click();
              if (mode === "reset") {
                await dialog.getByRole("button", { name: "Back to sign in" }).click();
                await dialog.getByRole("button", { name: "Forgot password?" }).click();
              }
              await expectDialogLayout(dialog, viewport);
              if (mode !== "reset") {
                expect(
                  await dialog.getByLabel("Password", { exact: true }).getAttribute("autocomplete"),
                ).toBe(mode === "signup" ? "new-password" : "current-password");
                await dialog.getByRole("button", { name: "Show password" }).click();
                expect(
                  await dialog.getByLabel("Password", { exact: true }).getAttribute("type"),
                ).toBe("text");
                await dialog.getByRole("button", { name: "Hide password" }).click();
                expect(
                  await dialog.getByLabel("Password", { exact: true }).getAttribute("type"),
                ).toBe("password");
              }
            }
            await dialog.locator(".dialog-close").focus();
            await page.keyboard.press("Shift+Tab");
            expect(
              await dialog.evaluate((element) => element.contains(document.activeElement)),
            ).toBe(true);
            await page.keyboard.press("Tab");
            expect(
              await dialog
                .locator(".dialog-close")
                .evaluate((element) => element === document.activeElement),
            ).toBe(true);
            await page.keyboard.press("Escape");
            await expect.poll(() => dialog.count()).toBe(0);
            expect(await heading.getAttribute("data-auth-probe")).toBe("preserved");
          }
        }
      } finally {
        await context.close();
      }
    });

    it("creates, verifies, restores, resets, and signs into a password account without losing its design", async () => {
      const context = await newLoginContext();
      const page = await context.newPage();
      const email = `password-${randomUUID()}@example.com`;
      const password = "  Secure-password-2026!  ";
      try {
        await page.goto(baseUrl);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.waitForURL(/\/d\/[0-9a-f-]+$/);
        const path = new URL(page.url()).pathname;
        await openLogin(page);
        await page.getByRole("button", { name: "Create account", exact: true }).click();
        await page.getByLabel("Email address", { exact: true }).fill(email);
        await page.getByLabel("Password", { exact: true }).fill("short");
        await page.getByRole("button", { name: "Create account", exact: true }).click();
        await page.getByRole("alert").waitFor();
        expect(await page.getByRole("alert").innerText()).toContain("at least 6 characters");
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Create account", exact: true }).click();
        const settings = page.getByRole("dialog", { name: "Account & settings" });
        await settings.waitFor();
        expect(await settings.getByText("Not verified", { exact: true }).isVisible()).toBe(true);
        const user = await getAuth(app).getUserByEmail(email);
        await expect.poll(async () => !!(await actionFor(email, "VERIFY_EMAIL"))).toBe(true);
        const verification = await actionFor(email, "VERIFY_EMAIL");
        await page.evaluate(
          `import("/test/FirebaseSessionFixture.ts").then(({ verifyTestEmail }) => verifyTestEmail(${JSON.stringify(verification!.oobCode)}))`,
        );
        await page.reload();
        await page.getByRole("button", { name: /^Account/ }).click();
        expect(await settings.getByText("Verified", { exact: true }).isVisible()).toBe(true);
        await settings.getByRole("button", { name: "Close account dialog" }).click();
        await chooseAction(page, "Claim this design");
        await expect
          .poll(async () =>
            (await database.collection("designs").doc(path.slice(3)).get()).get("owner_id"),
          )
          .toBe(user.uid);
        await page.getByRole("button", { name: /^Account/ }).click();
        await settings.getByRole("button", { name: "Sign out", exact: true }).click();
        await openLogin(page);
        await page.getByLabel("Email address", { exact: true }).fill(email);
        await page.getByLabel("Password", { exact: true }).fill(password.trim());
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Email or password is incorrect." })
          .waitFor();
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        expect(await page.locator("dialog[open]").count()).toBe(0);
        expect(new URL(page.url()).pathname).toBe(path);
        await page.reload();
        await page.getByRole("button", { name: /^Account/ }).click();
        await settings.getByRole("button", { name: "Sign out", exact: true }).click();
        await openLogin(page);
        await page.getByRole("button", { name: "Forgot password?" }).click();
        await page.getByLabel("Email address", { exact: true }).fill(email);
        await page.getByRole("button", { name: "Send reset link" }).click();
        await page.getByRole("status").filter({ hasText: "you'll receive an email" }).waitFor();
        const reset = await actionFor(email, "PASSWORD_RESET");
        expect(new URL(reset!.oobLink).searchParams.get("continueUrl")).toBe(`${baseUrl}${path}`);
        const nextPassword = "New-password-2026!";
        await page.evaluate(
          `import("/test/FirebaseSessionFixture.ts").then(({ resetTestPassword }) => resetTestPassword(${JSON.stringify(reset!.oobCode)}, ${JSON.stringify(nextPassword)}))`,
        );
        await page.getByRole("button", { name: "Back to sign in" }).click();
        await page.getByLabel("Password", { exact: true }).fill(nextPassword);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        expect((await getAuth(app).getUserByEmail(email)).uid).toBe(user.uid);
        expect(
          (await database.collection("designs").doc(path.slice(3)).get()).get("owner_id"),
        ).toBe(user.uid);
      } finally {
        await context.close();
      }
    });

    it("keeps verification delivery failure visible after signup changes the account dialog", async () => {
      const context = await newLoginContext();
      const page = await context.newPage();
      try {
        await page.route("**/accounts:sendOobCode?*", (route) =>
          route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: { message: "OPERATION_NOT_ALLOWED" } }),
          }),
        );
        await page.goto(baseUrl);
        await openLogin(page);
        await page.getByRole("button", { name: "Create account", exact: true }).click();
        const email = `verify-failure-${randomUUID()}@example.com`;
        await page.getByLabel("Email address", { exact: true }).fill(email);
        await page.getByLabel("Password", { exact: true }).fill("Valid-password-2026!");
        await page.getByRole("button", { name: "Create account", exact: true }).click();
        await page.getByRole("dialog", { name: "Account & settings" }).waitFor();
        await page
          .getByRole("alert")
          .filter({ hasText: "account was created, but the verification email could not be sent" })
          .waitFor();
        expect((await getAuth(app).getUserByEmail(email)).emailVerified).toBe(false);
      } finally {
        await context.close();
      }
    });

    it("signs in through the real Google emulator popup and restores the same account", async () => {
      const context = await newLoginContext();
      const page = await context.newPage();
      const email = `google-${randomUUID()}@example.com`;
      try {
        await page.goto(baseUrl);
        await openLogin(page);
        const cancelledPopup = page.waitForEvent("popup");
        await page.getByRole("button", { name: "Continue with Google" }).click();
        const cancelled = await cancelledPopup;
        await cancelled.waitForLoadState("domcontentloaded");
        expect(await page.getByRole("button", { name: "Opening Google..." }).isDisabled()).toBe(
          true,
        );
        expect(await page.getByLabel("Email address", { exact: true }).isDisabled()).toBe(true);
        expect(await page.getByLabel("Password", { exact: true }).isDisabled()).toBe(true);
        await cancelled.close();
        await page.getByRole("alert").filter({ hasText: "Google sign-in was cancelled" }).waitFor();
        const pendingPopup = page.waitForEvent("popup");
        await page.getByRole("button", { name: "Continue with Google" }).click();
        const popup = await pendingPopup;
        await popup.waitForLoadState("domcontentloaded");
        await popup.locator("#add-account-button").click();
        await popup.locator("#email-input").fill(email);
        await popup.getByRole("button", { name: /sign in/i }).click();
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        const user = await getAuth(app).getUserByEmail(email);
        expect(user.providerData.map((provider) => provider.providerId)).toContain("google.com");
        expect(await page.locator("dialog[open]").count()).toBe(0);
        await page.reload();
        await page.getByRole("button", { name: /^Account/ }).click();
        expect(await page.getByRole("dialog").getByLabel("Email address").inputValue()).toBe(email);
        expect((await getAuth(app).getUserByEmail(email)).uid).toBe(user.uid);
      } finally {
        await context.close();
      }
    });

    it.each(["signed-out", "different-account"])(
      "persists Firebase settings and rejects a late profile result for %s",
      async (scenario) => {
        const context = await browser.newContext();
        await context.addInitScript(() => {
          if (window.top === window) localStorage.setItem("tinytldr:welcome:v1", "seen");
        });
        const page = await context.newPage();
        await page.goto(baseUrl);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.waitForURL(/\/d\/[0-9a-f-]+$/);
        const savedPath = new URL(page.url()).pathname;
        await page.getByRole("button", { name: /Sign in \/ Create account/ }).click();
        const email = `firebase-${randomUUID()}@example.com`;
        const user = await getAuth(app).createUser({ email, emailVerified: true });
        const token = await getAuth(app).createCustomToken(user.uid);
        await page
          .getByRole("dialog", { name: "Sign in", exact: true })
          .getByRole("button", { name: "Close account dialog" })
          .click();
        await page.evaluate(
          `import("/test/FirebaseSessionFixture.ts").then(({ signInTestAccount }) => signInTestAccount(${JSON.stringify(token)}))`,
        );
        expect(new URL(page.url()).pathname).toBe(savedPath);
        await page.getByRole("button", { name: /^Account/ }).waitFor();
        await chooseAction(page, "Claim this design");
        const id = savedPath.slice(3);
        await expect
          .poll(async () => (await database.collection("designs").doc(id).get()).get("owner_id"), {
            timeout: 10_000,
          })
          .toBeTypeOf("string");
        const claimedOwner = z
          .string()
          .parse((await database.collection("designs").doc(id).get()).get("owner_id"));
        expect((await getAuth(app).getUser(claimedOwner)).email).toBe(email);
        expect(
          (await database.collection("designs").doc(id).get()).get("guest_key_hash"),
        ).toBeNull();
        await page.getByRole("button", { name: /^Account/ }).click();
        const settings = page.getByRole("dialog", { name: "Account & settings" });
        await settings.waitFor();
        expect(await settings.getByLabel("Email address").inputValue()).toBe(email);
        expect(await settings.getByLabel("Email address").getAttribute("readonly")).not.toBeNull();
        expect(await settings.getByText("Verified", { exact: true }).isVisible()).toBe(true);
        expect(await settings.getByText("Unavailable", { exact: true }).count()).toBe(0);
        await settings.getByText("AI is not connected.", { exact: true }).waitFor();
        expect(
          await settings.getByRole("button", { name: "Manage AI connection" }).isVisible(),
        ).toBe(true);
        await settings.getByLabel("Display name").fill("  Tiny Author  ");
        await settings.getByRole("button", { name: "Save name" }).click();
        await settings.getByRole("status").filter({ hasText: "Profile saved." }).waitFor();
        expect((await getAuth(app).getUser(claimedOwner)).displayName).toBe("Tiny Author");
        await settings.getByRole("button", { name: "Night", exact: true }).click();
        await settings.getByRole("button", { name: "Close account dialog" }).click();
        await page.reload();
        await page.getByRole("button", { name: /^Account/ }).click();
        await settings.waitFor();
        expect(await settings.getByLabel("Display name").inputValue()).toBe("Tiny Author");
        expect(
          await settings
            .getByRole("button", { name: "Night", exact: true })
            .getAttribute("aria-pressed"),
        ).toBe("true");

        for (const viewport of [
          { width: 390, height: 844 },
          { width: 320, height: 568 },
          { width: 640, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          for (const theme of ["Day", "Night"]) {
            await settings.getByRole("button", { name: theme, exact: true }).click();
            const geometry = await settings.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              return {
                x: bounds.x,
                y: bounds.y,
                right: bounds.right,
                bottom: bounds.bottom,
                overflow: element.scrollWidth - element.clientWidth,
              };
            });
            expect(geometry.x).toBeGreaterThanOrEqual(0);
            expect(geometry.y).toBeGreaterThanOrEqual(0);
            expect(geometry.right).toBeLessThanOrEqual(viewport.width);
            expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
            expect(geometry.overflow).toBeLessThanOrEqual(1);
            const footer = await settings
              .getByRole("button", { name: "Sign out", exact: true })
              .boundingBox();
            expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height);
          }
        }
        await page.setViewportSize({ width: 1280, height: 720 });

        let release: (() => void) | undefined;
        await page.route(/accounts:update/, async (route) => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          await route.continue();
        });
        await settings.getByLabel("Display name").fill("Late name");
        await settings.getByRole("button", { name: "Save name" }).click();
        await expect.poll(() => !!release).toBe(true);
        try {
          await page.evaluate(
            'import("/src/lib/FirebaseClient.ts").then(({ requireFirebaseAuth }) => requireFirebaseAuth().signOut())',
          );
          await page.getByRole("dialog", { name: "Sign in", exact: true }).waitFor();
          let otherEmail: string | undefined;
          if (scenario === "different-account") {
            otherEmail = `firebase-other-${randomUUID()}@example.com`;
            const other = await getAuth(app).createUser({
              email: otherEmail,
              emailVerified: true,
              displayName: "Other author",
            });
            const token = await getAuth(app).createCustomToken(other.uid);
            await page.evaluate(
              `import("/test/FirebaseSessionFixture.ts").then(({ signInTestAccount }) => signInTestAccount(${JSON.stringify(token)}))`,
            );
            await settings.waitFor();
            expect(await settings.getByLabel("Display name").inputValue()).toBe("Other author");
          }
          const completed = page.waitForResponse(/accounts:update/);
          release!();
          await (await completed).finished();
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          await expect
            .poll(async () => (await getAuth(app).getUser(claimedOwner)).displayName)
            .toBe("Late name");
          if (scenario === "different-account") {
            expect(await settings.getByLabel("Display name").inputValue()).toBe("Other author");
            expect(await settings.getByLabel("Email address").inputValue()).toBe(otherEmail);
            await settings.getByRole("button", { name: "Sign out", exact: true }).click();
          } else {
            await page.getByRole("button", { name: /Sign in \/ Create account/ }).waitFor();
            expect(await settings.count()).toBe(0);
            await page.getByRole("button", { name: "Close account dialog" }).click();
          }
          await page.reload();
          await page.getByRole("button", { name: /Sign in \/ Create account/ }).waitFor();
          expect(await settings.count()).toBe(0);
          expect(await page.evaluate(() => localStorage.getItem("tinytldr:auth:email"))).toBeNull();
          if (scenario === "signed-out") {
            await openLogin(page);
            await page.getByRole("button", { name: "Forgot password?" }).click();
            await page.getByLabel("Email address", { exact: true }).fill(email);
            await page.getByRole("button", { name: "Send reset link" }).click();
            await page.getByRole("status").filter({ hasText: "you'll receive an email" }).waitFor();
            const reset = await actionFor(email, "PASSWORD_RESET");
            await page.evaluate(
              `import("/test/FirebaseSessionFixture.ts").then(({ resetTestPassword }) => resetTestPassword(${JSON.stringify(reset!.oobCode)}, "Recovered-password-2026!"))`,
            );
            await page.getByRole("button", { name: "Back to sign in" }).click();
            await page.getByLabel("Password", { exact: true }).fill("Recovered-password-2026!");
            await page.getByLabel("Password", { exact: true }).press("Enter");
            await page.getByRole("button", { name: /^Account/ }).waitFor();
            expect((await getAuth(app).getUserByEmail(email)).uid).toBe(claimedOwner);
            expect((await database.collection("designs").doc(id).get()).get("owner_id")).toBe(
              claimedOwner,
            );
          }
        } finally {
          release?.();
          await context.close();
        }
      },
    );
  },
);
