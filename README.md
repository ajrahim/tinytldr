<p align="center">
  <a href="https://www.tinytldr.com"><img src=".github/assets/Banner.png" alt="tinytldr" width="100%"></a>
</p>

**Anything → a post. From Claude or Codex.**

`tinytldr` is an open-source (MIT) Model Context Protocol (MCP) server, deterministic rendering engine, and website ([www.tinytldr.com](https://www.tinytldr.com)) that turn notes, articles, changelogs, or threads into polished social posts, carousels, and animated videos from responsive HTML/CSS templates.

The calling coding agent (Claude Code, Codex, Copilot) is the only "brain" — it distills your source material into a concise tl;dr and fills template slots. `tinytldr` is the deterministic toolbox: Zod schemas, LiquidJS templates, automatic text fitting, layout/contrast validation, instant preview, and pixel-accurate export (`png`, `jpg`, `webp`, `pdf`, `mp4`, `webm`, `gif`, `html`, `zip`).

## Quick Install

### Claude Code

```sh
claude mcp add tinytldr -- npx -y tinytldr mcp
```

### OpenAI Codex

```sh
codex mcp add tinytldr -- npx -y tinytldr mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.tinytldr]
command = "npx"
args = ["-y", "tinytldr", "mcp"]
```

## Local CLI Usage

```sh
# Check Chromium, ffmpeg, and bundled OFL fonts
npx tinytldr doctor

# List and inspect bundled templates
npx tinytldr list
npx tinytldr inspect quote-card

# Validate, preview, and render a template
npx tinytldr validate --template quote-card
npx tinytldr preview --template quote-card --out preview.png
npx tinytldr render --template quote-card --size square --format png --scale 2 --out post.png

# Scaffold and validate a custom MIT template across all supported size presets
npx tinytldr template new my-custom-card --kind static
npx tinytldr template validate my-custom-card

# Start the self-hosted Streamable HTTP MCP + REST render server
npx tinytldr serve --port 8787
```

## Bundled MIT Template Catalog (12 Templates)

- **Static (`png`, `jpg`, `webp`, `pdf`)**: `quote-card`, `stat-callout`, `code-snippet`, `tweet-thread-summary`, `changelog-card`, `steps-checklist`, `vs-comparison`
- **Carousels (`pdf`, multi-slide `png`)**: `carousel-slides`, `paper-tldr`
- **Animated Video (`mp4`, 30 fps H.264)**: `kinetic-quote`, `timeline-reveal`, `stat-counter`

## Monorepo Structure

```text
mcp/                  @tinytldr/mcp — MCP server (stdio & Streamable HTTP + REST API)
website/              @tinytldr/website — personal design workspace, guest links, accounts, and docs
packages/core/        @tinytldr/core — Zod schemas, presets, LiquidJS compiler, token resolver
packages/runtime/     @tinytldr/runtime — Injected page script (font/image ready, auto-fit, seek)
packages/templates/   @tinytldr/templates — 12 built-in MIT templates and bundled OFL fonts
packages/renderer/    @tinytldr/renderer — Playwright Chromium image/PDF + ffmpeg video pipeline
packages/cli/         tinytldr — CLI entrypoint (`mcp`, `serve`, `render`, `doctor`, `template`)
skills/tinytldr/      SKILL.md — Agent Skill for Claude Code & Codex
.agents/              Engineering contract, architecture, specifications, decisions, and plan
```

## Development

Requires **Node.js 22+** and **pnpm**:

```sh
pnpm install
npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm check"
pnpm build
```

`pnpm check` verifies formatting, ESLint, TypeScript across all workspaces, permissive dependency licenses, and the Vitest suite.

The website starts without an account: create your own HTML/Liquid + CSS template, edit its content, and keep browser-local drafts. Firebase is the only hosted backend, with email/password and Google sign-in, public design links, and ownership claims. This is a fresh-install codebase with no database or old-format upgrade paths. The optional [AI composer](.agents/docs/AiConnections.md) uses account-owned provider API keys; MCP and rendering remain deterministic. See [workspace behavior](.agents/docs/PersonalWorkspace.md) and [Firebase deployment](.agents/docs/FirebaseBackend.md).

The maintained deployment uses **https://www.tinytldr.com** on Firebase Hosting,
**https://api.tinytldr.com** for authenticated rendering, and
**https://mcp.tinytldr.com/mcp** for MCP. Maintainer-specific public project values
stay in ignored configuration; forks supply their own. Domain provisioning and
live deployment are separate operator actions.

My Library image uploads and rendered image/video/PDF exports are stored privately
in Firebase Storage, with account-scoped metadata and upload usage in Firestore.
They remain available across browsers until deleted. Configure the media function
and persistent bucket as described in [Firebase setup](.agents/docs/FirebaseBackend.md#persistent-media).
HTML/JSON source downloads and local MCP/CLI rendering remain account-free.

## License

Released under the [MIT License](LICENSE). Built-in templates and exported HTML/CSS assets are MIT-licensed so you can use your exports anywhere. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency and external binary notices.
