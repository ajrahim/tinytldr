# Designs sidebar sections

Status: Shipped

> Partly superseded by [Sidebar folders, search and Local](./SidebarFolders.md):
> "This browser" is now **Local**, and the sidebar adds search, collapsible groups
> and account folders.

## Approved scope

Improve the Designs sidebar's section hierarchy, not its data behavior.
Account and This browser use concise headings, truthful counts and a subtle
divider. Empty groups show "No designs yet". Ownership and browser-history
explanations move to info tooltips available with hover, keyboard focus or tap.
(Superseded: [Sidebar folders](./SidebarFolders.md) removed these tooltips.)
Rows and the list scrollbar become more compact; bottom actions stay anchored.

## Invariants and exclusions

Account designs retain their existing ownership/claim semantics. Browser history
still includes visited saved designs as well as local drafts. Do not deduplicate,
reorder, rename, move or delete designs. Guest account-section visibility,
navigation, active rows, saving, My Library, authentication and backend APIs stay
unchanged. No collapsible groups, search, telemetry or new dependencies.

## Acceptance evidence

- Real Auth/Firestore emulator `pnpm check` passed **268 tests / 36 suites**,
  formatting, zero-warning ESLint, workspace type checks and **9 MIT / 312
  permissive production dependencies**. `pnpm build` passed across all workspaces.
- Browser assertions cover semantic sections, truthful counts, a 20px compact
  empty state, 9px row padding, hoverable help, keyboard focus/Tab/Escape,
  viewport bounds and painted top-layer content in Day/Night.
- Real touch tests prove first-tap opening, second-tap/outside/Escape dismissal,
  drawer preservation and resize cleanup at constrained mobile sizes.
- The existing 60-design long-list test now also checks count accuracy and tooltip
  dismissal on scrolling; account/agent cards retain their positions.
- A live sidebar screenshot and tooltip inspection confirmed the local preview.
  Backend behavior and dependencies are unchanged; no deployment was needed.
  Task emulators were stopped. Existing build/dependency notices remain.
