import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AI_PROVIDER_BASE_URLS,
  projectFromDocument,
  type AiProviderConnectionInput,
} from "@tinytldr/core";
import { AiConnectionService } from "../src/AiConnectionService.js";
import { createFirebaseUserVerifier } from "../src/FirebaseIdentity.js";
import { createAiGateway } from "../../server/AiGateway.js";
import { createBlankDocument } from "../../src/lib/WorkspaceTemplates.js";

const key = "test-only-provider-key-not-for-network";
const encryptionKey = "ab".repeat(32);
const input = { provider: "openai" as const, baseUrl: AI_PROVIDER_BASE_URLS.openai, apiKey: key };
const models = [
  { id: "gpt-test", name: "API model" },
  { id: "gpt-next", name: "API next model" },
];
const origin = "http://localhost:5173";

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)(
  "Real Firebase single AI connection and gateway",
  () => {
    const app = initializeApp({ projectId: "demo-tinytldr" }, "firebase-ai-tests");
    const db = getFirestore(app);
    let clock = Date.now();
    const service = new AiConnectionService(
      db,
      () => encryptionKey,
      () => clock,
    );
    let owner: string;
    let token: string;
    let other: string;
    const reference = (uid: string) =>
      db.collection("aiAccounts").doc(Buffer.from(uid).toString("base64url"));
    beforeEach(async () => {
      clock = Date.now();
      const response = await fetch(
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ returnSecureToken: true }),
        },
      );
      expect(response.ok).toBe(true);
      const account = z
        .object({ localId: z.string(), idToken: z.string() })
        .parse(await response.json());
      owner = account.localId;
      token = account.idToken;
      other = randomUUID();
    });
    afterEach(async () => {
      await Promise.all([reference(owner).delete(), reference(other).delete()]);
      await getAuth(app).deleteUser(owner);
    });
    afterAll(async () => {
      await db.terminate();
      await deleteApp(app);
    });

    async function saved(uid: string, connection: AiProviderConnectionInput = input) {
      const result = await service.connect(uid, connection, connection.baseUrl, models);
      return (await service.selectModel(uid, result[0]!.id, models[0]!.id))[0]!;
    }

    it("encrypts keys, connects without a guessed model, and denies direct Firestore reads", async () => {
      const [connection] = await service.connect(owner, input, input.baseUrl, models);
      expect(connection).toMatchObject({ model: null, model_name: null, models, is_default: true });
      expect(JSON.stringify(connection)).not.toContain(key);
      expect(JSON.stringify((await reference(owner).get()).data())).not.toContain(key);
      await expect(service.secret(owner, connection!.id)).rejects.toThrow("Choose a model");
      expect((await service.credentials(owner, connection!.id)).secret.api_key).toBe(key);
      const response = await fetch(
        `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-tinytldr/databases/(default)/documents/aiAccounts/${reference(owner).id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(403);
    });

    it("remembers API model choice and re-encrypts model-bound associated data", async () => {
      const first = await saved(owner);
      const before = (await reference(owner).get()).data();
      clock += 1;
      const [changed] = await service.selectModel(owner, first.id, models[1]!.id);
      expect(changed).toMatchObject({ model: models[1]!.id, model_name: models[1]!.name });
      expect((await reference(owner).get()).data()).not.toEqual(before);
      expect(await service.secret(owner, first.id)).toMatchObject({
        model: models[1]!.id,
        api_key: key,
      });
      expect((await new AiConnectionService(db, () => encryptionKey).list(owner))[0]).toEqual(
        changed,
      );
      await expect(service.selectModel(owner, first.id, "manual-id")).rejects.toThrow(
        "provider's model list",
      );
      await expect(service.selectModel(other, first.id, models[0]!.id)).rejects.toThrow(
        "unavailable",
      );
    });

    it("saves, applies, preserves and clears the output token limit", async () => {
      const first = await saved(owner);
      expect(first.max_output_tokens).toBeUndefined();
      expect((await service.secret(owner, first.id))?.max_output_tokens).toBeUndefined();
      const [limited] = await service.setOutputTokens(owner, first.id, 64_000);
      expect(limited!.max_output_tokens).toBe(64_000);
      expect(await service.secret(owner, first.id)).toMatchObject({
        max_output_tokens: 64_000,
        api_key: key,
      });
      await service.connect(
        owner,
        { ...input, id: first.id, apiKey: `${key}-next` },
        input.baseUrl,
        models,
      );
      expect((await service.list(owner))[0]!.max_output_tokens).toBe(64_000);
      await expect(service.setOutputTokens(owner, first.id, 500)).rejects.toThrow();
      await expect(service.setOutputTokens(other, first.id, 64_000)).rejects.toThrow("unavailable");
      const [cleared] = await service.setOutputTokens(owner, first.id, null);
      expect("max_output_tokens" in cleared!).toBe(false);
    });

    it("replaces keys while preserving an available same-provider model and isolating owners", async () => {
      const first = await saved(owner);
      const replacement = `${key}-replacement`;
      await service.connect(
        owner,
        { ...input, id: first.id, apiKey: replacement },
        input.baseUrl,
        models,
      );
      expect(await service.secret(owner, first.id)).toMatchObject({
        model: first.model,
        api_key: replacement,
      });
      expect(await service.secret(other, first.id)).toBeNull();
      await expect(
        service.connect(other, { ...input, id: first.id }, input.baseUrl, models),
      ).rejects.toThrow("unavailable");
      await expect(service.delete(other, first.id)).rejects.toThrow("unavailable");
      expect(await service.list(other)).toEqual([]);
    });

    it("binds ciphertext to account/model metadata and surfaces tampering and corruption", async () => {
      const connection = await saved(owner);
      const stored = (await reference(owner).get()).data()!;
      await reference(other).set(stored);
      await expect(service.secret(other, connection.id)).rejects.toThrow();
      await reference(owner).update({
        connections: [{ ...stored.connections[0], metadata: { ...connection, model: "tampered" } }],
      });
      await expect(service.secret(owner, connection.id)).rejects.toThrow();
      await reference(owner).set({ connections: "invalid", limits: {} });
      await expect(service.list(owner)).rejects.toThrow();
    });

    it("disconnects the only connection and removes all encrypted key material", async () => {
      const connection = await saved(owner);
      expect(await service.delete(owner, connection.id)).toEqual([]);
      expect(await service.list(owner)).toEqual([]);
      expect(await service.secret(owner, connection.id)).toBeNull();
      expect((await reference(owner).get()).get("connections")).toEqual([]);
      const replacement = await saved(owner);
      expect(replacement.id).not.toBe(connection.id);
    });

    it("enforces exactly one connection under competing writes without silently replacing a key", async () => {
      const results = await Promise.allSettled([
        service.connect(owner, input, input.baseUrl, models),
        service.connect(owner, input, input.baseUrl, models),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await service.list(owner)).toHaveLength(1);
      await expect(service.connect(owner, input, input.baseUrl, models)).rejects.toThrow(
        "already have",
      );
    });

    it("clears missing models on refresh and rejects stale catalogs after a key replacement", async () => {
      const connection = await saved(owner);
      const before = await service.credentials(owner, connection.id);
      await service.connect(
        owner,
        { ...input, id: connection.id, apiKey: `${key}-new` },
        input.baseUrl,
        models,
      );
      await expect(
        service.updateModels(owner, connection.id, models, before.revision),
      ).rejects.toThrow("connection changed");
      const current = await service.credentials(owner, connection.id);
      const [updated] = await service.updateModels(
        owner,
        connection.id,
        [models[1]!],
        current.revision,
      );
      expect(updated).toMatchObject({ model: null, model_name: null, models: [models[1]!] });
      expect((await service.credentials(owner, connection.id)).secret.api_key).toBe(`${key}-new`);
    });

    it("enforces five requests per exact minute independently for buckets and accounts", async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => service.takeRequest(owner, "generate")),
      );
      expect(results.filter(Boolean)).toHaveLength(5);
      for (let index = 0; index < 5; index++)
        expect(await service.takeRequest(owner, "connect")).toBe(true);
      expect(await service.takeRequest(owner, "connect")).toBe(false);
      expect(await service.takeRequest(other, "generate")).toBe(true);
      clock = (Math.floor(clock / 60_000) + 1) * 60_000;
      expect(await service.takeRequest(owner, "generate")).toBe(true);
      expect(await service.takeRequest(owner, "connect")).toBe(true);
    });

    it("rejects invalid encryption configuration without writing plaintext", async () => {
      const invalid = new AiConnectionService(db, () => "invalid");
      await expect(invalid.connect(owner, input, input.baseUrl, models)).rejects.toThrow(
        "encryption",
      );
      expect((await reference(owner).get()).exists).toBe(false);
    });

    it("cleans keys/rates idempotently and rejects deleted-user tokens and subsequent writes", async () => {
      await saved(owner);
      await service.takeRequest(owner, "generate");
      await service.deleteAccount(owner);
      await service.deleteAccount(owner);
      expect((await reference(owner).get()).data()).toEqual({
        connections: [],
        limits: {},
        deleted: true,
      });
      await expect(service.connect(owner, input, input.baseUrl, models)).rejects.toThrow(
        "account is unavailable",
      );
      await getAuth(app).deleteUser(owner);
      expect(await createFirebaseUserVerifier(getAuth(app))(token)).toBeNull();
      owner = (await getAuth(app).createUser({ uid: owner })).uid;
    });

    it("rejects a connection finishing API discovery after account cleanup", async () => {
      let release!: () => void;
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gateway = createAiGateway({
        store: service,
        verifyUser: createFirebaseUserVerifier(getAuth(app)),
        allowedOrigins: [origin],
        customBaseUrls: [],
        reportError: () => {},
        fetch: async () => {
          started();
          await waiting;
          return Response.json({ data: [{ id: models[0]!.id }] });
        },
      });
      const saving = gateway(
        new Request("https://ai.test", {
          method: "POST",
          headers: { Origin: origin, Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "connect", connection: input }),
        }),
      );
      await entered;
      await service.deleteAccount(owner);
      release();
      expect((await saving).status).toBe(401);
      expect((await reference(owner).get()).data()).toEqual({
        connections: [],
        limits: {},
        deleted: true,
      });
    });

    it("verifies tokens, discovers rather than generates on Connect, preserves keys on refresh errors and generates after selection", async () => {
      const calls: RequestInit[] = [];
      let rejectModels = false;
      const gateway = createAiGateway({
        store: service,
        verifyUser: createFirebaseUserVerifier(getAuth(app)),
        allowedOrigins: [origin],
        customBaseUrls: [],
        reportError: () => {},
        fetch: async (_url, options) => {
          calls.push(options!);
          if (options?.method === "GET") {
            if (rejectModels) return Response.json({ error: key }, { status: 401 });
            return Response.json({ data: models.map((model) => ({ id: model.id })) });
          }
          return Response.json({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify(projectFromDocument(createBlankDocument())),
                },
              },
            ],
          });
        },
      });
      const send = (body: unknown, bearer = token, requestOrigin = origin) =>
        gateway(
          new Request("https://ai.test", {
            method: "POST",
            headers: { Origin: requestOrigin, Authorization: `Bearer ${bearer}` },
            body: JSON.stringify(body),
          }),
        );
      expect((await send({ action: "list" }, "invalid")).status).toBe(401);
      expect((await send({ action: "list" }, token, "https://unapproved.example")).status).toBe(
        403,
      );
      expect(
        (
          await send({
            action: "connect",
            connection: { ...input, baseUrl: "https://unapproved.example/v1" },
          })
        ).status,
      ).toBe(400);
      for (const action of ["save", "default", "keep"])
        expect((await send({ action, connection: input })).status).toBe(400);
      expect(calls).toHaveLength(0);
      expect((await send({ action: "connect", connection: input })).status).toBe(200);
      const [connection] = await service.list(owner);
      expect(calls.map((call) => call.method)).toEqual(["GET"]);
      expect(
        (await send({ action: "model", id: connection!.id, model: models[0]!.id })).status,
      ).toBe(200);
      const before = await service.list(owner);
      rejectModels = true;
      const failed = await send({ action: "models", id: connection!.id });
      expect(failed.status).toBe(502);
      expect(await failed.text()).not.toContain(key);
      expect(await service.list(owner)).toEqual(before);
      const response = await send({
        action: "generate",
        request: {
          connectionId: connection!.id,
          document: projectFromDocument(createBlankDocument()),
          prompt: "Create a design.",
          context: [],
          targetPageIds: [],
        },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toHaveProperty("document");
      expect(calls.map((call) => call.method)).toEqual(["GET", "GET", "POST"]);
      expect(new Headers(calls.at(-1)!.headers).get("Authorization")).toBe(`Bearer ${key}`);
      expect(JSON.stringify(await service.list(owner))).not.toContain(key);
    });
  },
);
