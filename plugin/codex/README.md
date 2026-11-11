# tinytldr for OpenAI Codex

Generate social images, PDF carousels, and MP4 videos from any content in Codex, using the designs you saved on www.tinytldr.com so every export stays consistent with your own layouts. This plugin uses the portable [Agent Plugins](https://agent-plugins.org) format and bundles:

- the `tinytldr` skill;
- the hosted tinytldr MCP server at `https://mcp.tinytldr.com/mcp`, with OpenAI listing and review metadata under `extensions.com.openai`.

## Install

```sh
codex plugin marketplace add ajrahim/tinytldr
codex plugin add tinytldr@tinytldr
```

Codex signs you in to tinytldr with OAuth (dynamic client registration, `mcp:render` scope) when the plugin is installed. The package contains no keys or headers.

## Tools

| Tool                                     | Annotation    | Purpose                                                                  |
| ---------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `list_designs`, `get_design`             | read-only     | Read the designs you saved on www.tinytldr.com                           |
| `render_workspace`                       | creates files | Export a design as PNG, JPEG, WebP, a multipage PDF, or MP4              |
| `list_templates`, `get_template_schema`  | read-only     | Browse optional starter templates and their slot limits                  |
| `validate_template_data`, `preview_post` | read-only     | Check overflow and contrast and show an inline preview (no files stored) |
| `render_post`                            | creates files | Export a starter template as an image, PDF, or video                     |

Exports go to private storage and return signed download links that expire in five minutes. tinytldr only renders: it never posts to social networks or edits, deletes, or shares your saved designs.

## Submit to the OpenAI plugin directory

1. Build the upload: `node scripts/PluginPackages.mjs pack` writes `dist/plugins/tinytldr-codex-plugin.zip`.
2. Upload the ZIP at [platform.openai.com/plugins](https://platform.openai.com/plugins).
3. Verify the `mcp.tinytldr.com` domain with the challenge token the portal provides.
4. Add a demo video URL and reviewer credentials for an email/password test account with saved designs named "Weekly", "Article", and "Dashboard" (used by the positive test cases).
5. Submit for review. The 5 positive and 3 negative test cases are in `plugin.json` under `extensions.com.openai.review`.

See [Submit plugins](https://developers.openai.com/plugins/deploy/submission) for the full checklist.

- [Privacy policy](https://www.tinytldr.com/privacy)
- [Terms](https://www.tinytldr.com/terms)
- [Support](https://github.com/ajrahim/tinytldr/issues)
