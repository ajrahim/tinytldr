# Website AI composer

State: Shipped. Current connection/storage behavior is defined by
[SimpleFirebaseAi](./SimpleFirebaseAi.md) and [FirebaseBackend](./FirebaseBackend.md).

## Scope

- Optional authenticated website generation only; core/MCP/rendering stay
  deterministic. Provider keys remain encrypted server-side, never in browser
  storage, designs, exports, or logs.
- Floating composer with prompt, transient text/image context, model selection,
  send/cancel, and connection management. No microphone or refinement request.
- All artboards by default; `@` targets stable IDs. Targeted results preserve
  unselected pages and the title, may add new pages after the last target, and may
  change the shared size when asked (rejected if unselected pages cannot use it).
- The system prompt tells models to return exactly the requested page count and
  to apply requested dimensions (preset IDs or 64?4096 px custom sizes).
  Generation allows 420 s (function timeout 480 s) and the connection's output
  token limit (`max_output_tokens`, 1,000?128,000, default 32,000, set in the AI
  connection dialog and saved via the `tokens` action);
  timeouts return JSON 504 and truncated output explains the output limit.
- Bound prompt, context, responses, time, and account request rates. Custom
  endpoints require exact operator-approved HTTPS destinations, without
  credentials, query strings, redirects, or per-request overrides.
- Complete generated designs validate/compile before applying as unsaved drafts.
  Stale results after edits, navigation, sign-out, model changes, or cancellation
  cannot apply. Guarded Undo cannot overwrite later source edits.
- Composer clearance and input isolation preserve canvas navigation and mobile
  controls. Chat history remains session-only and creates no extra requests.

## Evidence contract

Schema/protocol tests cover malformed context, selected-page merging, native and
custom headers/images, endpoint policy, truncated output, bounded reads,
cancellation, auth/rate limits, and safe errors.
Real Firebase emulator tests verify storage integrity/isolation and browser SDK
flows with mocked providers. Paid provider behavior is separate live evidence.
See [setup and boundaries](../docs/AiConnections.md).

## Revision: Exact attached images and successful context cleanup

State: Shipped.

- Image placement requests use the original PNG/JPEG/WebP, not a model-drawn
  substitute. Request-scoped content-hashed references identify attached and
  existing design images; the trusted gateway restores their bytes after generation.
- Designs contain self-contained raster data URLs. Preview, save/reload, source
  downloads and deterministic exports use the existing sandbox without public
  Firebase links, session-only blobs or external requests. My Library retains
  the uploaded original independently.
- Existing images are replaced by references before sending design JSON to the
  provider. The model never needs to reproduce base64. Unknown references or
  invented raster bytes are explicit failures, not missing-image success.
- Preserve existing document/save limits. If exact image placement would exceed
  them, refuse the result with an actionable smaller-image error; do not silently
  resize, discard images or change the limit.
- Clear only submitted context after a result is successfully applied. Keep
  context on errors, cancellation, stale responses and compilation failures;
  preserve any newly added context. Target chips, history and guarded Undo retain
  their current behavior. No layout/style changes or general image-picker UI.
- Verification must cover exact original bytes, all provider adapters, subsequent
  edits with existing images, unknown references, size limits, saved reload,
  raster/PDF/video rendering and successful/failed/cancelled attachment cleanup.

Evidence:

- Focused real Auth/Firestore/Storage emulator checks passed **28 tests / 2
  suites**. All four provider adapters preserve exact bytes and stable references
  on later edits. Invented bytes, missing/malformed references and URL suffixes
  are rejected. Threshold assertions cover exactly 400,000 document characters,
  exactly 500,000 UTF-8 bytes and one beyond each, plus merged targeted limits.
- Browser checks verify the actual uploaded image source and natural dimensions,
  submitted-chip clearance, preserved newly added context, failed/cancelled/stale
  requests, save/reload and retained Library upload. Chromium exports contain exact
  PNG pixels, a real PDF image and matching decoded H.264 video pixels within a
  three-channel-value tolerance, with ffprobe codec/format/fps/duration assertions.
- Final `npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr
--only auth,firestore,storage --non-interactive "pnpm check"` passed **368 tests /
  44 suites**, no skips, all format/lint/type gates and **9 MIT / 304 permissive
  production dependencies**. `pnpm build` passed all workspaces.
- Approved deployment published the website and only the AI function:
  `pnpm deploy:hosted "functions:tinytldr:ai,hosting:tinytldr-2baae"`, followed by
  the final strict-reference update with `pnpm deploy:hosted "functions:tinytldr:ai"`.
  AI revision `ai-00006-mac` is active. Live website script/style bytes match the
  configured release build; isolated Chromium guest preview, trusted HTTPS,
  API/MCP health and unsigned AI denial/CORS checks pass.
- No paid provider calls, existing account/design changes, CSS changes, renderer
  container updates or credential changes. Provider behavior is covered by
  mocked protocol tests; live paid model behavior was not exercised.
