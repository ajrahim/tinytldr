import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileRegisteredTemplate,
  getTemplatesDirectoryPath,
  listTemplates,
} from "@tinytldr/templates";
import {
  ChromiumRenderer,
  WaapiFfmpegVideoEncoder,
  previewTemplatePost,
  probeVideoFile,
  renderTemplatePost,
} from "../src/index.js";

describe("Phase 3: Video Engine (MP4) & 3 Animated Templates", () => {
  let renderer: ChromiumRenderer;
  let tempDir: string;

  beforeAll(() => {
    renderer = new ChromiumRenderer();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytldr-p3-video-"));
  });

  afterAll(async () => {
    await renderer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers all 12 launch templates across static (7), carousel (2), and video (3)", () => {
    const all = listTemplates();
    expect(all).toHaveLength(12);

    const videoIds = listTemplates({ kind: "video" })
      .map((m) => m.id)
      .sort();
    expect(videoIds).toEqual(["kinetic-quote", "stat-counter", "timeline-reveal"]);
  });

  it.each(["kinetic-quote", "timeline-reveal", "stat-counter"] as const)(
    "renders settled preview of %s deterministically with <= 0.1%% pixel diff against golden PNG and 0 warnings",
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

  it.each([
    { id: "kinetic-quote", expectedDurationSec: 4.0, expectedFrames: 120 },
    { id: "timeline-reveal", expectedDurationSec: 5.0, expectedFrames: 150 },
    { id: "stat-counter", expectedDurationSec: 4.0, expectedFrames: 120 },
  ] as const)(
    "encodes $id to H.264 yuv420p 30fps MP4 verified by ffprobe",
    async ({ id, expectedDurationSec, expectedFrames }) => {
      const mp4Path = path.join(tempDir, `${id}.mp4`);
      const renderOut = await renderTemplatePost({
        templateId: id,
        format: "mp4",
        outputPath: mp4Path,
        renderer,
      });

      expect(renderOut.outputPaths).toEqual([mp4Path]);
      expect(renderOut.width).toBe(1080);
      expect(renderOut.height).toBe(1080);
      expect(renderOut.warnings).toEqual([]);
      expect(renderOut.bytes).toBeGreaterThan(25000);

      const probe = await probeVideoFile(mp4Path);
      expect(probe.codecName).toBe("h264");
      expect(probe.pixFmt).toBe("yuv420p");
      expect(probe.width).toBe(1080);
      expect(probe.height).toBe(1080);
      expect(probe.avgFrameRate).toBe("30/1");
      expect(probe.nbFrames).toBe(expectedFrames);
      expect(Math.abs(probe.durationSeconds - expectedDurationSec)).toBeLessThanOrEqual(0.05);
    },
    90000,
  );

  it("verifies 100% SHA-256 frame-hash determinism across two runs and tests frame-sequence fallback when ffmpeg is absent", async () => {
    const compiled = compileRegisteredTemplate("stat-counter");
    const encoder = new WaapiFfmpegVideoEncoder(renderer);

    const run1Path = path.join(tempDir, "det-1.mp4");
    const run2Path = path.join(tempDir, "det-2.mp4");

    const run1 = await encoder.encodeMp4({
      html: compiled.html,
      width: compiled.width,
      height: compiled.height,
      durationMs: 1000,
      fps: 15,
      outputPath: run1Path,
    });

    const run2 = await encoder.encodeMp4({
      html: compiled.html,
      width: compiled.width,
      height: compiled.height,
      durationMs: 1000,
      fps: 15,
      outputPath: run2Path,
    });

    expect(run1.frameCount).toBe(15);
    expect(run1.frameHashes).toEqual(run2.frameHashes);
    expect(new Set(run1.frameHashes).size).toBeGreaterThan(10);

    // Verify fallback to JPEG frame sequence when ffmpeg binary is unavailable
    const fallbackOutPath = path.join(tempDir, "fallback-test.mp4");
    const fallbackRes = await encoder.encodeMp4({
      html: compiled.html,
      width: compiled.width,
      height: compiled.height,
      durationMs: 500,
      fps: 10,
      outputPath: fallbackOutPath,
      ffmpegBinary: "non-existent-ffmpeg-binary-xyz",
    });

    expect(fallbackRes.warning).toContain("[ffmpeg-fallback]");
    expect(fallbackRes.fallbackPaths).toHaveLength(5);
    expect(fs.existsSync(fallbackRes.fallbackPaths![0]!)).toBe(true);
  }, 60000);
});
