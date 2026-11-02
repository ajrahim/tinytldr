import { useCallback, useEffect, useState } from "react";

export type SiteThemeMode = "dark" | "light";

const STORAGE_KEY = "tinytldr:site-theme";

export function useThemeMode(): {
  readonly themeMode: SiteThemeMode;
  readonly toggleThemeMode: () => void;
  readonly setThemeMode: (mode: SiteThemeMode) => void;
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
    const root = document.documentElement;
    if (themeMode === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, themeMode);
    } catch {
      // Ignore storage quota errors in restricted frames
    }
  }, [themeMode]);

  const setThemeMode = useCallback((mode: SiteThemeMode) => {
    setThemeModeState(mode);
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
