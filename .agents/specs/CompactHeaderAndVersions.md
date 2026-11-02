# Compact header and saved versions

Status: Shipped. Approved: icon-only controls, editable historical drafts, and retention of all saved versions.

Subsequent changes: [consistent dropdowns](./ConsistentDropdowns.md) replaces native size selection with the shared accessible selector and standardizes Versions styling. The scope and evidence below record this feature's original shipment.

## Scope

- One approximately 48px header row: editable title, flexible gap, Size, Save, Versions (Latest by default), and ellipsis More. Keep icons named for assistive technology and explained by tooltips; preserve native size selection, export menus, save feedback, and responsive sidebar access.
- Keep all persisted revisions as immutable snapshots from creation. Include revision changes from claiming; do not invent missing history.
- History is private to the owner or current guest capability-holder. Public viewing links still expose only the latest design. Read metadata in bounded, cursor-paginated batches.
- Selecting a historical version loads the whole design as an editable draft. Confirm before replacing unsaved/invalid source; saving creates a new latest revision through existing optimistic-concurrency checks. Never overwrite a historical snapshot.
- Browser-only drafts have no saved versions until a successful online Save. Keep local unfinished-source recovery separate from saved-version history.

## Verification

- `pnpm -r build` and `pnpm check` pass: 142 tests across 20 suites, plus formatting, lint, type checks, and the permissive-license audit.
- Firebase emulator tests now own persistence evidence for immutable snapshots, bounded pagination, owner/guest authorization, key retirement, and direct-client denial. Fresh installation supersedes original database-upgrade coverage.
- Six browser tests verify the 48px row and icon order at 1440/390/320 widths, native size selection and keyboard menus, editable whole-design restore and undo isolation, new latest saves, confirmation/cancellation, explicit errors/retry, public-view privacy, pagination, and concurrent-save protection with explicit Latest reload.
- Production preview inspected at desktop and 320/390px mobile widths in light/dark appearance. Measured 48px header and zero document overflow; the open version popup stays inside a 320px viewport when resizing from desktop. The original draft, light appearance, and 1440x1000 viewport were restored.
- Online history is provided by the trusted Firebase service; see [setup](../docs/FirebaseBackend.md). No imported-data upgrade is required.
