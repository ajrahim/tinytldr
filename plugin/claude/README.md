# tinytldr for Claude Code

Turn notes, articles, changelogs, and diffs into social images, PDF carousels, and MP4 videos from Claude Code. This plugin bundles:

- the `tinytldr` skill (template selection, copywriting limits, and render workflow);
- the hosted tinytldr MCP server at `https://mcp.tinytldr.com/mcp`.

## Install

```sh
claude plugin marketplace add ajrahim/tinytldr
claude plugin install tinytldr@tinytldr
```

Run `/mcp` in Claude Code and sign in to `plugin:tinytldr:tinytldr` with your tinytldr account. The server uses OAuth with dynamic client registration and the `mcp:render` scope, so the plugin contains no keys.

## Tools

| Tool                                     | Purpose                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| `list_templates`, `get_template_schema`  | Discover the 12 built-in templates and their slot limits     |
| `validate_template_data`, `preview_post` | Check overflow and contrast and show an inline preview       |
| `render_post`, `render_workspace`        | Export PNG, JPEG, WebP, PDF, or MP4 as signed download links |
| `list_designs`, `get_design`             | Read designs saved on www.tinytldr.com (read only)           |

tinytldr only renders. It never posts to social networks or edits your saved designs.

## Maintain

The skill copy in `skills/tinytldr/` is generated from the repository's canonical `skills/tinytldr/`:

```sh
node scripts/PluginPackages.mjs sync   # refresh the copy
node scripts/PluginPackages.mjs pack   # write dist/plugins/tinytldr-claude-plugin.zip
claude plugin validate --strict plugin/claude
```

To list the plugin in the Anthropic directory, submit the repository at [claude.ai/directory/manage](https://claude.ai/directory/manage) as described in [Publish a plugin](https://code.claude.com/docs/en/plugins/publish).

- [Privacy policy](https://www.tinytldr.com/privacy)
- [Terms](https://www.tinytldr.com/terms)
- [Support](https://github.com/ajrahim/tinytldr/issues)
