import { useEffect, useRef, useState, type RefObject } from "react";
import type { RuntimeWarning } from "../lib/BrowserCompiler.js";

export interface SandboxRuntimeState {
  readonly isReady: boolean;
  readonly runtimeWarnings: readonly RuntimeWarning[];
  readonly durationMs: number;
  readonly slideCount: number;
}

export function useSandboxPreview(options: {
  readonly revision: number;
  readonly seekMs: number;
  readonly durationMs: number;
}): {
  readonly iframeRef: RefObject<HTMLIFrameElement | null>;
  readonly runtimeState: SandboxRuntimeState;
} {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [runtimeState, setRuntimeState] = useState<SandboxRuntimeState & { revision?: number }>({
    isReady: false,
    runtimeWarnings: [],
    durationMs: options.durationMs,
    slideCount: 1,
  });

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const payload = event.data as
        | {
            type?: string;
            revision?: number;
            warnings?: RuntimeWarning[];
            durationMs?: number;
            slideCount?: number;
          }
        | undefined;

      if (!payload || payload.type !== "tinytldr:ready") {
        return;
      }

      if (typeof payload.revision === "number" && payload.revision !== options.revision) {
        return;
      }

      setRuntimeState({
        revision: options.revision,
        isReady: true,
        runtimeWarnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        durationMs:
          typeof payload.durationMs === "number" ? payload.durationMs : options.durationMs,
        slideCount: typeof payload.slideCount === "number" ? payload.slideCount : 1,
      });
    };

    window.addEventListener("message", handleMessage);
    iframeRef.current?.contentWindow?.postMessage({ type: "tinytldr:inspect" }, "*");
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [options.revision, options.durationMs]);

  useEffect(() => {
    if (options.durationMs <= 0) {
      return;
    }
    const win = iframeRef.current?.contentWindow;
    if (!win) {
      return;
    }
    win.postMessage({ type: "tinytldr:seek", ms: options.seekMs }, "*");
  }, [options.seekMs, options.durationMs]);

  return {
    iframeRef,
    runtimeState:
      runtimeState.revision === options.revision
        ? runtimeState
        : { isReady: false, runtimeWarnings: [], durationMs: options.durationMs, slideCount: 1 },
  };
}
