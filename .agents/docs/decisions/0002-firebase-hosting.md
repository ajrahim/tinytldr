# ADR 0002: Firebase-only hosted deployment

- Status: Accepted by the owner for the fresh public repository.
- Owners: `website/`, `website/firebase/`, `mcp/`

## Decision

Use Firebase Hosting for `https://www.tinytldr.com`, Firebase Auth for accounts,
Firestore for protected design/version and encrypted AI metadata, and Firebase
HTTPS Functions for their trusted endpoints.

Chromium/FFmpeg require a container runtime; use Cloud Run for authenticated
website exports at `https://api.tinytldr.com`. Preserve the existing hosted MCP
endpoint `https://mcp.tinytldr.com/mcp` and OAuth issuer.

## Consequences

- Fresh installs only: one backend, current data contracts, no upgrade machinery.
- Local MCP/CLI rendering requires neither a Firebase account nor a database.
- Missing website configuration leaves local editing usable and reports online
  setup errors explicitly.
- Project IDs/web SDK settings are public configurable identifiers. Maintainer
  settings remain ignored; privileged credentials stay server-only.
- My Library stays on-device; authenticated render storage is not a synchronized
  cloud media-library feature.
- Domain provisioning, DNS/TLS, live deployment, and deleting existing cloud data
  are separate operator actions, not side effects of repository cleanup.

See [setup](../FirebaseBackend.md) and [the fresh-install specification](../../specs/FirebaseBackend.md).
