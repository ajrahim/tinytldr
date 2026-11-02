# Running and hosting tinytldr

The source is MIT licensed; bundled fonts retain their OFL notices.
Node 22+, Playwright Chromium, and external FFmpeg provide deterministic rendering.
Local MCP/CLI need no account or database. The hosted website uses Firebase only.

## 1. Local stdio MCP

```powershell
npx -y tinytldr doctor
npx -y tinytldr mcp
```

## 2. Local HTTP renderer

```powershell
npx -y tinytldr serve --host 127.0.0.1 --port 8787
```

The local server provides `/health`, `/mcp`, `/v1/templates`,
`/v1/templates/:id`, `/v1/validate`, `/v1/preview`, `/v1/render`,
`/v1/jobs/:id`, and `/v1/assets/:filename`. Optional `TINYTLDR_API_KEY`
protects local self-hosted requests; never place it in a browser environment.
Do not expose an unauthenticated local renderer publicly.

Set `VITE_TINYTLDR_API_URL=http://127.0.0.1:8787` for development exports.
Local MCP/CLI rendering requests need no account. Website binary exports require
sign-in and the Firebase media function, including when using the local renderer,
so My Library is persistent. HTML/JSON downloads remain local and account-free.
Production website rendering uses the Firebase-authenticated API described below,
not a browser-embedded shared key.

Current requests/results are defined in
[RenderedMedia](../../packages/core/src/RenderedMedia.ts). Projects use version 2.
Images/videos return all page outputs in order; PDF returns one multipage file.
Results include actual assets, a small PNG preview, dimensions, and warnings.
The website retains library files and thumbnails in private Firebase Storage,
with account-scoped metadata in Firestore.
Unavailable FFmpeg produces an explicit MP4 error.

## 3. Local container

```powershell
docker build -t tinytldr:latest .
docker run --rm -p 127.0.0.1:8787:8787 tinytldr:latest
```

The image installs FFmpeg as an external program. No GPL/LGPL FFmpeg library is
linked into the MIT packages. Preserve the accompanying binary/font notices.

## 4. Firebase deployment architecture

- **https://www.tinytldr.com**: Firebase Hosting static website and function rewrites.
- **https://api.tinytldr.com**: Firebase-authenticated render API backed by a
  Chromium/FFmpeg Cloud Run container with bounded work and private artifacts.
- **https://mcp.tinytldr.com/mcp**: existing hosted OAuth MCP endpoint, unchanged.
- Firebase Auth, Firestore, Storage, Functions, and Secret Manager own account/design/media/AI
  boundaries. [Setup](./FirebaseBackend.md) and [AI credentials](./AiConnections.md)
  describe the required project configuration.

The API and MCP are distinct services. Do not repoint the MCP issuer, run the
local unauthenticated REST server as a production API, or expose an AI key.
Hosted exports require a current Firebase user token.
Returned artifact URLs also require that owner's token; the browser fetches
blobs before retaining files in My Library. They are not transferable public
links. The client rejects artifact URLs outside the configured API origin.

## 5. Hosted deployment configuration

Maintainers keep their project identifiers in git-ignored files:

| File                                 | Purpose                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `.hosted/hosted.env`                 | Public project/web settings, from [the template](../../.hosted.example/hosted.env) |
| `website/firebase/.env.<project-id>` | Exact allowed origins and server environment                                       |
| `website/.env.local`                 | Local website configuration, from [the example](../../website/.env.example)        |

Use your own Firebase project and register a web app. Configure password/Google
Auth, authorized hosts, billing, Firestore, exact HTTPS origins, and any required
Secret Manager binding. The committed demo default cannot deploy to production.

`pnpm deploy:hosted api` builds/deploys the separate API container first;
`pnpm deploy:hosted` then deploys Firebase Hosting, functions, Firestore and Storage rules with
the explicitly selected project from the ignored configuration.
[Firebase configuration](../../firebase.json) defines Hosting and Functions.
The [API Dockerfile](../../Dockerfile.Api) and
[Cloud Build configuration](../../cloudbuild.api.yaml) define that container.
Provision an API-only private bucket and runtime service account for the selected
project: Firebase Auth user verification, Firestore transactions, and bucket
object create/get/delete access. Keep the bucket nonpublic and configure a
lifecycle deletion policy (for example one day). API access expires after five
minutes independently of physical bucket cleanup.
Configure a separate persistent Firebase Storage bucket in the function
environment as `TINYTLDR_FIREBASE_STORAGE_BUCKET`, and set the website's
`VITE_TINYTLDR_FIREBASE_MEDIA_URL` (`/api/media` on Hosting). The media function's
runtime identity needs object create/get/list/delete access to that bucket.
It must remain nonpublic and must not inherit the temporary bucket's deletion
lifecycle. Uploads and rendered exports remain in the account until deleted.
The [Firestore configuration](../../website/firebase/firestore.indexes.json)
declares TTL on `websiteRenderLimits.ttlAt` to expire distributed rate records.
No bucket signing key is needed for website API downloads.

Firebase project IDs, web SDK API keys, app IDs, and auth domains are public
configuration. Service-account keys, AI/provider credentials, signing keys,
and shared local API secrets never belong in those templates or `VITE_*`.

Connect custom domains and verify DNS/TLS separately. Committing these files
does not deploy services, change DNS, delete existing data, or validate live
provider billing. Run [the emulator gate](./FirebaseBackend.md#verification)
and workspace builds before deployment; perform live auth/origin/export/MCP
smoke tests after an explicitly approved deployment.
