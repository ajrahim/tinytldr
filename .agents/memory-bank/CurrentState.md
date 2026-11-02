# Current state

Source baseline: 2026-10-25.

[Firebase Storage media](../specs/RenderedMediaLibrary.md) is shipped. Account-owned
uploads, rendered exports and thumbnails persist in private Firebase Storage;
Firestore owns library metadata, upload deduplication and the 100 MB account quota.
There is no browser-media migration or local fallback. Final real
Auth/Firestore/Storage emulator `pnpm check` passed **354 tests / 44 suites**, no
skips, all format/lint/type gates, and **9 MIT / 304 permissive production
dependencies**. All workspace builds passed. Account-deletion tombstones block
late requests from recreating media. Non-fatal Firebase emulator/SDK warnings and
the existing Vite chunk-size advisory remain. No CSS changes, deployment, or real
provider calls.

[Signed-in New design](../specs/PersonalWorkspace.md) immediately creates an
account-owned cloud design without Claim. Guests stay local, existing guest drafts
are not claimed on login, and later edits remain explicit Save. Stable-ID retries
preserve unfinished source and account/navigation guards prevent stale redirects.
Focused real-emulator checks passed **21 tests / 2 suites**. The final real
Auth/Firestore emulator `pnpm check` passed **342 tests / 43 suites**, no skips,
all format/lint/type gates, and **9 MIT / 304 permissive production dependencies**.
All workspace builds passed. No styling changes, deployment, or real provider calls.

The [Firebase fresh-install cleanup](../specs/FirebaseBackend.md) is verified in
the repository: Firebase-only account/design/AI services, current project/recovery
formats, one AI connection, Firebase Hosting for `www.tinytldr.com`, and an
authenticated export API configured for `api.tinytldr.com`. The existing MCP URL
and issuer remain unchanged. No visual styling changes or live deployment were made.
The Firebase cleanup's real Auth/Firestore emulator `pnpm check` passed **335 tests / 42 suites**
with no skips, all format/lint/type gates, and **9 MIT / 304 permissive production
dependencies**. All workspace builds passed. Docker execution and live website/API
domain provisioning remain unverified and require separate operator actions.
Historical entries below record earlier evidence, not the current release gate.

[Authenticated hosted MCP](../specs/HostedMcp.md) remains Active.
The isolated Cloud Run service is deployed from the verified container with
min 0 / max 2 instances, 1 CPU / 2 GiB, concurrency 4 and a 130-second timeout.
Live health/discovery/login, unsigned-MCP denial, CORS and named-database access
checks pass. The owner approved Preview routing after reviewing limitations and
costs. The custom-domain mapping is created; Google's actual DNS requirement is
`mcp CNAME ghs.googlehosted.com.` at Name.com. The owner saved it and public CNAME/A
lookups confirm propagation. Google still reports `CertificatePending`; trusted
custom-domain TLS and live sign-in/export remain unverified, so the connector UI
is unchanged. Hosted prompts now describe short-lived downloads; local prompts
retain disk export. Full real-emulator checks pass 319 tests / 41 suites and all
builds. Isolated build `5451faab-3be1-4bc1-ab9f-526ea9960d64` succeeded; image
`hosted-20261101-2055` is deployed as revision `tinytldr-mcp-00002-n4w`, health 200
and runtime configuration unchanged. Test emulators/logs removed; real accounts,
existing AI/design services and secrets untouched. The specification documents
the future, separately cost-approved load-balancer upgrade retaining the same
client URL, issuer, accounts and storage.

Latest UI follow-up: [Welcome carousel](../specs/WelcomeCarousel.md)
is shipped with Templates built for agents. / Made to be consistent / Bring your
own key topics, slide-specific artwork (agent → template → post; three matching
pages with a shared-style strip; an optional key panel beside a "No key needed."
template) and accurate optional-AI BYOK copy.
Previous/next arrows sit at the modal edges and measure within 1px of the whole
modal center; 13px insets and reserved gutters prevent content overlap.
Topic buttons have been removed; arrows are the only slide navigation, with no
empty footer row. Start Creating and its account note remain unchanged.
Day/Night checks cover all topics at 1440/390/320px and 640x360; a real
320x360 scroll retains fixed arrows. Typed state, every wrapping transition,
60-second no-autoplay, keyboard/focus/reopen, live copy, unrotated motion/reduced
motion and mounted draft/preview regressions pass.
Desktop/mobile cleanup screenshots and live arrow navigation were inspected.
Focused checks passed 10 tests, including absent topic buttons and per-slide
artwork pieces inside, 1px-centered, unclipped and unrotated in every layout;
final real-emulator `pnpm check` passed **322 tests / 41 suites**, all gates
(**9 MIT / 312 permissive dependencies**) and all workspace builds.
Both preserved previews return 200. Exact task emulator/log/temporary output removed;
no dependencies, backend deployment or real provider calls.
Hosted-MCP remains separate and unchanged.

Latest library follow-up: [My Library](../specs/RenderedMediaLibrary.md) has an
Everything/Uploads/Exports toggle before All files. Prompt reference images are
saved on this device as uploads, deduplicated by SHA-256; exports are unchanged.
The device label and back-button arrow are removed. Real-emulator `pnpm check`
passed **323 tests / 41 suites** and all builds.

[Welcome landing modal](../specs/WelcomeLanding.md)
is shipped: "Templates for your agents" purpose/copy, original upright template
cards, top-left monochrome wordmark and only a centered, arrow-free Start Creating
button (176px minimum). Staggered fade/vertical entrance motion disables fully
under reduced motion. Very short screens prioritize the full headline; supplemental
copy scrolls with dismissal/footer reachable. Native Day/Night checks across
1440x900, 390x844, 320x568 and 640x360 verify <=1px centering, actual animation
positions/opacity/no rotation, focus/close/reopen, agent/docs navigation and
retained design state. Five isolated screenshots were visually inspected.
Focused checks passed 8 tests; final real-emulator `pnpm check` passed
**320 tests / 41 suites**, all format/lint/type/license gates
(**9 MIT / 312 permissive dependencies**) and all workspace builds.
Both preserved local websites return 200. Task emulator/logs/screenshots removed;
no dependencies, backend deployment, shared-browser data or real provider calls.
Hosted-MCP remains separate and unchanged.

[Workspace state polish](../specs/WorkspaceStatePolish.md)
is shipped: centered indeterminate canvas opening with reduced-motion support,
pointer-only focus-border suppression retaining keyboard/selection/camera behavior,
and centered empty/filtered-empty My Library content beneath its toolbar.
Native Day/Night centers measure within 1px at 1440x900, 390x844, 320x568 and
640x360; real PNG export/filter retention and existing regressions pass.
Real-emulator `pnpm check` passed **319 tests / 41 suites**, all format/lint/type/
license gates (**9 MIT / 312 permissive dependencies**) and all workspace builds.
Both preserved local websites respond 200. No dependencies, backend deployment,
shared browser data or real provider calls in that UI phase. Hosted-MCP progress
is recorded separately above.

[Sidebar card icons](../specs/SidebarCardIcons.md) is shipped:
right-side Sparkles for Connect an Agent and UserRound for Account/sign-in,
aligned within 1px at 1440/390/320px in Day/Night. Icons are decorative and 14px;
subtitle and actions remain unchanged. Real-emulator `pnpm check` passed
**284 tests / 36 suites**, all format/lint/type/license gates and workspace builds.
No deployment, dependencies or provider calls; task emulators removed.

[Prompt toolbar polish](../specs/PromptToolbarPolish.md)
is shipped. Thinking/result labels are visually hidden while preserving live
announcements and explicit errors; Undo lives in history. Applied success clears
the main sent prompt, retaining history/targets/attachments; failed/cancelled and
unsent follow-up text survive. Code/Canvas size follow Prompt/history with matching
dividers; full toolbar bounds and actions pass at 1440/390/320px in Day/Night.
Sidebar branding is monochrome at 15.2px (20% smaller). Real-emulator `pnpm check`
**284 tests / 36 suites**, all format/lint/type/license gates and workspace builds
passed. Five isolated native/Thinking/result previews were visually inspected.
No real provider calls, dependencies, shared-browser changes or backend deployment;
temporary screenshots/helper and task emulators removed.

[Prompt/history controls](../specs/PromptHistory.md) is shipped.
Split Prompt/chevron follows + Page; hiding preserves input/context and pending work,
while session-only sent prompts/outcomes automatically appear on request/result
without stealing focus. Cancel/Undo, manual dismissal, bounds/scrolling, model/source
invalidation and account/route isolation passed. Fit reclaims hidden prompt space;
manual camera/unchanged iframe state is preserved. History waits for modal closure
and does not overlay Library. Focused native/legacy gate **55 tests / 5 suites**;
real-emulator `pnpm check` **284 tests / 36 suites**, all format/lint/type/license
gates and workspace builds passed. Isolated native/Thinking/result previews were
visually inspected with local provider stubs. No persisted conversation, extra real
provider calls, dependencies or backend deployment; task helpers/emulators removed.

[Workspace action buttons](../specs/WorkspaceActionButtons.md)
is shipped: compact 32px content-width New design aligned with My Library;
bordered header Claim with a circled check after the label, retaining narrow-screen
icon-only behavior. Focused gate **34 tests / 2 suites**; real-emulator `pnpm check`
**282 tests / 36 suites**, all format/lint/type/license gates and workspace builds
passed. <=1px icon/label alignment and 320px header bounds passed in Day/Night;
existing actions, context menus and recovery retention remain verified. Isolated
native previews were visually inspected without changing shared browser data.
No backend deployment, dependencies or real provider calls; task emulators removed.

[Sidebar context menus and alignment](../specs/SidebarContextMenus.md)
is shipped: compact 140px design menus, unchanged 236px ordinary action menus,
scrollbar outside the shared row/card column, aligned counts/ellipses and a filled
New design button. Focused browser gate: **44 tests / 4 suites**. Real-emulator
`pnpm check`: **282 tests / 36 suites**, all format/lint/type/license gates
(**9 MIT / 312 permissive dependencies**) and all workspace builds passed.
Measured <=1px edge alignment with 1/106 drafts at 1440/390/320px in Day/Night;
keyboard/dismissal, button feedback and retained recovery passed. Isolated native
preview screenshots were visually inspected without changing shared browser data.
No backend deployment, dependencies or real provider calls; task emulators removed.

[Design controls](../specs/DesignControls.md) is shipped with
title-triggered tooltips, sibling ellipsis menus, Claim left of Save, recovery-preserving
rename and authorized permanent Firebase deletion. Real-emulator `pnpm check`:
**281 tests / 36 suites**, all check/build gates, 501-version deletion, conflicts,
cleanup retries, late navigation, mobile/Day/Night and legacy compatibility. The
Deno 2.9.6 graph passed. After owner reauthentication, Firebase MCP deployment
**1793544874916** succeeded. Live dispatcher/auth/CORS, real rename/revisions,
permanent deletion/retry and anti-resurrection checks passed; all functions ACTIVE,
AI secret version 1 unchanged. Exact temporary design/versions/tombstone and task
emulators removed. No dependencies, Auth accounts, or provider calls added.
Agent/MCP/CLI tooling for Cowork and both OpenAI desktop/web Work remains the next phase.

| Area                          | Current Status                                                                                                                                                                                                                                                                                                                                                                                                           | Primary Source Ownership                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Governance & Docs**         | Repository agent entry points (`AGENTS.md`, `CLAUDE.md`) and `.agents/` structure initialized.                                                                                                                                                                                                                                                                                                                           | `AGENTS.md`, `CLAUDE.md`, `.agents/`                                                                               |
| **Master Plan**               | Build brief saved verbatim in `.agents/docs/PLAN.md`.                                                                                                                                                                                                                                                                                                                                                                    | `.agents/docs/PLAN.md`                                                                                             |
| **Phase 0 (Spike)**           | Complete & verified (`pnpm check` passing; 1080×1080 PNG, PDF, and 5s 30fps MP4 rendered on Windows 11; ADRs 0001 and 0002 recorded).                                                                                                                                                                                                                                                                                    | `packages/*`, `mcp/`, `website/`, `.agents/`                                                                       |
| **Phase 1 (MVP)**             | Complete & verified (Core Zod/LiquidJS compiler, runtime auto-fit & WCAG checks, 3 static templates + OFL fonts, MCP server, CLI, golden tests).                                                                                                                                                                                                                                                                         | `packages/*`, `mcp/`, `.agents/specs/`                                                                             |
| **Phase 2 (Catalog)**         | Complete & verified (4 additional static templates, 2 carousel templates, multi-slide PNG export, multi-page PDF export, 9:16 safe-zone rules).                                                                                                                                                                                                                                                                          | `packages/*`, `.agents/specs/`                                                                                     |
| **Phase 3 (Video)**           | Complete & verified (WAAPI frame-stepper + declarative counters + FFmpeg H.264 `yuv420p` MP4 pipeline + 3 animated video templates).                                                                                                                                                                                                                                                                                     | `packages/*`, `.agents/specs/`                                                                                     |
| **Phase 4 (Website)**         | Complete & verified (`website/` storefront, template gallery, detail specs, interactive sandboxed playground/studio, and docs).                                                                                                                                                                                                                                                                                          | `website/`, `packages/templates`                                                                                   |
| **Phase 5 (Release)**         | Complete & verified (Streamable HTTP MCP + REST server, `template new`/`validate` CLI, `skills/tinytldr/SKILL.md`, `Dockerfile`, `server.json`).                                                                                                                                                                                                                                                                         | `mcp/`, `packages/cli`, `skills/`, `Dockerfile`                                                                    |
| **Artboard workspace**        | Independent per-page HTML/CSS/JSON, metadata, shared size, zoom/pan, ordered exports, and `render_workspace`. External files now require current projects; no old-format conversion. Fresh-install gate is tracked in the active Firebase specification.                                                                                                                                                                 | `website/`, `packages/core`, `packages/runtime`, `packages/renderer`, `mcp/`, `.agents/specs/ArtboardWorkspace.md` |
| **Compact header & versions** | 48px toolbar and private immutable paginated history. Current persistence is the trusted Firebase service, not an incremental database upgrade.                                                                                                                                                                                                                                                                          | `website/`, `packages/core`, [spec](../specs/CompactHeaderAndVersions.md)                                          |
| **Workspace chrome**          | Complete & verified (48px global footer with Welcome/Docs/GitHub and persisted Day/Night; default-hidden editors retaining source, undo, and split ratio; 14px title/sidebar toggle; labeled Save and Latest/Version actions; 144 tests / 20 suites and production desktop/mobile inspection). The owner-supplied GitHub link opens https://github.com/ajrahim/tinytldr in a separate tab. No dependency or SQL changes. | `website/`, [spec](../specs/WorkspaceChrome.md)                                                                    |
| **Website AI composer**       | Floating composer, stable-ID targets, transient context, guarded unsaved generation/Undo. Firebase credentials only; MCP/rendering remain deterministic. Live provider generation remains separately unverified.                                                                                                                                                                                                         | `website/`, `packages/core`, [spec](../specs/WebsiteAiComposer.md), [deployment](../docs/AiConnections.md)         |
| **Firebase AI gateway**       | Firebase tokens, encrypted Firestore/Secret Manager connections, transactional limits, and Auth cleanup/tombstones. Fresh-install changes need the current emulator gate; historical deployments do not prove changed code.                                                                                                                                                                                              | [spec](../specs/FirebaseAi.md), [setup](../docs/AiConnections.md)                                                  |
| **Simple Firebase AI**        | One connection, API-discovered models, remembered choice, replacement/disconnection. No multi-key upgrade controls. Current encryption format, owner checks, and deletion tombstones remain.                                                                                                                                                                                                                             | [spec](../specs/SimpleFirebaseAi.md), [setup](../docs/AiConnections.md)                                            |
