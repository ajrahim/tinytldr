import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Response } from "express";
import type { App } from "firebase-admin/app";
import type { Auth, UserRecord } from "firebase-admin/auth";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import {
  HOSTED_MCP_ACCESS_LIFETIME_SECONDS,
  HOSTED_MCP_CODE_LIFETIME_SECONDS,
  HOSTED_MCP_REFRESH_LIFETIME_SECONDS,
  HOSTED_MCP_SCOPE,
  HostedMcpAuthorizationRecordSchema,
  HostedMcpAccountLookupSchema,
  HostedMcpCodeRecordSchema,
  HostedMcpGrantRecordSchema,
  HostedMcpRateRecordSchema,
  HostedMcpRedirectUriSchema,
  HostedMcpTokenRecordSchema,
  type HostedMcpGrantRecord,
} from "@tinytldr/core";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
  OAuthClientInformationFullSchema,
  type OAuthClientInformationFull,
  type OAuthTokenRevocationRequest,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const EnvelopeSchema = z.object({
  record: z.unknown(),
  expiresAt: z.number().int().positive(),
});
const CollectionName = "mcpOAuthRecords";

function hash(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function token() {
  return randomBytes(32).toString("base64url");
}

export function firebaseAccountCreationTime(app: App) {
  const projectId = app.options.projectId;
  if (!projectId) throw new Error("Firebase project ID is required for hosted authorization.");
  return async (uid: string) => {
    const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const origin = emulator
      ? `http://${emulator}/identitytoolkit.googleapis.com`
      : "https://identitytoolkit.googleapis.com";
    const credential = app.options.credential;
    let accessToken = "owner";
    if (!emulator) {
      if (!credential) throw new Error("Firebase credentials are required.");
      accessToken = (await credential.getAccessToken()).access_token;
    }
    const response = await fetch(
      `${origin}/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ localId: [uid] }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`Firebase account lookup failed (HTTP ${response.status}).`);
    const account = HostedMcpAccountLookupSchema.parse(await response.json()).users?.find(
      (user) => user.localId === uid,
    );
    if (!account) throw new InvalidTokenError("Account no longer exists. Sign in again.");
    return account.createdAt;
  };
}

export class FirebaseOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(
    private readonly database: Firestore,
    private readonly auth: Auth,
    readonly issuer: URL,
    private readonly accountCreatedAt: (uid: string) => Promise<string>,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.clientsStore = {
      getClient: async (clientId) => {
        const snapshot = await this.ref("client", clientId).get();
        const envelope = this.liveEnvelope(snapshot);
        return envelope ? OAuthClientInformationFullSchema.parse(envelope.record) : undefined;
      },
      registerClient: async (client) => {
        if (
          client.redirect_uris.length === 0 ||
          client.redirect_uris.length > 5 ||
          client.redirect_uris.some(
            (uri) => uri.length > 2048 || !HostedMcpRedirectUriSchema.safeParse(uri).success,
          ) ||
          (client.client_name && client.client_name.length > 200)
        )
          throw new InvalidClientMetadataError("Register up to five HTTPS or loopback redirects.");
        const clientName = client.client_name?.trim() || "MCP client";
        const registered: OAuthClientInformationFull = {
          client_id: randomUUID(),
          client_id_issued_at: this.now(),
          client_name: clientName,
          redirect_uris: client.redirect_uris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: HOSTED_MCP_SCOPE,
        };
        await this.ref("client", registered.client_id).create(
          this.envelope(registered, this.now() + 30 * 24 * 60 * 60),
        );
        return registered;
      },
    };
  }

  get resource() {
    return new URL("/mcp", this.issuer).href;
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    this.requireResource(params.resource);
    this.requireScopes(params.scopes);
    if (!client.redirect_uris.includes(params.redirectUri))
      throw new InvalidRequestError("Redirect URI is not registered.");
    const requestId = randomUUID();
    const record = HostedMcpAuthorizationRecordSchema.parse({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      ...(params.state === undefined ? {} : { state: params.state }),
      resource: this.resource,
      expiresAt: this.now() + 5 * 60,
    });
    await this.ref("request", requestId).create(this.envelope(record, record.expiresAt));
    const page = new URL("/connect", this.issuer);
    page.searchParams.set("request", requestId);
    res.redirect(page.href);
  }

  async consent(requestId: string) {
    const record = this.requiredRecord(
      await this.ref("request", requestId).get(),
      HostedMcpAuthorizationRecordSchema,
    );
    const client = await this.clientsStore.getClient(record.clientId);
    if (!client) throw new InvalidGrantError("Client registration expired. Reconnect your client.");
    return {
      clientName: client.client_name || "MCP client",
      redirectOrigin: new URL(record.redirectUri).origin,
      expiresAt: record.expiresAt,
      scope: HOSTED_MCP_SCOPE,
    };
  }

  async decide(requestId: string, approved: boolean, firebaseToken?: string) {
    const identity = approved ? await this.identity(firebaseToken) : null;
    const authorizationCode = approved ? token() : null;
    return this.database.runTransaction(async (transaction) => {
      const requestRef = this.ref("request", requestId);
      const record = this.requiredRecord(
        await transaction.get(requestRef),
        HostedMcpAuthorizationRecordSchema,
      );
      const client = this.requiredRecord(
        await transaction.get(this.ref("client", record.clientId)),
        OAuthClientInformationFullSchema,
      );
      if (!client.redirect_uris.includes(record.redirectUri))
        throw new InvalidGrantError("Client redirect changed. Reconnect your client.");
      const redirect = new URL(record.redirectUri);
      if (record.state !== undefined) redirect.searchParams.set("state", record.state);
      if (identity && authorizationCode) {
        const codeRecord = HostedMcpCodeRecordSchema.parse({
          ...record,
          ...identity,
          expiresAt: this.now() + HOSTED_MCP_CODE_LIFETIME_SECONDS,
        });
        transaction.create(
          this.ref("code", authorizationCode),
          this.envelope(codeRecord, codeRecord.expiresAt),
        );
        redirect.searchParams.set("code", authorizationCode);
      } else redirect.searchParams.set("error", "access_denied");
      transaction.delete(requestRef);
      return { redirectUrl: redirect.href };
    });
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    const record = this.requiredRecord(
      await this.ref("code", code).get(),
      HostedMcpCodeRecordSchema,
    );
    if (record.clientId !== client.client_id) throw new InvalidGrantError("Invalid code.");
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.requireResource(resource);
    const current = this.requiredRecord(
      await this.ref("code", code).get(),
      HostedMcpCodeRecordSchema,
    );
    await this.requireActiveUser(current);
    return this.database.runTransaction(async (transaction) => {
      const ref = this.ref("code", code);
      const record = this.requiredRecord(await transaction.get(ref), HostedMcpCodeRecordSchema);
      // The SDK token handler validates PKCE before calling this method.
      if (
        record.clientId !== client.client_id ||
        redirectUri !== record.redirectUri ||
        (codeVerifier !== undefined && hash(codeVerifier) !== record.codeChallenge)
      )
        throw new InvalidGrantError("Code, redirect or PKCE verification is invalid.");
      const familyId = randomUUID();
      const family = HostedMcpGrantRecordSchema.parse({
        clientId: record.clientId,
        uid: record.uid,
        authTime: record.authTime,
        userCreatedAt: record.userCreatedAt,
        resource: this.resource,
        expiresAt: this.now() + HOSTED_MCP_REFRESH_LIFETIME_SECONDS,
        revoked: false,
      });
      const tokens = this.issueTokens(transaction, familyId, family);
      transaction.create(this.ref("family", familyId), this.envelope(family, family.expiresAt));
      transaction.delete(ref);
      return tokens;
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.requireResource(resource);
    this.requireScopes(scopes);
    const refresh = this.requiredRecord(
      await this.ref("refresh", refreshToken).get(),
      HostedMcpTokenRecordSchema,
    );
    const family = this.requiredRecord(
      await this.ref("family", refresh.familyId).get(),
      HostedMcpGrantRecordSchema,
    );
    await this.requireActiveUser(family);
    const outcome = await this.database.runTransaction(async (transaction) => {
      const refreshRef = this.ref("refresh", refreshToken);
      const current = this.requiredRecord(
        await transaction.get(refreshRef),
        HostedMcpTokenRecordSchema,
      );
      const familyRef = this.ref("family", current.familyId);
      const grant = this.requiredRecord(
        await transaction.get(familyRef),
        HostedMcpGrantRecordSchema,
      );
      if (current.clientId !== client.client_id || grant.clientId !== client.client_id)
        throw new InvalidGrantError("Invalid refresh token.");
      if (current.consumed) {
        transaction.set(familyRef, this.envelope({ ...grant, revoked: true }, grant.expiresAt));
        return null;
      }
      if (grant.revoked) throw new InvalidGrantError("Authorization was revoked. Sign in again.");
      const tokens = this.issueTokens(transaction, current.familyId, grant);
      transaction.set(refreshRef, this.envelope({ ...current, consumed: true }, current.expiresAt));
      return tokens;
    });
    if (!outcome) throw new InvalidGrantError("Refresh token replay. Sign in again.");
    return outcome;
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const accessEnvelope = this.liveEnvelope(await this.ref("access", accessToken).get());
    if (!accessEnvelope) throw new InvalidTokenError("Access token expired. Sign in again.");
    const access = HostedMcpTokenRecordSchema.parse(accessEnvelope.record);
    const familyEnvelope = this.liveEnvelope(await this.ref("family", access.familyId).get());
    if (!familyEnvelope) throw new InvalidTokenError("Authorization expired. Sign in again.");
    const family = HostedMcpGrantRecordSchema.parse(familyEnvelope.record);
    if (family.revoked || family.resource !== this.resource || family.clientId !== access.clientId)
      throw new InvalidTokenError("Authorization is invalid or revoked.");
    await this.requireActiveUser(family);
    return {
      token: accessToken,
      clientId: access.clientId,
      scopes: [HOSTED_MCP_SCOPE],
      expiresAt: access.expiresAt,
      resource: new URL(this.resource),
      extra: { uid: family.uid },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    await this.database.runTransaction(async (transaction) => {
      const snapshots = await Promise.all([
        transaction.get(this.ref("access", request.token)),
        transaction.get(this.ref("refresh", request.token)),
      ]);
      const envelope = snapshots.map((snapshot) => this.liveEnvelope(snapshot)).find(Boolean);
      if (!envelope) return;
      const record = HostedMcpTokenRecordSchema.parse(envelope.record);
      if (record.clientId !== client.client_id) return;
      const familyRef = this.ref("family", record.familyId);
      const familyEnvelope = this.liveEnvelope(await transaction.get(familyRef));
      if (!familyEnvelope) return;
      const family = HostedMcpGrantRecordSchema.parse(familyEnvelope.record);
      transaction.set(familyRef, this.envelope({ ...family, revoked: true }, family.expiresAt));
    });
  }

  async takeRender(uid: string) {
    const minute = Math.floor(this.now() / 60);
    return this.database.runTransaction(async (transaction) => {
      const ref = this.ref("render-rate", `${uid}:${minute}`);
      const envelope = this.liveEnvelope(await transaction.get(ref));
      const count = envelope ? HostedMcpRateRecordSchema.parse(envelope.record).count : 0;
      if (count >= 6) return false;
      const record = { count: count + 1, expiresAt: (minute + 2) * 60 };
      transaction.set(ref, this.envelope(record, record.expiresAt));
      return true;
    });
  }

  private ref(kind: string, key: string) {
    return this.database.collection(CollectionName).doc(`${kind}_${hash(key)}`);
  }

  private envelope(record: unknown, expiresAt: number) {
    return { record, expiresAt, ttlAt: new Date(expiresAt * 1000) };
  }

  private liveEnvelope(snapshot: DocumentSnapshot) {
    if (!snapshot.exists) return undefined;
    const envelope = EnvelopeSchema.parse(snapshot.data());
    return envelope.expiresAt > this.now() ? envelope : undefined;
  }

  private requiredRecord<T>(snapshot: DocumentSnapshot, schema: { parse(value: unknown): T }) {
    const envelope = this.liveEnvelope(snapshot);
    if (!envelope) throw new InvalidGrantError("Authorization expired or is invalid.");
    return schema.parse(envelope.record);
  }

  private requireScopes(scopes?: string[]) {
    if (scopes?.some((scope) => scope !== HOSTED_MCP_SCOPE))
      throw new InvalidScopeError(`Only ${HOSTED_MCP_SCOPE} is supported.`);
  }

  private requireResource(resource?: URL) {
    if (resource && resource.href !== this.resource)
      throw new InvalidRequestError(
        "This authorization is only valid for the tinytldr MCP endpoint.",
      );
  }

  private async identity(firebaseToken?: string) {
    if (!firebaseToken) throw new InvalidTokenError("Sign in to authorize your client.");
    const decoded = await this.auth
      .verifyIdToken(firebaseToken, true)
      .catch((error: unknown) => this.authenticationError(error));
    const user = await this.auth
      .getUser(decoded.uid)
      .catch((error: unknown) => this.authenticationError(error));
    const createdAt = await this.accountCreatedAt(user.uid);
    this.validateUser(user, decoded.auth_time, createdAt, createdAt);
    return {
      uid: decoded.uid,
      authTime: decoded.auth_time,
      userCreatedAt: createdAt,
    };
  }

  private async requireActiveUser(
    record: Pick<HostedMcpGrantRecord, "uid" | "authTime" | "userCreatedAt">,
  ) {
    const user = await this.auth
      .getUser(record.uid)
      .catch((error: unknown) => this.authenticationError(error));
    const createdAt = await this.accountCreatedAt(user.uid);
    this.validateUser(user, record.authTime, record.userCreatedAt, createdAt);
  }

  private validateUser(
    user: UserRecord,
    authTime: number,
    createdAt: string,
    currentCreatedAt: string,
  ) {
    const revokedAfter = user.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) : 0;
    if (
      user.disabled ||
      !Number.isFinite(authTime) ||
      authTime <= 0 ||
      currentCreatedAt !== createdAt ||
      !Number.isFinite(revokedAfter) ||
      authTime < Math.floor(revokedAfter / 1000)
    )
      throw new InvalidTokenError("Account authorization changed. Sign in again.");
  }

  private authenticationError(error: unknown): never {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      [
        "auth/user-not-found",
        "auth/user-disabled",
        "auth/id-token-expired",
        "auth/id-token-revoked",
        "auth/invalid-id-token",
        "auth/argument-error",
      ].includes(error.code)
    )
      throw new InvalidTokenError("Account authorization is invalid. Sign in again.");
    throw error;
  }

  private issueTokens(transaction: Transaction, familyId: string, family: HostedMcpGrantRecord) {
    const accessToken = token();
    const refreshToken = token();
    const accessExpires = Math.min(
      this.now() + HOSTED_MCP_ACCESS_LIFETIME_SECONDS,
      family.expiresAt,
    );
    const record = {
      familyId,
      clientId: family.clientId,
      consumed: false,
    };
    transaction.create(
      this.ref("access", accessToken),
      this.envelope({ ...record, expiresAt: accessExpires }, accessExpires),
    );
    transaction.create(
      this.ref("refresh", refreshToken),
      this.envelope({ ...record, expiresAt: family.expiresAt }, family.expiresAt),
    );
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: accessExpires - this.now(),
      refresh_token: refreshToken,
      scope: HOSTED_MCP_SCOPE,
    };
  }
}
