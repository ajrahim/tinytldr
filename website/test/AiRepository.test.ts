import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDER_BASE_URLS } from "@tinytldr/core";

const transport = vi.hoisted(() => ({
  fetch: vi.fn(),
}));
vi.mock("../src/lib/FirebaseClient.js", () => ({
  fetchFirebaseService: transport.fetch,
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_TINYTLDR_FIREBASE_AI_URL", "https://ai.example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("Firebase AI repository", () => {
  it("uses the Firebase authenticated transport and preserves the real abort signal", async () => {
    const connection = {
      id: "688b680f-7713-415c-8396-cbe636f1d41e",
      name: "My model",
      provider: "openai",
      base_url: AI_PROVIDER_BASE_URLS.openai,
      model: "test-model",
      model_name: "Test model",
      models: [{ id: "test-model", name: "Test model" }],
      key_suffix: "1234",
      is_default: true,
      updated_at: new Date().toISOString(),
    };
    transport.fetch.mockResolvedValue(Response.json({ connections: [connection] }));
    const { listAiConnections, AI_BACKEND_UNAVAILABLE_MESSAGE } =
      await import("../src/lib/AiRepository.js");
    const controller = new AbortController();
    expect(AI_BACKEND_UNAVAILABLE_MESSAGE).toBeNull();
    expect(await listAiConnections(controller.signal)).toEqual([connection]);
    expect(transport.fetch).toHaveBeenCalledWith(
      "https://ai.example.com",
      { action: "list" },
      "AI",
      controller.signal,
    );
  });
  it("reports missing Firebase deployment configuration without sending a request", async () => {
    vi.stubEnv("VITE_TINYTLDR_FIREBASE_AI_URL", "");
    const { listAiConnections } = await import("../src/lib/AiRepository.js");
    await expect(listAiConnections()).rejects.toThrow("not configured");
    expect(transport.fetch).not.toHaveBeenCalled();
  });
  it("surfaces server errors, invalid JSON, and malformed response contracts", async () => {
    const { listAiConnections } = await import("../src/lib/AiRepository.js");
    transport.fetch.mockResolvedValue(
      Response.json({ error: "Your session expired.", code: "auth" }, { status: 401 }),
    );
    await expect(listAiConnections()).rejects.toThrow("Your session expired.");
    transport.fetch.mockResolvedValue(new Response("not JSON", { status: 502 }));
    await expect(listAiConnections()).rejects.toThrow("invalid response (HTTP 502)");
    transport.fetch.mockResolvedValue(Response.json({ connections: [{ id: "invalid" }] }));
    await expect(listAiConnections()).rejects.toThrow("Nothing was applied");
  });
});
