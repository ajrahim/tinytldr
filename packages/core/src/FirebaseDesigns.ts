import { z } from "zod";
import {
  SavedWorkspaceDesignSchema,
  WorkspaceProjectSchema,
  type SavedWorkspaceDesign,
} from "./WorkspaceProject.js";

export {
  DESIGN_VERSION_PAGE_SIZE,
  SavedWorkspaceDesignSchema,
  SavedDesignVersionSchema,
  type SavedWorkspaceDesign,
  type WorkspaceProject,
} from "./WorkspaceProject.js";

const id = z.string().uuid();
const editKey = z.string().regex(/^[0-9a-f]{64}$/);
const revision = z.number().int().positive();
export const DesignTitleSchema = WorkspaceProjectSchema.innerType().shape.title;
export const FirebaseDesignDeletionSchema = z.object({ id, deleted: z.literal(true) }).strict();

export const DESIGN_FOLDER_LIMIT = 100;
export const DESIGN_FOLDER_SIZE_LIMIT = 500;
export const DesignFolderNameSchema = z.string().trim().min(1).max(60);
export const DESIGN_FOLDER_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;
export const DesignFolderColorSchema = z.enum(DESIGN_FOLDER_COLORS);
export type DesignFolderColor = z.infer<typeof DesignFolderColorSchema>;
/** Account folder: an ordered name plus design IDs. Membership never changes the designs. */
export const DesignFolderSchema = z
  .object({
    id,
    name: DesignFolderNameSchema,
    /** Absent means the default, uncolored folder. */
    color: DesignFolderColorSchema.optional(),
    design_ids: id.array().max(DESIGN_FOLDER_SIZE_LIMIT),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type DesignFolder = z.infer<typeof DesignFolderSchema>;
export const StoredDesignFolderSchema = DesignFolderSchema.extend({ owner_id: z.string().min(1) });
export type StoredDesignFolder = z.infer<typeof StoredDesignFolderSchema>;

export const FirebaseDesignRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get"), id }).strict(),
  z
    .object({
      action: z.literal("save"),
      id,
      document: WorkspaceProjectSchema,
      editKey: editKey.nullable(),
      revision: revision.optional(),
    })
    .strict(),
  z.object({ action: z.literal("claim"), id, editKey, revision: revision.optional() }).strict(),
  z
    .object({
      action: z.literal("rename"),
      id,
      editKey: editKey.nullable(),
      revision,
      title: DesignTitleSchema,
    })
    .strict(),
  z.object({ action: z.literal("delete"), id, editKey: editKey.nullable(), revision }).strict(),
  z.object({ action: z.literal("list") }).strict(),
  z
    .object({
      action: z.literal("versions"),
      id,
      editKey: editKey.nullable(),
      before: revision.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("version"),
      id,
      editKey: editKey.nullable(),
      revision,
    })
    .strict(),
  z.object({ action: z.literal("folders") }).strict(),
  z
    .object({ action: z.literal("createFolder"), folderId: id, name: DesignFolderNameSchema })
    .strict(),
  z
    .object({ action: z.literal("renameFolder"), folderId: id, name: DesignFolderNameSchema })
    .strict(),
  z
    .object({
      action: z.literal("colorFolder"),
      folderId: id,
      /** Null restores the default color. */
      color: DesignFolderColorSchema.nullable(),
    })
    .strict(),
  z.object({ action: z.literal("deleteFolder"), folderId: id }).strict(),
  z
    .object({
      action: z.literal("moveToFolder"),
      id,
      /** Null removes the design from every folder, leaving it only in All. */
      folderId: id.nullable(),
    })
    .strict(),
]);
export type FirebaseDesignRequest = z.infer<typeof FirebaseDesignRequestSchema>;

export const StoredDesignRecordSchema = SavedWorkspaceDesignSchema.omit({ document: true })
  .extend({
    document_json: z.string(),
    guest_key_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
  })
  .strict()
  .refine((design) => (design.owner_id === null) === (design.guest_key_hash !== null));
export type StoredDesignRecord = z.infer<typeof StoredDesignRecordSchema>;
export const DeletedDesignRecordSchema = StoredDesignRecordSchema.innerType()
  .pick({ id: true, owner_id: true, guest_key_hash: true, revision: true })
  .extend({ deleted_at: z.string().datetime({ offset: true }) })
  .strict();

export function savedDesignFromRecord(stored: StoredDesignRecord): SavedWorkspaceDesign {
  return SavedWorkspaceDesignSchema.parse({
    id: stored.id,
    owner_id: stored.owner_id,
    document: JSON.parse(stored.document_json),
    revision: stored.revision,
    created_at: stored.created_at,
    updated_at: stored.updated_at,
  });
}
export const FirebaseDesignErrorSchema = z.object({ error: z.string().min(1) }).strict();
