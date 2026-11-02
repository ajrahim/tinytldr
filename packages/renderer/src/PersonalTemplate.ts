import { randomBytes } from "node:crypto";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import {
  compileTemplate,
  PERSONAL_HTML_SANITIZER_OPTIONS,
  protectSanitizedPersonalHtml,
  WorkspaceTemplateSchema,
  type CompileTemplateOptions,
  type TemplateBundle,
} from "@tinytldr/core";
import { getBundledFontFacesCss } from "@tinytldr/templates";

const sanitizer = createDOMPurify(new JSDOM("").window);

export function countTemplateSlides(html: string) {
  const document = new JSDOM(html);
  try {
    return Math.max(1, document.window.document.querySelectorAll(".tt-slide").length);
  } finally {
    document.window.close();
  }
}

export function compilePersonalTemplate(bundle: TemplateBundle, options: CompileTemplateOptions) {
  const compiled = compileTemplate(WorkspaceTemplateSchema.parse(bundle), {
    ...options,
    allowRemoteAssets: false,
    fontFacesCss: getBundledFontFacesCss(),
  });
  const clean = sanitizer.sanitize(compiled.html, PERSONAL_HTML_SANITIZER_OPTIONS);
  return {
    ...compiled,
    html: protectSanitizedPersonalHtml(clean, {
      nonce: randomBytes(16).toString("hex"),
      durationMs: compiled.durationMs,
      canvasSize: compiled,
      fontSources: "data:",
    }),
  };
}
