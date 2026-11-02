import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileTemplate,
  resolveDimensions,
  TemplateManifestSchema,
  type CompiledTemplateOutput,
  type CompileTemplateOptions,
  type SizePresetId,
  type TemplateBundle,
  type TemplateKind,
  type TemplateManifest,
} from "@tinytldr/core";
import { getBundledFontFacesCss } from "./BundledFonts.js";

export interface TemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly kind: TemplateKind;
  readonly description: string;
  readonly distillationHint: string;
  readonly tags: readonly string[];
  readonly defaultSize: SizePresetId;
  readonly supportedSizes: readonly SizePresetId[];
  readonly defaultTheme: string;
  readonly themes: readonly string[];
  readonly slotNames: readonly string[];
}

export interface ListTemplatesFilter {
  readonly kind?: TemplateKind;
  readonly tag?: string;
  readonly aspect?: string;
}

const bundleCache = new Map<string, TemplateBundle>();
let allLoaded = false;

export function getTemplatesDirectoryPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "templates");
}

function loadAllBundles(): void {
  if (allLoaded) return;
  const templatesDir = getTemplatesDirectoryPath();
  if (!fs.existsSync(templatesDir)) {
    allLoaded = true;
    return;
  }

  const entries = fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const dirName of entries) {
    const baseDir = path.join(templatesDir, dirName);
    const manifestPath = path.join(baseDir, "template.json");
    const liquidPath = path.join(baseDir, "template.liquid");
    const stylesPath = path.join(baseDir, "styles.css");

    if (!fs.existsSync(manifestPath)) continue;

    const rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    const manifest = TemplateManifestSchema.parse(rawManifest);
    const liquidTemplate = fs.readFileSync(liquidPath, "utf8");
    const stylesCss = fs.existsSync(stylesPath) ? fs.readFileSync(stylesPath, "utf8") : "";

    bundleCache.set(manifest.id, {
      manifest,
      liquidTemplate,
      stylesCss,
    });
  }

  allLoaded = true;
}

export function registerTemplateDirectory(templateDir: string): TemplateBundle {
  loadAllBundles();
  const absDir = path.resolve(templateDir);
  const manifestPath = path.join(absDir, "template.json");
  const liquidPath = path.join(absDir, "template.liquid");
  const stylesPath = path.join(absDir, "styles.css");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing template.json in ${absDir}`);
  }

  const rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  const manifest = TemplateManifestSchema.parse(rawManifest);
  const liquidTemplate = fs.readFileSync(liquidPath, "utf8");
  const stylesCss = fs.existsSync(stylesPath) ? fs.readFileSync(stylesPath, "utf8") : "";

  const bundle: TemplateBundle = {
    manifest,
    liquidTemplate,
    stylesCss,
  };
  bundleCache.set(manifest.id, bundle);
  return bundle;
}

export function getTemplateBundle(templateId: string): TemplateBundle {
  loadAllBundles();
  const bundle = bundleCache.get(templateId);
  if (!bundle) {
    const available = Array.from(bundleCache.keys()).join(", ");
    throw new Error(`Template '${templateId}' not found. Available templates: ${available}`);
  }
  return bundle;
}

export function getTemplateManifest(templateId: string): TemplateManifest {
  return getTemplateBundle(templateId).manifest;
}

export function getTemplateDefaultSample(templateId: string): Record<string, unknown> {
  const samplePath = path.join(getTemplatesDirectoryPath(), templateId, "samples", "default.json");
  if (!fs.existsSync(samplePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(samplePath, "utf8")) as Record<string, unknown>;
}

export function listTemplates(filter: ListTemplatesFilter = {}): TemplateSummary[] {
  loadAllBundles();
  const summaries: TemplateSummary[] = [];

  for (const bundle of bundleCache.values()) {
    const { manifest } = bundle;

    if (filter.kind && manifest.kind !== filter.kind) {
      continue;
    }

    if (filter.tag) {
      const normalizedTag = filter.tag.toLowerCase();
      if (!manifest.tags.some((t) => t.toLowerCase() === normalizedTag)) {
        continue;
      }
    }

    if (filter.aspect) {
      const targetAspect = filter.aspect.trim();
      const supportsAspect = manifest.supportedSizes.some((sizeId) => {
        const resolved = resolveDimensions(sizeId);
        return resolved.aspectRatio === targetAspect || sizeId === targetAspect;
      });
      if (!supportsAspect) {
        continue;
      }
    }

    summaries.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      kind: manifest.kind,
      description: manifest.description,
      distillationHint: manifest.distillationHint,
      tags: manifest.tags,
      defaultSize: manifest.defaultSize,
      supportedSizes: manifest.supportedSizes,
      defaultTheme: manifest.defaultTheme,
      themes: Object.keys(manifest.themes),
      slotNames: Object.keys(manifest.slots),
    });
  }

  return summaries;
}

export function compileRegisteredTemplate(
  templateId: string,
  options: Omit<CompileTemplateOptions, "fontFacesCss"> = {},
): CompiledTemplateOutput {
  const bundle = getTemplateBundle(templateId);
  return compileTemplate(bundle, {
    ...options,
    fontFacesCss: getBundledFontFacesCss(),
  });
}
