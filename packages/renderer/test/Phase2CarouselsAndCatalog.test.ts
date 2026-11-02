import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTemplatesDirectoryPath, listTemplates } from "@tinytldr/templates";
import {
  ChromiumRenderer,
  inspectPdfBuffer,
  inspectPngHeader,
  previewTemplatePost,
  renderTemplatePost,
} from "../src/index.js";

describe("Phase 2: Carousels, Multi-Page PDF, Safe Zones & Full Static Catalog", () => {
  let renderer: ChromiumRenderer;
  let tempDir: string;

  beforeAll(() => {
    renderer = new ChromiumRenderer();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytldr-p2-test-"));
  });

  afterAll(async () => {
    await renderer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers all 7 static templates and 2 carousel templates", () => {
    const staticIds = listTemplates({ kind: "static" })
      .map((m) => m.id)
      .sort();
    expect(staticIds).toEqual([
      "changelog-card",
      "code-snippet",
      "quote-card",
      "stat-callout",
      "steps-checklist",
      "tweet-thread-summary",
      "vs-comparison",
    ]);

    const carousels = listTemplates({ kind: "carousel" })
      .map((m) => m.id)
      .sort();
    expect(carousels).toEqual(["carousel-slides", "paper-tldr"]);
  });

  it.each([
    "tweet-thread-summary",
    "changelog-card",
    "steps-checklist",
    "vs-comparison",
    "carousel-slides",
    "paper-tldr",
  ] as const)(
    "renders %s deterministically with <= 0.1%% pixel diff against golden PNG and 0 warnings",
    async (templateId) => {
      const goldenPath = path.join(
        getTemplatesDirectoryPath(),
        templateId,
        "samples",
        "golden-square.png",
      );
      expect(fs.existsSync(goldenPath)).toBe(true);

      const run1 = await previewTemplatePost({
        templateId,
        renderer,
      });
      const run2 = await previewTemplatePost({
        templateId,
        renderer,
      });

      expect(run1.width).toBe(1080);
      expect(run1.height).toBe(1080);
      expect(run1.warnings).toEqual([]);
      expect(run1.buffer.equals(run2.buffer)).toBe(true);

      const goldenPng = PNG.sync.read(fs.readFileSync(goldenPath));
      const actualPng = PNG.sync.read(run1.buffer);

      expect(actualPng.width).toBe(goldenPng.width);
      expect(actualPng.height).toBe(goldenPng.height);

      const diffPixels = pixelmatch(
        goldenPng.data,
        actualPng.data,
        undefined,
        goldenPng.width,
        goldenPng.height,
        { threshold: 0.1 },
      );
      const diffRatio = diffPixels / (goldenPng.width * goldenPng.height);
      expect(diffRatio).toBeLessThanOrEqual(0.001);
    },
    30000,
  );

  it("exports carousel-slides as 5 numbered 1080x1080 PNG files and a 5-page LinkedIn PDF", async () => {
    const pngBaseOut = path.join(tempDir, "deck.png");
    const pngRender = await renderTemplatePost({
      templateId: "carousel-slides",
      format: "png",
      outputPath: pngBaseOut,
      renderer,
    });

    expect(pngRender.pageCount).toBe(5);
    expect(pngRender.outputPaths).toHaveLength(5);
    expect(pngRender.warnings).toEqual([]);

    const buffers: Buffer[] = [];
    for (let i = 0; i < 5; i++) {
      const expectedName = `deck-0${i + 1}.png`;
      const slidePath = pngRender.outputPaths[i]!;
      expect(path.basename(slidePath)).toBe(expectedName);
      expect(fs.existsSync(slidePath)).toBe(true);
      const buf = fs.readFileSync(slidePath);
      expect(inspectPngHeader(buf)).toEqual({ width: 1080, height: 1080 });
      buffers.push(buf);
    }

    // Verify slides have distinct visual content
    expect(buffers[0]!.equals(buffers[1]!)).toBe(false);
    expect(buffers[1]!.equals(buffers[4]!)).toBe(false);

    // Render as multi-page PDF
    const pdfOut = path.join(tempDir, "deck.pdf");
    const pdfRender = await renderTemplatePost({
      templateId: "carousel-slides",
      format: "pdf",
      outputPath: pdfOut,
      renderer,
    });

    expect(pdfRender.outputPaths).toEqual([pdfOut]);
    expect(pdfRender.pageCount).toBe(5);
    expect(pdfRender.warnings).toEqual([]);
    const pdfMeta = inspectPdfBuffer(fs.readFileSync(pdfOut));
    expect(pdfMeta.pageCount).toBe(5);
    expect(pdfMeta.widthPxAt96Dpi).toBe(1080);
    expect(pdfMeta.heightPxAt96Dpi).toBe(1080);
  }, 40000);

  it("previews individual slides of paper-tldr via pageOrTimestamp and exports a 4-page portrait PDF", async () => {
    const slide0 = await previewTemplatePost({
      templateId: "paper-tldr",
      pageOrTimestamp: 0,
      renderer,
    });
    const slide2 = await previewTemplatePost({
      templateId: "paper-tldr",
      pageOrTimestamp: 2,
      renderer,
    });

    expect(slide0.slideCount).toBe(4);
    expect(slide2.slideCount).toBe(4);
    expect(slide0.buffer.equals(slide2.buffer)).toBe(false);

    const pdfOut = path.join(tempDir, "paper-portrait.pdf");
    const pdfRender = await renderTemplatePost({
      templateId: "paper-tldr",
      size: "portrait",
      format: "pdf",
      outputPath: pdfOut,
      renderer,
    });

    expect(pdfRender.pageCount).toBe(4);
    expect(pdfRender.width).toBe(1080);
    expect(pdfRender.height).toBe(1350);
    const pdfMeta = inspectPdfBuffer(fs.readFileSync(pdfOut));
    expect(pdfMeta.pageCount).toBe(4);
    expect(pdfMeta.widthPxAt96Dpi).toBe(1080);
    expect(Math.abs(pdfMeta.heightPxAt96Dpi - 1350)).toBeLessThanOrEqual(1);
  }, 30000);

  it("enforces 9:16 story safe zones (250px top, 340px bottom) and detects safe-zone intrusions", async () => {
    const storyPreview = await previewTemplatePost({
      templateId: "steps-checklist",
      size: "story",
      safeZoneOverlay: true,
      renderer,
    });

    expect(storyPreview.width).toBe(1080);
    expect(storyPreview.height).toBe(1920);
    expect(storyPreview.warnings).toEqual([]);

    // Verify that an element deliberately placed inside the top 250px safe zone triggers a 'safe_zone' runtime warning
    const intrudingHtml = `<!DOCTYPE html>
<html>
<head><style>:root { --tt-safe-top: 250px; --tt-safe-bottom: 340px; } body { margin: 0; width: 1080px; height: 1920px; position: relative; }</style></head>
<body data-tt-safe-top="250" data-tt-safe-bottom="340">
  <div data-tt-slot="badBanner" style="position: absolute; top: 40px; left: 40px; width: 400px; height: 80px;">Intruding Top Safe Zone</div>
</body>
</html>`;

    const layoutCheck = await renderer.validateLayout({
      html: intrudingHtml,
      width: 1080,
      height: 1920,
    });

    const safeZoneWarnings = layoutCheck.warnings.filter((w) => w.code === "safe_zone");
    expect(safeZoneWarnings.length).toBeGreaterThanOrEqual(1);
    expect(safeZoneWarnings[0]?.selector).toContain("badBanner");
  }, 30000);
});
