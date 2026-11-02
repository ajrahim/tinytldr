# Sidebar context menus and alignment

Status: Shipped

## Approved scope

- Design ellipsis actions use a distinct compact 140px context-menu appearance. Other action menus and selection dropdowns retain their existing appearance.
- Reuse the shared Dropdown keyboard, focus, dismissal and viewport positioning behavior. Shared menu styling remains owned by Dropdown.css.
- Keep the native thin scrollbar in the sidebar's outer padding rather than subtracting it from the shared design/card content width.
- Align design-row and section right edges with the bottom cards; align count text and ellipsis SVG right edges with the Connect an Agent arrow.
- New design is a filled black/white button with hover, pressed and keyboard-focus feedback. My Library remains navigation.

## Out of scope

No design-persistence, account, Firebase, rendering, agent-integration, dependency or unrelated layout changes. No backend deployment.

## Acceptance criteria

- Design context menus measure 140px, remain viewport-clamped on desktop/mobile, and have compact rows distinct from ordinary dropdowns.
- Counts, row ellipses and card content right edges agree within one CSS pixel with short and long lists, in Day/Night and desktop/mobile.
- Scrollbars stay outside the aligned row/card column; list scrolling leaves bottom cards anchored and does not cause horizontal overflow.
- Existing keyboard navigation, Escape/Tab/outside dismissal, tooltip behavior and design actions remain passing.
- New design has visible button styling and focus/pressed feedback and still opens a fresh draft without deleting existing recovery.
- `pnpm check` and `pnpm build` pass; inspect the updated native preview without changing user drafts.

## Verification

- Official Firebase CLI `emulators:exec --project demo-tinytldr --only auth,firestore --non-interactive` wrapping `pnpm exec vitest run website\firebase\test\WorkspaceBrowser.test.ts website\test\DropdownBrowser.test.ts website\test\MediaLibraryBrowser.test.ts website\test\PersonalWorkspaceBrowser.test.ts`: **44 tests / 4 suites passed**.
- The new native browser case measures **140px context menus**, unchanged **236px ordinary action menus**, and right-edge differences **<=1 CSS pixel** with 1/106 drafts at 1440/390/320px in Day/Night. It checks scrolling/anchored cards, horizontal bounds, focus, End/Escape/Tab/outside dismissal, exact button colors, hover/pressed feedback, and retention of all 106 drafts after New design creates the 107th.
- Real Auth/Firestore emulator `pnpm check`: **282 tests / 36 suites passed**, formatting passed, zero-warning ESLint and all workspace typechecks passed; **9 MIT manifests / 312 permissive production dependencies**.
- `pnpm build`: all workspaces passed, including the production website build.
- The current native preview returned **200**. Isolated Chromium screenshots at 1440/390px in Day/Night were visually inspected; no shared browser storage or existing user drafts were changed.
- Task emulators were stopped. No dependencies, backend changes, Firebase deployment, production Auth fixtures or real provider calls.
