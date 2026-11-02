import { z } from "zod";
import { SizeSpecSchema } from "./SizePresets.js";
import { RenderedExportSchema, WorkspaceRenderToolSchema } from "./RenderedMedia.js";

export const HostedRenderedExportSchema = RenderedExportSchema.omit({ previewDataUrl: true })
  .extend({
    bytes: z.number().int().nonnegative(),
    nextStep: z.string().min(1),
  })
  .strict();

export const ValidatePostToolSchema = z.object({
  templateId: z.string().min(1).describe("Template ID to validate against."),
  data: z.record(z.string(), z.unknown()).describe("Slot key/value payload to validate."),
  size: SizeSpecSchema.optional().describe(
    "Optional size preset ID (e.g. 'square', 'portrait', 'x') or custom { width, height }.",
  ),
  theme: z.string().optional().describe("Optional theme name."),
});

export const PreviewPostToolSchema = z.object({
  templateId: z.string().min(1).describe("Template ID to preview."),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Slot data payload (defaults to template sampleData if omitted)."),
  size: SizeSpecSchema.optional().describe("Size preset ID or custom { width, height }."),
  theme: z.string().optional().describe("Theme name."),
  pageOrTimestamp: z
    .number()
    .finite()
    .optional()
    .describe("Timestamp in ms for video templates or page index for carousels."),
});

export const RenderPostToolSchema = z.object({
  templateId: z.string().min(1).describe("Template ID to render."),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Slot data payload (defaults to template sampleData if omitted)."),
  size: SizeSpecSchema.optional().describe("Size preset ID or custom { width, height }."),
  theme: z.string().optional().describe("Theme name."),
  format: z
    .enum(["png", "jpg", "webp", "pdf", "mp4"])
    .optional()
    .describe("Output format (default: 'png')."),
  scale: z
    .union([z.literal(1), z.literal(2)])
    .optional()
    .describe("Device scale factor for static images (1 or 2)."),
  fps: z
    .number()
    .int()
    .min(12)
    .max(60)
    .optional()
    .describe("Frames per second for mp4 video output (default: 30)."),
  outputPath: z
    .string()
    .min(1)
    .describe("Destination file path on disk for the rendered artifact."),
});

export const HostedRenderPostToolSchema = RenderPostToolSchema.omit({ outputPath: true }).strict();
export const HostedWorkspaceRenderToolSchema = WorkspaceRenderToolSchema.omit({
  outputPath: true,
}).strict();
export type RenderPostToolInput = z.infer<typeof RenderPostToolSchema>;
