import { createHash } from "node:crypto";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { z } from "zod";
import {
  MEDIA_BATCH_MAX_BYTES,
  MEDIA_MIME_TYPES,
  MediaLibraryBeginSchema,
  MediaLibraryItemSchema,
  MediaLibraryPageSchema,
  UPLOAD_CAPACITY_BYTES,
  type MediaLibraryItem,
  type MediaLibraryRequest,
} from "@tinytldr/core";

const RESERVATION_MS = 10 * 60_000;
const BatchSchema = z.object({
  state: z.enum(["pending", "cancelling", "cancelled", "ready"]),
  expiresAt: z.number(),
  items: z.array(MediaLibraryItemSchema),
  fingerprint: z.string(),
});
const LedgerSchema = z.object({
  uploadBytes: z.number().int().nonnegative(),
  reservedUploadBytes: z.number().int().nonnegative(),
  pendingBytes: z.number().int().nonnegative(),
  minute: z.number().int(),
  writes: z.number().int().nonnegative(),
});
const ItemSchema = z.object({
  item: MediaLibraryItemSchema,
  batchId: z.string().uuid(),
  state: z.enum(["pending", "ready", "deleted"]),
});
type Batch = z.infer<typeof BatchSchema>;
type MediaResult =
  | z.infer<typeof MediaLibraryBeginSchema>
  | z.infer<typeof MediaLibraryPageSchema>
  | { ok: true }
  | { binary: Buffer; contentType: string };
const ledger = () => ({
  uploadBytes: 0,
  reservedUploadBytes: 0,
  pendingBytes: 0,
  minute: 0,
  writes: 0,
});
const bytes = (items: readonly MediaLibraryItem[]) =>
  items.reduce((total, item) => total + item.metadata.bytes + item.posterBytes, 0);
const uploads = (items: readonly MediaLibraryItem[]) =>
  items.reduce((total, item) => total + (item.source === "upload" ? item.metadata.bytes : 0), 0);
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
function matchesFormat(file: Buffer, format: MediaLibraryItem["metadata"]["format"]) {
  switch (format) {
    case "png":
      return file.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case "jpg":
      return file.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
    case "webp":
      return file.toString("ascii", 0, 4) === "RIFF" && file.toString("ascii", 8, 12) === "WEBP";
    case "pdf":
      return file.toString("ascii", 0, 5) === "%PDF-";
    case "mp4":
      return file.toString("ascii", 4, 8) === "ftyp";
  }
}

export class MediaRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MediaRequestError";
  }
}

export class MediaService {
  private readonly bucket: ReturnType<Storage["bucket"]>;

  constructor(
    private readonly database: Firestore,
    storage: Storage,
    bucketName: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!bucketName) throw new Error("TINYTLDR_FIREBASE_STORAGE_BUCKET is not configured.");
    this.bucket = storage.bucket(bucketName);
  }

  private account(uid: string) {
    if (!uid) throw new MediaRequestError(401, "Sign in to use My Library.");
    return this.database.collection("mediaAccounts").doc(Buffer.from(uid).toString("base64url"));
  }

  private key(uid: string, id: string, kind: "file" | "poster") {
    return `library/${this.account(uid).id}/${id}/${kind}`;
  }

  private async batch(uid: string, id: string): Promise<Batch> {
    const snapshot = await this.account(uid).collection("batches").doc(id).get();
    if (!snapshot.exists) throw new MediaRequestError(404, "This media batch does not exist.");
    return BatchSchema.parse(snapshot.data());
  }

  async execute(request: MediaLibraryRequest, uid: string): Promise<MediaResult> {
    const account = this.account(uid);
    if ((await account.get()).get("deleted") === true)
      throw new MediaRequestError(410, "This account was deleted.");
    if (request.action === "list") {
      await this.cleanupExpired(uid);
      let query = account
        .collection("items")
        .where("state", "==", "ready")
        .orderBy(FieldPath.documentId())
        .limit(100);
      if (request.cursor) query = query.startAfter(request.cursor);
      const page = await query.get();
      return {
        items: page.docs.map((doc) => ItemSchema.parse(doc.data()).item),
        ...(page.size === 100 ? { cursor: page.docs.at(-1)!.id } : {}),
      };
    }
    if (request.action === "begin") {
      await this.cleanupExpired(uid);
      const ref = account.collection("batches").doc(request.batchId);
      const fingerprint = digest(Buffer.from(JSON.stringify(request.items)));
      return this.database.runTransaction(async (transaction) => {
        const [snapshot, owner, ...existing] = await transaction.getAll(
          ref,
          account,
          ...request.items.map((item) => account.collection("items").doc(item.metadata.id)),
        );
        if (owner!.get("deleted") === true)
          throw new MediaRequestError(410, "This account was deleted.");
        if (snapshot!.exists) {
          const batch = BatchSchema.parse(snapshot!.data());
          if (batch.fingerprint !== fingerprint)
            throw new MediaRequestError(409, "Retry the same batch without changing its files.");
          if (batch.state !== "pending" && batch.state !== "ready")
            throw new MediaRequestError(409, "This upload was cancelled. Retry the upload.");
          return { state: batch.state, items: batch.items };
        }
        if (existing.some((doc) => doc.exists))
          throw new MediaRequestError(409, "A file ID is already in use.");
        const first = request.items[0]!;
        const hashRef =
          first.source === "upload" ? account.collection("uploads").doc(first.digest) : null;
        if (hashRef) {
          const hash = await transaction.get(hashRef);
          if (hash.exists) {
            const pointer = z.object({ id: z.string().uuid() }).parse(hash.data());
            const duplicate = await transaction.get(account.collection("items").doc(pointer.id));
            const stored = ItemSchema.parse(duplicate.data());
            if (stored.state === "ready")
              return { state: "duplicate" as const, items: [stored.item] };
            throw new MediaRequestError(409, "This image is already uploading. Retry shortly.");
          }
        }
        const current = owner!.exists ? LedgerSchema.parse(owner!.data()) : ledger();
        const minute = Math.floor(this.now() / 60_000);
        const writes = current.minute === minute ? current.writes + 1 : 1;
        if (writes > 32)
          throw new MediaRequestError(429, "Too many uploads. Wait a minute and retry.");
        const uploaded = uploads(request.items);
        const pending = bytes(request.items);
        if (current.uploadBytes + current.reservedUploadBytes + uploaded > UPLOAD_CAPACITY_BYTES)
          throw new MediaRequestError(
            413,
            "This would exceed your 100 MB uploads limit. Delete some uploads in My Library and retry.",
          );
        if (current.pendingBytes + pending > MEDIA_BATCH_MAX_BYTES + 20_000_000)
          throw new MediaRequestError(429, "Other files are still uploading. Retry shortly.");
        transaction.set(account, {
          ...current,
          minute,
          writes,
          reservedUploadBytes: current.reservedUploadBytes + uploaded,
          pendingBytes: current.pendingBytes + pending,
        });
        transaction.create(ref, {
          state: "pending",
          expiresAt: this.now() + RESERVATION_MS,
          fingerprint,
          items: request.items,
        });
        for (const item of request.items)
          transaction.create(account.collection("items").doc(item.metadata.id), {
            item,
            batchId: request.batchId,
            state: "pending",
          });
        if (hashRef) transaction.create(hashRef, { id: first.metadata.id });
        return { state: "pending" as const, items: request.items };
      });
    }
    if (request.action === "put") {
      const batch = await this.batch(uid, request.batchId);
      const item = batch.items.find((entry) => entry.metadata.id === request.id);
      if (!item || batch.state !== "pending" || batch.expiresAt <= this.now())
        throw new MediaRequestError(409, "This upload is no longer pending. Retry it.");
      const file = Buffer.from(request.file, "base64");
      const poster = Buffer.from(request.poster, "base64");
      if (
        file.toString("base64") !== request.file ||
        poster.toString("base64") !== request.poster ||
        file.length !== item.metadata.bytes ||
        poster.length !== item.posterBytes ||
        digest(file) !== item.digest ||
        !matchesFormat(file, item.metadata.format) ||
        !matchesFormat(poster, "png") ||
        poster.length < 24 ||
        poster.readUInt32BE(16) < 1 ||
        poster.readUInt32BE(20) < 1 ||
        poster.readUInt32BE(16) > 512 ||
        poster.readUInt32BE(20) > 512
      )
        throw new MediaRequestError(400, "The uploaded file or thumbnail is incomplete.");
      for (const [kind, data, contentType] of [
        ["file", file, MEDIA_MIME_TYPES[item.metadata.format]],
        ["poster", poster, "image/png"],
      ] as const)
        await this.bucket.file(this.key(uid, request.id, kind)).save(data, {
          resumable: false,
          timeout: 30_000,
          validation: "crc32c",
          metadata: {
            contentType,
            cacheControl: "private, no-store",
            metadata: { sha256: digest(data) },
          },
        });
      let latest: Batch;
      try {
        latest = await this.batch(uid, request.batchId);
      } catch (error) {
        if (error instanceof MediaRequestError && error.status === 404)
          await this.removeFiles(uid, request.id);
        throw error;
      }
      if (
        (latest.state !== "pending" && latest.state !== "ready") ||
        (await account.get()).get("deleted") === true
      ) {
        await this.removeFiles(uid, request.id);
        throw new MediaRequestError(409, "This upload was cancelled.");
      }
      return { ok: true as const };
    }
    if (request.action === "commit") {
      const batch = await this.batch(uid, request.batchId);
      if (batch.state === "ready") return { ok: true as const };
      if (batch.state !== "pending" || batch.expiresAt <= this.now())
        throw new MediaRequestError(409, "This upload expired. Retry it.");
      for (const item of batch.items)
        for (const kind of ["file", "poster"] as const) {
          const [metadata] = await this.bucket
            .file(this.key(uid, item.metadata.id, kind))
            .getMetadata();
          if (
            Number(metadata.size) !== (kind === "file" ? item.metadata.bytes : item.posterBytes) ||
            metadata.contentType !==
              (kind === "file" ? MEDIA_MIME_TYPES[item.metadata.format] : "image/png") ||
            (kind === "file" && metadata.metadata?.sha256 !== item.digest)
          )
            throw new MediaRequestError(409, "Some files have not finished uploading. Retry.");
        }
      await this.database.runTransaction(async (transaction) => {
        const ref = account.collection("batches").doc(request.batchId);
        const [snapshot, owner] = await transaction.getAll(ref, account);
        if (owner!.get("deleted") === true)
          throw new MediaRequestError(410, "This account was deleted.");
        const latest = BatchSchema.parse(snapshot!.data());
        if (latest.state === "ready") return;
        if (latest.state !== "pending" || latest.expiresAt <= this.now())
          throw new MediaRequestError(409, "This upload is no longer pending.");
        const current = LedgerSchema.parse(owner!.data());
        transaction.update(account, {
          uploadBytes: current.uploadBytes + uploads(latest.items),
          reservedUploadBytes: current.reservedUploadBytes - uploads(latest.items),
          pendingBytes: current.pendingBytes - bytes(latest.items),
        });
        transaction.update(ref, { state: "ready" });
        for (const item of latest.items)
          transaction.update(account.collection("items").doc(item.metadata.id), { state: "ready" });
      });
      return { ok: true as const };
    }
    if (request.action === "cancel") {
      await this.cancel(uid, request.batchId);
      return { ok: true as const };
    }
    const ref = account.collection("items").doc(request.id);
    const snapshot = await ref.get();
    if (!snapshot.exists && request.action === "delete") return { ok: true as const };
    if (!snapshot.exists) throw new MediaRequestError(404, "This file is not in your library.");
    const stored = ItemSchema.parse(snapshot.data());
    if (stored.state === "deleted") {
      if (request.action === "delete") return { ok: true as const };
      throw new MediaRequestError(404, "This file is not in your library.");
    }
    if (stored.state !== "ready")
      throw new MediaRequestError(409, "This file has not finished uploading.");
    const item = stored.item;
    if (request.action === "delete") {
      await this.removeFiles(uid, request.id);
      await this.database.runTransaction(async (transaction) => {
        const [currentItem, owner] = await transaction.getAll(ref, account);
        if (!currentItem!.exists || ItemSchema.parse(currentItem!.data()).state === "deleted")
          return;
        const current = LedgerSchema.parse(owner!.data());
        transaction.update(ref, { state: "deleted" });
        if (item.source === "upload") {
          transaction.update(account, { uploadBytes: current.uploadBytes - item.metadata.bytes });
          transaction.delete(account.collection("uploads").doc(item.digest));
        }
      });
      return { ok: true as const };
    }
    const file = this.bucket.file(this.key(uid, request.id, request.kind));
    const expected = request.kind === "file" ? item.metadata.bytes : item.posterBytes;
    const stream = file.createReadStream({ validation: "crc32c" });
    const deadline = setTimeout(
      () => stream.destroy(new Error("Media download exceeded 30 seconds.")),
      30_000,
    );
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of stream) {
        if (!Buffer.isBuffer(chunk)) throw new Error("Media download is not binary.");
        length += chunk.length;
        if (length > expected) throw new Error("Media size changed during download.");
        chunks.push(chunk);
      }
      if (length !== expected) throw new Error("Media download is incomplete.");
      return {
        binary: Buffer.concat(chunks, length),
        contentType: request.kind === "file" ? MEDIA_MIME_TYPES[item.metadata.format] : "image/png",
      };
    } finally {
      clearTimeout(deadline);
      stream.destroy();
    }
  }

  private async removeFiles(uid: string, id: string) {
    await Promise.all(
      (["file", "poster"] as const).map((kind) =>
        this.bucket.file(this.key(uid, id, kind)).delete({ ignoreNotFound: true }),
      ),
    );
  }

  private async cancel(uid: string, id: string) {
    const account = this.account(uid);
    const ref = account.collection("batches").doc(id);
    const batch = await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const current = BatchSchema.parse(snapshot.data());
      if (current.state === "ready" || current.state === "cancelled") return null;
      transaction.update(ref, { state: "cancelling" });
      return current;
    });
    if (!batch) return;
    for (const item of batch.items) await this.removeFiles(uid, item.metadata.id);
    await this.database.runTransaction(async (transaction) => {
      const [snapshot, owner] = await transaction.getAll(ref, account);
      const currentBatch = BatchSchema.parse(snapshot!.data());
      if (currentBatch.state === "cancelled") return;
      const current = LedgerSchema.parse(owner!.data());
      transaction.update(account, {
        reservedUploadBytes: current.reservedUploadBytes - uploads(batch.items),
        pendingBytes: current.pendingBytes - bytes(batch.items),
      });
      transaction.update(ref, { state: "cancelled" });
      for (const item of batch.items) {
        transaction.update(account.collection("items").doc(item.metadata.id), { state: "deleted" });
        if (item.source === "upload")
          transaction.delete(account.collection("uploads").doc(item.digest));
      }
    });
  }

  private async cleanupExpired(uid: string) {
    const pending = await this.account(uid)
      .collection("batches")
      .where("state", "in", ["pending", "cancelling"])
      .get();
    for (const doc of pending.docs) {
      const batch = BatchSchema.parse(doc.data());
      if (batch.state === "cancelling" || batch.expiresAt <= this.now())
        await this.cancel(uid, doc.id);
    }
  }

  async deleteAccount(uid: string) {
    const account = this.account(uid);
    await account.set({ deleted: true }, { merge: true });
    await this.bucket.deleteFiles({ prefix: `library/${account.id}/` });
    for (const collection of ["items", "batches", "uploads"])
      await this.database.recursiveDelete(account.collection(collection));
    await account.set({ deleted: true });
  }
}
