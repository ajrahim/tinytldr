# Personal workspace

State: Shipped; backend/file-format boundaries are superseded by the
[Firebase fresh-install specification](./FirebaseBackend.md).

## Behavior

- Personal creation, not template sharing. A single workspace provides a personal
  sidebar, independently authored artboards, preview, and HTML/CSS/JSON editors.
- Create without signing in. Save public viewing links with a separate private
  guest edit/claim key held only in the creating browser.
- Signed-in New design immediately creates an account-owned cloud design and
  opens its saved link without Claim. Guests continue creating local drafts.
  Signing in alone does not claim existing guest drafts; subsequent edits still
  require Save.
- Pending creation disables duplicate actions. Retrying an ambiguous failure
  reuses its design ID; failures preserve the current design and unfinished source.
  Account changes and navigation prevent late creation from redirecting the
  current workspace, and requests cannot create for a different account.
- Firebase accounts can claim with a session and private key once. Afterwards
  only the owner may mutate; other viewers can copy.
- Local drafts retain current projects and unfinished per-page JSON. Account-owned
  designs, whether created signed in or claimed, appear in the account list, not
  guest history.
- Shared core contracts validate current version-2 project data.
  Trusted Firebase services hash guest keys and authorize mutations/versions.
  No direct client access to key hashes.
- Optimistic revisions prevent silent concurrent overwrites. Guest keys use
  256 random bits and never appear in public design URLs.
- Missing backend configuration explicitly disables online operations without
  disabling local editing/recovery.
- Shared sanitizer/CSP block external resources and untrusted scripts; only the
  trusted preview runtime/bridge executes in the sandbox.
- Invalid source stays editable and blocks saves/exports; no sample replacement.

## Evidence contract

Use real Auth/Firestore emulators for create/update/claim/conflict/history and
authorization evidence. Browser tests cover authoring, save/reload/copy,
unfinished-source recovery, account races, claim preservation, storage failure,
idempotent signed-in New design, and responsive Day/Night behavior. Live
deployment/email delivery are separate.
See [setup and ownership](../docs/PersonalWorkspace.md).

## Latest verification

The signed-in New design follow-up passed the demo Auth/Firestore emulator
`emulators:exec --project demo-tinytldr --only auth,firestore --non-interactive "pnpm check"`:
**342 tests / 43 suites**, no skips, formatting, zero-warning ESLint, all workspace
typechecks, and **9 MIT manifests / 304 permissive production dependencies**.
`pnpm build` passed every workspace. Focused
[cloud creation browser tests](../../website/test/NewCloudDesignBrowser.test.ts)
verify actual ownership/reload, explicit later Save, guest isolation, duplicate
clicks, committed-but-failed response retry, unfinished source, and late
account/navigation completion. No styling changes or live deployment.
