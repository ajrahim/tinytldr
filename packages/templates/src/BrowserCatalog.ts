import {
  compileTemplate,
  resolveDimensions,
  type CompiledTemplateOutput,
  type CompileTemplateOptions,
  type SizePresetId,
  type TemplateBundle,
  type TemplateKind,
  type TemplateManifest,
} from "@tinytldr/core";
import {
  GENERATED_TEMPLATE_CATALOG,
  type EmbeddedTemplateCatalogEntry,
} from "./GeneratedTemplateCatalog.js";

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

const catalogMap = new Map<string, EmbeddedTemplateCatalogEntry>(
  GENERATED_TEMPLATE_CATALOG.map((entry) => [entry.id, entry]),
);

export function getBrowserFontFacesCss(baseUrl = "/fonts"): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  return BUNDLED_FONT_ASSETS.map(
    (asset) => `@font-face {
  font-family: "${asset.family}";
  font-style: ${asset.style};
  font-weight: ${asset.weight};
  font-display: swap;
  src: url("${cleanBase}/${asset.relativeFile}") format("woff2");
}`,
  ).join("\n");
}

export function getBundledFontFacesCss(): string {
  return getBrowserFontFacesCss("/fonts");
}

export function getTemplateBundle(templateId: string): TemplateBundle {
  const entry = catalogMap.get(templateId);
  if (!entry) {
    const available = Array.from(catalogMap.keys()).join(", ");
    throw new Error(`Template '${templateId}' not found. Available templates: ${available}`);
  }
  return {
    manifest: entry.manifest,
    liquidTemplate: entry.liquidTemplate,
    stylesCss: entry.stylesCss,
  };
}

export function getTemplateManifest(templateId: string): TemplateManifest {
  return getTemplateBundle(templateId).manifest;
}

export function getTemplateDefaultSample(templateId: string): Record<string, unknown> {
  const entry = catalogMap.get(templateId);
  if (!entry) {
    const available = Array.from(catalogMap.keys()).join(", ");
    throw new Error(`Template '${templateId}' not found. Available templates: ${available}`);
  }
  return structuredClone(entry.defaultSample);
}

export function listTemplates(filter: ListTemplatesFilter = {}): TemplateSummary[] {
  const summaries: TemplateSummary[] = [];

  for (const entry of GENERATED_TEMPLATE_CATALOG) {
    const { manifest } = entry;

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
  options: Omit<CompileTemplateOptions, "fontFacesCss"> & { readonly fontFacesCss?: string } = {},
): CompiledTemplateOutput {
  const bundle = getTemplateBundle(templateId);
  return compileTemplate(bundle, {
    ...options,
    fontFacesCss: options.fontFacesCss ?? getBrowserFontFacesCss("/fonts"),
  });
}
