import { createHash } from "node:crypto";
import type { Storage } from "firebase-admin/storage";
import { MEDIA_MIME_TYPES, MediaFormatSchema } from "@tinytldr/core";
import type { ArtifactStorage } from "./HostedArtifacts.js";

export const API_ARTIFACT_LIFETIME_MS = 5 * 60_000;

export interface ApiArtifactStorage extends ArtifactStorage {
  read(key: string): Promise<{ bytes: Buffer; contentType: string } | undefined>;
}

export function apiArtifactOwner(uid: string): string {
  return createHash("sha256").update(uid).digest("hex");
}

export function isOwnedApiArtifact(key: string, uid: string): boolean {
  return (
    /^[a-f0-9]{64}\/[a-f0-9-]{36}\/[a-zA-Z0-9._-]+\.(png|jpg|webp|pdf|mp4)$/.test(key) &&
    key.split("/")[0] === apiArtifactOwner(uid)
  );
}

export function firebaseApiArtifactStorage(
  storage: Storage,
  bucketName: string,
  publicUrl: string,
): ApiArtifactStorage {
  const bucket = storage.bucket(bucketName);
  return {
    async upload(localPath, destination, contentType) {
      await bucket.upload(localPath, {
        destination,
        resumable: false,
        timeout: 30_000,
        metadata: {
          contentType,
          cacheControl: "private, no-store",
          metadata: { expiresAt: String(Date.now() + API_ARTIFACT_LIFETIME_MS) },
        },
      });
    },
    async signedUrl(key) {
      // These are authenticated API URLs, never transferable bucket signatures.
      return new URL(`/v1/assets/${key}`, publicUrl).href;
    },
    async delete(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
    async read(key) {
      const file = bucket.file(key);
      try {
        const [metadata] = await file.getMetadata();
        const expiresAt = Number(metadata.metadata?.expiresAt);
        const size = Number(metadata.size);
        if (
          !Number.isFinite(expiresAt) ||
          expiresAt <= Date.now() ||
          !Number.isSafeInteger(size) ||
          size < 1 ||
          size > 20_000_000
        )
          return undefined;
        const format = MediaFormatSchema.parse(key.split(".").at(-1));
        const stream = file.createReadStream({ validation: "crc32c" });
        const deadline = setTimeout(
          () => stream.destroy(new Error("Artifact download exceeded 30 seconds.")),
          30_000,
        );
        try {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of stream) {
            if (!Buffer.isBuffer(chunk)) throw new Error("Artifact download is not binary.");
            length += chunk.length;
            if (length > size) throw new Error("Artifact size changed during download.");
            chunks.push(chunk);
          }
          if (length !== size) throw new Error("Artifact size changed during download.");
          return { bytes: Buffer.concat(chunks, length), contentType: MEDIA_MIME_TYPES[format] };
        } finally {
          clearTimeout(deadline);
          stream.destroy();
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === 404) return undefined;
        throw error;
      }
    },
  };
}
