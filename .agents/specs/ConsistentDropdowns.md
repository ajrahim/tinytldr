# Consistent website dropdowns

Status: Shipped. Approved: use the Export menu as the site-wide visual baseline.

## Scope

Use the existing Export menu's visual language for all website dropdowns: a theme-aware surface, 1px border, 9px panel radius, shared shadow, 5px panel padding, and 11px rows with consistent spacing and hover/focus/disabled states.

- Shared [Dropdown](../../website/src/components/Dropdown.tsx) owns action-menu positioning, dismissal, and keyboard navigation. [DropdownSelect](../../website/src/components/DropdownSelect.tsx) owns typed single-value choices and selection indicators.
- Migrate context actions, provider/model, canvas size, carousel page, starter filters/previews, media filters, provider settings, MCP client, and enum slot fields.
- Versions and artboard mention suggestions retain their existing semantics and asynchronous behavior while using the shared [styles](../../website/src/styles/components/Dropdown.css).
- Keep existing options, actions, callbacks, disabled states, and design persistence unchanged. No new dependencies.

## Acceptance criteria

1. Action menus, selectors, Versions, and mentions have empirically identical shared panel and row styles in light/dark desktop/mobile views.
2. Selectors support arrows, Home/End, typeahead, Enter/Space selection, Escape/Tab dismissal, and focus restoration; disabled options cannot be selected.
3. Popovers remain inside the viewport, flip above a trigger when needed, scroll long lists, and work inside modal dialogs.
4. Existing authoring, AI connection, version, export, library, and recovery browser regressions pass after migrating their interactions.
5. `pnpm check` and `pnpm build` pass.

## Out of scope

Changing option content, product capabilities, generation/export logic, accordion disclosures, account flows, or other UI controls.

## Verification

- `pnpm check` passes: formatting, zero-warning ESLint, all workspace typechecks, 8 MIT workspace manifests and 180 permissive production dependencies, and 168 tests across 24 suites.
- `pnpm build` passes across all packages, MCP, and website. Vite still reports its large-chunk advisory; no dependency or bundling changes were made.
- Three [dropdown browser tests](../../website/test/DropdownBrowser.test.ts) verify exact shared style parity at 1440/390 widths in both themes, keyboard/typeahead/Enter/Space behavior, typed values, disabled controls, scrolling inside a 320x360 modal, resize/outside dismissal, enum slots, and all starter filter/preview selectors.
- Existing workspace, AI composer, artboard, header/version, and media-library browser regressions pass with shared dropdown interactions.
- The production provider and Export menus were also visually inspected in the integrated browser. No native `<select>` controls remain in website application source.
