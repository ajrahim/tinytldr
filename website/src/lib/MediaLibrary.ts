import {
  MEDIA_MIME_TYPES,
  MediaLibraryBeginSchema,
  MediaLibraryItemSchema,
  MediaLibraryOkSchema,
  MediaLibraryPageSchema,
  RenderedExportSchema,
  UPLOAD_CAPACITY_BYTES,
  type MediaLibraryItem,
  type MediaLibraryRequest,
  type RenderedMedia,
  type WorkspaceProject,
} from "@tinytldr/core";
import { z } from "zod";
import { fetchFirebaseService, requireFirebaseAuth } from "./FirebaseClient.js";

export { UPLOAD_CAPACITY_BYTES };
export type MediaSource = "export" | "upload";
export interface StoredMedia {
  metadata: RenderedMedia;
  file: Blob;
  poster: Blob;
  source: MediaSource;
  digest?: string;
}
const UPLOAD_FORMATS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export function uploadBytes(items: readonly MediaLibraryItem[]): number {
  return items.reduce(
    (total, item) => total + (item.source === "upload" ? item.metadata.bytes : 0),
    0,
  );
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
}
async function libraryUser(expectedUserId?: string | null): Promise<string> {
  const auth = requireFirebaseAuth();
  await auth.authStateReady();
  const uid = auth.currentUser?.uid;
  if (!uid || expectedUserId === null) throw new Error("Sign in to use My Library.");
  if (expectedUserId !== undefined && expectedUserId !== uid)
    throw new Error("Your account changed. Retry in the current account.");
  return uid;
}
async function requestMedia(request: MediaLibraryRequest, userId: string, signal?: AbortSignal) {
  const endpoint = import.meta.env.VITE_TINYTLDR_FIREBASE_MEDIA_URL as string | undefined;
  if (!endpoint)
    throw new Error(
      "Firebase media storage is not configured. Set VITE_TINYTLDR_FIREBASE_MEDIA_URL and restart the website.",
    );
  const response = await fetchFirebaseService(endpoint, request, "media", signal, {
    requireSignIn: true,
    expectedUserId: userId,
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      error.success ? error.data.error : `Firebase media storage failed (HTTP ${response.status}).`,
    );
  }
  return response;
}
async function mediaJson<Output, Input>(
  request: MediaLibraryRequest,
  schema: z.ZodType<Output, z.ZodTypeDef, Input>,
  userId: string,
  signal?: AbortSignal,
): Promise<Output> {
  const response = await requestMedia(request, userId, signal);
  const envelope = z
    .object({ data: z.unknown() })
    .strict()
    .parse(await response.json());
  return schema.parse(envelope.data);
}
function changed() {
  window.dispatchEvent(new Event("tinytldr:media-saved"));
}
export async function readMediaLibrary(
  expectedUserId?: string | null,
  signal?: AbortSignal,
): Promise<MediaLibraryItem[]> {
  const userId = await libraryUser(expectedUserId);
  const items: MediaLibraryItem[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await mediaJson(
      { action: "list", ...(cursor ? { cursor } : {}) },
      MediaLibraryPageSchema,
      userId,
      signal,
    );
    items.push(...page.items);
    cursor = page.cursor;
    if (cursor && cursors.has(cursor))
      throw new Error("Firebase returned a repeated library page. Retry opening My Library.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items.sort(
    (a, b) =>
      b.metadata.createdAt.localeCompare(a.metadata.createdAt) ||
      b.metadata.id.localeCompare(a.metadata.id),
  );
}
export async function readMediaBlob(
  item: MediaLibraryItem,
  kind: "file" | "poster",
  userId: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await requestMedia(
    { action: "read", id: item.metadata.id, kind },
    userId,
    signal,
  );
  const blob = await response.blob();
  if (
    blob.size !== (kind === "file" ? item.metadata.bytes : item.posterBytes) ||
    blob.type !== (kind === "file" ? MEDIA_MIME_TYPES[item.metadata.format] : "image/png")
  )
    throw new Error("Firebase returned an incomplete library file. Retry the download.");
  return blob;
}
export async function deleteMedia(id: string, expectedUserId?: string | null): Promise<void> {
  const userId = await libraryUser(expectedUserId);
  await mediaJson({ action: "delete", id }, MediaLibraryOkSchema, userId);
  changed();
}
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file for Firebase upload."));
    reader.onload = () => {
      if (typeof reader.result !== "string")
        reject(new Error("Could not encode the file for Firebase upload."));
      else resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}
async function sha256(blob: Blob): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function saveMediaBatch(
  files: readonly StoredMedia[],
  expectedUserId?: string | null,
  signal?: AbortSignal,
): Promise<number> {
  const userId = await libraryUser(expectedUserId);
  const items = await Promise.all(
    files.map(async (file) => {
      if (
        file.file.size !== file.metadata.bytes ||
        file.file.type !== MEDIA_MIME_TYPES[file.metadata.format] ||
        file.poster.type !== "image/png"
      )
        throw new Error("The library file or thumbnail is incomplete. Nothing was saved.");
      return MediaLibraryItemSchema.parse({
        metadata: file.metadata,
        source: file.source,
        digest: await sha256(file.file),
        posterBytes: file.poster.size,
      });
    }),
  );
  const batchId = crypto.randomUUID();
  try {
    const batch = await mediaJson(
      { action: "begin", batchId, items },
      MediaLibraryBeginSchema,
      userId,
      signal,
    );
    if (batch.state === "duplicate") return 0;
    if (batch.state === "pending") {
      for (const file of files)
        await mediaJson(
          {
            action: "put",
            batchId,
            id: file.metadata.id,
            file: await base64(file.file),
            poster: await base64(file.poster),
          },
          MediaLibraryOkSchema,
          userId,
          signal,
        );
      await mediaJson({ action: "commit", batchId }, MediaLibraryOkSchema, userId, signal);
    }
    changed();
    return items.length;
  } catch (error) {
    try {
      await mediaJson({ action: "cancel", batchId }, MediaLibraryOkSchema, userId);
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} Upload cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      );
    } finally {
      changed();
    }
    throw error;
  }
}
async function describeImage(file: Blob): Promise<{ width: number; height: number; poster: Blob }> {
  const image = await createImageBitmap(file);
  try {
    const { width, height } = image;
    const scale = Math.min(1, 512 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not create a library thumbnail.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const poster = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not create the library thumbnail. Nothing was saved."));
      }, "image/png"),
    );
    return { width, height, poster };
  } finally {
    image.close();
  }
}
export async function retainRenderedExport(
  result: z.infer<typeof RenderedExportSchema>,
  document: WorkspaceProject,
  sourcePath: string,
  signal: AbortSignal,
  fetchAsset: (url: string) => Promise<Response> = (url) => fetch(url, { signal }),
  expectedUserId?: string | null,
): Promise<number> {
  const userId = await libraryUser(expectedUserId);
  const posterResponse = await fetch(result.previewDataUrl, { signal });
  const poster = (await describeImage(await posterResponse.blob())).poster;
  const files = await Promise.all(
    result.assets.map(async (asset, index) => {
      const response = await fetchAsset(asset.url);
      if (!response.ok)
        throw new Error(
          `Could not retrieve ${asset.filename} (HTTP ${response.status}). Nothing was added to My Library.`,
        );
      const file = await response.blob();
      return {
        metadata: {
          id: crypto.randomUUID(),
          title: result.assets.length > 1 ? `${document.title} (${index + 1})` : document.title,
          filename: asset.filename,
          format: result.format,
          sourcePath,
          createdAt: new Date().toISOString(),
          width: result.width,
          height: result.height,
          bytes: file.size,
          ...(result.format === "pdf" && result.pageCount ? { pageCount: result.pageCount } : {}),
          ...((asset.durationMs ?? result.durationMs) !== undefined
            ? { durationMs: asset.durationMs ?? result.durationMs }
            : {}),
        },
        file,
        poster: file.type.startsWith("image/") ? (await describeImage(file)).poster : poster,
        source: "export" as const,
      };
    }),
  );
  signal.throwIfAborted();
  return saveMediaBatch(files, userId, signal);
}
export async function saveUploadedImage(
  file: File,
  sourcePath: string,
  expectedUserId?: string | null,
): Promise<boolean> {
  const userId = await libraryUser(expectedUserId);
  const format = UPLOAD_FORMATS[file.type as keyof typeof UPLOAD_FORMATS];
  if (!format) throw new Error(`${file.name} is not a PNG, JPEG, or WebP image.`);
  let described: Awaited<ReturnType<typeof describeImage>>;
  try {
    described = await describeImage(file);
  } catch {
    throw new Error(`My Library could not read ${file.name} as an image.`);
  }
  const count = await saveMediaBatch(
    [
      {
        metadata: {
          id: crypto.randomUUID(),
          title:
            file.name
              .replace(/\.[^.]+$/, "")
              .trim()
              .slice(0, 200) || "Upload",
          filename: file.name,
          format,
          sourcePath,
          createdAt: new Date().toISOString(),
          width: described.width,
          height: described.height,
          bytes: file.size,
        },
        file,
        poster: described.poster,
        source: "upload",
      },
    ],
    userId,
  );
  return count > 0;
}
