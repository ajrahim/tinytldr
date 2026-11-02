import { useState, useEffect } from "react";
import { SIZE_PRESETS } from "../lib/BrowserCompiler.js";
import {
  buildClaudeCodeInstallCommands,
  buildCodexInstallCommands,
  buildHostedMcpInstallCommands,
  HOSTED_MCP_URL,
} from "../lib/McpSnippetBuilder.js";
import { MCP_PROMPT_DOCS, MCP_TOOL_DOCS } from "../lib/ToolCatalogData.js";
import type { DocsSectionId } from "../state/RouterState.js";
import { CodeSnippetBox } from "../components/CodeSnippetBox.js";

export interface DocsPageProps {
  readonly initialSection?: DocsSectionId;
  readonly onNavigate: (path: string) => void;
}

const SECTION_TABS: readonly {
  readonly id: DocsSectionId;
  readonly label: string;
  readonly path: string;
}[] = [
  { id: "quickstart", label: "Quickstart", path: "/docs" },
  { id: "workflow", label: "Agent Workflow", path: "/docs?section=workflow" },
  { id: "tools", label: "MCP Tools", path: "/docs?section=tools" },
  { id: "authoring", label: "Template Authoring", path: "/docs?section=authoring" },
  { id: "selfHost", label: "Self-Hosting", path: "/docs/self-host" },
  { id: "contribute", label: "Contribute", path: "/contribute" },
];

export function DocsPage({ initialSection = "quickstart", onNavigate }: DocsPageProps) {
  const [activeSection, setActiveSection] = useState<DocsSectionId>(initialSection);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const codexSnippets = buildCodexInstallCommands();
  const claudeSnippets = buildClaudeCodeInstallCommands();
  const hostedSnippets = buildHostedMcpInstallCommands();

  const handleSelectSection = (tab: (typeof SECTION_TABS)[number]) => {
    setActiveSection(tab.id);
    onNavigate(tab.path);
  };

  return (
    <div className="mx-auto w-full min-w-0">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Minimal Left Navigation (Modeled on Image 1) */}
        <aside className="min-w-0 lg:col-span-3">
          <div className="sticky top-0 space-y-1">
            <div
              className="px-2.5 pb-2 font-mono text-[11px] uppercase"
              style={{ color: "var(--ui-text-muted)" }}
            >
              Documentation
            </div>
            {SECTION_TABS.map((tab) => {
              const isSelected = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectSection(tab)}
                  className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-xs font-medium transition ${
                    isSelected ? "ui-pill-active" : "ui-pill-inactive"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Clean Single-Column Editorial Content (Image 1 style) */}
        <div className="min-w-0 space-y-6 lg:col-span-9">
          {activeSection === "quickstart" ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Quickstart with Claude Code &amp; Codex
                </h1>
                <p
                  className="mt-2 text-xs leading-relaxed"
                  style={{ color: "var(--ui-text-secondary)" }}
                >
                  <code>tinytldr</code> runs locally over <code>stdio</code> with zero accounts or
                  API keys. Your coding agent distills the copy; tinytldr renders deterministic
                  PNGs, PDFs, and 30fps MP4 videos.
                </p>
                <div
                  className="mt-8 space-y-3 text-xs leading-loose"
                  style={{ color: "var(--ui-text-secondary)" }}
                >
                  <h2 className="text-sm font-medium" style={{ color: "var(--ui-text)" }}>
                    Or just start creating.
                  </h2>
                  <p>
                    Open a new design without an account. Use the Source editors button to write
                    HTML/Liquid, CSS, and JSON for each artboard. This is your workspace, not a
                    template marketplace.
                  </p>
                  <p>
                    The optional floating AI composer uses your own OpenAI, Claude, Gemini, or
                    approved custom API connection. Sign in and choose Manage connections to save an
                    encrypted key and model. All artboards are included by default; use @ to select
                    pages and + to attach text or image context. Requests send the selected design
                    sources and context to that provider and may incur API usage. Results are
                    unsaved drafts; ordinary editing and local MCP rendering need no API key.
                  </p>
                  <p>
                    When signed in, New design creates a cloud design in your account immediately,
                    without Claim. Later edits still require Save. Guests create local drafts; Save
                    link creates a public viewing link whose private guest edit/claim key stays in
                    this browser. Other visitors can save their own copies, not overwrite yours.
                    Sign in and claim an existing guest design to attach it to your account.
                    Clearing browser storage before claiming loses the private key.
                  </p>
                  <p>
                    My Library saves image uploads and rendered image, video, and PDF exports
                    privately in your Firebase account across devices. Sign in to use it. HTML and
                    JSON source downloads remain local.
                  </p>
                  <button type="button" className="text-link" onClick={() => onNavigate("/studio")}>
                    Create a design &rarr;
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Hosted server</h3>
                <p className="ui-muted text-sm">
                  Add <code>{HOSTED_MCP_URL}</code> to your agent. The first connection opens a
                  tinytldr sign-in page.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <CodeSnippetBox title="Claude Code" badge="CLI" code={hostedSnippets.claude} />
                  <CodeSnippetBox title="OpenAI Codex" badge="CLI" code={hostedSnippets.codex} />
                </div>
                <CodeSnippetBox
                  title="Other MCP clients"
                  badge="JSON"
                  code={hostedSnippets.mcpJson}
                />
              </div>

              <h3 className="text-sm font-semibold">Run locally</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <CodeSnippetBox title="Claude Code" badge="CLI" code={claudeSnippets.cliCommand} />
                <CodeSnippetBox title="OpenAI Codex" badge="CLI" code={codexSnippets.cliCommand} />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <CodeSnippetBox
                  title="~/.codex/config.toml"
                  badge="TOML"
                  code={codexSnippets.configToml}
                />
                <CodeSnippetBox title=".mcp.json" badge="JSON" code={claudeSnippets.mcpJson} />
              </div>

              <CodeSnippetBox
                title="CLI Reference"
                badge="bash"
                code={`npx tinytldr doctor
npx tinytldr list
npx tinytldr inspect quote-card
npx tinytldr render --template quote-card --size square --format png --out ./quote.png
npx tinytldr render --template carousel-slides --size portrait --format pdf --out ./deck.pdf
npx tinytldr render --template kinetic-quote --size story --format mp4 --out ./reel.mp4`}
              />
            </div>
          ) : null}

          {activeSection === "workflow" ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  The 4-Step Calling-Agent Workflow
                </h1>
                <p
                  className="mt-2 text-xs leading-relaxed"
                  style={{ color: "var(--ui-text-secondary)" }}
                >
                  The calling agent already holds your codebase, diff, paper, or thread in context.
                  tinytldr provides the strict schema and deterministic rendering loop.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  {
                    step: "01",
                    title: "Inspect Schema",
                    body: "Call list_templates and get_template_schema to read distillationHint and slot character limits, or author your own template.",
                  },
                  {
                    step: "02",
                    title: "Distill Copy",
                    body: "Summarize the raw source material into tight JSON slots matching the template contract.",
                  },
                  {
                    step: "03",
                    title: "Validate & Preview",
                    body: "Run validate_template_data or preview_post to verify zero overflow and WCAG AA contrast.",
                  },
                  {
                    step: "04",
                    title: "Render Artifact",
                    body: "Call render_post to export 1x/2x PNG, multi-page PDF, or 30fps H.264 MP4.",
                  },
                ].map((item) => (
                  <div key={item.step} className="ui-surface rounded-2xl p-4">
                    <span
                      className="font-mono text-[11px]"
                      style={{ color: "var(--ui-text-muted)" }}
                    >
                      {item.step}
                    </span>
                    <h3 className="mt-1 text-sm font-semibold">{item.title}</h3>
                    <p
                      className="mt-1 text-xs leading-relaxed"
                      style={{ color: "var(--ui-text-secondary)" }}
                    >
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeSection === "tools" ? (
            <div className="space-y-6">
              <h1 className="text-2xl font-semibold tracking-tight">
                MCP Tools, Prompts &amp; Presets
              </h1>

              <div className="space-y-4">
                {MCP_TOOL_DOCS.map((tool) => (
                  <div key={tool.name} className="ui-surface rounded-2xl p-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-mono text-sm font-semibold">{tool.name}</h2>
                      <span
                        className="font-mono text-[10px]"
                        style={{ color: "var(--ui-text-muted)" }}
                      >
                        tool
                      </span>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--ui-text-secondary)" }}>
                      {tool.summary}
                    </p>
                  </div>
                ))}
              </div>

              <div className="ui-surface overflow-hidden rounded-2xl">
                <div className="ui-hairline-b px-4 py-3">
                  <h2 className="text-xs font-semibold">Size Presets</h2>
                </div>
                <table className="w-full text-left text-xs">
                  <thead
                    className="ui-hairline-b font-mono text-[10px] uppercase"
                    style={{ color: "var(--ui-text-muted)" }}
                  >
                    <tr>
                      <th className="px-4 py-2">Preset</th>
                      <th className="px-4 py-2">Dimensions</th>
                      <th className="px-4 py-2">Safe Zone</th>
                      <th className="px-4 py-2">Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(SIZE_PRESETS).map((preset) => (
                      <tr key={preset.id} className="ui-hairline-b last:border-0">
                        <td className="px-4 py-2 font-mono font-medium">{preset.id}</td>
                        <td
                          className="px-4 py-2 font-mono"
                          style={{ color: "var(--ui-text-secondary)" }}
                        >
                          {preset.width} × {preset.height}
                        </td>
                        <td
                          className="px-4 py-2 font-mono text-[11px]"
                          style={{ color: "var(--ui-text-secondary)" }}
                        >
                          {preset.safeZone
                            ? `${preset.safeZone.topPx}px / ${preset.safeZone.bottomPx}px`
                            : "Standard"}
                        </td>
                        <td className="px-4 py-2" style={{ color: "var(--ui-text-secondary)" }}>
                          {preset.label}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {MCP_PROMPT_DOCS.map((prompt) => (
                  <div key={prompt.name} className="ui-surface rounded-2xl p-4">
                    <span className="font-mono text-xs font-semibold">{prompt.name}</span>
                    <p className="mt-1 text-xs" style={{ color: "var(--ui-text-secondary)" }}>
                      {prompt.summary}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeSection === "authoring" ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Template Authoring Guide</h1>
                <p
                  className="mt-2 text-xs leading-relaxed"
                  style={{ color: "var(--ui-text-secondary)" }}
                >
                  Every template lives in its own folder under{" "}
                  <code>packages/templates/templates/&lt;id&gt;/</code> with zero JavaScript inside
                  the template itself.
                </p>
              </div>

              <CodeSnippetBox
                title="Scaffold & Validate a New Template"
                badge="CLI"
                code={`npx tinytldr template new my-card --kind static
npx tinytldr template validate my-card`}
              />

              <CodeSnippetBox
                title="Directory Layout"
                badge="Files"
                code={`packages/templates/templates/<template-id>/
  ├── template.json          # Zod-validated manifest & slot constraints
  ├── template.liquid        # Strict LiquidJS markup with data-tt-slot & data-tt-autofit
  ├── styles.css             # CSS rules + --tt-* theme tokens + @keyframes
  └── samples/
      └── default.json       # Default sample slot payload`}
              />
            </div>
          ) : null}

          {activeSection === "selfHost" ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Self-Hosting the Render Server
                </h1>
                <p
                  className="mt-2 text-xs leading-relaxed"
                  style={{ color: "var(--ui-text-secondary)" }}
                >
                  Run the containerized HTTP MCP + REST render worker with Playwright Chromium,
                  FFmpeg, with Firebase authentication and storage for hosted exports.
                </p>
              </div>

              <CodeSnippetBox
                title="Docker Build & Run"
                badge="bash"
                code={`docker build -t tinytldr:latest .
docker run --rm -p 8787:8787 \\
  -e TINYTLDR_API_KEY="your-secret-token" \\
  tinytldr:latest`}
              />
            </div>
          ) : null}

          {activeSection === "contribute" ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Contribute a Template</h1>
                <p
                  className="mt-2 text-xs leading-relaxed"
                  style={{ color: "var(--ui-text-secondary)" }}
                >
                  Community templates are MIT-licensed folders under{" "}
                  <code>packages/templates/templates/</code> verified by CI across every declared
                  preset.
                </p>
              </div>

              <CodeSnippetBox
                title="Validation Checklist"
                badge="bash"
                code={`npx tinytldr template new <your-template-id>
npx tinytldr template validate <your-template-id>
node scripts/GenerateTemplateCatalog.mjs
pnpm check`}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
