# Contributing to tinytldr

Start with [README.md](README.md) for setup and [AGENTS.md](AGENTS.md) for the repository's engineering contract. All contributors are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). Please report security vulnerabilities privately following our [Security Policy](SECURITY.md).

The same ownership, sandbox-safety, licensing, and verification expectations apply to human and automated contributions.

## Prerequisites

- **Node.js & pnpm:** Node.js 22 or newer and `pnpm` (via Corepack: `corepack enable`).
- **Chromium:** Playwright Chromium is used for deterministic image, PDF, and video frame rendering (`tinytldr doctor` or `npx playwright install chromium`).
- **FFmpeg:** Required for `mp4`, `webm`, and `gif` exports (`ffmpeg` and `ffprobe` on `PATH`). Invoked strictly as an isolated child process.

## Code and Architecture Rules

Follow the [engineering contract](.agents/instructions/Engineering.md) and [architecture map](.agents/instructions/Architecture.md):

- **No LLM calls inside `tinytldr`:** The calling agent writes the copy; `tinytldr` compiles, validates, previews, and exports.
- **Zod Single Source of Truth:** All schemas live in `@tinytldr/core`.
- **Naming:** Authored source, test, fixture, and script basenames use `PascalCase`; class files match their main exported class. Hooks use `useCamelCase.ts` (one hook per file). Functions and variables remain `camelCase`.
- **Permissive Dependencies Only:** Production dependencies must use permissive licenses (`MIT`, `ISC`, `BSD`, `Apache-2.0`, and `OFL` for fonts). `pnpm check:licenses` enforces this gate in CI.

Run these commands before submitting a change:

```sh
pnpm check
pnpm build
```

Use `npx prettier --write <changed-files>` for focused formatting or `pnpm format` for a repository-wide format pass.

## Contributing a Community Template

1. Scaffold a new template folder: `tinytldr template new <template-id>`
2. Author `manifest.json`, `template.liquid.html`, `style.css`, and `README.md` using `--tt-*` CSS custom properties and container query units (`cqw`, `cqh`, `cqmin`).
3. Validate across all declared size presets (sample + max-length content, zero overflow, WCAG AA contrast, story safe zones, zero network requests): `tinytldr template validate <template-id>`
4. Open a Pull Request. CI validates the template at every declared size and generates thumbnails automatically.

This project is released under the [MIT License](LICENSE).
