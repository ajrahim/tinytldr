import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEBSITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DIR = path.resolve(WEBSITE_DIR, "..");
const SOURCE_FONTS_DIR = path.join(ROOT_DIR, "packages", "templates", "assets", "fonts");
const TARGET_FONTS_DIR = path.join(WEBSITE_DIR, "public", "fonts");
const SOURCE_OG_IMAGE = path.join(
  ROOT_DIR,
  "packages",
  "templates",
  "templates",
  "quote-card",
  "samples",
  "golden-square.png",
);
const TARGET_OG_IMAGE = path.join(WEBSITE_DIR, "public", "og-card.png");

function copyDirectoryRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(SOURCE_FONTS_DIR)) {
  copyDirectoryRecursive(SOURCE_FONTS_DIR, TARGET_FONTS_DIR);
}

if (fs.existsSync(SOURCE_OG_IMAGE)) {
  fs.mkdirSync(path.dirname(TARGET_OG_IMAGE), { recursive: true });
  fs.copyFileSync(SOURCE_OG_IMAGE, TARGET_OG_IMAGE);
}
