import { z } from "zod";
import { WorkspaceProjectSchema } from "./WorkspaceProject.js";

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
]);
export type FirebaseDesignRequest = z.infer<typeof FirebaseDesignRequestSchema>;
export const FirebaseDesignErrorSchema = z.object({ error: z.string().min(1) }).strict();
