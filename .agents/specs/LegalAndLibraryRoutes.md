# Legal pages and Library routing

State: Shipped. Implemented, verified and published on 2026-11-03.

## Scope

- Publish original, readable Privacy Policy and Terms and Conditions pages at
  `/privacy` and `/terms`, with real footer links and direct-load/refresh support.
  Operator: AJR Creative LLC. Public contact: aj@ajr.co only; no mailing address.
  Terms use Virginia/United States law and an 18+ hosted-service minimum.
- Policies describe verified Firebase/Auth/Storage, public-by-link cloud designs,
  private Library files, browser recovery, optional BYOK AI sharing, temporary
  rendering and hosted MCP behavior. Do not promise legal compliance, private
  cloud-design viewing, provider no-training policies or deletion features that
  are not implemented. Independent self-hosting and MIT license rights remain
  distinct from hosted-service terms. Legal review is recommended.
- My Library uses `/library`; direct visits, refresh, browser Back/Forward,
  sidebar toggling, return-to-design and sign-in return paths remain consistent.
- Preserve the mounted workspace and unfinished source, prompt/attachments and
  generation when visiting Library/legal pages and returning. Real design
  navigation and New design retain cancellation/invalidation behavior.
- Legal pages load without an account or configured backend and do not create a
  background design on first direct entry. Keep standard link modifiers/new-tab
  behavior, accessible headings/focus and readable scrolling in both themes.
- Footer links fit desktop/mobile without horizontal overflow or moving existing
  controls unnecessarily. No tracking, cookie-consent framework, payments,
  account-deletion UI, backend changes or new dependencies.

## Verification

- Test route parsing and public legal content/contact/date/age/jurisdiction.
- Test legal direct load/refresh, footer/cross-links, browser history, focus,
  mobile/light/dark layout and recovery of mounted invalid source and prompt state.
- Test signed-in/out Library direct load/refresh/history and existing media,
  account, generation and workspace regressions through real demo emulators.
- Run `pnpm check` in Auth/Firestore/Storage emulators and `pnpm build`, then publish
  only website Hosting and verify live routes/assets without existing user data.

## Acceptance evidence

- The final real demo Auth/Firestore/Storage `pnpm check` passed **375 tests /
  44 suites**, no skips, all format/lint/type gates and **9 MIT manifests /
  304 permissive production dependencies**. `pnpm build` passed every workspace.
- Browser assertions cover direct legal routes without backend configuration or
  background drafts, refresh, operator/contact/date/age/jurisdiction, native
  modified-click links, focused headings, scroll reset, both themes and
  1440x900, 390x844, 320x568 and 640x360 layouts.
- Guest and owned designs retain unfinished HTML/CSS/raw JSON and prompts across
  surface navigation, Back/Forward and return links; server-owned content remains
  unchanged until Save. Library direct entry, persisted sign-in, refresh and mobile
  drawer behavior pass. Deferred mocked generation applies behind legal pages,
  keeps history hidden there, clears only submitted context and preserves newer
  unsent prompts/attachments. Existing New design/navigation cancellation passes.
- A browser reproduction established that updating an existing `srcDoc` iframe
  adds a nested history entry and consumes Back. Compiled artboard revisions now
  replace that iframe, adding zero entries while retaining the canvas camera.
- `pnpm deploy:hosted "hosting:tinytldr-2baae"` published only website Hosting.
  Live `/privacy`, `/terms` and `/library` return HTTPS 200 and the exact configured
  release index; all eight referenced script/style assets match local bytes.
  Isolated guest checks pass public content, refresh, Day/Night desktop/320px,
  source/prompt/camera retention, Back/Forward and zero mixed resources or
  JavaScript errors. No real accounts, existing data or paid AI calls were used.
- Policies are original drafts based on the implemented service and supplied
  business details, not a legal-compliance certification; legal review remains
  recommended. No functions, API/MCP or backend configuration changed.
