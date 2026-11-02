# Account settings

Status: Shipped. Standard settings scope approved by the user.

## Scope and acceptance

- Replace the oversized account card with a compact, theme-aware native dialog:
  profile, appearance, AI connections, and a separate sign-out footer.
- Persist an optional display name through Firebase Auth.
  The shared [profile contract](../../packages/core/src/AccountProfile.ts) trims
  input and rejects names above 80 characters. Save explicitly; show pending,
  error, retry, and success states. Clearing a name removes the custom name.
- Email is read-only. Display the actual verification state from the selected
  authentication SDK, not an assumed status.
- Day/Night uses the existing [theme owner](../../website/src/hooks/useThemeMode.ts)
  and browser preference. Profile and theme updates must retain the design source
  and unchanged preview iframe.
- Report real provider loading, errors, counts, and unavailable backend status.
  Do not offer credential-entry controls for the undeployed Firebase AI gateway.
- Keep headers and sign-out reachable on short screens with internal body scrolling.
  Verify no horizontal overflow at 320px and 390px widths in both appearances.
  Preserve native modal focus containment, Escape, focus return, guest email-link
  sign-in, retry, account restoration, and sign-out.
- Pending profile results must not restore a signed-out or different account.
- Sign-out errors remain visible even when an SDK has already cleared its local
  session. A successful new sign-in-link request clears the previous diagnostic.

## Compatibility and exclusions

Firebase is the sole account backend; missing configuration explicitly disables online operations.
No design, guest-link, or export data changes. Names are profile metadata, not design
content. No email change, account/data deletion, MFA, password, billing, telemetry,
AI migration, storage migration, or hosting changes.

## Verification

- `firebase emulators:exec --project demo-tinytldr --only auth,firestore
--non-interactive "pnpm check"` passed: **205 tests / 31 suites**, formatting,
  lint, all workspace type checks, and license audit (**9 MIT manifests /
  312 permissive production dependencies**).
- `pnpm build` passed across all workspaces. The existing Vite large-chunk warning
  remains; it does not fail the build.
- [Profile tests](../../website/test/AccountProfile.test.ts) verify trimming,
  exact 80/81-character limits, clearing, SDK verification metadata, and safe
  diagnostics for malformed names.
- [Settings browser tests](../../website/test/AccountSettingsBrowser.test.ts)
  verify persistence, failed-save retry, local/remote sign-out behavior, connection
  loading/error/count states, unchanged unsaved source/iframe, persisted appearance,
  keyboard containment, Escape, and focus return.
- [Real Firebase browser tests](../../website/firebase/test/WorkspaceBrowser.test.ts)
  verify email-link sign-in, claiming, profile persistence/reload, truthful
  undeployed-gateway status, and late saves after sign-out or account switching.
  Both backends fit 320px/390px mobile widths and a 640x360 short viewport in
  Day/Night, with no horizontal dialog overflow and a reachable sign-out footer.
- Inspected the actual signed-in Night panel using an isolated test backend after
  a profile save; tightened spacing to keep connection actions visible. The
  configured local website remained responsive with HTTP 200. No production
  account metadata or cloud designs were changed by these checks.
