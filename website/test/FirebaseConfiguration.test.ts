import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SavedWorkspaceDesignSchema, projectFromDocument } from "@tinytldr/core";
import { createBlankDocument } from "../src/lib/WorkspaceTemplates.js";

const mocks = vi.hoisted(() => ({
  auth: {
    authStateReady: vi.fn().mockResolvedValue(undefined),
    currentUser: null as { uid: string; getIdToken: () => Promise<string> } | null,
  },
  initializeApp: vi.fn((options) => ({ options })),
}));
vi.mock("firebase/app", () => ({ getApps: () => [], initializeApp: mocks.initializeApp }));
vi.mock("firebase/auth", () => ({
  getAuth: () => mocks.auth,
  connectAuthEmulator: vi.fn(),
}));

beforeEach(() => {
  mocks.auth.currentUser = null;
  vi.stubGlobal("window", { location: { origin: "https://site.example.com" } });
  vi.stubEnv("VITE_TINYTLDR_FIREBASE_API_KEY", "test-public-web-key");
  vi.stubEnv("VITE_TINYTLDR_FIREBASE_PROJECT_ID", "demo-tinytldr");
  vi.stubEnv("VITE_TINYTLDR_FIREBASE_AUTH_DOMAIN", "demo-tinytldr.firebaseapp.com");
  vi.stubEnv("VITE_TINYTLDR_FIREBASE_APP_ID", "test-web-app");
  vi.stubEnv("VITE_TINYTLDR_FIREBASE_DESIGNS_URL", "https://designs.example.com");
  vi.stubEnv("VITE_TINYTLDR_FIREBASE_AUTH_EMULATOR_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("Firebase-only website configuration", () => {
  it("initializes the sole account client from explicit Firebase configuration", async () => {
    const backend = await import("../src/lib/FirebaseClient.js");
    expect(backend.firebaseAuth).toBe(mocks.auth);
    expect(mocks.initializeApp).toHaveBeenCalledOnce();
  });

  it.each(["", "not-a-domain/with-path"])(
    "surfaces invalid Firebase configuration (%s)",
    async (domain) => {
      vi.stubEnv("VITE_TINYTLDR_FIREBASE_AUTH_DOMAIN", domain);
      const backend = await import("../src/lib/FirebaseClient.js");
      expect(backend.firebaseAuth).toBeNull();
      expect(backend.requireFirebaseAuth).toThrow(/not configured/);
    },
  );

  it("never enables Analytics and waits for restored authentication before a design request", async () => {
    const saved = {
      id: "bb416ad9-fd5b-459c-9891-07822fe8ac60",
      owner_id: "firebaseAccountUid",
      document: projectFromDocument(createBlankDocument()),
      revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: saved })));
    vi.stubGlobal("fetch", fetch);
    const backend = await import("../src/lib/FirebaseClient.js");
    expect(
      await backend.callFirebaseDesign({ action: "get", id: saved.id }, SavedWorkspaceDesignSchema),
    ).toEqual(saved);
    expect(mocks.auth.authStateReady).toHaveBeenCalledOnce();
    expect(mocks.initializeApp.mock.calls[0]?.[0]).not.toHaveProperty("measurementId");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it.each([
    [403, { error: "This action is private to the design editor." }, /private/],
    [200, { data: {} }, /invalid data/],
    [200, {}, /invalid response envelope/],
  ])("surfaces rejected or malformed service responses", async (status, payload, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status })),
    );
    const backend = await import("../src/lib/FirebaseClient.js");
    await expect(
      backend.callFirebaseDesign(
        { action: "get", id: "bb416ad9-fd5b-459c-9891-07822fe8ac60" },
        SavedWorkspaceDesignSchema,
      ),
    ).rejects.toThrow(message);
  });

  it("requires sign-in for hosted exports before fetching and sends the current Firebase bearer when signed in", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetch);
    const backend = await import("../src/lib/FirebaseClient.js");
    const request = { document: projectFromDocument(createBlankDocument()), format: "png" };
    await expect(
      backend.fetchFirebaseService(
        "https://exports.example.com/v1/render",
        request,
        "export",
        undefined,
        { requireSignIn: true },
      ),
    ).rejects.toThrow("Sign in before exporting");
    expect(fetch).not.toHaveBeenCalled();
    mocks.auth.currentUser = {
      uid: "current-owner",
      getIdToken: async () => "firebase-owner-token",
    };
    await backend.fetchFirebaseService(
      "https://exports.example.com/v1/render",
      request,
      "export",
      undefined,
      { requireSignIn: true },
    );
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://exports.example.com/v1/render"),
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer firebase-owner-token",
        },
      }),
    );
  });

  it("resolves Hosting rewrite paths against the website origin", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetch);
    const backend = await import("../src/lib/FirebaseClient.js");
    await backend.fetchFirebaseService("/api/designs", { action: "list" }, "design");
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://site.example.com/api/designs"),
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
  });

  it.each([null, "another-account"])(
    "refuses cloud creation for an expected owner when the current account is %s",
    async (uid) => {
      mocks.auth.currentUser = uid ? { uid, getIdToken: async () => "another-owner-token" } : null;
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const backend = await import("../src/lib/FirebaseClient.js");
      await expect(
        backend.callFirebaseDesign(
          {
            action: "save",
            id: "bb416ad9-fd5b-459c-9891-07822fe8ac60",
            editKey: "ab".repeat(32),
            document: projectFromDocument(createBlankDocument()),
          },
          SavedWorkspaceDesignSchema,
          "expected-owner",
        ),
      ).rejects.toThrow("Your account changed");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("refuses a cloud creation if the account changes while reading its ID token", async () => {
    mocks.auth.currentUser = {
      uid: "expected-owner",
      getIdToken: async () => {
        mocks.auth.currentUser = {
          uid: "another-account",
          getIdToken: async () => "another-token",
        };
        return "old-owner-token";
      },
    };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const backend = await import("../src/lib/FirebaseClient.js");
    await expect(
      backend.fetchFirebaseService("/api/designs", { action: "list" }, "design", undefined, {
        expectedUserId: "expected-owner",
      }),
    ).rejects.toThrow("Your account changed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "https://foreign.example.com/v1/assets/private.png",
    "http://exports.example.com/v1/assets/private.png",
    "https://exports.example.com/not-an-artifact/private.png",
    "https://user:password@exports.example.com/v1/assets/private.png",
  ])(
    "rejects untrusted private artifact URLs before reading a token or fetching: %s",
    async (url) => {
      const fetch = vi.fn();
      const getIdToken = vi.fn().mockResolvedValue("private-firebase-token");
      mocks.auth.currentUser = { uid: "owner", getIdToken };
      vi.stubGlobal("fetch", fetch);
      const backend = await import("../src/lib/FirebaseClient.js");
      await expect(
        backend.fetchFirebaseArtifact(
          url,
          "https://exports.example.com",
          new AbortController().signal,
        ),
      ).rejects.toThrow("invalid private artifact URL");
      expect(getIdToken).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("authenticates same-origin private artifact GETs and refuses redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("fixture"));
    mocks.auth.currentUser = { uid: "owner", getIdToken: async () => "firebase-owner-token" };
    vi.stubGlobal("fetch", fetch);
    const backend = await import("../src/lib/FirebaseClient.js");
    const controller = new AbortController();
    await backend.fetchFirebaseArtifact(
      "https://exports.example.com/v1/assets/private.png",
      "https://exports.example.com",
      controller.signal,
    );
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://exports.example.com/v1/assets/private.png"),
      {
        headers: { Authorization: "Bearer firebase-owner-token" },
        signal: controller.signal,
        redirect: "error",
      },
    );
  });
});
