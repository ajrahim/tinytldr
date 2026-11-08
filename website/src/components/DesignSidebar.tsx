import {
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  HardDrive,
  Info,
  Plus,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  DESIGN_FOLDER_LIMIT,
  DesignFolderNameSchema,
  type SavedWorkspaceDesign,
} from "@tinytldr/core";
import type { DesignHistory } from "../hooks/useDesignHistory.js";
import type { DesignFolders } from "../hooks/useDesignFolders.js";
import type { SiteThemeMode, ThemeOrigin } from "../hooks/useThemeMode.js";
import { InfoTooltip } from "./InfoTooltip.js";
import { Dropdown } from "./Dropdown.js";
import { GitHubBadge } from "./GitHubBadge.js";
import { ThemeToggle } from "./ThemeToggle.js";
import type { FolderAction } from "./FolderActionDialog.js";
import type { DesignListMutation, DesignListTarget } from "../lib/DesignRepository.js";

const DESIGN_DRAG_TYPE = "application/x-tinytldr-design";
const MENU_LABELS = {
  claim: "Claim",
  rename: "Rename",
  move: "Move to folder\u2026",
  delete: "Delete",
} as const;

interface DropProps {
  active: boolean;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export interface DesignSidebarProps {
  history: DesignHistory;
  ownedDesigns: readonly SavedWorkspaceDesign[];
  folders: DesignFolders;
  onFolderAction: (action: FolderAction) => void;
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
  folders,
  onFolderAction,
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
  const [query, setQuery] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dropKey, setDropKey] = useState<string | null>(null);
  const needle = query.trim().toLocaleLowerCase();
  const searching = needle.length > 0;
  const matches = (design: { document: { title: string } }) =>
    !searching || (design.document.title || "Untitled design").toLocaleLowerCase().includes(needle);
  const ownedById = useMemo(
    () => new Map(ownedDesigns.map((design) => [design.id, design])),
    [ownedDesigns],
  );
  const folderOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of folders.folders)
      for (const designId of folder.design_ids) map.set(designId, folder.id);
    return map;
  }, [folders.folders]);
  const visibleOwned = ownedDesigns.filter(matches);
  const visibleLocal = history.entries.filter(matches);
  // All and Local start open; custom folders start closed so All stays reachable.
  const isExpanded = (key: string) => expanded[key] ?? (key === "all" || key === "local");
  const toggle = (key: string) =>
    setExpanded((current) => ({ ...current, [key]: !isExpanded(key) }));
  const canDrag = signedIn && !busy && !folders.busy;
  const dropProps = (key: string, folderId: string | null): DropProps => ({
    active: dropKey === key,
    onDragOver: (event) => {
      if (!canDrag || !event.dataTransfer.types.includes(DESIGN_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropKey(key);
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        setDropKey((current) => (current === key ? null : current));
    },
    onDrop: (event) => {
      const designId = event.dataTransfer.getData(DESIGN_DRAG_TYPE);
      setDropKey(null);
      if (!canDrag || !designId) return;
      event.preventDefault();
      if ((folderOf.get(designId) ?? null) === folderId) return;
      folders.clearError();
      void folders.move(designId, folderId);
    },
  });
  const accountRow = (design: SavedWorkspaceDesign) => {
    const target: DesignListTarget = {
      id: design.id,
      title: design.document.title,
      saved: true,
      revision: design.revision,
      editKey: null,
    };
    return (
      <DesignRow
        key={design.id}
        target={target}
        current={activeId === design.id}
        unclaimed={false}
        busy={busy}
        onNavigate={onNavigate}
        onAction={onDesignAction}
        draggable={canDrag}
        onMove={() => {
          folders.clearError();
          onFolderAction({ kind: "move", target, folderId: folderOf.get(design.id) ?? null });
        }}
      />
    );
  };
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
        <label className="design-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search designs"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={120}
          />
        </label>
        {signedIn &&
          (creatingFolder ? (
            <CreateFolderForm
              busy={folders.busy}
              onCancel={() => setCreatingFolder(false)}
              onCreate={async (name) => {
                if (await folders.create(name)) setCreatingFolder(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="create-folder-button"
              onClick={() => {
                folders.clearError();
                setCreatingFolder(true);
              }}
              disabled={folders.busy || folders.folders.length >= DESIGN_FOLDER_LIMIT}
            >
              <FolderPlus size={14} aria-hidden="true" /> Create Folder
            </button>
          ))}
        {signedIn && folders.error && (
          <p role="alert" className="design-folder-error notice-error">
            {folders.error}
          </p>
        )}
        {signedIn && (
          <DesignGroup
            title="All"
            icon={<FolderOpen size={14} aria-hidden="true" />}
            count={ownedDesigns.length}
            help="Every design saved to your account. Drag a design here to take it out of its folder."
            helpLabel="About account designs"
            expanded={searching || isExpanded("all")}
            onToggle={() => toggle("all")}
            drop={dropProps("all", null)}
          >
            {visibleOwned.length === 0 && (
              <p className="empty-list">{searching ? "No matches" : "No designs yet"}</p>
            )}
            {visibleOwned.map((design) => accountRow(design))}
          </DesignGroup>
        )}
        {signedIn &&
          folders.folders.map((folder) => {
            const designs = folder.design_ids
              .map((designId) => ownedById.get(designId))
              .filter((design): design is SavedWorkspaceDesign => !!design);
            const visible = designs.filter(matches);
            if (searching && visible.length === 0) return null;
            return (
              <DesignGroup
                key={folder.id}
                title={folder.name}
                icon={<Folder size={14} aria-hidden="true" />}
                count={designs.length}
                expanded={searching || isExpanded(folder.id)}
                onToggle={() => toggle(folder.id)}
                drop={dropProps(folder.id, folder.id)}
                menu={
                  <Dropdown
                    label={`Actions for folder ${folder.name}`}
                    popoverLabel={`Actions for folder ${folder.name}`}
                    align="end"
                    variant="context"
                    className="design-row-menu"
                    triggerProps={{ className: "design-row-actions", disabled: folders.busy }}
                    trigger={<Ellipsis size={16} aria-hidden="true" />}
                  >
                    {(close) =>
                      (["rename", "delete"] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          role="menuitem"
                          className="dropdown-item"
                          tabIndex={-1}
                          onClick={() => {
                            close();
                            folders.clearError();
                            onFolderAction({ kind, folder });
                          }}
                        >
                          {kind === "rename" ? "Rename" : "Delete"}
                        </button>
                      ))
                    }
                  </Dropdown>
                }
              >
                {designs.length === 0 && (
                  <p className="empty-list">Drag designs here or use Move to folder.</p>
                )}
                {visible.map((design) => accountRow(design))}
              </DesignGroup>
            );
          })}
        <DesignGroup
          title="Local"
          icon={<HardDrive size={14} aria-hidden="true" />}
          count={history.entries.length}
          help="Unclaimed designs and drafts kept only in this browser. New windows appear here after your first edit. Claim a design to add it to your account."
          helpLabel="About local designs"
          expanded={searching || isExpanded("local")}
          onToggle={() => toggle("local")}
        >
          {visibleLocal.length === 0 && (
            <p className="empty-list">{searching ? "No matches" : "No designs yet"}</p>
          )}
          {visibleLocal.map((design) => (
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
              unclaimed={!ownedById.has(design.id)}
              busy={busy}
              onNavigate={onNavigate}
              onAction={onDesignAction}
            />
          ))}
        </DesignGroup>
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

function DesignGroup({
  title,
  icon,
  count,
  help,
  helpLabel,
  expanded,
  onToggle,
  drop,
  menu,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  help?: string;
  helpLabel?: string;
  expanded: boolean;
  onToggle: () => void;
  drop?: DropProps;
  menu?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const listId = useId();
  return (
    <section
      className={`design-list design-group${drop?.active ? " is-drop-target" : ""}`}
      aria-labelledby={headingId}
      onDragOver={drop?.onDragOver}
      onDragLeave={drop?.onDragLeave}
      onDrop={drop?.onDrop}
    >
      <div className="design-section-heading">
        <button
          type="button"
          className="design-group-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${title} section`}
          onClick={onToggle}
        >
          <ChevronRight size={12} aria-hidden="true" />
          {icon}
        </button>
        {help ? (
          <InfoTooltip label={helpLabel ?? `About ${title}`} title={title} headingId={headingId}>
            {help}
          </InfoTooltip>
        ) : (
          <h3 id={headingId} className="design-group-title" title={title}>
            <button type="button" onClick={onToggle} tabIndex={-1}>
              {title}
            </button>
          </h3>
        )}
        {menu}
        <span
          className="design-section-count"
          aria-label={`${count} ${count === 1 ? "design" : "designs"}`}
        >
          {count}
        </span>
      </div>
      <div id={listId} className="design-group-items" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}

function CreateFolderForm({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const valid = DesignFolderNameSchema.safeParse(name).success;
  return (
    <form
      className="create-folder-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) void onCreate(name);
      }}
    >
      <FolderPlus size={14} aria-hidden="true" />
      <input
        ref={input}
        aria-label="New folder name"
        placeholder="Folder name"
        value={name}
        maxLength={60}
        autoFocus
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Keep Escape from also closing the mobile drawer.
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
        onBlur={() => {
          if (!name.trim() && !busy) onCancel();
        }}
      />
      <button type="submit" disabled={!valid || busy} aria-busy={busy}>
        Create
      </button>
    </form>
  );
}

function DesignRow({
  target,
  current,
  unclaimed,
  busy,
  onNavigate,
  onAction,
  draggable = false,
  onMove,
}: {
  target: DesignListTarget;
  current: boolean;
  unclaimed: boolean;
  busy: boolean;
  onNavigate: (path: string) => void;
  onAction: DesignSidebarProps["onDesignAction"];
  draggable?: boolean;
  onMove?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`design-list-row ${current ? "is-current" : ""}${dragging ? " is-dragging" : ""}`}
      draggable={draggable || undefined}
      onDragStart={
        draggable
          ? (event) => {
              event.dataTransfer.setData(DESIGN_DRAG_TYPE, target.id);
              event.dataTransfer.effectAllowed = "move";
              setDragging(true);
            }
          : undefined
      }
      onDragEnd={() => setDragging(false)}
    >
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
            {(["claim", "rename", "move", "delete"] as const)
              .filter((action) => (action === "claim" ? unclaimed : action !== "move" || !!onMove))
              .map((action) => (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  className="dropdown-item"
                  tabIndex={-1}
                  onClick={() => {
                    close();
                    if (action === "move") onMove?.();
                    else onAction(target, action);
                  }}
                >
                  {MENU_LABELS[action]}
                </button>
              ))}
          </>
        )}
      </Dropdown>
    </div>
  );
}
