import { z } from "zod";
import { WorkspaceDesignDocumentSchema } from "./WorkspaceProject.js";
import { SizeSpecSchema } from "./SizePresets.js";

export const MediaFormatSchema = z.enum(["png", "jpg", "webp", "pdf", "mp4"]);
export type MediaFormat = z.infer<typeof MediaFormatSchema>;
const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Expected an HTTP(S) asset URL.");

export const WorkspaceRenderRequestSchema = z
  .object({
    document: WorkspaceDesignDocumentSchema.describe(
      "Authored version-2 design JSON with ordered pages, independent template/data/theme, titles and non-rendered purpose descriptions, and one shared size.",
    ),
    format: MediaFormatSchema.describe(
      "PNG/JPEG/WebP or MP4 files in page order; one multipage PDF.",
    ),
    scale: z
      .union([z.literal(1), z.literal(2)])
      .default(1)
      .describe("Image export resolution multiplier; does not change design dimensions."),
  })
  .strict();
export const WorkspaceRenderToolSchema = WorkspaceRenderRequestSchema.extend({
  outputPath: z
    .string()
    .min(1)
    .describe("Destination file path; page numbers are appended for image/video batches."),
});
export const TemplateRenderRequestSchema = z
  .object({
    templateId: z.string().min(1),
    data: z.record(z.unknown()).optional(),
    size: SizeSpecSchema.optional(),
    theme: z.string().optional(),
    format: MediaFormatSchema.optional(),
    scale: z.union([z.literal(1), z.literal(2)]).default(1),
  })
  .strict();
export const RenderRequestSchema = z.union([
  WorkspaceRenderRequestSchema,
  TemplateRenderRequestSchema,
]);

export const RenderedExportSchema = z.object({
  status: z.literal("completed"),
  format: MediaFormatSchema,
  assets: z
    .array(
      z.object({
        url: HttpUrlSchema,
        filename: z.string().min(1),
        durationMs: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
  previewDataUrl: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  pageCount: z.number().int().positive().optional(),
  durationMs: z.number().nonnegative().optional(),
  warnings: z.array(z.string()),
});

export const RenderedMediaSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(200),
    filename: z.string().min(1),
    format: MediaFormatSchema,
    sourcePath: z.string().regex(/^\/(?:d|local)\/[0-9a-f-]{36}$/i),
    createdAt: z.string().datetime(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
    pageCount: z.number().int().positive().optional(),
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();
export type RenderedMedia = z.infer<typeof RenderedMediaSchema>;

export const MEDIA_MIME_TYPES: Record<MediaFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  mp4: "video/mp4",
};
