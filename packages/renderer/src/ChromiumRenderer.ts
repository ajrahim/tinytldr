import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { getRuntimeScript, type TinytldrRuntimeWarning } from "@tinytldr/runtime";

export type StaticImageFormat = "png" | "jpg" | "webp";

export interface RenderHtmlOptions {
  readonly html: string;
  readonly width: number;
  readonly height: number;
  readonly scale?: number;
  readonly seekMs?: number;
  readonly slideIndex?: number;
  readonly allowRemoteAssets?: boolean;
}

export interface RenderImageResult {
  readonly buffer: Buffer;
  readonly format: StaticImageFormat;
  readonly width: number;
  readonly height: number;
  readonly slideCount: number;
  readonly warnings: readonly TinytldrRuntimeWarning[];
}

export interface RenderCarouselImagesResult {
  readonly buffers: readonly Buffer[];
  readonly outputPaths: readonly string[];
  readonly format: StaticImageFormat;
  readonly width: number;
  readonly height: number;
  readonly slideCount: number;
  readonly warnings: readonly TinytldrRuntimeWarning[];
}

export interface RenderPngResult {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly warnings: readonly TinytldrRuntimeWarning[];
}

export interface RenderPdfResult {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly pageCount: number;
  readonly warnings: readonly TinytldrRuntimeWarning[];
}

export interface ValidateLayoutResult {
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly slideCount: number;
  readonly warnings: readonly TinytldrRuntimeWarning[];
}

export interface PngHeaderMetadata {
  readonly width: number;
  readonly height: number;
}

export interface PdfMetadata {
  readonly pageCount: number;
  readonly mediaBoxWidthPt: number;
  readonly mediaBoxHeightPt: number;
  readonly widthPxAt96Dpi: number;
  readonly heightPxAt96Dpi: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function inspectPngHeader(buffer: Buffer): PngHeaderMetadata {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG buffer signature.");
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

export function inspectPdfBuffer(buffer: Buffer): PdfMetadata {
  const text = buffer.toString("latin1");
  const pageMatches = text.match(/\/Type\s*\/Page\b/g) ?? [];
  const mediaBoxMatch = text.match(
    /\/MediaBox\s*\[\s*0\s+0\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s*\]/,
  );

  const mediaBoxWidthPt = mediaBoxMatch?.[1] ? Number.parseFloat(mediaBoxMatch[1]) : 0;
  const mediaBoxHeightPt = mediaBoxMatch?.[2] ? Number.parseFloat(mediaBoxMatch[2]) : 0;

  return {
    pageCount: pageMatches.length,
    mediaBoxWidthPt,
    mediaBoxHeightPt,
    widthPxAt96Dpi: Math.round((mediaBoxWidthPt * 96) / 72),
    heightPxAt96Dpi: Math.round((mediaBoxHeightPt * 96) / 72),
  };
}

/**
 * Configures strict network sandboxing on a Playwright page.
 * Blocks all external HTTP/HTTPS/WS/FTP/file requests.
 */
export async function applyNetworkSandbox(page: Page, allowRemoteAssets = false): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (
      url.startsWith("data:") ||
      url.startsWith("blob:") ||
      url === "about:blank" ||
      (allowRemoteAssets && (url.startsWith("http://") || url.startsWith("https://")))
    ) {
      await route.continue();
      return;
    }

    await route.abort("blockedbyclient");
  });
}

async function preparePageAndCollectWarnings(
  page: Page,
  options: RenderHtmlOptions,
): Promise<{ warnings: TinytldrRuntimeWarning[]; durationMs: number; slideCount: number }> {
  await applyNetworkSandbox(page, options.allowRemoteAssets ?? false);
  await page.setContent(options.html, { waitUntil: "domcontentloaded" });
  if (!options.html.includes("window.__tinytldr")) {
    await page.addScriptTag({ content: getRuntimeScript(undefined, options) });
  }

  return page.evaluate(async (seekMs: number) => {
    const runtime = (
      globalThis as unknown as {
        __tinytldr: {
          ready: Promise<void>;
          warnings: TinytldrRuntimeWarning[];
          durationMs: number;
          slideCount: number;
          seek(ms: number): void;
        };
      }
    ).__tinytldr;
    await runtime.ready;
    runtime.seek(seekMs);
    return {
      warnings: runtime.warnings,
      durationMs: runtime.durationMs,
      slideCount: runtime.slideCount ?? 1,
    };
  }, options.seekMs ?? 0);
}

async function captureClippedSlideBuffer(
  page: Page,
  format: StaticImageFormat,
  clip: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  if (format === "jpg") {
    return page.screenshot({
      type: "jpeg",
      quality: 92,
      clip,
    });
  }

  if (format === "webp") {
    const pngBuffer = await page.screenshot({
      type: "png",
      clip,
    });
    const pngBase64 = pngBuffer.toString("base64");
    const webpBase64 = await page.evaluate(async (b64: string) => {
      const browserGlobal = globalThis as unknown as {
        createImageBitmap(blob: Blob): Promise<{ width: number; height: number; close(): void }>;
        OffscreenCanvas: new (
          w: number,
          h: number,
        ) => {
          getContext(type: "2d"): {
            drawImage(img: unknown, x: number, y: number): void;
          } | null;
          convertToBlob(opts: { type: string; quality: number }): Promise<Blob>;
        };
        btoa(s: string): string;
        atob(s: string): string;
      };
      const pngBytes = Uint8Array.from(browserGlobal.atob(b64), (char) => char.charCodeAt(0));
      const blob = new Blob([pngBytes], { type: "image/png" });
      const bitmap = await browserGlobal.createImageBitmap(blob);
      const canvas = new browserGlobal.OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to acquire 2d context on OffscreenCanvas.");
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const webpBlob = await canvas.convertToBlob({
        type: "image/webp",
        quality: 0.92,
      });
      const arrayBuf = await webpBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      return browserGlobal.btoa(binary);
    }, pngBase64);
    return Buffer.from(webpBase64, "base64");
  }

  return page.screenshot({
    type: "png",
    clip,
  });
}

export class ChromiumRenderer {
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly signal?: AbortSignal) {}

  public async getBrowser(): Promise<Browser> {
    this.signal?.throwIfAborted();
    if (!this.browserPromise) {
      this.browserPromise = chromium
        .launch({
          headless: true,
          args: ["--disable-remote-fonts", "--font-render-hinting=none"],
        })
        .catch((error: unknown) => {
          this.browserPromise = null;
          throw error;
        });
    }

    const browser = await this.browserPromise;
    this.signal?.throwIfAborted();
    return browser;
  }

  public async close(): Promise<void> {
    const launching = this.browserPromise;
    if (launching) {
      try {
        await (await launching).close();
      } finally {
        if (this.browserPromise === launching) this.browserPromise = null;
      }
    }
  }

  public async validateLayout(options: RenderHtmlOptions): Promise<ValidateLayoutResult> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    });

    try {
      const page = await context.newPage();
      const { warnings, durationMs, slideCount } = await preparePageAndCollectWarnings(
        page,
        options,
      );
      return {
        width: options.width,
        height: options.height,
        durationMs,
        slideCount,
        warnings,
      };
    } finally {
      await context.close();
    }
  }

  public async renderStaticImage(
    options: RenderHtmlOptions & {
      readonly format?: StaticImageFormat;
      readonly outputPath?: string;
    },
  ): Promise<RenderImageResult> {
    const scale = options.scale ?? 1;
    const format: StaticImageFormat = options.format ?? "png";
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: scale,
    });

    try {
      const page = await context.newPage();
      const { warnings, slideCount } = await preparePageAndCollectWarnings(page, options);
      const targetSlide = Math.max(
        0,
        Math.min(slideCount - 1, Math.floor(options.slideIndex ?? 0)),
      );
      if (slideCount > 1 && targetSlide > 0) {
        await page.setViewportSize({
          width: options.width,
          height: slideCount * options.height,
        });
      }

      const buffer = await captureClippedSlideBuffer(page, format, {
        x: 0,
        y: targetSlide * options.height,
        width: options.width,
        height: options.height,
      });

      if (options.outputPath) {
        await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
        await fs.writeFile(options.outputPath, buffer);
      }

      return {
        buffer,
        format,
        width: options.width * scale,
        height: options.height * scale,
        slideCount,
        warnings,
      };
    } finally {
      await context.close();
    }
  }

  public async renderCarouselImages(
    options: RenderHtmlOptions & {
      readonly format?: StaticImageFormat;
      readonly outputPath: string;
    },
  ): Promise<RenderCarouselImagesResult> {
    const scale = options.scale ?? 1;
    const format: StaticImageFormat = options.format ?? "png";
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: scale,
    });

    try {
      const page = await context.newPage();
      const { warnings, slideCount } = await preparePageAndCollectWarnings(page, options);
      if (slideCount > 1) {
        await page.setViewportSize({
          width: options.width,
          height: slideCount * options.height,
        });
      }

      const absPath = path.resolve(options.outputPath);
      const dir = path.dirname(absPath);
      const rawExt = path.extname(absPath);
      const ext = rawExt || `.${format}`;
      const stem = path.basename(absPath, rawExt);
      await fs.mkdir(dir, { recursive: true });

      const buffers: Buffer[] = [];
      const outputPaths: string[] = [];

      for (let i = 0; i < slideCount; i++) {
        const slideBuffer = await captureClippedSlideBuffer(page, format, {
          x: 0,
          y: i * options.height,
          width: options.width,
          height: options.height,
        });
        const filePath =
          slideCount === 1
            ? absPath
            : path.join(dir, `${stem}-${String(i + 1).padStart(2, "0")}${ext}`);
        await fs.writeFile(filePath, slideBuffer);
        buffers.push(slideBuffer);
        outputPaths.push(filePath);
      }

      return {
        buffers,
        outputPaths,
        format,
        width: options.width * scale,
        height: options.height * scale,
        slideCount,
        warnings,
      };
    } finally {
      await context.close();
    }
  }

  public async renderPng(
    options: RenderHtmlOptions & { readonly outputPath?: string },
  ): Promise<RenderPngResult> {
    const result = await this.renderStaticImage({
      ...options,
      format: "png",
    });
    return {
      buffer: result.buffer,
      width: result.width,
      height: result.height,
      warnings: result.warnings,
    };
  }

  public async renderPdf(
    options: RenderHtmlOptions & { readonly outputPath?: string },
  ): Promise<RenderPdfResult> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    });

    try {
      const page = await context.newPage();
      const { warnings, slideCount } = await preparePageAndCollectWarnings(page, options);

      const buffer = await page.pdf({
        width: `${options.width}px`,
        height: `${options.height}px`,
        printBackground: true,
        margin: { top: "0px", right: "0px", bottom: "0px", left: "0px" },
        pageRanges: slideCount > 1 ? `1-${slideCount}` : "1",
      });

      if (options.outputPath) {
        await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
        await fs.writeFile(options.outputPath, buffer);
      }

      const metadata = inspectPdfBuffer(buffer);
      return {
        buffer,
        width: options.width,
        height: options.height,
        pageCount: metadata.pageCount,
        warnings,
      };
    } finally {
      await context.close();
    }
  }
}
