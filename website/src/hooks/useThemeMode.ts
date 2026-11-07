import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

export type SiteThemeMode = "dark" | "light";

/** Viewport rectangle of the control that requested a theme change. */
export type ThemeOrigin = Pick<DOMRect, "left" | "top" | "width" | "height">;

const STORAGE_KEY = "tinytldr:site-theme";
const REVEAL_MS = 520;

function applyThemeClass(mode: SiteThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode !== "dark");
}

export function useThemeMode(): {
  readonly themeMode: SiteThemeMode;
  readonly toggleThemeMode: () => void;
  readonly setThemeMode: (mode: SiteThemeMode, origin?: ThemeOrigin) => void;
} {
  const [themeMode, setThemeModeState] = useState<SiteThemeMode>(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === "dark" ? "dark" : "light";
    } catch {
      // The design-history hook displays storage access failures.
      return "light";
    }
  });

  useEffect(() => {
    applyThemeClass(themeMode);
    try {
      window.localStorage.setItem(STORAGE_KEY, themeMode);
    } catch {
      // Ignore storage quota errors in restricted frames
    }
  }, [themeMode]);

  const setThemeMode = useCallback((mode: SiteThemeMode, origin?: ThemeOrigin) => {
    const root = document.documentElement;
    if (
      !origin ||
      typeof document.startViewTransition !== "function" ||
      root.classList.contains(mode) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setThemeModeState(mode);
      return;
    }
    const x = origin.left + origin.width / 2;
    const y = origin.top + origin.height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const transition = document.startViewTransition(() => {
      applyThemeClass(mode);
      flushSync(() => setThemeModeState(mode));
    });
    transition.ready
      .then(() => {
        root.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
          },
          {
            duration: REVEAL_MS,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      // A skipped transition still applies the theme through the update callback.
      .catch(() => undefined);
  }, []);

  const toggleThemeMode = useCallback(() => {
    setThemeModeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return {
    themeMode,
    toggleThemeMode,
    setThemeMode,
  };
}
