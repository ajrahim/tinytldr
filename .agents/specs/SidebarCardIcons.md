# Sidebar card icons

Status: Shipped

## Approved scope

Replace Connect an Agent's arrow with Lucide Sparkles. Add Lucide UserRound to
the right of the Account/sign-in title, aligned with the sparkle. Both icons are
14px and decorative; retain card styling, subtitle and existing click actions.

No agent/account behavior changes, new dependencies or backend deployment.

## Acceptance criteria

- Right icon edges align within 1px at 1440/390/320px in Day/Night.
- Icons are 14px and hidden from assistive technology; accessible button names
  and existing agent/account dialogs remain unchanged.
- Account subtitle remains below its title, spanning the card's content width.
- Required check/build gates pass.

## Evidence

Real-emulator focused sidebar browser case passed: right edges within 1px,
14px icons with `aria-hidden`, and full-width subtitle below the icon/title row
at 1440/390/320px in Day/Night with short/long lists. Real-emulator `pnpm check`
passed **284 tests / 36 suites**, formatting, zero-warning lint, workspace types
and licenses (**9 MIT / 312 permissive dependencies**). `pnpm build` passed for
all workspaces; existing account/agent dialogs and guest behavior passed.
No deployment, dependencies or provider calls; task emulators removed.
