# Artboard workspace

Status: Shipped. User approved independent HTML/CSS/JSON per artboard and one shared size for the whole design.

## Scope

- Horizontal artboards with editable titles above and purpose descriptions below; select a board to edit its source.
- Add/remove pages (at least one, up to 20). Preserve source, raw invalid JSON, metadata, and order across page selection and recovery.
- Zoom/pan an infinite preview canvas with an always-visible, camera-aligned grid. Vertical scrolling zooms around the pointer without modifiers; horizontal scrolling and Shift + scroll pan. Preserve Control/Command + wheel zoom, Space-drag, touch pan/pinch, keyboard controls, and Fit/zoom controls without changing export dimensions. Metadata/composer scrolling must not move the camera.
- Preserve the viewport split and internally scrolling editors.
- Persist a versioned multi-page document. External input accepts only current projects; internal per-page documents compose the renderer.
- Save/fork/claim/import/export all pages. Purpose metadata informs agents but is not rendered. Images/videos export in page order; PDF is one ordered document with exact page dimensions.
- Reuse authoritative core schemas, the existing sandbox/compiler, and the single rendering pipeline. Agent-supplied design JSON can render through MCP without automatic browser/saved-link access.

PDF merging uses MIT `pdf-lib`. Its compression dependency declares `(MIT AND Zlib)`; both notices were inspected in the installed distribution. The audit explicitly recognizes the permissive Zlib SPDX identifier while retaining rejection of copyleft/unknown obligations.

Runtime overflow/safe-zone checks use the compiler's native canvas dimensions, not transient viewport measurements from newly initialized offscreen frames. Standalone runtime consumers without supplied dimensions retain viewport-based checks.

## Verification

- Scroll-zoom follow-up: `pnpm check` passes **165 tests / 23 suites**, and the website production build passes. Browser regressions verify unmodified wheel zoom in/out over an artboard, pointer anchoring, horizontal/Shift-wheel panning, Ctrl-wheel compatibility, line/page units, 1%-300% bounds, and input/overlay isolation. The shared production preview also zoomed in/out without modifiers and returned to its original scale without editing the design.
- `pnpm -r build` passes for the full workspace. The existing Vite large-chunk advisory remains non-blocking.
- `pnpm check` passes: formatting, lint, type-checking, license audit, and **132 tests across 18 suites**.
- License audit verifies **8 MIT workspace manifests and 180 permissive production dependencies**.
- Current schema and Firebase emulator tests cover independent sources, metadata, shared dimensions, limits, persistence, and claiming. The fresh-install backend supersedes the original storage tests; old-format conversion is not supported.
- Browser tests cover independent source editing, save/reload/fork, invalid inactive-page JSON recovery/import, removal, all-page HTML, anchored wheel/keyboard zoom, moving grid, actual touch pan/pinch, and mobile layout without main-area overflow.
- A stale-viewport regression verifies native square/story validation without false overflow warnings while retaining genuine out-of-canvas warnings. Final production inspection also confirmed a newly added offscreen page reports no false warnings.
- Real media tests verify ordered PNG pixels, one merged PDF with exact 160×96 page dimensions and decoded content ordering, purpose-only edits producing byte-identical PNGs, H.264/yuv420p MP4 output with independent 500/1000 ms durations, and retained library batches.
- MCP tests execute `render_workspace` with ordered page outputs and an exact 768×384 bounded preview for 1024×512 pages.
- Visually inspected horizontal artboards, titles/purposes, persistent controls, and light/dark desktop presentation; checked 390×844 mobile layout and production grid movement with zero document overflow.
