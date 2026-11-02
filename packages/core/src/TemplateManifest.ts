import { z } from "zod";
import { SizePresetIdSchema } from "./SizePresets.js";

export const TemplateKindSchema = z.enum(["static", "carousel", "video"]);
export type TemplateKind = z.infer<typeof TemplateKindSchema>;

export const SlotTypeSchema = z.enum([
  "string",
  "string[]",
  "number",
  "enum",
  "code",
  "image",
  "boolean",
  "slides",
  "object[]",
]);
export type SlotType = z.infer<typeof SlotTypeSchema>;

export const AutofitConfigSchema = z.object({
  minFontPx: z.number().int().min(8).max(160),
  maxFontPx: z.number().int().min(10).max(240),
  maxLines: z.number().int().min(1).max(30).optional(),
});
export type AutofitConfig = z.infer<typeof AutofitConfigSchema>;

export const ObjectItemFieldSchema = z.object({
  type: z.enum(["string", "number", "boolean"]).default("string"),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(true),
  maxLength: z.number().int().positive().optional(),
});

export const SlotDefinitionSchema = z.object({
  type: SlotTypeSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().default(true),
  maxLength: z.number().int().positive().optional(),
  recommendedMaxLength: z.number().int().positive().optional(),
  maxLines: z.number().int().positive().optional(),
  minItems: z.number().int().min(0).optional(),
  maxItems: z.number().int().positive().optional(),
  enumValues: z.array(z.string().min(1)).optional(),
  itemSchema: z.record(z.string().min(1), ObjectItemFieldSchema).optional(),
  defaultValue: z.unknown().optional(),
  autofit: AutofitConfigSchema.optional(),
});
export type SlotDefinition = z.infer<typeof SlotDefinitionSchema>;

export const ThemeTokensSchema = z.object({
  name: z.string().min(1),
  background: z.string().min(1),
  surface: z.string().min(1),
  surfaceElevated: z.string().min(1),
  textPrimary: z.string().min(1),
  textSecondary: z.string().min(1),
  textMuted: z.string().min(1),
  accent: z.string().min(1),
  accentSecondary: z.string().min(1),
  border: z.string().min(1),
  badgeBg: z.string().min(1),
  badgeText: z.string().min(1),
  codeBg: z.string().min(1).optional(),
  codeText: z.string().min(1).optional(),
});
export type ThemeTokens = z.infer<typeof ThemeTokensSchema>;

export const TemplateManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    version: z.string().min(1),
    kind: TemplateKindSchema,
    description: z.string().min(1),
    distillationHint: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1),
    defaultSize: SizePresetIdSchema,
    supportedSizes: z.array(SizePresetIdSchema).min(1),
    durationMs: z.number().int().min(500).max(60000).optional(),
    fps: z.number().int().min(12).max(60).optional(),
    defaultTheme: z.string().min(1),
    themes: z.record(z.string().min(1), ThemeTokensSchema),
    slots: z.record(z.string().min(1), SlotDefinitionSchema),
    sampleData: z.record(z.string(), z.unknown()),
    author: z.string().min(1),
    license: z.literal("MIT"),
  })
  .superRefine((manifest, ctx) => {
    if (!manifest.themes[manifest.defaultTheme]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultTheme"],
        message: `defaultTheme '${manifest.defaultTheme}' must exist in themes.`,
      });
    }
    if (!manifest.supportedSizes.includes(manifest.defaultSize)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultSize"],
        message: `defaultSize '${manifest.defaultSize}' must be listed in supportedSizes.`,
      });
    }
    if (manifest.kind === "video" && !manifest.durationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMs"],
        message: "Video templates must specify durationMs.",
      });
    }
  });

export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

export interface TemplateBundle {
  manifest: TemplateManifest;
  liquidTemplate: string;
  stylesCss: string;
}
