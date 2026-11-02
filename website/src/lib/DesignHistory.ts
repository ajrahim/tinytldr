import { z } from "zod";
import {
  SizePresetIdSchema,
  WorkspaceDocumentSchema,
  WorkspaceTemplateSchema,
  WorkspaceProjectSchema,
  WorkspaceArtboardSchema,
} from "@tinytldr/core";

export const DESIGN_HISTORY_KEY = "tinytldr:unclaimed-designs:v1";

const DraftDocumentSchema = WorkspaceDocumentSchema.innerType().extend({
  title: z.string().max(120),
  size: z.union([SizePresetIdSchema, z.object({ width: z.number(), height: z.number() })]),
  template: WorkspaceTemplateSchema.extend({ liquidTemplate: z.string().max(100_000) }),
});

const DraftProjectSchema = WorkspaceProjectSchema.innerType().extend({
  title: z.string().max(120),
  size: DraftDocumentSchema.shape.size,
  pages: WorkspaceArtboardSchema.extend({
    title: z.string().max(120),
    template: DraftDocumentSchema.shape.template,
  })
    .array()
    .min(1)
    .max(20),
});

export const WorkspaceRecoveryDocumentSchema = DraftProjectSchema;

export const PageJsonSchema = z.record(z.string().max(400_000));

export const LocalDesignSchema = z
  .object({
    id: z.string().uuid(),
    editKey: z.string().regex(/^[0-9a-f]{64}$/),
    saved: z.boolean(),
    revision: z.number().int().positive().optional(),
    updatedAt: z.string().datetime(),
    document: WorkspaceRecoveryDocumentSchema,
    pageJson: PageJsonSchema.optional(),
  })
  .strict();

export type LocalDesign = z.infer<typeof LocalDesignSchema>;
export type LocalDesignInput = z.input<typeof LocalDesignSchema>;

export function readDesignHistory(storage: Storage): LocalDesign[] {
  const raw = storage.getItem(DESIGN_HISTORY_KEY);
  if (!raw) return [];
  return LocalDesignSchema.array().parse(JSON.parse(raw));
}

export function rememberLocalDesign(storage: Storage, design: LocalDesignInput): LocalDesign[] {
  const checked = LocalDesignSchema.parse(design);
  const entries = [checked, ...readDesignHistory(storage).filter((item) => item.id !== checked.id)];
  storage.setItem(DESIGN_HISTORY_KEY, JSON.stringify(entries));
  return entries;
}

export function forgetLocalDesign(storage: Storage, id: string): LocalDesign[] {
  const entries = readDesignHistory(storage).filter((item) => item.id !== id);
  storage.setItem(DESIGN_HISTORY_KEY, JSON.stringify(entries));
  return entries;
}

export function renameLocalDesign(
  storage: Storage,
  id: string,
  title: string,
  revision?: number,
): LocalDesign[] {
  const entry = readDesignHistory(storage).find((design) => design.id === id);
  if (!entry) throw new Error("This browser draft was removed. Refresh your designs.");
  if (revision !== undefined && entry.revision !== undefined && entry.revision > revision)
    throw new Error("A newer browser revision exists. Its recovery has been left unchanged.");
  return rememberLocalDesign(storage, {
    ...entry,
    document: { ...entry.document, title },
    revision: revision ?? entry.revision,
    updatedAt: new Date().toISOString(),
  });
}
