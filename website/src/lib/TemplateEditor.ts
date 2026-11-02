import {
  TemplateManifestSchema,
  WorkspaceDocumentSchema,
  type TemplateManifest,
  type WorkspaceDocument,
} from "@tinytldr/core";

function visibleManifest(document: WorkspaceDocument): TemplateManifest {
  const themes = { ...document.template.manifest.themes };
  const activeTheme = themes[document.theme];
  if (activeTheme) themes[document.theme] = { ...activeTheme, ...document.tokenOverrides };
  return {
    ...document.template.manifest,
    defaultTheme: document.theme,
    themes,
    sampleData: document.data,
  };
}

export function createTemplateJson(document: WorkspaceDocument): string {
  const manifest = visibleManifest(document);
  const { slots, sampleData, distillationHint, ...rest } = manifest;
  const ordered = { slots, sampleData, distillationHint, ...rest };
  return JSON.stringify(ordered, null, 2);
}

export function parseTemplateJson(templateJson: string): TemplateManifest {
  return TemplateManifestSchema.parse(JSON.parse(templateJson));
}

export function sameJsonContent(left: unknown, right: unknown): boolean {
  const ordered = (_key: string, value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const entries: [string, unknown][] = Object.entries(value);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  };
  return JSON.stringify(left, ordered) === JSON.stringify(right, ordered);
}

export function resolveTemplateDocument(document: WorkspaceDocument, manifest: TemplateManifest) {
  const original = visibleManifest(document);
  // Opening an existing render must not silently rewrite its original template examples.
  const unchanged = sameJsonContent(manifest, original);
  const checked = WorkspaceDocumentSchema.parse({
    ...document,
    data: manifest.sampleData,
    theme: manifest.defaultTheme,
    tokenOverrides: unchanged ? document.tokenOverrides : {},
    template: { ...document.template, manifest: unchanged ? document.template.manifest : manifest },
  });
  return { document: checked, manifest };
}
