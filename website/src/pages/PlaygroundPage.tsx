import { useEffect, useId, useRef, useState } from "react";
import {
  CircleCheck,
  X,
  Code2,
  CopyPlus,
  LoaderCircle,
  Pause,
  Play,
  Ratio,
  Save,
} from "lucide-react";
import {
  MediaFormatSchema,
  SizePresetIdSchema,
  TemplateManifestSchema,
  WorkspaceDesignDocumentSchema,
  type SavedWorkspaceDesign,
} from "@tinytldr/core";
import { z } from "zod";
import { DesignSidebar } from "../components/DesignSidebar.js";
import { SiteHeader } from "../components/SiteHeader.js";
import { MediaLibrary } from "../components/MediaLibrary.js";
import { ArtboardCanvas } from "../components/ArtboardCanvas.js";
import { AiComposer } from "../components/AiComposer.js";
import { SourceEditor } from "../components/SourceEditor.js";
import { PreviewSplit } from "../components/PreviewSplit.js";
import { WorkspaceMenu } from "../components/WorkspaceMenu.js";
import { VersionHistoryMenu } from "../components/VersionHistoryMenu.js";
import { DropdownSelect } from "../components/DropdownSelect.js";
import { DesignActionDialog } from "../components/DesignActionDialog.js";
import type { DesignListTarget, DesignListMutation } from "../lib/DesignRepository.js";
import { useDesignWorkspace } from "../hooks/useDesignWorkspace.js";
import { useSandboxPreview } from "../hooks/useSandboxPreview.js";
import { useExportJob } from "../hooks/useExportJob.js";
import type { Account } from "../hooks/useAccount.js";
import type { AiConnections } from "../hooks/useAiConnections.js";
import type { DesignHistory } from "../hooks/useDesignHistory.js";
import type { SiteThemeMode } from "../hooks/useThemeMode.js";
import { SIZE_PRESETS, compileArtboardHtml, type SizePresetId } from "../lib/BrowserCompiler.js";
import { LocalDesignSchema, PageJsonSchema } from "../lib/DesignHistory.js";

export interface PlaygroundPageProps {
  initialTemplateId?: string;
  initialSize?: SizePresetId;
  initialTheme?: string;
  designId?: string;
  localId?: string;
  account: Account;
  providers: AiConnections;
  onManageProviders: () => void;
  history: DesignHistory;
  sourceEditorsOpen: boolean;
  onToggleSourceEditors: () => void;
  sidebarCollapsed: boolean;
  onToggleDesktopSidebar: () => void;
  ownedDesigns: readonly SavedWorkspaceDesign[];
  onNavigate: (path: string) => void;
  onSignIn: () => void;
  onPersisted: () => void;
  themeMode: SiteThemeMode;
  onWelcome: () => void;
  onMcp: () => void;
  libraryOpen: boolean;
  onLibraryChange: (open: boolean) => void;
  workspaceVisible: boolean;
}

export function PlaygroundPage(props: PlaygroundPageProps) {
  const studio = useDesignWorkspace({ ...props, userId: props.account.user?.id });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [designAction, setDesignAction] = useState<{
    action: "rename" | "delete";
    target: DesignListTarget;
  } | null>(null);
  const [seekMs, setSeekMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const sidebarDialog = useRef<HTMLDialogElement>(null);
  const [mobileSidebar, setMobileSidebar] = useState(
    () => window.matchMedia("(max-width: 900px)").matches,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { sidebarCollapsed, sourceEditorsOpen } = props;
  const sourceEditorsId = useId();
  const { libraryOpen } = props;
  const [composerHeight, setComposerHeight] = useState(160);
  const [promptControlsRoot, setPromptControlsRoot] = useState<HTMLDivElement | null>(null);
  const exporter = useExportJob(props.account.user?.id ?? null);
  const compiled = studio.preview.compiled;
  const durationMs = compiled?.durationMs ?? 0;
  const { iframeRef, runtimeState } = useSandboxPreview({
    revision: studio.preview.revision,
    seekMs,
    durationMs,
  });
  const doc = studio.preview.document ?? studio.document;
  const manifest = studio.preview.manifest ?? doc.template.manifest;
  const dimensions = typeof doc.size === "string" ? SIZE_PRESETS[doc.size] : doc.size;
  const supportedSizes = manifest.supportedSizes.filter((id) =>
    studio.previews.every((item) =>
      (item.manifest ?? item.page.template.manifest).supportedSizes.includes(id),
    ),
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setMobileSidebar(media.matches);
      setSidebarOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (sidebarOpen && mobileSidebar) sidebarDialog.current?.showModal();
    else sidebarDialog.current?.close();
  }, [sidebarOpen, mobileSidebar]);
  useEffect(() => {
    setPlaying(false);
    setSeekMs(Math.round(durationMs * 0.85));
  }, [durationMs, studio.activePageId, studio.selectedVersion]);
  useEffect(() => {
    if (!playing || durationMs === 0) return;
    const timer = window.setInterval(
      () =>
        setSeekMs((value) => {
          const next = Math.min(durationMs, value + 1000 / 30);
          if (next >= durationMs) setPlaying(false);
          return next;
        }),
      1000 / 30,
    );
    return () => window.clearInterval(timer);
  }, [playing, durationMs]);

  const runAction = async (action: string) => {
    setActionError(null);
    setActionMessage(null);
    try {
      if (action === "copy") {
        if (!studio.record)
          throw new Error(
            "Save a link first. Browser-only drafts cannot be opened on other devices.",
          );
        await navigator.clipboard.writeText(`${window.location.origin}/d/${studio.record.id}`);
        setActionMessage("Public viewing link copied. Your private edit key is not included.");
      } else if (action === "html") {
        if (!studio.validProject)
          throw new Error("Fix every page's errors before exporting rendered HTML.");
        exporter.downloadHtmlFile(
          "design.html",
          compileArtboardHtml(studio.previews.map((item) => item.compiled!)),
        );
      } else if (action === "source-html") {
        exporter.downloadTextFile(
          "template.liquid",
          doc.template.liquidTemplate,
          "text/plain;charset=utf-8",
        );
      } else if (action === "source-css") {
        exporter.downloadTextFile("styles.css", doc.template.stylesCss, "text/css;charset=utf-8");
      } else if (action === "source-json") {
        if (!studio.preview.manifest)
          throw new Error(
            "Fix the template JSON before exporting its MCP contract. Use Download design JSON to recover an unfinished draft.",
          );
        exporter.downloadJsonFile("template.json", studio.preview.manifest);
      } else if (action === "json") {
        exporter.downloadJsonFile("design.json", studio.validProject ?? studio.recovery);
      } else if (action === "import") {
        importInput.current?.click();
      } else if (action === "claim") {
        if (props.account.user) await studio.claim();
        else props.onSignIn();
      } else {
        const format = MediaFormatSchema.parse(action);
        if (!studio.validProject) throw new Error("Fix every page's errors before exporting.");
        await exporter.requestWorkspaceExport({
          document: studio.validProject,
          format,
          sourcePath: `/${studio.record ? "d" : "local"}/${studio.activeId}`,
        });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const notices = [
    studio.error,
    actionError,
    !sourceEditorsOpen && studio.projectError
      ? `Open source editors to fix this design: ${studio.projectError}`
      : null,
    exporter.exportStatus.state === "error" ? exporter.exportStatus.message : null,
  ].filter(Boolean);
  const warnings = [...(compiled?.validationWarnings ?? []), ...runtimeState.runtimeWarnings];
  const summary = studio.record
    ? studio.dirty
      ? "Unsaved changes"
      : studio.record.owner_id
        ? "Saved to your account"
        : "Unclaimed design"
    : "Browser draft";
  const closeSidebarAnd = (action: () => void) => {
    sidebarDialog.current?.close();
    setSidebarOpen(false);
    action();
  };
  const startNewDesign = () =>
    closeSidebarAnd(() => {
      props.onLibraryChange(false);
      void studio.createNewDesign();
    });
  const openLibrary = () => {
    setPlaying(false);
    props.onLibraryChange(true);
  };
  const sidebar = (
    <DesignSidebar
      history={props.history}
      ownedDesigns={props.ownedDesigns}
      signedIn={!!props.account.user}
      onNewDesign={startNewDesign}
      activeId={libraryOpen ? undefined : studio.activeId}
      libraryOpen={libraryOpen}
      onLibrary={() =>
        closeSidebarAnd(libraryOpen ? () => props.onLibraryChange(false) : openLibrary)
      }
      onNavigate={props.onNavigate}
      onSignIn={() => closeSidebarAnd(props.onSignIn)}
      onWelcome={() => closeSidebarAnd(props.onWelcome)}
      onMcp={() => closeSidebarAnd(props.onMcp)}
      hidden={!mobileSidebar && sidebarCollapsed}
      onClose={mobileSidebar ? () => setSidebarOpen(false) : undefined}
      busy={studio.busy || studio.loading || studio.versionLoading || !props.account.ready}
      onDesignAction={(target, action) =>
        closeSidebarAnd(() => {
          const currentTarget =
            target.id === studio.activeId
              ? {
                  ...target,
                  title: studio.project.title || "Untitled design",
                  saved: !!studio.record,
                  revision: studio.record?.revision ?? target.revision,
                }
              : target;
          studio.clearError();
          if (action === "claim") {
            if (!props.account.user) props.onSignIn();
            else void studio.actOnDesign(currentTarget, { action });
          } else setDesignAction({ target: currentTarget, action });
        })
      }
    />
  );

  return (
    <div
      className={`workspace-shell${!mobileSidebar && sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
    >
      {mobileSidebar ? (
        <dialog
          id="design-sidebar-drawer"
          className="sidebar-drawer"
          ref={sidebarDialog}
          aria-label="Your designs menu"
          onCancel={() => setSidebarOpen(false)}
          onClose={() => setSidebarOpen(false)}
        >
          {sidebar}
        </dialog>
      ) : (
        sidebar
      )}
      {designAction && (
        <DesignActionDialog
          action={designAction.action}
          target={designAction.target}
          busy={studio.busy}
          error={studio.error}
          onClose={() => setDesignAction(null)}
          onConfirm={async (title) => {
            const mutation: DesignListMutation =
              designAction.action === "rename" ? { action: "rename", title } : { action: "delete" };
            if (await studio.actOnDesign(designAction.target, mutation)) setDesignAction(null);
          }}
        />
      )}
      <section className="studio-workspace" aria-label="Design workspace">
        <SiteHeader
          sidebarOpen={mobileSidebar ? sidebarOpen : !sidebarCollapsed}
          sidebarControls={mobileSidebar ? "design-sidebar-drawer" : "design-sidebar"}
          onToggleSidebar={() => {
            if (mobileSidebar) setSidebarOpen((open) => !open);
            else props.onToggleDesktopSidebar();
          }}
          title={
            libraryOpen ? (
              <h1 className="library-header-title">My Library</h1>
            ) : (
              <>
                <h1 className="sr-only">{studio.project.title || "Untitled design"}</h1>
                <input
                  aria-label="Design title"
                  className="design-title-input"
                  maxLength={120}
                  disabled={studio.busy || studio.loading || !!studio.loadError}
                  value={studio.project.title}
                  onChange={(event) => studio.setTitle(event.target.value)}
                />
                <p className="save-caption sr-only" role="status">
                  {studio.loading
                    ? "Opening..."
                    : studio.versionLoading
                      ? "Loading version..."
                      : studio.busy
                        ? "Saving..."
                        : summary}
                </p>
              </>
            )
          }
          actions={
            <>
              {libraryOpen ? null : (
                <>
                  {studio.canClaim && (
                    <button
                      type="button"
                      className="header-icon-button header-labeled-button header-claim-button"
                      aria-label="Claim"
                      title="Claim this design for your account"
                      disabled={
                        studio.busy ||
                        studio.loading ||
                        !!studio.loadError ||
                        !props.account.ready ||
                        !studio.validProject
                      }
                      onClick={() => void runAction("claim")}
                    >
                      <span className="header-action-label">Claim</span>
                      <CircleCheck size={17} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="header-icon-button header-labeled-button header-save-button"
                    aria-label={
                      studio.versionLoading
                        ? "Loading version..."
                        : studio.busy
                          ? "Saving..."
                          : studio.canUpdate
                            ? "Save"
                            : "Save copy"
                    }
                    aria-busy={studio.busy}
                    title={
                      studio.versionLoading
                        ? "Loading version..."
                        : studio.busy
                          ? "Saving..."
                          : `${studio.canUpdate ? "Save" : "Save copy"} · ${summary}`
                    }
                    disabled={
                      studio.busy ||
                      studio.loading ||
                      !!studio.loadError ||
                      !props.account.ready ||
                      !studio.validProject
                    }
                    onClick={() => void studio.save()}
                  >
                    {studio.busy ? (
                      <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
                    ) : studio.canUpdate ? (
                      <Save size={17} aria-hidden="true" />
                    ) : (
                      <CopyPlus size={17} aria-hidden="true" />
                    )}
                    <span className="header-action-label" aria-hidden="true">
                      {studio.canUpdate ? "Save" : "Save copy"}
                    </span>
                  </button>
                  <VersionHistoryMenu
                    key={studio.activeId}
                    disabled={studio.busy || studio.loading || !!studio.loadError}
                    hasRecord={!!studio.record}
                    canRead={studio.canReadVersions}
                    revision={studio.record?.revision}
                    selected={studio.selectedVersion}
                    onLoad={studio.listVersions}
                    onSelect={async (revision) => {
                      if (!studio.canReadVersions) return true;
                      if (
                        studio.dirty &&
                        !window.confirm(
                          "Replace your unsaved changes with this saved version? Download design JSON first if you want to keep a recovery copy.",
                        )
                      )
                        return false;
                      setPlaying(false);
                      return studio.loadVersion(revision);
                    }}
                  />
                </>
              )}
              {!libraryOpen && (
                <WorkspaceMenu
                  disabled={
                    studio.busy ||
                    studio.loading ||
                    !!studio.loadError ||
                    exporter.exportStatus.state === "exporting"
                  }
                  canExport={!!studio.validProject}
                  hasRecord={!!studio.record}
                  canClaim={studio.canClaim}
                  signedIn={!!props.account.user}
                  showSafeZone={showSafeZone}
                  onToggleSafeZone={() => setShowSafeZone(!showSafeZone)}
                  onAction={(action) => void runAction(action)}
                />
              )}
            </>
          }
        />
        {libraryOpen && (
          <MediaLibrary
            key={props.account.user?.id ?? "guest"}
            userId={props.account.user?.id ?? null}
            onBack={() => props.onLibraryChange(false)}
          />
        )}
        <div className="studio-editor-pane" hidden={libraryOpen}>
          {studio.loading ? (
            <div className="workspace-loading is-opening" role="status">
              <span className="workspace-loading-spinner" aria-hidden="true" />
              <p>Opening your canvas...</p>
            </div>
          ) : studio.loadError ? (
            <div className="workspace-loading">
              <h1>Could not open this design.</h1>
              <p className="notice-error" role="alert">
                {studio.loadError}
              </p>
              {studio.error && (
                <p className="notice-error" role="alert">
                  {studio.error}
                </p>
              )}
              <button
                type="button"
                className="text-link"
                onClick={startNewDesign}
                disabled={studio.busy || !props.account.ready}
              >
                Start a new design &rarr;
              </button>
            </div>
          ) : (
            <>
              <div className="workspace-notices">
                {notices.map((notice, index) => (
                  <p key={index} role="alert" className="workspace-notice notice-error">
                    {notice}
                  </p>
                ))}
                {(actionMessage || studio.message) && (
                  <p role="status" className="workspace-notice">
                    {actionMessage ?? studio.message}
                  </p>
                )}
                {(exporter.exportStatus.state === "exporting" ||
                  exporter.exportStatus.state === "done") && (
                  <div role="status" className="workspace-notice export-notice">
                    <span>{exporter.exportStatus.message}</span>
                    {exporter.exportStatus.state === "done" && (
                      <>
                        <button type="button" className="notice-button" onClick={openLibrary}>
                          View library
                        </button>
                        <button
                          type="button"
                          className="notice-button notice-close"
                          onClick={exporter.dismissExportStatus}
                        >
                          <X size={13} aria-hidden="true" /> Close
                        </button>
                      </>
                    )}
                  </div>
                )}
                {!!exporter.exportStatus.warnings?.length && (
                  <details className="workspace-notice">
                    <summary>Export notes ({exporter.exportStatus.warnings.length})</summary>
                    {exporter.exportStatus.warnings.map((warning, index) => (
                      <p key={index}>{warning}</p>
                    ))}
                  </details>
                )}
                {studio.conflictingDraft && (
                  <p className="workspace-notice">
                    There is a newer online revision. Your browser draft is still safe.{" "}
                    <button type="button" className="text-link" onClick={studio.recoverAsCopy}>
                      Recover it as a copy &rarr;
                    </button>
                  </p>
                )}
                {studio.record && !studio.canUpdate && (
                  <p className="workspace-notice">
                    You&rsquo;re viewing someone else&rsquo;s design. Make it your own by saving a
                    copy.
                  </p>
                )}
              </div>
              <PreviewSplit
                editorsVisible={sourceEditorsOpen}
                editorsId={sourceEditorsId}
                preview={
                  <div className="studio-canvas">
                    {typeof doc.size !== "string" && (
                      <div className="custom-dimensions">
                        <label>
                          W{" "}
                          <input
                            aria-label="Custom width"
                            type="number"
                            min={64}
                            max={4096}
                            disabled={studio.busy}
                            value={dimensions.width}
                            onChange={(event) =>
                              studio.setDocument({
                                ...doc,
                                size: {
                                  width: Number(event.target.value),
                                  height: dimensions.height,
                                },
                              })
                            }
                          />
                        </label>
                        <span aria-hidden="true">&times;</span>
                        <label>
                          H{" "}
                          <input
                            aria-label="Custom height"
                            type="number"
                            min={64}
                            max={4096}
                            disabled={studio.busy}
                            value={dimensions.height}
                            onChange={(event) =>
                              studio.setDocument({
                                ...doc,
                                size: {
                                  width: dimensions.width,
                                  height: Number(event.target.value),
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                    )}
                    <ArtboardCanvas
                      boards={studio.previews}
                      activePageId={studio.activePageId}
                      dimensions={
                        compiled?.dimensions ?? {
                          ...dimensions,
                          aspectRatio: `${dimensions.width}:${dimensions.height}`,
                          presetId: typeof doc.size === "string" ? doc.size : undefined,
                        }
                      }
                      iframeRef={iframeRef}
                      showSafeZone={showSafeZone}
                      disabled={studio.busy}
                      onSelect={studio.selectPage}
                      onUpdate={studio.updatePage}
                      onAdd={studio.addPage}
                      onRemove={studio.removePage}
                      bottomInset={composerHeight + 24}
                      promptControlsRef={setPromptControlsRoot}
                      editorControls={
                        <>
                          <div className="canvas-editor-control">
                            <button
                              type="button"
                              className="source-editors-toggle"
                              aria-label="Source editors"
                              aria-expanded={sourceEditorsOpen}
                              aria-controls={sourceEditorsId}
                              title={
                                sourceEditorsOpen ? "Hide source editors" : "Show source editors"
                              }
                              disabled={studio.loading || !!studio.loadError}
                              onClick={props.onToggleSourceEditors}
                            >
                              <Code2 size={14} aria-hidden="true" />
                            </button>
                          </div>
                          <div className="canvas-editor-control">
                            <DropdownSelect
                              label="Canvas size"
                              triggerClassName="canvas-size-control"
                              title={`Canvas size: ${typeof doc.size === "string" ? SIZE_PRESETS[doc.size].label : `${dimensions.width} × ${dimensions.height}`}`}
                              trigger={<Ratio size={14} aria-hidden="true" />}
                              disabled={studio.busy || studio.loading || !!studio.loadError}
                              value={typeof doc.size === "string" ? doc.size : "custom"}
                              onChange={(value) =>
                                studio.setDocument({
                                  ...doc,
                                  size:
                                    value === "custom"
                                      ? { width: dimensions.width, height: dimensions.height }
                                      : SizePresetIdSchema.parse(value),
                                })
                              }
                              options={[
                                ...(typeof doc.size === "string" &&
                                !supportedSizes.includes(doc.size)
                                  ? [
                                      {
                                        value: doc.size,
                                        label: `${SIZE_PRESETS[doc.size].label} (unsupported)`,
                                        disabled: true,
                                      },
                                    ]
                                  : []),
                                ...supportedSizes.map((value) => ({
                                  value,
                                  label: SIZE_PRESETS[value].label,
                                })),
                                { value: "custom", label: "Custom size" },
                              ]}
                            />
                          </div>
                        </>
                      }
                      overlay={
                        <AiComposer
                          key={props.account.user?.id ?? "guest"}
                          userId={props.account.user?.id}
                          document={studio.validProject}
                          sourcePath={`/${studio.record ? "d" : "local"}/${studio.activeId}`}
                          recovery={studio.recovery}
                          providers={props.providers}
                          disabled={studio.busy}
                          onSignIn={props.onSignIn}
                          onManageProviders={props.onManageProviders}
                          onApply={studio.applyGeneratedProject}
                          onHeightChange={setComposerHeight}
                          controlsRoot={promptControlsRoot}
                          workspaceVisible={props.workspaceVisible && !libraryOpen}
                        />
                      }
                    />
                    <div className="canvas-bottom">
                      {manifest.kind === "carousel" && compiled && (
                        <label>
                          Page{" "}
                          <DropdownSelect
                            label="Carousel page"
                            placement="top"
                            value={studio.activeSlideIndex}
                            onChange={studio.setActiveSlideIndex}
                            options={Array.from({ length: compiled.slideCount }, (_, index) => ({
                              value: index + 1,
                              label: `${index + 1} of ${compiled.slideCount}`,
                            }))}
                          />
                        </label>
                      )}
                      {manifest.kind === "video" && compiled && (
                        <div className="video-controls">
                          <button
                            type="button"
                            aria-label={playing ? "Pause animation" : "Play animation"}
                            onClick={() => {
                              if (seekMs >= durationMs) setSeekMs(0);
                              setPlaying(!playing);
                            }}
                          >
                            {playing ? <Pause size={15} /> : <Play size={15} />}
                          </button>
                          <input
                            type="range"
                            aria-label="Animation timeline scrubber"
                            min={0}
                            max={durationMs}
                            step={1000 / 30}
                            value={seekMs}
                            onChange={(event) => {
                              setPlaying(false);
                              setSeekMs(Number(event.target.value));
                            }}
                          />
                          <span>{(seekMs / 1000).toFixed(1)}s</span>
                        </div>
                      )}
                      {warnings.length > 0 && (
                        <details className="canvas-checks">
                          <summary>
                            {warnings.length} design check{warnings.length === 1 ? "" : "s"}
                          </summary>
                          {warnings.map((warning, index) => (
                            <p key={index}>{warning.message}</p>
                          ))}
                        </details>
                      )}
                    </div>
                  </div>
                }
                editors={
                  <>
                    <div className="source-editors" aria-label="Template source editors">
                      <SourceEditor
                        key={`${studio.sourceSession}-${studio.activePageId}-html`}
                        language="html"
                        value={doc.template.liquidTemplate}
                        onChange={(liquidTemplate) =>
                          studio.setDocument({
                            ...doc,
                            template: { ...doc.template, liquidTemplate },
                          })
                        }
                        disabled={studio.busy}
                        themeMode={props.themeMode}
                      />
                      <SourceEditor
                        key={`${studio.sourceSession}-${studio.activePageId}-css`}
                        language="css"
                        value={doc.template.stylesCss}
                        onChange={(stylesCss) =>
                          studio.setDocument({ ...doc, template: { ...doc.template, stylesCss } })
                        }
                        disabled={studio.busy}
                        themeMode={props.themeMode}
                      />
                      <SourceEditor
                        key={`${studio.sourceSession}-${studio.activePageId}-json`}
                        language="json"
                        value={studio.templateJson}
                        onChange={studio.setTemplateJson}
                        disabled={studio.busy}
                        themeMode={props.themeMode}
                      />
                    </div>
                    {studio.projectError && (
                      <details className="editor-error" open>
                        <summary>Preview paused &mdash; check your template</summary>
                        <pre role="alert">{studio.projectError}</pre>
                      </details>
                    )}
                  </>
                }
              />
            </>
          )}
          <input
            ref={importInput}
            hidden
            type="file"
            accept=".json,application/json"
            aria-label="Import design JSON"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > 25_000_000) {
                setActionError("Design/recovery files must be smaller than 25 MB.");
                return;
              }
              void file
                .text()
                .then((text) => {
                  const raw: unknown = JSON.parse(text);
                  const recovery = z
                    .object({
                      document: LocalDesignSchema.shape.document,
                      pageJson: PageJsonSchema.optional(),
                    })
                    .strict()
                    .safeParse(raw);
                  const template = TemplateManifestSchema.safeParse(raw);
                  if (recovery.success)
                    studio.restoreDocument(recovery.data.document, recovery.data);
                  else if (template.success)
                    studio.setTemplateJson(JSON.stringify(template.data, null, 2));
                  else studio.restoreDocument(WorkspaceDesignDocumentSchema.parse(raw));
                  setActionError(null);
                })
                .catch((error: unknown) =>
                  setActionError(
                    `Could not import: ${error instanceof Error ? error.message : String(error)}`,
                  ),
                );
            }}
          />
        </div>
      </section>
    </div>
  );
}
