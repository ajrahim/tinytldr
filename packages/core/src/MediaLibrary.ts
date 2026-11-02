import { z } from "zod";
import { RenderedMediaSchema } from "./RenderedMedia.js";

export const UPLOAD_CAPACITY_BYTES = 100 * 1024 * 1024;
export const MEDIA_FILE_MAX_BYTES = 20_000_000;
export const MEDIA_BATCH_MAX_BYTES = 50_000_000;
export const MEDIA_POSTER_MAX_BYTES = 1_000_000;
export const MediaLibraryItemSchema = z
  .object({
    metadata: RenderedMediaSchema.extend({ filename: z.string().min(1).max(255) }),
    source: z.enum(["upload", "export"]),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    posterBytes: z.number().int().positive().max(MEDIA_POSTER_MAX_BYTES),
  })
  .strict()
  .refine((item) => item.metadata.bytes <= MEDIA_FILE_MAX_BYTES, "The file exceeds 20 MB.")
  .refine(
    (item) => item.source !== "upload" || ["png", "jpg", "webp"].includes(item.metadata.format),
    "Uploads must be PNG, JPEG, or WebP images.",
  );
export type MediaLibraryItem = z.infer<typeof MediaLibraryItemSchema>;
const IdSchema = z.string().uuid();
const BatchSchema = z
  .array(MediaLibraryItemSchema)
  .min(1)
  .max(20)
  .refine(
    (items) => new Set(items.map((item) => item.metadata.id)).size === items.length,
    "File IDs must be unique.",
  )
  .refine(
    (items) => items.reduce((sum, item) => sum + item.metadata.bytes, 0) <= MEDIA_BATCH_MAX_BYTES,
    "The batch exceeds 50 MB.",
  )
  .refine(
    (items) => items.every((item) => item.source === "export") || items.length === 1,
    "Upload images individually.",
  );
const Base64Schema = z
  .string()
  .min(4)
  .max(28_000_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const MediaLibraryRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), batchId: IdSchema, items: BatchSchema }).strict(),
  z
    .object({
      action: z.literal("put"),
      batchId: IdSchema,
      id: IdSchema,
      file: Base64Schema,
      poster: Base64Schema,
    })
    .strict(),
  z.object({ action: z.literal("commit"), batchId: IdSchema }).strict(),
  z.object({ action: z.literal("cancel"), batchId: IdSchema }).strict(),
  z.object({ action: z.literal("list"), cursor: IdSchema.optional() }).strict(),
  z.object({ action: z.literal("delete"), id: IdSchema }).strict(),
  z.object({ action: z.literal("read"), id: IdSchema, kind: z.enum(["file", "poster"]) }).strict(),
]);
export type MediaLibraryRequest = z.infer<typeof MediaLibraryRequestSchema>;
export const MediaLibraryBeginSchema = z
  .object({
    state: z.enum(["pending", "ready", "duplicate"]),
    items: z.array(MediaLibraryItemSchema),
  })
  .strict();
export const MediaLibraryPageSchema = z
  .object({
    items: z.array(MediaLibraryItemSchema),
    cursor: IdSchema.optional(),
  })
  .strict();
export const MediaLibraryOkSchema = z.object({ ok: z.literal(true) }).strict();
