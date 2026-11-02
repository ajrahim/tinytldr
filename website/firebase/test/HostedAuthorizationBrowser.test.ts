import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HostedMcpDecisionSchema, HOSTED_MCP_SCOPE } from "@tinytldr/core";

describe.skipIf(!process.env.FIREBASE_AUTH_EMULATOR_HOST)(
  "Hosted authorization page with real Firebase password sign-in",
  () => {
    const app = initializeApp({ projectId: "demo-tinytldr" }, `hosted-browser-${randomUUID()}`);
    const auth = getAuth(app);
    const email = `hosted-browser-${randomUUID()}@example.test`;
    const password = randomUUID();
    const requestId = randomUUID();
    const decisions: { approved: boolean; uid?: string }[] = [];
    const failures: string[] = [];
    let uid: string;
    let site: ViteDevServer;
    let browser: Browser;
    let base: string;
    let cacheDirectory: string;
    let expiresAt = Math.floor(Date.now() / 1000) + 300;

    beforeAll(async () => {
      uid = (await auth.createUser({ email, password })).uid;
      cacheDirectory = await fs.mkdtemp(path.join(process.cwd(), ".test-hosted-browser-"));
      const consentMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url?.startsWith("/callback")) {
          res.setHeader("Content-Type", "text/html");
          res.end("<!doctype html><title>Agent connected</title><p>Connection completed</p>");
          return;
        }
        if (req.url !== `/consent/${requestId}`) {
          next();
          return;
        }
        void (async () => {
          res.setHeader("Content-Type", "application/json");
          if (req.method === "GET") {
            res.end(
              JSON.stringify({
                clientName: "Fixture <script>alert('no')</script> agent",
                redirectOrigin: base,
                expiresAt,
                scope: HOSTED_MCP_SCOPE,
              }),
            );
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const decision = HostedMcpDecisionSchema.parse(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          );
          const token = req.headers.authorization?.slice("Bearer ".length);
          const owner =
            decision.approved && token ? await auth.verifyIdToken(token, true) : undefined;
          if (decision.approved && !owner) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: "Sign in required." }));
            return;
          }
          decisions.push({ approved: decision.approved, ...(owner ? { uid: owner.uid } : {}) });
          res.end(
            JSON.stringify({
              redirectUrl: `${base}/callback?outcome=${decision.approved ? "approved" : "denied"}`,
            }),
          );
        })().catch(() => {
          failures.push("fixture_request_failed");
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "Fixture request failed." }));
        });
      };
      site = await createServer({
        root: fileURLToPath(new URL("../../", import.meta.url)),
        configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
        cacheDir: cacheDirectory,
        plugins: [
          {
            name: "hosted-consent-fixture",
            configureServer(server) {
              server.middlewares.use(consentMiddleware);
            },
          },
        ],
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
        },
        server: { host: "127.0.0.1", port: 0 },
      });
      await site.listen();
      const address = site.httpServer?.address();
      if (!address || typeof address === "string")
        throw new Error("Authorization fixture did not bind.");
      base = `http://127.0.0.1:${address.port}`;
      browser = await chromium.launch();
    });

    afterAll(async () => {
      await browser?.close();
      await site?.close();
      if (uid) await auth.deleteUser(uid);
      await deleteApp(app);
      if (cacheDirectory) await fs.rm(cacheDirectory, { recursive: true, force: true });
    });

    it("escapes claimed client names, reuses email/Google login and requires explicit consent", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(`${base}/McpAuthorization.html?request=${requestId}`);
        await expect
          .poll(() => page.getByRole("button", { name: "Sign in", exact: true }).isEnabled())
          .toBe(true);
        expect(await page.locator(".mcp-authorization-card").innerText()).toContain(
          "<script>alert('no')</script>",
        );
        expect(await page.locator(".mcp-authorization-card script").count()).toBe(0);
        expect(decisions).toEqual([]);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        const dialog = page.getByRole("dialog");
        expect(await dialog.getByRole("button", { name: "Continue with Google" }).isVisible()).toBe(
          true,
        );
        expect(await dialog.innerText()).not.toContain("An account is optional");
        await dialog.getByLabel("Email address", { exact: true }).fill(email);
        await dialog.getByLabel("Password", { exact: true }).fill(password);
        await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect
          .poll(() => page.getByRole("button", { name: "Authorize agent" }).isVisible())
          .toBe(true);
        expect(await page.locator(".mcp-authorization-card").innerText()).toContain(email);
        expect(decisions).toEqual([]);
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: 800 });
          for (const day of [true, false]) {
            await page.evaluate(
              (value) => document.documentElement.classList.toggle("light", value),
              day,
            );
            const bounds = await page.locator(".mcp-authorization-card").boundingBox();
            expect(bounds?.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
          }
        }
        await page.getByRole("button", { name: "Authorize agent" }).click();
        await page.waitForURL("**/callback?outcome=approved");
        expect(decisions).toEqual([{ approved: true, uid }]);
        expect(failures).toEqual([]);
      } finally {
        await context.close();
      }
    });

    it("allows cancellation without sign-in and rejects expired or malformed links visibly", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(`${base}/McpAuthorization.html?request=${requestId}`);
        await expect
          .poll(() => page.getByRole("button", { name: "Cancel", exact: true }).isVisible())
          .toBe(true);
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.waitForURL("**/callback?outcome=denied");
        expect(decisions.at(-1)).toEqual({ approved: false });
        expiresAt = Math.floor(Date.now() / 1000) - 1;
        await page.goto(`${base}/McpAuthorization.html?request=${requestId}`);
        await expect.poll(() => page.getByRole("alert").innerText()).toContain("expired");
        expect(await page.getByRole("button", { name: "Sign in", exact: true }).isDisabled()).toBe(
          true,
        );
        await page.goto(`${base}/McpAuthorization.html?request=invalid`);
        await expect.poll(() => page.getByRole("alert").innerText()).toContain("invalid");
        expect(failures).toEqual([]);
      } finally {
        expiresAt = Math.floor(Date.now() / 1000) + 300;
        await context.close();
      }
    });
  },
);
