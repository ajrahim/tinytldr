import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createServer } from "vite";
import type { Page } from "playwright";
import {
  AiGatewayRequestSchema,
  SavedWorkspaceDesignSchema,
  type AiGenerationInput,
} from "@tinytldr/core";
import { createAiGateway } from "../../server/AiGateway.js";
import { AiConnectionService } from "../src/AiConnectionService.js";
import { createDesignGateway } from "../src/DesignGateway.js";
import { DesignService } from "../src/DesignService.js";
import { createFirebaseUserVerifier } from "../src/FirebaseIdentity.js";
import { MediaService } from "../src/MediaService.js";
import { createMediaGateway } from "../src/MediaGateway.js";
import { createFirebaseHttpHandler } from "../src/FirebaseHttp.js";

export const hasFirebaseEmulators = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST &&
  process.env.FIREBASE_AUTH_EMULATOR_HOST &&
  process.env.FIREBASE_STORAGE_EMULATOR_HOST,
);

export async function startWorkspaceTestServer(
  options: { renderApiUrl?: string; aiProviderFetch?: typeof fetch } = {},
) {
  if (!hasFirebaseEmulators)
    throw new Error("Run browser tests through Firebase Auth and Firestore emulators.");
  const app = initializeApp({ projectId: "demo-tinytldr" }, `workspace-${randomUUID()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const service = new DesignService(db);
  const aiService = new AiConnectionService(db, () => "ab".repeat(32));
  const mediaService = new MediaService(db, getStorage(app), "demo-tinytldr.firebasestorage.app");
  const aiRequests: AiGenerationInput[] = [];
  const origins: string[] = [];
  const users = new Set<string>();
  const designs = new Set<string>();
  const requests = new Set<Promise<void>>();
  const verifyUser = createFirebaseUserVerifier(auth);
  const designGateway = createDesignGateway({
    service,
    allowedOrigins: origins,
    verifyUser,
    reportError: (error) => console.error("Firebase design fixture failure", error),
  });
  const mediaGateway = createMediaGateway({
    service: () => mediaService,
    allowedOrigins: origins,
    verifyUser,
    reportError: (error) => console.error("Firebase media fixture failure", error),
  });
  const aiGateway = createAiGateway({
    allowedOrigins: origins,
    customBaseUrls: ["https://models.example.com/v1"],
    reportError: () => {},
    verifyUser,
    store: aiService,
    fetch:
      options.aiProviderFetch ??
      (async () => {
        throw new Error("No AI provider mock configured.");
      }),
  });
  const api = http.createServer((request, response) => {
    const handling = (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      if (request.method === "POST") {
        if (request.url === "/ai") {
          const checked = AiGatewayRequestSchema.safeParse(JSON.parse(body));
          if (checked.success && checked.data.action === "generate")
            aiRequests.push(checked.data.request);
        } else if (request.url !== "/media") {
          const checked: { id?: string } = JSON.parse(body);
          if (checked.id) designs.add(checked.id);
        }
      }
      const handler =
        request.url === "/media" ? mediaGateway : request.url === "/ai" ? aiGateway : designGateway;
      await createFirebaseHttpHandler(handler)(
        {
          method: request.method ?? "GET",
          headers: request.headers,
          path: request.url ?? "/",
          rawBody: Buffer.from(body),
          on: request.on.bind(request),
          off: request.off.bind(request),
        },
        {
          get writableEnded() {
            return response.writableEnded;
          },
          on: response.on.bind(response),
          off: response.off.bind(response),
          status: (status) => {
            response.statusCode = status;
          },
          setHeader: (name, value) => {
            response.setHeader(name, value);
          },
          send: (bytes) => {
            response.end(bytes);
          },
        },
      );
    })().catch((error: unknown) => {
      console.error("Firebase fixture HTTP failure", error);
      response.writeHead(500).end();
    });
    requests.add(handling);
    void handling.finally(() => requests.delete(handling));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const apiAddress = api.address();
  if (!apiAddress || typeof apiAddress === "string")
    throw new Error("Test API did not bind a port.");
  const apiUrl = `http://127.0.0.1:${apiAddress.port}/`;
  const aiUrl = new URL("ai", apiUrl).href;
  const cacheDir = await mkdtemp(join(process.cwd(), ".test-firebase-workspace-"));
  const vite = await createServer({
    cacheDir,
    configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../..", import.meta.url)),
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
      "import.meta.env.VITE_TINYTLDR_FIREBASE_DESIGNS_URL": JSON.stringify(apiUrl),
      "import.meta.env.VITE_TINYTLDR_FIREBASE_AI_URL": JSON.stringify(aiUrl),
      "import.meta.env.VITE_TINYTLDR_FIREBASE_MEDIA_URL": JSON.stringify(
        new URL("media", apiUrl).href,
      ),
      "import.meta.env.VITE_TINYTLDR_API_URL": JSON.stringify(options.renderApiUrl ?? ""),
    },
    server: { host: "127.0.0.1", port: 0, hmr: false },
    logLevel: "error",
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Test website did not bind a port.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  origins.push(baseUrl);
  return {
    db,
    auth,
    service,
    aiService,
    mediaService,
    mediaUrl: new URL("media", apiUrl).href,
    apiUrl,
    aiUrl,
    baseUrl,
    aiRequests,
    async signIn(page: Page, options: { verified?: boolean } = {}) {
      const user = await auth.createUser({
        email: `creator-${randomUUID()}@example.com`,
        emailVerified: options.verified ?? true,
        password: "Fixture-password-123!",
      });
      users.add(user.uid);
      const token = await auth.createCustomToken(user.uid);
      if (!page.url().startsWith(baseUrl)) await page.goto(baseUrl);
      await page.evaluate(
        `import("/test/FirebaseSessionFixture.ts").then(({ signInTestAccount }) => signInTestAccount(${JSON.stringify(token)}))`,
      );
      await page.getByRole("button", { name: /^Account/ }).waitFor();
      return user;
    },
    async design(id: string) {
      return SavedWorkspaceDesignSchema.parse(await service.execute({ action: "get", id }, null));
    },
    async resetAi() {
      await Promise.all(
        [...users].map((uid) =>
          db.collection("aiAccounts").doc(Buffer.from(uid).toString("base64url")).delete(),
        ),
      );
    },
    async close() {
      await vite.close();
      await new Promise<void>((resolve, reject) =>
        api.close((error) => (error ? reject(error) : resolve())),
      );
      await Promise.all(requests);
      await Promise.all(
        [...designs].map((id) => db.recursiveDelete(db.collection("designs").doc(id))),
      );
      await Promise.all(
        [...users].map(async (uid) => {
          await mediaService.deleteAccount(uid);
          await db.collection("aiAccounts").doc(Buffer.from(uid).toString("base64url")).delete();
          await auth.deleteUser(uid);
        }),
      );
      await db.terminate();
      await deleteApp(app);
      await rm(cacheDir, { recursive: true, force: true });
    },
  };
}
