import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { Maximize, Minus, Plus, X } from "lucide-react";
import { MAX_WORKSPACE_PAGES, type ResolvedDimensions } from "@tinytldr/core";
import type { ArtboardPreview } from "../hooks/useDesignWorkspace.js";
import { SandboxPreviewFrame } from "./SandboxPreviewFrame.js";

interface Point {
  x: number;
  y: number;
}
interface Camera extends Point {
  zoom: number;
}
const minZoom = 0.01;
const maxZoom = 3;
const clampZoom = (value: number) => Math.max(minZoom, Math.min(maxZoom, value));

export interface ArtboardCanvasProps {
  boards: readonly ArtboardPreview[];
  activePageId: string;
  dimensions: ResolvedDimensions;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  showSafeZone: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, update: { title?: string; description?: string }) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  overlay?: ReactNode;
  bottomInset?: number;
  promptControlsRef?: (node: HTMLDivElement | null) => void;
  editorControls?: ReactNode;
}

export function ArtboardCanvas(props: ArtboardCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ x: 32, y: 40, zoom: 1 });
  const cameraRef = useRef(camera);
  const automatic = useRef(true);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ moved: boolean; travel: number; pageId?: string }>({
    moved: false,
    travel: 0,
  });
  const space = useRef(false);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [hasPointerFocus, setHasPointerFocus] = useState(false);
  const validDimensions =
    Number.isFinite(props.dimensions.width) &&
    Number.isFinite(props.dimensions.height) &&
    props.dimensions.width > 0 &&
    props.dimensions.height > 0;
  const boardWidth = validDimensions ? props.dimensions.width : 1080;
  const height = validDimensions ? props.dimensions.height : 1080;
  const boardGap = (boardWidth * 2) / 15;
  const topInset = 80;
  const bottomInset = 76 + (props.bottomInset ?? 0);
  // Composer height refits Fit mode, but must not move a manually positioned camera.
  const bottomInsetRef = useRef(bottomInset);
  bottomInsetRef.current = bottomInset;
  const activeIndex = props.boards.findIndex((board) => board.page.id === props.activePageId);
  const updateCamera = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
  }, []);
  const zoomAt = useCallback(
    (zoom: number, anchor: Point) => {
      const current = cameraRef.current;
      const nextZoom = clampZoom(zoom);
      const ratio = nextZoom / current.zoom;
      automatic.current = false;
      updateCamera({
        x: anchor.x - (anchor.x - current.x) * ratio,
        y: anchor.y - (anchor.y - current.y) * ratio,
        zoom: nextZoom,
      });
    },
    [updateCamera],
  );
  const fit = useCallback(() => {
    if (!bounds.width || !bounds.height) return;
    const width = props.boards.length * boardWidth + (props.boards.length - 1) * boardGap;
    const zoom = clampZoom(
      Math.min(
        (bounds.width - 64) / width,
        Math.max(16, bounds.height - topInset - bottomInset) / height,
        2,
      ),
    );
    automatic.current = true;
    updateCamera({
      x: (bounds.width - width * zoom) / 2,
      y: topInset + (Math.max(16, bounds.height - topInset - bottomInset) - height * zoom) / 2,
      zoom,
    });
  }, [bounds, props.boards.length, height, boardWidth, boardGap, bottomInset, updateCamera]);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => setBounds({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (automatic.current) fit();
  }, [fit]);
  useLayoutEffect(() => {
    if (automatic.current || !bounds.width) return;
    const inset = bottomInsetRef.current;
    const current = cameraRef.current;
    const left = current.x + activeIndex * (boardWidth + boardGap) * current.zoom;
    if (
      left >= 16 &&
      left + boardWidth * current.zoom <= bounds.width - 16 &&
      current.y >= 72 &&
      current.y + height * current.zoom <= bounds.height - inset
    )
      return;
    updateCamera({
      ...current,
      x:
        (bounds.width - boardWidth * current.zoom) / 2 -
        activeIndex * (boardWidth + boardGap) * current.zoom,
      y: topInset + (bounds.height - topInset - inset - height * current.zoom) / 2,
    });
  }, [
    activeIndex,
    props.activePageId,
    bounds.width,
    bounds.height,
    height,
    boardWidth,
    boardGap,
    updateCamera,
  ]);
  useEffect(() => {
    const releaseSpace = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        space.current = false;
        setSpaceHeld(false);
      }
    };
    const blur = () => {
      space.current = false;
      setSpaceHeld(false);
      pointers.current.clear();
      setPanning(false);
    };
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keyup", releaseSpace);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("textarea,input,[data-canvas-overlay]")
      )
        return;
      event.preventDefault();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      if (event.deltaY === 0 || (event.shiftKey && !event.ctrlKey && !event.metaKey)) {
        automatic.current = false;
        updateCamera({
          ...cameraRef.current,
          x: cameraRef.current.x - (event.shiftKey ? event.deltaY : event.deltaX) * factor,
          y: cameraRef.current.y - (event.shiftKey ? 0 : event.deltaY) * factor,
        });
        return;
      }
      const rect = node.getBoundingClientRect();
      zoomAt(cameraRef.current.zoom * Math.exp(-event.deltaY * factor * 0.005), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [updateCamera, zoomAt]);

  const point = (event: PointerEvent): Point => {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest("input,textarea,button,[data-canvas-overlay]")
    )
      return;
    const sheet = target.closest<HTMLElement>("[data-page-id]");
    if (event.pointerType === "mouse" && event.button !== 1 && !space.current && sheet) return;
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    if (pointers.current.size === 0)
      gesture.current = { moved: false, travel: 0, pageId: sheet?.dataset.pageId };
    else gesture.current.moved = true;
    pointers.current.set(event.pointerId, point(event));
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
    setHasPointerFocus(true);
    viewport.current?.focus({ preventScroll: true });
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = point(event);
    const oldPoints = [...pointers.current.values()];
    pointers.current.set(event.pointerId, next);
    const newPoints = [...pointers.current.values()];
    const current = cameraRef.current;
    automatic.current = false;
    const [a, b] = oldPoints;
    const [c, d] = newPoints;
    if (a && b && c && d) {
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const zoom = clampZoom(
        (current.zoom * Math.hypot(d.x - c.x, d.y - c.y)) / Math.max(1, distance),
      );
      const ratio = zoom / current.zoom;
      updateCamera({
        x: (c.x + d.x) / 2 - ((a.x + b.x) / 2 - current.x) * ratio,
        y: (c.y + d.y) / 2 - ((a.y + b.y) / 2 - current.y) * ratio,
        zoom,
      });
      gesture.current.moved = true;
    } else {
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      gesture.current.travel += Math.hypot(dx, dy);
      if (gesture.current.travel > 3) gesture.current.moved = true;
      updateCamera({ ...current, x: current.x + dx, y: current.y + dy });
    }
  };
  const releasePointer = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!pointers.current.has(event.pointerId)) return;
    if (
      !cancelled &&
      event.pointerType !== "mouse" &&
      pointers.current.size === 1 &&
      !gesture.current.moved &&
      gesture.current.pageId
    )
      props.onSelect(gesture.current.pageId);
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!pointers.current.size) setPanning(false);
  };
  let gridSize = 24 * camera.zoom;
  while (gridSize < 12) gridSize *= 2;
  const style: CSSProperties & { "--canvas-zoom": number } = {
    "--canvas-zoom": camera.zoom,
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: `${camera.x}px ${camera.y}px`,
  };
  const zoomBy = (factor: number) =>
    zoomAt(cameraRef.current.zoom * factor, { x: bounds.width / 2, y: bounds.height / 2 });

  return (
    <div
      ref={viewport}
      className={`artboard-canvas${panning ? " is-panning" : ""}${spaceHeld ? " is-pan-ready" : ""}${hasPointerFocus ? " is-pointer-focused" : ""}`}
      role="region"
      aria-label="Artboard canvas"
      aria-description="Scroll to zoom around the pointer. Shift plus scroll or horizontal scroll pans. Hold Space and drag to pan, or pinch to zoom. Use arrow keys to pan, plus/minus to zoom, and 0 to fit all pages."
      tabIndex={0}
      style={style}
      data-zoom={camera.zoom}
      data-pan-x={camera.x}
      data-pan-y={camera.y}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(event) => releasePointer(event)}
      onPointerCancel={(event) => releasePointer(event, true)}
      onBlur={(event) => {
        if (event.target === event.currentTarget) setHasPointerFocus(false);
      }}
      onLostPointerCapture={(event) => releasePointer(event, true)}
      onKeyDown={(event) => {
        setHasPointerFocus(false);
        if (
          event.target instanceof Element &&
          event.target.closest(
            "input,textarea,button,select,summary,[role=button],[data-canvas-overlay]",
          )
        )
          return;
        if (event.code === "Space") {
          event.preventDefault();
          space.current = true;
          setSpaceHeld(true);
        } else if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          zoomBy(1.2);
        } else if (event.key === "-") {
          event.preventDefault();
          zoomBy(1 / 1.2);
        } else if (event.key === "0") {
          event.preventDefault();
          fit();
        } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          automatic.current = false;
          updateCamera({
            ...cameraRef.current,
            x:
              cameraRef.current.x +
              (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0),
            y:
              cameraRef.current.y +
              (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0),
          });
        }
      }}
    >
      <div
        className="artboard-world"
        style={{
          gap: boardGap,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        }}
      >
        {props.boards.map((board, index) => (
          <article
            className={`artboard${board.page.id === props.activePageId ? " is-selected" : ""}`}
            data-page-id={board.page.id}
            key={board.page.id}
            aria-label={`Artboard ${index + 1}`}
            style={{ width: boardWidth }}
          >
            <div className="artboard-heading">
              <input
                aria-label={`Page ${index + 1} title`}
                maxLength={120}
                value={board.page.title}
                disabled={props.disabled}
                onFocus={() => props.onSelect(board.page.id)}
                onChange={(event) => props.onUpdate(board.page.id, { title: event.target.value })}
              />
              <button
                type="button"
                className="artboard-remove"
                aria-label={`Remove page ${index + 1}`}
                disabled={props.disabled || props.boards.length === 1}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove "${board.page.title || "Untitled page"}" and its source?`,
                    )
                  )
                    props.onRemove(board.page.id);
                }}
              >
                <X />
              </button>
            </div>
            <div
              className="artboard-sheet"
              role="button"
              tabIndex={0}
              aria-label={`Select ${board.page.title || `page ${index + 1}`}`}
              aria-pressed={board.page.id === props.activePageId}
              onClick={() => props.onSelect(board.page.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onSelect(board.page.id);
                }
              }}
              style={{ height }}
            >
              {board.compiled ? (
                <SandboxPreviewFrame
                  key={board.revision}
                  iframeRef={board.page.id === props.activePageId ? props.iframeRef : undefined}
                  html={board.compiled.html}
                  dimensions={board.compiled.dimensions}
                  title={
                    board.page.id === props.activePageId
                      ? "Design preview"
                      : `${board.page.title} preview`
                  }
                  showSafeZone={props.showSafeZone}
                  displayScale={1}
                />
              ) : (
                <p className="artboard-paused">
                  Preview paused.
                  <br />
                  Check this page&rsquo;s source.
                </p>
              )}
            </div>
            <textarea
              aria-label={`Page ${index + 1} purpose`}
              placeholder="Describe this page's purpose..."
              maxLength={2000}
              value={board.page.description}
              disabled={props.disabled}
              onFocus={() => props.onSelect(board.page.id)}
              onChange={(event) =>
                props.onUpdate(board.page.id, { description: event.target.value })
              }
            />
          </article>
        ))}
      </div>
      {props.overlay}
      <div className="canvas-navigation" aria-label="Canvas navigation" data-canvas-overlay>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={camera.zoom <= minZoom}
          onClick={() => zoomBy(1 / 1.2)}
        >
          <Minus size={14} />
        </button>
        <span aria-label="Canvas zoom">{Math.round(camera.zoom * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={camera.zoom >= maxZoom}
          onClick={() => zoomBy(1.2)}
        >
          <Plus size={14} />
        </button>
        <button type="button" aria-label="Fit all pages" title="Fit all pages (0)" onClick={fit}>
          <Maximize size={13} />
          <span>Fit</span>
        </button>
        <button
          type="button"
          className="canvas-add-page"
          aria-label="Add page"
          title={props.boards.length >= MAX_WORKSPACE_PAGES ? "20-page limit" : "Add page"}
          disabled={props.disabled || props.boards.length >= MAX_WORKSPACE_PAGES}
          onClick={props.onAdd}
        >
          <Plus size={14} />
          <span>Page</span>
        </button>
        {props.promptControlsRef && (
          <div className="canvas-prompt-controls" ref={props.promptControlsRef} />
        )}
        {props.editorControls}
      </div>
    </div>
  );
}
