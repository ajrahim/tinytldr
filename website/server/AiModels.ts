import { z } from "zod";
import { AiModelSchema, AiModelsSchema } from "@tinytldr/core/ai";
import {
  AiRequestError,
  fetchAiProvider,
  providerBaseUrl,
  readAiJson,
  type ProviderCredentials,
} from "./AiProviders.ts";

const OpenAiPageSchema = z.object({
  data: z
    .array(z.object({ id: z.string(), shutdown_date: z.string().nullable().optional() }))
    .max(5000),
});
const ClaudePageSchema = z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string() })).max(1000),
  has_more: z.boolean(),
  last_id: z.string().max(120).nullable(),
});
const GeminiPageSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        displayName: z.string().optional(),
        supportedGenerationMethods: z.array(z.string()),
      }),
    )
    .max(1000),
  nextPageToken: z.string().max(2048).optional(),
});

function modelMetadata(id: string, name: string) {
  const result = AiModelSchema.safeParse({ id, name });
  if (!result.success)
    throw new AiRequestError(
      502,
      "models",
      "The provider returned invalid model identifiers or names.",
    );
  return result.data;
}

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted)
    throw new AiRequestError(408, "cancelled", "Model discovery was cancelled or timed out.");
}

export async function listProviderModels(options: {
  secret: ProviderCredentials;
  allowedCustomUrls: readonly string[];
  fetch: typeof fetch;
  signal: AbortSignal;
}) {
  const { secret, signal } = options;
  const base = providerBaseUrl(secret.provider, secret.base_url, options.allowedCustomUrls);
  const headers: Record<string, string> = {};
  if (secret.provider === "anthropic") {
    headers["x-api-key"] = secret.api_key;
    headers["anthropic-version"] = "2023-06-01";
  } else if (secret.provider === "gemini") headers["x-goog-api-key"] = secret.api_key;
  else headers.Authorization = `Bearer ${secret.api_key}`;
  const models: z.infer<typeof AiModelSchema>[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    checkCancelled(signal);
    const url = new URL(`${base}/models`);
    if (secret.provider === "anthropic") {
      url.searchParams.set("limit", "1000");
      if (cursor) url.searchParams.set("after_id", cursor);
    } else if (secret.provider === "gemini") {
      url.searchParams.set("pageSize", "1000");
      if (cursor) url.searchParams.set("pageToken", cursor);
    }
    const response = await fetchAiProvider(options.fetch, url.toString(), {
      method: "GET",
      headers,
      signal,
    });
    let payload: unknown;
    try {
      payload = await readAiJson(response.body, 2_000_000);
    } catch (error) {
      checkCancelled(signal);
      if (!(error instanceof AiRequestError)) throw error;
      throw new AiRequestError(
        502,
        "models",
        "The provider returned an invalid or oversized model list.",
      );
    }
    checkCancelled(signal);
    let next: string | undefined;
    if (secret.provider === "anthropic") {
      const result = ClaudePageSchema.safeParse(payload);
      if (!result.success)
        throw new AiRequestError(502, "models", "The provider returned an invalid model list.");
      for (const model of result.data.data)
        models.push(modelMetadata(model.id, model.display_name));
      next = result.data.has_more ? (result.data.last_id ?? undefined) : undefined;
      if (result.data.has_more && !next)
        throw new AiRequestError(502, "models", "The provider returned an incomplete model list.");
    } else if (secret.provider === "gemini") {
      const result = GeminiPageSchema.safeParse(payload);
      if (!result.success)
        throw new AiRequestError(502, "models", "The provider returned an invalid model list.");
      for (const model of result.data.models) {
        if (!model.supportedGenerationMethods.includes("generateContent")) continue;
        if (!/^models\/gemini-/.test(model.name) || /image|tts|audio|robotics/i.test(model.name))
          continue;
        const id = model.name.replace(/^models\//, "");
        models.push(modelMetadata(id, model.displayName ?? id));
      }
      next = result.data.nextPageToken;
    } else {
      const result = OpenAiPageSchema.safeParse(payload);
      if (!result.success)
        throw new AiRequestError(502, "models", "The provider returned an invalid model list.");
      for (const model of result.data.data) {
        if (
          secret.provider === "openai" &&
          (!/^(gpt-|chatgpt-|o[1-9](?:[-.]|$))/.test(model.id) ||
            /audio|realtime|transcrib|tts|embedding|image|codex|search|(?:^|-)pro(?:[-.]|$)/.test(
              model.id,
            ))
        )
          continue;
        if (model.shutdown_date && Date.parse(model.shutdown_date) <= Date.now()) continue;
        models.push(modelMetadata(model.id, model.id));
      }
    }
    if (models.length > 500)
      throw new AiRequestError(
        502,
        "models",
        "The provider model list exceeds the supported limit.",
      );
    if (!next) {
      const unique = [...new Map(models.map((model) => [model.id, model])).values()];
      if (!unique.length)
        throw new AiRequestError(
          502,
          "models",
          "The provider returned no compatible text-generation models.",
        );
      return AiModelsSchema.parse(unique);
    }
    if (cursors.has(next))
      throw new AiRequestError(502, "models", "The provider repeated its model-list cursor.");
    cursors.add(next);
    cursor = next;
  }
  throw new AiRequestError(
    502,
    "models",
    "The provider model list did not finish within the supported page limit.",
  );
}
