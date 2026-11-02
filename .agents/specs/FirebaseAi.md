# Firebase AI gateway

State: Shipped; current connection contract is defined by
[SimpleFirebaseAi](./SimpleFirebaseAi.md). Fresh-install removal of old paths is
governed by [FirebaseBackend](./FirebaseBackend.md).

## Scope

- Firebase ID tokens, including revocation/account availability, authorize
  account-owned connection operations and separate request-rate buckets.
- Server-only Firestore contains AES-256-GCM encrypted credentials using a
  Secret Manager key, bound to owner, connection, provider, endpoint, and model.
- Replacement/removal and Auth-deletion cleanup remove live credentials.
  UID tombstones prevent verified in-flight requests from restoring them.
- Native OpenAI, Claude, Gemini, and approved compatible providers share
  validated protocols, bounded output/context, cancellation, strict endpoint
  policy, selected-page protection, unsaved drafts, and guarded Undo.
- A distinct AI endpoint has exact origin restrictions and explicit unavailable
  states. There is no provider or backend fallback.

## Verification contract

Real Auth/Firestore emulator tests exercise ciphertext integrity, isolation,
transactions, rates, cleanup, token checks, and direct-client denial.
Browser tests exercise real SDK sessions with mocked provider APIs.
Production provider billing/model/image support is not established by mocks.
See [deployment and credential boundaries](../docs/AiConnections.md).

## Exclusions

No AI calls in core/MCP/preview/rendering, new providers, telemetry, account
deletion UI, automatic credential linking, or plaintext credential persistence.
