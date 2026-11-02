import { describe, expect, it } from "vitest";
import { WorkspaceDesignDocumentSchema } from "@tinytldr/core";
import { getTemplateBundle } from "@tinytldr/templates";
import { validateHostedRenderBudget } from "../src/HostedRenderBudget.js";

describe("Hosted render budgets use compiled dimensions and frame counts", () => {
  it("allows ordinary exports and rejects exact image-pixel threshold excess", () => {
    expect(() =>
      validateHostedRenderBudget("render_post", {
        templateId: "quote-card",
        format: "png",
        size: { width: 4000, height: 2000 },
      }),
    ).not.toThrow();
    expect(() =>
      validateHostedRenderBudget("render_post", {
        templateId: "quote-card",
        format: "png",
        size: { width: 4001, height: 2000 },
      }),
    ).toThrow("resolution");
    expect(() =>
      validateHostedRenderBudget("render_post", {
        templateId: "quote-card",
        format: "png",
        size: "story",
        scale: 2,
      }),
    ).toThrow("resolution");
  });

  it("uses renderer fallback duration and requested fps without changing the format", () => {
    expect(() =>
      validateHostedRenderBudget("render_post", {
        templateId: "quote-card",
        format: "mp4",
        fps: 30,
        size: { width: 128, height: 128 },
      }),
    ).not.toThrow();
    expect(() =>
      validateHostedRenderBudget("render_post", {
        templateId: "quote-card",
        format: "mp4",
        fps: 60,
        size: { width: 128, height: 128 },
      }),
    ).toThrow("180 video frames");
  });

  it("counts real compiled carousel slide elements and aggregates artboards", () => {
    const template = structuredClone(getTemplateBundle("quote-card"));
    const document = WorkspaceDesignDocumentSchema.parse({
      version: 2,
      title: "Budget fixture",
      size: { width: 4000, height: 2000 },
      pages: [
        {
          id: "page-1",
          title: "Page 1",
          description: "",
          template,
          data: template.manifest.sampleData,
          theme: template.manifest.defaultTheme,
          tokenOverrides: {},
        },
      ],
    });
    document.pages = Array.from({ length: 11 }, (_, index) => ({
      ...structuredClone(document.pages[0]!),
      id: `page-${index}`,
    }));
    expect(() =>
      validateHostedRenderBudget("render_workspace", { document, format: "png" }),
    ).toThrow("80 million");
    document.pages = [document.pages[0]!];
    document.pages[0]!.template.manifest.kind = "carousel";
    document.pages[0]!.template.liquidTemplate = Array.from(
      { length: 21 },
      () => '<div class="tt-slide">Slide</div>',
    ).join("");
    expect(() =>
      validateHostedRenderBudget("render_workspace", { document, format: "png" }),
    ).toThrow("20 slides");
  });

  it("rejects paths, unknown templates and invalid slots with actionable errors", () => {
    expect(() =>
      validateHostedRenderBudget("preview_post", {
        templateId: "quote-card",
        outputPath: "../../escape.png",
      }),
    ).toThrow();
    expect(() => validateHostedRenderBudget("render_post", { templateId: "unknown" })).toThrow(
      "list_templates",
    );
    expect(() =>
      validateHostedRenderBudget("render_post", { templateId: "quote-card", data: {} }),
    ).toThrow();
  });
});
