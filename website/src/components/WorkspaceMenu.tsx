import { Check, Ellipsis, Code2, FileText, Film, Image } from "lucide-react";
import { Dropdown } from "./Dropdown.js";

const EXPORTS = [
  { id: "png", label: "PNG image", icon: Image },
  { id: "jpg", label: "JPEG image", icon: Image },
  { id: "webp", label: "WebP image", icon: Image },
  { id: "pdf", label: "PDF document", icon: FileText },
  { id: "mp4", label: "MP4 video", icon: Film },
  { id: "html", label: "Rendered HTML", icon: Code2 },
];
const SOURCES = [
  { id: "source-html", label: "HTML / Liquid source" },
  { id: "source-css", label: "CSS source" },
  { id: "source-json", label: "Template JSON" },
];

export function WorkspaceMenu(props: {
  disabled: boolean;
  canExport: boolean;
  hasRecord: boolean;
  canClaim: boolean;
  signedIn: boolean;
  showSafeZone: boolean;
  onToggleSafeZone: () => void;
  onAction: (action: string) => void;
}) {
  return (
    <Dropdown
      label="More"
      popoverLabel="Design actions"
      align="end"
      triggerProps={{
        className: "header-icon-button",
        title: "More",
        disabled: props.disabled,
      }}
      trigger={<Ellipsis size={18} aria-hidden="true" />}
    >
      {(close) => {
        const activate = (action: string) => {
          close();
          props.onAction(action);
        };
        return (
          <>
            <div role="group" aria-label="Export" className="dropdown-group">
              <p className="dropdown-heading">Export</p>
              {EXPORTS.map(({ id: action, label, icon: Icon }) => (
                <button
                  type="button"
                  role="menuitem"
                  className="dropdown-item"
                  tabIndex={-1}
                  key={action}
                  disabled={!props.canExport}
                  onClick={() => activate(action)}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div role="group" aria-label="Template files" className="dropdown-group">
              <p className="dropdown-heading">Template files</p>
              {SOURCES.map(({ id: action, label }) => (
                <button
                  type="button"
                  role="menuitem"
                  className="dropdown-item"
                  tabIndex={-1}
                  key={action}
                  onClick={() => activate(action)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Design" className="dropdown-group">
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                tabIndex={-1}
                disabled={!props.hasRecord}
                onClick={() => activate("copy")}
              >
                Copy viewing link
              </button>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                tabIndex={-1}
                onClick={() => activate("json")}
              >
                Download design JSON
              </button>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                tabIndex={-1}
                onClick={() => activate("import")}
              >
                Import JSON
              </button>
              {props.canClaim && (
                <button
                  type="button"
                  role="menuitem"
                  className="dropdown-item"
                  tabIndex={-1}
                  onClick={() => activate("claim")}
                >
                  {props.signedIn ? "Claim this design" : "Sign in to claim"}
                </button>
              )}
              <button
                type="button"
                role="menuitemcheckbox"
                className="dropdown-item"
                tabIndex={-1}
                aria-checked={props.showSafeZone}
                onClick={() => {
                  close();
                  props.onToggleSafeZone();
                }}
              >
                <span>Safe area guides</span>
                <span className="dropdown-check">
                  {props.showSafeZone && <Check size={14} aria-hidden="true" />}
                </span>
              </button>
            </div>
          </>
        );
      }}
    </Dropdown>
  );
}
