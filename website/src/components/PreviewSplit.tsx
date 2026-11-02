import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const DEFAULT_PREVIEW_RATIO = 0.55;
const MIN_PREVIEW_RATIO = 0.2;
const MAX_PREVIEW_RATIO = 0.8;
const DIVIDER_HEIGHT = 8;
const MIN_EDITOR_HEIGHT = 144;
const MIN_PREVIEW_HEIGHT = 64;

export function PreviewSplit({
  preview,
  editors,
  editorsVisible,
  editorsId,
}: {
  preview: ReactNode;
  editors: ReactNode;
  editorsVisible: boolean;
  editorsId: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(DEFAULT_PREVIEW_RATIO);
  const [dragging, setDragging] = useState(false);
  const [hasShownEditors, setHasShownEditors] = useState(editorsVisible);
  const [availableHeight, setAvailableHeight] = useState(0);
  const id = useId();
  useEffect(() => {
    if (editorsVisible) setHasShownEditors(true);
  }, [editorsVisible]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const update = () => setAvailableHeight(Math.max(0, node.clientHeight - DIVIDER_HEIGHT));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const minRatio = availableHeight
    ? Math.min(MAX_PREVIEW_RATIO, Math.max(MIN_PREVIEW_RATIO, MIN_PREVIEW_HEIGHT / availableHeight))
    : MIN_PREVIEW_RATIO;
  const maxRatio = availableHeight
    ? Math.max(minRatio, Math.min(MAX_PREVIEW_RATIO, 1 - MIN_EDITOR_HEIGHT / availableHeight))
    : MAX_PREVIEW_RATIO;
  const visibleRatio = Math.min(maxRatio, Math.max(minRatio, ratio));
  const resize = (next: number) => setRatio(Math.min(maxRatio, Math.max(minRatio, next)));

  return (
    <div
      ref={root}
      className={`preview-split${dragging ? " is-dragging" : ""}`}
      style={{
        gridTemplateRows: editorsVisible
          ? `minmax(0, ${visibleRatio}fr) ${DIVIDER_HEIGHT}px minmax(0, ${1 - visibleRatio}fr)`
          : "minmax(0, 1fr)",
      }}
    >
      <div id={`${id}-preview`} className="preview-split-preview">
        {preview}
      </div>
      <div
        className="preview-split-divider"
        hidden={!editorsVisible}
        role="separator"
        tabIndex={0}
        aria-label="Resize preview"
        aria-orientation="horizontal"
        aria-controls={`${id}-preview ${editorsId}`}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        aria-valuenow={Math.round(visibleRatio * 100)}
        aria-valuetext={`Preview ${Math.round(visibleRatio * 100)}%, editors ${Math.round((1 - visibleRatio) * 100)}%`}
        title="Drag to resize the preview. Use arrow keys, or double-click to reset."
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = root.current?.getBoundingClientRect();
          if (bounds && bounds.height > DIVIDER_HEIGHT)
            resize(
              (event.clientY - bounds.top - DIVIDER_HEIGHT / 2) / (bounds.height - DIVIDER_HEIGHT),
            );
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => setDragging(false)}
        onDoubleClick={() => resize(DEFAULT_PREVIEW_RATIO)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.02;
          if (event.key === "ArrowUp") resize(visibleRatio - step);
          else if (event.key === "ArrowDown") resize(visibleRatio + step);
          else if (event.key === "Home") resize(minRatio);
          else if (event.key === "End") resize(maxRatio);
          else return;
          event.preventDefault();
        }}
      >
        <span aria-hidden="true" />
      </div>
      <div id={editorsId} className="preview-split-editors" hidden={!editorsVisible}>
        {(hasShownEditors || editorsVisible) && editors}
      </div>
    </div>
  );
}
