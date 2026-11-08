import type { SiteThemeMode, ThemeOrigin } from "../hooks/useThemeMode.js";
import { GitHubBadge } from "./GitHubBadge.js";
import { SiteLink } from "./SiteLink.js";
import { ThemeToggle } from "./ThemeToggle.js";

export function SiteFooter(props: {
  onWelcome: () => void;
  onMcp: () => void;
  themeMode: SiteThemeMode;
  onSetTheme: (mode: SiteThemeMode, origin?: ThemeOrigin) => void;
  onNavigate: (path: string) => void;
  pathname: string;
  /** On phones the workspace sidebar drawer carries these links instead. */
  inWorkspace?: boolean;
}) {
  return (
    <footer
      className={`site-footer${props.inWorkspace ? " is-workspace" : ""}`}
      aria-label="Site footer"
    >
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
        <ThemeToggle themeMode={props.themeMode} onSetTheme={props.onSetTheme} />
      </div>
    </footer>
  );
}
