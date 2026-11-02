import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Storage } from "firebase-admin/storage";
import { MEDIA_MIME_TYPES, MediaFormatSchema } from "@tinytldr/core";
import type { RenderOutputFormat } from "@tinytldr/renderer";
import type { HostedArtifactPublisher } from "./RegisterRenderTools.js";

export interface ArtifactStorage {
  upload(localPath: string, key: string, contentType: string): Promise<void>;
  signedUrl(key: string, expiresAt: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export function firebaseArtifactStorage(storage: Storage, name: string): ArtifactStorage {
  const bucket = storage.bucket(name);
  return {
    async upload(localPath, destination, contentType) {
      await bucket.upload(localPath, {
        destination,
        resumable: false,
        timeout: 30_000,
        metadata: { contentType, cacheControl: "private, max-age=0" },
      });
    },
    async signedUrl(key, expires) {
      const [url] = await bucket.file(key).getSignedUrl({
        version: "v4",
        action: "read",
        expires,
      });
      return url;
    },
    async delete(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
  };
}

export class HostedArtifacts implements HostedArtifactPublisher {
  private format: RenderOutputFormat | undefined;
  private readonly owner: string;

  constructor(
    readonly directory: string,
    uid: string,
    private readonly storage: ArtifactStorage,
    private readonly signal: AbortSignal,
  ) {
    this.owner = createHash("sha256").update(uid).digest("hex");
  }

  path(format: RenderOutputFormat) {
    this.signal.throwIfAborted();
    this.format = format;
    return path.join(this.directory, `${randomUUID()}.${format}`);
  }

  async publish(paths: readonly string[]) {
    this.signal.throwIfAborted();
    if (!this.format || paths.length === 0 || paths.length > 20)
      throw new Error("Hosted export file count is invalid.");
    const root = await fs.realpath(this.directory);
    let bytes = 0;
    const files: { file: string; filename: string }[] = [];
    for (const file of paths) {
      const resolved = await fs.realpath(file);
      const relative = path.relative(root, resolved);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("Hosted exports must stay inside the request's output directory.");
      const stats = await fs.stat(resolved);
      if (
        !stats.isFile() ||
        stats.size === 0 ||
        stats.size > 20_000_000 ||
        path.extname(resolved) !== `.${this.format}`
      )
        throw new Error("Hosted export must be a completed file smaller than 20 MB.");
      bytes += stats.size;
      if (bytes > 50_000_000) throw new Error("Hosted export batch exceeds 50 MB.");
      files.push({ file: resolved, filename: path.basename(resolved) });
    }
    const prefix = `${this.owner}/${randomUUID()}`;
    const uploaded: string[] = [];
    const assets: { filename: string; url: string }[] = [];
    const contentType = MEDIA_MIME_TYPES[MediaFormatSchema.parse(this.format)];
    try {
      for (const file of files) {
        this.signal.throwIfAborted();
        const key = `${prefix}/${file.filename}`;
        uploaded.push(key);
        await this.storage.upload(file.file, key, contentType);
        this.signal.throwIfAborted();
        assets.push({
          filename: file.filename,
          url: await this.storage.signedUrl(key, Date.now() + 5 * 60_000),
        });
      }
      this.signal.throwIfAborted();
      return assets;
    } catch (error) {
      const cleanup = await Promise.allSettled(uploaded.map((key) => this.storage.delete(key)));
      const failures = cleanup.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length)
        throw new AggregateError([error, ...failures], "Hosted upload and cleanup failed.");
      throw error;
    }
  }
}
