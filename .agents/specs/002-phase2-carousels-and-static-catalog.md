# Spec 002: Phase 2 — Carousels, Multi-Page PDF, Safe Zones & Full Static Catalog

- **Status:** Active
- **Phase:** Phase 2
- **Owners:** `packages/core/`, `packages/runtime/`, `packages/templates/`, `packages/renderer/`

## 1. Objective

Expand `tinytldr` to the complete static template catalog (7 static templates total) plus 2 multi-slide carousel templates (`carousel-slides`, `paper-tldr`), supporting multi-file slide image export (`out-01.png` … `out-0N.png`), multi-page exact-pixel PDF export for LinkedIn document posts, and `story` (`9:16`) safe-zone enforcement.

## 2. Deliverables

### 2.1 Static Template Additions (`packages/templates/templates/`)

1. `tweet-thread-summary`: Hook headline, author header + handle, and 3–5 numbered thread takeaways.
2. `changelog-card`: Version pill (`v0.2.0`), release date, headline, and categorized release notes (`NEW`, `IMPROVED`, `FIXED`).
3. `steps-checklist`: Actionable 3–5 step workflow card with step numbers, titles, and concise descriptions.
4. `vs-comparison`: Two-column `Before vs. After` or `Option A vs. Option B` comparison card with contrasting rows and bottom verdict banner.

### 2.2 Carousel Templates (`packages/templates/templates/`)

1. `carousel-slides`: General-purpose 3–10 slide swipeable deck with cover hook slide, numbered content slides, progress indicator, and closing CTA slide.
2. `paper-tldr`: Research paper / RFC distillation deck (Cover title + authors + venue, Problem/Method slide, Key Results/Metrics slide, Practical Takeaways slide).

### 2.3 Multi-Slide & Safe-Zone Engine (`@tinytldr/core`, `@tinytldr/runtime`, `@tinytldr/renderer`)

- **Carousel DOM Contract:**
  - Carousel templates render `<section class="tt-slide" data-tt-slide-index="0">...</section>` elements, each `var(--tt-width)` by `var(--tt-height)`.
  - `html, body` allow vertical stacking of `.tt-slide` elements for multi-page PDF printing (`break-after: page; page-break-after: always;`).
  - For image export (`png`, `jpg`, `webp`), `ChromiumRenderer` captures each `.tt-slide` bounding box into numbered files (`<stem>-01.<ext>`, `<stem>-02.<ext>`, …) and returns all paths in `outputPaths` and `pageCount: N`.
  - For PDF export (`pdf`), `ChromiumRenderer` renders all slides into a single multi-page PDF where `inspectPdfBuffer(buffer).pageCount === N` and each page MediaBox equals `width × height` at 96 DPI.
- **Safe-Zone Validation (`story` 1080×1920):**
  - When a size preset defines a `safeZone` (`topPx: 250`, `bottomPx: 340` on `story`), `compileTemplate` sets `data-tt-safe-top` and `data-tt-safe-bottom` on `<body>` and `--tt-safe-top: 250px; --tt-safe-bottom: 340px;` on `:root`.
  - `@tinytldr/runtime` checks all `[data-tt-slot]` elements against the safe zone and emits a `safe_zone` warning if any slot intrudes into the top or bottom reserved UI overlay regions.

## 3. Verification Criteria

- Golden visual regression tests for all 4 new static templates (`tweet-thread-summary`, `changelog-card`, `steps-checklist`, `vs-comparison`) and cover slides of both carousel templates (`carousel-slides`, `paper-tldr`).
- Multi-slide carousel image export test verifying `N` numbered PNG files (`1080×1080` or `1080×1350` each) and multi-page PDF export test verifying `pageCount === N` and exact MediaBox dimensions.
- Safe-zone warning test verifying `story` preset flags slots intruding into the top 250px or bottom 340px.
- `pnpm check` passes with 0 errors and 0 warnings.
