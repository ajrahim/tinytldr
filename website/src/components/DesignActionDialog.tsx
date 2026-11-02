import { useId, useRef, useState } from "react";
import { DesignTitleSchema } from "@tinytldr/core";
import type { DesignListTarget } from "../lib/DesignRepository.js";
import { Dialog } from "./Dialog.js";

export function DesignActionDialog({
  action,
  target,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  action: "rename" | "delete";
  target: DesignListTarget;
  busy: boolean;
  error: string | null;
  onConfirm: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(target.title);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const deleting = action === "delete";
  const validTitle = DesignTitleSchema.safeParse(title);
  return (
    <Dialog
      title={deleting ? "Delete design?" : "Rename design"}
      closeLabel={deleting ? "Close delete confirmation" : "Close rename"}
      size="compact"
      initialFocus={deleting ? cancel : input}
      closeDisabled={busy}
      onClose={onClose}
      description={
        deleting
          ? target.saved
            ? "Permanently delete this design and all saved versions. Its public link will stop working."
            : "Permanently remove this draft from this browser."
          : "Change the title without saving other editor changes."
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
            disabled={busy || (!deleting && !validTitle.success)}
            aria-busy={busy}
          >
            {busy
              ? deleting
                ? "Deleting..."
                : "Renaming..."
              : deleting
                ? "Delete permanently"
                : "Rename"}
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && (deleting || validTitle.success)) void onConfirm(title);
        }}
      >
        {deleting ? (
          <p>{target.title}</p>
        ) : (
          <label>
            Design name
            <input
              ref={input}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
              disabled={busy}
            />
          </label>
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
