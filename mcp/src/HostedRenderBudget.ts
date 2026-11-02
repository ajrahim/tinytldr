import {
  HostedRenderPostToolSchema,
  HostedWorkspaceRenderToolSchema,
  PreviewPostToolSchema,
  ValidatePostToolSchema,
  validateSlotData,
} from "@tinytldr/core";
import { inspectTemplateRenderWork, type RenderPostOptions } from "@tinytldr/renderer";
import { getTemplateManifest, listTemplates } from "@tinytldr/templates";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

export function validateHostedRenderBudget(name: string, argumentsValue: unknown) {
  let staticPixels = 0;
  let videoPixels = 0;
  let frames = 0;

  function add(options: Omit<RenderPostOptions, "outputPath">) {
    if (
      !options.templateBundle &&
      !listTemplates().some((template) => template.id === options.templateId)
    )
      throw new InvalidRequestError("Unknown template ID. Use list_templates first.");
    const manifest = options.templateBundle?.manifest ?? getTemplateManifest(options.templateId);
    const validation = validateSlotData(manifest, options.data ?? manifest.sampleData);
    if (!validation.valid)
      throw new InvalidRequestError(validation.errors.map((issue) => issue.message).join("; "));
    const work = inspectTemplateRenderWork(options);
    const format =
      options.format ??
      (manifest.kind === "video" ? "mp4" : manifest.kind === "carousel" ? "pdf" : "png");
    const video = format === "mp4";
    const scale = video ? 1 : (options.scale ?? 1);
    const width = video ? Math.ceil(work.width / 2) * 2 : work.width * scale;
    const height = video ? Math.ceil(work.height / 2) * 2 : work.height * scale;
    const pixels = width * height;
    if (width > 4096 || height > 4096 || pixels > (video ? 4_000_000 : 8_000_000))
      throw new InvalidRequestError(
        "Hosted export resolution is too large. Reduce size or image scale.",
      );
    if (work.slideCount > 20)
      throw new InvalidRequestError("Hosted exports support at most 20 slides per page.");
    if (video) {
      const count = Math.max(1, Math.round((work.durationMs / 1000) * work.fps));
      frames += count;
      videoPixels += count * pixels;
    } else {
      staticPixels += pixels * work.slideCount;
    }
    if (frames > 180 || videoPixels > 480_000_000 || staticPixels > 80_000_000)
      throw new InvalidRequestError(
        "Hosted batch exceeds its render budget (180 video frames, 480 million video pixels, or 80 million image pixels). Reduce pages, duration, frame rate or size.",
      );
  }

  if (name === "render_workspace") {
    const args = HostedWorkspaceRenderToolSchema.parse(argumentsValue);
    for (const page of args.document.pages) {
      add({
        templateId: page.template.manifest.id,
        templateBundle: page.template,
        data: page.data,
        size: args.document.size,
        theme: page.theme,
        themeOverrides: page.tokenOverrides,
        format: args.format,
        scale: args.scale,
      });
    }
    return;
  }
  if (name === "render_post") {
    const args = HostedRenderPostToolSchema.parse(argumentsValue);
    add(args);
    return;
  }
  if (name === "preview_post") {
    add({ ...PreviewPostToolSchema.strict().parse(argumentsValue), format: "png" });
    return;
  }
  if (name === "validate_template_data") {
    add({ ...ValidatePostToolSchema.strict().parse(argumentsValue), format: "png" });
  }
}
