import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

interface DropdownProps {
  label: string;
  popoverLabel?: string;
  role?: "menu" | "listbox" | "dialog";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: "top" | "bottom";
  align?: "start" | "end";
  className?: string;
  variant?: "default" | "context";
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}

export function Dropdown({
  label,
  popoverLabel = label,
  role = "menu",
  open: controlledOpen,
  onOpenChange,
  placement = "bottom",
  align = "start",
  className = "",
  variant = "default",
  triggerProps,
  trigger: content,
  children,
}: DropdownProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<"first" | "last" | "selected">("selected");
  const search = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    maxHeight: 640,
    minWidth: 0,
  });

  const close = (restoreFocus = true) => {
    popover.current?.hidePopover();
    setOpen(false);
    onOpenChange?.(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const items = () =>
    Array.from(
      popover.current?.querySelectorAll<HTMLButtonElement>(
        'button:is([role^="menuitem"], [role="option"]):not(:disabled)',
      ) ?? [],
    );
  const positionMenu = useCallback(() => {
    const button = trigger.current;
    const panel = popover.current;
    if (!button || !panel) return;

    const bounds = button.getBoundingClientRect();
    const width = Math.min(
      window.innerWidth - 16,
      Math.max(panel.getBoundingClientRect().width, bounds.width),
    );
    const below = Math.max(0, window.innerHeight - bounds.bottom - 16);
    const above = Math.max(0, bounds.top - 16);
    const desiredHeight = Math.min(640, panel.scrollHeight + 2);
    const onTop =
      placement === "top"
        ? above >= desiredHeight || above > below
        : below < desiredHeight && above > below;
    const maxHeight = Math.min(640, onTop ? above : below);
    setPosition({
      top: onTop ? bounds.top - 8 - Math.min(desiredHeight, maxHeight) : bounds.bottom + 8,
      left: Math.max(
        8,
        Math.min(
          align === "end" ? bounds.right - width : bounds.left,
          window.innerWidth - width - 8,
        ),
      ),
      maxHeight,
      minWidth: Math.min(bounds.width, window.innerWidth - 16),
    });
  }, [align, placement]);

  const show = () => {
    popover.current?.showPopover();
    positionMenu();
    const enabled = items();
    const selected = enabled.find((item) => item.getAttribute("aria-selected") === "true");
    const first =
      initialFocus.current === "last"
        ? enabled.at(-1)
        : initialFocus.current === "selected"
          ? (selected ?? enabled[0])
          : enabled[0];
    first?.focus({ preventScroll: true });
    first?.scrollIntoView({ block: "nearest" });
    if (role === "dialog") popover.current?.focus({ preventScroll: true });
    search.current = { text: "", at: 0 };
    setOpen(true);
    onOpenChange?.(true);
  };

  useLayoutEffect(() => {
    const panel = popover.current;
    if (!panel || controlledOpen === undefined) return;
    if (controlledOpen && !panel.matches(":popover-open")) {
      const showWhenAvailable = () => {
        const modal = document.querySelector("dialog:modal");
        if (!panel.isConnected || (modal && !modal.contains(panel))) return false;
        panel.showPopover();
        positionMenu();
        return true;
      };
      if (!showWhenAvailable()) {
        const observer = new MutationObserver(() => {
          if (showWhenAvailable()) observer.disconnect();
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["open"],
        });
        return () => observer.disconnect();
      }
    } else if (!controlledOpen && panel.matches(":popover-open")) panel.hidePopover();
  }, [controlledOpen, positionMenu]);

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
    const panel = popover.current;
    const observer = new ResizeObserver(positionMenu);
    if (panel) observer.observe(panel);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, positionMenu]);

  return (
    <div className={`dropdown ${className}`}>
      <button
        {...triggerProps}
        ref={trigger}
        type="button"
        aria-label={label}
        role={role === "listbox" ? "combobox" : undefined}
        aria-haspopup={role}
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        onClick={(event) => {
          event.preventDefault();
          initialFocus.current = "selected";
          if (popover.current?.matches(":popover-open")) close();
          else show();
        }}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          initialFocus.current = event.key === "ArrowUp" || event.key === "End" ? "last" : "first";
          show();
        }}
      >
        {content}
      </button>
      <div
        id={id}
        ref={popover}
        popover="auto"
        role={role}
        tabIndex={role === "dialog" ? -1 : undefined}
        aria-label={popoverLabel}
        className={`dropdown-panel dropdown-popover${variant === "context" ? " dropdown-context-menu" : ""}`}
        style={position}
        onToggle={(event) => {
          const next = event.currentTarget.matches(":popover-open");
          setOpen(next);
          onOpenChange?.(next);
        }}
        onBlur={(event) => {
          if (role !== "dialog" || !(event.relatedTarget instanceof Node)) return;
          if (
            !event.currentTarget.contains(event.relatedTarget) &&
            !trigger.current?.contains(event.relatedTarget)
          )
            close(false);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (role === "dialog") return;
          if (event.key === "Tab") {
            close();
            return;
          }
          const enabled = items();
          const current = enabled.findIndex((item) => item === document.activeElement);
          let next: HTMLButtonElement | undefined;
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            search.current = { text: "", at: 0 };
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? enabled.length - 1
                  : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) %
                    enabled.length;
            next = enabled[index];
          } else if (
            event.key.length === 1 &&
            (event.key !== " " ||
              (search.current.text.length > 0 && Date.now() - search.current.at < 700)) &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey
          ) {
            const now = Date.now();
            const text = (now - search.current.at < 700 ? search.current.text : "") + event.key;
            search.current = { text: text.toLowerCase(), at: now };
            const query = [...search.current.text].every(
              (letter) => letter === search.current.text[0],
            )
              ? search.current.text[0]!
              : search.current.text;
            next = [...enabled.slice(current + 1), ...enabled.slice(0, current + 1)].find((item) =>
              item.textContent?.trim().toLowerCase().startsWith(query),
            );
          } else return;
          event.preventDefault();
          next?.focus({ preventScroll: true });
          next?.scrollIntoView({ block: "nearest" });
        }}
      >
        {children(close)}
      </div>
    </div>
  );
}
