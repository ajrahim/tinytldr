# tinytldr: build brief

You are building **tinytldr**: an open-source (MIT) MCP server, rendering engine, and website (tinytldr.com) that turn anything (notes, an article, a changelog, a thread) into polished social posts from templates. The calling agent (Codex, Claude Code) is the only "brain". tinytldr is a deterministic toolbox: templates, schemas, validation, preview, export. The website is the storefront, gallery, docs, and playground, deployed on Codex Sites.

Before writing code:

1. Save this brief verbatim to docs/PLAN.md.
2. Create AGENTS.md from "Engineering rules".
3. Ask me for the copyright holder (for LICENSE) and the GitHub org name.
4. Propose a short Phase 0 plan and STOP for my approval.

After that, work one phase at a time. End each phase by reporting evidence (commands run + output) and stop.

## Product

- Input: whatever I give the agent. The agent distills it into a tl;dr (hook, 1–5 points, CTA) and fills a template.
- Sizes: presets + custom. One template adapts to every size it declares.
- Liberty dial per design:
  - `strict`: fill slots only.
  - `tweak` (default): also tokens, variants, show/hide optional elements, allowlisted scoped CSS.
  - `freeform`: page-level custom HTML/CSS, sandboxed; can be saved as a new template.
- Multi-page designs (carousels, up to 20 pages).
- Exports: png, jpg, webp, pdf (multi-page, exact pixel page size), mp4, webm, gif (pages animate and play in sequence with transitions), html (single self-contained file, fonts/images inlined), zip (html/css/assets + design.json that re-imports).
- Everything is reachable through MCP. Preview and export produce the same pixels.
- Building templates with the agent is first-class: create, fork, validate, preview across sizes, save.
- Local-first: the full experience works with no account and no hosted service. The local stdio MCP + CLI is the primary product; the hosted service is optional and self-hostable.

## Architecture

pnpm monorepo, Node 22+, TypeScript strict, ESM. Must work on Windows 11 (my machine), macOS, and Linux.

- packages/core: zod schemas (Design, Page, TemplateManifest, Size, Brand, EditOp), size presets, LiquidJS template compilation (no template-supplied JavaScript), token → CSS custom property resolution, pure design-op functions, validation. Runs in Node AND the browser.
- packages/runtime: small script injected into every rendered page. It waits for fonts/images, auto-fits text per slot (binary-search font-size between min/max), detects overflow/clipping/safe-zone violations, and exposes `window.__tinytldr = { ready, warnings, durationMs, seek(ms) }`.
- packages/templates: built-in templates, one folder each.
- packages/renderer: Playwright Chromium. Images via screenshot at deviceScaleFactor = scale. PDF via page.pdf with exact px width/height + printBackground. Video behind a `VideoEncoder` interface (engine chosen in Phase 0). ffmpeg: run the system binary as a separate process (never link it); ffmpeg-static only as an optionalDependency. All network blocked during render except a local asset handler.
- packages/mcp: @modelcontextprotocol/sdk server. stdio first (writes files to an output dir). Streamable HTTP in Phase 5 using the same handlers.
- packages/cli: the `tinytldr` bin:
  - `tinytldr mcp`: stdio server.
  - `tinytldr render design.json --format png,pdf`
  - `tinytldr doctor`: checks Chromium (installs on first run), ffmpeg (explains how to install), fonts, output dir.
  - `tinytldr template new|validate|preview`
- apps/site: tinytldr.com, React + Tailwind, deployed on Codex Sites. It imports packages/core, packages/runtime, and packages/templates for in-browser live preview. It never reimplements the template engine and never renders images server-side.
- apps/server (Phase 5): the hosted Streamable HTTP MCP + REST API in a Docker container. Codex Sites can't run Chromium/ffmpeg, so rendering for the website lives here.

## Data model (rename freely, keep the shape)

- Design { id, size: {preset} | {width,height}, scale, brandId?, mode, theme (token overrides), pages: Page[] }
- Page { template: "id@version", variant?, slots, overrides?: {tokens?, css?}, motion?: {preset, durationMs, transition?} }
- TemplateManifest { id, version, name, description, author, license (default MIT), tags, sizes: ["any"] | presetIds, role (cover|body|end|any), slots: { name: { type: text|richtext|list|image|logo|code|number|color, required, maxChars, minItems/maxItems, fit: {minPx,maxPx}, source?: "brand.handle" } }, variants, tokens (defaults), motion presets, sample (content used for tests + thumbnails) }
- Template folder: manifest.json, template.liquid.html, style.css, README.md. Theming only through --tt-* custom properties. Responsive via container query units (cqw/cqh/cqmin) and @container aspect-ratio rules; optional per-size overrides.
- Brand { name, handle, colors, fonts (bundled or uploaded), logo }.
- Local storage: ~/.tinytldr/{templates,brands,designs,assets}, plus project-local ./.tinytldr/ which wins. Default output dir: ./tinytldr-out/.
- Bundled fonts: OFL-licensed only (e.g. via @fontsource), each with its license file. No Google Fonts calls at render time.

## Sizes (ids are stable API)

square 1080x1080 · portrait 1080x1350 · grid-3x4 1080x1440 · story 1080x1920 (default safe zones top 250px / bottom 340px, configurable) · hd 1920x1080 · x 1600x900 · linkedin 1200x627 · og 1200x630 · youtube-thumb 1280x720 · pinterest 1000x1500 · custom WxH (64–4096 per side). H.264 needs even dimensions: warn and pad.

## MCP surface (small, stable names)

Write tool descriptions for agents: when to use the tool, its limits, and an example.

Tools:

- list_sizes
- list_templates {query?, tags?, size?} → id, name, one-line description, slot summary
- get_template {id} → full manifest incl. slot limits, variants, sample
- create_design {template, size, pages:[{slots, variant?}], mode?, brand?} → design id + preview + warnings
- edit_design {id, ops:[set_slot | set_tokens | set_variant | set_css | set_motion | set_size | add_page | duplicate_page | remove_page | move_page]} → preview + warnings
- preview {id, pages?, scale?, atMs?} → MCP image content (single page ≤ 768px long side; multi-page as one contact sheet)
- export {id, formats[], pages?, scale?, fps?, quality?} → file paths (stdio) or signed URLs (HTTP). Images/PDF are synchronous; video returns a job and emits progress notifications.
- get_job {id}
- save_template {fromDesign + page | {manifest, html, css}, forkOf?} → validation report + preview grid across sizes
- validate_template {id | inline}
- add_asset {path | url | base64} → asset id (images, fonts, logos)
- get_brand / set_brand

Resources: tinytldr://guide/workflow, tinytldr://guide/template-authoring, tinytldr://templates/{id}, tinytldr://designs/{id}

Prompts: make_post, make_carousel, make_video, new_template

Every mutating tool returns a small preview image, structured warnings, and a suggested next step. Errors are actionable, e.g. "slot `title` is 112 chars; max 70 at size story".

## Built-in templates (Phase 1, 9 folders)

- tldr-card (signature: title + 3 bullets + handle)
- big-quote
- big-stat (count-up motion)
- listicle
- announcement (changelog)
- code-snippet (Shiki highlighting at compile time)
- comparison (before/after)
- carousel-cover
- carousel-end (CTA)

Each has light + dark variants and passes validation at every preset. Sample and thumbnail images are generated or CC0, with the source recorded.

## Validation (used by tests, save_template, CI for community templates, and every preview)

- Renders cleanly at every declared size with sample content AND max-length content.
- No overflow or clipping.
- Text contrast ≥ WCAG AA.
- Zero external network requests.
- No scripts in template HTML.
- Story safe zones respected.
- Required slots bound; unused slots flagged.

## Website (apps/site → tinytldr.com on Codex Sites)

- / : hero "Anything → a post. From Claude or Codex." A live demo: paste text, pick a template + size, see it render instantly in the browser. Install snippets for Codex and Claude Code with copy buttons. GitHub link and MIT badge in the header.
- /templates : gallery filterable by size and tag, with thumbnails at the selected size.
- /templates/[id] : previews at every supported size, slot table (name, type, limits), variants, sample JSON, a "use in Codex/Claude" snippet, the author credit, and a link to the template's source folder on GitHub.
- /playground : slot form, size switcher (presets + custom W×H), variant + color tokens, page strip for multi-page, live preview in a sandboxed iframe. Export buttons call apps/server when TINYTLDR_API_URL is set; otherwise show "export via MCP" plus the equivalent design.json to copy.
- /docs : install (Codex config.toml + `codex mcp add`, `claude mcp add`), the agent workflow, the tool reference generated from the zod schemas, the template authoring guide, size presets, export formats.
- /docs/self-host : run apps/server yourself (Docker image from GHCR, env vars, storage, auth).
- /contribute : how to submit a template (scaffold command, local validate command, what CI checks, PR checklist).
- Design: clean, typographic, fast; light + dark; mobile-first. The templates are the hero, not the chrome. Generate the site's own OG images with tinytldr.
- No tracking beyond privacy-friendly, cookieless analytics (ask me first).
- Accounts (magic link), saved designs, and brand kits on the site come after the hosted API exists; not in this brief.

## Licensing (MIT)

- The repo, every package, the site, and the built-in templates are MIT. LICENSE at the root; "license": "MIT" in every package.json.
- Runtime dependencies must be permissive: MIT, ISC, BSD, Apache-2.0 (OFL for fonts).
- Not allowed: GPL/LGPL/AGPL as linked dependencies, SSPL, BUSL, or source-available/no-charge proprietary licenses. That means no Remotion and no GSAP.
- CI fails on a disallowed license anywhere in the production dependency tree and generates THIRD_PARTY_NOTICES.md.
- ffmpeg is GPL when built with libx264: only ever invoke it as a separate process. The Docker image documents ffmpeg's license and where its source comes from.
- Exported html/zip contains template code. Keeping templates MIT means users can use their exports anywhere.

## Engineering rules (→ AGENTS.md)

- No LLM calls inside tinytldr. The calling agent writes the copy.
- zod schemas are the single source of truth; MCP input schemas and docs are generated from them.
- One renderer (Chromium) for every export format; preview and export share the code path. The website's live preview uses the same core + runtime in the browser.
- Motion uses CSS keyframes / the Web Animations API, so every frame can be seeked deterministically.
- Agent-supplied HTML/CSS is untrusted: sanitize, no JS, no remote URLs except registered assets, render with network blocked and time/memory limits.
- Tool results stay small: never inline full-resolution exports; return paths/URLs.
- Tests:
  - Golden images with a pixel-diff threshold for every template × preset. They run only in a pinned Linux container, because font rendering differs across operating systems.
  - ffprobe assertions for video: duration, fps, dimensions, h264/yuv420p, faststart.
  - PDF page count and page size assertions.
  - An MCP integration test driving create → edit → preview → export over stdio with the SDK client.
- `pnpm check` = typecheck + lint + license check + tests, and it must pass at the end of every phase.
- Only permissive licenses (see Licensing). Keep dependencies few; ask before adding anything heavy.
- No telemetry. No secrets in the repo; hosted config comes from env vars.

## Repo and community

- Hygiene: README (what it is, install steps for Codex and Claude Code, demo GIF later), CONTRIBUTING.md, CODE_OF_CONDUCT.md (Contributor Covenant), SECURITY.md (tinytldr renders untrusted HTML/CSS: explain the sandbox and how to report issues privately), issue and PR templates.
- CI (GitHub Actions): `pnpm check` on ubuntu, windows, and macos; golden-image diffs in the pinned Linux container only.
- Releases: Changesets; npm publish from CI with provenance. Packages: `tinytldr` (CLI + MCP bin) and `@tinytldr/{core,runtime,templates,renderer,mcp}`.
- Community templates:
  - Anyone can contribute a template by PR: one folder under templates/. CI runs validate_template at every declared size plus golden images, and a failure blocks the merge.
  - CI generates the thumbnails; nobody commits them by hand.
  - `tinytldr template new` scaffolds a folder ready to contribute; `tinytldr template validate` runs exactly what CI runs.
  - Users can install templates from any git URL or local folder into ~/.tinytldr/templates without going through the repo. This is safe because templates are HTML/CSS only and render sandboxed.
- Distribution: the official MCP Registry (server.json), npm, a Docker image on GHCR, and tinytldr.com.

## Phases (stop after each with evidence)

0. **Spike + skeleton:**
   - Monorepo, `pnpm check`, LICENSE, repo hygiene files, CI matrix, license check.
   - Check the names `tinytldr` and `@tinytldr` on npm and as a GitHub org.
   - Codex Sites check: report what it supports today (server-side code, storage, npm packages, deploying from a monorepo subfolder, custom domains, GitHub sync) and how apps/site will deploy. If it can't deploy from apps/site directly, keep apps/site as the source of truth and document the deploy step.
   - Render one HTML file to a 1080x1080 PNG and a PDF on Windows.
   - Render a 5 s CSS/WAAPI animation to MP4 two ways:
     - (a) HeyGen HyperFrames (Apache-2.0; confirm it can be called as a Node library, how its timeline convention works, and that it doesn't require GSAP).
     - (b) Our own pipeline: pause document.getAnimations(), set currentTime per frame, screenshot, pipe to ffmpeg.
   - Compare determinism, speed, and Windows support; record the choice in docs/decisions/0001-video-engine.md.
1. **Static posts (MVP):** core, runtime, renderer (png/jpg/webp/pdf), the 9 templates, stdio MCP (list/get/create/edit/preview/export), CLI + doctor. Done when the integration test passes and, after `codex mcp add tinytldr -- node <repo>/packages/cli/dist/index.js mcp`, a single Codex prompt turns a pasted paragraph into a 1080x1080 PNG.
2. **Pages + motion + code export:** carousels, contact-sheet preview, multi-page PDF, motion presets (fade, rise, stagger, typewriter, count-up, wipe) + page transitions, mp4/webm/gif, html + zip export with re-import. Done when ffprobe/PDF tests pass for a 5-page portrait carousel.
3. **Template authoring + brands + packaging:**
   - save/fork/validate templates, the authoring guide resource, brand kits, user/project template dirs.
   - The community template flow (scaffold, validate, CI gate, generated thumbnails).
   - Publish `npx -y tinytldr mcp` via Changesets with provenance; publish to the MCP Registry.
   - An Agent Skill at skills/tinytldr/SKILL.md (distill → pick template → create → inspect preview → fix warnings, max 3 rounds → export) that works in both Codex and Claude Code.
   - A Claude Code plugin; README install steps for both tools.
4. **Website:** apps/site with every page in "Website", deployed to Codex Sites at tinytldr.com. Done when:
   - Lighthouse ≥ 90 on mobile for / and /templates.
   - The playground renders every built-in template at every preset with no console errors.
   - tinytldr.com serves the site.
5. **Hosted + self-host:**
   - apps/server: a Dockerfile (Chromium + ffmpeg + OFL fonts, ffmpeg license documented) published to GHCR.
   - Streamable HTTP MCP at /mcp, plus a REST mirror at /v1 (templates, designs, render, jobs).
   - API-key bearer auth (OAuth 2.1 later), S3-compatible storage with signed URLs, a job queue for video, rate limits.
   - docs/self-host.md. Wire the site's export buttons to it via TINYTLDR_API_URL.
6. **Later, do not build now:** site accounts, saved designs and brand kits; MCP Apps inline preview/editor (ui:// resource) in Claude/ChatGPT; OAuth; posting to social networks.

Out of scope: an LLM inside the server, social posting, billing, real-time collaboration, telemetry.

## Approved follow-up: account settings

The [standard account settings phase](../specs/AccountSettings.md) is shipped:
persisted optional display name, actual read-only email/verification, shared
Day/Night appearance, honest AI availability, and a compact accessible dialog with
separate sign-out. No email-change or account/data-deletion flows were added.

Evidence: real Auth/Firestore emulators running `pnpm check` passed **205 tests
across 31 suites**, formatting, lint, type checks, and the license audit (**9 MIT
manifests / 312 permissive production dependencies**). `pnpm build` passed all
workspaces; the existing Vite chunk-size warning remains. Browser assertions cover
both backends, name persistence/retry, provider states, retained source/iframe,
Day/Night mobile and short-screen bounds, focus, and stale-result account races.

## Approved follow-up: consistent dialogs

The [consistent dialogs phase](../specs/ConsistentDialogs.md) is shipped. Account/
sign-in, Welcome/agent setup/documentation, provider connections, and media previews
use one compact native shell, matching title/subtitle and close controls, fixed
header/footer, internally scrolling bodies, and existing black/white primary
buttons. Documentation grids and snippet headers fit narrow screens without
hiding body overflow. Feature workflows, drawers, and anchored popovers remain
unchanged; no backend or product features were added.

Evidence: official Firebase CLI Auth/Firestore `emulators:exec` running `pnpm check`
passed **212 tests across 32 suites**, formatting, lint, type checks, and the license
audit (**9 MIT manifests / 312 permissive production dependencies**). `pnpm build`
passed every workspace; existing Vite empty-auth and chunk-size notices remain.
Browser assertions cover both themes, mobile/short bounds, every documentation
section, media downloads, form actions, focus/Escape, and retained source/iframe.
Mobile Day/Night visuals and live desktop sign-in were inspected; the capture run
passed **14 tests / 2 suites**, and temporary captures/code were removed.

## Approved follow-up: Firebase login

The [Firebase login phase](../specs/FirebaseLogin.md) is shipped: email/password,
Google popup sign-in, signup/verification email, password recovery, and the shared
modal presentation. The later fresh-install scope removes email-link callbacks.
Password recovery preserves account/design ownership; no password-change settings
were added.

Evidence: official Auth/Firestore emulator `pnpm check` passed **230 tests across
33 suites**, formatting, lint, TypeScript, and **9 MIT manifests / 312 permissive
production dependencies**. `pnpm build` passed every workspace; existing Vite
notices remain. Real browser flows cover signup, verification/reset actions,
session restoration, Google popup/cancellation, pending controls, keyboard/mobile
behavior, retained designs, and profile races. Day/Night visuals were inspected.

Live Firebase providers/authorized hosts and password policy (schema 1, minimum 6)
were verified; the owner confirmed Google login works. Their actual browser at
localhost:5173 exposed an existing bodyless-preflight crash and missing API origin.
Four new adapter tests cover the fix. After Firebase MCP deployment, live
preflights returned **204** for all four approved local origins; unapproved origins
still return **403**, and unauthenticated listing returns **401 with CORS**.
COOP headers were not weakened. Live password signup/inbox delivery remains
unverified. Temporary captures/code and task-owned emulators were cleaned up.

## Approved follow-up: Firebase AI gateway

The [Firebase AI phase](../specs/FirebaseAi.md) is shipped. The optional composer
and provider/account settings use the Firebase-authenticated AI endpoint, with
shared provider logic and encrypted owner-scoped Firestore credentials protected
by Secret Manager. Transactions preserve defaults, caps, and rate limits; backend
Auth cleanup removes live secrets and keeps a tombstone against late restoration.
The later fresh-install scope uses only Firebase and adds approved Hosting/API configuration.

Evidence: real Auth/Firestore emulator `pnpm check` passed **248 tests / 35
suites**, all formatting/lint/type gates, and **9 MIT / 312 permissive production
dependencies**; all workspace builds and the actual Deno 2.9.6 graph passed.
Browser coverage includes native sessions, connection persistence, masked keys,
generation/undo, Day/Night bounds, and existing cancellation/target/image behavior.

MCP stopped at the retry-policy confirmation; official CLI deployment with
explicit acknowledgement succeeded. All three functions are ACTIVE and the AI
secret is bound to verified version 1. Live CORS passed for four local origins,
denied/unsigned requests still return 403/401, and authenticated owner listing
returned 200. Direct Firestore access was denied; real Auth deletion rejected the
old token and produced its cleanup tombstone. The temporary account/document were
removed. Directory-based hooks were verified through the actual SDK runner after
its Windows scoped-filter no-op. Both local websites load the persistent AI URL.

No paid provider calls were made; live model/image generation is explicitly
unverified and requires an owner-entered API key. Existing build/npm notices
remain; no unrelated dependency/security-header changes were made.

## Approved follow-up: simple Firebase AI connection

The [single-connection phase](../specs/SimpleFirebaseAi.md) is shipped.
Firebase setup is provider/key only, with API model discovery instead of a
generation test, persisted model selection, Replace key and Disconnect.
Transactions enforce one connection. The later fresh-install scope removes
multi-key upgrade controls; current ciphertext/AAD and account tombstones remain.

Evidence: real Auth/Firestore emulator `pnpm check` passed **266 tests / 36
suites**, zero-warning ESLint, formatting/type checks and **9 MIT / 312
permissive production dependencies**. `pnpm build` and the actual Deno 2.9.6 graph
passed. Tests cover all provider model-list protocols, pagination/error bounds,
single-connection races, model/AAD changes and stale
catalogs. Native browser checks cover absent name/manual-model fields, connect
without generation, remembered choices, expired-key errors, replacement,
disconnection, late-generation cancellation and
desktop/mobile Day/Night bounds.

Firebase MCP deployment job `1793497586758` succeeded; all three functions are
ACTIVE and encryption secret version 1 is retained. Live four-origin preflight
passed 204, denied/unsigned calls 403/401, signed listing 200, new model action 404
for an absent connection and obsolete manual/test save 409. Direct Firestore
client access was 403. Real Auth deletion rejected the old token and produced an
empty tombstone; the exact temporary account/document were removed. Both local
websites serve the new dialog. Task emulators were stopped. No live provider/paid
generation calls were made; owner-entered keys/model/image behavior remain
unverified. Existing build/dependency notices remain unchanged.

## Approved follow-up: Designs sidebar sectioning

The [sidebar sections phase](../specs/SidebarSections.md) is shipped. Compact
Account/This browser headings, counts and a subtle divider replace loose grouping.
Instructional paragraphs move to accessible info tooltips; empty states and rows
are compact. Design order, navigation, ownership, saving and bottom actions remain
unchanged.

Evidence: Auth/Firestore emulator `pnpm check` passed **268 tests / 36 suites**,
all format/lint/type/license gates (**9 MIT / 312 permissive dependencies**) and
all workspace builds. Browser checks cover section/count accuracy, hover/focus/
touch, Escape/Tab/outside/scroll/resize dismissal, painted tooltip bounds in the
mobile drawer, Day/Night and 60-design bottom-action stability. Local preview was
visually inspected. No backend deployment or dependency change; task emulators
were stopped.

## Approved follow-up: Design controls

The [design controls phase](../specs/DesignControls.md) is shipped. Section titles
replace information icons; sibling horizontal ellipsis menus expose Claim,
Rename and confirmed permanent Delete in the Firebase app. Claim sits left of
Save and saves browser-only drafts to the account. Rename preserves raw recovery
and unrelated edits; saved rename/delete enforce capabilities and revisions.
Deletion erases every version and retains only an anti-resurrection authorization
tombstone. Firebase is the sole persistence backend.

Local evidence: Auth/Firestore emulator `pnpm check` passed **281 tests / 36 suites**,
all format/lint/type/license gates (**9 MIT / 312 permissive dependencies**), all
workspace builds, and the actual Deno 2.9.6 graph. Coverage includes 501-version
deletion, rejected unauthorized/stale mutations, cleanup failure/retry, active and
inactive recovery, 320px header bounds, mobile menus/dialogs in Day/Night, and
no late deletion redirect after navigation. The current native preview was visually
inspected and both app servers returned 200. Task emulators were stopped.

The first MCP deployment failed on expired credentials; owner reauthentication
completed. Replacement MCP deployment **1793544874916** succeeded. Live save/rename,
immutable revisions, stale/unauthorized deletion, unsigned claim/list, permanent
deletion/retry, deleted reads, anti-resurrection and CORS checks passed. All three
functions are ACTIVE and AI secret version 1 is unchanged. The exact temporary
design, versions and tombstone were removed; no Auth accounts or provider calls.
Agent/MCP/CLI integrations are the next phase, prioritizing Cowork and both OpenAI
desktop and web/cloud Work; no package publishing or hosted MCP work in this phase.

## Approved follow-up: Sidebar context menus and alignment

[Sidebar context menus and alignment](../specs/SidebarContextMenus.md) is shipped.
Design ellipses use a distinct 140px context appearance while ordinary action menus
remain 236px. The visible native scrollbar uses the sidebar's outer padding;
rows/counts/ellipses align with the bottom cards. New design is a filled black/white
button with hover/pressed/focus feedback; Library and design mutations are unchanged.

Evidence: focused emulator browser gate **44 tests / 4 suites**; real-emulator
`pnpm check` **282 tests / 36 suites**, all format/lint/type/license gates
(**9 MIT / 312 permissive dependencies**) and all workspace builds passed.
Measured 140px menus and <=1px right-edge alignment for 1/106 drafts at
1440/390/320px in Day/Night, scrolling/anchored cards, keyboard/dismissal and a fresh
New design retaining all previous drafts. Isolated screenshots of the current
native preview were visually inspected. Task emulators stopped; shared browser
data untouched. No backend deployment or real provider calls. Agent integrations
remain deferred to their separately approved phase.

## Approved follow-up: Workspace action buttons

[Workspace action buttons](../specs/WorkspaceActionButtons.md) is shipped.
New design is a content-width, 32px-tall filled button with its plus and label
left-aligned with My Library. Claim has a visible 1px border and a circled check
after its label; existing very-narrow-screen icon-only behavior is unchanged.
Claim/save/navigation, context menus and scrollbar/card alignment are unchanged.

Evidence: focused emulator browser gate **34 tests / 2 suites**; real-emulator
`pnpm check` **282 tests / 36 suites**, all format/lint/type/license gates
(**9 MIT / 312 permissive dependencies**) and all workspace builds passed.
Measured <=1px icon/label alignment, 32px button height, Claim structure/border,
320px header bounds and recovery retention in Day/Night. Isolated native previews
were visually inspected; New design measured 111.61 x 32px. Shared browser data
untouched; task emulators and temporary screenshots removed. No backend deployment
or real provider calls; agent integrations remain separately scoped.

## Approved follow-up: Prompt toggle and session history

[Prompt toggle and session history](../specs/PromptHistory.md) is shipped.
A split Prompt/chevron control follows + Page with the same divider. Hiding the
bottom prompt preserves input/context and generation; session-only history shows
sent prompts and actual outcomes, automatically opening on request/result without
stealing focus. Manual dismissal, cancellation, guarded undo and errors remain
accessible. No conversational/prose API changes or persisted history.

Evidence: native/legacy emulator focused gate **55 tests / 5 suites**; real-emulator
`pnpm check` **284 tests / 36 suites**, all format/lint/type/license gates
(**9 MIT / 312 permissive dependencies**) and all workspace builds passed.
Measured prompt clearance/Fit changes, exact retained manual camera/iframe,
desktop/mobile Day/Night bounds, history focus/dismissal and long-message scrolling
passed, alongside real request/outcome/undo/cancel/error behavior and no persisted
prompts. Native model-change cancellation, modal deferral, Library completion and
account/route isolation passed. Isolated native/Thinking/result screenshots were
visually inspected with local provider stubs. Shared browser data untouched;
exact temporary screenshots, preview helpers and task emulators removed.
No dependencies, real provider calls or backend deployment; agent tooling remains
a separately scoped phase.

## Approved follow-up: Prompt toolbar and wordmark polish

[Prompt toolbar polish](../specs/PromptToolbarPolish.md) is shipped. Thinking/result
captions and fallback Undo no longer paint beneath the composer; live announcements
and explicit errors remain. Applied success clears only the main sent prompt,
retaining history, targets and attachments. Code/Canvas size moved from the header
to the right of Prompt/history with matching dividers, preserving their actions
and custom dimensions. The sidebar wordmark is monochrome, reduced from 19px to
15.2px (exactly 20%).

Evidence: focused legacy browser gate **46 tests / 5 suites**, native workspace/
toolbar emulator gate **20 tests / 2 suites**; real-emulator `pnpm check`
**284 tests / 36 suites**, all format/lint/type/license gates (**9 MIT / 312
permissive dependencies**) and all workspace builds passed. Exact branding/divider
and full 1440/390/320px Day/Night bounds, actual clearing/preservation/history-only
Undo, context/targets and existing editor/camera/source/account guards passed.
Responsive measurements wait for layout/popover repositioning rather than stale
desktop coordinates. Five isolated native desktop/mobile and local-stub
Thinking/result screenshots were visually inspected. Shared browser data untouched;
temporary screenshots/helper and task emulators removed. No dependencies, real
provider calls or backend deployment; agent integration remains separately scoped.

## Approved follow-up: Sidebar card icons

[Sidebar card icons](../specs/SidebarCardIcons.md) is shipped: Sparkles replaces
the agent arrow; a person icon follows the Account/sign-in title on the same right
alignment. Existing card/subtitle/click behavior is retained.

Evidence: focused real-emulator sidebar case passed exact 14px decorative icons,
<=1px alignment and full-width subtitle below the title at 1440/390/320px in
Day/Night with short/long lists. Real-emulator `pnpm check` passed **284 tests /
36 suites**, all formatting/lint/type/license gates (**9 MIT / 312 permissive
dependencies**); all workspace builds passed. Task emulators removed; no
dependencies, deployment or provider calls.

## Approved follow-up: Workspace state polish

[Workspace state polish](../specs/WorkspaceStatePolish.md) is shipped.
"Opening your canvas..." is centered in the editor with a decorative,
indeterminate animated loader and reduced-motion support. Pointer-inherited canvas
focus borders are suppressed; keyboard indicators, selection, pan and zoom remain.
My Library's empty and filtered-empty content uses the available space beneath its
toolbar instead of a fixed top margin. Library data/actions and load errors remain
unchanged.

Evidence: real Auth/Firestore emulator `pnpm check` passed **319 tests / 41
suites**, formatting, zero-warning ESLint, all type checks and license audit
(**9 MIT manifests / 312 permissive production dependencies**). `pnpm build`
passed all workspaces. Native Chromium measures centers within 1px in Day/Night at
1440x900, 390x844, 320x568 and 640x360; animation advances and stops under reduced
motion. Pointer/keyboard focus, load-error recovery, selection/camera, a real
PNG export/filter/populated-library round trip and existing regressions pass.
Both preserved local preview servers return 200. No dependencies, backend
deployment or real provider calls in this phase. Hosted-MCP deployment remains
paused at its verified container build; this phase does not advertise its URL.

## Approved follow-up: Authenticated hosted MCP

[Authenticated hosted MCP](../specs/HostedMcp.md) remains **Active**.
The owner selected Preview domain mapping after reviewing production limitations
and costs. Its stable client URL and issuer allow a later, separately approved
production load-balancer upgrade without changing Firebase accounts or client
settings; the specification records the staged routing/certificate/DNS steps.

Current evidence: Cloud Run `tinytldr-mcp-00002-n4w` serves the successful isolated
build `5451faab-3be1-4bc1-ab9f-526ea9960d64` / image `hosted-20261101-2055`.
Health is 200 and its private identity/database/bucket and min 0 / max 2,
1 CPU / 2 GiB, concurrency 4 / timeout 130 settings remain intact. Earlier live
discovery, unsigned-MCP denial, public login, CORS and named-database checks pass.
Hosted prompts request short-lived downloads, while local export instructions
remain unchanged. Focused real-emulator checks passed 20 tests / 2 suites; full
`pnpm check` passed **319 tests / 41 suites**, all formatting/lint/type/license
gates (**9 MIT / 312 permissive dependencies**) and all workspace builds.
Remote source audit passed 343 files with no environment/credential/debug paths;
the build succeeded in 5m39s. Task emulators and exact logs were removed.

The owner saved Google's generated `mcp CNAME ghs.googlehosted.com.` record;
public DNS confirms it. Google still reports `CertificatePending`, and trusted
custom-domain TLS checks fail. No insecure TLS bypass was used. Live custom-domain
OAuth/export checks, client integration and hosted-default connector UI are
unverified; do not mark this phase shipped or advertise the hostname as ready.
Existing AI/design services, provider secrets and real accounts are unchanged.

## Approved follow-up: Welcome landing modal

[Welcome landing modal](../specs/WelcomeLanding.md) is shipped with the purpose
"Templates for your agents": upright original template artwork, the monochrome
tinytldr. wordmark at top left, centered hero copy and only a wider, centered
Start Creating button without an arrow. Gentle staggered fade/vertical entrance
motion is disabled for reduced-motion preferences. Very short screens prioritize
the complete headline and copy over decorative artwork; supplemental details
scroll while dismissal and the footer stay reachable.

Evidence: focused native dialog checks passed **8 tests** including exact copy,
176px minimum action width, <=1px centering, upright animated cards, reduced
motion, Day/Night desktop/mobile/short-screen layout, focus/close/reopen behavior,
agent/docs navigation and preserved design state. Five isolated native previews
were visually inspected. Final real-emulator `pnpm check` passed **320 tests /
41 suites**, formatting, zero-warning lint, typechecks and license audit
(**9 MIT / 312 permissive dependencies**); all workspace builds passed.
Both preserved previews return 200. Task emulator/logs/screenshots were removed.
No dependencies, backend deployment, shared-browser changes or real provider
calls; hosted-MCP remains separately scoped and unverified at the custom domain.

## Approved follow-up: Welcome format carousel

[Welcome format carousel](../specs/WelcomeCarousel.md) is shipped: three manually
selected Posts/Carousels/Motion introductions with stronger titles/subtitles and
distinct original artwork. Shorter upright cards share a vertical center; format
selectors and wrapping previous/next controls remain pinned above the centered
Start Creating CTA. The compact truthful account/draft note now sits below it.
No autoplay or actual workspace-template selection.

Evidence: **9 focused native tests** verify every navigation transition, keyboard
focus, 60 seconds without automatic advancement, single-slide/live-copy semantics,
reopen/reset and retained drafts/preview. All three slides pass Day/Night bounds
at 1440/390/320px and 640x360, <=1px graphic centering, no rotation, actual motion/
reduced motion, always-visible controls, and note below CTA. Short landscape
shows full title/subtitle at 24px headline sizing. Six isolated screenshots were
visually inspected and fresh live-preview navigation passed.
Final real-emulator `pnpm check` passed **321 tests / 41 suites**, all format/lint/
type/license gates (**9 MIT / 312 permissive dependencies**); all workspace builds
passed. Both preserved previews return 200. Exact task emulator/logs/screenshots
removed; no dependencies, shared-browser changes, provider calls or deployment.
Hosted-MCP remains separate and unchanged.

## Approved follow-up: Welcome topics and modal-edge navigation

[Welcome carousel](../specs/WelcomeCarousel.md) is shipped with the revised
topics "Templates built for agents.", "Made to be consistent" and "Bring your own
key". Compact topic selectors remain above Start Creating; arrows now sit at the
left/right modal edges, vertically centered on the whole modal. Reserved content
gutters prevent overlap. Original artwork matches the topics; BYOK describes
existing optional AI drafting, not a key requirement for templates.

Evidence: website typecheck and **10 focused native tests** pass. Every topic in
Day/Night at 1440/390/320px and 640x360 measures <=1px modal-centered arrows,
13px edge insets, clear gutters and single-line selectors. A 320x360 actual-scroll
regression retains identical arrow positions and working navigation.
Existing keyboard/focus/reopen, wrapping/no-autoplay, motion/reduced motion,
CTA/note placement and mounted drafts/preview pass. Six isolated screenshots were
visually inspected. Final real-emulator `pnpm check` passed **322 tests /
41 suites**, all format/lint/type/license gates (**9 MIT / 312 permissive
dependencies**); all workspace builds passed. Both preserved previews return 200.
Exact task emulator/logs/screenshots removed; no dependencies, shared-browser
changes, real provider calls, backend deployment or hosted-MCP changes.

## Approved follow-up: Remove welcome topic buttons

Removed the Templates/Consistency/Your key selector row and its unused styles
from the [welcome carousel](../specs/WelcomeCarousel.md). Modal-edge arrows remain
the only slide navigation; no empty footer row is reserved. The three topics,
artwork, Start Creating and account note are unchanged.

Evidence: **10 focused native tests** pass, explicitly checking no topic buttons
in all topics at four viewports in Day/Night while retaining arrow geometry,
wrapping, keyboard/focus/reopen, no autoplay, scrolling and draft preservation.
Desktop/mobile live-preview screenshots were visually inspected and arrow
navigation passed. Real-emulator `pnpm check`: **322 tests / 41 suites**, all
format/lint/type/license gates (**9 MIT / 312 permissive dependencies**).
All workspace builds pass. Both previews return 200. Exact task emulator/log/
temporary output removed; no dependencies, provider calls or deployment.

## Approved follow-up: Slide-specific welcome artwork

Replaced the shared three-card welcome art with one illustration per
[welcome carousel](../specs/WelcomeCarousel.md) slide: Templates (agent → template
→ post), Consistency (three matching pages plus a shared-style strip) and BYOK
(an "Optional" AI-drafting key panel beside a "No key needed." template card).
Copy, arrows, Start Creating and the account note are unchanged.

Evidence: website typecheck and **10 focused native tests** pass, asserting
per-slide pieces inside the artwork, 1px centering, no clipping or rotation in
four viewports Day/Night, plus staggered motion and reduced motion. Isolated
1440/390/320px Day/Night screenshots were inspected. Real-emulator `pnpm check`:
**322 tests / 41 suites**, all gates (**9 MIT / 312 permissive dependencies**);
all workspace builds pass. Both previews return 200. Exact task emulator/log/
temporary output removed; no dependencies, provider calls or deployment.

## Approved follow-up: My Library source toggle and uploads

My Library now has an [Everything][Uploads][Exports] source toggle before the
All files dropdown. Uploads are AI composer reference images saved on this device
and deduplicated by content; see the [media library revision](../specs/RenderedMediaLibrary.md).
The "Rendered exports · On this device" label and the back-button arrow are gone.
Template logo/image reuse is a future follow-up.

Evidence: website typecheck and focused media/composer/workspace tests pass.
Real-emulator `pnpm check`: **323 tests / 41 suites**, all gates (**9 MIT / 312
permissive dependencies**); all workspace builds pass. Both previews return 200.
Exact task emulator/log/temporary output removed; no dependencies, provider calls
or deployment.

## Approved follow-up: Firebase-only fresh public installation

[Firebase fresh installation](../specs/FirebaseBackend.md) is shipped in source
and configuration. Removed the alternative backend SDK, SQL/functions, old
email-link completion, multi-key upgrade controls, and old document/draft/theme
conversion paths. Local editing and current recovery remain available without
hosted configuration. Firebase accounts/designs/versions/AI preserve authorization,
transactions, encryption, revision checks, and deletion safeguards.

Firebase Hosting is configured for **https://www.tinytldr.com**. A separate bounded
Cloud Run renderer at **https://api.tinytldr.com** verifies Firebase bearer tokens
for renders and owner-private, expiring downloads. The browser authenticates both
requests and refuses foreign artifact origins. MCP URL/issuer remain unchanged at
**https://mcp.tinytldr.com/mcp** / **https://mcp.tinytldr.com**.
Public project values stay configurable and ignored; examples contain placeholders.
Function-only deployments do not require Hosting configuration.

Evidence: the official demo Auth/Firestore emulator
`npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore --non-interactive "pnpm check"`
passed **335 tests / 42 suites**, with no skips, formatting, zero-warning ESLint,
all workspace TypeScript checks, and **9 MIT manifests / 304 permissive production
dependencies**. `pnpm build` passed every workspace. Coverage includes real Firebase
browser/service flows, current-only recovery, private export auth/origin/download
bounds, deployment portability, and deterministic image/PDF/FFmpeg regressions.
The Library centering assertion now accounts for the existing capacity footer;
no CSS was changed. Clearing a Firebase display name uses an explicit empty string,
verified by the account browser regression.

Docker is unavailable, so container-image execution remains unverified.
Private-bucket IAM/lifecycle, custom-domain DNS/TLS, and live deployment remain
separate operator setup. No cloud data, DNS, visual styling, live deployments,
or paid provider calls were changed in this phase.

## Approved follow-up: signed-in New design

[Personal workspace](../specs/PersonalWorkspace.md) New design immediately creates
an account-owned cloud design when signed in, opens its saved link, and requires
no Claim. Guests remain local; signing in alone does not claim existing drafts.
Later edits still require Save. No styling or backend ownership changes.

The existing Firebase create operation is idempotent. Pending New design actions
are disabled, failed requests reuse their ID on retry without discarding the
current/raw draft, and account/navigation guards prevent stale redirects or
creation under a different account.

Focused real Auth/Firestore emulator browser and auth-client checks passed
**21 tests / 2 suites**, including actual persisted ownership, reload, explicit
later Save, duplicate clicks, committed-but-failed response retry, source
preservation, and late account/navigation completion.

Final official demo Auth/Firestore emulator
`emulators:exec --project demo-tinytldr --only auth,firestore --non-interactive "pnpm check"`
passed **342 tests / 43 suites**, no skips, formatting, zero-warning ESLint, all
workspace typechecks, and **9 MIT manifests / 304 permissive production
dependencies**. `pnpm build` passed every workspace. User-facing help and ownership
documentation now describe the new behavior. Task emulators/log removed; no live
deployment, cloud data changes, or paid provider calls.

## Approved follow-up: Firebase Storage media

The [media library Firebase revision](../specs/RenderedMediaLibrary.md) is shipped.
Existing image uploads and rendered image/video/PDF exports, including posters,
are retained in private Firebase Storage. Trusted Firebase Functions authorize
each operation; Firestore owns metadata, complete-batch publication, per-account
SHA-256 upload deduplication and the transactional 100 MB uploads quota.
Account switches clear previews and stale requests. HTML/JSON downloads, text
attachments, library layout, and MCP are unchanged. No old-file migration.

Final official demo Auth/Firestore/Storage emulator
`emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm check"`
passed **354 tests / 44 suites**, no skips, formatting, zero-warning ESLint, all
workspace typechecks, and **9 MIT manifests / 304 permissive production
dependencies**. `pnpm build` passed every workspace. Evidence includes exact
original/thumbnail bytes, real image/PDF/video outputs, cross-browser persistence,
account isolation and deletion, quota concurrency, rollback, private access, and
account-deletion tombstones. Non-fatal Firebase emulator/SDK warnings and the
existing Vite chunk-size advisory remain. No live deployment or real provider calls.

## Production publication: 2026-11-02

The owner approved live publication and selected a separate Firebase Hosting API
proxy rather than adding another Preview Cloud Run domain mapping.

- `https://www.tinytldr.com` and `https://api.tinytldr.com` report
  `HOST_ACTIVE`, `OWNERSHIP_ACTIVE`, `CERT_ACTIVE` and pass trusted HTTPS.
  The API health endpoint returns 200; unsigned rendering and media requests
  return 401 with the expected production-origin CORS headers.
- `https://mcp.tinytldr.com/mcp` keeps its issuer and existing Preview routing.
  Health/discovery return 200; unsigned MCP returns 401. Its runtime identity,
  named database, private artifact bucket and bounded resources are unchanged.
- API Cloud Build `91f46481-cd19-4387-bf26-554b48d695e8` succeeded. Digest
  `sha256:45c59a47e2d829c9801cfd001d9c7bbaf89f42563337ae14cee012ef71fbf395`
  is deployed as `tinytldr-api-00001-4x4`.
- MCP Cloud Build `fd244f06-f60c-455e-9b32-e9d845341467` succeeded. Digest
  `sha256:b415c74fe721b048c9544974c6c8e19d0ac95c48603a568afe1b09ce62ab1afd`
  is deployed as `tinytldr-mcp-00003-6pk`. The audited source upload contained no
  environment files, credentials, Git metadata or logs.
- `npx --yes firebase-tools@15.34.2 deploy --project tinytldr-2baae --only "firestore,storage,functions:tinytldr" --non-interactive --force`
  successfully published all five functions and private rules/indexes. Force
  explicitly acknowledged the tested idempotent account-deletion retry policy.
  `pnpm deploy:hosted hosting` successfully built the configured website and
  published both Hosting sites.
- Persistent Firebase media has no whole-bucket deletion lifecycle. A separate
  private API bucket has one-day deletion. Both media runtime identities have
  explicit object access only on the persistent bucket; the API has its own
  identity and database/bucket-scoped authorization. Rate TTL is active.
- The owner-approved disposable-account live smoke check passed password sign-in,
  owned cloud design save, automatic cloud New design in Chromium, real API PNG
  rendering and authenticated artifact download, byte-exact persistent upload/
  export/poster reads, browser library reload, and official MCP client
  OAuth/PKCE/initialize/list/render/download. It cleaned its own designs, media,
  artifacts, OAuth/rate records and account. No existing account/data or AI keys
  were used; no AI/provider calls were made.
- Deployment exposed and repaired Windows quoted-command resolution, Firebase's
  Windows slash normalization in the workspace selector, bundled CommonJS
  built-in loading in ESM functions, public-font CORS for sandboxed previews,
  and an asynchronous thumbnail-test assertion. No CSS/UI layout changes.
  Regression tests cover the runner, separate API proxy, function bundle loading,
  font headers and loaded distinct posters.
- Final real demo Auth/Firestore/Storage emulator `pnpm check` passed **358 tests /
  44 suites**, no skips, all format/lint/type gates and **9 MIT manifests /
  304 permissive production dependencies**. `pnpm build` passed every workspace.
  Non-fatal Firebase/Node tooling warnings and the Vite chunk advisory remain.
  The packaged Firebase dependency install reported six moderate audit advisories;
  no unrelated dependency updates were included in publication.

## Exact composer images and context cleanup: 2026-11-02

The owner approved exact attached-image placement, successful context cleanup,
verification and publication, without layout/style changes or a general media
picker. See the [shipped composer revision](../specs/WebsiteAiComposer.md).

- Provider requests identify attached and existing raster images with stable
  content-hashed references. The trusted gateway restores only recognized bytes;
  unknown/malformed references, invented URL suffixes and invented raster data
  fail explicitly. The model no longer needs to reproduce existing base64.
- Placed images are self-contained in design data and share existing preview,
  save/reload, source-download and sandboxed export paths. Oversized placement
  fails with an actionable error; document/save limits and private Firebase
  Library storage are unchanged.
- Successful application clears submitted attachments/context while keeping
  newer context and uploaded originals. Failed/cancelled/stale or uncompiled
  results do not clear submitted input. Target chips and guarded Undo retain
  shipped behavior.
- `npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm exec vitest run website\test\AiGeneration.test.ts website\test\AiComposerBrowser.test.ts"`
  passed **28 tests / 2 suites**, including all provider protocols, exact bytes,
  saved reload, PNG pixels, an actual PDF image, decoded video pixels, ffprobe
  assertions and attachment lifecycle.
- Final `npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm check"`
  passed **368 tests / 44 suites**, no skips, all format/lint/type gates and
  **9 MIT manifests / 304 permissive production dependencies**. `pnpm build`
  passed every workspace. Existing Firebase/Node tooling, packaged dependency
  audit and Vite chunk-size advisories remain; no unrelated dependency changes.
- `pnpm deploy:hosted "functions:tinytldr:ai,hosting:tinytldr-2baae"` published the
  website and AI function. The final strict-reference update passed the full
  gate/build again and `pnpm deploy:hosted "functions:tinytldr:ai"` succeeded.
  AI revision `ai-00006-mac` is active; renderer/API/MCP containers were unchanged.
- Live website JavaScript/styles match local release bytes. Separate disposable
  Chromium guest preview passes with a secure context, no mixed resources,
  horizontal overflow or JavaScript errors. API/MCP HTTPS health returns 200;
  unsigned AI requests return 401 with correct production-origin CORS.
  No paid provider calls or existing user data/credentials were used or changed.

## Centered Library loading: 2026-11-02

The owner approved replacing the visible Library loading line with a muted 24px
spinner, centered in both axes between the filters and capacity bar, followed by
verification and website publication. The accessible status is visually hidden;
reduced motion disables rotation. Other Library states and layout are unchanged.
See the [shipped Library revision](../specs/RenderedMediaLibrary.md#revision-centered-loading-spinner).

- `npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm exec vitest run website\test\MediaLibraryBrowser.test.ts"`
  passed **11 tests**, including paused loading and exact centering within 1px
  at 1440x900, 390x844, 320x568 and 640x360 in Day/Night, status accessibility,
  normal/reduced motion, no overflow and success/error transitions.
- `npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm check"`
  passed **369 tests / 44 suites**, no skips, all format/lint/type gates and
  **9 MIT manifests / 304 permissive production dependencies**.
  `pnpm build` passed every workspace.
- `pnpm deploy:hosted "hosting:tinytldr-2baae"` successfully published only the
  website. Live JavaScript/styles match the configured release build byte for
  byte. Separate disposable Chromium checks pass the guest Library flow with
  trusted HTTPS, no mixed resources, horizontal overflow or JavaScript errors.
- Functions, API/MCP runtimes, credentials and existing user data were unchanged.
  Existing Firebase/Node tooling and Vite chunk-size advisories remain.

## Legal pages and Library routes: 2026-11-03

The owner approved implementation, verification and website publication of
`/privacy`, `/terms`, footer links and `/library`, with retained unfinished work.
Confirmed public details are AJR Creative LLC, aj@ajr.co, age 18+ and Virginia/US
law; no mailing address is published. See the
[shipped specification](../specs/LegalAndLibraryRoutes.md).

- Public legal pages work without backend configuration, focus their headings,
  scroll independently of the workspace and fit Day/Night desktop/mobile. Policies
  describe actual public links, private Library files, Firebase/browser storage,
  optional AI/provider responsibilities, deletion limits and MIT/self-hosting.
  They are original drafts; legal review is recommended, not certified.
- The shell retains a separate workspace location across Library/legal surfaces;
  real design navigation and New design retain their existing invalidation rules.
  A browser reproduction exposed nested history entries from updating `srcDoc`.
  Replacing the iframe for each compiled artboard revision produces zero new
  history entries, keeping Back/Forward correct after generation or source edits.
- `npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm exec vitest run website\test\AiComposerBrowser.test.ts website\test\ArtboardWorkspaceBrowser.test.ts"`
  passed **18 tests / 2 suites**, including hidden deferred generation, attachment
  lifecycle, preview history, camera/iframe stability and touch controls.
- `npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm check"`
  passed **375 tests / 44 suites**, no skips, all format/lint/type gates and
  **9 MIT manifests / 304 permissive production dependencies**.
  `pnpm build` passed every workspace.
- `pnpm deploy:hosted "hosting:tinytldr-2baae"` successfully published only website
  Hosting. All three live routes return HTTPS 200 and the configured release
  index. All eight referenced JavaScript/styles match release bytes; main asset
  `/assets/main-4AQgGD-H.js` has SHA-256
  `141dedb008a57904b0c11fdee0d5fea55d519a3decdc33dd0f431b537eba62a7`.
- Isolated, signed-out Chromium checks passed public policy content, no hidden
  draft on direct legal entry, refresh, desktop/320px Day/Night layout, Library
  direct load, Back/Forward and actual source/prompt/nondefault-camera retention.
  No JavaScript errors or insecure resource requests were observed.
- No functions, API/MCP runtime, production accounts, existing data or provider
  keys changed. No paid AI calls were made. Existing non-fatal Firebase/Node
  tooling and Vite chunk-size advisories remain.
