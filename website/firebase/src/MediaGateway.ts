import { MediaLibraryRequestSchema } from "@tinytldr/core";
import { MediaRequestError, type MediaService } from "./MediaService.js";

export function createMediaGateway(options: {
  service: () => Pick<MediaService, "execute">;
  allowedOrigins: readonly string[];
  verifyUser: (token: string) => Promise<string | null>;
  reportError: (error: unknown) => void;
}) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    });
    if (origin && options.allowedOrigins.includes(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    const errorResponse = (status: number, error: string) =>
      new Response(JSON.stringify({ error }), { status, headers });
    if (origin && !options.allowedOrigins.includes(origin))
      return errorResponse(403, "This website origin cannot access My Library.");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return errorResponse(405, "Use POST for media operations.");
    try {
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      if (!token || token.length > 16_384) return errorResponse(401, "Sign in to use My Library.");
      const uid = await options.verifyUser(token);
      if (!uid) return errorResponse(401, "Your sign-in expired. Sign in again.");
      const text = await request.text();
      if (Buffer.byteLength(text) > 29_000_000)
        return errorResponse(413, "The media request is too large.");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return errorResponse(400, "Send a valid JSON media request.");
      }
      const checked = MediaLibraryRequestSchema.safeParse(body);
      if (!checked.success) return errorResponse(400, "The media request has invalid fields.");
      const result = await options.service().execute(checked.data, uid);
      if ("binary" in result) {
        headers.set("Content-Type", result.contentType);
        return new Response(new Uint8Array(result.binary), { headers });
      }
      return new Response(JSON.stringify({ data: result }), { headers });
    } catch (error) {
      if (error instanceof MediaRequestError) return errorResponse(error.status, error.message);
      options.reportError(error);
      return errorResponse(
        503,
        "Firebase media storage is unavailable. Retry without discarding your work.",
      );
    }
  };
}
