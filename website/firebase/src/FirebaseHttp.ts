import type { HttpsFunction } from "firebase-functions/v2/https";

interface HttpConnection {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
}
type FirebaseHttpRequest = Pick<
  Parameters<HttpsFunction>[0],
  "headers" | "method" | "path" | "rawBody"
> &
  HttpConnection;
interface FirebaseHttpResponse extends HttpConnection {
  readonly writableEnded: boolean;
  status(code: number): void;
  setHeader(name: string, value: string): void;
  send(body: Buffer): void;
}
export function createFirebaseHttpHandler(
  gateway: (request: Request) => Promise<Response>,
): (request: FirebaseHttpRequest, response: FirebaseHttpResponse) => Promise<void> {
  return async (request, response) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const close = () => {
      if (!response.writableEnded) abort();
    };
    request.on("aborted", abort);
    response.on("close", close);
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const result = await gateway(
        new Request(`https://gateway.invalid${request.path}`, {
          method: request.method,
          headers,
          signal: controller.signal,
          ...(request.method === "POST" ? { body: request.rawBody?.toString("utf8") } : {}),
        }),
      );
      response.status(result.status);
      result.headers.forEach((value, key) => response.setHeader(key, value));
      response.send(Buffer.from(await result.arrayBuffer()));
    } finally {
      request.off("aborted", abort);
      response.off("close", close);
    }
  };
}
