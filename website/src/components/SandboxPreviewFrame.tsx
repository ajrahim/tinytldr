import { useEffect, useRef, useState, type RefObject } from "react";
import type { ResolvedDimensions } from "../lib/BrowserCompiler.js";

export interface SandboxPreviewFrameProps {
  readonly html: string;
  readonly dimensions: ResolvedDimensions;
  readonly title: string;
  readonly showSafeZone?: boolean;
  readonly maxDisplayHeight?: number;
  readonly fitContainer?: boolean;
  readonly displayScale?: number;
  readonly iframeRef?: RefObject<HTMLIFrameElement | null>;
}

export function SandboxPreviewFrame({
  html,
  dimensions,
  title,
  showSafeZone = false,
  maxDisplayHeight = 540,
  fitContainer = false,
  displayScale,
  iframeRef,
}: SandboxPreviewFrameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.32);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || displayScale !== undefined) return;

    const computeScale = () => {
      const availableWidth = Math.max(1, node.clientWidth - 16);
      const scaleX = availableWidth / dimensions.width;
      const availableHeight = fitContainer ? Math.max(1, node.clientHeight - 16) : maxDisplayHeight;
      const scaleY = availableHeight / dimensions.height;
      const nextScale = Math.min(fitContainer ? Infinity : 1, scaleX, scaleY);
      setScale(nextScale);
    };

    computeScale();
    const observer = new ResizeObserver(computeScale);
    observer.observe(node);
    return () => observer.disconnect();
  }, [dimensions.width, dimensions.height, maxDisplayHeight, fitContainer, displayScale]);

  const renderedScale = displayScale ?? scale;
  const scaledWidth = Math.round(dimensions.width * renderedScale);
  const scaledHeight = Math.round(dimensions.height * renderedScale);
  const isStory = dimensions.presetId === "story" || dimensions.aspectRatio === "9:16";

  return (
    <div
      ref={containerRef}
      className={`sandbox-preview${fitContainer ? " is-fitted" : ""}${displayScale !== undefined ? " is-artboard" : ""}`}
    >
      <div
        className="relative overflow-hidden rounded-lg shadow-lg"
        style={{
          width: `${scaledWidth}px`,
          height: `${scaledHeight}px`,
          border: displayScale === undefined ? "1px solid var(--ui-border)" : "none",
        }}
      >
        <iframe
          ref={iframeRef}
          title={title}
          srcDoc={html}
          sandbox="allow-scripts"
          tabIndex={-1}
          style={{
            width: `${dimensions.width}px`,
            height: `${dimensions.height}px`,
            transform: `scale(${renderedScale})`,
            transformOrigin: "top left",
            border: "none",
            pointerEvents: "none",
          }}
        />

        {showSafeZone ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              width: `${dimensions.width}px`,
              height: `${dimensions.height}px`,
              transform: `scale(${renderedScale})`,
              transformOrigin: "top left",
            }}
          >
            {isStory ? (
              <>
                <div
                  className="absolute inset-x-0 top-0 flex items-center justify-center border-b-2 border-dashed border-rose-400/80 bg-rose-500/15 font-mono text-2xl font-bold text-rose-200"
                  style={{ height: "250px" }}
                >
                  9:16 Top UI Safe Zone (250px)
                </div>
                <div
                  className="absolute inset-x-0 bottom-0 flex items-center justify-center border-t-2 border-dashed border-rose-400/80 bg-rose-500/15 font-mono text-2xl font-bold text-rose-200"
                  style={{ height: "340px" }}
                >
                  9:16 Bottom Caption Safe Zone (340px)
                </div>
              </>
            ) : (
              <div
                className="absolute border-2 border-dashed border-sky-400/75"
                style={{
                  inset: `${Math.round(dimensions.height * 0.06)}px ${Math.round(dimensions.width * 0.06)}px`,
                }}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
