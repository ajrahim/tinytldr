---
name: tinytldr
description: Turns articles, diffs, papers, changelogs, and notes into deterministic social posts (PNG/JPEG/WebP), multi-slide carousels (PDF/PNG), and animated MP4 videos using the tinytldr MCP server or CLI. Use when asked to create social cards, X/LinkedIn/Instagram posts, carousels, changelog graphics, code snippet cards, or short animated videos from source material.
---

# tinytldr — Agent Distillation & Rendering Workflow

`tinytldr` is a **pure deterministic rendering engine**. It never calls an LLM or external API. **You (the calling coding agent)** perform all content distillation, copywriting, and summarization, and then invoke `tinytldr` MCP tools (or the `tinytldr` CLI) to validate, preview, and render pixel-accurate assets.

## 4-Step Agent Loop

> **Using the user's own saved design?** On the hosted server, when the user names their own template or design (for example "my Weekly template"), call `list_designs` → `get_design`, replace the copy in `pages[].data` within each page's slot limits, and export with `render_workspace`. Don't substitute a built-in template.

### 1. Discover the right template (`list_templates` → `get_template_schema`)

Call `list_templates` with optional filters (`kind: "static" | "carousel" | "video"`, `tag`, or `aspect`) to pick the best template for the user's goal:

- **Static (`png`, `jpg`, `webp`, `pdf`)**:
  - `quote-card` — Sharp single-insight quote with speaker attribution
  - `stat-callout` — Big hero metric with delta badge and context
  - `code-snippet` — Syntax-highlighted code block with window chrome and annotation
  - `tweet-thread-summary` — Numbered multi-point thread digest
  - `changelog-card` — Version release notes with NEW/IMPROVED/FIXED pills
  - `steps-checklist` — Step-by-step actionable playbook
  - `vs-comparison` — Side-by-side Legacy vs Modern comparison card
- **Carousel (`pdf`, multi-slide `png`)**:
  - `carousel-slides` — Cover + N numbered insight slides + CTA slide (LinkedIn PDF & Instagram 4:5)
  - `paper-tldr` — Research paper breakdown (Problem, Method, Result, Takeaway)
- **Video (`mp4`, 30 fps H.264)**:
  - `kinetic-quote` — Staggered word-by-word kinetic typography reveal
  - `timeline-reveal` — Chronological milestone reveal with animated connector rail
  - `stat-counter` — Animated numeric counter with progress bar

Next, call `get_template_schema` with `templateId` and read:

- `distillationHint`: exact guidance on tone, pacing, and structure
- `slots`: required fields, `maxLength`, `recommendedMaxLength`, `minItems`/`maxItems`, and `itemSchema`
- `supportedSizes`: `square` (1080×1080), `portrait` (1080×1350), `story` (1080×1920), `x` (1600×900), `og` (1200×630), `linkedin` (1200×627)

### 2. Distill the source material to fit slot budgets

Write tight, high-signal copy that stays comfortably under each slot's `recommendedMaxLength` and strictly under `maxLength`:

- Strip filler phrases and hedging.
- Lead with concrete numbers, verbs, or sharp contrasts.
- Keep bullet items and carousel slide bodies parallel in structure and length.

### 3. Validate and preview (`validate_template_data` → `preview_post`)

Before rendering the final asset, call `validate_template_data` (or `preview_post`) and inspect:

- `schemaErrors`: missing required slots or hard constraint violations
- `runtimeWarnings`:
  - `overflow`: text overflows its container even at `minFontPx` — shorten the offending slot
  - `autofit-minimum-reached`: text shrank to its minimum font size — consider trimming 15–25% of characters
  - `contrast-violation`: WCAG AA contrast check failed on a custom `themeOverrides` color

Iterate on your slot payload until `valid: true` and `runtimeWarnings` is empty.

### 4. Render the final artifact (`render_post`)

Call `render_post` with:

- `templateId`, `data`, `size`, `theme`
- `format`: `"png"` (default for static), `"pdf"` (default for LinkedIn carousels), or `"mp4"` (for video templates)
- `scale`: `1` (standard 1080p) or `2` (retina 2× for crisp static cards)
- `outputPath`: destination path in the user's workspace
