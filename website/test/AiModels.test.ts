import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_BASE_URLS,
  AiGatewayRequestSchema,
  AiProviderConnectionInputSchema,
  type AiProvider,
} from "@tinytldr/core";
import { listProviderModels } from "../server/AiModels.js";

const key = "fixture-key-never-for-network";
function options(provider: AiProvider = "openai") {
  return {
    secret: {
      provider,
      base_url:
        provider === "custom" ? "https://models.example.com/v1" : AI_PROVIDER_BASE_URLS[provider],
      api_key: key,
    },
    allowedCustomUrls: ["https://models.example.com/v1"],
    signal: new AbortController().signal,
  };
}

describe("Provider API model discovery", () => {
  it("accepts provider/key setup, rejects manual names/models and removed multi-connection actions", () => {
    const connection = { provider: "openai", baseUrl: AI_PROVIDER_BASE_URLS.openai, apiKey: key };
    expect(AiGatewayRequestSchema.safeParse({ action: "connect", connection }).success).toBe(true);
    expect(
      AiGatewayRequestSchema.safeParse({
        action: "connect",
        connection: { ...connection, name: "Name" },
      }).success,
    ).toBe(false);
    expect(
      AiGatewayRequestSchema.safeParse({
        action: "connect",
        connection: { ...connection, model: "Manual" },
      }).success,
    ).toBe(false);
    expect(AiProviderConnectionInputSchema.safeParse(connection).success).toBe(true);
    for (const action of ["save", "default", "keep"])
      expect(AiGatewayRequestSchema.safeParse({ action, connection }).success).toBe(false);
  });

  it.each(["openai", "anthropic", "gemini", "custom"] as const)(
    "uses authenticated GET for %s with provider-returned identities and no redirects",
    async (provider) => {
      const result = await listProviderModels({
        ...options(provider),
        fetch: async (url, init) => {
          expect(String(url)).toContain("/models");
          expect(String(url)).not.toContain(key);
          expect(init!.method).toBe("GET");
          expect(init!.body).toBeUndefined();
          expect(init!.redirect).toBe("error");
          const headers = new Headers(init!.headers);
          expect(
            headers.get(
              provider === "anthropic"
                ? "x-api-key"
                : provider === "gemini"
                  ? "x-goog-api-key"
                  : "Authorization",
            ),
          ).toBe(provider === "anthropic" || provider === "gemini" ? key : `Bearer ${key}`);
          if (provider === "anthropic") {
            expect(headers.get("anthropic-version")).toBe("2023-06-01");
            return Response.json({
              data: [{ id: "claude-test", display_name: "API Claude" }],
              has_more: false,
              last_id: "claude-test",
            });
          }
          if (provider === "gemini")
            return Response.json({
              models: [
                {
                  name: "models/gemini-test",
                  displayName: "API Gemini",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            });
          return Response.json({ data: [{ id: "gpt-from-api" }] });
        },
      });
      expect(result).toEqual([
        {
          id:
            provider === "anthropic"
              ? "claude-test"
              : provider === "gemini"
                ? "gemini-test"
                : "gpt-from-api",
          name:
            provider === "anthropic"
              ? "API Claude"
              : provider === "gemini"
                ? "API Gemini"
                : "gpt-from-api",
        },
      ]);
    },
  );

  it("excludes known non-chat and retired OpenAI models instead of pretending every ID is compatible", async () => {
    const result = await listProviderModels({
      ...options(),
      fetch: async () =>
        Response.json({
          data: [
            ...[
              "gpt-4o",
              "gpt-5.2",
              "o3",
              "o4-mini",
              "text-embedding-3-small",
              "whisper-1",
              "gpt-4o-audio-preview",
              "gpt-realtime",
              "gpt-5-codex",
              "gpt-5.2-pro",
              "o3-deep-research",
            ].map((id) => ({ id })),
            { id: "gpt-retired", shutdown_date: "2000-01-01" },
          ],
        }),
    });
    expect(result.map((model) => model.id)).toEqual(["gpt-4o", "gpt-5.2", "o3", "o4-mini"]);
  });

  it.each(["anthropic", "gemini"] as const)(
    "follows bounded native %s pagination and filters incompatible Gemini models",
    async (provider) => {
      let calls = 0;
      const result = await listProviderModels({
        ...options(provider),
        fetch: async (url) => {
          calls++;
          const query = new URL(String(url)).searchParams;
          if (provider === "anthropic") {
            expect(query.get("after_id")).toBe(calls === 1 ? null : "claude-one");
            return Response.json({
              data: [
                { id: calls === 1 ? "claude-one" : "claude-two", display_name: `API ${calls}` },
              ],
              has_more: calls === 1,
              last_id: calls === 1 ? "claude-one" : "claude-two",
            });
          }
          expect(query.get("pageToken")).toBe(calls === 1 ? null : "next-token");
          return Response.json({
            models:
              calls === 1
                ? [
                    {
                      name: "models/gemini-one",
                      displayName: "API 1",
                      supportedGenerationMethods: ["generateContent"],
                    },
                    { name: "models/text-embedding", supportedGenerationMethods: ["embedContent"] },
                    {
                      name: "models/gemini-image",
                      supportedGenerationMethods: ["generateContent"],
                    },
                  ]
                : [
                    {
                      name: "models/gemini-two",
                      displayName: "API 2",
                      supportedGenerationMethods: ["generateContent"],
                    },
                  ],
            ...(calls === 1 ? { nextPageToken: "next-token" } : {}),
          });
        },
      });
      expect(calls).toBe(2);
      expect(result.map((model) => model.name)).toEqual(["API 1", "API 2"]);
    },
  );

  it.each([
    { data: [] },
    { data: [{ id: "embedding-only" }] },
    { data: [{ id: "gpt-invalid key" }] },
    { not_models: [] },
    { data: Array.from({ length: 501 }, (_, index) => ({ id: `gpt-${index}` })) },
  ])("surfaces empty, malformed, incompatible or oversized catalogs", async (payload) => {
    await expect(
      listProviderModels({ ...options(), fetch: async () => Response.json(payload) }),
    ).rejects.toMatchObject({ status: 502, code: "models" });
  });

  it("rejects repeated cursors and catalogs exceeding ten pages", async () => {
    await expect(
      listProviderModels({
        ...options("anthropic"),
        fetch: async () => Response.json({ data: [], has_more: true, last_id: "repeated" }),
      }),
    ).rejects.toThrow("repeated");
    let calls = 0;
    await expect(
      listProviderModels({
        ...options("gemini"),
        fetch: async () => {
          calls++;
          return Response.json({ models: [], nextPageToken: `page-${calls}` });
        },
      }),
    ).rejects.toThrow("page limit");
    expect(calls).toBe(10);
  });

  it("handles invalid JSON, provider rejection, quota, network failure, cancellation and unapproved endpoints without leaking keys", async () => {
    await expect(
      listProviderModels({ ...options(), fetch: async () => new Response("invalid") }),
    ).rejects.toMatchObject({ status: 502, code: "models" });
    for (const status of [401, 403, 429]) {
      try {
        await listProviderModels({
          ...options(),
          fetch: async () => Response.json({ error: key }, { status }),
        });
        expect.fail("Expected provider rejection.");
      } catch (error) {
        expect(error).toMatchObject({ status: status === 429 ? 429 : 502, code: "provider" });
        expect(String(error)).not.toContain(key);
      }
    }
    await expect(
      listProviderModels({
        ...options(),
        fetch: async () => {
          throw new Error(key);
        },
      }),
    ).rejects.toMatchObject({ code: "provider_network" });
    await expect(
      listProviderModels({
        ...options(),
        signal: AbortSignal.abort(),
        fetch: async () => {
          expect.fail("No call after abort.");
        },
      }),
    ).rejects.toMatchObject({ status: 408 });
    await expect(
      listProviderModels({
        ...options("custom"),
        allowedCustomUrls: [],
        fetch: async () => {
          expect.fail("No call to unapproved URL.");
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
