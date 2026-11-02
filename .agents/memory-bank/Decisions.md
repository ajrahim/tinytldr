# Architectural decisions

Durable design decisions and their underlying rationale:

### 1. Calling agent is the only LLM; tinytldr is deterministic

`tinytldr` makes zero LLM calls. The calling coding agent (Claude Code, Codex, Copilot) distills source text into structured slot values, while `tinytldr` handles schemas, LiquidJS compilation, auto-fit layout, validation, preview, and pixel-accurate export.

### 2. Single template engine across Node and browser

`@tinytldr/core`, `@tinytldr/runtime`, and `@tinytldr/templates` run identically in Playwright Chromium (for MCP/CLI preview and export) and in the browser (`website/` live playground). Preview and export share the same rendering code path.

### 3. Permissive MIT licensing and isolated FFmpeg subprocess

All repository code and templates are MIT-licensed. Production dependencies are restricted to permissive licenses (`MIT`, `ISC`, `BSD`, `Apache-2.0`, `OFL`). Because `ffmpeg` with `libx264` is GPL, `ffmpeg` is never linked and is invoked exclusively as an isolated child process.

### 4. Repository workspace mapping (`mcp/` and `website/`)

Following owner direction, the MCP server lives under `mcp/`, the CLI lives under `packages/cli/`, and the main site lives under `website/`, alongside shared domain packages under `packages/`, with project instructions, specs, and docs consolidated under `.agents/`.

### 5. Video rendering engine (`WaapiFfmpegVideoEncoder` vs. HyperFrames)

Per `.agents/docs/decisions/0001-video-engine.md`, `tinytldr` uses its native `WaapiFfmpegVideoEncoder` (`window.__tinytldr.seek(ms)` + Playwright Chromium screenshot + `ffmpeg` stdin pipe) behind the `VideoEncoder` interface, achieving ~3.44s for a 5s 1080×1080 30fps video with 100% SHA-256 frame-hash determinism on Windows 11 while avoiding duplicate Puppeteer dependencies.

### 6. Firebase-only hosted backend

Per [ADR 0002](../docs/decisions/0002-firebase-hosting.md), Firebase is the only hosted backend. Firebase Hosting serves `www.tinytldr.com`, authenticated rendering uses `api.tinytldr.com`, and the MCP endpoint remains `mcp.tinytldr.com/mcp`. Current formats only; no imported-data upgrade paths.
