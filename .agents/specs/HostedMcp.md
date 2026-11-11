# Authenticated hosted MCP

Status: Active

## Approved scope

Deploy a working Streamable HTTP MCP renderer in the existing Firebase/Google
Cloud project using Cloud Run and Cloud Build. Intended endpoint:
`https://mcp.tinytldr.com/mcp`. Use existing Firebase accounts for sign-in,
including the existing email/password and Google flows. No public rendering.

Use MCP OAuth authorization with discovery and PKCE for remote clients, not a
shared API key or Cloud Run IAM login. Login/discovery routes must be public;
tool execution and downloads must require valid, scoped authorization.

Adapt the existing deterministic MCP/renderer for hosted operation: server-owned
output locations, owner-scoped downloadable exports and bounded request/render
resources. Reuse the renderer; do not expose arbitrary server filesystem paths.
Use scale-to-zero and a low instance cap; these are not a hard billing cap.

After live endpoint and DNS/HTTPS verification, show the hosted URL with Copy by
default in Connect an Agent. Move local CLI installation/setup into Documentation
and remove the arrow from Read the documentation. Preserve existing local workflows.

Google Cloud CLI setup and required owner authentication are approved. DNS changes
may require owner action. Do not advertise an unverified hostname as operational.

## Out of scope

No LLM calls, provider-key changes, account migration, website-design synchronization,
template pipeline changes, unrelated cleanup, or changes to existing Firebase AI
encryption secrets. Read-only, owner-scoped saved-design access was later approved
separately in [Hosted MCP saved designs](HostedMcpSavedDesigns.md).

## Acceptance criteria

- Real sign-in/consent, OAuth discovery/PKCE/token validation, denial of unauthorized
  tools/downloads, account isolation and expiry/replay checks have passing evidence.
- Official MCP client initializes, lists tools and renders/downloads a real export
  through the deployed HTTPS endpoint.
- Hosted paths, output sizes, time/concurrency/resource bounds and cleanup are tested;
  existing local stdio/HTTP behavior remains passing.
- Custom-domain DNS and TLS work before the URL is shown as ready.
- Default hosted dialog, copy action, documentation CLI instructions and arrow-free
  documentation button pass browser checks in Day/Night desktop/mobile.
- `pnpm check` and all workspace builds pass. Record live deployment evidence and
  remaining operational requirements without secrets or authorization codes.

## Operational design

- OAuth records use a dedicated named Firestore database, `mcp-oauth`, rather than
  granting the renderer access to the website's default database. Firestore TTL
  cleans records; authorization code enforces expiry independently.
- Runtime permissions are limited to that database, Firebase account reads, the
  private artifact bucket, and signing its own download capabilities. It receives
  no AI-provider secrets. Build identity is separate from runtime identity.
- OAuth account-incarnation checks use the Identity Toolkit millisecond creation
  timestamp: Firebase Admin's human-readable timestamp loses subsecond precision.
- Hosted limits: 2 MB requests; six render attempts per account/minute; one render
  per instance; 120-second render deadline; 20 files/slides per page; 20 MB/file,
  50 MB/export; 8 million static pixels per image and 80 million per batch; 180
  video frames and 480 million video pixels per batch.
- Download URLs are transferable five-minute capabilities, not ongoing Firebase
  sessions. Private objects expire through a one-day bucket lifecycle. Account
  revocation prevents new operations but cannot retract an already-shared URL
  before its short expiry.
- The separate authorization entry reuses password/Google login and requires
  explicit consent. It does not mount workspace, design persistence or AI hooks.

## Verification so far

Focused real-emulator OAuth, storage and cancellation regression checks passed
32 tests across five suites. The same-second account recreation failure was
reproduced and repaired. All workspace builds passed. Hosted export/download and
exact render-budget tests passed subsequently; final combined/full checks,
deployment, production authentication, DNS/TLS and the default connector UI remain
required before this specification can ship.

`pnpm build` and a real-emulator `pnpm check` subsequently passed: 314 tests in
41 suites, zero formatting/lint/type errors, nine MIT manifests and 312 permissive
production dependencies. This includes password sign-in and explicit consent in
the standalone browser page, Day/Night bounds at 1440/390/320px, official-client
exports with <=768px previews, private owner prefixes, capability denial/expiry,
account recreation, session revocation and transactional refresh/replay checks.

The isolated database, identities, repository and private buckets have been created.
OAuth TTL is active, both buckets use one-day expiry, and Firebase's existing
authorized domains were preserved while adding the MCP hostname. The first remote
container build succeeded; deployment and custom-domain readiness remain unverified.

The final MCP source passed 316 tests / 41 suites and built successfully as image
`hosted-20261101-1951`, digest
`sha256:4ac1d92733de5d875c83ac727125bd361e5309e44df021150b7cf1906bc7a5ab`.
The subsequent UI-only phase passed the current full gate at 319 tests / 41 suites
and all workspace builds.

Cloud Run service `tinytldr-mcp`, revision `tinytldr-mcp-00001-qx6`, is deployed
from that digest in `us-central1`. Runtime identity, named database and artifact
bucket are isolated as planned; settings are min 0 / max 2 instances, concurrency
4, 1 CPU, 2 GiB memory and a 130-second request timeout. Live service-origin checks
passed health 200, OAuth/resource discovery 200, resource-discovery fallback 307,
unsigned MCP 401, public login page 200 and MCP OPTIONS 204. Invalid consent returns
400 through the real named database rather than an infrastructure failure.

The owner selected direct Cloud Run Preview mapping after reviewing its production
limitations and costs, with a stable URL and documented production upgrade path.
The mapping for `mcp.tinytldr.com` now targets `tinytldr-mcp`; Google's actual
required DNS record is:

| Type  | Name | Target                |
| ----- | ---- | --------------------- |
| CNAME | mcp  | ghs.googlehosted.com. |

The owner saved the required CNAME. Public CNAME and A lookups now confirm
`mcp.tinytldr.com` resolves through `ghs.googlehosted.com`; root nameservers remain
at Name.com and no root CAA restriction was found. Google has moved to certificate
issuance but still reports `CertificatePending`. Trusted TLS checks, including a
DNS-confirmed IP with the correct hostname and certificate validation enabled,
have not succeeded. No TLS bypass or unverified connector default was introduced.
Custom-domain TLS, live sign-in/export and the default connector UI remain
unverified. Preview mapping is not represented as production-supported routing.

Hosted prompt guidance now requests short-lived downloads rather than server disk
paths, while both local prompts retain their existing disk/export wording. The
focused real-emulator official-client checks passed 20 tests / 2 suites; the full
real-emulator gate passed **319 tests / 41 suites**, all format/lint/type/license
gates (**9 MIT / 312 permissive dependencies**) and all workspace builds.
Isolated Cloud Build `5451faab-3be1-4bc1-ab9f-526ea9960d64` succeeded in 5m39s
with 343 audited source files and no environment/credential/debug paths.
Image `hosted-20261101-2055`, digest
`sha256:23846f355f397a86250bd7e781fc57270af19ad1b0dd7e1fa1fe4b96cab38a2e`,
is deployed as `tinytldr-mcp-00002-n4w`. Updated service health is 200 and its
identity, environment, scale/resource/concurrency/request bounds remain unchanged.
Test emulators and exact task logs were removed; existing AI/design services,
provider secrets and real accounts were not changed.

## Upgrading routing later

### Publication update: 2026-11-02

Trusted custom-domain TLS and certificate provisioning now pass. The owner-approved
disposable-account production smoke check passed real Firebase password sign-in,
OAuth discovery/PKCE/consent/token exchange, official-client initialization and
tool listing, PNG export with a bounded preview, and a real 1080px file download.
Unsigned MCP remains 401. The current `release-20261102` image is deployed as
`tinytldr-mcp-00003-6pk`; runtime identity, issuer, database, artifact bucket and
resource bounds are unchanged. Test-owned records/files/account were cleaned.
See [publication evidence](../docs/PLAN.md#production-publication-2026-11-02).
The specification remains Active for its separately scoped default connector UI;
publication does not introduce that UI change or replace Preview routing.

Keep `https://mcp.tinytldr.com/mcp` as the client endpoint and
`TINYTLDR_MCP_ISSUER_URL=https://mcp.tinytldr.com` unchanged. OAuth discovery,
authorization/token URLs and audience remain on that hostname. Routing is
independent of the renderer, existing Firebase accounts, OAuth records and private
artifact storage; do not migrate accounts or rotate credentials for a routing
upgrade.

Optional `TINYTLDR_OPENAI_APPS_CHALLENGE` (Cloud Run env var, URL-safe 16–128
characters) serves OpenAI's domain-verification token as `text/plain` at
`/.well-known/openai-apps-challenge`; the route is absent when unset. Image-only
`gcloud run deploy` preserves it.

After separate owner approval for the additional recurring costs:

1. Create a global external HTTPS Application Load Balancer with a serverless NEG
   targeting the existing `tinytldr-mcp` service in `us-central1`. Keep its runtime
   identity, environment, isolated database/bucket and render/request limits.
2. Provision Google-managed TLS for the same hostname. Use DNS authorization if
   needed to stage the certificate before changing live routing; retrieve actual
   verification/address records rather than guessing them.
3. Validate the new frontend's certificate, discovery, protected routes, OAuth
   and real exports. Change only the `mcp` CNAME to the frontend's generated A
   record (and AAAA only if configured). Preserve root, mail and verification DNS.
4. Retain the Preview mapping through DNS propagation and until the new route is
   verified; then remove that old mapping, not the Cloud Run service or its data.

The hostname-based client configuration and Firebase sign-in remain the same.
DNS/certificate propagation still needs coordination; this is not a promise of
an instantaneous or zero-downtime switch. No load-balancer resources or costs have
been introduced for the upgrade now.

## Revision: Connect an Agent defaults to the hosted URL (2026-11-01)

- The footer "Docs" entry is now "MCP" and opens the Connect an Agent dialog. Documentation
  stays reachable through "Read the documentation" (no arrow) and the `/docs` routes.
- Connect an Agent shows `https://mcp.tinytldr.com/mcp` with Copy, plus hosted install commands:
  `claude mcp add --transport http tinytldr <url>`, `codex mcp add tinytldr --url <url>` and
  `{ "mcpServers": { "tinytldr": { "type": "http", "url": "<url>" } } }`. Local `npx` setup
  remains in the documentation Quickstart.
- Evidence: `GET https://mcp.tinytldr.com/health` returned 200 over HTTPS; protected-resource
  metadata lists the `mcp:render` scope; unauthenticated `POST /mcp` returned 401 with a
  `WWW-Authenticate` resource_metadata challenge. The CompactHeader, ConsistentDialogs and
  PersonalWorkspace browser suites passed 40/40 on the Auth/Firestore emulators.
- Still unverified: an official MCP client's real sign-in, tool call and export download
  through the hosted endpoint.
