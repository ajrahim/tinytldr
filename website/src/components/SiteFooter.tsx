import { Moon, Sun } from "lucide-react";
import type { SiteThemeMode, ThemeOrigin } from "../hooks/useThemeMode.js";
import { GitHubBadge } from "./GitHubBadge.js";
import { SiteLink } from "./SiteLink.js";

export function SiteFooter(props: {
  onWelcome: () => void;
  onMcp: () => void;
  themeMode: SiteThemeMode;
  onSetTheme: (mode: SiteThemeMode, origin?: ThemeOrigin) => void;
  onNavigate: (path: string) => void;
  pathname: string;
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
        <SiteLink
          href="/privacy"
          onNavigate={props.onNavigate}
          current={props.pathname === "/privacy"}
        >
          Privacy
        </SiteLink>
        <SiteLink href="/terms" onNavigate={props.onNavigate} current={props.pathname === "/terms"}>
          Terms
        </SiteLink>
      </nav>
      <div className="footer-actions">
        <GitHubBadge />
        <div className="footer-theme-toggle" role="group" aria-label="Site appearance">
          <button
            type="button"
            aria-pressed={props.themeMode === "light"}
            title="Day appearance"
            onClick={(event) =>
              props.onSetTheme("light", event.currentTarget.getBoundingClientRect())
            }
          >
            <Sun size={13} aria-hidden="true" /> Day
          </button>
          <button
            type="button"
            aria-pressed={props.themeMode === "dark"}
            title="Night appearance"
            onClick={(event) =>
              props.onSetTheme("dark", event.currentTarget.getBoundingClientRect())
            }
          >
            <Moon size={13} aria-hidden="true" /> Night
          </button>
        </div>
      </div>
    </footer>
  );
}
