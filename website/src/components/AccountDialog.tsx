import { useRef, useState } from "react";
import { CheckCircle2, ChevronRight, LogOut, Moon, Sun } from "lucide-react";
import { ACCOUNT_DISPLAY_NAME_MAX_LENGTH, AI_PROVIDER_NAMES } from "@tinytldr/core";
import type { Account } from "../hooks/useAccount.js";
import type { AiConnections } from "../hooks/useAiConnections.js";
import { AI_BACKEND_UNAVAILABLE_MESSAGE } from "../lib/AiRepository.js";
import { Dialog } from "./Dialog.js";
import { FirebaseLoginDialog } from "./FirebaseLoginDialog.js";

export function AccountDialog({
  account,
  providers,
  themeMode,
  onSetTheme,
  nextPath,
  onClose,
  onProviders,
}: {
  account: Account;
  providers: AiConnections;
  themeMode: "light" | "dark";
  onSetTheme: (theme: "light" | "dark") => void;
  nextPath: string;
  onClose: () => void;
  onProviders: () => void;
}) {
  const firstField = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(account.user?.displayName ?? "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"profile" | "signout" | null>(null);
  const [error, setError] = useState<{
    scope: "profile" | "account";
    message: string;
  } | null>(null);

  if (!account.user) {
    return <FirebaseLoginDialog account={account} nextPath={nextPath} onClose={onClose} />;
  }

  let connectionStatus = "AI is not connected.";
  if (AI_BACKEND_UNAVAILABLE_MESSAGE) {
    connectionStatus = AI_BACKEND_UNAVAILABLE_MESSAGE;
  } else if (providers.loading) {
    connectionStatus = "Loading connections...";
  } else if (providers.error) {
    connectionStatus = providers.error;
  } else if (providers.connections.length) {
    connectionStatus = `Connected to ${AI_PROVIDER_NAMES[providers.connections[0]!.provider]}.`;
  }

  return (
    <Dialog
      className="account-dialog"
      title="Account & settings"
      description="Your profile and workspace preferences."
      onClose={onClose}
      closeLabel="Close account dialog"
      initialFocus={firstField}
      footer={
        <>
          <p className="app-dialog-footer-note">Sign out of this browser.</p>
          <button
            className="dialog-secondary-button"
            type="button"
            disabled={!!busy}
            onClick={() => {
              setBusy("signout");
              setError(null);
              void account
                .signOut()
                .then(onClose)
                .catch((err: unknown) => {
                  setError({
                    scope: "account",
                    message: err instanceof Error ? err.message : String(err),
                  });
                  setBusy(null);
                });
            }}
          >
            <LogOut size={15} aria-hidden="true" />
            {busy === "signout" ? "Signing out..." : "Sign out"}
          </button>
          {error?.scope === "account" && (
            <p role="alert" className="notice-error account-signout-error">
              {error.message}
            </p>
          )}
        </>
      }
    >
      <>
        <section className="account-section" aria-labelledby="account-profile-title">
          <h3 id="account-profile-title">Profile</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setBusy("profile");
              setError(null);
              setSaved(false);
              void account
                .updateDisplayName(displayName)
                .then(() => {
                  setDisplayName(displayName.trim());
                  setSaved(true);
                })
                .catch((err: unknown) => {
                  setError({
                    scope: "profile",
                    message: err instanceof Error ? err.message : String(err),
                  });
                })
                .finally(() => setBusy(null));
            }}
          >
            <label htmlFor="account-display-name">Display name</label>
            <div className="account-name-row">
              <input
                ref={firstField}
                id="account-display-name"
                autoComplete="nickname"
                maxLength={ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
                aria-invalid={error?.scope === "profile"}
                aria-describedby={
                  error?.scope === "profile" ? "account-profile-error" : "account-name-hint"
                }
                value={displayName}
                disabled={!!busy}
                placeholder="Your name"
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setSaved(false);
                  setError(null);
                }}
              />
              <button
                className="primary-button"
                type="submit"
                disabled={!!busy || displayName.trim() === account.user.displayName}
              >
                {busy === "profile" ? "Saving..." : "Save name"}
              </button>
            </div>
            <p id="account-name-hint" className="account-hint">
              Optional. Up to {ACCOUNT_DISPLAY_NAME_MAX_LENGTH} characters.
            </p>
            {error?.scope === "profile" && (
              <p id="account-profile-error" role="alert" className="notice-error">
                {error.message}
              </p>
            )}
            {saved && (
              <p role="status" className="account-save-status">
                Profile saved.
              </p>
            )}
          </form>
          <div className="account-email-label">
            <label htmlFor="account-email">Email address</label>
            <span className="account-status-badge">
              {account.user.emailVerified && <CheckCircle2 size={12} aria-hidden="true" />}
              {account.user.emailVerified ? "Verified" : "Not verified"}
            </span>
          </div>
          <input id="account-email" type="text" readOnly value={account.user.email ?? ""} />
          <p className="account-hint">
            Signed in.{" "}
            {account.user.emailVerified
              ? "This is your sign-in email."
              : "This account's email has not been verified."}
          </p>
        </section>
        <section className="account-section" aria-labelledby="account-appearance-title">
          <h3 id="account-appearance-title">Appearance</h3>
          <p className="muted">Choose how tinytldr looks on this browser.</p>
          <div className="account-appearance" role="group" aria-label="Appearance">
            <button
              type="button"
              aria-pressed={themeMode === "light"}
              onClick={() => onSetTheme("light")}
            >
              <Sun size={16} aria-hidden="true" /> Day
            </button>
            <button
              type="button"
              aria-pressed={themeMode === "dark"}
              onClick={() => onSetTheme("dark")}
            >
              <Moon size={16} aria-hidden="true" /> Night
            </button>
          </div>
        </section>
        <section className="account-section" aria-labelledby="account-connections-title">
          <div className="account-section-heading">
            <h3 id="account-connections-title">AI connections</h3>
            {AI_BACKEND_UNAVAILABLE_MESSAGE && (
              <span className="account-status-badge">Unavailable</span>
            )}
          </div>
          <p
            role={providers.error && !AI_BACKEND_UNAVAILABLE_MESSAGE ? "alert" : "status"}
            className={
              providers.error && !AI_BACKEND_UNAVAILABLE_MESSAGE ? "notice-error" : "muted"
            }
          >
            {connectionStatus}
          </p>
          {!AI_BACKEND_UNAVAILABLE_MESSAGE && (
            <button
              className="account-manage-link text-link"
              type="button"
              disabled={!!busy}
              onClick={onProviders}
            >
              Manage AI connection <ChevronRight size={14} aria-hidden="true" />
            </button>
          )}
        </section>
      </>
    </Dialog>
  );
}
