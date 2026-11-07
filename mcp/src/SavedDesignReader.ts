import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import {
  DeletedDesignRecordSchema,
  HOSTED_MCP_DESIGN_LIST_LIMIT,
  StoredDesignRecordSchema,
  savedDesignFromRecord,
  type SavedWorkspaceDesign,
} from "@tinytldr/core";

export class SavedDesignNotFoundError extends Error {
  constructor() {
    super("Saved design not found. Call list_designs for the IDs available to this account.");
    this.name = "SavedDesignNotFoundError";
  }
}

function readOwnedDesign(
  snapshot: DocumentSnapshot,
  ownerId: string,
): SavedWorkspaceDesign | undefined {
  if (!snapshot.exists || DeletedDesignRecordSchema.safeParse(snapshot.data()).success)
    return undefined;
  const stored = StoredDesignRecordSchema.parse(snapshot.data());
  if (stored.owner_id !== ownerId) return undefined;
  return savedDesignFromRecord(stored);
}

/** Read-only, owner-scoped access to website designs in the default Firestore database. */
export class SavedDesignReader {
  constructor(private readonly database: Firestore) {}

  async list(ownerId: string): Promise<SavedWorkspaceDesign[]> {
    const snapshots = await this.database
      .collection("designs")
      .where("owner_id", "==", ownerId)
      .orderBy("updated_at", "desc")
      .limit(HOSTED_MCP_DESIGN_LIST_LIMIT)
      .get();
    return snapshots.docs.flatMap((snapshot) => {
      const design = readOwnedDesign(snapshot, ownerId);
      return design ? [design] : [];
    });
  }

  async get(ownerId: string, designId: string): Promise<SavedWorkspaceDesign> {
    const snapshot = await this.database.collection("designs").doc(designId).get();
    const design = readOwnedDesign(snapshot, ownerId);
    if (!design) throw new SavedDesignNotFoundError();
    return design;
  }
}
