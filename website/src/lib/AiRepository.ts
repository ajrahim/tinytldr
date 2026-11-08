import { z } from "zod";
import {
  AiConnectionsResponseSchema,
  AiGenerationInputSchema,
  AiGenerationResponseSchema,
  AiGatewayErrorSchema,
  type AiGatewayRequest,
  type AiGenerationInput,
  type AiProviderConnectionInput,
  type AiContext,
  AI_MAX_IMAGE_BYTES,
} from "@tinytldr/core";
import { fetchFirebaseService } from "./FirebaseClient.js";

const firebaseEndpoint = import.meta.env.VITE_TINYTLDR_FIREBASE_AI_URL as string | undefined;
export const AI_BACKEND_UNAVAILABLE_MESSAGE = !firebaseEndpoint
  ? "Firebase AI connections are not configured. Set VITE_TINYTLDR_FIREBASE_AI_URL to the deployed AI service and restart the website. Ordinary editing and saving remain available."
  : null;

async function call<Output, Input>(
  request: AiGatewayRequest,
  schema: z.ZodType<Output, z.ZodTypeDef, Input>,
  signal?: AbortSignal,
): Promise<Output> {
  if (AI_BACKEND_UNAVAILABLE_MESSAGE) throw new Error(AI_BACKEND_UNAVAILABLE_MESSAGE);
  if (!firebaseEndpoint) throw new Error("Firebase AI connections are not configured.");
  const response = await fetchFirebaseService(firebaseEndpoint, request, "AI", signal);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      [502, 503, 504].includes(response.status)
        ? `The AI service timed out or was interrupted (HTTP ${response.status}). Try again, or ask for fewer pages at once.`
        : `The Firebase AI service returned an invalid response (HTTP ${response.status}). Check its deployment.`,
    );
  }
  signal?.throwIfAborted();
  if (!response.ok) {
    const error = AiGatewayErrorSchema.safeParse(payload);
    throw new Error(
      error.success ? error.data.error : `Firebase AI operation failed (HTTP ${response.status}).`,
    );
  }
  const checked = schema.safeParse(payload);
  if (!checked.success)
    throw new Error("The AI service returned an invalid response. Nothing was applied.");
  return checked.data;
}

export async function listAiConnections(signal?: AbortSignal) {
  return (await call({ action: "list" }, AiConnectionsResponseSchema, signal)).connections;
}
export async function connectAiProvider(
  connection: AiProviderConnectionInput,
  signal?: AbortSignal,
) {
  return (await call({ action: "connect", connection }, AiConnectionsResponseSchema, signal))
    .connections;
}
export async function refreshAiModels(id: string, signal?: AbortSignal) {
  return (await call({ action: "models", id }, AiConnectionsResponseSchema, signal)).connections;
}
export async function selectAiModel(id: string, model: string, signal?: AbortSignal) {
  return (await call({ action: "model", id, model }, AiConnectionsResponseSchema, signal))
    .connections;
}
export async function deleteAiConnection(id: string, signal?: AbortSignal) {
  return (await call({ action: "delete", id }, AiConnectionsResponseSchema, signal)).connections;
}
export async function generateAiDesign(request: AiGenerationInput, signal: AbortSignal) {
  const checked = AiGenerationInputSchema.parse(request);
  return (await call({ action: "generate", request: checked }, AiGenerationResponseSchema, signal))
    .document;
}

export async function readAiContextFile(file: File): Promise<AiContext> {
  if (["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    if (file.size > AI_MAX_IMAGE_BYTES)
      throw new Error("Each reference image must be 2 MB or smaller.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const mimeType = z.enum(["image/png", "image/jpeg", "image/webp"]).parse(file.type);
    return { kind: "image", name: file.name, mimeType, base64: btoa(binary) };
  }
  if (!/\.(txt|md|html|css|json)$/i.test(file.name))
    throw new Error("Attach PNG, JPEG, WebP, or a text, Markdown, HTML, CSS, or JSON file.");
  if (file.size > 64_000) throw new Error("Each text file must be 64 KB or smaller.");
  const text = await file.text();
  if (!text.trim() || text.length > 32_000)
    throw new Error("Each text context must contain 1-32,000 characters.");
  return { kind: "text", name: file.name, text };
}
