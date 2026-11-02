import { z } from "zod";

export const HOSTED_MCP_SCOPE = "mcp:render";
export const HOSTED_MCP_REQUEST_MAX_BYTES = 2_000_000;
export const HOSTED_MCP_ACCESS_LIFETIME_SECONDS = 300;
export const HOSTED_MCP_REFRESH_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
export const HOSTED_MCP_CODE_LIFETIME_SECONDS = 60;
export const HostedMcpRedirectUriSchema = z
  .string()
  .url()
  .max(8192)
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  }, "OAuth redirects must use HTTPS or an HTTP loopback address.");
export const HostedMcpPacketSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string().max(200), z.number().finite()]).optional(),
    method: z.string().min(1).max(100),
    params: z.record(z.unknown()).optional(),
  })
  .strict();
export const HostedMcpOwnerSchema = z.object({ uid: z.string().min(1).max(128) });
export const HostedMcpAccountLookupSchema = z.object({
  users: z
    .array(
      z.object({
        localId: z.string().min(1),
        createdAt: z.string().regex(/^[0-9]+$/),
      }),
    )
    .optional(),
});

export const HostedMcpDecisionSchema = z.object({ approved: z.boolean() }).strict();

export const HostedMcpConsentSchema = z
  .object({
    clientName: z.string().min(1).max(200),
    redirectOrigin: z.string().url(),
    expiresAt: z.number().int().positive(),
    scope: z.literal(HOSTED_MCP_SCOPE),
  })
  .strict();

export const HostedMcpDecisionResultSchema = z
  .object({ redirectUrl: HostedMcpRedirectUriSchema })
  .strict();

export const HostedMcpAuthorizationRecordSchema = z.object({
  clientId: z.string().min(1).max(200),
  redirectUri: HostedMcpRedirectUriSchema.refine((value) => value.length <= 2048),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  state: z.string().max(2048).optional(),
  resource: z.string().url(),
  expiresAt: z.number().int().positive(),
});

export const HostedMcpGrantRecordSchema = z.object({
  clientId: z.string().min(1),
  uid: z.string().min(1),
  authTime: z.number().int().positive(),
  userCreatedAt: z.string().min(1),
  resource: z.string().url(),
  expiresAt: z.number().int().positive(),
  revoked: z.boolean(),
});

export const HostedMcpCodeRecordSchema = HostedMcpAuthorizationRecordSchema.extend({
  uid: z.string().min(1),
  authTime: z.number().int().positive(),
  userCreatedAt: z.string().min(1),
});

export const HostedMcpTokenRecordSchema = z.object({
  familyId: z.string().uuid(),
  clientId: z.string().min(1),
  expiresAt: z.number().int().positive(),
  consumed: z.boolean(),
});

export const HostedMcpRateRecordSchema = z.object({
  count: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type HostedMcpAuthorizationRecord = z.infer<typeof HostedMcpAuthorizationRecordSchema>;
export type HostedMcpCodeRecord = z.infer<typeof HostedMcpCodeRecordSchema>;
export type HostedMcpGrantRecord = z.infer<typeof HostedMcpGrantRecordSchema>;
export type HostedMcpTokenRecord = z.infer<typeof HostedMcpTokenRecordSchema>;
