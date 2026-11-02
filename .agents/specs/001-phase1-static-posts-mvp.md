# Spec 001: Phase 1 — Static Posts MVP (End-to-End)

- **Status:** Active
- **Phase:** Phase 1
- **Owners:** `packages/core/`, `packages/runtime/`, `packages/templates/`, `packages/renderer/`, `mcp/`, `packages/cli/`

## 1. Objective

Deliver an end-to-end local static post pipeline where an MCP client or CLI user can discover templates, inspect slot schemas and distillation hints, validate slot payloads, render fast 1× inline previews, and export pixel-accurate `png` (`1x` and `2x`), `jpg`, and `webp` social posts from three bundled MIT templates (`quote-card`, `stat-callout`, `code-snippet`) using bundled OFL fonts with zero network calls.

## 2. Package Deliverables

### 2.1 `@tinytldr/core` (`packages/core/`)

- **`TemplateManifestSchema` (Zod):**
  - `id`: kebab-case identifier (`^[a-z0-9-]+$`)
  - `name`: human-readable name
  - `version`: semver string
  - `kind`: `"static" | "carousel" | "video"`
  - `description`: summary and distillation guidance
  - `tags`: string array (`quote`, `metric`, `code`, `x`, `linkedin`, `instagram`, etc.)
  - `defaultSize`: `SizePresetId`
  - `supportedSizes`: `SizePresetId[]`
  - `durationMs`: optional positive integer (for `video`)
  - `fps`: optional positive integer (default `30` for `video`)
  - `slots`: map of slot definitions (`type`: `"string" | "string[]" | "number" | "enum" | "code" | "image" | "boolean" | "slides"`, `required`, `label`, `description`, `maxLength`, `recommendedMaxLength`, `maxLines`, `maxItems`, `minItems`, `enumValues`, `defaultValue`, `autofit?: { minFontPx: number; maxFontPx: number; maxLines?: number }`)
  - `themes`: map of named theme token objects (`background`, `surface`, `surfaceElevated`, `textPrimary`, `textSecondary`, `textMuted`, `accent`, `accentSecondary`, `border`, `badgeBg`, `badgeText`, `codeBg`, `codeText`)
  - `defaultTheme`: string key in `themes`
  - `sampleData`: valid default slot payload
  - `author`: string
  - `license`: `"MIT"`
- **`validateSlotData(manifest, data, options)`:**
  - Applies defaults for omitted optional slots.
  - Enforces required slots, types, `maxLength`, `maxItems`, `minItems`, and `enumValues`.
  - Emits non-fatal warnings when a string exceeds `recommendedMaxLength`.
- **`compileTemplate(bundle, options)`:**
  - Uses a locked-down `Liquid` instance (`outputEscape: "escape"`, filesystem access disabled).
  - Resolves theme tokens (`theme` name + optional `themeOverrides`) into CSS custom properties (`--tt-bg`, `--tt-surface`, `--tt-text-primary`, etc.).
  - Produces a complete, self-contained HTML document with embedded OFL `@font-face` rules, CSS reset, theme tokens, template stylesheet, rendered Liquid body, and injected `@tinytldr/runtime`.

### 2.2 `@tinytldr/runtime` (`packages/runtime/`)

- **Auto-Fit Text (`[data-tt-autofit]`):**
  - After `document.fonts.ready`, runs a deterministic binary search between `data-tt-min-font-px` and `data-tt-max-font-px` (0.5px precision) so text fits within its container height/width and optional `data-tt-max-lines` line count.
  - If content still overflows at `min-font-px`, records an `overflow` warning with slot name and selector.
- **Layout & Accessibility Warnings:**
  - `overflow`: slot overflows its clipping container or viewport bounds.
  - `contrast`: slot foreground vs. effective background luminance contrast ratio falls below WCAG AA (`4.5:1` normal text, `3.0:1` large text `>= 24px` or `>= 18.66px` bold).
  - `missing-image`: `<img>` element failed to load (`!img.complete || img.naturalWidth === 0`).

### 2.3 `@tinytldr/templates` (`packages/templates/`)

- **Bundled OFL Fonts (`packages/templates/assets/fonts/`):**
  - `Inter` (Sans UI/body), `Fraunces` (Editorial display serif), `JetBrains Mono` (Code monospace), `Space Grotesk` (Geometric metric/display sans) with `OFL.txt` license notices and offline `@font-face` CSS.
- **3 Phase 1 Static Templates:**
  1. `quote-card`: Editorial quote/insight card with quotation mark accent, auto-fit quote body, author name, role/company, handle, category tag, and monogram/avatar badge.
  2. `stat-callout`: High-impact metric/benchmark card with eyebrow label, hero stat value, delta pill (`+42%`, `3.4x`), headline explanation, supporting bullet/context bars, and source footnote.
  3. `code-snippet`: Developer code card with macOS-style window header, filename tab, language pill, line-numbered code block, key takeaway banner, and footer attribution.

### 2.4 `@tinytldr/renderer` (`packages/renderer/`)

- Renders compiled template bundles or raw HTML to `png`, `jpg`, `webp`, `pdf`, and `mp4`.
- Supports `scale: 1 | 2` (`deviceScaleFactor`), dry-run layout validation (`validateLayout`), and fast 1× PNG `previewDataUrl` (`data:image/png;base64,...`).

### 2.5 `@tinytldr/mcp` (`mcp/`) & `tinytldr` CLI (`packages/cli/`)

- **MCP Tools:** `list_templates`, `get_template_schema`, `validate_template_data`, `preview_post`, `render_post`.
- **MCP Prompts:** `distill_to_post`, `repurpose_content`.
- **CLI Commands:** `mcp`, `list`, `inspect`, `validate`, `preview`, `render`, `doctor`.

## 3. Verification Criteria

- Unit tests for manifest validation, slot validation, and LiquidJS escaping/compilation.
- Golden visual regression tests for `quote-card`, `stat-callout`, and `code-snippet` (`<= 0.1%` pixel diff via `pixelmatch`, plus byte/pixel determinism across two consecutive runs).
- End-to-end MCP client test invoking `list_templates` → `get_template_schema` → `validate_template_data` → `preview_post` → `render_post`.
- `pnpm check` passes with 0 errors and 0 warnings.
