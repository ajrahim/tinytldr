import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createFirebaseHttpHandler } from "../src/FirebaseHttp.js";

interface TestRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
}

class TestResponse extends EventEmitter {
  statusCode = 0;
  headers = new Map<string, string>();
  body = "";
  bytes = Buffer.alloc(0);
  writableEnded = false;

  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
  send(value: string | Buffer) {
    this.bytes = Buffer.from(value);
    this.body = this.bytes.toString("utf8");
    this.writableEnded = true;
    return this;
  }
  chunks: string[] = [];
  flushed = false;
  flushHeaders() {
    this.flushed = true;
  }
  write(chunk: Uint8Array) {
    this.chunks.push(Buffer.from(chunk).toString("utf8"));
    return true;
  }
  end() {
    this.body = this.chunks.join("");
    this.writableEnded = true;
  }
}

type Handler = (request: TestRequest, response: TestResponse) => Promise<void>;
const registration = vi.hoisted(() => ({
  onRequest: vi.fn<(options: unknown, handler: Handler) => Handler>((_options, handler) => handler),
  onDelete: vi.fn<
    (handler: (user: { uid: string }) => Promise<void>) => (user: { uid: string }) => Promise<void>
  >((handler) => handler),
}));
const storage = vi.hoisted(() => {
  const write = vi.fn(async () => {});
  const doc = vi.fn(() => ({ set: write }));
  const collection = vi.fn(() => ({ doc }));
  return { write, doc, collection };
});
const mediaStorage = vi.hoisted(() => ({ bucket: vi.fn(() => ({})) }));
vi.mock("firebase-functions/v2/https", () => ({ onRequest: registration.onRequest }));
vi.mock("firebase-functions/v1", () => ({
  region: () => ({
    runWith: () => ({ auth: { user: () => ({ onDelete: registration.onDelete }) } }),
  }),
}));
vi.mock("firebase-functions", () => ({ logger: { error: vi.fn() } }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn() }));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: storage.collection }),
}));
vi.mock("firebase-admin/storage", () => ({ getStorage: () => mediaStorage }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv("TINYTLDR_ALLOWED_ORIGINS", "http://localhost:5173");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Deployed Firebase HTTP adapter", () => {
  async function httpHandler(name: "designs" | "ai" | "media") {
    const entry = await import("../src/index.js");
    const handler = registration.onRequest.mock.calls.find(([, candidate]) =>
      Object.is(candidate, entry[name]),
    )?.[1];
    if (!handler) throw new Error(`Missing registered ${name} function.`);
    return handler;
  }
  async function dispatch(request: TestRequest, name: "designs" | "ai" | "media" = "designs") {
    const handler = await httpHandler(name);
    const response = new TestResponse();
    await handler(Object.assign(new EventEmitter(), request), response);
    return response;
  }

  it("accepts a browser preflight without rawBody and emits the configured CORS headers", async () => {
    const response = await dispatch({
      method: "OPTIONS",
      path: "/",
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, Authorization",
    );
  });

  it("still rejects an unapproved preflight origin without rawBody", async () => {
    const response = await dispatch({
      method: "OPTIONS",
      path: "/",
      headers: { origin: "https://unapproved.example" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("reports an empty POST as invalid JSON instead of throwing before the gateway", async () => {
    const response = await dispatch({
      method: "POST",
      path: "/",
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Send a valid JSON design request." });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("preserves authentication rejection and CORS headers on a real POST body", async () => {
    const response = await dispatch({
      method: "POST",
      path: "/",
      headers: { origin: "http://localhost:5173" },
      rawBody: Buffer.from(JSON.stringify({ action: "list" })),
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it.each(["ai", "media"] as const)(
    "serves the %s adapter preflight and rejects unsigned requests before storage",
    async (name) => {
      const preflight = await dispatch(
        { method: "OPTIONS", path: "/", headers: { origin: "http://localhost:5173" } },
        name,
      );
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      const response = await dispatch(
        {
          method: "POST",
          path: "/",
          headers: { origin: "http://localhost:5173" },
          rawBody: Buffer.from('{"action":"list"}'),
        },
        name,
      );
      expect(response.statusCode).toBe(401);
      if (name === "ai") expect(JSON.parse(response.body).code).toBe("auth");
      else expect(JSON.parse(response.body).error).toBe("Sign in to use My Library.");
      expect(mediaStorage.bucket).not.toHaveBeenCalled();
    },
  );

  it("binds Auth deletion cleanup to only the deleted account and remains idempotent", async () => {
    const entry = await import("../src/index.js");
    const handler = registration.onDelete.mock.calls.find(([candidate]) =>
      Object.is(candidate, entry.deleteAiAccount),
    )?.[0];
    if (!handler) throw new Error("Missing registered AI deletion trigger.");
    await handler({ uid: "deleted-account" });
    await handler({ uid: "deleted-account" });
    expect(storage.collection).toHaveBeenCalledWith("aiAccounts");
    expect(storage.doc).toHaveBeenCalledWith(Buffer.from("deleted-account").toString("base64url"));
    expect(storage.write).toHaveBeenCalledTimes(2);
    expect(storage.write).toHaveBeenCalledWith({ connections: [], limits: {}, deleted: true });
  });

  it("binds media cleanup to the deleted account without invoking AI cleanup", async () => {
    vi.stubEnv("TINYTLDR_FIREBASE_STORAGE_BUCKET", "demo-tinytldr.firebasestorage.app");
    const { MediaService } = await import("../src/MediaService.js");
    const cleanup = vi.spyOn(MediaService.prototype, "deleteAccount").mockResolvedValue();
    const entry = await import("../src/index.js");
    const handler = registration.onDelete.mock.calls.find(([candidate]) =>
      Object.is(candidate, entry.deleteMediaAccount),
    )?.[0];
    if (!handler) throw new Error("Missing registered media deletion trigger.");
    await handler({ uid: "deleted-media-account" });
    await handler({ uid: "deleted-media-account" });
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledWith("deleted-media-account");
    expect(mediaStorage.bucket).toHaveBeenCalledWith("demo-tinytldr.firebasestorage.app");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("preserves exact binary bytes in the production Firebase HTTP adapter", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0x80, 0xc3, 0x28]);
    const response = new TestResponse();
    const request = Object.assign(new EventEmitter(), {
      method: "POST",
      path: "/",
      headers: {},
      rawBody: Buffer.from("{}"),
    });
    await createFirebaseHttpHandler(
      async () => new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png" } }),
    )(request, response);
    expect(response.bytes).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("streams heartbeat responses chunk by chunk in the production Firebase HTTP adapter", async () => {
    const response = new TestResponse();
    const request = Object.assign(new EventEmitter(), {
      method: "POST",
      path: "/",
      headers: {},
      rawBody: Buffer.from("{}"),
    });
    const encoder = new TextEncoder();
    await createFirebaseHttpHandler(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(" "));
              controller.enqueue(encoder.encode(" "));
              controller.enqueue(encoder.encode('{"ok":true}'));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "application/json", "X-Accel-Buffering": "no" } },
        ),
    )(request, response);
    expect(response.flushed).toBe(true);
    expect(response.chunks).toEqual([" ", " ", '{"ok":true}']);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(response.writableEnded).toBe(true);
  });

  it("propagates a disconnected AI response into the gateway abort signal and disposes listeners", async () => {
    const shared = await import("../../server/AiGateway.js");
    let signal: AbortSignal | undefined;
    vi.spyOn(shared, "createAiGateway").mockReturnValue(async (request) => {
      signal = request.signal;
      return new Promise<Response>((resolve) => {
        request.signal.addEventListener(
          "abort",
          () => resolve(Response.json({ code: "cancelled" }, { status: 408 })),
          { once: true },
        );
      });
    });
    const handler = await httpHandler("ai");
    const request = Object.assign(new EventEmitter(), {
      method: "POST",
      path: "/",
      headers: {},
    });
    const response = new TestResponse();
    const pending = handler(request, response);
    expect(signal?.aborted).toBe(false);
    response.emit("close");
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(response.statusCode).toBe(408);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });
});
