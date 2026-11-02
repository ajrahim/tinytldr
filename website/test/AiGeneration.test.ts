import { describe, expect, it } from "vitest";
import {
  AiContextItemsSchema,
  AiGenerationInputSchema,
  AI_PROVIDER_BASE_URLS,
  mergeAiGeneration,
  projectFromDocument,
  type AiProvider,
  type AiGenerationInput,
  type AiConnection,
} from "@tinytldr/core";
import { createBlankDocument } from "../src/lib/WorkspaceTemplates.js";
import {
  createAiGateway,
  type AiGatewayServices,
  type AiConnectionStore,
} from "../server/AiGateway.js";
import { callAiProvider, providerBaseUrl, readAiJson } from "../server/AiProviders.js";

const id = "688b680f-7713-415c-8396-cbe636f1d41e";
const owner = "fixture-firebase-owner";
const secret = "private-provider-token-no-logging";
const image = {
  kind: "image",
  name: "reference.png",
  mimeType: "image/png",
  base64: "iVBORw0KGgo=",
} as const;
const makeRequest = (): AiGenerationInput => ({
  connectionId: id,
  prompt: "Create a clear design.",
  document: projectFromDocument(createBlankDocument()),
  targetPageIds: [],
  context: [image, { kind: "text", name: "Brief", text: "Reference text" }],
});
function providerResponse(provider: AiProvider, output: string) {
  if (provider === "anthropic")
    return { stop_reason: "end_turn", content: [{ type: "text", text: output }] };
  if (provider === "gemini")
    return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: output }] } }] };
  return { choices: [{ finish_reason: "stop", message: { content: output } }] };
}
describe("AI schemas and provider protocol", () => {
  it("rejects malformed, mislabeled and oversized context without throwing outside validation", () => {
    expect(AiGenerationInputSchema.safeParse(makeRequest()).success).toBe(true);
    expect(AiContextItemsSchema.safeParse([{ ...image, base64: "!!!!" }]).success).toBe(false);
    expect(AiContextItemsSchema.safeParse([{ ...image, mimeType: "image/jpeg" }]).success).toBe(
      false,
    );
    expect(AiContextItemsSchema.safeParse(Array.from({ length: 5 }, () => image)).success).toBe(
      false,
    );
    expect(
      AiContextItemsSchema.safeParse([{ kind: "text", name: "Long", text: "x".repeat(32_001) }])
        .success,
    ).toBe(false);
    const request = makeRequest();
    request.targetPageIds = ["missing"];
    expect(AiGenerationInputSchema.safeParse(request).success).toBe(false);
    request.targetPageIds = [request.document.pages[0]!.id, request.document.pages[0]!.id];
    expect(AiGenerationInputSchema.safeParse(request).success).toBe(false);
  });
  it("merges selected stable IDs without changing other pages or project-wide settings", () => {
    const original = makeRequest().document;
    original.pages.push({ ...original.pages[0]!, id: "another", title: "Same name" });
    const selected = { ...original, pages: [{ ...original.pages[0]!, description: "Updated" }] };
    const result = mergeAiGeneration(original, selected, [original.pages[0]!.id]);
    expect(result.pages[0]!.description).toBe("Updated");
    expect(result.pages[1]).toEqual(original.pages[1]);
    expect(() =>
      mergeAiGeneration(original, { ...selected, title: "Wrong" }, [original.pages[0]!.id]),
    ).toThrow(/outside/);
    expect(() => mergeAiGeneration(original, original, [original.pages[0]!.id])).toThrow(/outside/);
    expect(mergeAiGeneration(original, original, [])).toEqual(original);
  });
  it.each(["openai", "anthropic", "gemini", "custom"] as const)(
    "sends native %s text/image requests with bound credentials and no redirects",
    async (provider) => {
      const request = makeRequest();
      let sent: { url: string; init?: RequestInit } | undefined;
      const base =
        provider === "custom" ? "https://models.example.com/v1" : AI_PROVIDER_BASE_URLS[provider];
      const result = await callAiProvider({
        secret: { provider, base_url: base, model: "test-model", api_key: secret },
        allowedCustomUrls: ["https://models.example.com/v1"],
        request,
        signal: new AbortController().signal,
        fetch: async (url, init) => {
          sent = { url: String(url), init };
          return Response.json(providerResponse(provider, JSON.stringify(request.document)));
        },
      });
      expect(result).toEqual(request.document);
      expect(sent!.url).toMatch(
        provider === "anthropic"
          ? /\/messages$/
          : provider === "gemini"
            ? /:generateContent$/
            : /\/chat\/completions$/,
      );
      expect(sent!.init!.redirect).toBe("error");
      const headers = new Headers(sent!.init!.headers);
      expect(
        headers.get(
          provider === "anthropic"
            ? "x-api-key"
            : provider === "gemini"
              ? "x-goog-api-key"
              : "Authorization",
        ),
      ).toBe(provider === "openai" || provider === "custom" ? `Bearer ${secret}` : secret);
      expect(String(sent!.init!.body)).toContain(image.base64);
      expect(String(sent!.init!.body)).toContain("Reference text");
      expect(String(sent!.init!.body)).not.toContain(secret);
    },
  );
  it("rejects unapproved endpoints, credentials in URLs, native endpoint overrides and internal destinations", () => {
    for (const url of [
      "http://api.example.com/v1",
      "https://127.0.0.1/v1",
      "https://[::1]/v1",
      "https://metadata.internal/v1",
      "https://key@models.example.com/v1",
      "https://models.example.com/v1?q=key",
      "https://unapproved.example.com/v1",
    ])
      expect(() => providerBaseUrl("custom", url, ["https://models.example.com/v1"])).toThrow();
    expect(() =>
      providerBaseUrl("openai", "https://models.example.com/v1", ["https://models.example.com/v1"]),
    ).toThrow();
  });
  it("rejects truncated output, provider errors, invalid designs, excessive responses and aborts", async () => {
    const options = {
      secret: {
        provider: "openai" as const,
        base_url: AI_PROVIDER_BASE_URLS.openai,
        model: "test",
        api_key: secret,
      },
      allowedCustomUrls: [],
      request: makeRequest(),
      signal: new AbortController().signal,
    };
    await expect(
      callAiProvider({
        ...options,
        fetch: async () => Response.json({ error: { message: secret } }, { status: 401 }),
      }),
    ).rejects.toThrow("provider rejected the key");
    await expect(
      callAiProvider({
        ...options,
        fetch: async () =>
          Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }),
      }),
    ).rejects.toThrow("did not finish");
    await expect(
      callAiProvider({
        ...options,
        fetch: async () => Response.json(providerResponse("openai", "{}")),
      }),
    ).rejects.toThrow("validation");
    await expect(readAiJson(new Response("x".repeat(50)).body, 10)).rejects.toThrow("size limit");
    const controller = new AbortController();
    controller.abort();
    await expect(
      callAiProvider({
        ...options,
        signal: controller.signal,
        fetch: async () => {
          throw new Error(secret);
        },
      }),
    ).rejects.toThrow("cancelled");
  });
});

describe("Authenticated AI gateway", () => {
  const metadata: AiConnection = {
    id,
    name: "My model",
    provider: "openai",
    base_url: AI_PROVIDER_BASE_URLS.openai,
    model: "test-model",
    model_name: "Test model",
    models: [{ id: "test-model", name: "Test model" }],
    key_suffix: "ging",
    is_default: true,
    updated_at: new Date().toISOString(),
  };
  function fixture(
    overrides: Omit<Partial<AiGatewayServices>, "store"> & {
      store?: Partial<AiConnectionStore>;
    } = {},
  ) {
    const calls: string[] = [];
    const logs: string[] = [];
    const { store, ...gatewayOverrides } = overrides;
    const services: AiGatewayServices = {
      verifyUser: async (token) => (token === "verified" ? owner : null),
      store: {
        list: async (uid) => {
          expect(uid).toBe(owner);
          calls.push("list");
          return [metadata];
        },
        secret: async (uid) => {
          expect(uid).toBe(owner);
          calls.push("secret");
          return {
            provider: "openai",
            base_url: AI_PROVIDER_BASE_URLS.openai,
            model: "test-model",
            api_key: secret,
          };
        },
        takeRequest: async () => true,
        connect: async () => [metadata],
        credentials: async () => ({
          secret: {
            provider: "openai",
            base_url: AI_PROVIDER_BASE_URLS.openai,
            api_key: secret,
          },
          revision: "fixture-revision",
        }),
        updateModels: async () => [metadata],
        selectModel: async () => [metadata],
        delete: async () => [],
        ...store,
      },
      fetch: async () =>
        Response.json(providerResponse("openai", JSON.stringify(makeRequest().document))),
      allowedOrigins: ["https://app.example.com"],
      customBaseUrls: [],
      reportError: (code) => logs.push(code),
      ...gatewayOverrides,
    };
    const handler = createAiGateway(services);
    const send = (body: unknown, token = "verified", origin = "https://app.example.com") =>
      handler(
        new Request("https://server.example.com/ai", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, Origin: origin },
          body: JSON.stringify(body),
        }),
      );
    return { send, calls, logs };
  }
  it("checks account and origin before any secret lookup", async () => {
    const test = fixture();
    expect(
      (await test.send({ action: "generate", request: makeRequest() }, "unverified")).status,
    ).toBe(401);
    expect(
      (await test.send({ action: "list" }, "verified", "https://evil.example.com")).status,
    ).toBe(403);
    expect(test.calls).toEqual([]);
  });
  it("returns only owner metadata and a validated unsaved design, never credentials", async () => {
    const test = fixture();
    const list = await test.send({ action: "list" });
    expect(list.headers.get("Cache-Control")).toBe("no-store");
    expect(await list.json()).toEqual({ connections: [metadata] });
    const generated = await test.send({ action: "generate", request: makeRequest() });
    expect(generated.status).toBe(200);
    expect(await generated.json()).toEqual({ document: makeRequest().document });
    expect(JSON.stringify(test.logs)).not.toContain(secret);
  });
  it("refuses other owners, rate-limited requests, and out-of-scope generated pages", async () => {
    const missing = fixture({ store: { secret: async () => null } });
    expect((await missing.send({ action: "generate", request: makeRequest() })).status).toBe(404);
    const limited = fixture({
      store: { takeRequest: async () => false },
    });
    expect((await limited.send({ action: "generate", request: makeRequest() })).status).toBe(429);
    const test = fixture();
    const request = makeRequest();
    request.document.pages.push({ ...request.document.pages[0]!, id: "other" });
    request.targetPageIds = ["other"];
    expect((await test.send({ action: "generate", request })).status).toBe(502);
  });
  it("sanitizes backend failures and upstream errors without echoing keys or error payloads", async () => {
    const test = fixture({
      store: {
        list: async () => {
          throw new Error(secret);
        },
      },
    });
    const response = await test.send({ action: "list" });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(secret);
    expect(test.logs).toEqual(["storage"]);
    const upstream = fixture({
      fetch: async () => Response.json({ message: secret }, { status: 429 }),
    });
    const failed = await upstream.send({ action: "generate", request: makeRequest() });
    expect(failed.status).toBe(429);
    expect(await failed.text()).not.toContain(secret);
  });
});
