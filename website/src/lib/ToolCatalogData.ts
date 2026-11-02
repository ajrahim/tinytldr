export interface McpToolDocEntry {
  readonly name: string;
  readonly summary: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
    readonly required: boolean;
    readonly description: string;
  }[];
  readonly returns: string;
}

export interface McpPromptDocEntry {
  readonly name: string;
  readonly summary: string;
  readonly arguments: readonly {
    readonly name: string;
    readonly required: boolean;
    readonly description: string;
  }[];
}

export const MCP_TOOL_DOCS: readonly McpToolDocEntry[] = [
  {
    name: "render_workspace",
    summary:
      "Render your authored artboards in order with independent HTML/CSS/JSON, titles, non-rendered purpose descriptions, and one shared size. Download design JSON from the workspace and pass it to this tool; saved links are not accessed automatically.",
    parameters: Object.entries(WorkspaceRenderToolSchema.shape).map(([name, schema]) => ({
      name,
      type: name === "document" ? "WorkspaceProject (v2)" : name === "scale" ? "1 | 2" : "string",
      required: !schema.isOptional(),
      description: schema.description!,
    })),
    returns:
      "Ordered image/video file paths or one multipage PDF, page count, per-file video timing, structured warnings, and a PNG preview no larger than 768px. No full-resolution export bytes in the MCP response.",
  },
  {
    name: "list_templates",
    summary:
      "Discover available built-in MIT social templates filterable by kind, tag, or aspect ratio.",
    parameters: [
      {
        name: "kind",
        type: '"static" | "carousel" | "video"',
        required: false,
        description: "Filter by template output modality.",
      },
      {
        name: "tag",
        type: "string",
        required: false,
        description: "Filter by semantic tag (e.g. quote, metrics, code, paper, video).",
      },
      {
        name: "aspect",
        type: "string",
        required: false,
        description: "Filter by aspect ratio (1:1, 4:5, 9:16, 1.91:1) or size preset ID.",
      },
    ],
    returns:
      "Array of template summaries including id, kind, distillationHint, supportedSizes, themes, and slotNames.",
  },
  {
    name: "get_template",
    summary:
      "Inspect the full Zod-validated manifest, slot constraints, themes, and sample data for a template.",
    parameters: [
      {
        name: "templateId",
        type: "string",
        required: true,
        description: "Template identifier (e.g. quote-card, carousel-slides, kinetic-quote).",
      },
    ],
    returns:
      "Full TemplateManifest JSON with slot definitions (type, maxChars, minItems, maxItems, itemSchema, autofit) and default sample JSON.",
  },
  {
    name: "validate_slots",
    summary:
      "Dry-run slot data validation and headless Chromium layout audit (overflow, WCAG AA contrast, 9:16 safe zones).",
    parameters: [
      {
        name: "templateId",
        type: "string",
        required: true,
        description: "Template identifier.",
      },
      {
        name: "data",
        type: "Record<string, unknown>",
        required: true,
        description: "Distilled slot key/value object written by the calling coding agent.",
      },
      {
        name: "size",
        type: '"square" | "portrait" | "story" | "landscape" | { width, height }',
        required: false,
        description: "Target preset or custom pixel dimensions.",
      },
      {
        name: "theme",
        type: "string",
        required: false,
        description: "Theme name (dark or light).",
      },
    ],
    returns:
      "{ ok, errors, warnings, dimensions } combining schema validation with browser DOM overflow, contrast, and safe-zone diagnostics.",
  },
  {
    name: "preview_post",
    summary:
      "Render a fast <=768px PNG preview image plus structured layout/contrast warnings for visual self-correction.",
    parameters: [
      {
        name: "templateId",
        type: "string",
        required: true,
        description: "Template identifier.",
      },
      {
        name: "data",
        type: "Record<string, unknown>",
        required: true,
        description: "Distilled slot payload.",
      },
      {
        name: "size",
        type: '"square" | "portrait" | "story" | "landscape" | { width, height }',
        required: false,
        description: "Target size preset or custom dimensions.",
      },
      {
        name: "theme",
        type: "string",
        required: false,
        description: "Theme variant (dark or light).",
      },
      {
        name: "pageOrTimestamp",
        type: "number",
        required: false,
        description: "1-based slide index for carousels or timestamp in ms for video templates.",
      },
    ],
    returns:
      "Inline MCP image/png content block (<=768px long edge) + JSON metadata with warnings.",
  },
  {
    name: "render_post",
    summary:
      "Render final production-grade output to disk (png, jpg, webp, multi-page pdf, or 30fps H.264 yuv420p mp4).",
    parameters: [
      {
        name: "templateId",
        type: "string",
        required: true,
        description: "Template identifier.",
      },
      {
        name: "data",
        type: "Record<string, unknown>",
        required: true,
        description: "Validated slot payload.",
      },
      {
        name: "format",
        type: '"png" | "jpg" | "webp" | "pdf" | "mp4"',
        required: false,
        description: "Output format (defaults to png for static, pdf for carousel, mp4 for video).",
      },
      {
        name: "size",
        type: '"square" | "portrait" | "story" | "landscape" | { width, height }',
        required: false,
        description: "Target size preset or custom dimensions.",
      },
      {
        name: "scale",
        type: "1 | 2",
        required: false,
        description: "Device scale factor (1x standard or 2x retina).",
      },
      {
        name: "outputPath",
        type: "string",
        required: false,
        description: "Optional destination file path.",
      },
    ],
    returns:
      "{ outputPaths, format, width, height, scale, pageCount, durationMs, warnings } + inline preview thumbnail.",
  },
];

export const MCP_PROMPT_DOCS: readonly McpPromptDocEntry[] = [
  {
    name: "distill_to_post",
    summary:
      "Guided 4-step workflow instructing the calling agent to inspect a template, distill raw source text into character-bounded slots, preview + self-correct up to 3 rounds, and render.",
    arguments: [
      {
        name: "sourceText",
        required: true,
        description: "Raw article, PR diff, release notes, or research abstract to distill.",
      },
      {
        name: "templateId",
        required: false,
        description: "Preferred template ID (e.g. quote-card, stat-callout, kinetic-quote).",
      },
      {
        name: "platform",
        required: false,
        description: "Target social platform (X, LinkedIn, Instagram, Reels/Shorts).",
      },
    ],
  },
  {
    name: "thread_to_carousel",
    summary:
      "Guided workflow for turning a multi-point thread, paper, or tutorial into a 4–8 slide LinkedIn/Instagram carousel (PDF + numbered PNGs).",
    arguments: [
      {
        name: "sourceText",
        required: true,
        description: "Long-form thread or article to structure into slides.",
      },
      {
        name: "templateId",
        required: false,
        description: "Carousel template ID (carousel-slides or paper-tldr).",
      },
    ],
  },
];
import { WorkspaceRenderToolSchema } from "@tinytldr/core";
