import { Liquid } from "liquidjs";
import { getRuntimeScript } from "@tinytldr/runtime";
import { resolveSizeDimensions, type SafeZone, type SizeInput } from "./SizePresets.js";
import { validateSlotData, type SlotValidationIssue } from "./SlotValidator.js";
import type { TemplateBundle, ThemeTokens } from "./TemplateManifest.js";

export interface CompileTemplateOptions {
  data?: Record<string, unknown>;
  size?: SizeInput;
  theme?: string;
  themeOverrides?: Partial<Omit<ThemeTokens, "name">>;
  fontFacesCss?: string;
  allowRemoteAssets?: boolean;
  showSafeZoneOverlay?: boolean;
}

export interface CompiledTemplateOutput {
  html: string;
  width: number;
  height: number;
  aspectRatio: string;
  durationMs: number;
  fps: number;
  themeName: string;
  themeTokens: ThemeTokens;
  normalizedData: Record<string, unknown>;
  validationWarnings: SlotValidationIssue[];
}

const DISALLOWED_LIQUID_TAGS = /{%-?\s*(include|render|layout)\b/i;

function createRestrictedLiquidEngine(): Liquid {
  const engine = new Liquid({
    outputEscape: "escape",
    strictFilters: false,
    strictVariables: false,
    ownPropertyOnly: true,
    parseLimit: 100_000,
    renderLimit: 500,
    memoryLimit: 1_000_000,
  });

  engine.registerFilter("initials", (input: unknown) => {
    const str = typeof input === "string" ? input.trim() : "";
    if (!str) return "TT";
    const parts = str.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return (parts[0]?.slice(0, 2) ?? "TT").toUpperCase();
    }
    return ((parts[0]?.[0] ?? "T") + (parts[parts.length - 1]?.[0] ?? "T")).toUpperCase();
  });

  engine.registerFilter("lines", (input: unknown) => {
    const str = typeof input === "string" ? input : String(input ?? "");
    return str.replace(/\r\n/g, "\n").split("\n");
  });

  engine.registerFilter("pad_line", (input: unknown, width = 2) => {
    const num = Number(input) || 0;
    return String(num).padStart(Number(width) || 2, " ");
  });

  return engine;
}

const sharedLiquid = createRestrictedLiquidEngine();

export function resolveThemeTokens(
  bundle: TemplateBundle,
  requestedTheme?: string,
  overrides?: Partial<Omit<ThemeTokens, "name">>,
): { themeName: string; tokens: ThemeTokens } {
  const themeName = requestedTheme ?? bundle.manifest.defaultTheme;
  const baseTheme =
    bundle.manifest.themes[themeName] ?? bundle.manifest.themes[bundle.manifest.defaultTheme];

  if (!baseTheme) {
    throw new Error(`Theme '${themeName}' not found on template '${bundle.manifest.id}'.`);
  }

  return {
    themeName,
    tokens: {
      ...baseTheme,
      ...(overrides ?? {}),
    },
  };
}

export function buildThemeVariablesCss(
  tokens: ThemeTokens,
  width: number,
  height: number,
  safeZone?: SafeZone,
): string {
  const isPortrait = height > width;
  const isLandscape = width > height;
  const minDim = Math.min(width, height);
  const scaleUnit = Number((minDim / 1080).toFixed(4));
  const safeTop = safeZone?.topPx ?? 0;
  const safeBottom = safeZone?.bottomPx ?? 0;

  return `:root {
  --tt-bg: ${tokens.background};
  --tt-surface: ${tokens.surface};
  --tt-surface-elevated: ${tokens.surfaceElevated};
  --tt-text-primary: ${tokens.textPrimary};
  --tt-text-secondary: ${tokens.textSecondary};
  --tt-text-muted: ${tokens.textMuted};
  --tt-accent: ${tokens.accent};
  --tt-accent-secondary: ${tokens.accentSecondary};
  --tt-border: ${tokens.border};
  --tt-badge-bg: ${tokens.badgeBg};
  --tt-badge-text: ${tokens.badgeText};
  --tt-code-bg: ${tokens.codeBg ?? "#090d16"};
  --tt-code-text: ${tokens.codeText ?? "#e2e8f0"};
  --tt-width: ${width}px;
  --tt-height: ${height}px;
  --tt-safe-top: ${safeTop}px;
  --tt-safe-bottom: ${safeBottom}px;
  --tt-scale-unit: ${scaleUnit};
  --tt-font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --tt-font-display: "Fraunces", Georgia, serif;
  --tt-font-metric: "Space Grotesk", "Inter", sans-serif;
  --tt-font-mono: "JetBrains Mono", Consolas, monospace;
}
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
@page {
  size: ${width}px ${height}px;
  margin: 0;
}
html, body {
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  background: var(--tt-bg);
  color: var(--tt-text-primary);
  font-family: var(--tt-font-sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}
body[data-tt-kind="carousel"],
html:has(body[data-tt-kind="carousel"]) {
  height: auto;
  min-height: ${height}px;
  overflow: visible;
}
.tt-slide {
  width: ${width}px;
  height: ${height}px;
  position: relative;
  overflow: hidden;
  break-after: page;
  page-break-after: always;
}
.tt-slide:last-child {
  break-after: auto;
  page-break-after: auto;
}
.tt-safe-zone-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
}
.tt-safe-zone-overlay::before {
  content: "SAFE ZONE TOP (${safeTop}px)";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: ${safeTop}px;
  background: rgba(244, 63, 94, 0.14);
  border-bottom: 2px dashed rgba(244, 63, 94, 0.75);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 8px;
  font-family: var(--tt-font-mono);
  font-size: 16px;
  color: #fda4af;
}
.tt-safe-zone-overlay::after {
  content: "SAFE ZONE BOTTOM (${safeBottom}px)";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: ${safeBottom}px;
  background: rgba(244, 63, 94, 0.14);
  border-top: 2px dashed rgba(244, 63, 94, 0.75);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8px;
  font-family: var(--tt-font-mono);
  font-size: 16px;
  color: #fda4af;
}
body[data-tt-orientation="${isPortrait ? "portrait" : isLandscape ? "landscape" : "square"}"] {
  position: relative;
}
body[data-tt-preset="story"] > :first-child:not(.tt-slide),
body[data-tt-preset="story"] .tt-slide {
  padding-top: calc(var(--tt-safe-top) + 20px) !important;
  padding-bottom: calc(var(--tt-safe-bottom) + 20px) !important;
}`;
}

export function compileTemplate(
  bundle: TemplateBundle,
  options: CompileTemplateOptions = {},
): CompiledTemplateOutput {
  if (DISALLOWED_LIQUID_TAGS.test(bundle.liquidTemplate)) {
    throw new Error(
      `Template '${bundle.manifest.id}' contains disallowed filesystem tags (include/render/layout).`,
    );
  }

  const inputData = options.data ?? bundle.manifest.sampleData;
  const validation = validateSlotData(bundle.manifest, inputData, {
    allowRemoteAssets: options.allowRemoteAssets,
  });

  if (!validation.valid) {
    const summary = validation.errors.map((e) => e.message).join("; ");
    throw new Error(`Invalid slot data for template '${bundle.manifest.id}': ${summary}`);
  }

  const size = resolveSizeDimensions(options.size ?? bundle.manifest.defaultSize);
  const { themeName, tokens } = resolveThemeTokens(bundle, options.theme, options.themeOverrides);
  const durationMs = bundle.manifest.durationMs ?? 0;
  const fps = bundle.manifest.fps ?? 30;
  const orientation =
    size.height > size.width ? "portrait" : size.width > size.height ? "landscape" : "square";

  const renderedBody = sharedLiquid.parseAndRenderSync(bundle.liquidTemplate, {
    ...validation.normalizedData,
    meta: {
      templateId: bundle.manifest.id,
      theme: themeName,
      width: size.width,
      height: size.height,
      aspectRatio: size.aspectRatio,
      orientation,
    },
  });

  const themeVarsCss = buildThemeVariablesCss(tokens, size.width, size.height, size.safeZone);
  const runtimeScript = getRuntimeScript(durationMs, size);
  const safeTopAttr = size.safeZone?.topPx ?? 0;
  const safeBottomAttr = size.safeZone?.bottomPx ?? 0;
  const safeOverlayHtml =
    options.showSafeZoneOverlay && (safeTopAttr > 0 || safeBottomAttr > 0)
      ? `<div class="tt-safe-zone-overlay" aria-hidden="true"></div>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${size.width}, height=${size.height}, initial-scale=1" />
<style>
${options.fontFacesCss ?? ""}
${themeVarsCss}
${bundle.stylesCss}
</style>
</head>
<body data-tt-template="${bundle.manifest.id}" data-tt-kind="${bundle.manifest.kind}" data-tt-theme="${themeName}" data-tt-orientation="${orientation}" data-tt-preset="${size.presetId ?? "custom"}" data-tt-safe-top="${safeTopAttr}" data-tt-safe-bottom="${safeBottomAttr}">
${renderedBody}
${safeOverlayHtml}
<script>${runtimeScript}</script>
</body>
</html>`;

  return {
    html,
    width: size.width,
    height: size.height,
    aspectRatio: size.aspectRatio,
    durationMs,
    fps,
    themeName,
    themeTokens: tokens,
    normalizedData: validation.normalizedData,
    validationWarnings: validation.warnings,
  };
}
