import { PassThrough, Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { Storage } from "firebase-admin/storage";
import {
  API_ARTIFACT_LIFETIME_MS,
  apiArtifactOwner,
  firebaseApiArtifactStorage,
  isOwnedApiArtifact,
} from "../src/ApiArtifacts.js";

function fixture() {
  const file = {
    getMetadata: vi.fn(async () => [
      { metadata: { expiresAt: String(Date.now() + 30_000) }, size: "7" },
    ]),
    createReadStream: vi.fn(() => Readable.from([Buffer.from("fixture")])),
    delete: vi.fn(async () => {}),
  };
  const bucket = {
    upload: vi.fn(async () => {}),
    file: vi.fn(() => file),
  };
  const storage = { bucket: vi.fn(() => bucket) } as unknown as Storage;
  return {
    file,
    bucket,
    artifacts: firebaseApiArtifactStorage(
      storage,
      "private-api-artifacts",
      "https://www.tinytldr.com",
    ),
  };
}

describe("Private Firebase website artifacts", () => {
  it("uses authenticated API URLs, private metadata and bounded retention", async () => {
    const { bucket, artifacts } = fixture();
    const key = `${apiArtifactOwner("owner")}/${"a".repeat(36)}/file.png`;
    const before = Date.now();
    await artifacts.upload("render.png", key, "image/png");
    expect(bucket.upload).toHaveBeenCalledWith(
      "render.png",
      expect.objectContaining({
        destination: key,
        timeout: 30_000,
        resumable: false,
        metadata: expect.objectContaining({ cacheControl: "private, no-store" }),
      }),
    );
    const upload = bucket.upload.mock.calls[0] as unknown as [
      string,
      { metadata: { metadata: { expiresAt: string } } },
    ];
    const expiry = Number(upload[1].metadata.metadata.expiresAt);
    expect(expiry).toBeGreaterThanOrEqual(before + API_ARTIFACT_LIFETIME_MS);
    expect(await artifacts.signedUrl(key, expiry)).toBe(
      `https://www.tinytldr.com/v1/assets/${key}`,
    );
    expect(isOwnedApiArtifact(key, "owner")).toBe(true);
    expect(isOwnedApiArtifact(key, "other")).toBe(false);
    expect(isOwnedApiArtifact(`${apiArtifactOwner("owner")}/../../file.png`, "owner")).toBe(false);
  });

  it("refuses expired or oversized objects without downloading bytes", async () => {
    const { file, artifacts } = fixture();
    file.getMetadata.mockResolvedValue([
      { metadata: { expiresAt: String(Date.now() - 1) }, size: "7" },
    ]);
    expect(await artifacts.read("file.png")).toBeUndefined();
    file.getMetadata.mockResolvedValue([
      { metadata: { expiresAt: String(Date.now() + 30_000) }, size: "20000001" },
    ]);
    expect(await artifacts.read("file.png")).toBeUndefined();
    expect(file.createReadStream).not.toHaveBeenCalled();
  });

  it("checks object integrity and returns private typed content", async () => {
    const { file, artifacts } = fixture();
    expect(await artifacts.read("file.png")).toEqual({
      bytes: Buffer.from("fixture"),
      contentType: "image/png",
    });
    expect(file.createReadStream).toHaveBeenCalledWith({ validation: "crc32c" });
    file.createReadStream.mockReturnValue(Readable.from([Buffer.from("changed")]));
    file.getMetadata.mockResolvedValue([
      { metadata: { expiresAt: String(Date.now() + 30_000) }, size: "6" },
    ]);
    await expect(artifacts.read("file.png")).rejects.toThrow("size changed");
  });

  it("destroys stalled downloads after a hard 30-second deadline", async () => {
    vi.useFakeTimers();
    try {
      const { file, artifacts } = fixture();
      const stalled = new PassThrough();
      file.createReadStream.mockReturnValue(stalled);
      const failed = expect(artifacts.read("file.png")).rejects.toThrow("30 seconds");
      await vi.advanceTimersByTimeAsync(30_000);
      await failed;
      expect(stalled.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns not-found for missing objects and preserves infrastructure failures", async () => {
    const { file, artifacts } = fixture();
    file.getMetadata.mockRejectedValue(Object.assign(new Error("Missing"), { code: 404 }));
    expect(await artifacts.read("file.png")).toBeUndefined();
    file.getMetadata.mockRejectedValue(new Error("Storage unavailable"));
    await expect(artifacts.read("file.png")).rejects.toThrow("Storage unavailable");
    await artifacts.delete("file.png");
    expect(file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});
