import { useCallback, useEffect, useRef, useState } from "react";
import { useThemeMode } from "./hooks/useThemeMode.js";
import {
  parseLocationRoute,
  resolveAuthReturnPath,
  type ParsedRoute,
  type DocsSectionId,
} from "./state/RouterState.js";
import { PlaygroundPage } from "./pages/PlaygroundPage.js";
import { DocsPage } from "./pages/DocsPage.js";
import { AccountDialog } from "./components/AccountDialog.js";
import { FirebaseAiConnectionDialog } from "./components/FirebaseAiConnectionDialog.js";
import { SiteFooter } from "./components/SiteFooter.js";
import {
  WorkspaceGuideDialog,
  WELCOME_STORAGE_KEY,
  type WorkspaceGuideTopic,
} from "./components/WorkspaceGuideDialog.js";
import { useAccount } from "./hooks/useAccount.js";
import { useAiConnections } from "./hooks/useAiConnections.js";
import { useDesignHistory } from "./hooks/useDesignHistory.js";
import { listAccountDesigns } from "./lib/DesignRepository.js";
import type { SavedWorkspaceDesign } from "@tinytldr/core";

export function App() {
  const { themeMode, setThemeMode } = useThemeMode();
  const account = useAccount();
  const providers = useAiConnections(account.user?.id);
  const history = useDesignHistory();
  const [showAccount, setShowAccount] = useState(false);
  const [showProviders, setShowProviders] = useState(false);
  const [sourceEditorsOpen, setSourceEditorsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [ownedDesigns, setOwnedDesigns] = useState<SavedWorkspaceDesign[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [route, setRoute] = useState<ParsedRoute>(() =>
    typeof window !== "undefined"
      ? parseLocationRoute(window.location.pathname, window.location.search)
      : { page: "playground", pathname: "/" },
  );
  const [guideTopic, setGuideTopic] = useState<WorkspaceGuideTopic | null>(
    route.page === "docs" ? "docs" : null,
  );
  const [docsSection, setDocsSection] = useState<DocsSectionId>(route.docsSection ?? "quickstart");
  const [welcomeError, setWelcomeError] = useState<string | null>(null);
  const checkedWelcome = useRef(false);

  useEffect(() => {
    if (route.page !== "playground" || checkedWelcome.current) return;
    checkedWelcome.current = true;
    try {
      if (localStorage.getItem(WELCOME_STORAGE_KEY) !== "seen") {
        setGuideTopic("welcome");
        localStorage.setItem(WELCOME_STORAGE_KEY, "seen");
      }
    } catch (err) {
      setGuideTopic("welcome");
      setWelcomeError(
        `Could not remember the welcome guide in this browser: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [route.page]);

  useEffect(() => {
    const onPopState = () => {
      const nextRoute = parseLocationRoute(window.location.pathname, window.location.search);
      setRoute(nextRoute);
      setGuideTopic(nextRoute.page === "docs" ? "docs" : null);
      if (nextRoute.docsSection) setDocsSection(nextRoute.docsSection);
      setNavigationVersion((value) => value + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateTo = useCallback((targetPath: string) => {
    const url = new URL(targetPath, window.location.origin);
    const nextRoute = parseLocationRoute(url.pathname, url.search);
    if (nextRoute.page === "docs") {
      setDocsSection(nextRoute.docsSection ?? "quickstart");
      setGuideTopic("docs");
      return;
    }
    setGuideTopic(null);
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
    setRoute(nextRoute);
    setNavigationVersion((value) => value + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const refreshLibrary = useCallback(() => setLibraryVersion((value) => value + 1), []);
  const openAccount = useCallback(() => setShowAccount(true), []);

  useEffect(() => {
    let active = true;
    setOwnedDesigns([]);
    setLibraryError(null);
    if (account.user) {
      void listAccountDesigns()
        .then((designs) => {
          if (active) setOwnedDesigns(designs);
        })
        .catch((err: unknown) => {
          if (active) setLibraryError(err instanceof Error ? err.message : String(err));
        });
    }
    return () => {
      active = false;
    };
  }, [account.user?.id, libraryVersion]);

  useEffect(() => {
    if (route.page !== "authCallback" || !account.ready || !account.user) return;
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    let target = "/";
    try {
      target = resolveAuthReturnPath(next, window.location.origin);
    } catch {
      console.warn("Ignored invalid sign-in return path; opening your workspace.");
    }
    navigateTo(target);
  }, [route.page, account.ready, account.user, navigateTo]);

  return (
    <div className="ui-app">
      {(history.error || account.error || libraryError || welcomeError) && (
        <div className="global-notice notice-error" role="alert">
          {history.error ?? account.error ?? libraryError ?? welcomeError}
        </div>
      )}

      <main className="workspace-main">
        {route.page === "authCallback" ? (
          <p role="status" className="global-notice">
            {account.ready ? "Sign in to continue to your workspace." : "Finishing sign-in..."}
          </p>
        ) : null}
        <PlaygroundPage
          key={`${route.pathname}:${navigationVersion}`}
          initialTemplateId={route.templateId}
          initialSize={route.initialSize}
          initialTheme={route.initialTheme}
          designId={route.designId}
          localId={route.localId}
          account={account}
          providers={providers}
          onManageProviders={() => setShowProviders(true)}
          history={history}
          sourceEditorsOpen={sourceEditorsOpen}
          onToggleSourceEditors={() => setSourceEditorsOpen((open) => !open)}
          sidebarCollapsed={sidebarCollapsed}
          onToggleDesktopSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
          ownedDesigns={ownedDesigns}
          onNavigate={navigateTo}
          onSignIn={openAccount}
          onPersisted={refreshLibrary}
          themeMode={themeMode}
          onWelcome={() => setGuideTopic("welcome")}
          onMcp={() => setGuideTopic("mcp")}
        />
      </main>
      <SiteFooter
        onWelcome={() => setGuideTopic("welcome")}
        onMcp={() => setGuideTopic("mcp")}
        themeMode={themeMode}
        onSetTheme={setThemeMode}
      />

      {guideTopic && (
        <WorkspaceGuideDialog
          topic={guideTopic}
          onTopicChange={setGuideTopic}
          onClose={() => setGuideTopic(null)}
        >
          {guideTopic === "docs" && (
            <DocsPage initialSection={docsSection} onNavigate={navigateTo} />
          )}
        </WorkspaceGuideDialog>
      )}
      {showAccount && (
        <AccountDialog
          key={account.user?.id ?? "guest"}
          account={account}
          providers={providers}
          themeMode={themeMode}
          onSetTheme={setThemeMode}
          nextPath={
            route.page === "authCallback"
              ? (new URLSearchParams(window.location.search).get("next") ?? "/")
              : `${window.location.pathname}${window.location.search}`
          }
          onClose={() => setShowAccount(false)}
          onProviders={() => {
            setShowAccount(false);
            setShowProviders(true);
          }}
        />
      )}
      {showProviders && account.user && (
        <FirebaseAiConnectionDialog
          key={account.user.id}
          providers={providers}
          onClose={() => setShowProviders(false)}
        />
      )}
    </div>
  );
}
