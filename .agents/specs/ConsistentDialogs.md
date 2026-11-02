# Consistent dialogs

Status: Shipped. All existing centered custom modals approved for cleanup, keeping
tinytldr's black/white primary buttons.

## Scope and acceptance

- Use one native [Dialog](../../website/src/components/Dialog.tsx) shell and its
  [owned styles](../../website/src/styles/components/Dialog.css) for sign-in/account,
  Welcome/agent setup/documentation, provider connections, and media previews.
- Consistent compact left-aligned title/subtitle, close control, borders, corners,
  backdrop, field spacing, and primary/secondary action treatment. No decorative
  header badges or oversized brand eyebrows.
- Content-sensitive compact, standard, documentation, and media widths. Headers
  and action footers remain reachable; bodies scroll internally. No horizontal
  overflow at 320px and 390px, or offscreen controls at 640x360, in Day/Night.
- Action footers use real form associations; Enter, validation, disabled/pending
  state, cancellation, errors, and existing workflows remain functional.
- Keep native modal semantics, focus containment and restoration, initial input/
  onboarding focus, and Escape. Retain source, preview iframe, media object URLs,
  provider request cancellation, and account isolation.
- Each existing component owns its content/state/actions; the shared shell owns
  presentation and dialog lifecycle only.

## Exclusions and compatibility

No new OAuth/password, sharing, invitation, deletion, or account features from the
reference. No backend changes. Drawers, anchored popovers/dropdowns, and browser
confirmation prompts retain their intended behavior. Existing modal accessible
names and workflows remain supported; the new shell replaces duplicated layout.

## Verification

- Official Firebase CLI `emulators:exec --project demo-tinytldr --only
auth,firestore --non-interactive "pnpm check"` passed **212 tests / 32 suites**,
  formatting, zero-warning lint, TypeScript, and the license audit (**9 MIT
  manifests / 312 permissive production dependencies**).
- `pnpm build` passed every workspace. Existing Vite empty-auth and large-chunk
  notices remain.
- [Dialog browser coverage](../../website/test/ConsistentDialogsBrowser.test.ts)
  verifies six dialog modes in Day/Night at 1440x900, 390x844, 320x568, and 640x360:
  common geometry/colors, reachable controls, no body/outer horizontal overflow,
  Tab looping, Escape, opener focus, and unchanged preview iframe. All six
  documentation sections are checked at each size/theme; guide topic transitions
  retain modal focus.
- [Media coverage](../../website/test/MediaLibraryBrowser.test.ts) checks real
  PNG/PDF/video downloads, retained media, matching preview layout, and Download
  focus. Existing account/provider suites verify form submission, errors, pending
  state, cancellation, availability, and profile/account isolation.
- Visually inspected mobile Day/Night sign-in, account settings, Welcome, agent
  setup, documentation, provider form, and PNG preview, plus live desktop Night
  sign-in. A focused visual-fixture run passed **14 tests / 2 suites**. Temporary
  capture code/images were removed.
