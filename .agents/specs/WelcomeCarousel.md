# Welcome carousel

Status: Shipped

## Approved scope

Extend the [shipped welcome landing](WelcomeLanding.md) with a manually selected
three-slide introduction: "Templates built for agents.", "Made to be consistent"
and "Bring your own key". Each slide has original upright artwork and concise
copy. BYOK describes existing optional website AI drafting; templates need no key.
Previous/next controls wrap and sit at the modal's left/right edges, vertically
centered on the whole modal, not the slideshow body. Reserve content gutters.
The approved cleanup removes the Templates/Consistency/Your key selector row.
The modal-edge arrows are the only slide navigation; no empty row remains above
the CTA.
Do not autoplay, select actual workspace templates or change provider behavior.

Each slide has its own upright illustration that shows the topic: Templates
shows an agent's words flowing through a template into a finished post;
Consistency shows three matching pages above a shared-style strip; BYOK shows an
"Optional" AI-drafting key panel next to a "No key needed." template card. All
pieces stay inside the artwork, centered within 1px, unclipped and unrotated, in
Day/Night at every required size. Keep gentle staggered entrance motion with
reduced-motion support. Place a compact, truthful
browser-draft/account note directly below the centered, arrow-free Start Creating
button. Preserve the top-left monochrome wordmark and native modal lifecycle,
initial focus, seen/reopen semantics, agent/docs navigation and mounted drafts.

Only [WorkspaceGuideDialog](../../website/src/components/WorkspaceGuideDialog.tsx)
and its [owner styles](../../website/src/styles/components/WorkspaceGuideDialog.css)
own this presentation. Shared Dialog, backend/MCP, authentication, exports and
template selection remain unchanged. No dependencies, external artwork,
automatic navigation, new onboarding steps or unverified hosted claims.

## Required evidence

Native tests must cover all three slides, absence of topic buttons, previous/next
wrapping, keyboard navigation and retained focus, no autoplay, accessible slide
labels/live copy and single visible slide. Verify the note below the CTA,
slide-specific artwork pieces inside the artwork, centered within 1px, unclipped
and unrotated, modal-centered edge arrows within 1px,
non-overlapping content gutters, motion/reduced motion, visible dismissal and
CTA, bounded Day/Night layouts at 1440x900, 390x844, 320x568 and 640x360, scrolling
content while arrows stay fixed, and preserved drafts/preview and seen/reopen.
Inspect isolated native screenshots; run focused regressions, real-emulator
`pnpm check` and all workspace builds. Record evidence before marking Shipped.

## Original format-carousel evidence

- `pnpm exec vitest run ConsistentDialogsBrowser`: **9 tests passed**. All three
  formats have distinct original artwork/copy, one visible slide, correct pressed
  selection, accessible slide labels and polite live copy. Every previous/next
  transition and wrapping pass; Enter/Space retain focus. Advancing the browser
  clock by 60 seconds does not advance the carousel. Reopening resets to Posts.
- Native Day/Night checks cover all three slides at 1440x900, 390x844, 320x568 and
  640x360. Cards share a vertical center within 1px; the front card projects no
  more than 4px above its nearest neighbor. Cards remain unrotated. Actual motion
  samples verify opacity 0 to 1 and vertical translation 14px to 0; reduced
  motion produces zero animations.
- All format controls remain visible above the CTA. The complete account/draft
  note is below the button and inside the dialog. At 640x360, compact 24px titles
  and full subtitles fit without requiring scrolling. Other constrained layouts
  retain scroll access. Existing focus trapping, Escape/close/opener restoration,
  seen/reopen, agent/docs navigation and mounted draft/preview regressions pass.
- Six isolated native screenshots were visually inspected. A fresh isolated
  live-preview check also passes forward/back navigation. Neither shared browser
  storage nor real account/provider actions were used.
- `pnpm --filter @tinytldr/website typecheck` passes with typed slide-object state,
  without an unchecked lookup, cast or silent fallback. Final real Auth/Firestore
  emulator `pnpm check`: **321 tests / 41 suites passed**, formatting, zero-warning
  lint, all typechecks and licenses (**9 MIT / 312 permissive dependencies**).
  `pnpm build` passes every workspace; existing Vite chunk notices remain.
- Both preserved preview servers return HTTP 200. Exact task emulator, logs and
  screenshots were removed. No dependencies, backend deployment or hosted-MCP
  changes in this phase.

## Topic and edge-navigation revision evidence

- `pnpm --filter @tinytldr/website typecheck` and
  `pnpm exec vitest run ConsistentDialogsBrowser` pass: **10 native tests**.
  All three titles/subtitles match the approved topics. BYOK explicitly describes
  optional AI drafting and says templates work without a key; provider behavior
  is unchanged.
- Every topic at 1440x900, 390x844, 320x568 and 640x360 in Day/Night measures both
  arrow centers within 1px of the whole modal center, with 13px edge insets.
  Body/footer content reserves clear gutters; no slide, selector, CTA or note
  overlaps either arrow. Compact selectors remain single-line and <=33px high.
- A 320x360 portrait regression scrolls real overflowing slide content: both
  arrow positions remain identical before/after scrolling and navigation works.
  Existing typed state, all wrapping transitions, 60-second no-autoplay, focus/
  keyboard/reopen, live copy, original balanced unrotated artwork, reduced motion,
  CTA/note ordering and mounted draft/preview checks pass.
- Six isolated native desktop/mobile/short-landscape screenshots were visually
  inspected. Shared browser data and real provider/account actions were untouched.
- Final real Auth/Firestore emulator `pnpm check`:
  **322 tests / 41 suites passed**, formatting, zero-warning lint, all typechecks
  and licenses (**9 MIT manifests / 312 permissive dependencies**).
  `pnpm build` passed all workspaces; existing Vite chunk notices remain.
- Both preserved preview servers return HTTP 200. Exact task screenshots, logs,
  temporary output and emulator were removed. No dependencies, backend deployment
  or hosted-MCP changes.

## Arrow-only cleanup evidence

The approved cleanup removes the topic selector markup and unused styles.
The arrow wrapper uses `display: contents`, so it leaves no empty footer row.
Slide copy, artwork, initial CTA focus and the account note are unchanged.

- `pnpm exec vitest run ConsistentDialogsBrowser`: **10 tests passed**.
  All topics at the four required viewports in Day/Night explicitly assert the
  topic buttons/group are absent. Arrow navigation, every wrapping transition,
  keyboard focus, no autoplay, accessible slide labels/live copy, 1px modal
  centering, clear gutters, short-portrait scrolling and preserved drafts pass.
- Desktop and 390px mobile live-preview screenshots were visually inspected;
  navigating to Consistency/BYOK works with no topic buttons.
- Real Auth/Firestore emulator `pnpm check`: **322 tests / 41 suites passed**,
  formatting, zero-warning lint, all typechecks and licenses
  (**9 MIT manifests / 312 permissive dependencies**). `pnpm build` passes all
  workspaces; existing Vite chunk notices remain.
- Both preserved previews return HTTP 200. Exact task emulator, log and temporary
  check output removed. No dependencies, provider calls or deployment.

## Slide-specific artwork evidence

The approved revision replaces the shared three-card art with an inline
`WelcomeArtwork` per slide (decorative, `aria-hidden`, Lucide icons only, no
images). Pieces use container-query sizing on an inner stage grid and a 80ms
stagger; reduced motion removes all animation.

- `pnpm --filter @tinytldr/website typecheck` passes.
- `pnpm exec vitest run ConsistentDialogsBrowser`: **10 tests passed**. Templates
  asserts agent/template/post plus two arrows, five staggered delays
  (0s-0.32s), 14px rise and no rotation, and reduced motion. Each slide at the
  four viewports in Day/Night asserts its piece count and text, all pieces inside
  the artwork, a 1px union center, no clipped card/strip/key value and no rotation.
- An isolated browser measured every slide at 1440, 390 and 320px in Day/Night:
  all pieces inside, center offset 0, nothing clipped. Screenshots inspected.
- Real Auth/Firestore emulator `pnpm check`: **322 tests / 41 suites passed**
  with all format/lint/type/license gates (**9 MIT manifests / 312 permissive
  dependencies**). `pnpm build` passes all workspaces.
- Both preserved previews return HTTP 200. Exact task emulator, log and temporary
  output removed. No dependencies, provider calls or deployment.
