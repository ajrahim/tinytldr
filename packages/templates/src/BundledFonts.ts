import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BundledFontAsset {
  readonly family: string;
  readonly weight: number;
  readonly style: "normal" | "italic";
  readonly relativeFile: string;
  readonly licenseFile: string;
}

export const BUNDLED_FONT_ASSETS: readonly BundledFontAsset[] = [
  {
    family: "Inter",
    weight: 400,
    style: "normal",
    relativeFile: "inter/Inter-Regular.woff2",
    licenseFile: "inter/OFL.txt",
  },
  {
    family: "Inter",
    weight: 600,
    style: "normal",
    relativeFile: "inter/Inter-SemiBold.woff2",
    licenseFile: "inter/OFL.txt",
  },
  {
    family: "Inter",
    weight: 700,
    style: "normal",
    relativeFile: "inter/Inter-Bold.woff2",
    licenseFile: "inter/OFL.txt",
  },
  {
    family: "Fraunces",
    weight: 400,
    style: "italic",
    relativeFile: "fraunces/Fraunces-Italic.woff2",
    licenseFile: "fraunces/OFL.txt",
  },
  {
    family: "Fraunces",
    weight: 600,
    style: "normal",
    relativeFile: "fraunces/Fraunces-SemiBold.woff2",
    licenseFile: "fraunces/OFL.txt",
  },
  {
    family: "Fraunces",
    weight: 700,
    style: "normal",
    relativeFile: "fraunces/Fraunces-Bold.woff2",
    licenseFile: "fraunces/OFL.txt",
  },
  {
    family: "JetBrains Mono",
    weight: 400,
    style: "normal",
    relativeFile: "jetbrains-mono/JetBrainsMono-Regular.woff2",
    licenseFile: "jetbrains-mono/OFL.txt",
  },
  {
    family: "JetBrains Mono",
    weight: 600,
    style: "normal",
    relativeFile: "jetbrains-mono/JetBrainsMono-SemiBold.woff2",
    licenseFile: "jetbrains-mono/OFL.txt",
  },
  {
    family: "Space Grotesk",
    weight: 500,
    style: "normal",
    relativeFile: "space-grotesk/SpaceGrotesk-Medium.woff2",
    licenseFile: "space-grotesk/OFL.txt",
  },
  {
    family: "Space Grotesk",
    weight: 700,
    style: "normal",
    relativeFile: "space-grotesk/SpaceGrotesk-Bold.woff2",
    licenseFile: "space-grotesk/OFL.txt",
  },
];

let cachedFontFacesCss: string | null = null;

export function getFontsDirectoryPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "assets", "fonts");
}

export function verifyBundledFonts(): {
  readonly ok: boolean;
  readonly fontCount: number;
  readonly missingFiles: string[];
} {
  const fontsDir = getFontsDirectoryPath();
  const missingFiles: string[] = [];

  for (const asset of BUNDLED_FONT_ASSETS) {
    const fontPath = path.join(fontsDir, asset.relativeFile);
    const licensePath = path.join(fontsDir, asset.licenseFile);
    if (!fs.existsSync(fontPath)) {
      missingFiles.push(asset.relativeFile);
    }
    if (!fs.existsSync(licensePath) && !missingFiles.includes(asset.licenseFile)) {
      missingFiles.push(asset.licenseFile);
    }
  }

  return {
    ok: missingFiles.length === 0,
    fontCount: BUNDLED_FONT_ASSETS.length,
    missingFiles,
  };
}

export function getBundledFontFacesCss(): string {
  if (cachedFontFacesCss !== null) {
    return cachedFontFacesCss;
  }

  const fontsDir = getFontsDirectoryPath();
  const blocks: string[] = [];

  for (const asset of BUNDLED_FONT_ASSETS) {
    const fontPath = path.join(fontsDir, asset.relativeFile);
    const bytes = fs.readFileSync(fontPath);
    const base64 = bytes.toString("base64");
    blocks.push(`@font-face {
  font-family: "${asset.family}";
  font-style: ${asset.style};
  font-weight: ${asset.weight};
  font-display: block;
  src: url("data:font/woff2;base64,${base64}") format("woff2");
}`);
  }

  cachedFontFacesCss = blocks.join("\n");
  return cachedFontFacesCss;
}
