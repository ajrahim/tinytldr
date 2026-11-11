# tinytldr for Claude Code

Generate social images, PDF carousels, and MP4 videos from any content in Claude Code, using the designs you saved on www.tinytldr.com so every export stays consistent with your own layouts. This plugin bundles:

- the `tinytldr` skill (template selection, copywriting limits, and render workflow);
- the hosted tinytldr MCP server at `https://mcp.tinytldr.com/mcp`.

## Install

```sh
claude plugin marketplace add ajrahim/tinytldr
claude plugin install tinytldr@tinytldr
```

Run `/mcp` in Claude Code and sign in to `plugin:tinytldr:tinytldr` with your tinytldr account. The server uses OAuth with dynamic client registration and the `mcp:render` scope, so the plugin contains no keys.

## Tools

| Tool                                     | Annotation    | Purpose                                                                  |
| ---------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `list_designs`, `get_design`             | read-only     | Read the designs you saved on www.tinytldr.com                           |
| `render_workspace`                       | creates files | Export a design as PNG, JPEG, WebP, a multipage PDF, or MP4              |
| `list_templates`, `get_template_schema`  | read-only     | Browse optional starter templates and their slot limits                  |
| `validate_template_data`, `preview_post` | read-only     | Check overflow and contrast and show an inline preview (no files stored) |
| `render_post`                            | creates files | Export a starter template as an image, PDF, or video                     |

Exports go to private storage and return signed download links that expire in five minutes. tinytldr only renders: it never posts to social networks or edits, deletes, or shares your saved designs.

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
