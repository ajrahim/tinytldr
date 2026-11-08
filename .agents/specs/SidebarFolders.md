# Sidebar folders, search and Local

Status: Shipped

## Approved scope

Restructure the Designs sidebar and stop saving untouched windows:

- A new window (`/`, or a starter template link) opens a fresh project without
  writing it to browser history. It appears in **Local** only after the first real
  edit, or after an explicit save, and then autosaves as before. Explicit
  **New design** while signed in still creates an account design.
- The **This browser** section is renamed **Local**.
- The sidebar order is: a search field with a leading icon, **+ Create Folder**,
  **All**, the custom folders, then **Local**.
- Folders belong to the signed-in account and sync across devices. **All** lists
  every account design. A design can be in at most one custom folder.
- Account rows can be dragged onto a folder (move) or onto **All** (remove from
  folders). Local rows are not draggable, and Local is not a drop target. A
  **Move to folder…** row-menu item is the keyboard and touch alternative.
- Folders can be renamed or deleted from their row menu. Deleting a folder never
  deletes its designs.
- Search filters All, the folders and Local by title. Folders with no match are
  hidden while searching.
- Signed-out visitors see only Search and Local.
- Section headings are self-explanatory. All and Local have no info tooltips, and
  the unused `InfoTooltip` component is removed.

## Design

- Shared schemas live in `packages/core/src/FirebaseDesigns.ts`:
  - `DesignFolderSchema`, with a name of 1–60 characters, up to 500 design IDs, and
    at most 100 folders per account;
  - the actions `folders`, `createFolder`, `renameFolder`, `deleteFolder` and
    `moveToFolder` (where `folderId: null` means All only).
- The trusted `DesignService` stores the `design_folders/{id}` documents with an
  `owner_id`. Client Firestore rules still deny direct access.
  - `moveToFolder` is a transaction. It checks that the caller owns the design,
    removes the design from every folder, and prepends it to the target folder.
  - `createFolder` is idempotent for retries that reuse the client-generated ID.
  - Deleting a design removes its ID from the owner's folders.
  - Filing a design never changes the design record, its revisions or its versions.
- Folder queries use only `owner_id ==` and filter in memory, so no composite index
  is required.
- On the client:
  - `useDesignFolders` loads folders with the account library and applies the
    server's results;
  - `FolderActionDialog` handles rename, delete and move;
  - `useDesignWorkspace` keeps a pristine baseline for fresh windows and skips
    `remember()` until the content differs or the draft is saved.

## Exclusions

There are no nested folders, no folders for Local drafts, no MCP folder tools, no
folder sharing, no telemetry and no new dependencies.

## Acceptance evidence

- **Service:** `DesignService.test.ts` covers signed-out 401s, idempotent creation,
  sort order, privacy across accounts (403), moves between folders and back to All,
  and 404s for missing folders. It also covers:
  - guest (unclaimed) designs being rejected;
  - filing that never adds a revision;
  - deleting a design removing it from its folder;
  - deleting a folder keeping its designs.
- **Browser:** `SidebarFoldersBrowser.test.ts` checks at 1440px:
  - the Search → Create Folder → All → folders → Local order;
  - Escape and Enter in the folder name field;
  - dragging into a folder and back to All, with persistence across a reload;
  - Move to folder…, search filtering, rename and delete;
  - Local rows staying non-draggable and Local rejecting drops.

  At 390px with touch, it checks that the search field, folders and menus fit the
  drawer without horizontal overflow.

- **Updated tests** prove that a fresh window leaves `localStorage` empty until the
  first edit (Personal workspace, New cloud designs, Media library) and use the
  Local/All labels.
- **Full gate:** see `.agents/memory-bank/CurrentState.md`.
