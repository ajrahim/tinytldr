# Prompt toolbar and wordmark polish

Status: Shipped

## Approved scope

- Thinking/result/Undo labels no longer appear beneath the prompt. Generation outcomes and Undo remain in history; screen-reader announcements and explicit error alerts remain.
- Clear the main prompt text only after a successfully applied result. Keep attachments/targets and preserve text on failure/cancellation; do not erase newer text.
- Move Code / Source editors and Canvas size from the header to the right of Prompt/history, with matching dividers. Preserve actions, supported presets, custom-size inputs and keyboard behavior.
- Make the sidebar wordmark one theme-aware color and exactly 20% smaller: 19px to 15.2px.

## Out of scope

No history persistence, generation/provider/API changes, attachment reset, navigation changes, other branding/export changes, dependencies or backend deployment.

## Acceptance criteria

- No visible generation labels or fallback Undo below the prompt while thinking or after completion. History Undo remains reachable; errors and accessibility announcements remain truthful.
- Main input clears on applied success, including when hidden, and retains text on rejected, failed or cancelled requests. History retains the sent prompt; context/targets are unchanged.
- Code and Canvas size follow Prompt/history with 1px dividers, are absent from the header and work on desktop/mobile in Day/Night without overflow. Compact mobile spacing may hide the Fit text label, retaining its icon, tooltip and accessible name.
- Wordmark measures 15.2px and is monochrome on desktop/mobile Day/Night; template/export typography is unchanged.
- Existing cancellation, undo/source guards, canvas fitting/manual camera, editor state and size semantics remain passing.
- `pnpm check` and `pnpm build` pass; inspect isolated native/fixture previews without changing shared browser data.

## Compatibility and evidence

Frontend-only, applying to the Firebase workspace and local editing. Code/size
actions retain their existing owners and contracts; custom-size fields remain
outside the toolbar. History remains session-only; no provider/backend change.

- Focused legacy browser gate: **46 tests / 5 suites**; native workspace and
  compact toolbar gate against real Auth/Firestore emulators: **20 tests / 2 suites**.
- Real-emulator `pnpm check`: **284 tests / 36 suites**; all formatting, zero-warning
  ESLint, workspace typechecks and licenses (**9 MIT / 312 permissive dependencies**)
  passed. `pnpm build` completed for every workspace.
- Browser assertions cover exact 15.2px/monochrome branding, 1px dividers and full
  320/390/1440px toolbar bounds in Day/Night, source/size functionality, clipped
  live announcements/no footer Undo, successful hidden-input clearing, retained
  sent history/context/targets, failed/cancelled input and unsent follow-up text
  surviving Undo. Existing camera/source/account/navigation guards passed.
- Responsive assertions wait for the header and popover to settle after resize
  before measuring, rather than comparing stale desktop coordinates to mobile bounds.
- Five isolated native desktop/mobile and stubbed Thinking/result screenshots
  were visually inspected: cleared composer with no footer caption, outcomes/Undo
  in history, compact divided toolbar and smaller monochrome brand.
- No real provider calls, new dependencies, shared-browser mutations or backend
  deployment. Temporary screenshots/helper and task emulators cleaned up.
