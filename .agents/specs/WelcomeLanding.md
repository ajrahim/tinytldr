# Welcome landing modal

Status: Shipped

The later [welcome format carousel](WelcomeCarousel.md) extends this shipped
baseline's content/navigation while preserving its native modal and workspace behavior.

## Approved scope

Welcome uses a centered landing-style composition with the purpose "Templates
for your agents": original upright decorative post/carousel/motion cards, a large
headline and short copy explaining that the calling agent supplies the words.
Place the monochrome tinytldr. wordmark at top left and retain a compact, truthful
browser-draft/optional-claim note. Remove the form-like header/footer dividers.
The only footer action is a wider, centered "Start Creating" button without an
arrow; Connect an agent remains available in the workspace sidebar.
Gentle, staggered fade/vertical entrance motion must never rotate graphics and
must be disabled for reduced-motion preferences.
On very short screens, artwork yields to the headline and copy. Supplemental
content scrolls while the wordmark, dismissal and primary action remain reachable.

Only Welcome's presentation changes. Keep the shared native dialog, accessible
name, initial focus, close/Escape/Tab behavior, seen/reopen semantics, agent/docs
topic navigation and mounted design state. Other dialogs retain their existing styling.
No reference artwork is copied. No slideshow, extra onboarding steps, backend
changes, dependencies or unverified hosted-MCP claims.

## Owners and acceptance

[WorkspaceGuideDialog](../../website/src/components/WorkspaceGuideDialog.tsx)
and its [styles](../../website/src/styles/components/WorkspaceGuideDialog.css)
own the welcome-specific content and presentation. The shared Dialog remains
unchanged.

Native browser checks must verify centered artwork/content, headline hierarchy,
decorative accessibility, upright cards, motion/reduced-motion behavior, top-left
wordmark, the single centered arrow-free action, bounded Day/Night layouts
at desktop, 390px, 320px and short landscape, scrolling where needed, initial
focus, keyboard/topic navigation and retained source/preview state. Visually
inspect isolated native screenshots. Run focused regressions, real-emulator
`pnpm check` and all workspace builds before marking Shipped.

## Verification evidence

- `pnpm exec vitest run ConsistentDialogsBrowser`: **8 tests passed**. Native
  Chromium verifies the exact agent-template headline, three original decorative
  cards, no external media, the top-left 15.2px monochrome wordmark and one
  arrow-free Start Creating action, centered within 1px and at least 176px wide.
- Actual CSS animation sampling moves cards from 14px/opacity 0 to 0px/opacity 1
  without rotation. Card delays are 0/100/200ms; reduced motion produces zero
  animations and fully visible, untransformed cards.
- Day/Night geometry passes at 1440x900, 390x844, 320x568 and 640x360. Very short
  screens suppress decorative artwork so the complete headline remains visible.
  Supplemental content can scroll fully into view; dismissal/footer remain
  reachable. Initial focus, Tab wrapping, Escape, opener restoration, seen/reopen
  behavior, agent-to-docs navigation and mounted source/preview regressions pass.
- Five isolated native desktop/mobile/short-landscape screenshots were visually
  inspected; no shared browser profile or real account/provider actions were used.
- Final `pnpm check` under real Auth/Firestore demo emulators:
  **320 tests / 41 suites passed**, formatting, zero-warning ESLint, all workspace
  typechecks and licenses (**9 MIT manifests / 312 permissive dependencies**).
  `pnpm build` passed every workspace; existing Vite chunk notices remain.
- Both preserved local preview servers return HTTP 200. Task emulator/logs and
  screenshots were removed. No dependencies, backend deployment or hosted-MCP
  readiness claims were introduced.
