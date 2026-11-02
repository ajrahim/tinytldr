import { z } from "zod";

export const SIZE_PRESET_IDS = [
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
] as const;

export type SizePresetId = (typeof SIZE_PRESET_IDS)[number];

export interface SafeZone {
  readonly topPx: number;
  readonly bottomPx: number;
  readonly leftPx: number;
  readonly rightPx: number;
}

export interface SizePresetDefinition {
  readonly id: SizePresetId;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly safeZone?: SafeZone;
}

export const SIZE_PRESETS: Record<SizePresetId, SizePresetDefinition> = {
  square: {
    id: "square",
    label: "Square (1:1)",
    width: 1080,
    height: 1080,
  },
  portrait: {
    id: "portrait",
    label: "Portrait (4:5)",
    width: 1080,
    height: 1350,
  },
  "grid-3x4": {
    id: "grid-3x4",
    label: "Grid Portrait (3:4)",
    width: 1080,
    height: 1440,
  },
  story: {
    id: "story",
    label: "Story / Reel (9:16)",
    width: 1080,
    height: 1920,
    safeZone: {
      topPx: 250,
      bottomPx: 340,
      leftPx: 0,
      rightPx: 0,
    },
  },
  hd: {
    id: "hd",
    label: "HD Landscape (16:9)",
    width: 1920,
    height: 1080,
  },
  x: {
    id: "x",
    label: "X / Twitter Post (16:9)",
    width: 1600,
    height: 900,
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn Share",
    width: 1200,
    height: 627,
  },
  og: {
    id: "og",
    label: "Open Graph Preview",
    width: 1200,
    height: 630,
  },
  "youtube-thumb": {
    id: "youtube-thumb",
    label: "YouTube Thumbnail",
    width: 1280,
    height: 720,
  },
  pinterest: {
    id: "pinterest",
    label: "Pinterest Pin (2:3)",
    width: 1000,
    height: 1500,
  },
};

export const MIN_CUSTOM_DIMENSION_PX = 64;
export const MAX_CUSTOM_DIMENSION_PX = 4096;

export const SizePresetIdSchema = z.enum(SIZE_PRESET_IDS);

export const SizePresetInputSchema = z.object({
  preset: SizePresetIdSchema,
});

export const CustomSizeInputSchema = z.object({
  width: z.number().int().min(MIN_CUSTOM_DIMENSION_PX).max(MAX_CUSTOM_DIMENSION_PX),
  height: z.number().int().min(MIN_CUSTOM_DIMENSION_PX).max(MAX_CUSTOM_DIMENSION_PX),
});

export const SizeSpecSchema = z.union([
  SizePresetIdSchema,
  SizePresetInputSchema,
  CustomSizeInputSchema,
]);

export type SizeSpec = z.infer<typeof SizeSpecSchema>;
export type SizeInput = SizeSpec;

export interface ResolvedDimensions {
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: string;
  readonly presetId?: SizePresetId;
  readonly safeZone?: SafeZone;
}

export interface EvenDimensionResult {
  readonly width: number;
  readonly height: number;
  readonly wasPadded: boolean;
  readonly warning?: string;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function resolveDimensions(size: SizeSpec): ResolvedDimensions {
  const parsed = SizeSpecSchema.parse(size);

  if (typeof parsed === "string") {
    const preset = SIZE_PRESETS[parsed];
    const divisor = gcd(preset.width, preset.height);
    return {
      width: preset.width,
      height: preset.height,
      aspectRatio: `${preset.width / divisor}:${preset.height / divisor}`,
      presetId: preset.id,
      safeZone: preset.safeZone,
    };
  }

  if ("preset" in parsed) {
    const preset = SIZE_PRESETS[parsed.preset];
    const divisor = gcd(preset.width, preset.height);
    return {
      width: preset.width,
      height: preset.height,
      aspectRatio: `${preset.width / divisor}:${preset.height / divisor}`,
      presetId: preset.id,
      safeZone: preset.safeZone,
    };
  }

  const divisor = gcd(parsed.width, parsed.height);
  return {
    width: parsed.width,
    height: parsed.height,
    aspectRatio: `${parsed.width / divisor}:${parsed.height / divisor}`,
  };
}

export const resolveSizeDimensions = resolveDimensions;

/**
 * H.264 / yuv420p requires even width and height. Pads odd dimensions by 1px and emits a warning.
 */
export function ensureEvenDimensions(width: number, height: number): EvenDimensionResult {
  const evenWidth = width % 2 === 0 ? width : width + 1;
  const evenHeight = height % 2 === 0 ? height : height + 1;
  const wasPadded = evenWidth !== width || evenHeight !== height;

  if (!wasPadded) {
    return { width: evenWidth, height: evenHeight, wasPadded: false };
  }

  return {
    width: evenWidth,
    height: evenHeight,
    wasPadded: true,
    warning: `H.264 requires even dimensions; padded ${width}x${height} to ${evenWidth}x${evenHeight}.`,
  };
}
