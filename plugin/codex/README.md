# tinytldr for OpenAI Codex

Turn notes, articles, changelogs, and diffs into social images, PDF carousels, and MP4 videos from Codex. This plugin uses the portable [Agent Plugins](https://agent-plugins.org) format and bundles:

- the `tinytldr` skill;
- the hosted tinytldr MCP server at `https://mcp.tinytldr.com/mcp`, with OpenAI listing and review metadata under `extensions.com.openai`.

## Install

```sh
codex plugin marketplace add ajrahim/tinytldr
codex plugin add tinytldr@tinytldr
```

Codex signs you in to tinytldr with OAuth (dynamic client registration, `mcp:render` scope) when the plugin is installed. The package contains no keys or headers.

## Tools

| Tool                                     | Purpose                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| `list_templates`, `get_template_schema`  | Discover the 12 built-in templates and their slot limits     |
| `validate_template_data`, `preview_post` | Check overflow and contrast and show an inline preview       |
| `render_post`, `render_workspace`        | Export PNG, JPEG, WebP, PDF, or MP4 as signed download links |
| `list_designs`, `get_design`             | Read designs saved on www.tinytldr.com (read only)           |

tinytldr only renders. It never posts to social networks or edits your saved designs.

## Submit to the OpenAI plugin directory

1. Build the upload: `node scripts/PluginPackages.mjs pack` writes `dist/plugins/tinytldr-codex-plugin.zip`.
2. Upload the ZIP at [platform.openai.com/plugins](https://platform.openai.com/plugins).
3. Verify the `mcp.tinytldr.com` domain with the challenge token the portal provides.
4. Add a demo video URL and reviewer credentials for a test account that has a saved design named "Weekly" (used by the fifth positive test case).
5. Submit for review. The 5 positive and 3 negative test cases are in `plugin.json` under `extensions.com.openai.review`.

See [Submit plugins](https://developers.openai.com/plugins/deploy/submission) for the full checklist.

- [Privacy policy](https://www.tinytldr.com/privacy)
- [Terms](https://www.tinytldr.com/terms)
- [Support](https://github.com/ajrahim/tinytldr/issues)
