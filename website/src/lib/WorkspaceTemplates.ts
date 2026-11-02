import { WorkspaceDocumentSchema, type WorkspaceDocument } from "@tinytldr/core";
import { getTemplateBundle, getTemplateDefaultSample } from "@tinytldr/templates";

export function createStarterDocument(templateId: string): WorkspaceDocument {
  const template = structuredClone(getTemplateBundle(templateId));
  return WorkspaceDocumentSchema.parse({
    version: 1,
    title: "Untitled design",
    template,
    data: getTemplateDefaultSample(templateId),
    size: template.manifest.defaultSize,
    theme: template.manifest.defaultTheme,
    tokenOverrides: {},
  });
}

export function createBlankDocument(): WorkspaceDocument {
  const base = createStarterDocument("quote-card");
  return WorkspaceDocumentSchema.parse({
    ...base,
    template: {
      manifest: {
        ...base.template.manifest,
        id: "my-template",
        name: "My template",
        kind: "static",
        description: "A personal template.",
        distillationHint: "Write a title and a short supporting thought.",
        author: "You",
        tags: ["personal"],
        slots: {
          headline: {
            type: "string",
            label: "Title",
            description: "The main thought.",
            required: true,
            maxLength: 180,
          },
          body: {
            type: "string",
            label: "A few words",
            description: "Supporting text.",
            required: false,
            maxLength: 600,
          },
          signature: {
            type: "string",
            label: "Signature",
            description: "Your name or handle.",
            required: false,
            maxLength: 80,
          },
        },
        sampleData: {
          headline: "Less, but better.",
          body: "A little space for a good idea.",
          signature: "Made with tinytldr",
        },
        defaultTheme: "paper",
      },
      liquidTemplate: `<main class="post">
  <span class="eyebrow">A SMALL THOUGHT</span>
  <h1 data-tt-slot="headline" data-tt-autofit data-tt-min-font-px="32" data-tt-max-font-px="104">{{ headline }}</h1>
  <p data-tt-slot="body">{{ body }}</p>
  <footer data-tt-slot="signature">{{ signature }}</footer>
</main>`,
      stylesCss: `.post {
  width: 100%; height: 100%; padding: 9%;
  display: flex; flex-direction: column; justify-content: center;
  background: var(--tt-bg); color: var(--tt-text-primary);
}
.eyebrow { font: 14px var(--tt-font-mono); letter-spacing: .16em; color: var(--tt-text-secondary); margin-bottom: 9%; }
h1 { font-family: var(--tt-font-display); font-weight: 600; line-height: 1.08; letter-spacing: -.04em; }
p { font-size: 30px; line-height: 1.6; max-width: 85%; margin-top: 6%; color: var(--tt-text-secondary); }
footer { font-size: 18px; margin-top: 14%; color: var(--tt-text-secondary); }`,
    },
    theme: "paper",
    data: {
      headline: "Less, but better.",
      body: "A little space for a good idea.",
      signature: "Made with tinytldr",
    },
  });
}
