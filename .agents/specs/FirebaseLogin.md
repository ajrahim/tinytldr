# Firebase login

State: Shipped. Approved Firebase-only email/password and Google sign-in phase.

## Scope and acceptance

- Firebase guests use email/password Sign in, Create account, Forgot password,
  and Continue with Google in the existing shared modal shell.
- Use Firebase Auth SDK operations, its configured password policy, session
  persistence, and real Google popup flow. Never store or log passwords.
- Password signup sends a verification email; delivery failure remains visible
  even after the new account replaces the guest dialog. Verification status
  stays truthful. Recovery uses Firebase's hosted reset action.
- Fresh installations use only password/Google login. Password reset preserves
  UID/design ownership; no email-link completion is retained.
- Explicit validation, pending/disabled states, readable errors, popup cancellation,
  password visibility, correct autocomplete, keyboard behavior, Day/Night and
  mobile layout. Preserve local source, preview, saved designs, and account races.
- Verify live project provider enablement/authorized domains without changing
  unrelated Firebase services. Human live Google/email checks are reported
  separately from emulator evidence.
- Repair the existing designs HTTP adapter's bodyless preflight crash and add
  the actual localhost/127.0.0.1:5173 development origins while preserving 5199.
  Keep strict origin rejection and token authorization; do not weaken browser
  COOP headers to suppress popup diagnostics.

## Exclusions

No account deletion, billing, imported-data upgrades,
automatic cross-provider credential linking, or new password-change settings.

## Verification

- Official Firebase CLI Auth/Firestore `emulators:exec` running `pnpm check`
  passed **230 tests / 33 suites**, formatting, zero-warning lint, all TypeScript
  checks, and **9 MIT manifests / 312 permissive production dependencies**.
  `pnpm build` passed every workspace; existing Vite notices remain.
- [Real browser coverage](../../website/firebase/test/WorkspaceBrowser.test.ts)
  verifies signup, project-policy rejection, verification action redemption,
  session restoration, password login/reset, Enter submission, Google popup
  success/cancellation, disabled controls, and unchanged design ownership.
  Password recovery retains the UID and claimed design. Delivery failure survives
  guest-to-account remount; profile races remain covered. Historical callback
  coverage is superseded by the fresh-install scope.
- [SDK unit tests](../../website/test/FirebaseAccount.test.ts) verify exact
  password preservation, no credential storage, stronger project policy,
  provider configuration, action URLs, and explicit errors. The emulator lacks
  `getPasswordPolicy`, so its browser fixture supplies an explicit policy API
  response; application code has no fallback. The live project endpoint returned
  schema version 1 / minimum length 6.
- [HTTP adapter tests](../../website/firebase/test/HttpEntry.test.ts) reproduced
  three `rawBody` crashes before the fix, then passed all four adapter cases.
  The existing designs function was deployed through Firebase MCP. Live OPTIONS
  returned **204 with exact CORS origin** for localhost/127.0.0.1 on 5173 and 5199;
  an unapproved origin returned **403 without allow-origin**, and unauthenticated
  listing returned **401 with CORS retained**.
- Firebase email/Google providers and authorized hosts were already enabled and
  verified. The owner confirmed **live Google sign-in works**. Popup COOP
  diagnostics did not justify weakening browser headers; the actual localhost
  5173 design-request failure was separately repaired.
- Visually inspected all three guest modes in mobile Day/Night and live desktop
  sign-in; geometry/focus/Escape checks cover 1440x900, 390x844, 320x568, and 640x360.
  Temporary captures/code and task-owned emulators were removed.
- Live password signup and verification/reset inbox delivery were not human
  checked; emulator coverage is not represented as live email-delivery evidence.
