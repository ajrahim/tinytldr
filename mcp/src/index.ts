import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  SIZE_PRESETS,
  PreviewPostToolSchema,
  ValidatePostToolSchema,
  TemplateKindSchema,
  type SizePresetDefinition,
} from "@tinytldr/core";
import { ChromiumRenderer, previewTemplatePost, validateTemplatePost } from "@tinytldr/renderer";
import { getTemplateManifest, listTemplates } from "@tinytldr/templates";
import { registerRenderTools, type RenderToolOptions } from "./RegisterRenderTools.js";
import { readOnlyTool } from "./ToolAnnotations.js";
import { registerDesignTools, type SavedDesignSource } from "./RegisterDesignTools.js";

export function listSizes(): readonly SizePresetDefinition[] {
  return Object.values(SIZE_PRESETS);
}

export interface TinytldrMcpServerInstance {
  readonly server: McpServer;
  readonly renderer: ChromiumRenderer;
  close(): Promise<void>;
}

export function createTinytldrMcpServer(options?: {
  renderer?: ChromiumRenderer;
  signal?: AbortSignal;
  artifacts?: RenderToolOptions["artifacts"];
  runRender?: RenderToolOptions["runRender"];
  designs?: SavedDesignSource;
}): TinytldrMcpServerInstance {
  const ownsRenderer = !options?.renderer;
  const renderer = options?.renderer ?? new ChromiumRenderer();
  const run = options?.runRender ?? (async <T>(operation: () => Promise<T>) => operation());
  const designs = options?.designs;

  const server = new McpServer({
    name: "tinytldr",
    version: "0.1.0",
  });

  server.registerTool(
    "list_templates",
    {
      title: "List built-in templates",
      description:
        "List the built-in tinytldr templates and size presets, optionally filtered by kind (static, carousel, video), tag, or aspect ratio / size preset.",
      annotations: readOnlyTool("List built-in templates"),
      inputSchema: {
        kind: TemplateKindSchema.optional().describe(
          "Optional template kind filter: 'static', 'carousel', or 'video'.",
        ),
        tag: z
          .string()
          .optional()
          .describe("Optional tag filter (e.g. 'quote', 'metric', 'code', 'x')."),
        aspect: z
          .string()
          .optional()
          .describe(
            "Optional aspect ratio or size preset filter (e.g. '1:1', '4:5', '16:9', 'square', 'x').",
          ),
      },
    },
    async (args) => {
      const templates = listTemplates({
        kind: args.kind,
        tag: args.tag,
        aspect: args.aspect,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                templates,
                sizePresets: SIZE_PRESETS,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_template_schema",
    {
      title: "Get template schema",
      description:
        "Get the full template.json manifest for a built-in template, including slot definitions, character limits, theme tokens, sample data, and distillation guidance.",
      annotations: readOnlyTool("Get template schema"),
      inputSchema: {
        templateId: z
          .string()
          .min(1)
          .describe("Template ID (e.g. 'quote-card', 'stat-callout', 'code-snippet')."),
      },
    },
    async ({ templateId }) => {
      const manifest = getTemplateManifest(templateId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(manifest, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "validate_template_data",
    {
      title: "Validate template data",
      description:
        "Dry-run slot validation and headless Chromium layout/overflow/WCAG contrast checks without writing any files.",
      annotations: readOnlyTool("Validate template data"),
      inputSchema: ValidatePostToolSchema.shape,
    },
    ({ templateId, data, size, theme }) =>
      run(async () => {
        const result = await validateTemplatePost({
          templateId,
          data,
          size,
          theme,
          renderer,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "preview_post",
    {
      title: "Preview post",
      description:
        "Render a fast 1x PNG preview of a post in memory and return an inline image and layout warnings. No files are stored.",
      annotations: readOnlyTool("Preview post"),
      inputSchema: PreviewPostToolSchema.shape,
    },
    ({ templateId, data, size, theme, pageOrTimestamp }) =>
      run(async () => {
        const preview = await previewTemplatePost({
          templateId,
          data,
          size,
          theme,
          pageOrTimestamp,
          renderer,
          ...(options?.artifacts ? { maxLongSidePx: 768 } : {}),
        });
        return {
          content: [
            {
              type: "image",
              data: preview.base64,
              mimeType: "image/png",
            },
            {
              type: "text",
              text: JSON.stringify(
                {
                  width: preview.width,
                  height: preview.height,
                  warnings: preview.warnings,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  registerRenderTools(server, {
    renderer,
    signal: options?.signal,
    artifacts: options?.artifacts,
    runRender: options?.runRender,
  });
  if (designs) registerDesignTools(server, designs);

  server.prompt(
    "distill_to_post",
    "Guide the calling agent to distill long-form source material into a single high-impact social post, preview it, and export the final artifact.",
    {
      source: z.string().describe("Source text, code, or article to distill."),
      platform: z
        .string()
        .optional()
        .describe("Target platform (e.g. 'x', 'linkedin', 'instagram', 'story')."),
      goal: z
        .string()
        .optional()
        .describe(
          "Communication goal (e.g. 'highlight benchmark', 'share quote', 'show code pattern').",
        ),
      preferredKind: z
        .string()
        .optional()
        .describe("Preferred template kind ('static', 'carousel', 'video')."),
    },
    async ({ source, platform, goal, preferredKind }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `You are distilling the following source material into a polished social post using tinytldr MCP tools.`,
              `Target platform: ${platform ?? "square (1:1)"}`,
              `Goal: ${goal ?? "Extract the single sharpest insight or proof point"}`,
              `Preferred kind: ${preferredKind ?? "static"}`,
              ``,
              `Follow this exact workflow:`,
              designs
                ? `1. If the user named their own saved template or design, call 'list_designs' and 'get_design', fill its slots, and export with 'render_workspace'. Otherwise call 'list_templates' and 'get_template_schema' to inspect slot constraints and 'distillationHint'.`
                : `1. Call 'list_templates' and 'get_template_schema' to inspect slot constraints and 'distillationHint'.`,
              `2. Distill the source material so every slot stays within 'recommendedMaxLength' and 'maxLength'.`,
              `3. Call 'validate_template_data' and 'preview_post' to verify there are zero overflow or contrast warnings.`,
              options?.artifacts
                ? `4. Call 'render_post' to get short-lived download URLs, then download the final artifacts before they expire. Do not provide server output paths.`
                : `4. Call 'render_post' to save the final artifact to disk.`,
              ``,
              `SOURCE MATERIAL:`,
              source,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.prompt(
    "repurpose_content",
    "Guide the calling agent to repurpose source material into a coordinated multi-platform social asset pack (X, LinkedIn, Instagram).",
    {
      source: z.string().describe("Source material to repurpose across platforms."),
      platforms: z
        .string()
        .optional()
        .describe("Comma-separated target platforms (default: 'x,linkedin,square,story')."),
    },
    async ({ source, platforms }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Repurpose the following source material into a coordinated multi-asset social pack across: ${platforms ?? "x, linkedin, square, story"}.`,
              `For each target platform:`,
              `1. Select the best matching tinytldr template ('quote-card', 'stat-callout', or 'code-snippet') via 'list_templates'.`,
              `2. Tailor the slot copy to the template's 'distillationHint' and character limits.`,
              options?.artifacts
                ? `3. Run 'preview_post' to check visual balance and warnings, then export via 'render_post' and download its short-lived URLs before expiry. Do not provide server output paths.`
                : `3. Run 'preview_post' to check visual balance and warnings, then export via 'render_post'.`,
              ``,
              `SOURCE MATERIAL:`,
              source,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return {
    server,
    renderer,
    async close() {
      await server.close();
      if (ownsRenderer) {
        await renderer.close();
      }
    },
  };
}

export async function startStdioMcpServer(): Promise<TinytldrMcpServerInstance> {
  const instance = createTinytldrMcpServer();
  const transport = new StdioServerTransport();
  await instance.server.connect(transport);
  return instance;
}

export {
  startTinytldrHttpServer,
  type RenderJobRecord,
  type TinytldrHttpServerOptions,
  type TinytldrHttpServerHandle,
} from "./HttpServer.js";

export {
  scaffoldNewTemplate,
  validateTemplateFullSuite,
  buildMaxLengthSlotPayload,
  type ScaffoldTemplateOptions,
  type ScaffoldTemplateResult,
  type TemplateSuiteValidationResult,
} from "./TemplateAuthoring.js";
