import { randomUUID, createHash } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  MediaLibraryBeginSchema,
  MediaLibraryPageSchema,
  UPLOAD_CAPACITY_BYTES,
  type MediaLibraryItem,
} from "@tinytldr/core";
import { MediaService } from "../src/MediaService.js";
import { createMediaGateway } from "../src/MediaGateway.js";

const enabled = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST,
);
describe.skipIf(!enabled)("Firebase media storage against real emulators", () => {
  const app = initializeApp({ projectId: "demo-tinytldr" }, `media-${randomUUID()}`);
  const db = getFirestore(app);
  const storage = getStorage(app);
  const bucketName = "demo-tinytldr.firebasestorage.app";
  const bucket = storage.bucket(bucketName);
  let now = Date.now();
  const service = new MediaService(db, storage, bucketName, () => now);
  const owners = new Set<string>();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const owner = () => {
    const uid = `media-owner-${randomUUID()}`;
    owners.add(uid);
    return uid;
  };
  const account = (uid: string) =>
    db.collection("mediaAccounts").doc(Buffer.from(uid).toString("base64url"));
  const key = (uid: string, id: string, kind = "file") =>
    `library/${account(uid).id}/${id}/${kind}`;
  const item = (source: "upload" | "export" = "upload", file = png): MediaLibraryItem => ({
    metadata: {
      id: randomUUID(),
      title: "Test image",
      filename: "image.png",
      format: "png",
      sourcePath: `/local/${randomUUID()}`,
      createdAt: new Date().toISOString(),
      width: 1,
      height: 1,
      bytes: file.length,
    },
    source,
    digest: createHash("sha256").update(file).digest("hex"),
    posterBytes: png.length,
  });
  async function begin(uid: string, items: MediaLibraryItem[]) {
    const batchId = randomUUID();
    const result = await service.execute({ action: "begin", batchId, items }, uid);
    return { batchId, result: MediaLibraryBeginSchema.parse(result) };
  }
  async function put(uid: string, batchId: string, entry: MediaLibraryItem, file = png) {
    await service.execute(
      {
        action: "put",
        batchId,
        id: entry.metadata.id,
        file: file.toString("base64"),
        poster: png.toString("base64"),
      },
      uid,
    );
  }
  async function list(uid: string) {
    return MediaLibraryPageSchema.parse(await service.execute({ action: "list" }, uid)).items;
  }
  afterEach(async () => {
    for (const uid of owners) await service.deleteAccount(uid);
    owners.clear();
    now = Date.now();
  });
  afterAll(async () => {
    await db.terminate();
    await deleteApp(app);
  });
  it("persists original bytes and thumbnails, publishes only complete batches, and retains them beyond temporary export expiry", async () => {
    const uid = owner();
    const entry = item();
    const { batchId } = await begin(uid, [entry]);
    await put(uid, batchId, entry);
    expect(await list(uid)).toEqual([]);
    expect((await bucket.file(key(uid, entry.metadata.id)).download())[0]).toEqual(png);
    await service.execute({ action: "commit", batchId }, uid);
    expect(await list(uid)).toEqual([entry]);
    now += 60 * 60_000;
    const read = await service.execute(
      { action: "read", id: entry.metadata.id, kind: "file" },
      uid,
    );
    expect(read).toEqual({ binary: png, contentType: "image/png" });
    expect((await account(uid).get()).get("uploadBytes")).toBe(png.length);
    const [metadata] = await bucket.file(key(uid, entry.metadata.id)).getMetadata();
    expect(metadata.metadata?.expiresAt).toBeUndefined();
    expect(metadata.cacheControl).toBe("private, no-store");
    await service.execute({ action: "commit", batchId }, uid);
    expect((await account(uid).get()).get("uploadBytes")).toBe(png.length);
  });
  it("deduplicates uploads per account, blocks pending duplicate reservations, and isolates reads and deletion", async () => {
    const uid = owner();
    const other = owner();
    const entry = item();
    const { batchId } = await begin(uid, [entry]);
    await expect(begin(uid, [item()])).rejects.toMatchObject({ status: 409 });
    await put(uid, batchId, entry);
    await service.execute({ action: "commit", batchId }, uid);
    expect((await begin(uid, [item()])).result.state).toBe("duplicate");
    await expect(
      service.execute({ action: "read", id: entry.metadata.id, kind: "file" }, other),
    ).rejects.toMatchObject({ status: 404 });
    await service.execute({ action: "delete", id: entry.metadata.id }, other);
    expect(await list(uid)).toEqual([entry]);
    expect(await list(other)).toEqual([]);
    expect((await begin(other, [item()])).result.state).toBe("pending");
    await service.execute({ action: "delete", id: entry.metadata.id }, uid);
    await service.execute({ action: "delete", id: entry.metadata.id }, uid);
    expect((await bucket.file(key(uid, entry.metadata.id)).exists())[0]).toBe(false);
    expect((await bucket.file(key(uid, entry.metadata.id, "poster")).exists())[0]).toBe(false);
    expect((await account(uid).get()).get("uploadBytes")).toBe(0);
    expect(await list(uid)).toEqual([]);
    await expect(begin(uid, [entry])).rejects.toMatchObject({ status: 409 });
  });
  it("enforces the exact 100 MB account quota atomically across concurrent requests", async () => {
    const uid = owner();
    await account(uid).set({
      uploadBytes: UPLOAD_CAPACITY_BYTES - png.length,
      reservedUploadBytes: 0,
      pendingBytes: 0,
      minute: 0,
      writes: 0,
    });
    const otherBytes = Buffer.from(png);
    otherBytes[otherBytes.length - 1] = otherBytes[otherBytes.length - 1]! ^ 1;
    const responses = await Promise.allSettled([
      begin(uid, [item()]),
      begin(uid, [item("upload", otherBytes)]),
    ]);
    expect(responses.filter((response) => response.status === "fulfilled")).toHaveLength(1);
    expect(responses.filter((response) => response.status === "rejected")).toHaveLength(1);
    expect((await account(uid).get()).get("reservedUploadBytes")).toBe(png.length);
    const successful = responses.find((response) => response.status === "fulfilled");
    if (!successful || successful.status !== "fulfilled")
      throw new Error("Exact-capacity upload was rejected.");
    await service.execute({ action: "cancel", batchId: successful.value.batchId }, uid);
    expect((await account(uid).get()).get("reservedUploadBytes")).toBe(0);
  });
  it("rolls back partial export batches and prevents cancelled or replayed requests recreating their files", async () => {
    const uid = owner();
    const items = [item("export"), item("export")];
    const { batchId } = await begin(uid, items);
    await put(uid, batchId, items[0]!);
    await expect(service.execute({ action: "commit", batchId }, uid)).rejects.toThrow();
    expect(await list(uid)).toEqual([]);
    await service.execute({ action: "cancel", batchId }, uid);
    await service.execute({ action: "cancel", batchId }, uid);
    expect((await bucket.file(key(uid, items[0]!.metadata.id)).exists())[0]).toBe(false);
    expect((await account(uid).get()).get("pendingBytes")).toBe(0);
    await expect(put(uid, batchId, items[0]!)).rejects.toMatchObject({ status: 409 });
    await expect(service.execute({ action: "begin", batchId, items }, uid)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("expires abandoned reservations, releases quota, and removes only that account's staged files", async () => {
    const uid = owner();
    const entry = item();
    const { batchId } = await begin(uid, [entry]);
    await put(uid, batchId, entry);
    now += 11 * 60_000;
    expect(await list(uid)).toEqual([]);
    expect((await account(uid).get()).get("reservedUploadBytes")).toBe(0);
    expect((await bucket.file(key(uid, entry.metadata.id)).exists())[0]).toBe(false);
    expect((await begin(uid, [item()])).result.state).toBe("pending");
  });
  it("rejects altered file bytes and denies unauthenticated direct Storage access", async () => {
    const uid = owner();
    const entry = item();
    const { batchId } = await begin(uid, [entry]);
    await expect(put(uid, batchId, entry, Buffer.from("wrong"))).rejects.toMatchObject({
      status: 400,
    });
    await put(uid, batchId, entry);
    await service.execute({ action: "commit", batchId }, uid);
    const response = await fetch(
      `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(key(uid, entry.metadata.id))}?alt=media`,
    );
    expect(response.status).toBe(403);
  });
  it("authenticates media operations and enforces CORS before accessing storage", async () => {
    const uid = owner();
    const errors: unknown[] = [];
    const gateway = createMediaGateway({
      service: () => service,
      allowedOrigins: ["https://www.tinytldr.com"],
      verifyUser: async (token) => (token === "test-session" ? uid : null),
      reportError: (error) => errors.push(error),
    });
    const send = (headers: Record<string, string>) =>
      gateway(
        new Request("https://media.test", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ action: "list" }),
        }),
      );
    expect((await send({})).status).toBe(401);
    expect((await send({ Authorization: "Bearer invalid" })).status).toBe(401);
    expect(
      (await send({ Authorization: "Bearer test-session", Origin: "https://evil.test" })).status,
    ).toBe(403);
    const response = await send({
      Authorization: "Bearer test-session",
      Origin: "https://www.tinytldr.com",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { items: [] } });
    expect(errors).toEqual([]);
  });

  it("cleans account files idempotently and prevents old requests recreating deleted media", async () => {
    const uid = owner();
    const entry = item();
    const { batchId } = await begin(uid, [entry]);
    await put(uid, batchId, entry);
    await service.execute({ action: "commit", batchId }, uid);
    await service.deleteAccount(uid);
    await service.deleteAccount(uid);
    expect((await bucket.file(key(uid, entry.metadata.id)).exists())[0]).toBe(false);
    expect((await account(uid).collection("items").get()).empty).toBe(true);
    expect((await account(uid).get()).data()).toEqual({ deleted: true });
    await expect(begin(uid, [item()])).rejects.toMatchObject({ status: 410 });
    await expect(put(uid, batchId, entry)).rejects.toMatchObject({ status: 410 });
  });
});
