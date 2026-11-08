import { describe, expect, it } from "vitest";
import {
  AiContextItemsSchema,
  AiGenerationInputSchema,
  AI_PROVIDER_BASE_URLS,
  mergeAiGeneration,
  AI_DEFAULT_OUTPUT_TOKENS,
  SIZE_PRESET_IDS,
  projectFromDocument,
  type AiProvider,
  type AiGenerationInput,
  type AiConnection,
  WorkspaceProjectSchema,
} from "@tinytldr/core";
import { z } from "zod";
import { createBlankDocument } from "../src/lib/WorkspaceTemplates.js";
import {
  createAiGateway,
  type AiGatewayServices,
  type AiConnectionStore,
} from "../server/AiGateway.js";
import { callAiProvider, providerBaseUrl, readAiJson } from "../server/AiProviders.js";
import { AiImageAssets } from "../server/AiImageAssets.js";

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
function providerPacket(provider: AiProvider, init?: RequestInit) {
  const body: {
    messages?: { content: string | { text?: string }[] }[];
    contents?: { parts: { text?: string }[] }[];
  } = JSON.parse(String(init?.body));
  const content = provider === "gemini" ? body.contents![0]!.parts : body.messages!.at(-1)!.content;
  const text = typeof content === "string" ? content : content[0]!.text!;
  return z
    .object({
      currentProject: WorkspaceProjectSchema,
      imageAssets: z.array(z.object({ name: z.string(), source: z.string() })),
    })
    .parse(JSON.parse(text));
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
  it("adds requested pages and applies a requested size", () => {
    const original = makeRequest().document;
    original.pages.push({ ...original.pages[0]!, id: "another", title: "Same name" });
    const first = original.pages[0]!;
    const resized = { width: 1200, height: 800 };
    const fiveUp = {
      ...original,
      size: resized,
      pages: Array.from({ length: 5 }, (_, index) => ({
        ...first,
        id: `page-${index + 1}`,
        title: `Feature ${index + 1}`,
      })),
    };
    const all = mergeAiGeneration(original, fiveUp, []);
    expect(all.pages.map((page) => page.title)).toEqual(fiveUp.pages.map((page) => page.title));
    expect(all.size).toEqual(resized);
    const targeted = mergeAiGeneration(
      original,
      {
        ...original,
        size: resized,
        pages: [
          { ...first, description: "Updated" },
          { ...first, id: "added", title: "Added" },
        ],
      },
      [first.id],
    );
    expect(targeted.pages.map((page) => page.id)).toEqual([first.id, "added", "another"]);
    expect(targeted.size).toEqual(resized);
    expect(targeted.pages[2]).toEqual(original.pages[1]);
    const unsupported = SIZE_PRESET_IDS.find(
      (size) => !first.template.manifest.supportedSizes.includes(size),
    );
    if (unsupported)
      expect(() =>
        mergeAiGeneration(
          original,
          {
            ...original,
            size: unsupported,
            pages: [
              {
                ...first,
                template: {
                  ...first.template,
                  manifest: {
                    ...first.template.manifest,
                    supportedSizes: [...first.template.manifest.supportedSizes, unsupported],
                  },
                },
              },
            ],
          },
          [first.id],
        ),
      ).toThrow(/Choose All artboards/);
    const crowded = {
      ...original,
      pages: [
        first,
        ...Array.from({ length: 19 }, (_, index) => ({ ...first, id: `extra-${index}` })),
      ],
    };
    expect(() => mergeAiGeneration(original, crowded, [first.id])).toThrow(/limited to 20/);
  });
  it.each(["openai", "anthropic", "gemini", "custom"] as const)(
    "explains truncated %s output and requests a large output budget",
    async (provider) => {
      const request = makeRequest();
      let body = "";
      const truncated =
        provider === "anthropic"
          ? { stop_reason: "max_tokens", content: [] }
          : provider === "gemini"
            ? { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }
            : { choices: [{ finish_reason: "length", message: { content: "{" } }] };
      await expect(
        callAiProvider({
          secret: {
            provider,
            base_url:
              provider === "custom"
                ? "https://models.example.com/v1"
                : AI_PROVIDER_BASE_URLS[provider],
            model: "test",
            api_key: secret,
          },
          allowedCustomUrls: ["https://models.example.com/v1"],
          request,
          signal: new AbortController().signal,
          fetch: async (_url, init) => {
            body = String(init?.body);
            return Response.json(truncated);
          },
        }),
      ).rejects.toThrow(/output token limit/);
      expect(body).toContain(String(AI_DEFAULT_OUTPUT_TOKENS));
      expect(body).toContain("return exactly N pages");
      expect(body).toContain('{\\"width\\":W,\\"height\\":H}');
    },
  );
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
  it.each(["openai", "anthropic", "gemini", "custom"] as const)(
    "places exact attached bytes with %s and preserves them on subsequent edits without asking for base64",
    async (provider) => {
      const request = makeRequest();
      const source = `data:${image.mimeType};base64,${image.base64}`;
      const references: string[] = [];
      const options = {
        secret: {
          provider,
          base_url:
            provider === "custom"
              ? "https://models.example.com/v1"
              : AI_PROVIDER_BASE_URLS[provider],
          model: "test",
          api_key: secret,
        },
        allowedCustomUrls: ["https://models.example.com/v1"],
        signal: new AbortController().signal,
        fetch: async (_url: URL | RequestInfo, init?: RequestInit) => {
          const packet = providerPacket(provider, init);
          expect(packet.imageAssets).toHaveLength(1);
          expect(JSON.stringify(packet.currentProject)).not.toContain(image.base64);
          const reference = packet.imageAssets[0]!.source;
          references.push(reference);
          expect(reference).toMatch(/^tinytldr-image:[a-f0-9]{64}$/);
          const board = packet.currentProject.pages[0]!;
          board.data.logo = reference;
          board.template.manifest.slots.logo = {
            type: "image",
            label: "Logo",
            description: "The original uploaded logo",
            required: true,
          };
          board.template.manifest.sampleData = board.data;
          board.template.liquidTemplate = '<img alt="Exact logo" src="{{ logo }}">';
          return Response.json(providerResponse(provider, JSON.stringify(packet.currentProject)));
        },
      };
      const placed = await callAiProvider({ ...options, request });
      expect(placed!.pages[0]!.data.logo).toBe(source);
      expect(placed!.pages[0]!.template.manifest.sampleData.logo).toBe(source);
      expect(JSON.stringify(placed)).not.toContain("tinytldr-image:");
      const edited = await callAiProvider({
        ...options,
        request: { ...request, document: placed!, context: [] },
      });
      expect(edited).toEqual(placed);
      expect(references[0]).toBe(references[1]);
    },
  );
  it("rejects invented, unknown and malformed image references without leaking bytes", async () => {
    const request = makeRequest();
    const reference = new AiImageAssets(request.context).references[0]!.source;
    for (const source of [
      "tinytldr-image:missing",
      "tinytldr-image:",
      "TINYTLDR-IMAGE:",
      `${reference}?width=100`,
      `${reference}#fragment`,
      `${reference}/invented.png`,
      "data:image/png;base64,iVBORw0KGgpJTlZFTlRFRA==",
    ]) {
      const generated = structuredClone(request.document);
      generated.pages[0]!.data.logo = source;
      await expect(
        callAiProvider({
          secret: {
            provider: "openai",
            base_url: AI_PROVIDER_BASE_URLS.openai,
            model: "test",
            api_key: secret,
          },
          allowedCustomUrls: [],
          signal: new AbortController().signal,
          request,
          fetch: async () => Response.json(providerResponse("openai", JSON.stringify(generated))),
        }),
      ).rejects.toMatchObject({
        status: 502,
        code: "image_assets",
        message: expect.not.stringContaining(source),
      });
    }
  });
  it("enforces exact restored document and UTF-8 save thresholds rather than silently dropping images", () => {
    const request = makeRequest();
    const assets = new AiImageAssets(request.context);
    const document = assets.redact(request.document);
    document.pages[0]!.data.logo = assets.references[0]!.source;
    const restored = assets.resolve(document);
    restored.pages[0]!.data.padding = "";
    const paddingLength = 400_000 - JSON.stringify(restored).length;
    document.pages[0]!.data.padding = "x".repeat(paddingLength);
    expect(JSON.stringify(assets.resolve(document))).toHaveLength(400_000);
    document.pages[0]!.data.padding += "x";
    expect(() => assets.resolve(document)).toThrow(/size limits/);
    document.pages[0]!.data.padding = "\u4e00".repeat(165_000);
    const utf8Boundary = assets.resolve(document);
    const remaining = 500_000 - Buffer.byteLength(JSON.stringify(utf8Boundary), "utf8");
    document.pages[0]!.data.padding += "x".repeat(remaining);
    expect(Buffer.byteLength(JSON.stringify(assets.resolve(document)), "utf8")).toBe(500_000);
    document.pages[0]!.data.padding += "x";
    expect(() => assets.resolve(document)).toThrow(/500 KB/);
  });
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
    ).rejects.toThrow("output token limit");
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
        setOutputTokens: async (_owner, _id, tokens) => {
          calls.push(`tokens:${tokens}`);
          return [{ ...metadata, ...(tokens ? { max_output_tokens: tokens } : {}) }];
        },
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
  it("saves a validated output token limit and applies it to provider requests", async () => {
    const test = fixture();
    const saved = await test.send({ action: "tokens", id, maxOutputTokens: 96_000 });
    expect(saved.status).toBe(200);
    expect((await saved.json()).connections[0].max_output_tokens).toBe(96_000);
    expect((await test.send({ action: "tokens", id, maxOutputTokens: null })).status).toBe(200);
    for (const invalid of [999, 128_001, 1.5, "32000"])
      expect((await test.send({ action: "tokens", id, maxOutputTokens: invalid })).status).toBe(
        400,
      );
    expect(test.calls.filter((call) => call.startsWith("tokens:"))).toEqual([
      "tokens:96000",
      "tokens:null",
    ]);
    let body = "";
    await callAiProvider({
      secret: {
        provider: "anthropic",
        base_url: AI_PROVIDER_BASE_URLS.anthropic,
        model: "test",
        api_key: secret,
        max_output_tokens: 96_000,
      },
      allowedCustomUrls: [],
      request: makeRequest(),
      signal: new AbortController().signal,
      fetch: async (_url, init) => {
        body = String(init?.body);
        return Response.json(providerResponse("anthropic", JSON.stringify(makeRequest().document)));
      },
    });
    expect(JSON.parse(body).max_tokens).toBe(96_000);
  });
  it("streams whitespace heartbeats for slow generations and ends with the final JSON", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const test = fixture({
      heartbeatMs: 5,
      fetch: async () => {
        await gate;
        return Response.json(providerResponse("openai", JSON.stringify(makeRequest().document)));
      },
    });
    const response = await test.send({ action: "generate", request: makeRequest() });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(" ");
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    let text = " ";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text.startsWith("  ")).toBe(true);
    expect(JSON.parse(text).document.pages).toHaveLength(makeRequest().document.pages.length);
  });
  it("reports slow generation failures as a JSON error after the heartbeat starts", async () => {
    const test = fixture({
      heartbeatMs: 5,
      fetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json(providerResponse("openai", "not json"));
      },
    });
    const response = await test.send({ action: "generate", request: makeRequest() });
    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text());
    expect(payload).toEqual({ error: expect.any(String), code: expect.any(String) });
  });
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
  it.each([
    ["400 KB", "x".repeat(210_000)],
    ["500 KB", "\u4e00".repeat(90_000)],
  ])(
    "reports the merged %s size limit for targeted edits, not a misleading scope error",
    async (limit, padding) => {
      const request = makeRequest();
      request.document.pages[0]!.data.padding = padding;
      const target = structuredClone(makeRequest().document.pages[0]!);
      target.id = "target";
      request.document.pages.push(target);
      request.targetPageIds = [target.id];
      const generated = { ...request.document, pages: [structuredClone(target)] };
      generated.pages[0]!.data.padding = padding;
      const test = fixture({
        fetch: async () => Response.json(providerResponse("openai", JSON.stringify(generated))),
      });
      const response = await test.send({ action: "generate", request });
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        code: "size",
        error: expect.stringContaining(limit),
      });
      expect(test.logs).toEqual(["size"]);
    },
  );
});
