import { useEffect, useState } from "react";
import { z } from "zod";
import {
  HostedMcpConsentSchema,
  HostedMcpDecisionResultSchema,
  HostedMcpDecisionSchema,
} from "@tinytldr/core";
import { useAccount } from "../hooks/useAccount.js";
import { FirebaseLoginDialog } from "../components/FirebaseLoginDialog.js";
import { requireFirebaseAuth } from "../lib/FirebaseClient.js";

export function McpAuthorizationPage() {
  const account = useAccount();
  const [consent, setConsent] = useState<z.infer<typeof HostedMcpConsentSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const requestId = new URLSearchParams(window.location.search).get("request");
  const nextPath = `${window.location.pathname}${window.location.search}`;
  const expired = consent !== null && now >= consent.expiresAt;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!account.ready) return;
    if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) {
      setError("This authorization link is invalid. Reconnect from your agent.");
      return;
    }
    const controller = new AbortController();
    setConsent(null);
    setError(null);
    void (async () => {
      const response = await fetch(`/consent/${requestId}`, { signal: controller.signal });
      if (!response.ok)
        throw new Error(
          "This authorization request expired or could not be loaded. Reconnect from your agent.",
        );
      const result = HostedMcpConsentSchema.parse(await response.json());
      if (!controller.signal.aborted) setConsent(result);
    })().catch((failure: unknown) => {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => controller.abort();
  }, [account.ready, requestId]);

  async function decide(approved: boolean) {
    if (busy || !consent || expired || !requestId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = requireFirebaseAuth();
      const owner = auth.currentUser;
      const token = approved ? await owner?.getIdToken(true) : undefined;
      if (approved && (!owner || !token || auth.currentUser?.uid !== owner.uid))
        throw new Error("Your account changed. Sign in again before authorizing.");
      const response = await fetch(`/consent/${requestId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(HostedMcpDecisionSchema.parse({ approved })),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        throw new Error(
          "Authorization could not be completed. Reconnect from your agent and try again.",
        );
      const result = HostedMcpDecisionResultSchema.parse(await response.json());
      if (approved && auth.currentUser?.uid !== owner?.uid)
        throw new Error("Your account changed during authorization. Reconnect from your agent.");
      window.location.replace(result.redirectUrl);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  }

  return (
    <main className="mcp-authorization-page">
      <section className="mcp-authorization-card" aria-labelledby="mcp-authorization-title">
        <p className="mcp-authorization-wordmark">tinytldr.</p>
        <h1 id="mcp-authorization-title">Connect your agent</h1>
        {consent && (
          <>
            <p>
              <strong>{consent.clientName}</strong> wants access to tinytldr rendering tools.
            </p>
            <dl>
              <dt>Returns to</dt>
              <dd>{consent.redirectOrigin}</dd>
              <dt>Permissions</dt>
              <dd>
                Validate, preview and export designs supplied by your agent. No access to your saved
                website designs or provider keys.
              </dd>
              <dt>Downloads</dt>
              <dd>
                Exports use private storage and shareable download links that expire in five
                minutes.
              </dd>
            </dl>
            <p className="muted">
              The client name is supplied by the agent. Only approve a connection you started and
              trust.
            </p>
            {account.user && (
              <p>
                Signed in as{" "}
                <strong>
                  {account.user.email ?? account.user.displayName ?? "your tinytldr account"}
                </strong>
                .
              </p>
            )}
            {expired && <p role="alert">Authorization expired. Reconnect from your agent.</p>}
            <div className="mcp-authorization-actions">
              <button
                className="dialog-secondary-button"
                disabled={busy || expired}
                onClick={() => {
                  void decide(false);
                }}
              >
                Cancel
              </button>
              {account.user ? (
                <button
                  className="primary-button"
                  disabled={busy || expired || !account.ready}
                  onClick={() => {
                    void decide(true);
                  }}
                >
                  {busy ? "Connecting..." : "Authorize agent"}
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={busy || expired || !account.ready}
                  onClick={() => setLoginOpen(true)}
                >
                  Sign in
                </button>
              )}
            </div>
            {account.user && (
              <button
                className="dialog-secondary-button"
                disabled={busy}
                onClick={() => {
                  void account
                    .signOut()
                    .catch((failure: unknown) =>
                      setError(failure instanceof Error ? failure.message : String(failure)),
                    );
                }}
              >
                Use another account
              </button>
            )}
          </>
        )}
        {!consent && !error && <p role="status">Loading authorization...</p>}
        {(error || account.error) && <p role="alert">{error ?? account.error}</p>}
      </section>
      {loginOpen && (
        <FirebaseLoginDialog
          account={account}
          purpose="mcp"
          nextPath={nextPath}
          onClose={() => setLoginOpen(false)}
        />
      )}
    </main>
  );
}
