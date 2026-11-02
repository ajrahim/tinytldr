# Simple Firebase AI connection

State: Shipped; fresh-install behavior is governed by
[FirebaseBackend](./FirebaseBackend.md).

## Scope

One provider/key connection per account. Connect performs bounded server-side
model discovery, not paid generation. Select an API-returned model in the
dialog or composer; retain it across reloads. No connection names, manual model
IDs, default selector, or multi-key upgrade controls.

## Behavior

- Native OpenAI, Claude, Gemini and operator-allowlisted compatible APIs use
  authenticated GET model listing, bounded pages/responses, no redirects,
  cancellation, and explicit errors.
- API names/IDs are retained; known non-text native model families are filtered.
  Discovery does not guarantee billing, permissions, or image support.
- Same-provider replacement preserves an available selection. Failed refresh
  preserves the previous connection; successful refresh clears a missing model.
- Firestore transactions enforce one connection under competing writes.
  Model changes re-encrypt against model-bound associated data. Current
  encryption-format validation, owner isolation, request rates, deletion
  tombstones, and browser key non-persistence remain required.
- Provider/model changes invalidate pending generation.
- Disconnect removes server ciphertext but does not revoke the provider key.

## Verification contract

Use real Auth/Firestore emulators for storage races/isolation and browser SDK
flows, with mocked provider catalog/generation responses. Unit tests cover
protocols, pagination, filtering, malformed/oversized responses, endpoint policy,
and cancellation. Live provider behavior requires separate owner-approved checks.

## Out of scope

Paid connection tests, fake/manual catalogs, provider-key revocation, login UI
changes, telemetry, and AI changes to deterministic rendering/MCP.
