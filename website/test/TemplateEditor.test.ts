import { describe, expect, it } from "vitest";
import { createBlankDocument } from "../src/lib/WorkspaceTemplates.js";
import { artboardDocument, projectFromDocument } from "@tinytldr/core";
import { restorePageJson, pageJsonValue } from "../src/lib/WorkspacePages.js";
import {
  createTemplateJson,
  parseTemplateJson,
  resolveTemplateDocument,
  sameJsonContent,
} from "../src/lib/TemplateEditor.js";

describe("Template JSON editor contract", () => {
  it("restores per-page invalid source verbatim without leaking state across pages or inheriting object prototype keys", () => {
    const project = projectFromDocument(createBlankDocument());
    project.pages.push({
      ...structuredClone(project.pages[0]!),
      id: "constructor",
      title: "Second",
    });
    const restored = restorePageJson(project, {
      pageJson: { "page-1": "{ unfinished first", constructor: "{ unfinished second" },
    });
    expect(restored["page-1"]).toBe("{ unfinished first");
    expect(restored.constructor).toBe("{ unfinished second");
    expect(pageJsonValue({}, "constructor")).toBeUndefined();
    expect(
      parseTemplateJson(pageJsonValue(restorePageJson(project), "constructor")!).sampleData,
    ).toEqual(project.pages[1]!.data);
    expect(artboardDocument(project.pages[1]!, project.size).template).toEqual(
      project.pages[0]!.template,
    );
  });
  it("exposes the active theme, preserves an untouched saved design, and uses JSON defaultTheme for new edits", () => {
    const document = createBlankDocument();
    const otherTheme = Object.keys(document.template.manifest.themes).find(
      (key) => key !== document.theme,
    );
    if (!otherTheme) throw new Error("Expected multiple fixture themes.");
    document.theme = otherTheme;
    const manifest = parseTemplateJson(createTemplateJson(document));
    expect(manifest.defaultTheme).toBe(otherTheme);
    expect(resolveTemplateDocument(document, manifest).document).toEqual(document);
    manifest.defaultTheme = "paper";
    expect(resolveTemplateDocument(document, manifest).document.theme).toBe("paper");
  });

  it("compares nested JSON objects independent of key order while preserving array order and field changes", () => {
    expect(
      sameJsonContent(
        { nested: { b: 2, a: 1 }, list: [1, 2] },
        { list: [1, 2], nested: { a: 1, b: 2 } },
      ),
    ).toBe(true);
    expect(sameJsonContent({ list: [1, 2] }, { list: [2, 1] })).toBe(false);
    expect(sameJsonContent({ headline: "Before" }, { headline: "After" })).toBe(false);
  });
  it("puts MCP fields, examples, and instructions first and roundtrips the authoritative manifest", () => {
    const document = createBlankDocument();
    const text = createTemplateJson(document);
    expect(Object.keys(JSON.parse(text)).slice(0, 3)).toEqual([
      "slots",
      "sampleData",
      "distillationHint",
    ]);
    expect(resolveTemplateDocument(document, parseTemplateJson(text))).toEqual({
      document,
      manifest: document.template.manifest,
    });
  });

  it("does not dirty a saved design whose content differs from the original template examples", () => {
    const document = createBlankDocument();
    document.data.headline = "Actual saved content, not the template example.";
    const result = resolveTemplateDocument(
      document,
      parseTemplateJson(createTemplateJson(document)),
    );
    expect(result.document).toEqual(document);
    expect(result.manifest.sampleData).toEqual(document.data);
    expect(result.document.template.manifest.sampleData).not.toEqual(document.data);
  });

  it("applies sample content and field metadata together without overwriting markup or CSS", () => {
    const document = createBlankDocument();
    const json = JSON.parse(createTemplateJson(document));
    json.sampleData.headline = "A new preview";
    json.slots.headline.maxLength = 90;
    json.distillationHint = "Keep it precise.";
    const result = resolveTemplateDocument(document, parseTemplateJson(JSON.stringify(json)));
    expect(result.document.data.headline).toBe("A new preview");
    expect(result.manifest.slots.headline).toMatchObject({ maxLength: 90 });
    expect(result.manifest.distillationHint).toBe("Keep it precise.");
    expect(result.document.template.liquidTemplate).toBe(document.template.liquidTemplate);
    expect(result.document.template.stylesCss).toBe(document.template.stylesCss);
  });

  it("exposes existing per-design colors in JSON and lets JSON edits replace them without dirtying an untouched design", () => {
    const document = createBlankDocument();
    document.tokenOverrides = { background: "#123456" };
    const manifest = parseTemplateJson(createTemplateJson(document));
    expect(manifest.themes.paper?.background).toBe("#123456");
    expect(resolveTemplateDocument(document, manifest).document).toEqual(document);
    manifest.themes.paper!.background = "#abcdef";
    const result = resolveTemplateDocument(document, manifest).document;
    expect(result.template.manifest.themes.paper?.background).toBe("#abcdef");
    expect(result.tokenOverrides).toEqual({});
  });

  it("rejects malformed JSON and invalid MCP field contracts explicitly", () => {
    const document = createBlankDocument();
    expect(() => parseTemplateJson("{ unfinished")).toThrow();
    const json = JSON.parse(createTemplateJson(document));
    json.slots.headline.type = "unsupported";
    expect(() => parseTemplateJson(JSON.stringify(json))).toThrow();
  });
});
