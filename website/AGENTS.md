# tinytldr website

Follow the repository [AGENTS.md](../AGENTS.md) and the shared [agent documentation](../.agents/README.md). This file adds `website/`-specific constraints; do not duplicate the engineering contract here.

## Ownership and boundaries

- Keep `website/` TypeScript folders flat: `src/pages`, `src/components`, `src/hooks`, `src/state`, and `src/lib`. Do not add feature folders, nested UI folders, or a folder per component.
- Use PascalCase source, test, and fixture basenames (`PlaygroundPage.tsx`, `DocsPage.tsx`, `McpAuthorizationPage.tsx`). Keep one `useCamelCase` hook per file in `src/hooks`; follow the shared filename exceptions for framework entries, configs, data, and generated files.
- Pages compose components and hooks. Components may import hooks, state, and browser helpers, but never pages. Hooks may import state and helpers, never presentation. State may import helpers, never hooks or presentation. Keep `src/lib` independent of pages, components, hooks, and state.
- Import `@tinytldr/core`, `@tinytldr/runtime`, and `@tinytldr/templates` directly for in-browser compilation, validation, and sandboxed iframe preview. Never reimplement the template engine in `website/`, and never import Node-only modules (`@tinytldr/renderer`, Playwright, `fs`, or child processes).

## Styles

- `src/styles/index.css` is the single stylesheet entry. Keep it as an ordered import manifest: Tailwind, `global.css`, then `src/styles/components/<Component>.css` and `src/styles/pages/<Page>.css`.
- Add a stylesheet only when its owner has static rules to own; do not create empty companion files.
- Use [Dropdown](src/components/Dropdown.tsx) for action menus and [DropdownSelect](src/components/DropdownSelect.tsx) for single-value choices, not native `<select>` popups or locally styled menus. [Dropdown.css](src/styles/components/Dropdown.css) owns their shared panel, row, selection, focus, and disabled styles; owner styles should only set placement or layout.
