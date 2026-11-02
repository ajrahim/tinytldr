# Spec 005: Phase 5 — HTTP MCP + REST Server, Template Authoring CLI, Agent Skill & v0.1.0 Release Prep

- **Phase:** 5
- **Status:** In Progress
- **Owners:** `mcp/`, `packages/cli`, `skills/tinytldr`, `.agents/docs/`

## 1. Objective

Complete the final phase of `tinytldr` v0.1.0:

1. **Streamable HTTP MCP + REST Render Server (`mcp/src/HttpServer.ts`):**
   - Expose `GET /health`, `GET /v1/templates`, `GET /v1/templates/:id`, `POST /v1/validate`, `POST /v1/preview`, `POST /v1/render`, `GET /v1/jobs/:id`, and `/mcp` (Streamable HTTP MCP transport).
   - Support optional bearer token authentication (`TINYTLDR_API_KEY`) for local self-hosting, per-IP token-bucket rate limiting, CORS headers for `www.tinytldr.com` (`VITE_TINYTLDR_API_URL`), and local rendered assets. Production exports use the separately authenticated Firebase-backed API.
2. **Community Template CLI & Server Entrypoint (`packages/cli/src/index.ts`):**
   - Add `tinytldr template new <id> [--kind static|carousel|video]` to scaffold a new MIT template folder.
   - Add `tinytldr template validate <id>` to validate a template across all declared `supportedSizes` with both sample data and max-length stress data.
   - Add `tinytldr serve [--port 8787]` to launch the HTTP MCP + REST server.
3. **Agent Skill, MCP Registry Manifest, Dockerfile & Self-Host Docs:**
   - Create `skills/tinytldr/SKILL.md` for Claude Code and OpenAI Codex.
   - Create `server.json` for the official MCP Registry.
   - Create `Dockerfile` and `.dockerignore` with Chromium, FFmpeg (documenting the separate-process OS boundary), and bundled OFL-1.1 fonts.
   - Create `.agents/docs/self-host.md` and update root `README.md` and `THIRD_PARTY_NOTICES.md`.
4. **Verification:**
   - Add `mcp/test/Phase5HttpServerAndCli.test.ts` testing REST + HTTP MCP endpoints, bearer auth, template scaffolding/validation, and release artifacts.
   - Pass `pnpm check` with zero warnings or errors.
