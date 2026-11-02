# Engineering contract

## Objective and identity

Maintain one understandable implementation of each behavior. Optimize for correctness and data safety, clear ownership, simplicity, readability, then local style. The repository must communicate intent mechanically while remaining natural, readable, and maintainable for human engineers and modern coding agents. Human readability takes priority over cleverness, excessive abstraction, or AI-specific optimization. Fix broken invariants rather than masking them with broad catches, duplicate state, or fallback branches.

The product name is **tinytldr**. Use `@tinytldr/*` workspace package names and `TINYTLDR_*` environment variables.

## Core tinytldr invariants

- **Deterministic core and MCP:** The calling agent writes the copy for MCP workflows. Templates, schemas, validation, preview, and export never call an LLM. The user-approved [website AI composer](../specs/WebsiteAiComposer.md) is an optional, separate authenticated generation layer using account-owned provider keys; it does not change the deterministic rendering pipeline.
- **Zod schemas are the single source of truth:** MCP input schemas, TypeScript types, boundary validation, and tool reference docs are generated from Zod schemas in `@tinytldr/core`.
- **Single rendering pipeline:** One renderer (Playwright Chromium) produces every export format; preview and export share the same code path. The website's live preview uses the same `@tinytldr/core`, `@tinytldr/runtime`, and `@tinytldr/templates` in the browser and never reimplements the template engine.
- **Deterministic motion:** Motion uses CSS keyframes and the Web Animations API (`document.getAnimations()`), so every frame can be seeked deterministically by timestamp (`seek(ms)`).
- **Strict sandboxing for untrusted HTML/CSS:** Agent-supplied or template HTML/CSS is untrusted: sanitize, disallow template JavaScript, block remote URLs except registered local assets, and render with network blocked and strict time/memory limits.
- **Compact MCP tool payloads:** Never inline full-resolution exports into MCP responses; return file paths (stdio) or signed URLs (HTTP), plus a small preview image (`<= 768px` long side or contact sheet), structured warnings, and actionable error messages.
- **MIT & permissive dependencies only:** The repository, every package, `mcp/`, `website/`, and built-in templates are MIT (`"license": "MIT"`). Runtime dependencies must be permissive (`MIT`, `ISC`, `BSD`, `Apache-2.0`, `OFL` for fonts). No `GPL`/`LGPL`/`AGPL` linked dependencies, `SSPL`, `BUSL`, Remotion, or GSAP. `ffmpeg` is invoked strictly as a separate process, never linked.
- **Zero telemetry & zero committed secrets:** No telemetry without explicit opt-in/owner approval. Hosted configuration comes exclusively from environment variables.

## 1. Architecture and folder structure

- Follow the [architecture map](Architecture.md). Organize directories by clear architectural responsibilities and domain ownership:
  - `mcp/`: MCP tool workspace (`@modelcontextprotocol/sdk` server, CLI entrypoint, and MCP-facing packages/handlers).
  - `website/`: Main site (`www.tinytldr.com`) — personal design workspace, guest draft/link recovery, optional Firebase accounts, docs, and interactive in-browser template authoring.
  - `packages/core/`: Browser- and Node-safe Zod schemas (`Design`, `Page`, `TemplateManifest`, `Size`, `Brand`, `EditOp`), size presets, LiquidJS compilation, `--tt-*` token resolution, pure design operations, and validation.
  - `packages/runtime/`: Browser runtime injected into rendered pages (`window.__tinytldr = { ready, warnings, durationMs, seek(ms) }`) for font/image readiness, binary-search text auto-fit, and overflow/contrast/safe-zone detection.
  - `packages/templates/`: Built-in MIT templates, one folder per template (`manifest.json`, `template.liquid.html`, `style.css`, `README.md`).
  - `packages/renderer/`: Playwright Chromium image/PDF renderer and `VideoEncoder` pipeline invoking `ffmpeg` as a separate process.
- Avoid vague dumping grounds (`Utils/`, `Helpers/`, `Misc/`, `Common/`). Place functionality where an engineer or AI agent can infer ownership without searching the entire repository.
- Keep `website/` TypeScript flat: `src/pages`, `src/components`, `src/hooks`, `src/state`, and `src/lib`. Authored source, test, fixture, and script basenames use PascalCase; class files match their primary exported class. Hooks use `useCamelCase.ts` (one hook per file).
- Dependencies point inward from applications (`mcp/`, `website/`) to shared package APIs. Packages must not import applications. Do not add dependency cycles, cross-package relative imports, or imports of private internal package source.

## 2. Readability, control flow, and naming

- **Control-Flow Clarity:** Code should be immediately understandable. Prefer guard clauses and early returns over deep nesting. Make data transformations and state transitions explicit. Avoid dense one-liners, deeply nested ternaries, and excessive method chaining that obscure control flow.
- **Naming Conventions:**
  - **PascalCase:** Classes, class files, types, interfaces, enums, React components, domain models, services, and substantial named concepts (`TemplateCompiler.ts`, `ChromiumRenderer.ts`, `DesignValidator.ts`). Class files match their primary exported class.
  - **camelCase:** Variables, local constants, functions, methods, parameters, and object properties (`designId`, `compileTemplate()`, `resolveTokens()`).
  - **UPPER_SNAKE_CASE:** True global/static operational constants (`MAX_CAROUSEL_PAGES`, `PREVIEW_MAX_LONG_SIDE_PX`). Do not use for local variables.
  - **Booleans:** Name booleans as natural predicates (`isReady`, `hasOverflow`, `canExportVideo`, `isSafeZoneRespected`).
  - **Files:** Use descriptive PascalCase basenames for authored source, tests, fixtures, and scripts. Hooks use `useCamelCase.ts`. Follow ecosystem exceptions for `package.json`, `tsconfig.json`, `index.ts`, template `manifest.json`/`style.css`, and config files.
- **Breathing Room:** Separate logical phases (setup, validation, execution, state updates, return) with single blank lines. Let Prettier own mechanical formatting while preserving intentional phase grouping.

## 3. Strong typing, contracts, and schemas

- **Strict Types:** Eliminate `any`, un-narrowed `unknown`, or loosely shaped dictionaries. Use discriminated unions, explicit interfaces, typed errors, and typed configs.
- **Authoritative Schemas:** Define explicit contracts at system boundaries using Zod in `@tinytldr/core`.
- **Boundary Validation:** Treat MCP inputs, template manifests, agent-supplied HTML/CSS, stored JSON, and asset paths as untrusted. Validate all inputs using strict Zod schemas before rendering or writing to disk.

## 4. Executable specifications and delivery

- **Tests as Specifications:**
  - Golden images with pixel-diff thresholds for every template × preset (executed in a pinned Linux container for font determinism).
  - `ffprobe` assertions for video exports: duration, fps, dimensions, `h264`/`yuv420p`, `faststart`.
  - PDF page count and exact pixel page size assertions.
  - MCP integration test driving `create_design` → `edit_design` → `preview` → `export` over stdio with the official MCP SDK client.
- **Deterministic Verification Gate:** `pnpm check` runs formatting check, lint, TypeScript typecheck across all workspaces, license audit (failing on any non-permissive production dependency), and automated tests. It must pass at the end of every phase.
- **Concise Documentation:** Maintain concise, source-linked documentation under `.agents/` (`instructions/`, `docs/`, `specs/`, `memory-bank/`, `prompts/`). Link to canonical rules rather than copying them across folders.
