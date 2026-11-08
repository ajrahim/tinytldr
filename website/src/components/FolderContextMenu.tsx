import { Check, ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { DESIGN_FOLDER_COLORS, type DesignFolderColor } from "@tinytldr/core";

export interface ContextMenuPoint {
  x: number;
  y: number;
}

const COLOR_NAMES: Record<DesignFolderColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

const ITEM_SELECTOR = 'button[role^="menuitem"]:not(:disabled)';

function place(panel: HTMLElement, x: number, y: number, alternateX?: number) {
  const { width, height } = panel.getBoundingClientRect();
  const left =
    x + width > window.innerWidth - 8 && alternateX !== undefined ? alternateX - width : x;
  panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR));
  const own = items.filter((item) => item.closest('[role="menu"]') === event.currentTarget);
  const current = own.findIndex((item) => item === document.activeElement);
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? own.length - 1
        : event.key === "ArrowDown"
          ? (current + 1) % own.length
          : event.key === "ArrowUp"
            ? (current - 1 + own.length) % own.length
            : -1;
  if (index < 0) return false;
  event.preventDefault();
  own[index]?.focus({ preventScroll: true });
  return true;
}

/** Right-click menu for a custom folder, with a color submenu. */
export function FolderContextMenu({
  folderName,
  color,
  point,
  onClose,
  onRename,
  onColor,
  onDelete,
}: {
  folderName: string;
  color: DesignFolderColor | undefined;
  point: ContextMenuPoint;
  onClose: () => void;
  onRename: () => void;
  onColor: (color: DesignFolderColor | null) => void;
  onDelete: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const colorItem = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const [subOpen, setSubOpen] = useState(false);

  useLayoutEffect(() => {
    const panel = menu.current;
    if (!panel) return;
    returnFocus.current = document.activeElement;
    panel.showPopover();
    place(panel, point.x, point.y);
    panel.querySelector<HTMLButtonElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
  }, [point]);

  const closed = useRef(false);
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
    onClose();
    const previous = returnFocus.current;
    if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body)
      previous.focus({ preventScroll: true });
  };

  const openSubmenu = (focusFirst: boolean) => {
    const panel = submenu.current;
    const anchor = colorItem.current;
    if (!panel || !anchor) return;
    if (!panel.matches(":popover-open")) panel.showPopover();
    const bounds = anchor.getBoundingClientRect();
    const menuBounds = menu.current!.getBoundingClientRect();
    place(panel, menuBounds.right + 2, bounds.top - 4, menuBounds.left - 2);
    setSubOpen(true);
    if (focusFirst)
      (
        panel.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
        panel.querySelector<HTMLButtonElement>(ITEM_SELECTOR)
      )?.focus({ preventScroll: true });
  };
  const closeSubmenu = (focusParent: boolean) => {
    if (submenu.current?.matches(":popover-open")) submenu.current.hidePopover();
    setSubOpen(false);
    if (focusParent) colorItem.current?.focus({ preventScroll: true });
  };
  const choose = (action: () => void) => {
    close();
    action();
  };

  return (
    <div
      ref={menu}
      popover="auto"
      role="menu"
      aria-label={`Actions for folder ${folderName}`}
      className="dropdown-panel dropdown-popover dropdown-context-menu folder-context-menu"
      onToggle={(event) => {
        if (event.target === event.currentTarget && event.newState === "closed") close();
      }}
      onKeyDown={(event) => {
        if (event.target instanceof Node && submenu.current?.contains(event.target)) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (event.key === "Tab") {
          event.preventDefault();
          close();
        } else if (event.key === "ArrowRight" && document.activeElement === colorItem.current) {
          event.preventDefault();
          openSubmenu(true);
        } else moveFocus(event);
      }}
    >
      <button
        type="button"
        role="menuitem"
        className="dropdown-item"
        tabIndex={-1}
        onPointerEnter={() => closeSubmenu(false)}
        onClick={() => choose(onRename)}
      >
        Rename
      </button>
      <button
        ref={colorItem}
        type="button"
        role="menuitem"
        className="dropdown-item folder-color-trigger"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={subOpen}
        onPointerEnter={() => openSubmenu(false)}
        onClick={() => openSubmenu(true)}
      >
        Color
        <ChevronRight size={12} aria-hidden="true" />
      </button>
      <div role="separator" className="dropdown-separator" />
      <button
        type="button"
        role="menuitem"
        className="dropdown-item is-danger"
        tabIndex={-1}
        onPointerEnter={() => closeSubmenu(false)}
        onClick={() => choose(onDelete)}
      >
        Delete
      </button>
      <div
        ref={submenu}
        popover="auto"
        role="menu"
        aria-label="Folder color"
        className="dropdown-panel dropdown-popover dropdown-context-menu folder-color-menu"
        onToggle={(event) => {
          if (event.newState === "closed") setSubOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "ArrowLeft") {
            event.preventDefault();
            event.stopPropagation();
            closeSubmenu(true);
          } else if (event.key === "Tab") {
            event.preventDefault();
            close();
          } else moveFocus(event);
        }}
      >
        {([null, ...DESIGN_FOLDER_COLORS] as const).map((option) => (
          <button
            key={option ?? "default"}
            type="button"
            role="menuitemradio"
            aria-checked={(color ?? null) === option}
            className="dropdown-item"
            tabIndex={-1}
            onClick={() => choose(() => onColor(option))}
          >
            <span
              className={`folder-color-swatch${option ? ` folder-color-${option}` : ""}`}
              aria-hidden="true"
            />
            {option ? COLOR_NAMES[option] : "Default"}
            {(color ?? null) === option && (
              <Check className="dropdown-check" size={12} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
