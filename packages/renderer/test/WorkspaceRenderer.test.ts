import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, PDFRawStream, PDFContentStream } from "pdf-lib";
import { WorkspaceDesignDocumentSchema } from "@tinytldr/core";
import { getTemplateBundle } from "@tinytldr/templates";
import { ChromiumRenderer, inspectPdfBuffer, renderWorkspaceProject } from "../src/index.js";

describe("Ordered artboard rendering", () => {
  let renderer: ChromiumRenderer;
  let outputDir: string;
  beforeAll(async () => {
    renderer = new ChromiumRenderer();
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "tinytldr-artboard-render-"));
  });
  afterAll(async () => {
    await renderer?.close();
    if (outputDir) await fs.rm(outputDir, { recursive: true, force: true });
  });

  it("merges isolated Chromium PDFs in artboard order with exact page dimensions, no purpose text, and no temporary files", async () => {
    const template = structuredClone(getTemplateBundle("quote-card"));
    template.liquidTemplate = '<main class="color">A</main>';
    template.stylesCss = ".color { width:100%; height:100%; background:#123456; color:white; }";
    const project = WorkspaceDesignDocumentSchema.parse({
      version: 2,
      title: "Two pages",
      size: { width: 160, height: 96 },
      pages: [
        {
          id: "page-1",
          title: "Page 1",
          description: "",
          template,
          data: template.manifest.sampleData,
          theme: template.manifest.defaultTheme,
          tokenOverrides: {},
        },
      ],
    });
    project.pages[0]!.description = "PURPOSE_METADATA_NOT_RENDERED";
    const second = structuredClone(project.pages[0]!);
    second.id = "second";
    second.title = "Second";
    second.template.stylesCss =
      ".color { width:100%; height:100%; background:#abcdef; color:black; }";
    project.pages.push(second);
    const outputPath = path.join(outputDir, "ordered.pdf");
    const result = await renderWorkspaceProject({
      document: project,
      format: "pdf",
      outputPath,
      renderer,
    });
    expect(result.outputPaths).toEqual([outputPath]);
    expect(result.pageCount).toBe(2);
    const bytes = await fs.readFile(outputPath);
    expect(inspectPdfBuffer(bytes)).toMatchObject({
      pageCount: 2,
      widthPxAt96Dpi: 160,
      heightPxAt96Dpi: 96,
    });
    const pdf = await PDFDocument.load(bytes);
    const contents = pdf.getPages().map((page) => {
      expect(page.getSize()).toEqual({ width: 120, height: 72 });
      const streams = page.node.normalizedEntries().Contents;
      if (!streams) throw new Error("Expected real Chromium page content.");
      return streams
        .asArray()
        .map((_ref, index) => {
          const stream = streams.lookup(index);
          if (stream instanceof PDFContentStream)
            return Buffer.from(stream.getUnencodedContents()).toString("latin1");
          if (stream instanceof PDFRawStream)
            return inflateSync(stream.getContents()).toString("latin1");
          throw new Error("Expected an encoded or normalized PDF content stream.");
        })
        .join("\n");
    });
    const firstColor = /0?\.070\d*\s+0?\.203\d*\s+0?\.337\d*\s+rg/;
    const secondColor = /0?\.670\d*\s+0?\.803\d*\s+0?\.937\d*\s+rg/;
    expect(contents[0]).toMatch(firstColor);
    expect(contents[0]).not.toMatch(secondColor);
    expect(contents[1]).toMatch(secondColor);
    expect(contents[1]).not.toMatch(firstColor);
    expect(contents.join("")).not.toContain("PURPOSE_METADATA_NOT_RENDERED");
    expect(await fs.readdir(outputDir)).toEqual(["ordered.pdf"]);
    const before = await renderWorkspaceProject({
      document: project,
      format: "png",
      outputPath: path.join(outputDir, "before.png"),
      renderer,
    });
    for (const page of project.pages)
      page.description = "A completely different authoring purpose.";
    const after = await renderWorkspaceProject({
      document: project,
      format: "png",
      outputPath: path.join(outputDir, "after.png"),
      renderer,
    });
    for (const [index, file] of before.outputPaths.entries()) {
      expect(await fs.readFile(after.outputPaths[index]!)).toEqual(await fs.readFile(file));
    }
  });
});
