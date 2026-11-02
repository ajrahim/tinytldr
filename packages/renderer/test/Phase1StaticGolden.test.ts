import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTemplatesDirectoryPath } from "@tinytldr/templates";
import {
  ChromiumRenderer,
  inspectPngHeader,
  previewTemplatePost,
  renderTemplatePost,
  validateTemplatePost,
} from "../src/index.js";

describe("Phase 1: Static Templates Golden Visual Regression & Formats", () => {
  let renderer: ChromiumRenderer;
  let tempDir: string;

  beforeAll(() => {
    renderer = new ChromiumRenderer();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytldr-p1-golden-"));
  });

  afterAll(async () => {
    await renderer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it.each(["quote-card", "stat-callout", "code-snippet"] as const)(
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

  it("exports 2x PNG (2160x2160), JPG, and WebP for stat-callout across size presets", async () => {
    const png2xPath = path.join(tempDir, "stat-2x.png");
    const jpgPath = path.join(tempDir, "stat-x.jpg");
    const webpPath = path.join(tempDir, "stat-linkedin.webp");

    const png2x = await renderTemplatePost({
      templateId: "stat-callout",
      size: "square",
      scale: 2,
      format: "png",
      outputPath: png2xPath,
      renderer,
    });
    expect(png2x.width).toBe(2160);
    expect(png2x.height).toBe(2160);
    expect(png2x.warnings).toEqual([]);
    const header2x = inspectPngHeader(fs.readFileSync(png2xPath));
    expect(header2x).toEqual({ width: 2160, height: 2160 });

    const jpgOut = await renderTemplatePost({
      templateId: "stat-callout",
      size: "x",
      format: "jpg",
      outputPath: jpgPath,
      renderer,
    });
    expect(jpgOut.width).toBe(1600);
    expect(jpgOut.height).toBe(900);
    const jpgBytes = fs.readFileSync(jpgPath);
    expect(jpgBytes[0]).toBe(0xff);
    expect(jpgBytes[1]).toBe(0xd8);

    const webpOut = await renderTemplatePost({
      templateId: "stat-callout",
      size: "linkedin",
      format: "webp",
      outputPath: webpPath,
      renderer,
    });
    expect(webpOut.width).toBe(1200);
    expect(webpOut.height).toBe(627);
    const webpBytes = fs.readFileSync(webpPath);
    expect(webpBytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(webpBytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  }, 30000);

  it("auto-fits longer quotes and reports schema + runtime warnings accurately", async () => {
    const nearLimitQuote =
      "Deterministic rendering turns coding agents into design studios: every font is bundled offline, every layout auto-fits its container, and every frame hashes identically across machines and operating systems.";

    const validResult = await validateTemplatePost({
      templateId: "quote-card",
      data: {
        quote: nearLimitQuote,
        author: "Ada Lovelace",
        role: "Analytical Engine Architect",
      },
      renderer,
    });

    expect(validResult.valid).toBe(true);
    expect(validResult.runtimeWarnings).toEqual([]);
  }, 20000);
});
