# Viewport-filling workspace

Status: Shipped. User approved implementation.

## Scope

- Workspace fills the viewport, without page-level scrolling or unused space beneath the source editors.
- Preview/editor divider supports pointer, touch, and keyboard resizing; preview fits both available dimensions without changing render dimensions.
- Editors use the remaining space with internal scrolling. Library and notices retain bounded internal scrolling.
- Remove starter and design-theme selectors. Keep source editing and existing saved documents; JSON `defaultTheme` controls preview appearance.
- Theme-aware grid surrounds the preview; the rendered design keeps its own source-defined colors.
- Canvas size dropdown moves to the header immediately left of Save.

## Out of scope

No rendering-output changes, new templates, database migration, uploads, new dependencies, or automatic MCP synchronization.

## Evidence

- `pnpm -r build`: all workspaces pass. The existing non-blocking Vite large-chunk warning remains.
- `pnpm check`: formatting, lint, workspace type checks, license audit, and **115 tests across 15 suites** pass. All 8 workspace manifests remain MIT; all 175 production dependencies remain permissive. No dependencies added.
- [Workspace browser tests](../../website/test/PersonalWorkspaceBrowser.test.ts) verify actual pointer/touch resizing, keyboard limits/reset, auto-fitting, unchanged native design dimensions, preserved iframe content, editor bounds reaching the viewport bottom, internal editor height on 320px/360px screens, no page overflow, header ordering, theme-aware grid, JSON-controlled design theme, and bounded errors/menu placement.
- [Template editor tests](../../website/test/TemplateEditor.test.ts) verify active-theme materialization, untouched saved-document preservation, one-time legacy theme migration, and verbatim invalid/current recovery source. Browser history uses optional `templateJsonVersion: 2`; server document and MCP schemas are unchanged.
- Existing save/fork/claim/recovery flows and actual image/PDF/video library tests pass through the revised interface. Legacy template links remain compatible without exposing a picker.
- Production-build visual inspection: 1440x1000 desktop and 390x844 mobile, light/dark grid and editors, plus reduced mobile preview using the keyboard control. Desktop document height and editor bottom both measured exactly 1000px for a 1000px viewport.
