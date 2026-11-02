import {
  compileTemplate,
  PERSONAL_HTML_SANITIZER_OPTIONS,
  protectSanitizedPersonalHtml,
  resolveDimensions,
  SIZE_PRESETS,
  type CompiledTemplateOutput,
  type ResolvedDimensions,
  type SizePresetId,
  type SlotValidationIssue,
  type TemplateManifest,
  type ThemeTokens,
  type TemplateBundle,
} from "@tinytldr/core";
import type { TinytldrRuntimeWarning } from "@tinytldr/runtime";
import DOMPurify from "dompurify";
import {
  getBrowserFontFacesCss,
  getTemplateBundle,
  getTemplateDefaultSample,
  listTemplates,
  type ListTemplatesFilter,
  type TemplateSummary,
} from "@tinytldr/templates";

export interface CustomDimensions {
  readonly width: number;
  readonly height: number;
}

export type RuntimeWarning = TinytldrRuntimeWarning;
export type SlotValidationWarning = SlotValidationIssue;
export type EditableThemeTokenKey = Exclude<keyof ThemeTokens, "name">;

export interface BrowserCompileRequest {
  readonly templateId: string;
  readonly templateBundle?: TemplateBundle;
  readonly size: SizePresetId | CustomDimensions;
  readonly theme: string;
  readonly data: Record<string, unknown>;
  readonly tokenOverrides?: Partial<Omit<ThemeTokens, "name">>;
  readonly activeSlideIndex?: number;
  readonly revision?: number;
}

export interface BrowserCompileResult {
  readonly html: string;
  readonly standaloneHtml: string;
  readonly dimensions: ResolvedDimensions;
  readonly manifest: TemplateManifest;
  readonly validationWarnings: readonly SlotValidationIssue[];
  readonly validationErrors: readonly string[];
  readonly slideCount: number;
  readonly durationMs: number;
}

function buildIframeBridgeScript(revision: number, initialSeekMs?: number): string {
  return `<script>
(function () {
  var rev = ${JSON.stringify(revision)};
  var initialSeek = ${JSON.stringify(initialSeekMs ?? null)};

  function notifyParent(initial) {
    var rt = window.__tinytldr;
    if (!rt) return;
    if (initial && typeof initialSeek === "number" && rt.durationMs > 0) {
      rt.seek(initialSeek);
    }
    var slides = document.querySelectorAll(".tt-slide");
    window.parent.postMessage({
      type: "tinytldr:ready",
      revision: rev,
      warnings: rt.warnings || [],
      durationMs: rt.durationMs || 0,
      slideCount: slides.length > 0 ? slides.length : 1
    }, "*");
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var msg = event && event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "tinytldr:inspect" && window.__tinytldr) {
      Promise.resolve(window.__tinytldr.ready).then(function () { notifyParent(false); });
    }
    if (msg.type === "tinytldr:seek" && typeof msg.ms === "number" && window.__tinytldr) {
      window.__tinytldr.seek(msg.ms);
    }
  });

  function checkReady() {
    if (window.__tinytldr && window.__tinytldr.ready) {
      Promise.resolve(window.__tinytldr.ready).then(function () { notifyParent(true); });
    } else {
      setTimeout(checkReady, 16);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkReady);
  } else {
    checkReady();
  }
})();
</script>`;
}

function buildSlideFilterCss(activeSlideIndex: number | undefined, height: number): string {
  if (!activeSlideIndex || activeSlideIndex < 1) {
    return "";
  }
  return `
html, body {
  height: ${height}px !important;
  overflow: hidden !important;
}
.tt-slide {
  display: none !important;
}
.tt-slide:nth-of-type(${activeSlideIndex}) {
  display: flex !important;
}
`;
}

export function getCatalogTemplates(filter?: ListTemplatesFilter): TemplateSummary[] {
  return listTemplates(filter);
}

export function getTemplateDetails(templateId: string): {
  readonly manifest: TemplateManifest;
  readonly defaultSample: Record<string, unknown>;
} {
  const bundle = getTemplateBundle(templateId);
  const defaultSample = getTemplateDefaultSample(templateId);
  return {
    manifest: bundle.manifest,
    defaultSample,
  };
}

export function getSlideCountFromData(
  manifest: TemplateManifest,
  data: Record<string, unknown>,
): number {
  if (manifest.kind !== "carousel") {
    return 1;
  }
  const slides = data.slides;
  if (Array.isArray(slides) && slides.length > 0) {
    return slides.length;
  }
  return 1;
}

export function compileBrowserPreview(
  request: BrowserCompileRequest,
  initialSeekMs?: number,
): BrowserCompileResult {
  const bundle = request.templateBundle ?? getTemplateBundle(request.templateId);
  const { manifest } = bundle;
  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
  const fontFacesCss = getBrowserFontFacesCss(`${origin}/fonts`);

  const durationMs = manifest.kind === "video" ? (manifest.durationMs ?? 4000) : 0;

  let compiled: CompiledTemplateOutput;
  let validationErrors: string[] = [];
  try {
    compiled = compileTemplate(bundle, {
      size: request.size,
      theme: request.theme,
      themeOverrides: request.tokenOverrides,
      data: request.data,
      fontFacesCss,
    });
  } catch (err) {
    if (request.templateBundle) throw err;
    validationErrors = [err instanceof Error ? err.message : String(err)];
    compiled = compileTemplate(bundle, {
      size: request.size,
      theme: request.theme,
      themeOverrides: request.tokenOverrides,
      data: getTemplateDefaultSample(request.templateId),
      fontFacesCss,
    });
  }

  const resolvedDims = resolveDimensions(request.size);
  const slideCount = getSlideCountFromData(manifest, compiled.normalizedData);
  const slideCss =
    manifest.kind === "carousel"
      ? buildSlideFilterCss(request.activeSlideIndex ?? 1, resolvedDims.height)
      : "";
  const extraStyleTag = slideCss ? `<style id="tt-studio-overrides">${slideCss}</style>` : "";

  const defaultPreviewSeek =
    manifest.kind === "video" ? (initialSeekMs ?? Math.round(durationMs * 0.85)) : undefined;
  const bridgeScript = buildIframeBridgeScript(request.revision ?? 1, defaultPreviewSeek);

  const standaloneHtml = request.templateBundle
    ? securePersonalHtml(compiled.html, durationMs, origin, resolvedDims)
    : compiled.html;
  const iframeHtml = request.templateBundle
    ? securePersonalHtml(
        compiled.html.replace("</body>", `${extraStyleTag}</body>`),
        durationMs,
        origin,
        resolvedDims,
        bridgeScript,
      )
    : compiled.html.replace("</body>", `${extraStyleTag}\n${bridgeScript}\n</body>`);

  return {
    html: iframeHtml,
    standaloneHtml,
    dimensions: resolvedDims,
    manifest,
    validationWarnings: compiled.validationWarnings,
    validationErrors,
    slideCount,
    durationMs,
  };
}

function securePersonalHtml(
  html: string,
  durationMs: number,
  origin: string,
  canvasSize: ResolvedDimensions,
  bridge = "",
): string {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const clean = DOMPurify.sanitize(html, PERSONAL_HTML_SANITIZER_OPTIONS);
  return protectSanitizedPersonalHtml(clean, {
    nonce,
    durationMs,
    fontSources: `${origin}/fonts/ data:`,
    canvasSize,
    bridge,
  });
}

export function compileArtboardHtml(pages: readonly BrowserCompileResult[]): string {
  if (pages.length === 1) return pages[0]!.standaloneHtml;
  const attribute = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const frames = pages.map(
    (page, index) =>
      `<iframe title="Page ${index + 1}" sandbox="allow-scripts" width="${page.dimensions.width}" height="${page.dimensions.height}" srcdoc="${attribute(page.standaloneHtml)}"></iframe>`,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>Design</title><style>body{margin:0}iframe{display:block;border:0;margin:0 auto;break-after:page}</style></head><body>${frames.join("\n")}</body></html>`;
}

export { resolveDimensions, SIZE_PRESETS };
export type {
  ResolvedDimensions,
  SizePresetId,
  SlotValidationIssue,
  TemplateManifest,
  TemplateSummary,
  ThemeTokens,
};
