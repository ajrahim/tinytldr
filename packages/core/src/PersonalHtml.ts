import { getRuntimeScript } from "@tinytldr/runtime";

export const PERSONAL_HTML_SANITIZER_OPTIONS = {
  WHOLE_DOCUMENT: true,
  ADD_TAGS: ["style"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base", "form"],
  FORBID_ATTR: ["srcdoc", "srcset"],
  ALLOWED_URI_REGEXP: /^(?:data:image\/|blob:|#)/i,
};

export function protectSanitizedPersonalHtml(
  cleanHtml: string,
  options: {
    nonce: string;
    durationMs: number;
    fontSources: string;
    bridge?: string;
    canvasSize?: { readonly width: number; readonly height: number };
  },
): string {
  const { nonce, durationMs, fontSources, bridge = "", canvasSize } = options;
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src ${fontSources}; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  const csp = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const trustedBridge = bridge.replace("<script>", `<script nonce="${nonce}">`);
  return cleanHtml
    .replace("<head>", `<head>${csp}`)
    .replace(
      "</body>",
      `<script nonce="${nonce}">${getRuntimeScript(durationMs, canvasSize)}</script>${trustedBridge}</body>`,
    );
}
