# Three-pane template editor

Status: Shipped. User approved implementation.

## Scope

- One compact workspace header: title, save status, Save / Save copy, and an export-icon More menu.
- Preview above three equal HTML / Liquid, CSS, and JSON code editors, with syntax highlighting, independent editing/undo, and stacked panes on narrow screens.
- JSON uses the existing core TemplateManifest contract. `slots` describes MCP fields and limits, `sampleData` supplies preview content, and `distillationHint` supplies generation instructions. No new MCP protocol.
- A keyboard-accessible grouped menu retains rendered exports, template source downloads, recovery import/export, public links, claiming, guides, and appearance.
- Preserve sidebar, media library, sandbox, valid server saves, malformed local draft recovery, and legacy slot-schema history.

## Out of scope

No backend schema changes, automatic MCP access to website links, uploads, telemetry, or changes to the rendering engine.

## Evidence

- `pnpm -r build`: all workspaces built. Vite reports a non-blocking large-chunk warning for the editor bundle.
- `pnpm check`: formatting, lint, workspace type checks, permissive-license audit, and **110 tests across 15 suites** pass. All 8 workspace manifests remain MIT; 175 production dependencies are permissive.
- [Template editor tests](../../website/test/TemplateEditor.test.ts): manifest roundtrip, field/example edits, current examples versus saved template defaults, existing color overrides, semantic JSON comparison, malformed input, and legacy migration.
- [Workspace browser tests](../../website/test/PersonalWorkspaceBrowser.test.ts): equal highlighted columns beneath preview, independent undo/redo across pane changes and Library visits, source-file downloads, keyboard/focus/outside-click behavior, standalone manifest import, malformed recovery, stale-revision recovery, save/fork/claim, and responsive light/dark layouts.
- [Media library tests](../../website/test/MediaLibraryBrowser.test.ts): actual PNG/JPEG/WebP/PDF/MP4 exports, all carousel slides, file fidelity, previews/downloads, retained storage, and explicit failures through the new interface.
- Production-build visual inspection: desktop 1440px and mobile 390px, light/dark editors and grouped menus. Automated viewport coverage includes 320px, 390px, 768px, and 1440px.

JSON comparison ignores object-key order because Postgres jsonb can reorder keys. An untouched saved design is not marked dirty and its original examples remain intact; template-file export still uses the visible current examples. Existing per-design color overrides are exposed in JSON without changing an untouched design.
