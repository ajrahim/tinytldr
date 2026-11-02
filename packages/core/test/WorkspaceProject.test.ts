import { describe, expect, it } from "vitest";
import {
  artboardDocument,
  projectFromDocument,
  WorkspaceDocumentSchema,
  WorkspaceDesignDocumentSchema,
  WorkspaceProjectSchema,
  WorkspaceRenderToolSchema,
} from "../src/index.js";

function pageDocument() {
  return WorkspaceDocumentSchema.parse({
    version: 1,
    title: "Existing design",
    size: "square",
    theme: "light",
    tokenOverrides: { accent: "#aabbcc" },
    data: { headline: "Actual saved content" },
    template: {
      liquidTemplate: "<main>{{ headline }}</main>",
      stylesCss: "main { padding: 20px; }",
      manifest: {
        id: "artboard-test",
        name: "Artboard test",
        version: "1.0.0",
        kind: "static",
        description: "A test.",
        distillationHint: "Write a short headline.",
        author: "tinytldr",
        license: "MIT",
        tags: ["test"],
        defaultSize: "square",
        supportedSizes: ["square", "x"],
        defaultTheme: "light",
        themes: {
          light: {
            name: "Light",
            background: "#ffffff",
            surface: "#ffffff",
            surfaceElevated: "#ffffff",
            textPrimary: "#000000",
            textSecondary: "#111111",
            textMuted: "#222222",
            accent: "#123456",
            accentSecondary: "#123456",
            border: "#dddddd",
            badgeBg: "#ffffff",
            badgeText: "#000000",
          },
        },
        slots: {
          headline: {
            type: "string",
            label: "Headline",
            description: "A headline.",
            required: true,
          },
        },
        sampleData: { headline: "Original example" },
      },
    },
  });
}

describe("Versioned artboard document contracts", () => {
  it("requires v2 at workspace boundaries while preserving per-page operations", () => {
    const page = pageDocument();
    expect(WorkspaceDesignDocumentSchema.safeParse(page).success).toBe(false);
    const project = WorkspaceDesignDocumentSchema.parse(projectFromDocument(page));
    expect(project.version).toBe(2);
    expect(project.pages).toHaveLength(1);
    expect(artboardDocument(project.pages[0]!, project.size)).toEqual({
      ...page,
      title: "Page 1",
    });
    expect(WorkspaceDesignDocumentSchema.parse(project)).toEqual(project);
    expect(
      WorkspaceRenderToolSchema.safeParse({
        document: page,
        format: "pdf",
        outputPath: "design.pdf",
      }).success,
    ).toBe(false);
  });

  it("retains independent sources, page order and purpose metadata with one shared size", () => {
    const project = projectFromDocument(pageDocument());
    project.pages.push({
      ...structuredClone(project.pages[0]!),
      id: "body",
      title: "Body",
      description: "Explain the supporting evidence.",
      template: { ...project.pages[0]!.template, stylesCss: "main { color: red; }" },
    });
    project.pages[0]!.description = "Hook the reader.";
    project.size = "x";
    const checked = WorkspaceProjectSchema.parse(project);
    expect(checked.pages.map((page) => page.title)).toEqual(["Page 1", "Body"]);
    expect(checked.pages.map((page) => page.description)).toEqual([
      "Hook the reader.",
      "Explain the supporting evidence.",
    ]);
    expect(checked.pages[0]!.template.stylesCss).not.toBe(checked.pages[1]!.template.stylesCss);
    expect(checked.pages.map((page) => artboardDocument(page, checked.size).size)).toEqual([
      "x",
      "x",
    ]);
    expect(
      WorkspaceRenderToolSchema.parse({
        document: project,
        format: "pdf",
        outputPath: "design.pdf",
      }).document,
    ).toEqual(checked);
  });

  it("rejects empty/oversized collections, duplicate IDs, missing themes, and a shared preset unsupported by any page", () => {
    const project = projectFromDocument(pageDocument());
    expect(WorkspaceProjectSchema.safeParse({ ...project, pages: [] }).success).toBe(false);
    expect(
      WorkspaceProjectSchema.safeParse({ ...project, pages: [project.pages[0], project.pages[0]] })
        .success,
    ).toBe(false);
    const pages = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(project.pages[0]!),
      id: `page-${index + 1}`,
    }));
    expect(WorkspaceProjectSchema.safeParse({ ...project, pages }).success).toBe(true);
    expect(
      WorkspaceProjectSchema.safeParse({
        ...project,
        pages: [...pages, { ...pages[0], id: "page-21" }],
      }).success,
    ).toBe(false);
    pages[1]!.theme = "missing";
    expect(WorkspaceProjectSchema.safeParse({ ...project, pages }).success).toBe(false);
    pages[1]!.theme = "light";
    pages[1]!.template.manifest.supportedSizes = ["x"];
    pages[1]!.template.manifest.defaultSize = "x";
    expect(WorkspaceProjectSchema.safeParse({ ...project, pages }).success).toBe(false);
  });

  it("enforces page-purpose and total design size budgets without allowing metadata to become source", () => {
    const project = projectFromDocument(pageDocument());
    expect(
      WorkspaceProjectSchema.safeParse({
        ...project,
        pages: [{ ...project.pages[0], description: "x".repeat(2001) }],
      }).success,
    ).toBe(false);
    const pages = Array.from({ length: 5 }, (_, index) => ({
      ...project.pages[0]!,
      id: `page-${index}`,
      template: { ...project.pages[0]!.template, stylesCss: "x".repeat(90_000) },
    }));
    expect(WorkspaceProjectSchema.safeParse({ ...project, pages }).success).toBe(false);
    project.pages[0]!.description = "<script>not render content</script>";
    expect(
      artboardDocument(WorkspaceProjectSchema.parse(project).pages[0]!, project.size),
    ).not.toHaveProperty("description");
  });
});
