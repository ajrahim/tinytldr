import {
  SavedWorkspaceDesignSchema,
  DesignVersionPageSchema,
  SavedDesignVersionSchema,
  WorkspaceProjectSchema,
  FirebaseDesignDeletionSchema,
  DesignFolderSchema,
  type WorkspaceProject,
} from "@tinytldr/core";
import { callFirebaseDesign } from "./FirebaseClient.js";

export interface DesignListTarget {
  id: string;
  title: string;
  saved: boolean;
  editKey: string | null;
  revision?: number;
}

export type DesignListMutation =
  { action: "claim" } | { action: "rename"; title: string } | { action: "delete" };

export function createPrivateEditKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getSavedDesign(id: string) {
  return callFirebaseDesign({ action: "get", id }, SavedWorkspaceDesignSchema);
}

export async function saveDesign(options: {
  id: string;
  document: WorkspaceProject;
  editKey: string | null;
  revision?: number;
  expectedUserId?: string;
}) {
  const document = WorkspaceProjectSchema.parse(options.document);
  return callFirebaseDesign(
    {
      action: "save",
      id: options.id,
      document,
      editKey: options.editKey,
      revision: options.revision,
    },
    SavedWorkspaceDesignSchema,
    options.expectedUserId,
  );
}

export async function claimDesign(id: string, editKey: string, revision?: number) {
  return callFirebaseDesign({ action: "claim", id, editKey, revision }, SavedWorkspaceDesignSchema);
}

export async function renameSavedDesign(target: DesignListTarget, title: string) {
  if (target.revision === undefined)
    throw new Error("Open this design to load its revision first.");
  return callFirebaseDesign(
    { action: "rename", id: target.id, editKey: target.editKey, revision: target.revision, title },
    SavedWorkspaceDesignSchema,
  );
}

export async function deleteSavedDesign(target: DesignListTarget) {
  if (target.revision === undefined)
    throw new Error("Open this design to load its revision first.");
  return callFirebaseDesign(
    { action: "delete", id: target.id, editKey: target.editKey, revision: target.revision },
    FirebaseDesignDeletionSchema,
  );
}

export async function listAccountDesigns() {
  return callFirebaseDesign({ action: "list" }, SavedWorkspaceDesignSchema.array());
}

export async function listDesignVersions(id: string, editKey: string | null, before?: number) {
  return callFirebaseDesign({ action: "versions", id, editKey, before }, DesignVersionPageSchema);
}

export async function getDesignVersion(id: string, revision: number, editKey: string | null) {
  return callFirebaseDesign({ action: "version", id, revision, editKey }, SavedDesignVersionSchema);
}

const DesignFolderListSchema = DesignFolderSchema.array();

export async function listDesignFolders() {
  return callFirebaseDesign({ action: "folders" }, DesignFolderListSchema);
}

export async function createDesignFolder(name: string) {
  return callFirebaseDesign(
    { action: "createFolder", folderId: crypto.randomUUID(), name },
    DesignFolderSchema,
  );
}

export async function renameDesignFolder(folderId: string, name: string) {
  return callFirebaseDesign({ action: "renameFolder", folderId, name }, DesignFolderSchema);
}

export async function deleteDesignFolder(folderId: string) {
  return callFirebaseDesign({ action: "deleteFolder", folderId }, FirebaseDesignDeletionSchema);
}

export async function moveDesignToFolder(id: string, folderId: string | null) {
  return callFirebaseDesign({ action: "moveToFolder", id, folderId }, DesignFolderListSchema);
}
