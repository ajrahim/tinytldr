# tinytldr MCP & CLI

Follow the repository [AGENTS.md](../AGENTS.md) and the shared [agent documentation](../.agents/README.md). This file adds `mcp/`-specific constraints; do not duplicate the engineering contract here.

## Ownership and boundaries

- `mcp/` owns the Model Context Protocol server (`@modelcontextprotocol/sdk` over stdio and Streamable HTTP) and the `tinytldr` CLI commands (`mcp`, `render`, `doctor`, `template new|validate|preview`).
- All MCP tool input schemas and descriptions are derived from the authoritative Zod schemas in `@tinytldr/core`.
- Keep tool responses compact: return output file paths (stdio) or signed URLs (HTTP), a small preview image (`<= 768px` long side or contact sheet), structured warnings, and actionable next-step guidance. Never inline full-resolution media exports.
- Delegate template compilation and validation to `@tinytldr/core` and rendering to `@tinytldr/renderer`.
