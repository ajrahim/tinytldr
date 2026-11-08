import { createHash, timingSafeEqual } from "node:crypto";
import {
  FieldValue,
  type Firestore,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { z } from "zod";
import {
  DESIGN_FOLDER_LIMIT,
  DESIGN_FOLDER_SIZE_LIMIT,
  DESIGN_VERSION_PAGE_SIZE,
  DeletedDesignRecordSchema as DeletedDesignSchema,
  DesignFolderSchema,
  FirebaseDesignRequestSchema,
  SavedDesignVersionSchema,
  StoredDesignFolderSchema as StoredFolderSchema,
  StoredDesignRecordSchema as StoredDesignSchema,
  savedDesignFromRecord as publicDesign,
  type FirebaseDesignRequest,
  type StoredDesignFolder as StoredFolder,
  type StoredDesignRecord as StoredDesign,
  type WorkspaceProject,
} from "@tinytldr/core/firebase";

export class DesignRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DesignRequestError";
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function canEdit(
  stored: Pick<StoredDesign, "owner_id" | "guest_key_hash">,
  userId: string | null,
  editKey: string | null,
): boolean {
  if (stored.owner_id !== null) return stored.owner_id === userId;
  if (!editKey || !stored.guest_key_hash) return false;
  return timingSafeEqual(
    Buffer.from(stored.guest_key_hash, "hex"),
    Buffer.from(hashKey(editKey), "hex"),
  );
}

function readDesign(snapshot: DocumentSnapshot): StoredDesign {
  if (!snapshot.exists || DeletedDesignSchema.safeParse(snapshot.data()).success)
    throw new DesignRequestError("This design was not found.", 404);
  return StoredDesignSchema.parse(snapshot.data());
}

export class DesignService {
  constructor(private readonly database: Firestore) {}

  async execute(input: FirebaseDesignRequest, userId: string | null): Promise<unknown> {
    const request = FirebaseDesignRequestSchema.parse(input);
    if (request.action === "list") {
      if (!userId) throw new DesignRequestError("Sign in to load your designs.", 401);
      const snapshots = await this.database
        .collection("designs")
        .where("owner_id", "==", userId)
        .orderBy("updated_at", "desc")
        .get();
      return snapshots.docs
        .filter((snapshot) => !DeletedDesignSchema.safeParse(snapshot.data()).success)
        .map((snapshot) => publicDesign(readDesign(snapshot)));
    }
    if (request.action === "delete") return this.deleteDesign(request, userId);
    if (
      request.action === "folders" ||
      request.action === "createFolder" ||
      request.action === "renameFolder" ||
      request.action === "colorFolder" ||
      request.action === "deleteFolder" ||
      request.action === "moveToFolder"
    ) {
      if (!userId) throw new DesignRequestError("Sign in to organize designs in folders.", 401);
      return this.folderAction(request, userId);
    }

    const ref = this.database.collection("designs").doc(request.id);
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (request.action === "save" && request.revision === undefined) {
        if (!request.editKey)
          throw new DesignRequestError("A 256-bit private edit key is required.", 400);
        if (snapshot.exists) {
          const existing = readDesign(snapshot);
          if (!canEdit(existing, userId, request.editKey))
            throw new DesignRequestError("This design ID is already in use.", 403);
          return publicDesign(existing);
        }
        const now = new Date().toISOString();
        const created: StoredDesign = {
          id: request.id,
          owner_id: userId,
          document_json: this.encodeDocument(request.document),
          guest_key_hash: userId ? null : hashKey(request.editKey),
          revision: 1,
          created_at: now,
          updated_at: now,
        };
        this.writeRevision(transaction, created);
        return publicDesign(created);
      }

      const stored = readDesign(snapshot);
      if (request.action === "get") return publicDesign(stored);
      if (request.action === "claim") {
        if (!userId) throw new DesignRequestError("Sign in before claiming a design.", 401);
        if (stored.owner_id !== null || !canEdit(stored, null, request.editKey))
          throw new DesignRequestError(
            "This design has already been claimed, or its private key is missing.",
            403,
          );
        if (request.revision !== undefined && request.revision !== stored.revision)
          throw new DesignRequestError(
            "Claim refused: the design changed. Open it and recover your browser draft first.",
            409,
          );
        const claimed: StoredDesign = {
          ...stored,
          owner_id: userId,
          guest_key_hash: null,
          revision: stored.revision + 1,
          updated_at: new Date().toISOString(),
        };
        this.writeRevision(transaction, claimed);
        return publicDesign(claimed);
      }

      if (!canEdit(stored, userId, request.editKey))
        throw new DesignRequestError("This action is private to the design editor.", 403);
      if (request.action === "save" || request.action === "rename") {
        if (request.revision !== stored.revision)
          throw new DesignRequestError(
            `${request.action === "rename" ? "Rename" : "Save"} refused: the design changed. Reload it or save a copy.`,
            409,
          );
        const updated: StoredDesign = {
          ...stored,
          document_json: this.encodeDocument(
            request.action === "rename"
              ? { ...publicDesign(stored).document, title: request.title }
              : request.document,
          ),
          revision: stored.revision + 1,
          updated_at: new Date().toISOString(),
        };
        this.writeRevision(transaction, updated);
        return publicDesign(updated);
      }
      const versions = ref.collection("versions");
      if (request.action === "version") {
        const version = await transaction.get(versions.doc(String(request.revision)));
        if (!version.exists) throw new DesignRequestError("This saved version was not found.", 404);
        return this.readVersion(version);
      }
      let query = versions.orderBy("revision", "desc");
      if (request.before !== undefined) query = query.where("revision", "<", request.before);
      const page = await transaction.get(query.limit(DESIGN_VERSION_PAGE_SIZE + 1));
      const entries = page.docs.slice(0, DESIGN_VERSION_PAGE_SIZE).map((entry) => {
        const version = this.readVersion(entry);
        return { revision: version.revision, saved_at: version.saved_at };
      });
      return {
        versions: entries,
        next_before: page.size > DESIGN_VERSION_PAGE_SIZE ? entries.at(-1)!.revision : null,
      };
    });
  }

  private async deleteDesign(
    request: Extract<FirebaseDesignRequest, { action: "delete" }>,
    userId: string | null,
  ) {
    const ref = this.database.collection("designs").doc(request.id);
    let ownerId = null as string | null;
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const deleted = DeletedDesignSchema.safeParse(snapshot.data());
      const stored = deleted.success ? deleted.data : readDesign(snapshot);
      if (!canEdit(stored, userId, request.editKey))
        throw new DesignRequestError("This action is private to the design editor.", 403);
      ownerId = stored.owner_id;
      if (stored.revision !== request.revision)
        throw new DesignRequestError(
          "Delete refused: the design changed. Reload it before confirming deletion.",
          409,
        );
      if (!deleted.success)
        transaction.set(ref, {
          id: stored.id,
          owner_id: stored.owner_id,
          guest_key_hash: stored.guest_key_hash,
          revision: stored.revision,
          deleted_at: new Date().toISOString(),
        });
    });
    // Keep the authorization tombstone: delayed saves must not recreate the public link.
    await this.database.recursiveDelete(ref.collection("versions"));
    if (ownerId) await this.removeFromFolders(ownerId, request.id);
    return { id: request.id, deleted: true };
  }

  private async removeFromFolders(ownerId: string, designId: string) {
    const folders = await this.database
      .collection("design_folders")
      .where("owner_id", "==", ownerId)
      .get();
    const now = new Date().toISOString();
    await Promise.all(
      folders.docs
        .filter((doc) => (doc.get("design_ids") as unknown[] | undefined)?.includes(designId))
        .map((doc) =>
          doc.ref.update({ design_ids: FieldValue.arrayRemove(designId), updated_at: now }),
        ),
    );
  }

  private async folderAction(
    request: Extract<
      FirebaseDesignRequest,
      {
        action:
          | "folders"
          | "createFolder"
          | "renameFolder"
          | "colorFolder"
          | "deleteFolder"
          | "moveToFolder";
      }
    >,
    userId: string,
  ): Promise<unknown> {
    const folders = this.database.collection("design_folders");
    const owned = folders.where("owner_id", "==", userId);
    const publicFolder = ({ owner_id: _owner, ...folder }: StoredFolder) =>
      DesignFolderSchema.parse(folder);
    const sorted = (entries: StoredFolder[]) =>
      entries
        .map(publicFolder)
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
            left.created_at.localeCompare(right.created_at),
        );
    if (request.action === "folders")
      return sorted((await owned.get()).docs.map((doc) => StoredFolderSchema.parse(doc.data())));

    return this.database.runTransaction(async (transaction) => {
      const readOwned = async () =>
        (await transaction.get(owned)).docs.map((doc) => StoredFolderSchema.parse(doc.data()));
      if (request.action === "moveToFolder") {
        const design = readDesign(
          await transaction.get(this.database.collection("designs").doc(request.id)),
        );
        if (design.owner_id !== userId)
          throw new DesignRequestError(
            "Only designs in your account can be moved to folders.",
            403,
          );
        const entries = await readOwned();
        if (request.folderId && !entries.some((folder) => folder.id === request.folderId))
          throw new DesignRequestError("This folder was not found.", 404);
        const now = new Date().toISOString();
        const next = entries.map((folder) => {
          const without = folder.design_ids.filter((designId) => designId !== request.id);
          const design_ids = folder.id === request.folderId ? [request.id, ...without] : without;
          if (design_ids.length > DESIGN_FOLDER_SIZE_LIMIT)
            throw new DesignRequestError(
              `A folder can hold at most ${DESIGN_FOLDER_SIZE_LIMIT} designs.`,
              400,
            );
          const changed =
            design_ids.length !== folder.design_ids.length ||
            design_ids.some((value, index) => value !== folder.design_ids[index]);
          return changed ? { ...folder, design_ids, updated_at: now } : folder;
        });
        for (const [index, folder] of next.entries())
          if (folder !== entries[index]) transaction.set(folders.doc(folder.id), folder);
        return sorted(next);
      }
      const ref = folders.doc(request.folderId);
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists ? StoredFolderSchema.parse(snapshot.data()) : null;
      if (existing && existing.owner_id !== userId)
        throw new DesignRequestError("This folder belongs to another account.", 403);
      if (request.action === "createFolder") {
        // Retried creates with the same client ID return the existing folder.
        if (existing) return publicFolder(existing);
        const entries = await readOwned();
        if (entries.length >= DESIGN_FOLDER_LIMIT)
          throw new DesignRequestError(
            `You can create at most ${DESIGN_FOLDER_LIMIT} folders.`,
            400,
          );
        const now = new Date().toISOString();
        const created: StoredFolder = {
          id: request.folderId,
          owner_id: userId,
          name: request.name,
          design_ids: [],
          created_at: now,
          updated_at: now,
        };
        transaction.set(ref, created);
        return publicFolder(created);
      }
      if (!existing) throw new DesignRequestError("This folder was not found.", 404);
      if (request.action === "deleteFolder") {
        transaction.delete(ref);
        return { id: existing.id, deleted: true };
      }
      const updated_at = new Date().toISOString();
      if (request.action === "colorFolder") {
        const { color: _previous, ...rest } = existing;
        const colored: StoredFolder = request.color
          ? { ...rest, color: request.color, updated_at }
          : { ...rest, updated_at };
        transaction.set(ref, colored);
        return publicFolder(colored);
      }
      const renamed = { ...existing, name: request.name, updated_at };
      transaction.set(ref, renamed);
      return publicFolder(renamed);
    });
  }

  private encodeDocument(document: WorkspaceProject): string {
    const json = JSON.stringify(document);
    if (Buffer.byteLength(json, "utf8") > 500_000)
      throw new DesignRequestError("Saved designs must be smaller than 500 KB in UTF-8.", 400);
    return json;
  }

  private readVersion(snapshot: DocumentSnapshot) {
    const version = z
      .object({
        design_id: z.string().uuid(),
        revision: z.number().int().positive(),
        saved_at: z.string().datetime({ offset: true }),
        document_json: z.string(),
      })
      .strict()
      .parse(snapshot.data());
    return SavedDesignVersionSchema.parse({
      ...version,
      document: JSON.parse(version.document_json),
    });
  }

  private writeRevision(transaction: Transaction, stored: StoredDesign): void {
    const ref = this.database.collection("designs").doc(stored.id);
    transaction.set(ref, stored);
    transaction.create(ref.collection("versions").doc(String(stored.revision)), {
      design_id: stored.id,
      revision: stored.revision,
      document_json: stored.document_json,
      saved_at: stored.updated_at,
    });
  }
}
