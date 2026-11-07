import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownToLine, LoaderCircle, Trash2 } from "lucide-react";
import type { MediaLibraryItem } from "@tinytldr/core";
import {
  deleteMedia,
  formatBytes,
  readMediaLibrary,
  UPLOAD_CAPACITY_BYTES,
  uploadBytes,
} from "../lib/MediaLibrary.js";
import { useMediaBlob } from "../hooks/useMediaBlob.js";
import { useObjectUrl } from "../hooks/useObjectUrl.js";
import { DropdownSelect } from "./DropdownSelect.js";
import { Dialog } from "./Dialog.js";

function MediaCard({
  media,
  userId,
  onOpen,
  onDelete,
  onError,
}: {
  media: MediaLibraryItem;
  userId: string;
  onOpen: () => void;
  onDelete: () => void;
  onError: (message: string) => void;
}) {
  const { blob, error } = useMediaBlob(media, "poster", userId);
  const posterUrl = useObjectUrl(blob);
  const reportError = useRef(onError);
  reportError.current = onError;
  useEffect(() => {
    if (error) reportError.current(error);
  }, [error]);
  return (
    <div className="media-card">
      <button
        className="media-card-open"
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${media.metadata.title}`}
      >
        <span className="media-thumbnail">
          {posterUrl && (
            <img
              src={posterUrl}
              alt=""
              loading="lazy"
              onError={() =>
                onError("A thumbnail could not be displayed. Retry opening My Library.")
              }
            />
          )}
        </span>
        <span className="media-caption">
          <span>{media.metadata.title}</span>
          <small>{media.metadata.format.toUpperCase()}</small>
        </span>
      </button>
      <button
        className="media-card-delete"
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${media.metadata.title}`}
        title="Delete"
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function DeleteMediaDialog({
  media,
  userId,
  onCancel,
  onDeleted,
}: {
  media: MediaLibraryItem;
  userId: string;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const remove = () => {
    setBusy(true);
    setError(null);
    deleteMedia(media.metadata.id, userId)
      .then(onDeleted)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      });
  };
  return (
    <Dialog
      title="Delete file?"
      description="Permanently remove this file from your account library on all devices."
      closeLabel="Close delete confirmation"
      size="compact"
      initialFocus={cancel}
      closeDisabled={busy}
      onClose={onCancel}
      footer={
        <>
          <button
            ref={cancel}
            type="button"
            className="dialog-secondary-button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={remove}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Deleting..." : "Delete permanently"}
          </button>
        </>
      }
    >
      <p>{media.metadata.title}</p>
      {error && (
        <p role="alert" className="notice-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function MediaPreview({
  media,
  userId,
  onClose,
}: {
  media: MediaLibraryItem;
  userId: string;
  onClose: () => void;
}) {
  const { blob, error: downloadError } = useMediaBlob(media, "file", userId);
  const fileUrl = useObjectUrl(blob);
  const [error, setError] = useState<string | null>(null);
  const { metadata } = media;
  const unreadable = () =>
    setError("This browser could not preview the file. You can still download the original below.");
  return (
    <Dialog
      className="media-preview"
      size="media"
      ariaLabel={`Preview: ${metadata.title}`}
      title={metadata.title}
      description={
        <>
          {metadata.format.toUpperCase()} &middot; {metadata.width} &times; {metadata.height}
          {metadata.pageCount
            ? ` · ${metadata.pageCount} ${metadata.pageCount === 1 ? "page" : "pages"}`
            : ""}
        </>
      }
      closeLabel="Close preview"
      onClose={onClose}
      footer={
        <>
          <span className="app-dialog-footer-note">Saved to your account</span>
          {fileUrl && (
            <a className="primary-button" href={fileUrl} download={metadata.filename}>
              <ArrowDownToLine size={14} aria-hidden="true" /> Download
            </a>
          )}
        </>
      }
    >
      {(error || downloadError) && (
        <p role="alert" className="notice-error">
          {error ?? downloadError}
        </p>
      )}
      <div className="media-preview-content">
        {fileUrl &&
          (metadata.format === "mp4" ? (
            <video
              src={fileUrl}
              controls
              playsInline
              aria-label="Video preview"
              onError={unreadable}
            />
          ) : metadata.format === "pdf" ? (
            <iframe src={fileUrl} title="PDF preview" />
          ) : (
            <img src={fileUrl} alt={metadata.title} onError={unreadable} />
          ))}
      </div>
    </Dialog>
  );
}

const SOURCES = [
  { value: "all", label: "Everything" },
  { value: "upload", label: "Uploads" },
  { value: "export", label: "Exports" },
] as const;
const EMPTY_COPY = {
  all: {
    title: "A little room for your finished work.",
    body: "Export an image, PDF, or video, or attach an image to a prompt. Your files will appear here, saved to your account.",
  },
  upload: {
    title: "No uploads yet.",
    body: "Images you attach to a prompt are saved here in your account, ready to reuse.",
  },
  export: {
    title: "No exports yet.",
    body: "Export an image, PDF, or video from a design. Your files will appear here, saved to your account.",
  },
};

export function MediaLibrary({ onBack, userId }: { onBack: () => void; userId: string | null }) {
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<(typeof SOURCES)[number]["value"]>("all");
  const [filter, setFilter] = useState("all");
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaLibraryItem | null>(null);
  const [deleting, setDeleting] = useState<MediaLibraryItem | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("tinytldr:media-saved", refresh);
    return () => window.removeEventListener("tinytldr:media-saved", refresh);
  }, []);
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    setThumbnailError(null);
    void readMediaLibrary(userId, controller.signal)
      .then((media) => {
        if (active) setItems(media);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [revision, userId]);
  const scoped = items.filter((media) => source === "all" || media.source === source);
  const visible = scoped.filter(
    ({ metadata }) =>
      filter === "all" ||
      (filter === "images"
        ? !["mp4", "pdf"].includes(metadata.format)
        : metadata.format === filter),
  );
  const empty = EMPTY_COPY[source];
  const used = uploadBytes(items);
  const usedRatio = Math.min(1, used / UPLOAD_CAPACITY_BYTES);
  const capacityId = useId();
  return (
    <section className="media-library" aria-label="My Library">
      <div className="media-library-toolbar">
        <div className="media-library-sources" role="group" aria-label="Library source">
          {SOURCES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={source === option.value}
              onClick={() => setSource(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <DropdownSelect
          label="Library file type"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All files" },
            { value: "images", label: "Images" },
            { value: "mp4", label: "Videos" },
            { value: "pdf", label: "PDFs" },
          ]}
        />
      </div>
      {(error || thumbnailError) && (
        <div className="media-library-error">
          <p role="alert">{error ?? thumbnailError}</p>
          <button
            type="button"
            className="text-link"
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <div className="media-library-loading" role="status">
          <LoaderCircle
            size={24}
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span className="sr-only">Opening your library...</span>
        </div>
      ) : (
        !error &&
        (visible.length && userId ? (
          <div className="media-grid">
            {visible.map((media) => (
              <MediaCard
                key={media.metadata.id}
                media={media}
                userId={userId}
                onOpen={() => setSelected(media)}
                onDelete={() => setDeleting(media)}
                onError={setThumbnailError}
              />
            ))}
          </div>
        ) : (
          <div className="media-library-empty">
            <h2>
              {!userId
                ? "Sign in to open your library."
                : scoped.length
                  ? "Nothing here yet."
                  : empty.title}
            </h2>
            <p>
              {!userId
                ? "Your uploads and exports are stored privately in your account."
                : scoped.length
                  ? "Try another file type."
                  : empty.body}
            </p>
            {!scoped.length && (
              <button type="button" className="text-link" onClick={onBack}>
                Back to your design
              </button>
            )}
          </div>
        ))
      )}
      {!error && userId && (
        <div className={`media-capacity ${usedRatio >= 0.9 ? "is-near-full" : ""}`}>
          <span id={capacityId}>Upload storage</span>
          <div
            className="media-capacity-track"
            role="meter"
            aria-labelledby={capacityId}
            aria-valuemin={0}
            aria-valuemax={UPLOAD_CAPACITY_BYTES}
            aria-valuenow={used}
            aria-valuetext={`${formatBytes(used)} of ${formatBytes(UPLOAD_CAPACITY_BYTES)} used`}
          >
            <div
              className="media-capacity-fill"
              style={{ width: `${Math.max(used ? 1 : 0, usedRatio * 100)}%` }}
            />
          </div>
          <span className="media-capacity-label">
            {formatBytes(used)} of {formatBytes(UPLOAD_CAPACITY_BYTES)}
          </span>
        </div>
      )}
      {selected && userId && (
        <MediaPreview media={selected} userId={userId} onClose={() => setSelected(null)} />
      )}
      {deleting && userId && (
        <DeleteMediaDialog
          media={deleting}
          userId={userId}
          onCancel={() => setDeleting(null)}
          onDeleted={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
