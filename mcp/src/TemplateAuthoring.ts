import fs from "node:fs";
import path from "node:path";
import {
  TemplateManifestSchema,
  type SizePresetId,
  type TemplateKind,
  type TemplateManifest,
} from "@tinytldr/core";
import {
  ChromiumRenderer,
  validateTemplatePost,
  type ValidatePostResult,
} from "@tinytldr/renderer";
import {
  getTemplateManifest,
  getTemplatesDirectoryPath,
  registerTemplateDirectory,
} from "@tinytldr/templates";

export interface ScaffoldTemplateOptions {
  readonly templateId: string;
  readonly name?: string;
  readonly kind?: TemplateKind;
  readonly author?: string;
  readonly targetRootDir?: string;
}

export interface ScaffoldTemplateResult {
  readonly templateId: string;
  readonly directoryPath: string;
  readonly filesCreated: readonly string[];
}

export interface TemplateSuiteValidationResult {
  readonly ok: boolean;
  readonly templateId: string;
  readonly checkedSizes: readonly SizePresetId[];
  readonly issues: readonly string[];
}

export function buildMaxLengthSlotPayload(manifest: TemplateManifest): Record<string, unknown> {
  const payload: Record<string, unknown> = structuredClone(manifest.sampleData);

  for (const [slotKey, def] of Object.entries(manifest.slots)) {
    const budget = def.recommendedMaxLength ?? def.maxLength;
    if (def.type === "string" && budget) {
      const sampleStr =
        typeof manifest.sampleData[slotKey] === "string" &&
        (manifest.sampleData[slotKey] as string).length > 0
          ? (manifest.sampleData[slotKey] as string)
          : "Deterministic social card copy ";
      const repeated = sampleStr.repeat(Math.ceil(budget / sampleStr.length) + 1);
      payload[slotKey] = repeated.slice(0, budget).trim();
    } else if (def.type === "string[]" && def.maxItems) {
      const baseArr = Array.isArray(manifest.sampleData[slotKey])
        ? (manifest.sampleData[slotKey] as string[])
        : ["Key takeaway point"];
      const filled: string[] = [];
      for (let i = 0; i < def.maxItems; i++) {
        filled.push(baseArr[i % baseArr.length] ?? `Point ${i + 1}`);
      }
      payload[slotKey] = filled;
    } else if (def.type === "object[]" && def.maxItems && def.itemSchema) {
      const baseArr = Array.isArray(manifest.sampleData[slotKey])
        ? (manifest.sampleData[slotKey] as Record<string, unknown>[])
        : [];
      const fallbackItem: Record<string, unknown> = {};
      for (const [fieldKey] of Object.entries(def.itemSchema)) {
        fallbackItem[fieldKey] = `Item ${fieldKey}`;
      }
      const filled: Record<string, unknown>[] = [];
      for (let i = 0; i < def.maxItems; i++) {
        filled.push(structuredClone(baseArr[i % Math.max(1, baseArr.length)] ?? fallbackItem));
      }
      payload[slotKey] = filled;
    }
  }

  return payload;
}

export function scaffoldNewTemplate(options: ScaffoldTemplateOptions): ScaffoldTemplateResult {
  const id = options.templateId.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(
      `Invalid templateId '${options.templateId}'. Use lowercase kebab-case (a-z, 0-9, -).`,
    );
  }

  const rootDir = options.targetRootDir
    ? path.resolve(options.targetRootDir)
    : getTemplatesDirectoryPath();
  const templateDir = path.join(rootDir, id);

  if (fs.existsSync(templateDir)) {
    throw new Error(`Template directory already exists: ${templateDir}`);
  }

  const kind: TemplateKind = options.kind ?? "static";
  const displayName =
    options.name ??
    id
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const sampleData = {
    badge: "TL;DR",
    headline: `${displayName}: built with deterministic HTML and CSS`,
    subheadline: "Calling agent distills the copy; tinytldr renders exact pixels.",
    handle: "@tinytldr",
  };

  const manifest: TemplateManifest = TemplateManifestSchema.parse({
    id,
    name: displayName,
    version: "0.1.0",
    kind,
    description: `${displayName} social post template for tinytldr.`,
    distillationHint:
      "Distill the source into a short badge (<=20 chars), a punchy headline (<=110 chars), and a concise supporting subheadline (<=140 chars).",
    tags: [kind, "summary", "social"],
    defaultSize: "square",
    supportedSizes: ["square", "portrait", "story", "x", "og"],
    ...(kind === "video" ? { durationMs: 4000, fps: 30 } : {}),
    defaultTheme: "dark",
    themes: {
      dark: {
        name: "Dark",
        background: "#0b0f19",
        surface: "#131b2e",
        surfaceElevated: "#1e293b",
        textPrimary: "#f8fafc",
        textSecondary: "#cbd5e1",
        textMuted: "#94a3b8",
        accent: "#38bdf8",
        accentSecondary: "#818cf8",
        border: "#26334d",
        badgeBg: "#172554",
        badgeText: "#38bdf8",
      },
      light: {
        name: "Light",
        background: "#f8fafc",
        surface: "#ffffff",
        surfaceElevated: "#f1f5f9",
        textPrimary: "#0f172a",
        textSecondary: "#334155",
        textMuted: "#64748b",
        accent: "#0284c7",
        accentSecondary: "#4f46e5",
        border: "#cbd5e1",
        badgeBg: "#e0f2fe",
        badgeText: "#0369a1",
      },
    },
    slots: {
      badge: {
        type: "string",
        label: "Badge",
        description: "Short category pill at the top of the card.",
        required: false,
        maxLength: 24,
        defaultValue: "TL;DR",
      },
      headline: {
        type: "string",
        label: "Headline",
        description: "Primary takeaway headline.",
        required: true,
        maxLength: 110,
        autofit: {
          minFontPx: 32,
          maxFontPx: 64,
          maxLines: 4,
        },
      },
      subheadline: {
        type: "string",
        label: "Subheadline",
        description: "Supporting context sentence.",
        required: false,
        maxLength: 140,
      },
      handle: {
        type: "string",
        label: "Handle",
        description: "Author handle or domain.",
        required: false,
        maxLength: 40,
        defaultValue: "@tinytldr",
      },
    },
    sampleData,
    author: options.author ?? "tinytldr community",
    license: "MIT",
  });

  const liquidTemplate = `<main class="card">
  <header class="card-header">
    {% if badge != blank %}
      <span class="badge" data-tt-slot="badge">{{ badge }}</span>
    {% endif %}
  </header>

  <section class="card-body">
    <h1
      class="headline"
      data-tt-slot="headline"
      data-tt-autofit="true"
      data-tt-min-size="32"
      data-tt-max-size="64"
    >{{ headline }}</h1>
    {% if subheadline != blank %}
      <p class="subheadline" data-tt-slot="subheadline">{{ subheadline }}</p>
    {% endif %}
  </section>

  <footer class="card-footer">
    <span class="handle" data-tt-slot="handle">{{ handle }}</span>
  </footer>
</main>
`;

  const stylesCss = `.card {
  width: 100%;
  height: 100%;
  padding: calc(72px * var(--tt-scale)) calc(80px * var(--tt-scale));
  padding-top: calc(max(72px * var(--tt-scale), var(--tt-safe-top) + 32px));
  padding-bottom: calc(max(72px * var(--tt-scale), var(--tt-safe-bottom) + 32px));
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--tt-bg);
  color: var(--tt-text-primary);
  font-family: "Inter", system-ui, sans-serif;
}

.badge {
  display: inline-block;
  padding: 10px 22px;
  border-radius: 999px;
  background: var(--tt-badge-bg);
  color: var(--tt-badge-text);
  font-family: "JetBrains Mono", monospace;
  font-size: calc(22px * var(--tt-scale));
  font-weight: 600;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: calc(24px * var(--tt-scale));
}

.headline {
  font-family: "Space Grotesk", "Inter", sans-serif;
  font-size: calc(58px * var(--tt-scale));
  font-weight: 700;
  line-height: 1.18;
  color: var(--tt-text-primary);
}

.subheadline {
  font-size: calc(30px * var(--tt-scale));
  line-height: 1.4;
  color: var(--tt-text-secondary);
}

.handle {
  font-family: "JetBrains Mono", monospace;
  font-size: calc(24px * var(--tt-scale));
  color: var(--tt-text-muted);
}
`;

  const samplesDir = path.join(templateDir, "samples");
  fs.mkdirSync(samplesDir, { recursive: true });

  const manifestFile = path.join(templateDir, "template.json");
  const liquidFile = path.join(templateDir, "template.liquid");
  const stylesFile = path.join(templateDir, "styles.css");
  const sampleFile = path.join(samplesDir, "default.json");

  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(liquidFile, liquidTemplate, "utf8");
  fs.writeFileSync(stylesFile, stylesCss, "utf8");
  fs.writeFileSync(sampleFile, `${JSON.stringify(sampleData, null, 2)}\n`, "utf8");

  registerTemplateDirectory(templateDir);

  return {
    templateId: id,
    directoryPath: templateDir,
    filesCreated: [manifestFile, liquidFile, stylesFile, sampleFile],
  };
}

export async function validateTemplateFullSuite(options: {
  readonly templateId: string;
  readonly targetRootDir?: string;
  readonly renderer?: ChromiumRenderer;
}): Promise<TemplateSuiteValidationResult> {
  const ownsRenderer = !options.renderer;
  const renderer = options.renderer ?? new ChromiumRenderer();
  if (options.targetRootDir) {
    const candidateDir = path.join(path.resolve(options.targetRootDir), options.templateId);
    if (fs.existsSync(candidateDir)) {
      registerTemplateDirectory(candidateDir);
    }
  }
  const manifest = getTemplateManifest(options.templateId);
  const maxLengthData = buildMaxLengthSlotPayload(manifest);
  const issues: string[] = [];

  try {
    for (const preset of manifest.supportedSizes) {
      const sampleRes: ValidatePostResult = await validateTemplatePost({
        templateId: manifest.id,
        data: manifest.sampleData,
        size: preset,
        theme: manifest.defaultTheme,
        renderer,
      });

      if (!sampleRes.valid) {
        for (const err of sampleRes.schemaErrors) {
          issues.push(`[${preset}/sample] ${err.slot}: ${err.message}`);
        }
        for (const warn of sampleRes.runtimeWarnings) {
          issues.push(`[${preset}/sample] [${warn.code}] ${warn.message}`);
        }
      }

      const maxRes: ValidatePostResult = await validateTemplatePost({
        templateId: manifest.id,
        data: maxLengthData,
        size: preset,
        theme: manifest.defaultTheme,
        renderer,
      });

      if (maxRes.schemaErrors.length > 0) {
        for (const err of maxRes.schemaErrors) {
          issues.push(`[${preset}/max-length] ${err.slot}: ${err.message}`);
        }
      }
    }
  } finally {
    if (ownsRenderer) {
      await renderer.close();
    }
  }

  return {
    ok: issues.length === 0,
    templateId: manifest.id,
    checkedSizes: manifest.supportedSizes,
    issues,
  };
}
