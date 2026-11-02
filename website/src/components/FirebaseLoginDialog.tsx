import { useId, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { Account } from "../hooks/useAccount.js";
import { firebaseSignInError } from "../lib/FirebaseAccount.js";
import { Dialog } from "./Dialog.js";

type LoginMode = "signin" | "signup" | "reset";

export function FirebaseLoginDialog({
  account,
  nextPath,
  onClose,
  purpose = "workspace",
}: {
  account: Account;
  nextPath: string;
  onClose: () => void;
  purpose?: "workspace" | "mcp";
}) {
  const formId = useId();
  const emailField = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<LoginMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const action =
    mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in";

  function changeMode(next: LoginMode) {
    setMode(next);
    setPassword("");
    setShowPassword(false);
    setError(null);
    setResetSent(false);
  }

  return (
    <Dialog
      className="firebase-login-dialog"
      size="compact"
      title={
        mode === "signup"
          ? "Create your account"
          : mode === "reset"
            ? "Reset your password"
            : "Sign in"
      }
      description={
        mode === "reset"
          ? "Get back to your workspace."
          : purpose === "mcp"
            ? "Connect with your tinytldr account."
            : "Your designs, anywhere."
      }
      closeLabel="Close account dialog"
      initialFocus={emailField}
      onClose={onClose}
      footer={
        <>
          {mode !== "signin" && (
            <button
              className="dialog-secondary-button"
              type="button"
              disabled={!!busy}
              onClick={() => changeMode("signin")}
            >
              Back to sign in
            </button>
          )}
          {resetSent ? (
            <button className="primary-button" type="button" onClick={onClose}>
              Close
            </button>
          ) : (
            <button className="primary-button" type="submit" form={formId} disabled={!!busy}>
              {busy === "email"
                ? mode === "reset"
                  ? "Sending..."
                  : mode === "signup"
                    ? "Creating..."
                    : "Signing in..."
                : action}
            </button>
          )}
        </>
      }
    >
      {resetSent ? (
        <p role="status">
          If an account uses {email.trim()}, you'll receive an email with a link to reset its
          password. Open it to choose your new password, then return here to sign in.
        </p>
      ) : (
        <>
          <p className="muted">
            {mode === "reset"
              ? "Enter your account email. You can also use this to set a password for an existing email-link account."
              : purpose === "mcp"
                ? "Sign in with your existing account to authorize your agent's rendering tools."
                : "An account is optional. Sign in to claim designs and find them on any device."}
          </p>
          {mode !== "reset" && (
            <>
              <button
                className="dialog-secondary-button firebase-google-button"
                type="button"
                disabled={!!busy}
                onClick={() => {
                  if (busy) return;
                  setBusy("google");
                  setError(null);
                  void account
                    .signInWithGoogle()
                    .then(onClose)
                    .catch((err: unknown) => setError(firebaseSignInError(err)))
                    .finally(() => setBusy(null));
                }}
              >
                {busy === "google" ? "Opening Google..." : "Continue with Google"}
              </button>
              <div className="firebase-login-divider" aria-hidden="true">
                or use your email
              </div>
            </>
          )}
          <form
            id={formId}
            className="firebase-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setBusy("email");
              setError(null);
              const request =
                mode === "reset"
                  ? account.resetPassword(email, nextPath)
                  : mode === "signup"
                    ? account.createPasswordAccount(email, password, nextPath)
                    : account.signInWithPassword(email, password);
              void request
                .then(() => {
                  setPassword("");
                  if (mode === "reset") setResetSent(true);
                  else if (mode === "signin") onClose();
                })
                .catch((err: unknown) =>
                  setError(firebaseSignInError(err, mode === "reset" ? "reset" : "signin")),
                )
                .finally(() => setBusy(null));
            }}
          >
            <div className="firebase-login-field">
              <label htmlFor={`${formId}-email`}>Email address</label>
              <input
                ref={emailField}
                id={`${formId}-email`}
                type="email"
                required
                autoComplete="username"
                disabled={!!busy}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
            {mode !== "reset" && (
              <div className="firebase-login-field">
                <div className="firebase-login-label-row">
                  <label htmlFor={`${formId}-password`}>Password</label>
                  {mode === "signin" && (
                    <button
                      className="firebase-login-link"
                      type="button"
                      disabled={!!busy}
                      onClick={() => changeMode("reset")}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="firebase-password-field">
                  <input
                    id={`${formId}-password`}
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    disabled={!!busy}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    disabled={!!busy}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? (
                      <EyeOff size={16} aria-hidden="true" />
                    ) : (
                      <Eye size={16} aria-hidden="true" />
                    )}
                  </button>
                </div>
                {mode === "signup" && (
                  <p className="firebase-login-hint">
                    We'll email you a link to verify your account.
                  </p>
                )}
              </div>
            )}
          </form>
          {mode === "signin" && (
            <p className="firebase-login-switch">
              New here?{" "}
              <button
                className="firebase-login-link"
                type="button"
                disabled={!!busy}
                onClick={() => changeMode("signup")}
              >
                Create account
              </button>
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="notice-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
