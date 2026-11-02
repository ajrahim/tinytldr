import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, History } from "lucide-react";
import type { DesignVersionPage } from "@tinytldr/core";

export function VersionHistoryMenu(props: {
  disabled: boolean;
  hasRecord: boolean;
  canRead: boolean;
  revision?: number;
  selected: "latest" | number;
  onLoad: (before?: number) => Promise<DesignVersionPage>;
  onSelect: (revision: "latest" | number) => Promise<boolean>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const [position, setPosition] = useState({ top: 48, right: 8 });
  const [page, setPage] = useState<DesignVersionPage>({ versions: [], next_before: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label =
    props.selected === "latest" ? "Latest" : `Version ${props.selected} (editable draft)`;
  const positionMenu = useCallback(() => {
    const bounds = trigger.current?.getBoundingClientRect();
    const width = popover.current?.getBoundingClientRect().width ?? 0;
    if (bounds)
      setPosition({
        top: bounds.bottom + 8,
        right: Math.max(
          8,
          Math.min(window.innerWidth - bounds.right, window.innerWidth - width - 8),
        ),
      });
  }, []);
  useEffect(() => {
    const resize = () => {
      if (popover.current?.matches(":popover-open")) positionMenu();
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      request.current++;
    };
  }, [positionMenu]);

  const load = async (before?: number) => {
    const token = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await props.onLoad(before);
      if (token === request.current)
        setPage((previous) => ({
          versions: before ? [...previous.versions, ...result.versions] : result.versions,
          next_before: result.next_before,
        }));
    } catch (err) {
      if (token === request.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (token === request.current) setLoading(false);
    }
  };
  const select = async (revision: "latest" | number) => {
    if (await props.onSelect(revision)) {
      popover.current?.hidePopover();
      trigger.current?.focus();
    }
  };

  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="header-icon-button header-labeled-button version-history-trigger"
        aria-label="Versions"
        aria-describedby={`${id}-selection`}
        title={`Versions: ${label}`}
        aria-haspopup="dialog"
        aria-controls={id}
        popoverTarget={id}
        disabled={props.disabled}
        data-historical={props.selected !== "latest" || undefined}
        onClick={positionMenu}
      >
        <History size={17} aria-hidden="true" />
        <span className="header-action-label" aria-hidden="true">
          {props.selected === "latest" ? "Latest" : `Version ${props.selected}`}
        </span>
        <span className="sr-only" id={`${id}-selection`}>
          {label}
        </span>
      </button>
      <div
        ref={popover}
        id={id}
        popover="auto"
        className="dropdown-panel version-history-popover"
        role="dialog"
        aria-label="Saved versions"
        style={position}
        onToggle={(event) => {
          if (event.currentTarget.matches(":popover-open")) {
            positionMenu();
            event.currentTarget.querySelector("button")?.focus();
            setPage({ versions: [], next_before: null });
            setError(null);
            if (props.canRead) void load();
          } else {
            request.current++;
            setLoading(false);
          }
        }}
      >
        <p className="dropdown-heading">Saved versions</p>
        <button
          type="button"
          className="dropdown-item"
          aria-current={props.selected === "latest" ? "true" : undefined}
          disabled={props.disabled}
          onClick={() => void select("latest")}
        >
          <span>Latest{props.revision ? ` · v${props.revision}` : ""}</span>
          {props.selected === "latest" && <Check size={14} aria-hidden="true" />}
        </button>
        {!props.hasRecord ? (
          <p>Save this design to start its version history.</p>
        ) : !props.canRead ? (
          <p>Version history is private to this design's editor. Shared links show only Latest.</p>
        ) : (
          <>
            {page.versions
              .filter((item) => item.revision !== props.revision)
              .map((item) => (
                <button
                  type="button"
                  className="dropdown-item"
                  key={item.revision}
                  aria-current={props.selected === item.revision ? "true" : undefined}
                  disabled={loading || props.disabled}
                  onClick={() => void select(item.revision)}
                >
                  <span>
                    Version {item.revision}
                    <time dateTime={item.saved_at}>{new Date(item.saved_at).toLocaleString()}</time>
                  </span>
                  {props.selected === item.revision && <Check size={14} aria-hidden="true" />}
                </button>
              ))}
            {loading && <p role="status">Loading versions...</p>}
            {error && <p role="alert">{error}</p>}
            {error ? (
              <button
                type="button"
                className="dropdown-item"
                disabled={loading}
                onClick={() => void load(page.next_before ?? undefined)}
              >
                Try again
              </button>
            ) : page.next_before !== null ? (
              <button
                type="button"
                className="dropdown-item"
                disabled={loading}
                onClick={() => void load(page.next_before!)}
              >
                Load more
              </button>
            ) : (
              !loading && page.versions.length <= 1 && <p>No earlier saved versions.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
