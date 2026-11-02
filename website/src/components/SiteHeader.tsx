import type { ReactNode } from "react";
import { PanelLeft } from "lucide-react";

export interface SiteHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
  sidebarOpen: boolean;
  sidebarControls: string;
  onToggleSidebar: () => void;
}

export function SiteHeader({
  title,
  actions,
  sidebarOpen,
  sidebarControls,
  onToggleSidebar,
}: SiteHeaderProps) {
  return (
    <header className="site-header" aria-label="Design toolbar">
      <button
        className="sidebar-toggle header-icon-button"
        title={sidebarOpen ? "Hide sidebar" : "Open sidebar"}
        type="button"
        aria-label={sidebarOpen ? "Hide sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
        aria-controls={sidebarControls}
        onClick={onToggleSidebar}
      >
        <PanelLeft size={17} aria-hidden="true" />
      </button>
      <div className="header-title">{title}</div>
      <div className="workspace-actions">{actions}</div>
    </header>
  );
}
