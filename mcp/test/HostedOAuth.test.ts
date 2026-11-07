import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAuthClientInformationFullSchema,
  OAuthTokensSchema,
  type OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  HOSTED_MCP_SCOPE,
  HostedRenderedExportSchema,
  WorkspaceProjectSchema,
} from "@tinytldr/core";
import { inspectPngHeader } from "@tinytldr/renderer";
import { getTemplateBundle } from "@tinytldr/templates";
import {
  FirebaseOAuthProvider,
  firebaseAccountCreationTime,
} from "../src/FirebaseOAuthProvider.js";
import { startHostedMcpServer } from "../src/HostedServer.js";
import { SavedDesignReader } from "../src/SavedDesignReader.js";

function hash(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)(
  "Hosted MCP OAuth against real Firebase emulators",
  () => {
    const app = initializeApp({ projectId: "demo-tinytldr" }, `hosted-oauth-${randomUUID()}`);
    const database = getFirestore(app);
    const auth = getAuth(app);
    const users: string[] = [];
    const clients = new Set<string>();
    const rateRecords = new Set<string>();
    const designs = new Set<string>();
    const reports: string[] = [];
    const objects = new Map<string, Buffer>();
    const capabilities = new Map<string, { key: string; expiresAt: number }>();
    let downloads: http.Server;
    let downloadBase: string;
    const initialTime = Math.floor(Date.now() / 1000);
    let now = initialTime;
    const provider = new FirebaseOAuthProvider(
      database,
      auth,
      new URL("https://mcp.tinytldr.test"),
      firebaseAccountCreationTime(app),
      () => now,
    );
    let service: Awaited<ReturnType<typeof startHostedMcpServer>>;
    let directory: string;
    let base: string;
    let identity: { uid: string; idToken: string };

    async function user() {
      const email = `hosted-${randomUUID()}@example.test`;
      const password = randomBytes(24).toString("base64url");
      const response = await fetch(
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        },
      );
      expect(response.status).toBe(200);
      const result = z
        .object({ localId: z.string(), idToken: z.string() })
        .parse(await response.json());
      users.push(result.localId);
      return { uid: result.localId, idToken: result.idToken };
    }

    async function register(name = "Fixture agent") {
      const response = await fetch(`${base}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: name,
          redirect_uris: ["http://127.0.0.1:45219/callback"],
          token_endpoint_auth_method: "none",
        }),
      });
      expect(response.status).toBe(201);
      const client = OAuthClientInformationFullSchema.parse(await response.json());
      clients.add(client.client_id);
      return client;
    }

    async function request(client: OAuthClientInformationFull, verifier: string) {
      const url = new URL("/authorize", base);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0]!,
        code_challenge: hash(verifier),
        code_challenge_method: "S256",
        scope: HOSTED_MCP_SCOPE,
        state: "fixture-state",
        resource: provider.resource,
      }).toString();
      const response = await fetch(url, { redirect: "manual" });
      expect(response.status).toBe(302);
      const location = response.headers.get("location");
      if (!location) throw new Error("Authorization did not return the consent page.");
      const target = new URL(location);
      expect(target.pathname).toBe("/connect");
      const id = target.searchParams.get("request");
      if (!id) throw new Error("Authorization request identifier missing.");
      return id;
    }

    async function approve(client: OAuthClientInformationFull, idToken = identity.idToken) {
      const verifier = randomBytes(32).toString("base64url");
      const id = await request(client, verifier);
      const response = await fetch(`${base}/consent/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ approved: true }),
      });
      expect(response.status).toBe(200);
      const result = z.object({ redirectUrl: z.string().url() }).parse(await response.json());
      const redirect = new URL(result.redirectUrl);
      expect(redirect.searchParams.get("state")).toBe("fixture-state");
      const code = redirect.searchParams.get("code");
      if (!code) throw new Error("Authorization code missing.");
      return { code, verifier, id };
    }

    async function exchange(client: OAuthClientInformationFull, code: string, verifier: string) {
      return fetch(`${base}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          redirect_uri: client.redirect_uris[0]!,
          code,
          code_verifier: verifier,
          resource: provider.resource,
        }),
      });
    }

    async function grant(idToken = identity.idToken) {
      const client = await register();
      const { code, verifier } = await approve(client, idToken);
      const response = await exchange(client, code, verifier);
      expect(response.status).toBe(200);
      return { client, tokens: OAuthTokensSchema.parse(await response.json()) };
    }

    beforeAll(async () => {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "tinytldr-oauth-test-"));
      await fs.writeFile(
        path.join(directory, "McpAuthorization.html"),
        "<!doctype html><title>Connect</title>",
      );
      downloads = http.createServer((req, res) => {
        const capability = capabilities.get((req.url ?? "").slice(1));
        const file =
          capability && capability.expiresAt > Date.now() ? objects.get(capability.key) : undefined;
        if (!file) {
          res.writeHead(403).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "image/png" }).end(file);
      });
      await new Promise<void>((resolve) => downloads.listen(0, "127.0.0.1", resolve));
      const address = downloads.address();
      if (!address || typeof address === "string")
        throw new Error("Download fixture did not bind.");
      downloadBase = `http://127.0.0.1:${address.port}`;
      service = await startHostedMcpServer({
        provider,
        designs: new SavedDesignReader(database),
        port: 0,
        websiteDirectory: directory,
        reportError: (code) => reports.push(code),
        storage: {
          async upload(file, key) {
            objects.set(key, await fs.readFile(file));
          },
          async signedUrl(key, expiresAt) {
            const capability = randomUUID();
            capabilities.set(capability, { key, expiresAt });
            return `${downloadBase}/${capability}`;
          },
          async delete(key) {
            objects.delete(key);
          },
        },
      });
      base = `http://127.0.0.1:${service.port}`;
      identity = await user();
    });

    afterAll(async () => {
      await service?.close();
      if (downloads)
        await new Promise<void>((resolve, reject) =>
          downloads.close((error) => (error ? reject(error) : resolve())),
        );
      for (const snapshot of (await database.collection("mcpOAuthRecords").get()).docs) {
        const record = z.object({ record: z.unknown() }).parse(snapshot.data()).record;
        const belongsToClient = z.object({ clientId: z.string() }).safeParse(record);
        if (
          (belongsToClient.success && clients.has(belongsToClient.data.clientId)) ||
          Array.from(clients).some((id) => snapshot.id === `client_${hash(id)}`) ||
          rateRecords.has(snapshot.id)
        )
          await snapshot.ref.delete();
      }
      for (const id of designs) await database.collection("designs").doc(id).delete();
      for (const uid of users) {
        const existing = await auth.getUser(uid).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "auth/user-not-found")
            return null;
          throw error;
        });
        if (existing) await auth.deleteUser(uid);
      }
      await database.terminate();
      await deleteApp(app);
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    });

    it("publishes discovery and denies unauthenticated tools with the resource challenge", async () => {
      const response = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
      const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
      expect(metadata.status).toBe(200);
      expect(await metadata.json()).toMatchObject({
        resource: provider.resource,
        authorization_servers: [provider.issuer.href],
      });
      const fallback = await fetch(`${base}/.well-known/oauth-protected-resource`);
      expect(fallback.status).toBe(200);
      expect(await fallback.json()).toMatchObject({ resource: provider.resource });
      const authorization = await fetch(`${base}/.well-known/oauth-authorization-server`);
      expect(await authorization.json()).toMatchObject({
        code_challenge_methods_supported: ["S256"],
      });
      const preflight = await fetch(`${base}/mcp`, { method: "OPTIONS" });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
    });

    it("registers public clients, normalizes names and rejects unsafe redirects", async () => {
      expect((await register("   ")).client_name).toBe("MCP client");
      for (const uri of [
        "https://user:password@example.test/callback",
        "http://example.test/callback",
        "https://example.test/callback#fragment",
      ]) {
        await expect(
          provider.clientsStore.registerClient!({ redirect_uris: [uri] }),
        ).rejects.toThrow();
      }
    });

    it("shows client identity and destination, requires sign-in and consumes denied requests", async () => {
      const client = await register("Trusted-looking <script>name</script>");
      const id = await request(client, randomBytes(32).toString("base64url"));
      expect(await provider.consent(id)).toMatchObject({
        clientName: client.client_name,
        redirectOrigin: "http://127.0.0.1:45219",
        scope: HOSTED_MCP_SCOPE,
      });
      await expect(provider.decide(id, true)).rejects.toThrow("Sign in");
      const denied = new URL((await provider.decide(id, false)).redirectUrl);
      expect(denied.searchParams.get("error")).toBe("access_denied");
      expect(denied.searchParams.get("state")).toBe("fixture-state");
      await expect(provider.decide(id, false)).rejects.toThrow();
    });

    it("verifies SDK S256 PKCE, binds the code to client and redirect, and prevents code replay", async () => {
      const client = await register();
      const other = await register();
      const { code, verifier } = await approve(client);
      expect((await exchange(other, code, verifier)).status).toBe(400);
      expect((await exchange(client, code, randomBytes(32).toString("base64url"))).status).toBe(
        400,
      );
      await expect(
        provider.exchangeAuthorizationCode(
          client,
          code,
          verifier,
          "https://wrong.test",
          new URL(provider.resource),
        ),
      ).rejects.toThrow();
      const response = await exchange(client, code, verifier);
      expect(response.status).toBe(200);
      const tokens = OAuthTokensSchema.parse(await response.json());
      expect(tokens.expires_in).toBe(300);
      expect(await provider.verifyAccessToken(tokens.access_token)).toMatchObject({
        clientId: client.client_id,
        extra: { uid: identity.uid },
      });
      expect((await exchange(client, code, verifier)).status).toBe(400);
    });

    it("rejects audience mismatch and scope escalation without consuming the valid refresh", async () => {
      const { client, tokens } = await grant();
      const refresh = tokens.refresh_token!;
      await expect(
        provider.exchangeRefreshToken(
          client,
          refresh,
          [HOSTED_MCP_SCOPE],
          new URL("https://wrong.test/mcp"),
        ),
      ).rejects.toThrow();
      await expect(provider.exchangeRefreshToken(client, refresh, ["admin"])).rejects.toThrow();
      await expect(provider.exchangeRefreshToken(await register(), refresh)).rejects.toThrow();
      const refreshed = await provider.exchangeRefreshToken(client, refresh);
      expect(refreshed.access_token).not.toBe(tokens.access_token);
      expect(refreshed.refresh_token).not.toBe(refresh);
    });

    it("rotates refresh tokens atomically and revokes the family on replay", async () => {
      const { client, tokens } = await grant();
      const rotated = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
      await expect(provider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toThrow(
        "replay",
      );
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow("revoked");
      await expect(provider.verifyAccessToken(rotated.access_token)).rejects.toThrow("revoked");
    });

    it("allows only one simultaneous refresh and revokes the raced family", async () => {
      const { client, tokens } = await grant();
      const results = await Promise.allSettled([
        provider.exchangeRefreshToken(client, tokens.refresh_token!),
        provider.exchangeRefreshToken(client, tokens.refresh_token!),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const winner = results.find((result) => result.status === "fulfilled");
      if (!winner || winner.status !== "fulfilled") throw new Error("Refresh winner missing.");
      await expect(provider.verifyAccessToken(winner.value.access_token)).rejects.toThrow(
        "revoked",
      );
    });

    it("expires consent, codes and access, and clamps access lifetime to family expiry", async () => {
      const client = await register();
      const id = await request(client, randomBytes(32).toString("base64url"));
      now += 300;
      await expect(provider.consent(id)).rejects.toThrow("expired");
      now = initialTime;
      const authorization = await approve(client);
      now += 60;
      expect((await exchange(client, authorization.code, authorization.verifier)).status).toBe(400);
      now = initialTime;
      const { tokens, client: activeClient } = await grant();
      now += 300;
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow("expired");
      now = initialTime + 7 * 24 * 60 * 60 - 10;
      const rotated = await provider.exchangeRefreshToken(activeClient, tokens.refresh_token!);
      expect(rotated.expires_in).toBe(10);
      now += 10;
      await expect(provider.verifyAccessToken(rotated.access_token)).rejects.toThrow("expired");
      await expect(
        provider.exchangeRefreshToken(activeClient, rotated.refresh_token!),
      ).rejects.toThrow("expired");
      now = initialTime;
    });

    it("revokes only the requesting client's authorization", async () => {
      const { client, tokens } = await grant();
      await provider.revokeToken(await register(), { token: tokens.access_token });
      await expect(provider.verifyAccessToken(tokens.access_token)).resolves.toBeDefined();
      await provider.revokeToken(client, { token: tokens.refresh_token! });
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow("revoked");
    });

    it("invalidates disabled, deleted and recreated Firebase accounts", async () => {
      const owner = await user();
      const { tokens } = await grant(owner.idToken);
      await auth.updateUser(owner.uid, { disabled: true });
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow("changed");
      await auth.deleteUser(owner.uid);
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow("invalid");
      await auth.createUser({ uid: owner.uid });
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow();
    });

    it("enforces transactional per-owner quotas and a fresh minute", async () => {
      const quotaOwner = `quota-${randomUUID()}`;
      const minute = Math.floor(now / 60);
      for (const owner of [quotaOwner, "different-fixture-owner"]) {
        rateRecords.add(`render-rate_${hash(`${owner}:${minute}`)}`);
        rateRecords.add(`render-rate_${hash(`${owner}:${minute + 1}`)}`);
      }
      const results = await Promise.all(
        Array.from({ length: 9 }, () => provider.takeRender(quotaOwner)),
      );
      expect(results.filter(Boolean)).toHaveLength(6);
      expect(await provider.takeRender("different-fixture-owner")).toBe(true);
      now += 60;
      expect(await provider.takeRender(quotaOwner)).toBe(true);
      now = initialTime;
    });

    it("initializes the official MCP client and rejects output paths before rendering", async () => {
      const { tokens } = await grant();
      const client = new Client({ name: "hosted-fixture", version: "1" });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
            requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
          }),
        );
        const tools = await client.listTools();
        const post = tools.tools.find((tool) => tool.name === "render_post");
        expect(post?.inputSchema.properties).not.toHaveProperty("outputPath");
        for (const name of ["distill_to_post", "repurpose_content"]) {
          const prompt = await client.getPrompt({
            name,
            arguments: { source: "A hosted export should be downloaded, not saved on the server." },
          });
          expect(prompt.messages[0]?.content).toMatchObject({
            type: "text",
            text: expect.stringContaining("Do not provide server output paths."),
          });
          expect(prompt.messages[0]?.content).toMatchObject({
            text: expect.stringContaining("short-lived"),
          });
        }
        await expect(
          client.callTool({
            name: "render_post",
            arguments: { templateId: "quote-card", outputPath: "../../escape.png" },
          }),
        ).rejects.toThrow();
      } finally {
        await client.close();
      }
      expect(reports).toEqual([]);
    });

    it("renders a real downloadable export with a bounded preview and distinct owner prefixes", async () => {
      for (const owner of [identity, await user()]) {
        const { tokens } = await grant(owner.idToken);
        rateRecords.add(`render-rate_${hash(`${owner.uid}:${Math.floor(now / 60)}`)}`);
        const client = new Client({ name: "hosted-export-fixture", version: "1" });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
              requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
            }),
          );
          const result = await client.callTool({
            name: "render_post",
            arguments: {
              templateId: "quote-card",
              size: "square",
              format: "png",
            },
          });
          expect(result.isError).not.toBe(true);
          const content = z
            .array(
              z.union([
                z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }),
                z.object({ type: z.literal("text"), text: z.string() }),
              ]),
            )
            .parse(result.content);
          const preview = content.find((item) => item.type === "image");
          const text = content.find((item) => item.type === "text");
          if (!preview || preview.type !== "image" || !text || text.type !== "text")
            throw new Error("Hosted export content missing.");
          const dimensions = inspectPngHeader(Buffer.from(preview.data, "base64"));
          expect(Math.max(dimensions.width, dimensions.height)).toBeLessThanOrEqual(768);
          const metadata = HostedRenderedExportSchema.parse(JSON.parse(text.text));
          expect(metadata).toMatchObject({
            status: "completed",
            format: "png",
            width: 1080,
            height: 1080,
          });
          expect(text.text).not.toContain("outputPaths");
          expect(text.text).not.toContain("previewDataUrl");
          const asset = metadata.assets[0]!;
          const response = await fetch(asset.url);
          expect(response.status).toBe(200);
          expect(inspectPngHeader(Buffer.from(await response.arrayBuffer()))).toEqual({
            width: 1080,
            height: 1080,
          });
          const capability = capabilities.get(new URL(asset.url).pathname.slice(1))!;
          const prefix = createHash("sha256").update(owner.uid).digest("hex");
          expect(capability.key.startsWith(`${prefix}/`)).toBe(true);
          expect((await fetch(`${downloadBase}/unauthorized`)).status).toBe(403);
          capability.expiresAt = 0;
          expect((await fetch(asset.url)).status).toBe(403);
        } finally {
          await client.close();
        }
      }
      expect(reports).toEqual([]);
    });

    it("lists and reads only the caller's saved designs, then renders one as a template", async () => {
      const owner = await user();
      const stranger = await user();
      const template = structuredClone(getTemplateBundle("quote-card"));
      function saved(title: string) {
        return WorkspaceProjectSchema.parse({
          version: 2,
          title,
          size: "square",
          pages: [
            {
              id: "page-1",
              title: "Top 3 of the Week",
              description: "An editable weekly roundup.",
              template,
              data: template.manifest.sampleData,
              theme: template.manifest.defaultTheme,
              tokenOverrides: {},
            },
          ],
        });
      }
      async function seed(
        title: string,
        ownerId: string | null,
        updatedAt: string,
        deleted = false,
      ) {
        const id = randomUUID();
        designs.add(id);
        const guestKeyHash = ownerId ? null : createHash("sha256").update(id).digest("hex");
        await database
          .collection("designs")
          .doc(id)
          .set(
            deleted
              ? {
                  id,
                  owner_id: ownerId,
                  guest_key_hash: guestKeyHash,
                  revision: 1,
                  deleted_at: updatedAt,
                }
              : {
                  id,
                  owner_id: ownerId,
                  document_json: JSON.stringify(saved(title)),
                  guest_key_hash: guestKeyHash,
                  revision: 1,
                  created_at: "2026-11-01T00:00:00.000Z",
                  updated_at: updatedAt,
                },
          );
        return id;
      }
      const older = await seed("Untitled design", owner.uid, "2026-11-02T00:00:00.000Z");
      const weekly = await seed("The Weekly Social Three", owner.uid, "2026-11-03T00:00:00.000Z");
      const deleted = await seed("Deleted", owner.uid, "2026-11-04T00:00:00.000Z", true);
      const foreign = await seed("Someone else's", stranger.uid, "2026-11-05T00:00:00.000Z");
      const guest = await seed("Guest draft", null, "2026-11-05T00:00:00.000Z");

      const { tokens } = await grant(owner.idToken);
      rateRecords.add(`render-rate_${hash(`${owner.uid}:${Math.floor(now / 60)}`)}`);
      const client = new Client({ name: "hosted-design-fixture", version: "1" });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
            requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
          }),
        );
        const tools = (await client.listTools()).tools;
        expect(tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["list_designs", "get_design"]),
        );
        expect(tools.find((tool) => tool.name === "list_templates")?.description).toContain(
          "list_designs",
        );
        const prompt = await client.getPrompt({
          name: "distill_to_post",
          arguments: { source: "Weekly news." },
        });
        expect(prompt.messages[0]?.content).toMatchObject({
          text: expect.stringContaining("list_designs"),
        });

        function text(result: Awaited<ReturnType<typeof client.callTool>>) {
          const item = z
            .array(z.object({ type: z.string(), text: z.string().optional() }))
            .parse(result.content)
            .find((entry) => entry.type === "text");
          if (!item?.text) throw new Error("Tool text content missing.");
          return item.text;
        }

        const listed = z
          .object({
            designs: z.array(
              z.object({
                id: z.string(),
                title: z.string(),
                pages: z.array(z.object({ title: z.string(), slots: z.array(z.string()) })),
              }),
            ),
          })
          .parse(JSON.parse(text(await client.callTool({ name: "list_designs", arguments: {} }))));
        expect(listed.designs.map((design) => design.id)).toEqual([weekly, older]);
        expect(listed.designs[0]).toMatchObject({
          title: "The Weekly Social Three",
          pages: [{ title: "Top 3 of the Week", slots: expect.arrayContaining(["quote"]) }],
        });

        for (const hidden of [deleted, foreign, guest, randomUUID()]) {
          const denied = await client.callTool({
            name: "get_design",
            arguments: { designId: hidden },
          });
          expect(denied.isError).toBe(true);
          expect(text(denied)).toContain("not found");
        }

        const fetched = z
          .object({ id: z.string(), document: WorkspaceProjectSchema, nextStep: z.string() })
          .parse(
            JSON.parse(
              text(await client.callTool({ name: "get_design", arguments: { designId: weekly } })),
            ),
          );
        expect(fetched.id).toBe(weekly);
        expect(fetched.nextStep).toContain("render_workspace");
        const document = fetched.document;
        document.pages[0]!.data = {
          ...document.pages[0]!.data,
          quote: "Agents can now reuse a saved tinytldr design.",
        };
        const rendered = await client.callTool({
          name: "render_workspace",
          arguments: { document, format: "png" },
        });
        expect(rendered.isError).not.toBe(true);
        const metadata = HostedRenderedExportSchema.parse(JSON.parse(text(rendered)));
        expect(metadata).toMatchObject({ status: "completed", width: 1080, height: 1080 });
        const download = await fetch(metadata.assets[0]!.url);
        expect(inspectPngHeader(Buffer.from(await download.arrayBuffer()))).toEqual({
          width: 1080,
          height: 1080,
        });
      } finally {
        await client.close();
      }
      expect(
        JSON.parse((await database.collection("designs").doc(weekly).get()).get("document_json"))
          .pages[0].data.quote,
      ).toBe(template.manifest.sampleData.quote);
      expect(reports).toEqual([]);
    });

    it("invalidates grants after Firebase password-session revocation", async () => {
      const owner = await user();
      const { tokens } = await grant(owner.idToken);
      const decoded = await auth.verifyIdToken(owner.idToken);
      await expect.poll(() => Math.floor(Date.now() / 1000)).toBeGreaterThan(decoded.auth_time);
      await auth.revokeRefreshTokens(owner.uid);
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow("changed");
    });

    it("enforces body and attempt limits at the protected HTTP boundary", async () => {
      const owner = await user();
      const { tokens } = await grant(owner.idToken);
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.access_token}`,
      };
      const oversized = await fetch(`${base}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ payload: "x".repeat(2_000_000) }),
      });
      expect(oversized.status).toBe(413);
      rateRecords.add(`render-rate_${hash(`${owner.uid}:${Math.floor(now / 60)}`)}`);
      for (let index = 0; index < 6; index++) {
        const response = await fetch(`${base}/mcp`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: index,
            method: "tools/call",
            params: { name: "preview_post", arguments: { templateId: "unknown" } },
          }),
        });
        expect(response.status).toBe(400);
      }
      const denied = await fetch(`${base}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "preview_post", arguments: { templateId: "quote-card" } },
        }),
      });
      expect(denied.status).toBe(429);
      expect(denied.headers.get("retry-after")).toBe("60");
    });

    it("never stores raw authorization codes or bearer tokens", async () => {
      const client = await register();
      const { code, verifier } = await approve(client);
      const response = await exchange(client, code, verifier);
      const tokens = OAuthTokensSchema.parse(await response.json());
      const stored = JSON.stringify(
        (await database.collection("mcpOAuthRecords").get()).docs.map((doc) => ({
          id: doc.id,
          data: doc.data(),
        })),
      );
      for (const secret of [code, tokens.access_token, tokens.refresh_token!])
        expect(stored).not.toContain(secret);
    });
  },
);
