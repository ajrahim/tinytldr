# Verification

Run commands from the repository root.

## Required verification gates

```sh
pnpm check       # Prettier, ESLint, TypeScript across all workspaces, license audit, and Vitest suite
pnpm test        # Vitest unit and integration test suite
pnpm build       # Builds packages/*, mcp/, and website/
```

For account/design/media/AI and browser changes, the full gate must run with real
Firebase Auth/Firestore/Storage emulators, not skipped integration suites:

```powershell
npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm check"
```

Only demo projects are allowed in automated tests. No production data or paid
provider calls may be used for this gate.

## Focused verification matrix

| Scope of Change                                | Primary Verification Commands                    |
| ---------------------------------------------- | ------------------------------------------------ |
| Formatting & style                             | `pnpm format` or `npx prettier --write <files>`  |
| Core schemas, Liquid compilation, token math   | `pnpm --filter @tinytldr/core test`              |
| Runtime text fitting, overflow, WCAG contrast  | `pnpm --filter @tinytldr/runtime test`           |
| Chromium image, PDF, and ffmpeg video pipeline | `pnpm --filter @tinytldr/renderer test`          |
| Template validation across all size presets    | `pnpm --filter @tinytldr/mcp validate:templates` |
| MCP stdio server & CLI integration             | `pnpm --filter tinytldr test`                    |
| Production dependency license gate             | `pnpm check:licenses`                            |
| Golden image comparison (Linux container only) | `pnpm test:golden`                               |

## Environment notes

- **Chromium & Fonts:** Playwright Chromium is used for deterministic rendering. Bundled OFL fonts are loaded locally with all external network requests blocked during render.
- **FFmpeg Subprocess:** `ffmpeg` and `ffprobe` are executed strictly as child processes, never linked into Node binaries.
- **Cross-Platform Font Rendering:** Pixel-diff golden image assertions run only in the pinned Linux container; Windows and macOS run structural, dimension, `ffprobe`, PDF page-size, and runtime warning assertions.

## Pre-delivery checklist

1. Run `pnpm check` (0 errors, 0 warnings, 0 disallowed licenses, all tests passing).
2. Run `pnpm build` (clean build across all packages and apps).
3. Record empirical command outputs before concluding any phase in [.agents/docs/PLAN.md](../docs/PLAN.md).
