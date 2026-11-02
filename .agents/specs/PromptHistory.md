# Prompt toggle and session history

Status: Shipped

## Approved scope

- A split Prompt control follows + Page with the same divider. Its main button toggles the bottom prompt; its chevron toggles a history dropdown below the control.
- The prompt starts visible. Hiding it preserves text, targets, attachments and ongoing generation rather than unmounting the composer.
- History starts closed and opens when a request starts ("Thinking...") and again when an outcome arrives. Manual dismissal remains respected between those events; automatic opening must not steal focus.
- History contains sent prompts and actual generation outcomes, not invented conversational replies or provider reasoning. No additional provider calls or API changes.
- History is ephemeral for the current workspace/account and clears on refresh, navigation or account change. Do not persist prompts, attachments or results in browser/server storage.
- Cancellation, guarded undo, source/account/model invalidation and explicit errors remain accessible and truthful.
- Results received during a Library visit remain in the same mounted workspace session and are shown on returning to the design, not over Library. Automatic history waits for unrelated modal dialogs to close.

## Out of scope

No persisted conversations, streaming/prose responses, resend/retry controls, provider/backend changes, model/key changes, other navigation redesigns or agent integrations.

## Acceptance criteria

- Toggle placement/divider, prompt preservation and initial visibility pass desktop/mobile Day/Night checks.
- Hiding the prompt reclaims its fit inset without resetting manual camera state or reloading an unchanged preview.
- Pending/success/error/cancel/undo outcomes and multiple sent prompts display correctly. Manual hide stays closed until the next request/outcome.
- Dropdown has appropriate rich-content semantics, viewport-clamped bounds, bounded scrolling, keyboard focus/Escape/Tab/outside dismissal and no canvas-gesture interception.
- Hiding the prompt does not cancel generation; explicit cancellation and stale-result guards remain passing.
- History and prompt data do not survive workspace/account changes or enter persisted design/media data.
- `pnpm check` and `pnpm build` pass; inspect isolated native previews without changing shared browser data.

## Ownership and compatibility

[AiComposer](../../website/src/components/AiComposer.tsx) owns prompt/history visibility
and renders its controls into the canvas navigation slot without moving or
duplicating generation state. [useAiGeneration](../../website/src/hooks/useAiGeneration.ts)
owns ephemeral request/outcome entries, cancellation and undo.
[Dropdown](../../website/src/components/Dropdown.tsx) shares placement and dismissal
with a controlled, non-modal rich-dialog mode; ordinary menus/listboxes retain
their existing styles and keyboard behavior.
[ArtboardCanvas](../../website/src/components/ArtboardCanvas.tsx) re-fits automatic
Fit mode when the composer inset changes; manual camera reveal reads the latest
inset without treating composer height as a pan/zoom reset. Resize/selection
behavior and unchanged iframe reuse remain intact.

## Verification

- Official Firebase CLI `emulators:exec --project demo-tinytldr --only auth,firestore --non-interactive` wrapping `pnpm exec vitest run website\firebase\test\WorkspaceBrowser.test.ts website\test\AiComposerBrowser.test.ts website\test\DropdownBrowser.test.ts website\test\PersonalWorkspaceBrowser.test.ts website\test\AiGeneration.test.ts`: **55 tests / 5 suites passed**.
- Real Auth/Firestore emulator `pnpm check`: **284 tests / 36 suites passed**, formatting, zero-warning ESLint, all workspace typechecks and license audit passed (**9 MIT manifests / 312 permissive production dependencies**).
- `pnpm build`: all workspaces and the production website passed.
- Browser assertions cover visible/hidden prompt state and preserved text/target/file context; greater Fit zoom with the prompt hidden; exact preserved manual pan/zoom and unchanged iframe marker; initial/automatic/manual history visibility; rich-dialog focus/Escape/Tab/outside dismissal; 8px-clamped desktop/mobile bounds at 1440/390/320px in Day/Night; bounded long-message scrolling without canvas gestures; actual generation/undo/cancel/error entries and exact sent request prompts; no prompt history in browser persistence or exported design JSON.
- Native Firebase checks verify generated/undone entries with the prompt hidden, pending/model-invalidated entries, and history remaining hidden during the connection modal. Library completion queues history for the editor; route/account changes clear entries and reject late results.
- Isolated Thinking/result screenshots with local provider stubs were visually inspected in Day/Night and 320px mobile. The current native preview returned **200** and its empty-history dropdown was inspected in a separate browser context. Shared browser data was untouched; no real provider calls.
- Task emulators, preview helpers and exact temporary screenshots were removed. No dependencies, backend deployment or production Auth fixtures.
