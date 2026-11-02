# Architecture and ownership

`tinytldr` is a `pnpm` workspace monorepo. The local stdio MCP server + CLI (`mcp/`) and the rendering engine (`packages/*`) form the local-first core; `website/` owns the personal design workspace, documentation, and live sandboxed template authoring. Firebase Auth/Firestore optionally provide accounts, public links, and one-time design claiming; local creation and draft recovery do not require a backend. See [workspace behavior and setup](../docs/PersonalWorkspace.md).

`website/firebase/` is the only hosted account/design/AI backend. Firebase Hosting
serves `www.tinytldr.com`; Cloud Run executes authenticated Chromium/FFmpeg exports
at `api.tinytldr.com`. MCP remains at `mcp.tinytldr.com/mcp`.
There are no stored-format upgrades or alternative backend adapters.
See [Firebase setup](../docs/FirebaseBackend.md).

```text
Calling Agent (Claude Code / Codex) -> MCP Protocol (stdio / Streamable HTTP)
MCP Tool Handlers (mcp/) -> Core Schemas & Compiler (@tinytldr/core) + Templates (@tinytldr/templates)
Renderer (@tinytldr/renderer) -> Playwright Chromium + Injected Runtime (@tinytldr/runtime) + ffmpeg subprocess

Website Pages (website/) -> Components / Hooks -> State / Browser Helpers
Sandbox Preview Iframe -> @tinytldr/core + @tinytldr/runtime + @tinytldr/templates
Website AI Composer -> AI Gateway -> Firebase Auth / Firestore + Secret Manager -> Selected Provider API
```

## Workspace and package ownership

| Package / Directory   | Type            | Responsibility & Entry Points                                                                                                                                                                                   |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp/`                | Application/Bin | MCP server (`@modelcontextprotocol/sdk`) over stdio and Streamable HTTP, plus the `tinytldr` CLI (`mcp`, `render`, `doctor`, `template new\|validate\|preview`).                                                |
| `website/`            | Web Application | Single design workspace (`/`) with one toolbar, sidebar account/guest history, public links (`/d/:id`), browser drafts (`/local/:id`), welcome/MCP/docs dialogs, and optional Firebase account/data boundaries. |
| `packages/core/`      | Pure Domain     | Node- and browser-safe Zod schemas (`Design`, `Page`, `TemplateManifest`, `Size`, `Brand`, `EditOp`), size presets, LiquidJS compilation, `--tt-*` CSS token resolution, and ops.                               |
| `packages/runtime/`   | Browser Runtime | Script injected into every rendered page (`window.__tinytldr = { ready, warnings, durationMs, seek(ms) }`) for font/image wait, binary-search text fit, and layout diagnostics.                                 |
| `packages/templates/` | Content/Assets  | Built-in MIT templates (one folder each: `manifest.json`, `template.liquid.html`, `style.css`, `README.md`) and bundled OFL fonts.                                                                              |
| `packages/renderer/`  | Infrastructure  | Playwright Chromium image (`png`, `jpg`, `webp`) and `pdf` renderer, plus `VideoEncoder` (`mp4`, `webm`, `gif`) piping deterministic frames to a separate `ffmpeg` process.                                     |

## Website structure and routing

- **Flat TypeScript Directories:** `website/src/pages`, `website/src/components`, `website/src/hooks`, `website/src/state`, and `website/src/lib`. No nested feature or single-component folders.
- **Styles Hierarchy:** `website/src/styles/index.css` imports Tailwind, `global.css` shared defaults, `styles/components/<Component>.css`, and `styles/pages/<Page>.css`.
- **Modal Shell:** [Dialog](../../website/src/components/Dialog.tsx) and its [styles](../../website/src/styles/components/Dialog.css) own centered modal geometry, header/body/footer, focus, and lifecycle. Account/sign-in, guide/docs, provider, and media components retain their content, state, and actions. Navigation drawers and anchored popovers remain separate. See [consistent dialogs](../specs/ConsistentDialogs.md).
- **Single Workspace:** `/studio`, `/playground`, and `/designs` are editor aliases; there is no separate landing or editable-design-list page. My Library swaps the main pane for an account-owned media grid while retaining the mounted editor. Legacy starter URLs select a starter in the editor. Help and documentation open over the current workspace so its unsaved state remains mounted. The sidebar becomes a native modal drawer on mobile; its bottom agent/account cards remain separate from the toolbar.
- **Rendered Media:** Shared core Zod contracts define project export requests, complete output lists and account media operations. The trusted Firebase media function retains original/thumbnail files in private Firebase Storage and publishes complete batches using Firestore metadata and quota reservations. Library access requires sign-in; there is no browser-media migration or local fallback. Browser/server compilation shares a sanitization/CSP policy, and all binary export uses Chromium/FFmpeg.
- **Artboards:** Core `WorkspaceProject` v2 owns ordered, independently authored pages and shared dimensions; external single-page inputs are rejected. Internal per-artboard document helpers remain part of the current renderer. The workflow hook owns selection and raw source recovery; `ArtboardCanvas` owns the camera only. `render_workspace` and REST share `renderWorkspaceProject`, delegating to the existing renderer and merging PDFs with MIT `pdf-lib`.
- **Optional AI:** `website/server` owns authenticated generation, provider protocols, endpoint policy, timeouts, and safe errors. Firebase owns identity/storage. Pure contracts live in `@tinytldr/core/ai`; no provider invocation enters core, MCP, preview, or rendering. Firestore ciphertext/Secret Manager remain backend-only; the browser receives masked account-owned metadata. Complete output validates and compiles before becoming an unsaved draft. See [AI setup and boundaries](../docs/AiConnections.md).

## Layered dependency directions

```text
website/ Pages → Components / Hooks → State → Browser Helpers (lib) → @tinytldr/{core,runtime,templates}
mcp/ → @tinytldr/{core,runtime,templates,renderer}
packages/renderer → @tinytldr/{core,runtime,templates}
packages/templates → @tinytldr/core
packages/runtime → (zero external runtime dependencies)
packages/core → Pure (Node + browser compatible, zero filesystem/Playwright I/O)
```

- `packages/core` never imports Node `fs`, Playwright, or `ffmpeg`.
- `website/` never reimplements template compilation or server-side image rendering; it uses `@tinytldr/core`, `@tinytldr/runtime`, and `@tinytldr/templates` directly in a sandboxed preview iframe, and optionally calls `TINYTLDR_API_URL` for full media export.
- Packages never import `mcp/` or `website/`.
