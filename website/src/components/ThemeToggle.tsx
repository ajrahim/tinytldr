import { Moon, Sun } from "lucide-react";
import type { SiteThemeMode, ThemeOrigin } from "../hooks/useThemeMode.js";

export function ThemeToggle(props: {
  themeMode: SiteThemeMode;
  onSetTheme: (mode: SiteThemeMode, origin?: ThemeOrigin) => void;
}) {
  return (
    <div className="theme-toggle" role="group" aria-label="Site appearance">
      <button
        type="button"
        aria-pressed={props.themeMode === "light"}
        title="Day appearance"
        onClick={(event) => props.onSetTheme("light", event.currentTarget.getBoundingClientRect())}
      >
        <Sun size={13} aria-hidden="true" /> <span className="theme-toggle-label">Day</span>
      </button>
      <button
        type="button"
        aria-pressed={props.themeMode === "dark"}
        title="Night appearance"
        onClick={(event) => props.onSetTheme("dark", event.currentTarget.getBoundingClientRect())}
      >
        <Moon size={13} aria-hidden="true" /> <span className="theme-toggle-label">Night</span>
      </button>
    </div>
  );
}
