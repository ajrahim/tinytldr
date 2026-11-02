# Workspace state polish

Status: Shipped

## Approved scope

- Center the indeterminate "Opening your canvas..." status horizontally and
  vertically within the editor pane, with a small animated loader.
- Respect reduced-motion preferences and retain the accessible loading status.
- Suppress pointer-induced canvas focus borders without removing keyboard focus
  indicators or changing artboard selection, pan, zoom, or source editing.
- Center My Library's empty and filtered-empty content below its toolbar, using
  the available pane height rather than a fixed top margin.

Out of scope: backend changes, percentage progress, export/storage changes,
library loading behavior, and hosted-MCP deployment.

## Owners

- [PlaygroundPage](../../website/src/pages/PlaygroundPage.tsx) and its
  [styles](../../website/src/styles/pages/PlaygroundPage.css) own loading/error
  presentation; error styling remains separate from the opening modifier.
- [ArtboardCanvas](../../website/src/components/ArtboardCanvas.tsx) and its
  [styles](../../website/src/styles/components/ArtboardCanvas.css) own camera
  interaction and focus presentation.
- [MediaLibrary styles](../../website/src/styles/components/MediaLibrary.css)
  own the empty-state layout; library data and actions remain unchanged.

## Acceptance and verification

Native browser assertions must measure content centers within 1px in Day/Night
at desktop and mobile sizes, confirm advancing animation and reduced-motion
suppression, distinguish pointer focus from keyboard focus, and retain error,
selection, camera, empty-filter, and populated-library behavior.

Complete the phase only after `pnpm check` with real Firebase Auth/Firestore
emulators and `pnpm build` pass. Record measured evidence in the build plan.

Evidence: real-emulator `pnpm check` passed **319 tests / 41 suites**, all
format/lint/type/license gates (**9 MIT manifests / 312 permissive production
dependencies**), and all workspace builds passed. Native
[artboard tests](../../website/test/ArtboardWorkspaceBrowser.test.ts) measure
loading centers within 1px at 1440x900, 390x844, 320x568, and 640x360 in Day/Night,
advancing animation, reduced-motion suppression, load-error recovery, pointer/
keyboard focus, unchanged selection, and keyboard camera controls.
[Library tests](../../website/test/MediaLibraryBrowser.test.ts) measure empty
and filtered-empty centers within 1px at the same sizes/themes and retain a real
PNG through export, filtering, and return to the populated grid. Existing camera,
touch, source-recovery, media formats, storage/error, and persistence cases pass.
No dependencies, backend deployment, shared browser data, or real provider calls
were changed. Existing build/tooling notices remain.
