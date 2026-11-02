# Workspace action button refinement

Status: Shipped

## Approved scope

- New design uses a compact, content-width, 32px-tall black/white button rather than a full-width centered button.
- Its plus and label align with My Library's icon and label. Retain hover, pressed and visible keyboard-focus feedback.
- Header Claim uses a circled check to the right of its label and a visible theme-aware border. Keep it immediately left of Save.
- Preserve the existing icon-only Claim layout on very narrow screens and its accessible name.

## Out of scope

No claim/save/navigation changes, other button or dropdown redesigns, account changes, dependencies, backend changes or deployment. Existing context-menu width and scrollbar/card alignment remain unchanged.

## Acceptance criteria

- New design measures 32px tall, is narrower than the sidebar cards, and its icon/label left edges align with My Library within one CSS pixel.
- Claim has a visible 1px border, a circle/check icon after the label, and fits the header at 320px. Label remains visible on desktop and icon-only on very narrow screens.
- Desktop/mobile Day/Night, keyboard focus, button feedback, Claim visibility/actions and New design recovery retention pass browser checks.
- `pnpm check` and `pnpm build` pass; visually inspect isolated native previews without changing shared browser data.

## Verification

- Official Firebase CLI `emulators:exec --project demo-tinytldr --only auth,firestore --non-interactive` wrapping `pnpm exec vitest run website\firebase\test\WorkspaceBrowser.test.ts website\test\PersonalWorkspaceBrowser.test.ts`: **34 tests / 2 suites passed**.
- Native browser assertions measure **32px height**, content width **<=120px**, and plus/label alignment with My Library **<=1 CSS pixel** at 1440/390/320px in Day/Night, with 1/106 drafts. Claim's label-before-SVG order, circle/check geometry, hidden decorative icon, contrasting 1px border, equal height to Save, narrow-screen label hiding and non-overflowing header passed.
- Existing context-menu widths, list/card alignment, scrolling, keyboard focus/dismissal, hover/pressed feedback, actual Claim actions and New design retaining all 106 previous drafts passed.
- Real Auth/Firestore emulator `pnpm check`: **282 tests / 36 suites passed**, formatting, zero-warning lint, all workspace typechecks and license audit passed (**9 MIT manifests / 312 permissive production dependencies**).
- `pnpm build`: all workspaces and the production website passed.
- The current native preview returned **200**. Isolated 1440/390px Day/Night screenshots were visually inspected, including the mobile Claim header. New design measured **111.61 x 32px**. Shared browser data was untouched.
- Task emulators and exact temporary screenshots were removed. No backend deployment, dependencies, production Auth fixtures or real provider calls.

Implementation is owned by [sidebar styling](../../website/src/styles/components/DesignSidebar.css),
[header markup](../../website/src/pages/PlaygroundPage.tsx) and
[header styling](../../website/src/styles/components/SiteHeader.css), with
[native browser assertions](../../website/firebase/test/WorkspaceBrowser.test.ts).
