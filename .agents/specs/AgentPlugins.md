# Agent plugins: Claude Code and Codex

Status: Shipped

## Problem

Users had to wire the tinytldr MCP server and skill by hand. Phase 3 of
[PLAN.md](../docs/PLAN.md) includes a Claude Code plugin. The owner asked for
Claude Code and OpenAI Codex plugins for the hosted MCP server in `plugin/claude`
and `plugin/codex`, following
[Anthropic's publish guide](https://code.claude.com/docs/en/plugins/publish) and
[OpenAI's submission guide](https://developers.openai.com/plugins/deploy/submission).

## Scope

- `plugin/claude`: `.claude-plugin/plugin.json` (identity plus directory listing
  fields), `.mcp.json` connecting the hosted HTTP server
  `https://mcp.tinytldr.com/mcp`, a 512 px icon, and the `tinytldr` skill.
- `plugin/codex`: portable Agent Plugins `plugin.json` with `extensions.com.openai`
  listing metadata, 5 positive and 3 negative review test cases, and release
  notes; `mcp.json` with one `streamable-http` server using OAuth dynamic client
  registration and the `mcp:render` scope; light and dark icons; and the skill.
- Repository marketplaces: `.claude-plugin/marketplace.json` and
  `.agents/plugins/marketplace.json`, so
  `claude plugin marketplace add ajrahim/tinytldr` and
  `codex plugin marketplace add ajrahim/tinytldr` both work.
- `scripts/PluginPackages.mjs` copies the canonical `skills/tinytldr` into both
  plugins (`sync`), detects stale copies (`check`), and writes deterministic
  submission ZIPs to `dist/plugins/` (`pack`).
- The skill notes that the hosted server ignores `outputPath` and returns signed
  download links.

Plugins contain no secrets, headers, hooks, or executable code. Authentication
is the hosted server's existing OAuth flow.

## Out of scope

New MCP tools or server behavior; the OpenAI domain-verification route
(`/.well-known/openai-apps-challenge`, added only when the owner has a token);
portal submissions, the demo video, and reviewer accounts (owner actions);
social posting; telemetry.

## Acceptance criteria

- `claude plugin validate --strict` passes for the plugin and the marketplace.
- A real Claude Code install from the local marketplace loads one skill and the
  `tinytldr` HTTP MCP server, which reports that it needs authentication.
- Codex CLI lists and installs `tinytldr@tinytldr` from the local marketplace.
- `scripts/test/PluginPackages.test.mjs` checks that:
  - the skill copies are in sync;
  - identity matches `server.json`;
  - the MCP URL is the `server.json` remote, with no headers or secrets;
  - the OpenAI listing limits and review test cases are present;
  - the icons are square PNGs;
  - both marketplaces point at the right plugin folders;
  - packed ZIPs are deterministic and round-trip.
- The full `pnpm check` gate passes.

## Verification (2026-11-07)

- `claude plugin validate --strict plugin/claude` and `claude plugin validate .`
  (Claude Code 2.1.283): both "Validation passed".
- `claude plugin marketplace add ./` then `claude plugin install tinytldr@tinytldr`
  installed 0.1.0 with 1 skill and 1 MCP server. `claude mcp list` showed
  `plugin:tinytldr:tinytldr: https://mcp.tinytldr.com/mcp (HTTP) - Needs authentication`.
  The test install and marketplace were then removed.
- `codex plugin marketplace add ./` (codex-cli 0.157.1) read
  `.agents/plugins/marketplace.json`. `codex plugin add tinytldr@tinytldr`
  installed version 0.1.0 with `plugin.json`, `mcp.json`, both icons, and the
  skill. The test install and marketplace were then removed.
- `node scripts/PluginPackages.mjs pack` wrote both ZIPs; Python `zipfile.testzip()`
  reported no CRC errors.
- `pnpm exec vitest run scripts/test/PluginPackages.test.mjs`: 7 passed.
- Release gate: the emulator `pnpm check` passed **45/45 files, 385 tests**.
- Unverified:
  - A Codex model session using the plugin's MCP tools: this Codex login rejected
    the configured models.
  - Authenticated tool calls through either plugin.
  - Directory submissions (owner actions).
