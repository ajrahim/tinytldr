import { z } from "zod";
import {
  MAX_WORKSPACE_PAGES,
  WorkspaceProjectSchema,
  type WorkspaceProject,
} from "./WorkspaceProject.js";
export { WorkspaceProjectSchema } from "./WorkspaceProject.js";

export const AI_MAX_CONTEXT_ITEMS = 4;
export const AI_MAX_IMAGE_BYTES = 2_000_000;
export const AI_MAX_TOTAL_IMAGE_BYTES = 4_000_000;
export const AI_MAX_TEXT_CHARACTERS = 64_000;
export const AiProviderSchema = z.enum(["openai", "anthropic", "gemini", "custom"]);
export type AiProvider = z.infer<typeof AiProviderSchema>;
export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  gemini: "Gemini",
  custom: "OpenAI-compatible",
};
export const AI_PROVIDER_BASE_URLS: Record<Exclude<AiProvider, "custom">, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};
const modelId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export const AiModelSchema = z.object({ id: modelId, name: z.string().min(1).max(200) }).strict();
export const AiModelsSchema = z.array(AiModelSchema).min(1).max(500);
export type AiModel = z.infer<typeof AiModelSchema>;
export const AiConnectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
  provider: AiProviderSchema,
  base_url: z.string().url(),
  model: modelId.nullable(),
  model_name: z.string().min(1).max(200).nullable(),
  models: AiModelsSchema,
  key_suffix: z.string().min(1).max(4),
  is_default: z.boolean(),
  updated_at: z.string().datetime({ offset: true }),
});
export type AiConnection = z.infer<typeof AiConnectionSchema>;
export const AiProviderConnectionInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    provider: AiProviderSchema,
    baseUrl: z.string().url().max(2048),
    apiKey: z
      .string()
      .trim()
      .min(8)
      .max(8192)
      .regex(/^[!-~]+$/),
  })
  .strict();
export type AiProviderConnectionInput = z.infer<typeof AiProviderConnectionInputSchema>;

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const imageContext = z
  .object({
    kind: z.literal("image"),
    name: z.string().min(1).max(120),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(AI_MAX_IMAGE_BYTES / 3) * 4)
      .regex(base64Pattern),
  })
  .strict();
const textContext = z
  .object({
    kind: z.literal("text"),
    name: z.string().trim().min(1).max(120),
    text: z.string().min(1).max(32_000),
  })
  .strict();
export const AiContextSchema = z.discriminatedUnion("kind", [imageContext, textContext]);
export type AiContext = z.infer<typeof AiContextSchema>;
export const AiContextItemsSchema = z
  .array(AiContextSchema)
  .max(AI_MAX_CONTEXT_ITEMS)
  .superRefine((items, ctx) => {
    let textLength = 0;
    let imageBytes = 0;
    items.forEach((item, index) => {
      if (item.kind === "text") {
        textLength += item.text.length;
        return;
      }
      if (!base64Pattern.test(item.base64)) return;
      const raw = atob(item.base64);
      imageBytes += raw.length;
      const png = raw.startsWith("\x89PNG\r\n\x1a\n");
      const jpeg = raw.startsWith("\xff\xd8\xff");
      const webp = raw.startsWith("RIFF") && raw.slice(8, 12) === "WEBP";
      if (
        raw.length > AI_MAX_IMAGE_BYTES ||
        !(item.mimeType === "image/png" ? png : item.mimeType === "image/jpeg" ? jpeg : webp)
      )
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: "Use a valid PNG, JPEG, or WebP image up to 2 MB.",
        });
    });
    if (imageBytes > AI_MAX_TOTAL_IMAGE_BYTES || textLength > AI_MAX_TEXT_CHARACTERS)
      ctx.addIssue({
        code: "custom",
        message: "Context is limited to 4 MB of images and 64,000 text characters.",
      });
  });
export const AiGenerationInputSchema = z
  .object({
    connectionId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(8000),
    document: WorkspaceProjectSchema,
    targetPageIds: z.array(z.string().min(1).max(64)).max(20),
    context: AiContextItemsSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    const targets = new Set(request.targetPageIds);
    if (
      targets.size !== request.targetPageIds.length ||
      [...targets].some((id) => !request.document.pages.some((page) => page.id === id))
    )
      ctx.addIssue({
        code: "custom",
        path: ["targetPageIds"],
        message: "Choose existing, unique artboards.",
      });
  });
export type AiGenerationInput = z.infer<typeof AiGenerationInputSchema>;
export const AiGatewayRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("generate"), request: AiGenerationInputSchema }).strict(),
  z.object({ action: z.literal("connect"), connection: AiProviderConnectionInputSchema }).strict(),
  z.object({ action: z.literal("models"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("model"), id: z.string().uuid(), model: modelId }).strict(),
]);
export type AiGatewayRequest = z.infer<typeof AiGatewayRequestSchema>;
export const AiConnectionsResponseSchema = z
  .object({ connections: z.array(AiConnectionSchema).max(1) })
  .strict();
export const AiGenerationResponseSchema = z.object({ document: WorkspaceProjectSchema }).strict();
export const AiGatewayErrorSchema = z
  .object({ error: z.string().max(500), code: z.string().max(60) })
  .strict();

export function mergeAiGeneration(
  original: WorkspaceProject,
  generated: WorkspaceProject,
  targetPageIds: readonly string[],
): WorkspaceProject {
  const checked = WorkspaceProjectSchema.parse(generated);
  if (!targetPageIds.length) return checked;
  const targets = new Set(targetPageIds);
  const originalIds = new Set(original.pages.map((page) => page.id));
  if (
    checked.title !== original.title ||
    [...targets].some((id) => !checked.pages.some((page) => page.id === id)) ||
    checked.pages.some((page) => originalIds.has(page.id) && !targets.has(page.id))
  )
    throw new Error(
      "The provider changed content outside the selected artboards. Nothing was applied.",
    );
  // New pages are inserted after the last selected artboard; a new size applies project-wide.
  const added = checked.pages.filter((page) => !originalIds.has(page.id));
  const pages = original.pages.map(
    (page) => checked.pages.find((next) => next.id === page.id) ?? page,
  );
  const insertAt =
    Math.max(...original.pages.map((page, index) => (targets.has(page.id) ? index : -1))) + 1;
  pages.splice(insertAt, 0, ...added);
  if (pages.length > MAX_WORKSPACE_PAGES)
    throw new Error(`Designs are limited to ${MAX_WORKSPACE_PAGES} pages. Nothing was applied.`);
  const merged = WorkspaceProjectSchema.safeParse({ ...original, size: checked.size, pages });
  if (merged.success) return merged.data;
  if (merged.error.issues.some((issue) => issue.message === "Designs must be smaller than 400 KB."))
    throw merged.error;
  throw new Error(
    "The new size is not supported by the unselected artboards. Choose All artboards to resize the whole design. Nothing was applied.",
  );
}
