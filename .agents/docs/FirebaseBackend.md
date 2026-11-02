# Firebase hosting, accounts, and designs

Firebase is the only hosted backend. This repository targets fresh installations;
there is no backend selector, imported-database upgrade, or credential conversion.
Local template editing, preview, HTML/JSON downloads, and browser drafts work
without configuring an account service.

## Public deployment configuration

- Website: **https://www.tinytldr.com**, served by Firebase Hosting.
- Authenticated rendering API: **https://api.tinytldr.com**.
- MCP: **https://mcp.tinytldr.com/mcp**, with its existing OAuth issuer unchanged.
- Firestore and HTTPS Functions store and authorize designs and optional AI connections.
- Cloud Run runs Chromium/FFmpeg for rendering. It is not replaced by a browser
  renderer or a long-running Cloud Function.

Custom domains must be connected and their DNS/TLS verified by the operator.
Source configuration alone does not provision domain ownership or DNS records.
See [self-hosting](./self-host.md) for deployment entrypoints.

Copy [the environment example](../../website/.env.example) to an ignored website
environment file. Register your own Firebase web app, enable Email/Password and
Google sign-in, and add your website hosts to Auth authorized domains (hosts
only, no scheme or port). Add localhost explicitly for development.
Firebase web SDK values and project IDs are public identifiers, not credentials.
Never put server keys, service-account JSON, provider keys, or the AI encryption
key in `VITE_*`.

The login dialog offers email/password, account creation, verification email,
password reset, and Google sign-in. There is no email-link login implementation.
Auth return paths are restricted to the same website origin.

## Server configuration

Use an operator-owned Firebase project with Blaze billing and a default
Firestore database. Copy [the function environment example](../../website/firebase/.env.example)
to your project-specific file. Set `TINYTLDR_ALLOWED_ORIGINS` in ignored
`website/firebase/.env.<project-id>` to exact comma-separated origins, including
scheme and development ports, without trailing slashes. Include
`https://www.tinytldr.com` for the maintained deployment.

Functions run in `us-central1` with zero minimum instances and bounded scaling.
Those bounds do not guarantee zero charges. The build bundles shared contracts
into a deployable package and copies the selected project's environment file.
Use [the configuration](../../firebase.json) for deployment targets.

The committed [.firebaserc](../../.firebaserc) defaults to `demo-tinytldr`.
Real deployments must select their project explicitly. Maintainers keep public
project settings in ignored `.hosted/hosted.env`, using
[the template](../../.hosted.example/hosted.env), then run `pnpm deploy:hosted`.
Privileged credentials stay in application default credentials/Secret Manager.

## Data and authorization

[Firestore rules](../../website/firebase/firestore.rules) deny all direct client
access. Trusted services verify Firebase ID tokens and authorize every mutation.
Public design links expose only the current document, not private edit keys,
credential hashes, owner-private versions, or AI settings.

Designs use current version-2 projects with independent artboards and a shared
size. Owner authentication or a private guest edit key protects edits; revisions
prevent overwriting concurrent changes. Claiming retires the guest key.
Rename records an immutable snapshot. Delete writes an authorization tombstone
and recursively removes versions before reporting success; failed cleanup is
explicit and retryable. Late requests cannot recreate deleted content.

AI is separately configured; see [AI connections](./AiConnections.md).

## Persistent media

My Library image uploads and rendered image/video/PDF exports use private
Firebase Storage, with account-scoped Firestore metadata and a transactional
100 MB uploads quota. The `media` HTTPS function authorizes list, upload, read and
delete operations using Firebase ID tokens. Originals and thumbnails stay in the
account until deleted; opening a fresh browser does not lose them. Source-file
HTML/JSON downloads and text prompt attachments are not library entries.

Enable Cloud Storage for Firebase in your own project and configure
`TINYTLDR_FIREBASE_STORAGE_BUCKET` in the ignored function environment file
(for example `your-project-id.firebasestorage.app`, or your project's existing
`appspot.com` bucket). Grant the function runtime identity object
create/get/list/delete access to that bucket only, and the existing Firestore
transaction permissions. No service-account key or public bucket access is needed.
[Storage rules](../../website/firebase/storage.rules) deny direct access; authenticated
function responses carry private file bytes, not transferable download tokens.

Set `VITE_TINYTLDR_FIREBASE_MEDIA_URL` to the deployed media function, or use
`/api/media` with Firebase Hosting. The hosted deployment helper builds that
same-origin default and deploys Storage rules. This public URL is not a secret.
There is no browser-file migration or local-media fallback. Unconfigured or
failed storage produces an explicit error. Staged uploads remain invisible and
are removed on cancellation; expired ten-minute reservations are cleaned on the
owner's next library access. The Auth deletion trigger removes that account's
media and library metadata, retaining an account-deletion marker to block late
requests from recreating files.

Keep the persistent Firebase bucket separate from the API-only temporary render
bucket and its lifecycle. Never apply the latter's one-day deletion policy to the
library. Storage capacity, operations, Functions, and downloads incur normal
Firebase/Google Cloud usage charges; emulator checks do not deploy resources.

## Verification

```powershell
npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm check"
pnpm build
```

Use real Auth/Firestore/Storage emulators for integration and browser evidence.
An ordinary test run with emulator suites skipped does not verify transactions.
Do not point tests at a real project or delete production data.
Live deployment, DNS/TLS, provider billing, and real Google popup behavior require
separate operator smoke tests.
