import {
  AiConnectionsResponseSchema,
  AiConnectionSchema,
  AiProviderConnectionInputSchema,
  AiModelsSchema,
  AiGatewayRequestSchema,
  AiGenerationResponseSchema,
  mergeAiGeneration,
} from "@tinytldr/core/ai";
import { z } from "zod";
import {
  AiRequestError,
  callAiProvider,
  ProviderSecretSchema,
  providerBaseUrl,
  readAiJson,
  type ProviderSecret,
  type ProviderCredentials,
} from "./AiProviders.ts";
import { listProviderModels } from "./AiModels.ts";

// Multi-page designs from reasoning models routinely take several minutes.
export const AI_GENERATION_TIMEOUT_MS = 420_000;

type AiConnection = z.infer<typeof AiConnectionSchema>;
type AiProviderConnectionInput = z.infer<typeof AiProviderConnectionInputSchema>;
type AiModels = z.infer<typeof AiModelsSchema>;

export interface AiConnectionStore {
  list(owner: string): Promise<AiConnection[]>;
  secret(owner: string, id: string): Promise<ProviderSecret | null>;
  delete(owner: string, id: string): Promise<AiConnection[]>;
  takeRequest(owner: string, bucket: "generate" | "connect"): Promise<boolean>;
  connect(
    owner: string,
    input: AiProviderConnectionInput,
    baseUrl: string,
    models: AiModels,
  ): Promise<AiConnection[]>;
  credentials(
    owner: string,
    id: string,
  ): Promise<{ secret: ProviderCredentials; revision: string }>;
  updateModels(
    owner: string,
    id: string,
    models: AiModels,
    revision: string,
  ): Promise<AiConnection[]>;
  selectModel(owner: string, id: string, model: string): Promise<AiConnection[]>;
  setOutputTokens(owner: string, id: string, tokens: number | null): Promise<AiConnection[]>;
}

export interface AiGatewayServices {
  verifyUser: (token: string) => Promise<string | null>;
  store: AiConnectionStore;
  fetch: typeof fetch;
  allowedOrigins: readonly string[];
  customBaseUrls: readonly string[];
  reportError: (code: string) => void;
}

export function createAiGateway(services: AiGatewayServices) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      Vary: "Origin",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (origin && services.allowedOrigins.includes(origin))
      headers["Access-Control-Allow-Origin"] = origin;
    try {
      if (!services.allowedOrigins.length)
        throw new AiRequestError(503, "configuration", "AI service origins are not configured.");
      if (origin && !services.allowedOrigins.includes(origin))
        throw new AiRequestError(403, "origin", "This origin is not allowed.");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method !== "POST") throw new AiRequestError(405, "method", "Use POST.");
      const token = request.headers.get("Authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
      if (!token) throw new AiRequestError(401, "auth", "Sign in to use provider connections.");
      const owner = await services.verifyUser(token);
      if (!owner) throw new AiRequestError(401, "auth", "Your session expired. Sign in again.");
      const checked = AiGatewayRequestSchema.safeParse(await readAiJson(request.body, 8_000_000));
      if (!checked.success)
        throw new AiRequestError(
          400,
          "input",
          "Invalid AI request. Check the prompt, selected artboards, context limits, and connection fields.",
        );
      const action = checked.data;
      if (action.action === "connect" || action.action === "models" || action.action === "model") {
        const single = services.store;
        let connections: AiConnection[];
        if (action.action === "connect" || action.action === "models") {
          const current = await services.store.list(owner);
          if (
            action.action === "connect" &&
            current.length &&
            action.connection.id !== current[0]!.id
          )
            throw new AiRequestError(
              409,
              "connections",
              "You already have an AI connection. Choose Replace to change it.",
            );
          const credentials =
            action.action === "models" ? await single.credentials(owner, action.id) : null;
          const secret =
            credentials?.secret ??
            (action.action === "connect"
              ? {
                  provider: action.connection.provider,
                  base_url: providerBaseUrl(
                    action.connection.provider,
                    action.connection.baseUrl,
                    services.customBaseUrls,
                  ),
                  api_key: action.connection.apiKey,
                }
              : null);
          if (!secret)
            throw new AiRequestError(404, "connection", "This provider connection is unavailable.");
          if (!(await services.store.takeRequest(owner, "connect")))
            throw new AiRequestError(
              429,
              "rate",
              "Up to 5 connection/model-list requests per minute are allowed. Please wait.",
            );
          const models = await listProviderModels({
            secret,
            allowedCustomUrls: services.customBaseUrls,
            fetch: services.fetch,
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
          });
          if (request.signal.aborted)
            throw new AiRequestError(408, "cancelled", "Connection setup was cancelled.");
          connections =
            action.action === "connect"
              ? await single.connect(owner, action.connection, secret.base_url, models)
              : await single.updateModels(owner, action.id, models, credentials!.revision);
        } else connections = await single.selectModel(owner, action.id, action.model);
        return Response.json(AiConnectionsResponseSchema.parse({ connections }), { headers });
      }
      if (action.action === "generate") {
        const secret = ProviderSecretSchema.safeParse(
          await services.store.secret(owner, action.request.connectionId),
        );
        if (!secret.success)
          throw new AiRequestError(404, "connection", "This provider connection is unavailable.");
        if (!(await services.store.takeRequest(owner, "generate")))
          throw new AiRequestError(
            429,
            "rate",
            "Up to 5 generations per minute are allowed. Please wait.",
          );
        const generated = await callAiProvider({
          secret: secret.data,
          request: action.request,
          allowedCustomUrls: services.customBaseUrls,
          fetch: services.fetch,
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(AI_GENERATION_TIMEOUT_MS)]),
        });
        if (!generated)
          throw new AiRequestError(502, "provider_output", "The provider returned no design.");
        let document;
        try {
          document = mergeAiGeneration(
            action.request.document,
            generated,
            action.request.targetPageIds,
          );
        } catch (error) {
          if (
            error instanceof z.ZodError &&
            error.issues.some((issue) => issue.message === "Designs must be smaller than 400 KB.")
          )
            throw new AiRequestError(
              502,
              "size",
              "The generated design exceeds the 400 KB document limit. Use a smaller image or request a smaller change. Nothing was applied.",
            );
          throw new AiRequestError(
            502,
            "scope",
            error instanceof Error && !(error instanceof z.ZodError)
              ? error.message
              : "The generated design did not pass validation. Nothing was applied.",
          );
        }
        if (Buffer.byteLength(JSON.stringify(document), "utf8") > 500_000)
          throw new AiRequestError(
            502,
            "size",
            "The generated design exceeds the 500 KB UTF-8 save limit. Use a smaller image or request a smaller change. Nothing was applied.",
          );
        return Response.json(AiGenerationResponseSchema.parse({ document }), { headers });
      }
      let connections: unknown;
      if (action.action === "list") connections = await services.store.list(owner);
      else if (action.action === "tokens")
        connections = await services.store.setOutputTokens(
          owner,
          action.id,
          action.maxOutputTokens,
        );
      else {
        connections = await services.store.delete(owner, action.id);
      }
      return Response.json(AiConnectionsResponseSchema.parse({ connections }), { headers });
    } catch (error) {
      const safe =
        error instanceof AiRequestError
          ? error
          : new AiRequestError(
              500,
              "storage",
              "The AI service could not complete this request. Check its Firebase deployment. Your design is unchanged.",
            );
      services.reportError(safe.code);
      return Response.json(
        { error: safe.message, code: safe.code },
        { status: safe.status, headers },
      );
    }
  };
}
