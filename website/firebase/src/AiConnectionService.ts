import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import {
  AiConnectionSchema,
  AiProviderConnectionInputSchema,
  AiModelsSchema,
  AI_PROVIDER_NAMES,
  type AiConnection,
  type AiProviderConnectionInput,
  type AiModel,
} from "@tinytldr/core/ai";
import type { AiConnectionStore } from "../../server/AiGateway.ts";
import {
  AiRequestError,
  ProviderCredentialsSchema,
  ProviderSecretSchema,
} from "../../server/AiProviders.ts";

const EncryptedKeySchema = z
  .object({
    version: z.literal(1),
    iv: z.string().regex(/^[a-f0-9]{24}$/),
    tag: z.string().regex(/^[a-f0-9]{32}$/),
    ciphertext: z
      .string()
      .min(16)
      .max(16_384)
      .regex(/^(?:[a-f0-9]{2})+$/),
  })
  .strict();
const StoredConnectionSchema = z
  .object({ metadata: AiConnectionSchema, key: EncryptedKeySchema })
  .strict();
const LimitSchema = z
  .object({ window: z.number().int().nonnegative(), requests: z.number().int().min(1).max(5) })
  .strict();
const AccountSchema = z
  .object({
    connections: z.array(StoredConnectionSchema).max(1),
    limits: z
      .object({ generate: LimitSchema.optional(), connect: LimitSchema.optional() })
      .strict(),
    deleted: z.literal(true).optional(),
  })
  .strict();
type AccountRecord = z.infer<typeof AccountSchema>;
type StoredConnection = z.infer<typeof StoredConnectionSchema>;

function metadata(account: AccountRecord): AiConnection[] {
  return account.connections
    .map((connection) => connection.metadata)
    .sort(
      (a, b) =>
        Number(b.is_default) - Number(a.is_default) ||
        b.updated_at.localeCompare(a.updated_at) ||
        a.id.localeCompare(b.id),
    );
}

export class AiConnectionService implements AiConnectionStore {
  constructor(
    private readonly db: Firestore,
    private readonly encryptionKey: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  private account(owner: string) {
    return this.db.collection("aiAccounts").doc(Buffer.from(owner, "utf8").toString("base64url"));
  }

  private read(value: unknown, exists: boolean): AccountRecord {
    const account = exists ? AccountSchema.parse(value) : { connections: [], limits: {} };
    if (account.deleted)
      throw new AiRequestError(401, "auth", "This account is unavailable. Sign in again.");
    return account;
  }

  private cipherKey() {
    const key = this.encryptionKey();
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new AiRequestError(503, "configuration", "AI encryption is not configured correctly.");
    return Buffer.from(key, "hex");
  }

  private associatedData(owner: string, connection: AiConnection) {
    return Buffer.from(
      JSON.stringify([
        owner,
        connection.id,
        connection.provider,
        connection.base_url,
        connection.model,
      ]),
      "utf8",
    );
  }

  private encrypt(owner: string, connection: AiConnection, apiKey: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.cipherKey(), iv);
    cipher.setAAD(this.associatedData(owner, connection));
    return {
      version: 1 as const,
      iv: iv.toString("hex"),
      ciphertext: Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]).toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
    };
  }

  async list(owner: string) {
    const snapshot = await this.account(owner).get();
    return metadata(this.read(snapshot.data(), snapshot.exists));
  }

  async secret(owner: string, id: string) {
    const snapshot = await this.account(owner).get();
    const account = this.read(snapshot.data(), snapshot.exists);
    const connection = account.connections.find((entry) => entry.metadata.id === id);
    if (!connection) return null;
    if (connection.metadata.model === null)
      throw new AiRequestError(400, "model", "Choose a model before generating.");
    return ProviderSecretSchema.parse({
      provider: connection.metadata.provider,
      base_url: connection.metadata.base_url,
      model: connection.metadata.model,
      api_key: this.decrypt(owner, connection),
    });
  }

  private decrypt(owner: string, connection: StoredConnection) {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.cipherKey(),
      Buffer.from(connection.key.iv, "hex"),
    );
    decipher.setAAD(this.associatedData(owner, connection.metadata));
    decipher.setAuthTag(Buffer.from(connection.key.tag, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(connection.key.ciphertext, "hex")),
      decipher.final(),
    ]).toString("utf8");
  }

  async credentials(owner: string, id: string) {
    const snapshot = await this.account(owner).get();
    const connection = this.read(snapshot.data(), snapshot.exists).connections.find(
      (entry) => entry.metadata.id === id,
    );
    if (!connection)
      throw new AiRequestError(404, "connection", "This provider connection is unavailable.");
    return {
      secret: ProviderCredentialsSchema.parse({
        provider: connection.metadata.provider,
        base_url: connection.metadata.base_url,
        api_key: this.decrypt(owner, connection),
      }),
      revision: connection.key.iv,
    };
  }

  async connect(
    owner: string,
    input: AiProviderConnectionInput,
    baseUrl: string,
    models: AiModel[],
  ) {
    const checked = AiProviderConnectionInputSchema.parse(input);
    const catalog = AiModelsSchema.parse(models);
    const reference = this.account(owner);
    const id = checked.id ?? randomUUID();
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const account = this.read(snapshot.data(), snapshot.exists);
      const existing = account.connections[0];
      if (checked.id && !existing)
        throw new AiRequestError(404, "connection", "This provider connection is unavailable.");
      if (existing && checked.id !== existing.metadata.id)
        throw new AiRequestError(
          409,
          "connections",
          "You already have an AI connection. Choose Replace to change it.",
        );
      const selected =
        existing &&
        existing.metadata.provider === checked.provider &&
        existing.metadata.base_url === baseUrl
          ? catalog.find((model) => model.id === existing.metadata.model)
          : undefined;
      const connection = AiConnectionSchema.parse({
        id,
        name: AI_PROVIDER_NAMES[checked.provider],
        provider: checked.provider,
        base_url: baseUrl,
        model: selected?.id ?? null,
        model_name: selected?.name ?? null,
        models: catalog,
        key_suffix: checked.apiKey.slice(-4),
        is_default: true,
        updated_at: new Date(this.now()).toISOString(),
      });
      const stored: StoredConnection = {
        metadata: connection,
        key: this.encrypt(owner, connection, checked.apiKey),
      };
      account.connections = [stored];
      transaction.set(reference, AccountSchema.parse(account));
      return metadata(account);
    });
  }

  private updateSelection(owner: string, connection: StoredConnection, model: AiModel | undefined) {
    const apiKey = this.decrypt(owner, connection);
    connection.metadata.model = model?.id ?? null;
    connection.metadata.model_name = model?.name ?? null;
    connection.metadata.updated_at = new Date(this.now()).toISOString();
    connection.key = this.encrypt(owner, connection.metadata, apiKey);
  }

  private async update(owner: string, id: string, change: (connection: StoredConnection) => void) {
    const reference = this.account(owner);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const account = this.read(snapshot.data(), snapshot.exists);
      const connection = account.connections.find((entry) => entry.metadata.id === id);
      if (!connection)
        throw new AiRequestError(404, "connection", "This provider connection is unavailable.");
      change(connection);
      transaction.set(reference, AccountSchema.parse(account));
      return metadata(account);
    });
  }

  async updateModels(owner: string, id: string, models: AiModel[], revision: string) {
    const catalog = AiModelsSchema.parse(models);
    return this.update(owner, id, (connection) => {
      if (connection.key.iv !== revision)
        throw new AiRequestError(
          409,
          "connection",
          "The connection changed while loading models. Refresh models again.",
        );
      const selected = catalog.find((model) => model.id === connection.metadata.model);
      this.updateSelection(owner, connection, selected);
      connection.metadata.models = catalog;
    });
  }

  async selectModel(owner: string, id: string, model: string) {
    return this.update(owner, id, (connection) => {
      const selected = connection.metadata.models?.find((entry) => entry.id === model);
      if (!selected)
        throw new AiRequestError(
          400,
          "model",
          "Choose a model from the provider's model list. Refresh models if needed.",
        );
      this.updateSelection(owner, connection, selected);
    });
  }

  async delete(owner: string, id: string) {
    const reference = this.account(owner);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const account = this.read(snapshot.data(), snapshot.exists);
      const existing = account.connections.find((entry) => entry.metadata.id === id);
      if (!existing)
        throw new AiRequestError(404, "connection", "This provider connection is unavailable.");
      account.connections = [];
      transaction.set(reference, AccountSchema.parse(account));
      return metadata(account);
    });
  }

  async takeRequest(owner: string, bucket: "generate" | "connect") {
    const reference = this.account(owner);
    const window = Math.floor(this.now() / 60_000);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const account = this.read(snapshot.data(), snapshot.exists);
      const current = account.limits[bucket];
      if (current?.window === window && current.requests >= 5) return false;
      account.limits[bucket] = {
        window,
        requests: current?.window === window ? current.requests + 1 : 1,
      };
      transaction.set(reference, AccountSchema.parse(account));
      return true;
    });
  }

  async deleteAccount(owner: string) {
    // A tombstone prevents an already-verified request from restoring deleted credentials.
    await this.account(owner).set({ connections: [], limits: {}, deleted: true });
  }
}
