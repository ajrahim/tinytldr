# Design controls

Status: Shipped

## Approved scope

- Section titles trigger the existing accessible hover/focus/touch tooltips; no information icons or browser-draft dots.
- The current Firebase app has sibling horizontal ellipsis menus with Claim (unclaimed only), Rename, and Delete.
- Claim sits immediately left of Save for editable unclaimed designs, including browser-only drafts. Signed-out users sign in first.
- Signed-in New design follows [personal workspace ownership](./PersonalWorkspace.md): it is already account-owned and has no Claim.
- Rename changes the real design title without saving unrelated editor changes or losing raw source recovery.
- Delete requires confirmation. Browser-only drafts are removed locally; saved designs and every saved version are permanently deleted through the trusted Firebase service.
- Owner/edit-key authorization and optimistic revisions protect saved mutations. Deletion is retryable and a minimal authorization tombstone prevents old requests recreating deleted designs.
- Saved-design controls use the trusted Firebase service exclusively.

## Out of scope

Agent/MCP/CLI integration is the next phase, prioritizing Claude Cowork and both OpenAI desktop and web/cloud Work. No package publishing, hosted MCP deployment, renderer migration, telemetry, or unrelated refactors in this phase.

## Acceptance criteria

- Tooltips work with mouse, keyboard, touch, Escape, resize, and sidebar scrolling in Day/Night.
- Menus are keyboard-operable, outside navigation buttons, viewport-clamped, and usable in the mobile drawer.
- Claims persist valid local recovery; invalid or conflicting recovery is retained and reported rather than discarded.
- Renaming active/inactive drafts and saved designs preserves unrelated raw source; saved renames create immutable revisions.
- Deletion removes all version documents, invalidates public/history reads, excludes deleted designs from account lists, rejects unauthorized/stale requests, and cannot be undone by a delayed create/save/claim.
- A failed version cleanup reports failure and can be retried with the original authorized deletion request.
- Browser tests exercise confirmation/cancellation, active/inactive actions, header eligibility/placement, source preservation, and truthful errors.
- A mutation finishing after navigation never redirects the newly opened workspace; recovery remains locally persisted during pending mutations.
- `pnpm check`, `pnpm build`, and deployed dispatcher/auth/CORS checks pass before shipping.

## Evidence

- Firebase CLI 15.34.2 `emulators:exec --project demo-tinytldr --only auth,firestore --non-interactive "pnpm check"`: **281 passing tests / 36 suites**, formatting, zero-warning lint, workspace typechecks, **9 MIT manifests / 312 permissive production dependencies**.
- `pnpm build`: all workspaces passed.
- Real-emulator tests cover 501-version permanent deletion, unauthorized/stale requests, cleanup failure/retry, immutable renamed snapshots, recovery, late navigation, 320px header bounds and Day/Night mobile menus/dialogs.
- Current native desktop preview visually inspected without reloading or changing existing browser drafts. Both existing app servers returned 200; exact task emulators stopped and ports 8080/9099 verified free.
- First MCP deployment failed on expired operator credentials. Owner reauthentication completed; replacement MCP job **1793544874916** succeeded with target `functions`.
- Live checks passed: real guest save/rename and two immutable versions; stale rename/delete **409**, wrong-key delete **403**, unsigned claim/list **401**, permanent deletion and retry **200**, deleted public/history reads and delayed recreation **404**. Four allowed preflights **204**; denied origin **403**.
- All three functions are ACTIVE and AI encryption secret version 1 is preserved. The exact temporary production design, versions and tombstone were removed. No Auth accounts, provider calls, or dependencies were added.
