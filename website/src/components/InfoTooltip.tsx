import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function InfoTooltip({
  label,
  title,
  headingId,
  children,
}: {
  label: string;
  title: string;
  headingId: string;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pointerType = useRef("");
  const openOnPointerDown = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const hide = () => {
    window.clearTimeout(timer.current);
    tooltip.current?.hidePopover();
    setOpen(false);
  };
  const show = () => {
    window.clearTimeout(timer.current);
    const button = trigger.current;
    const panel = tooltip.current;
    if (!button || !panel) return;
    if (!panel.matches(":popover-open")) panel.showPopover();
    setOpen(true);
    const anchor = button.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const below = anchor.bottom + 6;
    setPosition({
      left: Math.max(
        8,
        Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8),
      ),
      top: Math.max(
        8,
        below + bounds.height <= window.innerHeight - 8 ? below : anchor.top - bounds.height - 6,
      ),
    });
  };
  const scheduleHide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (trigger.current?.matches(":hover, :focus-visible") || tooltip.current?.matches(":hover"))
        return;
      hide();
    }, 150);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const panel = tooltip.current;
    const close = () => panel?.hidePopover();
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <span className="info-tooltip">
      <h3 id={headingId} aria-label={title}>
        <button
          ref={trigger}
          className="info-tooltip-trigger"
          type="button"
          aria-label={label}
          aria-describedby={id}
          popoverTarget={id}
          onPointerDown={(event) => {
            pointerType.current = event.pointerType;
            openOnPointerDown.current = tooltip.current?.matches(":popover-open") ?? false;
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") show();
          }}
          onPointerLeave={scheduleHide}
          onFocus={show}
          onBlur={scheduleHide}
          onClick={(event) => {
            event.preventDefault();
            if (event.detail !== 0 && pointerType.current === "touch" && openOnPointerDown.current)
              hide();
            else show();
          }}
        >
          {title}
        </button>
      </h3>
      <div
        id={id}
        ref={tooltip}
        className="info-tooltip-panel"
        role="tooltip"
        popover="auto"
        style={position}
        onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}
        onPointerEnter={() => window.clearTimeout(timer.current)}
        onPointerLeave={scheduleHide}
      >
        {children}
      </div>
    </span>
  );
}
