import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveDimensions,
  validateSlotData,
  type SizeSpec,
  type SlotValidationIssue,
  type ThemeTokens,
  type TemplateBundle,
} from "@tinytldr/core";
import type { TinytldrRuntimeWarning } from "@tinytldr/runtime";
import { compileRegisteredTemplate, getTemplateBundle } from "@tinytldr/templates";
import { ChromiumRenderer, type StaticImageFormat } from "./ChromiumRenderer.js";
import { WaapiFfmpegVideoEncoder } from "./VideoEncoder.js";
import { compilePersonalTemplate, countTemplateSlides } from "./PersonalTemplate.js";

export type RenderOutputFormat = StaticImageFormat | "pdf" | "mp4";

export interface ValidatePostOptions {
  readonly templateId: string;
  readonly data: Record<string, unknown>;
  readonly size?: SizeSpec;
  readonly theme?: string;
  readonly themeOverrides?: Partial<Omit<ThemeTokens, "name">>;
  readonly safeZoneOverlay?: boolean;
  readonly allowRemoteAssets?: boolean;
  readonly renderer?: ChromiumRenderer;
}

export interface ValidatePostResult {
  readonly valid: boolean;
  readonly width: number;
  readonly height: number;
  readonly slideCount: number;
  readonly schemaErrors: readonly SlotValidationIssue[];
  readonly schemaWarnings: readonly SlotValidationIssue[];
  readonly runtimeWarnings: readonly TinytldrRuntimeWarning[];
  readonly warnings: readonly string[];
}

export interface PreviewPostOptions {
  readonly templateId: string;
  readonly data?: Record<string, unknown>;
  readonly size?: SizeSpec;
  readonly theme?: string;
  readonly themeOverrides?: Partial<Omit<ThemeTokens, "name">>;
  readonly pageOrTimestamp?: number;
  readonly safeZoneOverlay?: boolean;
  readonly allowRemoteAssets?: boolean;
  readonly renderer?: ChromiumRenderer;
  readonly maxLongSidePx?: number;
}

export interface PreviewPostResult {
  readonly buffer: Buffer;
  readonly base64: string;
  readonly previewDataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly slideCount: number;
  readonly warnings: readonly string[];
}

export interface RenderPostOptions {
  readonly templateId: string;
  readonly templateBundle?: TemplateBundle;
  readonly data?: Record<string, unknown>;
  readonly size?: SizeSpec;
  readonly theme?: string;
  readonly themeOverrides?: Partial<Omit<ThemeTokens, "name">>;
  readonly format?: RenderOutputFormat;
  readonly scale?: 1 | 2;
  readonly fps?: number;
  readonly outputPath: string;
  readonly safeZoneOverlay?: boolean;
  readonly allowRemoteAssets?: boolean;
  readonly renderer?: ChromiumRenderer;
  readonly signal?: AbortSignal;
}

export interface RenderPostOutput {
  readonly outputPaths: string[];
  readonly width: number;
  readonly height: number;
  readonly durationMs?: number;
  readonly pageCount?: number;
  readonly bytes: number;
  readonly previewDataUrl: string;
  readonly warnings: string[];
}

function mergeWarningStrings(
  schemaWarnings: readonly SlotValidationIssue[],
  runtimeWarnings: readonly TinytldrRuntimeWarning[],
  extraWarnings: readonly string[] = [],
): string[] {
  return [
    ...schemaWarnings.map((w) => `[${w.code}] ${w.message}`),
    ...runtimeWarnings.map((w) => `[${w.code}] ${w.message}`),
    ...extraWarnings,
  ];
}

export async function validateTemplatePost(
  options: ValidatePostOptions,
): Promise<ValidatePostResult> {
  const bundle = getTemplateBundle(options.templateId);
  const resolvedSize = resolveDimensions(options.size ?? bundle.manifest.defaultSize);
  const slotValidation = validateSlotData(bundle.manifest, options.data, {
    allowRemoteAssets: options.allowRemoteAssets,
  });

  if (!slotValidation.valid) {
    return {
      valid: false,
      width: resolvedSize.width,
      height: resolvedSize.height,
      slideCount: 1,
      schemaErrors: slotValidation.errors,
      schemaWarnings: slotValidation.warnings,
      runtimeWarnings: [],
      warnings: slotValidation.warnings.map((w) => `[${w.code}] ${w.message}`),
    };
  }

  const compiled = compileRegisteredTemplate(options.templateId, {
    data: options.data,
    size: options.size,
    theme: options.theme,
    themeOverrides: options.themeOverrides,
    showSafeZoneOverlay: options.safeZoneOverlay,
    allowRemoteAssets: options.allowRemoteAssets,
  });

  const ownsRenderer = !options.renderer;
  const renderer = options.renderer ?? new ChromiumRenderer();

  try {
    const layoutResult = await renderer.validateLayout({
      html: compiled.html,
      width: compiled.width,
      height: compiled.height,
      allowRemoteAssets: options.allowRemoteAssets,
    });

    const warnings = mergeWarningStrings(compiled.validationWarnings, layoutResult.warnings);

    return {
      valid: true,
      width: compiled.width,
      height: compiled.height,
      slideCount: layoutResult.slideCount,
      schemaErrors: [],
      schemaWarnings: compiled.validationWarnings,
      runtimeWarnings: layoutResult.warnings,
      warnings,
    };
  } finally {
    if (ownsRenderer) {
      await renderer.close();
    }
  }
}

export async function previewTemplatePost(options: PreviewPostOptions): Promise<PreviewPostResult> {
  if (
    options.maxLongSidePx !== undefined &&
    (!Number.isInteger(options.maxLongSidePx) ||
      options.maxLongSidePx < 1 ||
      options.maxLongSidePx > 768)
  )
    throw new Error("Compact preview maximum must be an integer between 1 and 768 pixels.");
  const bundle = getTemplateBundle(options.templateId);
  const compiled = compileRegisteredTemplate(options.templateId, {
    data: options.data,
    size: options.size,
    theme: options.theme,
    themeOverrides: options.themeOverrides,
    showSafeZoneOverlay: options.safeZoneOverlay,
    allowRemoteAssets: options.allowRemoteAssets,
  });

  const ownsRenderer = !options.renderer;
  const renderer = options.renderer ?? new ChromiumRenderer();
  const isCarousel = bundle.manifest.kind === "carousel";
  const isVideo = bundle.manifest.kind === "video";
  const defaultVideoSeekMs = Math.round((compiled.durationMs || 4000) * 0.85);

  try {
    const pngResult = await renderer.renderStaticImage({
      html: compiled.html,
      width: compiled.width,
      height: compiled.height,
      scale:
        options.maxLongSidePx !== undefined
          ? Math.min(1, options.maxLongSidePx / Math.max(compiled.width, compiled.height))
          : 1,
      format: "png",
      seekMs: isCarousel ? 0 : (options.pageOrTimestamp ?? (isVideo ? defaultVideoSeekMs : 0)),
      slideIndex: isCarousel ? (options.pageOrTimestamp ?? 0) : 0,
      allowRemoteAssets: options.allowRemoteAssets,
    });

    const base64 = pngResult.buffer.toString("base64");
    return {
      buffer: pngResult.buffer,
      base64,
      previewDataUrl: `data:image/png;base64,${base64}`,
      width: pngResult.width,
      height: pngResult.height,
      slideCount: pngResult.slideCount,
      warnings: mergeWarningStrings(compiled.validationWarnings, pngResult.warnings),
    };
  } finally {
    if (ownsRenderer) {
      await renderer.close();
    }
  }
}

function compileRenderPost(options: Omit<RenderPostOptions, "outputPath">) {
  const bundle = options.templateBundle ?? getTemplateBundle(options.templateId);
  const compileOptions = {
    data: options.data,
    size: options.size,
    theme: options.theme,
    themeOverrides: options.themeOverrides,
    showSafeZoneOverlay: options.safeZoneOverlay,
    allowRemoteAssets: options.allowRemoteAssets,
  };
  const compiled = options.templateBundle
    ? compilePersonalTemplate(bundle, compileOptions)
    : compileRegisteredTemplate(options.templateId, compileOptions);
  return { bundle, compiled };
}

export function inspectTemplateRenderWork(options: Omit<RenderPostOptions, "outputPath">) {
  const { bundle, compiled } = compileRenderPost(options);
  return {
    width: compiled.width,
    height: compiled.height,
    durationMs: compiled.durationMs > 0 ? compiled.durationMs : 5000,
    fps: options.fps ?? compiled.fps ?? 30,
    slideCount: bundle.manifest.kind === "carousel" ? countTemplateSlides(compiled.html) : 1,
  };
}

export async function renderTemplatePost(options: RenderPostOptions): Promise<RenderPostOutput> {
  options.signal?.throwIfAborted();
  const format: RenderOutputFormat = options.format ?? "png";
  const scale = options.scale ?? 1;
  const absOutputPath = path.resolve(options.outputPath);
  const { bundle, compiled } = compileRenderPost(options);

  const ownsRenderer = !options.renderer;
  const renderer = options.renderer ?? new ChromiumRenderer();

  try {
    if (format === "png" || format === "jpg" || format === "webp") {
      if (bundle.manifest.kind === "carousel") {
        const carouselResult = await renderer.renderCarouselImages({
          html: compiled.html,
          width: compiled.width,
          height: compiled.height,
          scale,
          format,
          outputPath: absOutputPath,
          allowRemoteAssets: options.allowRemoteAssets,
        });

        let previewDataUrl: string;
        if (format === "png" && scale === 1 && carouselResult.buffers[0]) {
          previewDataUrl = `data:image/png;base64,${carouselResult.buffers[0].toString("base64")}`;
        } else {
          const preview = await renderer.renderStaticImage({
            html: compiled.html,
            width: compiled.width,
            height: compiled.height,
            scale: 1,
            format: "png",
            slideIndex: 0,
            allowRemoteAssets: options.allowRemoteAssets,
          });
          previewDataUrl = `data:image/png;base64,${preview.buffer.toString("base64")}`;
        }

        const totalBytes = carouselResult.buffers.reduce((sum, b) => sum + b.byteLength, 0);
        return {
          outputPaths: [...carouselResult.outputPaths],
          width: carouselResult.width,
          height: carouselResult.height,
          pageCount: carouselResult.slideCount,
          bytes: totalBytes,
          previewDataUrl,
          warnings: mergeWarningStrings(compiled.validationWarnings, carouselResult.warnings),
        };
      }

      const imageResult = await renderer.renderStaticImage({
        html: compiled.html,
        width: compiled.width,
        height: compiled.height,
        scale,
        format,
        outputPath: absOutputPath,
        allowRemoteAssets: options.allowRemoteAssets,
      });

      let previewDataUrl: string;
      if (format === "png" && scale === 1) {
        previewDataUrl = `data:image/png;base64,${imageResult.buffer.toString("base64")}`;
      } else {
        const preview = await renderer.renderStaticImage({
          html: compiled.html,
          width: compiled.width,
          height: compiled.height,
          scale: 1,
          format: "png",
          allowRemoteAssets: options.allowRemoteAssets,
        });
        previewDataUrl = `data:image/png;base64,${preview.buffer.toString("base64")}`;
      }

      return {
        outputPaths: [absOutputPath],
        width: imageResult.width,
        height: imageResult.height,
        pageCount: 1,
        bytes: imageResult.buffer.byteLength,
        previewDataUrl,
        warnings: mergeWarningStrings(compiled.validationWarnings, imageResult.warnings),
      };
    }

    if (format === "pdf") {
      const pdfResult = await renderer.renderPdf({
        html: compiled.html,
        width: compiled.width,
        height: compiled.height,
        outputPath: absOutputPath,
        allowRemoteAssets: options.allowRemoteAssets,
      });

      const preview = await renderer.renderStaticImage({
        html: compiled.html,
        width: compiled.width,
        height: compiled.height,
        scale: 1,
        format: "png",
        allowRemoteAssets: options.allowRemoteAssets,
      });

      return {
        outputPaths: [absOutputPath],
        width: pdfResult.width,
        height: pdfResult.height,
        pageCount: pdfResult.pageCount,
        bytes: pdfResult.buffer.byteLength,
        previewDataUrl: `data:image/png;base64,${preview.buffer.toString("base64")}`,
        warnings: mergeWarningStrings(compiled.validationWarnings, pdfResult.warnings),
      };
    }

    const videoEncoder = new WaapiFfmpegVideoEncoder(renderer);
    const durationMs = compiled.durationMs > 0 ? compiled.durationMs : 5000;
    const fps = options.fps ?? compiled.fps ?? 30;

    const videoResult = await videoEncoder.encodeMp4({
      html: compiled.html,
      width: compiled.width,
      height: compiled.height,
      durationMs,
      fps,
      outputPath: absOutputPath,
      signal: options.signal,
    });

    const outputPaths = videoResult.fallbackPaths
      ? [...videoResult.fallbackPaths]
      : [absOutputPath];
    let totalBytes = 0;
    for (const p of outputPaths) {
      const stat = await fs.stat(p);
      totalBytes += stat.size;
    }
    const preview = await renderer.renderStaticImage({
      html: compiled.html,
      width: compiled.width,
      height: compiled.height,
      scale: 1,
      format: "png",
      seekMs: Math.round(durationMs * 0.85),
      allowRemoteAssets: options.allowRemoteAssets,
    });

    return {
      outputPaths,
      width: videoResult.width,
      height: videoResult.height,
      durationMs,
      bytes: totalBytes,
      previewDataUrl: `data:image/png;base64,${preview.buffer.toString("base64")}`,
      warnings: mergeWarningStrings(
        compiled.validationWarnings,
        preview.warnings,
        videoResult.warning ? [videoResult.warning] : [],
      ),
    };
  } finally {
    if (ownsRenderer) {
      await renderer.close();
    }
  }
}
