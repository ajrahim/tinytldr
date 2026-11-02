# Spec 004: Phase 4 — `tinytldr.com` Website & Interactive Playground (`website/`)

- **Phase:** 4
- **Status:** In Progress
- **Owners:** `packages/templates`, `website`
- **Note:** The `/templates` gallery and `/templates/:id` detail pages below were later superseded by the [single workspace](SingleWorkspace.md) and their unreachable source (`TemplatesPage`, `TemplateDetailPage`, `TemplateCard`, `SlotEditorPanel`, `useTemplateCatalog`, `usePlaygroundDesign`) was removed before the open-source release.

## 1. Objective

Deliver the `tinytldr.com` web application in `website/`, featuring:

1. **Browser-Safe Template Catalog (`@tinytldr/templates`):**
   - Generate a deterministic, browser-safe catalog module (`GeneratedTemplateCatalog.ts`) containing all 12 built-in template bundles (`manifest`, `liquidTemplate`, `stylesCss`, `defaultSample`) and browser `@font-face` rules so `@tinytldr/templates` works in both Node.js and browser bundles with zero Node `fs` imports in client builds.
2. **Pages (`website/src/pages/`):**
   - `HomePage.tsx` (`/`): Hero (_"Anything → a post. From Claude or Codex."_), interactive live browser demo, install snippets for Codex and Claude Code with copy buttons, feature overview, and MIT/GitHub header links.
   - `TemplatesPage.tsx` (`/templates`): Filterable gallery of all 12 templates by kind (`static`, `carousel`, `video`), size preset (`square`, `portrait`, `story`, `landscape`), tag, and search query, with live scaled previews at the selected size preset.
   - `TemplateDetailPage.tsx` (`/templates/:id`): Multi-size preview matrix, theme variant switcher, slot schema table (`name`, `type`, `required`, limits, `autofit`), sample JSON, "Use in Codex / Claude" snippet, author credit, and GitHub source link.
   - `PlaygroundPage.tsx` (`/playground` and `/studio`): Full interactive studio with template selector, size preset switcher + custom `W×H`, theme + `--tt-*` color token overrides, dynamic slot editor (supporting `string`, `number`, `boolean`, `enum`, `string[]`, and `object[]`), carousel slide strip, 30fps WAAPI animation scrubber, safe-zone overlay toggle, live runtime warnings badge, self-contained HTML download, MCP tool-call JSON copy, and optional `VITE_TINYTLDR_API_URL` export integration.
   - `DocsPage.tsx` (`/docs`, `/docs/self-host`, `/contribute`): Installation guide, 4-step agent workflow, schema-driven MCP tool reference, template authoring guide, Docker/Firebase hosting architecture, and community template contribution checklist.
3. **Architecture & Verification:**
   - Strictly follow `website/AGENTS.md` flat directory layout (`src/pages`, `src/components`, `src/hooks`, `src/state`, `src/lib`) and `src/styles/index.css` import manifest.
   - Verify that every built-in template renders cleanly in the browser playground across size presets with zero console errors and passes `pnpm check`.
