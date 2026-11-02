# Firebase fresh installation

State: Shipped (repository implementation and configuration; live deployment excluded)

## Approved scope

Firebase is the sole hosted backend for fresh installs. Remove alternative
backend implementations, dependencies, SQL setup, and old-format conversions.
Preserve the existing Firebase UI, deterministic rendering, local drafts,
public viewing links, guest edit keys, claiming, owner checks, revision
conflicts, immutable versions, and the optional website AI composer.

Website Hosting uses `https://www.tinytldr.com`; authenticated hosted rendering
uses `https://api.tinytldr.com`. The existing MCP URL and issuer remain at
`https://mcp.tinytldr.com/mcp` and `https://mcp.tinytldr.com`.

## Requirements

- Missing Firebase configuration explicitly disables online operations without
  breaking local editing. There is no backend selector.
- Firebase Auth supports password/Google sign-in, signup verification, reset,
  session restoration, profile editing, and sign-out. No email-link completion.
- Trusted services validate core Zod contracts and Firebase tokens. Direct
  Firestore client access is denied. Current version-2 projects are the only
  external design format; incomplete per-page raw source remains recoverable.
- Transactions enforce authorization, optimistic revisions, claims, immutable
  history, deletion tombstones, and cleanup. Public responses expose neither
  credential hashes nor private versions.
- Optional AI uses one encrypted account-owned connection, discovered models,
  server-only provider calls, bounded requests, and stale-result guards.
  No multi-key keep-one, manual/default connection, or credential upgrade path.
- Hosted exports require Firebase user authentication, exact origins,
  owner-private artifacts, and bounded Chromium/FFmpeg work. Development may
  use a loopback renderer; no shared server secret enters browser configuration.
- Public identifiers remain configurable; privileged credentials are never
  committed. Defaults select the demo emulator project.

## Acceptance evidence

Required: real Auth/Firestore emulator authorization/transaction tests,
current-format roundtrips and explicit old-input rejection, browser regressions,
hosted API auth/origin/artifact/budget tests, `pnpm check`, and `pnpm build`.
Record actual results at phase completion; passing historical checks do not
verify changed code.

Verified with the official Auth/Firestore emulator runner:
`npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore --non-interactive "pnpm check"`.
All **335 tests / 42 suites** passed, with no skipped suites; formatting,
zero-warning ESLint, all workspace typechecks, and the license audit
(9 MIT manifests / 304 permissive production dependencies) passed.
`pnpm build` passed all workspaces. Docker is unavailable in this environment,
so image execution remains unverified. No live deployment, DNS/TLS change,
cloud-data deletion, or paid provider call was performed.

## Out of scope

Live deployment, DNS/TLS changes, deleting existing cloud data, UI redesign,
account linking, imported-data upgrades, cloud Library synchronization, telemetry,
billing features, social posting, collaboration, and LLM calls in core/MCP/rendering.
