import { Moon, Sun } from "lucide-react";
import type { SiteThemeMode } from "../hooks/useThemeMode.js";

export function SiteFooter(props: {
  onWelcome: () => void;
  onMcp: () => void;
  themeMode: SiteThemeMode;
  onSetTheme: (mode: SiteThemeMode) => void;
}) {
  return (
    <footer className="site-footer" aria-label="Site footer">
      <nav aria-label="Site resources">
        <button type="button" onClick={props.onWelcome}>
          Welcome
        </button>
        <button type="button" onClick={props.onMcp}>
          MCP
        </button>
        <a href="https://github.com/ajrahim/tinytldr" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
      <div className="footer-theme-toggle" role="group" aria-label="Site appearance">
        <button
          type="button"
          aria-pressed={props.themeMode === "light"}
          title="Day appearance"
          onClick={() => props.onSetTheme("light")}
        >
          <Sun size={13} aria-hidden="true" /> Day
        </button>
        <button
          type="button"
          aria-pressed={props.themeMode === "dark"}
          title="Night appearance"
          onClick={() => props.onSetTheme("dark")}
        >
          <Moon size={13} aria-hidden="true" /> Night
        </button>
      </div>
    </footer>
  );
}
