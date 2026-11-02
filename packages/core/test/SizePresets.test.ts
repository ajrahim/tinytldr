import { describe, expect, it } from "vitest";
import {
  SIZE_PRESET_IDS,
  SIZE_PRESETS,
  ensureEvenDimensions,
  resolveDimensions,
} from "../src/index.js";

describe("SizePresets", () => {
  it("defines all 10 required stable size preset IDs", () => {
    expect(SIZE_PRESET_IDS).toEqual([
      "square",
      "portrait",
      "grid-3x4",
      "story",
      "hd",
      "x",
      "linkedin",
      "og",
      "youtube-thumb",
      "pinterest",
    ]);
  });

  it("resolves story preset with default safe zones (top 250px, bottom 340px)", () => {
    const resolved = resolveDimensions({ preset: "story" });
    expect(resolved.width).toBe(1080);
    expect(resolved.height).toBe(1920);
    expect(resolved.safeZone).toEqual({
      topPx: 250,
      bottomPx: 340,
      leftPx: 0,
      rightPx: 0,
    });
  });

  it("validates custom dimensions between 64 and 4096 per side", () => {
    expect(resolveDimensions({ width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
      aspectRatio: "4:3",
    });
    expect(() => resolveDimensions({ width: 32, height: 600 })).toThrow();
    expect(() => resolveDimensions({ width: 5000, height: 600 })).toThrow();
  });

  it("pads odd dimensions for H.264 compatibility and emits a warning", () => {
    const linkedin = SIZE_PRESETS.linkedin;
    const padded = ensureEvenDimensions(linkedin.width, linkedin.height);
    expect(padded.width).toBe(1200);
    expect(padded.height).toBe(628);
    expect(padded.wasPadded).toBe(true);
    expect(padded.warning).toContain("1200x627 to 1200x628");
  });
});
