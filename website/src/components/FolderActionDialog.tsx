import { useId, useRef, useState } from "react";
import { DesignFolderNameSchema, type DesignFolder } from "@tinytldr/core";
import type { DesignListTarget } from "../lib/DesignRepository.js";
import { Dialog } from "./Dialog.js";

export type FolderAction =
  | { kind: "rename"; folder: DesignFolder }
  | { kind: "delete"; folder: DesignFolder }
  | { kind: "move"; target: DesignListTarget; folderId: string | null };

const COPY = {
  rename: { title: "Rename folder", submit: "Rename", working: "Renaming..." },
  delete: { title: "Delete folder?", submit: "Delete folder", working: "Deleting..." },
  move: { title: "Move to folder", submit: "Move", working: "Moving..." },
} as const;

export function FolderActionDialog({
  action,
  folders,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  action: FolderAction;
  folders: readonly DesignFolder[];
  busy: boolean;
  error: string | null;
  /** Receives the new folder name (rename) or destination folder ID, "" meaning All (move). */
  onConfirm: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(
    action.kind === "move" ? (action.folderId ?? "") : action.folder.name,
  );
  const field = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const copy = COPY[action.kind];
  const valid =
    action.kind === "rename"
      ? DesignFolderNameSchema.safeParse(value).success
      : action.kind === "move"
        ? value !== (action.folderId ?? "")
        : true;
  return (
    <Dialog
      title={copy.title}
      closeLabel={`Close ${copy.title.toLowerCase().replace("?", "")}`}
      size="compact"
      initialFocus={action.kind === "delete" ? cancel : field}
      closeDisabled={busy}
      onClose={onClose}
      description={
        action.kind === "delete"
          ? "Designs in this folder stay in All. Only the folder is removed."
          : action.kind === "move"
            ? "Every account design stays in All. A design can be in one folder at a time."
            : "Folder names are visible only to you."
      }
      footer={
        <>
          <button
            ref={cancel}
            type="button"
            className="dialog-secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="primary-button"
            disabled={busy || !valid}
            aria-busy={busy}
          >
            {busy ? copy.working : copy.submit}
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && valid) void onConfirm(value);
        }}
      >
        {action.kind === "delete" && <p>{action.folder.name}</p>}
        {action.kind === "rename" && (
          <label>
            Folder name
            <input
              ref={field}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={60}
              required
              disabled={busy}
            />
          </label>
        )}
        {action.kind === "move" && (
          <>
            <p>{action.target.title}</p>
            <label>
              Folder
              <select
                ref={field}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={busy}
              >
                <option value="">All (no folder)</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="notice-error">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
