# Single workspace shell

Status: Shipped

The later approved [rendered-media library](RenderedMediaLibrary.md) supersedes this specification's original account-control placement, MCP-card order, and absence of a media-library pane. Existing editable-design routes remain editor aliases.

## Approved scope

- Open directly into the design workspace at `/`; no landing page or separate design-library page.
- Combine the former site and design headers into one toolbar with title, More, Save, appearance, and account controls.
- Keep branding, creation, account designs, and browser history in one sidebar. On mobile, expose that same sidebar through an accessible drawer rather than another page.
- Present a short welcome modal on first launch per browser. Reopen it from Welcome or the sidebar wordmark. Storage failures must remain visible and must not prevent dismissing the modal.
- Put an MCP connection card immediately above guest history. Reuse the existing Claude Code, Codex, and generic MCP setup snippets in a dialog.
- Open setup and documentation over the current editor without navigating away or discarding unsaved work.
- Preserve public links, local recovery, one-time claiming, account ownership, compilation, and exports. Legacy workspace/library/starter URLs still open the same editor; legacy documentation URLs open its documentation dialog.

## Verification

- Browser assertions for one header, direct workspace routes, once-per-browser/reopenable welcome, MCP card order, client setup/copy errors, and unchanged edits after help.
- Mobile drawer keyboard dismissal/focus, history navigation, switching to guide dialogs, resize handling, and light/dark viewport bounds.
- Existing persistence/claim/recovery/compiler tests, production build, and repository quality gate.

## Evidence

- `pnpm --filter @tinytldr/website build` passed.
- `pnpm check` passed: formatting, ESLint, all workspace TypeScript checks, all 8 MIT manifests / 110 permissive production dependencies, and 90 tests across 13 suites.
- Browser tests measured non-overlapping header controls and no horizontal overflow at 320, 390, 768, and 1440px in light/dark modes. Existing 4096px mobile canvas, saved-link/fork/claim, recovery, and storage-failure checks remain green.
- Visually inspected the desktop workspace/welcome modal and the mobile workspace, sidebar drawer, and MCP setup dialog.
