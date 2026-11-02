import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";

export function Dialog({
  title,
  description,
  children,
  footer,
  onClose,
  closeLabel,
  ariaLabel,
  className = "",
  size = "standard",
  initialFocus,
  closeDisabled = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeLabel: string;
  ariaLabel?: string;
  className?: string;
  size?: "compact" | "standard" | "wide" | "media";
  initialFocus?: RefObject<HTMLElement | null>;
  closeDisabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    initialFocus?.current?.focus();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [initialFocus]);

  useEffect(() => {
    const element = dialog.current;
    if (element?.open && !element.contains(document.activeElement))
      (initialFocus?.current ?? closeButton.current)?.focus();
  }, [title, initialFocus]);

  return (
    <dialog
      ref={dialog}
      className={`app-dialog app-dialog--${size} ${className}`}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : titleId}
      onCancel={(event) => {
        if (closeDisabled) event.preventDefault();
        else onClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, iframe, video[controls], [tabindex]",
          ),
        ).filter(
          (element) =>
            !element.matches(":disabled") &&
            element.tabIndex >= 0 &&
            element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="app-dialog-header">
        <div className="app-dialog-heading">
          <h2 className="app-dialog-title" id={titleId}>
            {title}
          </h2>
          {description && <p className="app-dialog-description">{description}</p>}
        </div>
        <button
          ref={closeButton}
          type="button"
          className="dialog-close"
          aria-label={closeLabel}
          disabled={closeDisabled}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="app-dialog-body">{children}</div>
      {footer && <footer className="app-dialog-footer">{footer}</footer>}
    </dialog>
  );
}
