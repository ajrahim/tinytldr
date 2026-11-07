# Website AI connections and composer

Optional website generation uses the signed-in account's own provider API key.
MCP, compilation, preview, and rendering remain deterministic and independent of
AI. Guest editing does not require an AI configuration.

## Account connection

Sign in, open **Connect AI**, choose OpenAI, Claude, Gemini, or an approved
OpenAI-compatible endpoint, and enter its key. Connect discovers models through
the provider API without generating content. Select a model in the dialog or
composer. Exactly one provider/key connection is supported per account.
API access and billing are separate from consumer chat subscriptions.

Refresh models updates the cached model list. Failed discovery leaves the
existing connection unchanged and reports an error. Successful refresh clears
selection when its model disappears. Replace key preserves an available
same-provider selection. Disconnect removes the stored credential but does not
revoke it at its provider. There is no manual model ID, default-connection
selector, multi-key upgrade, or automatic fallback provider.

Discovery bounds responses to 2 MB, 500 models, and ten pages. Compatible
providers must support `/models`. Discovery is not a guarantee of generation
permissions, image support, billing, or availability.

## Generation behavior

Prompt toggles the composer without losing typed text, attachments, or work.
Chat history is session-only and clears on workspace/account changes; it adds no
extra provider calls. Requests target all artboards unless `@` selects stable
artboard IDs. Targeted results cannot change other pages or project-wide title
and dimensions.

Text attachments remain transient context. Signed-in image attachments are also
saved as private My Library uploads. When asked to place an attached image as a
logo or photo, the model references that image; the gateway inserts the original
bytes into the design, rather than a text reconstruction or invented base64.
Existing design images are replaced with stable references in provider-facing
design JSON, so later edits do not ask the model to reproduce their bytes.
Placed images are self-contained in saved designs and exports; they do not
depend on public Firebase links or session-only blobs. The existing 400 KB
document and 500 KB UTF-8 save limits still apply. Oversized placement is refused
with a smaller-image error, never silent resizing or a missing-image success.

The receiving provider gets the prompt, selected design sources and attached
context, including original attached images for vision. A complete result must
validate and compile before becoming an unsaved draft. Successful application
clears the submitted prompt/context, not My Library files or newer attachments.
Errors and cancellation preserve submitted input. Save remains explicit; guarded
Undo is available until subsequent source edits.
Cancellation, navigation, sign-out, source changes, or connection/model changes
prevent late application. Cancellation cannot guarantee a refund or provider-side
termination.

## Credential boundary and deployment

Use [Firebase setup](./FirebaseBackend.md). Configure
`VITE_TINYTLDR_FIREBASE_AI_URL` with the deployed AI endpoint. Missing
configuration produces an explicit unavailable state.

Provision `TINYTLDR_AI_ENCRYPTION_KEY` in Firebase Secret Manager: a securely
generated 32-byte value encoded as 64 lowercase hex characters, supplied through
protected stdin or the secret prompt. Never expose it in browser variables,
source control, chat, logs, or analytics. Do not overwrite or disable the active
key while stored connections use it.

Firebase verifies ID tokens, revocation, and account availability. Firestore
contains AES-256-GCM ciphertext bound to owner, connection, provider, endpoint,
and selected model. Model changes re-encrypt against the updated associated
data. The encryption format version is a current integrity boundary, not an
upgrade flow. Metadata contains only provider/model catalog, masked suffix,
identifier, and timestamps; plaintext keys never enter designs, exports, browser
persistence, or iframes. Trusted server code can decrypt keys; this is not
end-to-end encryption.

Set exact `TINYTLDR_ALLOWED_ORIGINS`. Native provider endpoints are fixed.
Custom HTTPS base URLs must match `TINYTLDR_AI_CUSTOM_BASE_URLS` exactly; custom
providers are denied by default. IP literals, credentials in URLs, local/private
hostnames, redirects, query strings, and non-443 ports are rejected.
Allow only trusted public endpoints whose DNS and retention policy you trust.

Per-account transactions enforce the single connection and request-rate bounds.
Account-deletion cleanup removes live credentials/rate state and leaves a UID
tombstone so in-flight verified requests cannot recreate them. No account
deletion UI is added. Direct Firestore access is denied.

[The gateway](../../website/server/AiGateway.ts) owns auth/CORS, cancellation,
timeouts, strict contracts, and safe errors.
[The Firebase store](../../website/firebase/src/AiConnectionService.ts) owns
encryption and transactions. [Provider protocols](../../website/server/AiProviders.ts)
and [model discovery](../../website/server/AiModels.ts) are server-only.
There are no provider calls in core, MCP, or the rendering pipeline.

## Verification boundary

Run the [emulator check](./FirebaseBackend.md#verification). Tests use mocked
provider APIs, not paid requests. Live provider quotas, permissions, billing,
Secret Manager access, and deployment configuration require separate smoke tests.
