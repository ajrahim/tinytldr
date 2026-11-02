import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { WorkspaceProjectSchema, type WorkspaceProject } from "@tinytldr/core";
import { ChromiumRenderer } from "./ChromiumRenderer.js";
import { compilePersonalTemplate } from "./PersonalTemplate.js";
import {
  renderTemplatePost,
  type RenderOutputFormat,
  type RenderPostOutput,
} from "./PostRenderer.js";

export interface WorkspaceRenderOutput extends RenderPostOutput {
  assetMetadata: { pageId: string; durationMs?: number }[];
}

export async function renderWorkspaceProject(options: {
  document: WorkspaceProject;
  format: RenderOutputFormat;
  scale?: 1 | 2;
  outputPath: string;
  renderer?: ChromiumRenderer;
  signal?: AbortSignal;
}): Promise<WorkspaceRenderOutput> {
  const document = WorkspaceProjectSchema.parse(options.document);
  const renderer = options.renderer ?? new ChromiumRenderer();
  const destination = path.resolve(options.outputPath);
  const mergePdf = options.format === "pdf" && document.pages.length > 1;
  let temporaryDirectory: string | undefined;
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (mergePdf)
      temporaryDirectory = await fs.mkdtemp(path.join(path.dirname(destination), ".artboards-"));
    const outputs: RenderPostOutput[] = [];
    for (const [index, page] of document.pages.entries()) {
      options.signal?.throwIfAborted();
      const pageFilename = `${path.basename(destination, path.extname(destination))}-page-${String(index + 1).padStart(2, "0")}.${options.format}`;
      const outputPath =
        document.pages.length === 1
          ? destination
          : path.join(temporaryDirectory ?? path.dirname(destination), pageFilename);
      const result = await renderTemplatePost({
        templateId: page.template.manifest.id,
        templateBundle: page.template,
        data: page.data,
        size: document.size,
        theme: page.theme,
        themeOverrides: page.tokenOverrides,
        format: options.format,
        scale: options.scale,
        outputPath,
        renderer,
        signal: options.signal,
      });
      if (result.outputPaths.some((file) => path.extname(file) !== `.${options.format}`))
        throw new Error(
          `Page ${index + 1} requires ffmpeg. Install it and retry; a frame sequence is not a finished MP4.`,
        );
      outputs.push(result);
    }
    const first = outputs[0]!;
    let outputPaths = outputs.flatMap((result) => result.outputPaths);
    let bytes = outputs.reduce((total, result) => total + result.bytes, 0);
    if (mergePdf) {
      const merged = await PDFDocument.create();
      for (const file of outputPaths) {
        const source = await PDFDocument.load(await fs.readFile(file));
        for (const page of await merged.copyPages(source, source.getPageIndices()))
          merged.addPage(page);
      }
      const buffer = await merged.save({ useObjectStreams: false });
      await fs.writeFile(destination, buffer);
      outputPaths = [destination];
      bytes = buffer.byteLength;
    }
    let previewDataUrl = first.previewDataUrl;
    if (Math.max(first.width, first.height) > 768) {
      const page = document.pages[0]!;
      const compiled = compilePersonalTemplate(page.template, {
        size: document.size,
        data: page.data,
        theme: page.theme,
        themeOverrides: page.tokenOverrides,
      });
      const preview = await renderer.renderStaticImage({
        html: compiled.html,
        width: compiled.width,
        height: compiled.height,
        scale: Math.min(1, 768 / Math.max(compiled.width, compiled.height)),
        seekMs: Math.round(compiled.durationMs * 0.85),
        format: "png",
      });
      previewDataUrl = `data:image/png;base64,${preview.buffer.toString("base64")}`;
    }
    return {
      outputPaths,
      assetMetadata: mergePdf
        ? [{ pageId: document.pages[0]!.id }]
        : outputs.flatMap((result, index) =>
            result.outputPaths.map(() => ({
              pageId: document.pages[index]!.id,
              durationMs: result.durationMs,
            })),
          ),
      width: first.width,
      height: first.height,
      bytes,
      previewDataUrl,
      pageCount: outputs.reduce((total, result) => total + (result.pageCount ?? 1), 0),
      durationMs: outputs.length === 1 ? first.durationMs : undefined,
      warnings: outputs.flatMap((result, index) =>
        result.warnings.map(
          (warning) => `[Page ${index + 1}: ${document.pages[index]!.title}] ${warning}`,
        ),
      ),
    };
  } finally {
    try {
      if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
    } finally {
      if (!options.renderer) await renderer.close();
    }
  }
}
