import { z } from "zod";
import { CustomSizeInputSchema, SizePresetIdSchema } from "./SizePresets.js";
import { TemplateManifestSchema, ThemeTokensSchema } from "./TemplateManifest.js";

export const WorkspaceTemplateSchema = z
  .object({
    manifest: TemplateManifestSchema,
    liquidTemplate: z.string().min(1).max(100_000),
    stylesCss: z.string().max(100_000),
  })
  .strict();

export const WorkspaceDocumentSchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1).max(120),
    template: WorkspaceTemplateSchema,
    data: z.record(z.string(), z.unknown()),
    size: z.union([SizePresetIdSchema, CustomSizeInputSchema]),
    theme: z.string().min(1),
    tokenOverrides: ThemeTokensSchema.omit({ name: true }).partial().strict(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (!doc.template.manifest.themes[doc.theme]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["theme"],
        message: "Choose a theme declared in the template.",
      });
    }
    if (typeof doc.size === "string" && !doc.template.manifest.supportedSizes.includes(doc.size)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["size"],
        message: "Choose a size supported by the template.",
      });
    }
    if (JSON.stringify(doc).length > 400_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Designs must be smaller than 400 KB.",
      });
    }
  });

export type WorkspaceDocument = z.infer<typeof WorkspaceDocumentSchema>;
