import { describe, expect, it } from "vitest";
import {
  compileTemplate,
  TemplateManifestSchema,
  validateSlotData,
  type TemplateBundle,
} from "../src/index.js";

const SAMPLE_BUNDLE: TemplateBundle = {
  manifest: TemplateManifestSchema.parse({
    id: "test-quote",
    name: "Test Quote",
    version: "1.0.0",
    kind: "static",
    description: "Test quote template",
    distillationHint: "Keep quote under 180 characters.",
    tags: ["quote", "test"],
    defaultSize: "square",
    supportedSizes: ["square", "portrait", "x"],
    defaultTheme: "dark",
    themes: {
      dark: {
        name: "Dark",
        background: "#0b0f19",
        surface: "#111827",
        surfaceElevated: "#1f2937",
        textPrimary: "#f9fafb",
        textSecondary: "#cbd5e1",
        textMuted: "#64748b",
        accent: "#38bdf8",
        accentSecondary: "#818cf8",
        border: "#1e293b",
        badgeBg: "#1e293b",
        badgeText: "#38bdf8",
      },
    },
    slots: {
      quote: {
        type: "string",
        label: "Quote",
        description: "Primary quote text",
        required: true,
        maxLength: 280,
        recommendedMaxLength: 160,
      },
      author: {
        type: "string",
        label: "Author",
        description: "Speaker name",
        required: true,
        maxLength: 60,
      },
      category: {
        type: "string",
        label: "Category",
        description: "Optional badge",
        required: false,
        defaultValue: "INSIGHT",
      },
      avatarUrl: {
        type: "image",
        label: "Avatar",
        description: "Optional avatar data URL",
        required: false,
      },
    },
    sampleData: {
      quote: "Deterministic rendering beats flaky screenshots.",
      author: "Ada Lovelace",
    },
    author: "tinytldr",
    license: "MIT",
  }),
  liquidTemplate: `<div class="card"><span class="badge">{{ category }}</span><blockquote data-tt-slot="quote">{{ quote }}</blockquote><p>{{ author }} ({{ author | initials }})</p></div>`,
  stylesCss: `.card { width: 100%; height: 100%; }`,
};

describe("@tinytldr/core schema, validation, and Liquid compiler", () => {
  it("applies default slot values and emits recommendedMaxLength warnings", () => {
    const longQuote = "A".repeat(180);
    const result = validateSlotData(SAMPLE_BUNDLE.manifest, {
      quote: longQuote,
      author: "Grace Hopper",
    });

    expect(result.valid).toBe(true);
    expect(result.normalizedData.category).toBe("INSIGHT");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("recommended-length");
  });

  it("rejects missing required slots, maxLength violations, and remote image URLs by default", () => {
    const result = validateSlotData(SAMPLE_BUNDLE.manifest, {
      quote: "B".repeat(300),
      avatarUrl: "https://example.com/avatar.png",
    });

    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("missing-required");
    expect(codes).toContain("max-length");
    expect(codes).toContain("remote-asset-blocked");
  });

  it("escapes HTML in slot values and injects theme variables and runtime script", () => {
    const compiled = compileTemplate(SAMPLE_BUNDLE, {
      data: {
        quote: `<script>alert("xss")</script> & fast`,
        author: "Alan Turing",
      },
      size: "x",
    });

    expect(compiled.width).toBe(1600);
    expect(compiled.height).toBe(900);
    expect(compiled.html).not.toContain("<script>alert");
    expect(compiled.html).toContain("&lt;script&gt;alert(");
    expect(compiled.html).toContain("&amp; fast");
    expect(compiled.html).toContain("Alan Turing (AT)");
    expect(compiled.html).toContain("--tt-bg: #0b0f19;");
    expect(compiled.html).toContain("window.__tinytldr");
  });

  it("blocks Liquid filesystem tags (include/render/layout)", () => {
    const badBundle: TemplateBundle = {
      ...SAMPLE_BUNDLE,
      liquidTemplate: `{% include 'secret.liquid' %}`,
    };
    expect(() => compileTemplate(badBundle)).toThrow(/disallowed filesystem tags/i);
  });

  it("allows ordinary layout/render words in custom markup while still blocking actual filesystem tags", () => {
    expect(
      compileTemplate({
        ...SAMPLE_BUNDLE,
        liquidTemplate: '<div class="layout">A better render</div>',
      }).html,
    ).toContain('class="layout"');
    for (const tag of ["include", "render", "layout"]) {
      expect(() =>
        compileTemplate({ ...SAMPLE_BUNDLE, liquidTemplate: `{%- ${tag} 'private' -%}` }),
      ).toThrow(/filesystem tags/);
    }
  });

  it("bounds parsing and allocation for untrusted personal templates", () => {
    expect(() =>
      compileTemplate({ ...SAMPLE_BUNDLE, liquidTemplate: "x".repeat(100_001) }),
    ).toThrow(/limit/i);
    expect(() =>
      compileTemplate({
        ...SAMPLE_BUNDLE,
        liquidTemplate: "{% for n in (1..1000000000) %}{{ n }}{% endfor %}",
      }),
    ).toThrow(/limit/i);
  });
});
