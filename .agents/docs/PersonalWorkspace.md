# Personal design workspace

The website is a creation workspace, not a template-sharing catalog.
[Firebase](./FirebaseBackend.md) is the only optional account/design backend.
Without configuration, local HTML/CSS/JSON editing, sandboxed preview, draft
recovery, and file downloads remain available.

## Designs and accounts

- `/` opens the workspace, `/local/<uuid>` a browser draft, and `/d/<uuid>` a
  persistent public design link. Anyone with a public link can view/copy its
  current document, not edit it without authorization.
- New design creates an account-owned cloud design immediately when signed in,
  opens its saved link, and needs no Claim. Guests still get a local draft.
  Later edits require Save; signing in alone does not claim existing guest drafts.
  Creation failures retain the current workspace and unfinished source, retries
  reuse the pending ID, and late responses cannot redirect after navigation or
  an account change.
- The sidebar combines account-owned designs and this browser's unclaimed
  designs. Claim saves a browser draft into the signed-in account or retires a
  saved design's guest edit key. Unsaved/invalid source is retained and errors
  are explicit.
- Rename changes only the title and records a version for saved designs.
  Delete requires confirmation and removes the design plus online versions.
  Owner/private-key and loaded revision checks protect mutations.
- Login uses Firebase email/password or Google. Account creation sends a
  verification email; Forgot password uses Firebase's reset workflow.
- Account & settings edits the optional display name (trimmed, at most 80
  characters), shows read-only email/verification status, and manages appearance,
  sign-out, and the optional [AI connection](./AiConnections.md).

Welcome, docs, account, AI settings, and media dialogs preserve the mounted
workspace. The footer links to Welcome, Docs, and
[GitHub](https://github.com/ajrahim/tinytldr), with Day/Night preferences.
There is no account/data deletion UI or email-changing UI.

## Current file and recovery format

External design files use `WorkspaceProject` version 2: 1–20 independently
authored artboards, each with its title, non-rendered purpose description,
template, data, theme, and overrides; dimensions are shared.
The renderer's per-artboard document helper is an internal composition detail,
not an accepted old-format import.

Draft recovery stores a current project and per-page raw JSON, including
unfinished edits. No single-page conversion, slot-schema recovery, old theme
rewrite, or stored-format upgrade is performed. Invalid formats fail explicitly
without overwriting browser data. Initial IndexedDB creation remains necessary
for a fresh installation.

The source editor's HTML/CSS/JSON columns retain unfinished source and undo state
when hidden. Switching artboards retains each page's raw JSON. Validation errors
block saves/exports but not recovery. Live preview and server rendering reuse
the same compiler and sandbox policy.

## Exports and My Library

HTML/JSON downloads are local. Binary exports use the configured renderer:
authenticated Firebase-backed hosted API for production, optional loopback
renderer for development. Chromium and FFmpeg remain the rendering pipeline.
No service secret is embedded in the website.

My Library atomically retains actual file/poster blobs and validated metadata in
this device's IndexedDB. It is not synchronized to the account, and browser
storage removal deletes its contents. Upload storage limits, malformed-record
errors, selection, download, and deletion remain explicit.
Local MCP tools do not automatically read website links or populate My Library.

## Verification

Use the [Firebase emulator gate](./FirebaseBackend.md#verification), including
browser tests for account settings, save/claim/conflicts, version history,
artboards, media, and optional AI. Source configuration does not prove a live
deployment, Google popup access, DNS, or external provider availability.
