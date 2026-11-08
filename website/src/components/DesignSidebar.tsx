import { Ellipsis, Grid2X2, Info, Plus, Sparkles, UserRound, X } from "lucide-react";
import { useId } from "react";
import type { SavedWorkspaceDesign } from "@tinytldr/core";
import type { DesignHistory } from "../hooks/useDesignHistory.js";
import type { SiteThemeMode, ThemeOrigin } from "../hooks/useThemeMode.js";
import { InfoTooltip } from "./InfoTooltip.js";
import { Dropdown } from "./Dropdown.js";
import { GitHubBadge } from "./GitHubBadge.js";
import { ThemeToggle } from "./ThemeToggle.js";
import type { DesignListMutation, DesignListTarget } from "../lib/DesignRepository.js";

export interface DesignSidebarProps {
  history: DesignHistory;
  ownedDesigns: readonly SavedWorkspaceDesign[];
  activeId?: string;
  signedIn: boolean;
  onNewDesign: () => void;
  onNavigate: (path: string) => void;
  onSignIn: () => void;
  onWelcome: () => void;
  onMcp: () => void;
  themeMode: SiteThemeMode;
  onSetTheme: (mode: SiteThemeMode, origin?: ThemeOrigin) => void;
  onOpenSitePage: (path: string) => void;
  hidden?: boolean;
  libraryOpen: boolean;
  onLibrary: () => void;
  onClose?: () => void;
  busy: boolean;
  onDesignAction: (target: DesignListTarget, action: DesignListMutation["action"]) => void;
}

export function DesignSidebar({
  history,
  ownedDesigns,
  activeId,
  signedIn,
  onNewDesign,
  onNavigate,
  onSignIn,
  onWelcome,
  onMcp,
  themeMode,
  onSetTheme,
  onOpenSitePage,
  hidden,
  libraryOpen,
  onLibrary,
  onClose,
  busy,
  onDesignAction,
}: DesignSidebarProps) {
  const accountHeading = useId();
  const browserHeading = useId();
  return (
    <aside id="design-sidebar" className="design-sidebar" aria-label="Your designs" hidden={hidden}>
      <div className="sidebar-brand">
        <button className="wordmark" type="button" aria-label="About tinytldr" onClick={onWelcome}>
          tinytldr.
        </button>
        {onClose && (
          <button type="button" aria-label="Close sidebar" onClick={onClose}>
            <X size={18} />
          </button>
        )}
      </div>
      <button className="new-design-button" onClick={onNewDesign} type="button" disabled={busy}>
        <Plus size={15} /> New design
      </button>
      <button
        className={`library-button ${libraryOpen ? "is-current" : ""}`}
        onClick={onLibrary}
        type="button"
        aria-pressed={libraryOpen}
      >
        <Grid2X2 size={15} /> My Library
      </button>
      <nav aria-label="Saved designs">
        <h2 className="sidebar-list-heading">Designs</h2>
        {signedIn && (
          <section className="design-list" aria-labelledby={accountHeading}>
            <DesignSectionHeading
              id={accountHeading}
              title="Account"
              count={ownedDesigns.length}
              helpLabel="About account designs"
              description="Designs you own, including those you've claimed. Available whenever you sign in."
            />
            {ownedDesigns.length === 0 && <p className="empty-list">No designs yet</p>}
            {ownedDesigns.map((design) => (
              <DesignRow
                key={design.id}
                target={{
                  id: design.id,
                  title: design.document.title,
                  saved: true,
                  revision: design.revision,
                  editKey: null,
                }}
                current={activeId === design.id}
                unclaimed={false}
                busy={busy}
                onNavigate={onNavigate}
                onAction={onDesignAction}
              />
            ))}
          </section>
        )}
        <section className="design-list" aria-labelledby={browserHeading}>
          <DesignSectionHeading
            id={browserHeading}
            title="This browser"
            count={history.entries.length}
            helpLabel="About browser designs"
            description="Unclaimed designs and unsaved drafts kept in this browser. Claim a design to add it to your account."
          />
          {history.entries.length === 0 && <p className="empty-list">No designs yet</p>}
          {history.entries.map((design) => (
            <DesignRow
              key={design.id}
              target={{
                id: design.id,
                title: design.document.title || "Untitled design",
                saved: design.saved,
                revision: design.revision,
                editKey: design.editKey,
              }}
              current={activeId === design.id}
              unclaimed={!ownedDesigns.some((owned) => owned.id === design.id)}
              busy={busy}
              onNavigate={onNavigate}
              onAction={onDesignAction}
            />
          ))}
        </section>
      </nav>
      <div className="sidebar-bottom">
        <button type="button" className="sidebar-mcp-card" onClick={onMcp}>
          <span>Connect an Agent</span>
          <Sparkles size={14} aria-hidden="true" />
        </button>
        <button type="button" className="sidebar-account-card" onClick={onSignIn}>
          <span>{signedIn ? "Account" : "Sign in / Create account"}</span>
          <UserRound size={14} aria-hidden="true" />
          <small>{signedIn ? "Manage your sign-in." : "Your own space. Always optional."}</small>
        </button>
        {/* Phone-only replacement for the site footer (see SiteFooter.css). */}
        <div className="sidebar-site-row" aria-label="Site resources" role="group">
          <Dropdown
            label="More site links"
            popoverLabel="Site resources"
            placement="top"
            className="sidebar-site-menu"
            triggerProps={{ className: "sidebar-more-button", title: "More" }}
            trigger={
              <>
                <Info size={14} aria-hidden="true" /> <span>More&hellip;</span>
              </>
            }
          >
            {(close) =>
              (
                [
                  ["Welcome", onWelcome],
                  ["MCP", onMcp],
                  ["Privacy", () => onOpenSitePage("/privacy")],
                  ["Terms", () => onOpenSitePage("/terms")],
                ] as const
              ).map(([label, action]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  className="dropdown-item"
                  tabIndex={-1}
                  onClick={() => {
                    close();
                    action();
                  }}
                >
                  {label}
                </button>
              ))
            }
          </Dropdown>
          <GitHubBadge />
          <ThemeToggle themeMode={themeMode} onSetTheme={onSetTheme} />
        </div>
      </div>
    </aside>
  );
}

function DesignSectionHeading({
  id,
  title,
  count,
  helpLabel,
  description,
}: {
  id: string;
  title: string;
  count: number;
  helpLabel: string;
  description: string;
}) {
  return (
    <div className="design-section-heading">
      <InfoTooltip label={helpLabel} title={title} headingId={id}>
        {description}
      </InfoTooltip>
      <span
        className="design-section-count"
        aria-label={`${count} ${count === 1 ? "design" : "designs"}`}
      >
        {count}
      </span>
    </div>
  );
}

function DesignRow({
  target,
  current,
  unclaimed,
  busy,
  onNavigate,
  onAction,
}: {
  target: DesignListTarget;
  current: boolean;
  unclaimed: boolean;
  busy: boolean;
  onNavigate: (path: string) => void;
  onAction: DesignSidebarProps["onDesignAction"];
}) {
  return (
    <div className={`design-list-row ${current ? "is-current" : ""}`}>
      <button
        type="button"
        className={`design-list-item ${current ? "is-current" : ""}`}
        onClick={() => onNavigate(`/${target.saved ? "d" : "local"}/${target.id}`)}
        title={target.title}
      >
        <span>{target.title}</span>
      </button>
      <Dropdown
        label={`Actions for ${target.title}`}
        popoverLabel={`Actions for ${target.title}`}
        align="end"
        variant="context"
        className="design-row-menu"
        triggerProps={{ className: "design-row-actions", disabled: busy }}
        trigger={<Ellipsis size={16} aria-hidden="true" />}
      >
        {(close) => (
          <>
            {(["claim", "rename", "delete"] as const)
              .filter((action) => action !== "claim" || unclaimed)
              .map((action) => (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  className="dropdown-item"
                  tabIndex={-1}
                  onClick={() => {
                    close();
                    onAction(target, action);
                  }}
                >
                  {action === "claim" ? "Claim" : action === "rename" ? "Rename" : "Delete"}
                </button>
              ))}
          </>
        )}
      </Dropdown>
    </div>
  );
}
