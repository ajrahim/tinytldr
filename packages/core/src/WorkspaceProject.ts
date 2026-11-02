import { z } from "zod";
import { CustomSizeInputSchema, SizePresetIdSchema } from "./SizePresets.js";
import { WorkspaceDocumentSchema, type WorkspaceDocument } from "./WorkspaceDocument.js";

export const MAX_WORKSPACE_PAGES = 20;
export const WorkspaceArtboardSchema = WorkspaceDocumentSchema.innerType()
  .omit({ version: true, size: true })
  .extend({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/),
    description: z.string().max(2000).default(""),
  })
  .strict();
export type WorkspaceArtboard = z.infer<typeof WorkspaceArtboardSchema>;

export function artboardDocument(
  page: WorkspaceArtboard,
  size: WorkspaceDocument["size"],
): WorkspaceDocument {
  return {
    version: 1,
    title: page.title,
    template: page.template,
    data: page.data,
    size,
    theme: page.theme,
    tokenOverrides: page.tokenOverrides,
  };
}

export const WorkspaceProjectSchema = z
  .object({
    version: z.literal(2),
    title: z.string().trim().min(1).max(120),
    size: z.union([SizePresetIdSchema, CustomSizeInputSchema]),
    pages: z.array(WorkspaceArtboardSchema).min(1).max(MAX_WORKSPACE_PAGES),
  })
  .strict()
  .superRefine((project, ctx) => {
    const ids = new Set<string>();
    project.pages.forEach((page, index) => {
      if (ids.has(page.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pages", index, "id"],
          message: "Page IDs must be unique.",
        });
      ids.add(page.id);
      const checked = WorkspaceDocumentSchema.safeParse(artboardDocument(page, project.size));
      if (!checked.success)
        for (const issue of checked.error.issues)
          ctx.addIssue({ ...issue, path: ["pages", index, ...issue.path] });
    });
    if (JSON.stringify(project).length > 400_000)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Designs must be smaller than 400 KB.",
      });
  });
export type WorkspaceProject = z.infer<typeof WorkspaceProjectSchema>;

export function projectFromDocument(document: WorkspaceDocument): WorkspaceProject {
  const { version: _version, size, title, ...content } = document;
  return {
    version: 2,
    title,
    size,
    pages: [{ ...content, id: "page-1", title: "Page 1", description: "" }],
  };
}

export const WorkspaceDesignDocumentSchema = WorkspaceProjectSchema;

export const SavedWorkspaceDesignSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().min(1).max(128).nullable(),
  document: WorkspaceDesignDocumentSchema,
  revision: z.number().int().positive(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type SavedWorkspaceDesign = z.infer<typeof SavedWorkspaceDesignSchema>;

export const DESIGN_VERSION_PAGE_SIZE = 20;
export const DesignVersionSummarySchema = z.object({
  revision: z.number().int().positive(),
  saved_at: z.string().datetime({ offset: true }),
});
export const DesignVersionPageSchema = z.object({
  versions: z.array(DesignVersionSummarySchema).max(DESIGN_VERSION_PAGE_SIZE),
  next_before: z.number().int().positive().nullable(),
});
export const SavedDesignVersionSchema = DesignVersionSummarySchema.extend({
  design_id: z.string().uuid(),
  document: WorkspaceDesignDocumentSchema,
});
export type DesignVersionPage = z.infer<typeof DesignVersionPageSchema>;
export type SavedDesignVersion = z.infer<typeof SavedDesignVersionSchema>;
