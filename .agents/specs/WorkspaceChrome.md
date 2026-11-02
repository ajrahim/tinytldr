# Workspace footer and visibility controls

Status: Shipped. Scope approved by the user.

## Scope and acceptance

- Add a site-wide 48px footer with Welcome, Docs, and a GitHub link to https://github.com/ajrahim/tinytldr (owner-supplied URL; replaces the initial disabled placeholder). Open GitHub in a separate tab without replacing the current workspace. Place Day/Night theme buttons at the right, using the existing persisted light/dark preference. Remove the relocated sidebar links and More-menu appearance controls; keep MIT licensing unchanged.
- Hide the HTML/CSS/JSON editors and their divider on initial site load. A named, tooltip-equipped header icon toggles them. Mount editors on first reveal, then retain source, undo histories, and split ratio while hidden; the preview fills the available area without reloading its unchanged iframe. Invalid source remains visibly reported while editors are hidden. Keep visibility and desktop sidebar choices during in-app navigation, including the first Save; browser reload restores the defaults.
- Use a 14px title with a sidebar toggle immediately to its left. Allow desktop collapse/reopen and preserve the existing accessible mobile drawer.
- Show Save/Save copy and Latest/Version xx as icon-and-text actions; other top actions stay icon-only with tooltips.
- Preserve version privacy, saving, imports/exports, Library, dialogs, local recovery, preview resizing, and theme persistence. Keep desktop/mobile layout within the viewport in both appearances, with the footer below the entire workspace.

## Verification

- `pnpm -r build` and `pnpm check` pass, including formatting, lint, strict type checks, and the license audit (8 MIT manifests / 180 permissive production dependencies).
- All 144 tests across 20 suites pass, including 43 affected browser tests across 5 suites.
- Browser coverage verifies the 48px header/footer, 14px title, default-hidden editors, retained source/undo/split ratio/iframe, invalid-source recovery, sidebar controls, theme persistence, and existing private saved-version behavior.
- Production inspection passed at 1440px desktop and 390px/320px mobile widths in Day/Night appearances, with no document overflow. Checked source visibility, desktop sidebar collapse/reopen, and the Library header/footer. Restored the original draft in Day appearance with the desktop sidebar expanded and editors hidden; no source edits were made.
- No database or dependency changes were required.
