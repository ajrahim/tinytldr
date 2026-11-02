import { FirebaseDesignRequestSchema } from "@tinytldr/core/firebase";
import { DesignRequestError, type DesignService } from "./DesignService.js";

export function createDesignGateway(options: {
  service: Pick<DesignService, "execute">;
  allowedOrigins: readonly string[];
  verifyUser: (token: string) => Promise<string | null>;
  reportError: (error: unknown) => void;
}) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
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
      return errorResponse(403, "This website origin is not allowed to use the design service.");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return errorResponse(405, "Use POST for design operations.");
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 600_000)
        return errorResponse(413, "The design request is too large.");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return errorResponse(400, "Send a valid JSON design request.");
      }
      const checked = FirebaseDesignRequestSchema.safeParse(body);
      if (!checked.success)
        return errorResponse(400, "The design request is invalid. Check its fields and document.");
      const authorization = request.headers.get("authorization");
      let userId: string | null = null;
      if (authorization) {
        const token = /^Bearer ([^\s]+)$/.exec(authorization)?.[1];
        if (!token) return errorResponse(401, "Sign in again before using this service.");
        userId = await options.verifyUser(token);
        if (!userId)
          return errorResponse(401, "Your sign-in has expired or is invalid. Sign in again.");
      }
      const data = await options.service.execute(checked.data, userId);
      return new Response(JSON.stringify({ data }), { status: 200, headers });
    } catch (error) {
      if (error instanceof DesignRequestError) return errorResponse(error.status, error.message);
      options.reportError(error);
      return errorResponse(
        503,
        "The design service is unavailable. Try again without discarding your browser draft.",
      );
    }
  };
}
