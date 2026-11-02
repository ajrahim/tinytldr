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
  unselected pages and design-wide settings, including raw JSON.
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
