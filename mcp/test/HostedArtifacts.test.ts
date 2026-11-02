import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostedArtifacts, type ArtifactStorage } from "../src/HostedArtifacts.js";

describe("Hosted artifact publication", () => {
  let root: string;
  let outside: string;
  let controller: AbortController;
  let uploaded: { key: string; contentType: string }[];
  let removed: string[];
  let signed: { key: string; expiresAt: number }[];
  let storage: ArtifactStorage;
  let publisher: HostedArtifacts;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "tinytldr-artifacts-test-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "tinytldr-outside-test-"));
    controller = new AbortController();
    uploaded = [];
    removed = [];
    signed = [];
    storage = {
      async upload(_file, key, contentType) {
        uploaded.push({ key, contentType });
      },
      async signedUrl(key, expiresAt) {
        signed.push({ key, expiresAt });
        return `https://storage.test/${key}?signature=fixture`;
      },
      async delete(key) {
        removed.push(key);
      },
    };
    publisher = new HostedArtifacts(root, "owner-one", storage, controller.signal);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("generates private owner-scoped keys and five-minute download capabilities", async () => {
    const file = publisher.path("png");
    await fs.writeFile(file, "fixture");
    const before = Date.now();
    const assets = await publisher.publish([file]);
    expect(assets).toEqual([
      { filename: path.basename(file), url: expect.stringContaining("signature=fixture") },
    ]);
    const owner = createHash("sha256").update("owner-one").digest("hex");
    expect(uploaded[0]?.key).toMatch(new RegExp(`^${owner}/[0-9a-f-]+/[0-9a-f-]+\\.png$`));
    expect(uploaded[0]?.contentType).toBe("image/png");
    expect(signed[0]!.expiresAt).toBeGreaterThanOrEqual(before + 300_000);
    expect(signed[0]!.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(removed).toEqual([]);
  });

  it("rejects direct traversal and symlink escapes before uploading", async () => {
    publisher.path("png");
    const escaped = path.join(outside, "outside.png");
    await fs.writeFile(escaped, "fixture");
    await expect(publisher.publish([escaped])).rejects.toThrow("inside");
    await fs.symlink(outside, path.join(root, "escape"), "junction");
    await expect(publisher.publish([path.join(root, "escape", "outside.png")])).rejects.toThrow(
      "inside",
    );
    expect(uploaded).toEqual([]);
  });

  it("rejects empty, unfinished, mismatched and oversized exports", async () => {
    const file = publisher.path("mp4");
    await fs.writeFile(file, "");
    await expect(publisher.publish([file])).rejects.toThrow("completed file");
    const frame = path.join(root, "fallback.jpg");
    await fs.writeFile(frame, "fixture");
    await expect(publisher.publish([frame])).rejects.toThrow("completed file");
    await fs.truncate(file, 20_000_001);
    await expect(publisher.publish([file])).rejects.toThrow("20 MB");
    await expect(publisher.publish([])).rejects.toThrow("count");
    await expect(publisher.publish(Array.from({ length: 21 }, () => file))).rejects.toThrow(
      "count",
    );
    expect(uploaded).toEqual([]);
  });

  it("checks the exact 50 MB batch threshold before any upload", async () => {
    const files = [publisher.path("png"), publisher.path("png"), publisher.path("png")];
    for (const [index, file] of files.entries()) {
      await fs.writeFile(file, "");
      await fs.truncate(file, index < 2 ? 20_000_000 : 10_000_001);
    }
    await expect(publisher.publish(files)).rejects.toThrow("50 MB");
    expect(uploaded).toEqual([]);
  });

  it("cleans up successful and uncertain uploads if publication fails", async () => {
    const files = [publisher.path("png"), publisher.path("png")];
    for (const file of files) await fs.writeFile(file, "fixture");
    storage.upload = async (_file, key, contentType) => {
      uploaded.push({ key, contentType });
      if (uploaded.length === 2) throw new Error("Upload failed after transmission.");
    };
    await expect(publisher.publish(files)).rejects.toThrow("Upload failed");
    expect(removed).toEqual(uploaded.map((entry) => entry.key));
  });

  it("cleans up on cancellation and surfaces cleanup failures", async () => {
    const file = publisher.path("png");
    await fs.writeFile(file, "fixture");
    storage.signedUrl = async () => {
      controller.abort(new Error("Cancelled fixture"));
      return "https://storage.test/capability";
    };
    await expect(publisher.publish([file])).rejects.toThrow("Cancelled fixture");
    expect(removed).toHaveLength(1);
    controller = new AbortController();
    publisher = new HostedArtifacts(root, "owner-two", storage, controller.signal);
    const next = publisher.path("png");
    await fs.writeFile(next, "fixture");
    storage.signedUrl = async () => {
      throw new Error("Signing failed");
    };
    storage.delete = async () => {
      throw new Error("Cleanup failed");
    };
    await expect(publisher.publish([next])).rejects.toThrow("upload and cleanup failed");
  });
});
