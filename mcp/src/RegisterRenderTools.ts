import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  HostedRenderPostToolSchema,
  HostedWorkspaceRenderToolSchema,
  HostedRenderedExportSchema,
  RenderPostToolSchema,
  WorkspaceRenderToolSchema,
  type RenderPostToolInput,
} from "@tinytldr/core";
import {
  previewTemplatePost,
  renderTemplatePost,
  renderWorkspaceProject,
  type ChromiumRenderer,
  type RenderOutputFormat,
  type RenderPostOutput,
} from "@tinytldr/renderer";
import { exportTool } from "./ToolAnnotations.js";
import { getTemplateManifest } from "@tinytldr/templates";

export interface HostedArtifactPublisher {
  path(format: RenderOutputFormat): string;
  publish(paths: readonly string[]): Promise<{ url: string; filename: string }[]>;
}

export interface RenderToolOptions {
  renderer: ChromiumRenderer;
  signal?: AbortSignal;
  artifacts?: HostedArtifactPublisher;
  runRender?: <T>(operation: () => Promise<T>) => Promise<T>;
}

export function registerRenderTools(server: McpServer, options: RenderToolOptions) {
  const { renderer, artifacts } = options;
  const run = options.runRender ?? (async <T>(operation: () => Promise<T>) => operation());

  async function reply(
    result: RenderPostOutput,
    format: RenderOutputFormat,
    previewDataUrl: string,
  ) {
    let metadata: object = result;
    if (artifacts) {
      const published = await artifacts.publish(result.outputPaths);
      metadata = HostedRenderedExportSchema.parse({
        status: "completed",
        format,
        assets: published,
        width: result.width,
        height: result.height,
        pageCount: result.pageCount,
        durationMs: result.durationMs,
        warnings: result.warnings,
        bytes: result.bytes,
        nextStep: "Download the signed URLs promptly; they expire in five minutes.",
      });
    }
    return {
      content: [
        {
          type: "image" as const,
          data: previewDataUrl.replace(/^data:image\/png;base64,/, ""),
          mimeType: "image/png",
        },
        { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
      ],
    };
  }

  async function post(args: RenderPostToolInput) {
    const manifest = getTemplateManifest(args.templateId);
    const format =
      args.format ??
      (manifest.kind === "video" ? "mp4" : manifest.kind === "carousel" ? "pdf" : "png");
    const result = await renderTemplatePost({ ...args, format, renderer, signal: options.signal });
    const previewDataUrl = artifacts
      ? (await previewTemplatePost({ ...args, renderer, maxLongSidePx: 768 })).previewDataUrl
      : result.previewDataUrl;
    return reply(result, format, previewDataUrl);
  }

  const postDescription =
    "Render a social post, carousel, or animated video and return dimensions, byte size, a preview, and warnings.";
  if (artifacts) {
    server.registerTool(
      "render_post",
      {
        title: "Export post",
        description: `${postDescription} Hosted exports are stored privately and returned as short-lived signed download URLs.`,
        annotations: exportTool("Export post", false),
        inputSchema: HostedRenderPostToolSchema.shape,
      },
      (args) =>
        run(() => {
          const kind = getTemplateManifest(args.templateId).kind;
          const format =
            args.format ?? (kind === "video" ? "mp4" : kind === "carousel" ? "pdf" : "png");
          return post({ ...args, format, outputPath: artifacts.path(format) });
        }),
    );
    server.registerTool(
      "render_workspace",
      {
        title: "Export design",
        description:
          "Render a version-2 design JSON document (a saved design or a downloaded design.json) with up to 20 independent artboards. Images and videos return files in page order; PDF returns one multipage document. Returns short-lived signed download URLs and a small preview. Saved designs are not modified.",
        annotations: exportTool("Export design", false),
        inputSchema: HostedWorkspaceRenderToolSchema.shape,
      },
      (args) =>
        run(async () => {
          const result = await renderWorkspaceProject({
            ...args,
            outputPath: artifacts.path(args.format),
            renderer,
            signal: options.signal,
          });
          return reply(result, args.format, result.previewDataUrl);
        }),
    );
  } else {
    server.registerTool(
      "render_post",
      {
        title: "Export post",
        description:
          "Render a social post, carousel, or animated video to disk and return output paths, dimensions, byte size, inline previewDataUrl, and warnings.",
        annotations: exportTool("Export post", true),
        inputSchema: RenderPostToolSchema.shape,
      },
      (args) => run(() => post(args)),
    );
    server.registerTool(
      "render_workspace",
      {
        title: "Export design",
        annotations: exportTool("Export design", true),
        inputSchema: WorkspaceRenderToolSchema.shape,
        description:
          "Render an authored version-2 design JSON with up to 20 independent artboards in page order. Each page has its own HTML/CSS/template manifest, title and non-rendered purpose description; size is shared. Images and videos return one or more files; PDF returns one multipage document. This does not access browser drafts or saved links. Example: pass downloaded design.json as document, format:'pdf', outputPath:'./design.pdf'.",
      },
      (args) =>
        run(async () => {
          const result = await renderWorkspaceProject({
            ...args,
            renderer,
            signal: options.signal,
          });
          const { previewDataUrl, ...metadata } = result;
          return {
            content: [
              {
                type: "image" as const,
                data: previewDataUrl.replace(/^data:image\/png;base64,/, ""),
                mimeType: "image/png",
              },
              { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
            ],
          };
        }),
    );
  }
}
