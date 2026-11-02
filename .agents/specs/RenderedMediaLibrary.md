# Rendered media library

Status: Shipped (Firebase Storage revision; earlier local-only behavior is superseded)

## Approved scope

- The sidebar starts with New design and My Library, followed by Designs.
- A simple Connect an Agent card sits immediately above the bottom account card.
- Account/sign-in controls live in that bottom card, not the toolbar.
- My Library replaces the main pane, retaining the sidebar and mounted, unsaved editor.
- A clean grid holds actual tinytldr-rendered images, videos, and PDFs; click to preview or download.
- Rendered exports and prompt reference images are included. The approved Firebase Storage revision below replaces device-only persistence.

## Implementation

- Shared Zod contracts describe document export requests, complete output lists, and retained media.
- The existing REST render endpoint and Chromium/FFmpeg pipeline accept full validated personal documents, including current HTML/Liquid, CSS, data, size, theme, and token overrides.
- Browser and server personal templates use the same sanitization policy and nonce-authorized runtime. Server compilation embeds bundled fonts and keeps remote requests blocked. WebP conversion decodes screenshot bytes directly rather than fetching a data URI, preserving the strict `connect-src 'none'` policy.
- PNG/JPEG/WebP, PDF, and MP4 export actions live in the existing More dropdown. HTML and JSON remain source downloads, not rendered-media library entries.
- Actual files and posters are retained in private Firebase Storage; Firestore owns account-scoped metadata and quota reservations. Only fully uploaded batches become visible atomically. Object URLs exist only while a grid or preview is mounted.
- Storage and rendering failures are explicit. Unavailable storage does not become a pretend library; a failed multi-file save must not retain a partial batch.
- Media stays in the signed-in account across browsers. No browser-media migration, device-only fallback, or public bucket download tokens.

## Original acceptance evidence

- `pnpm -r build` passed for every workspace.
- `pnpm check` passed: formatting, ESLint, workspace TypeScript checks, all 8 MIT manifests / 146 permissive production dependencies, and **98 tests across 14 suites**.
- [Media browser integration tests](../../website/test/MediaLibraryBrowser.test.ts) use the actual HTTP server and Chromium/FFmpeg renderer. They verify custom HTML/CSS/token fidelity, PNG dimensions and pixel color, JPEG/WebP signatures and 512px thumbnails, single/multi-page PDF dimensions, original download bytes, and H.264/yuv420p 30fps MP4 output.
- Tests cover retained files after reload, type filtering, native image/video/PDF previews, modal focus restoration, object-URL revocation, every carousel image, malformed personal requests, renderer failures, missing configuration, unavailable/corrupt storage, and atomic rollback when the second file exceeds quota.
- Responsive checks cover 320, 390, 768, and 1440px in both themes. Existing account, guest recovery, claiming, starter previews, and combined-header regressions remain green.
- Visually inspected the desktop dark editor/library and mobile light library, image preview, and sidebar, including bottom agent/account placement.

## Revision: Source toggle and uploads

Approved scope:

- The toolbar starts with a three-option source toggle, **Everything**, **Uploads** and **Exports**, followed by a gap and the existing **All files** type dropdown on the same row at every width.
- Uploads are PNG/JPEG/WebP reference images attached to the AI composer, deduplicated by SHA-256 per account. The Firebase revision supersedes the original IndexedDB storage.
- An unreadable image raises a visible error but stays attached to the prompt. Non-image attachments are not saved.
- The "Rendered exports · On this device" label and the arrow on "Back to your design" are removed. Each source has its own centered empty state; an empty type filter inside a non-empty source shows "Nothing here yet."
- Reusing uploads as template logos or images is a future follow-up, not part of this revision.

Evidence:

- [Media library tests](../../website/test/MediaLibraryBrowser.test.ts) cover toggle labels and pressed state, per-source centered empty states at 1440 and 320px, a single-row toolbar with flush left/right edges and no horizontal overflow, the arrowless back button, broken-image errors that keep the chip attached, duplicate-free saving (one save, then two), stored upload metadata (source, format, 4×3 dimensions, design path, bytes), Everything/Uploads/Exports counts with an export present, the filtered-empty state, persistence after reload and original download filenames.
- Website typecheck passes. Real-emulator `pnpm check` passed **323 tests / 41 suites** with formatting, lint, type and license gates (**9 MIT / 312 permissive dependencies**); all workspace builds pass.

## Revision: Upload capacity, delete and sign-in gate

- Uploads have a fixed **100 MB** per-account limit. A meter under the source toggle shows used versus total, turning red at 90%. Saves that would exceed the limit are refused with a visible error, and the file stays attached to the prompt.
- Cards have a hover/focus trash button (always visible on touch) with a "Delete file?" confirmation. The header back arrow is removed; the sidebar My Library button toggles back to the design.
- "Attach image or text file" in the composer is disabled until the user signs in.
- Evidence: website typecheck; focused media library and composer browser suites (15 tests) pass, including meter max/value against stored upload bytes.

## Revision: Firebase Storage account library

Approved scope:

- Store existing My Library image uploads and rendered image/video/PDF exports,
  including thumbnails, in a configured Firebase Storage bucket until deleted.
  Firestore stores metadata, ownership, digest deduplication and upload usage,
  never base64 file contents. HTML/JSON downloads and text attachments are unchanged.
- The authenticated media function owns all operations. Direct Firestore/Storage
  access is denied. Account switches discard library/preview state and abort
  stale reads; original files load only when previewed or downloaded.
- Reserve upload capacity transactionally; enforce the exact 100 MB ceiling
  across devices and simultaneous requests. Pending batches stay invisible.
  Failed batches cancel and remove their files; ambiguous retries are idempotent.
  Reservations expire after ten minutes and are cleaned on the owner's next
  library read/upload. Cleanup failures are reported and retryable.
- Preserve the existing layout, source/type filters, thumbnails, previews,
  downloads, delete confirmation and capacity meter. No CSS changes, old-file
  conversion, browser-media import, MCP changes or live deployment.
- Temporary Cloud Run render outputs remain temporary. They are distinct from
  the persistent library bucket; its files must not inherit render-artifact
  expiry or a whole-bucket deletion lifecycle.

Acceptance evidence:

- `npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm check"`
  passed **354 tests / 44 suites**, with no skips, formatting, zero-warning ESLint,
  all workspace typechecks, and **9 MIT manifests / 304 permissive production
  dependencies**. `pnpm build` passed every workspace.
- [Media service tests](../../website/firebase/test/MediaService.test.ts) passed
  eight real-emulator checks for exact stored bytes, durable reads beyond temporary
  export expiry, quota concurrency, deduplication, partial-batch rollback,
  deletion, account-deletion tombstones and denied direct access.
- [HTTP entry tests](../../website/firebase/test/HttpEntry.test.ts) passed ten
  checks, including byte-exact binary responses and the media account-deletion
  trigger. Browser fixtures use this same production HTTP adapter.
- [Media browser tests](../../website/test/MediaLibraryBrowser.test.ts) passed ten
  checks, preserving real image/PDF/video assertions and verifying fresh-browser
  persistence, account isolation, preview clearing, cross-device deletion,
  explicit cloud failures, filters and responsive layout.
- Non-fatal Firebase emulator/SDK warnings and the existing Vite chunk-size
  advisory remain. No CSS changes, live deployment, production cloud-data changes,
  or paid provider calls were made.
