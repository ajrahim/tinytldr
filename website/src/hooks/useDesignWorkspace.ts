import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  artboardDocument,
  MAX_WORKSPACE_PAGES,
  projectFromDocument,
  WorkspaceProjectSchema,
  DesignTitleSchema,
  type SavedWorkspaceDesign,
  type WorkspaceArtboard,
  type WorkspaceDocument,
  type WorkspaceProject,
  type TemplateManifest,
} from "@tinytldr/core";
import { z } from "zod";
import {
  compileBrowserPreview,
  type SizePresetId,
  type BrowserCompileResult,
} from "../lib/BrowserCompiler.js";
import {
  claimDesign,
  createPrivateEditKey,
  getSavedDesign,
  getDesignVersion,
  listDesignVersions,
  saveDesign,
  renameSavedDesign,
  deleteSavedDesign,
  type DesignListTarget,
  type DesignListMutation,
} from "../lib/DesignRepository.js";
import { createBlankDocument, createStarterDocument } from "../lib/WorkspaceTemplates.js";
import {
  createTemplateJson,
  parseTemplateJson,
  resolveTemplateDocument,
  sameJsonContent,
} from "../lib/TemplateEditor.js";
import {
  restorePageJson,
  pageJsonValue,
  type WorkspaceSourceRecovery,
} from "../lib/WorkspacePages.js";
import type { LocalDesign } from "../lib/DesignHistory.js";
import type { DesignHistory } from "./useDesignHistory.js";

export interface ArtboardPreview {
  page: WorkspaceArtboard;
  document: WorkspaceDocument | null;
  manifest: TemplateManifest | null;
  compiled: BrowserCompileResult | null;
  error: string | null;
  revision: number;
}

function errorMessage(error: unknown): string {
  return error instanceof z.ZodError
    ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n")
    : error instanceof Error
      ? error.message
      : String(error);
}

function checkedLocalProject(local: LocalDesign): WorkspaceProject {
  const sources = restorePageJson(local.document, local);
  return WorkspaceProjectSchema.parse({
    ...local.document,
    pages: local.document.pages.map((page) => {
      const resolved = resolveTemplateDocument(
        artboardDocument(page, local.document.size),
        parseTemplateJson(pageJsonValue(sources, page.id) ?? ""),
      ).document;
      compileBrowserPreview({
        templateId: resolved.template.manifest.id,
        templateBundle: resolved.template,
        size: resolved.size,
        theme: resolved.theme,
        data: resolved.data,
        tokenOverrides: resolved.tokenOverrides,
      });
      return {
        ...page,
        template: resolved.template,
        data: resolved.data,
        theme: resolved.theme,
        tokenOverrides: resolved.tokenOverrides,
      };
    }),
  });
}

export function useDesignWorkspace(options: {
  designId?: string;
  localId?: string;
  initialTemplateId?: string;
  initialSize?: SizePresetId;
  initialTheme?: string;
  userId?: string;
  history: DesignHistory;
  onNavigate: (path: string) => void;
  onPersisted: () => void;
}) {
  const { designId, localId, history, initialTemplateId, initialSize, initialTheme } = options;
  const [project, setProject] = useState(() => projectFromDocument(createBlankDocument()));
  const [pageJson, setPageJson] = useState<Record<string, string>>({});
  const [selectedPageId, setSelectedPageId] = useState("page-1");
  const [record, setRecord] = useState<SavedWorkspaceDesign | null>(null);
  const [identity, setIdentity] = useState(() => ({
    id: localId ?? crypto.randomUUID(),
    editKey: createPrivateEditKey(),
  }));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [versionLoading, setVersionLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<"latest" | number>("latest");
  const [sourceSession, setSourceSession] = useState(0);
  const [conflictingDraft, setConflictingDraft] = useState<LocalDesign | null>(null);
  const busyRef = useRef(false);
  // A fresh window stays out of Local until its first edit or save.
  const pristine = useRef<{ project: WorkspaceProject; pageJson: Record<string, string> } | null>(
    null,
  );
  const ownerSession = useRef({ userId: options.userId });
  if (ownerSession.current.userId !== options.userId)
    ownerSession.current = { userId: options.userId };
  const newDesignAttempt = useRef<{
    userId: string;
    id: string;
    editKey: string;
    document: WorkspaceProject;
  } | null>(null);
  const workspaceActive = useRef(true);
  useEffect(() => {
    workspaceActive.current = true;
    return () => {
      workspaceActive.current = false;
    };
  }, []);
  const revisionRef = useRef(0);
  const [activeSlideIndex, setActiveSlideIndex] = useState(1);
  const entriesRef = useRef(history.entries);
  entriesRef.current = history.entries;
  const activePage = project.pages.find((page) => page.id === selectedPageId) ?? project.pages[0]!;
  const document = useMemo(
    () => artboardDocument(activePage, project.size),
    [activePage, project.size],
  );
  const templateJson = pageJsonValue(pageJson, activePage.id) ?? "";

  useEffect(() => {
    if (!history.ready) return;
    let active = true;
    const load = async () => {
      try {
        const local = entriesRef.current.find((entry) => entry.id === (designId ?? localId));
        const starter = initialTemplateId
          ? createStarterDocument(initialTemplateId)
          : createBlankDocument();
        if (initialSize && starter.template.manifest.supportedSizes.includes(initialSize))
          starter.size = initialSize;
        if (initialTheme && starter.template.manifest.themes[initialTheme])
          starter.theme = initialTheme;
        let next = projectFromDocument(starter);
        let recovery: LocalDesign | undefined;
        if (designId) {
          const saved = await getSavedDesign(designId);
          if (!active) return;
          setRecord(saved);
          setSelectedVersion("latest");
          next = saved.document;
          if (local) {
            setIdentity({ id: saved.id, editKey: local.editKey });
            if (local.revision === saved.revision && saved.owner_id === null) {
              next = local.document;
              recovery = local;
            } else if (
              !sameJsonContent(local.document, saved.document) ||
              !sameJsonContent(
                restorePageJson(local.document, local),
                restorePageJson(local.document),
              )
            )
              setConflictingDraft(local);
          } else setIdentity({ id: saved.id, editKey: "" });
        } else if (localId) {
          if (!local)
            throw new Error(
              "This draft is not in this browser. Open its saved public link, or start a new design.",
            );
          next = local.document;
          recovery = local;
          setIdentity({ id: local.id, editKey: local.editKey });
        }
        if (!active) return;
        const nextPageJson = restorePageJson(next, recovery);
        pristine.current = designId || localId ? null : { project: next, pageJson: nextPageJson };
        setProject(next);
        setSelectedPageId(next.pages[0]!.id);
        setPageJson(nextPageJson);
        setLoading(false);
      } catch (err) {
        if (active) {
          setLoadError(errorMessage(err));
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [designId, localId, initialTemplateId, initialSize, initialTheme, history.ready]);

  const cache = useRef(
    new Map<
      string,
      {
        page: WorkspaceArtboard;
        size: WorkspaceProject["size"];
        json: string;
        slide: number;
        preview: ArtboardPreview;
      }
    >(),
  );
  const previews = useMemo(() => {
    const nextCache = new Map<
      string,
      {
        page: WorkspaceArtboard;
        size: WorkspaceProject["size"];
        json: string;
        slide: number;
        preview: ArtboardPreview;
      }
    >();
    const results = project.pages.map((page) => {
      const json = pageJsonValue(pageJson, page.id) ?? "";
      const slide = page.id === activePage.id ? activeSlideIndex : 1;
      const previous = cache.current.get(page.id);
      if (
        previous &&
        previous.page === page &&
        previous.size === project.size &&
        previous.json === json &&
        previous.slide === slide
      ) {
        nextCache.set(page.id, previous);
        return previous.preview;
      }
      let checked: WorkspaceDocument | null = null;
      let manifest: TemplateManifest | null = null;
      const revision = ++revisionRef.current;
      let result: ArtboardPreview;
      try {
        manifest = parseTemplateJson(json);
        checked = resolveTemplateDocument(artboardDocument(page, project.size), manifest).document;
        const compiled = compileBrowserPreview({
          templateId: checked.template.manifest.id,
          templateBundle: checked.template,
          size: checked.size,
          theme: checked.theme,
          data: checked.data,
          tokenOverrides: checked.tokenOverrides,
          revision,
          activeSlideIndex: slide,
        });
        result = { page, document: checked, manifest, compiled, error: null, revision };
      } catch (err) {
        result = {
          page,
          document: checked,
          manifest,
          compiled: null,
          error: errorMessage(err),
          revision,
        };
      }
      nextCache.set(page.id, { page, size: project.size, json, slide, preview: result });
      return result;
    });
    cache.current = nextCache;
    return results;
  }, [project, pageJson, activePage.id, activeSlideIndex]);
  const preview = previews.find((item) => item.page.id === activePage.id)!;
  const { validProject, projectError } = useMemo(() => {
    const failures = previews.filter((item) => item.error);
    if (failures.length)
      return {
        validProject: null,
        projectError: failures
          .map((item) => `${item.page.title || "Untitled page"}: ${item.error}`)
          .join("\n"),
      };
    const checked = WorkspaceProjectSchema.safeParse({
      ...project,
      pages: previews.map((item) => {
        const resolved = item.document!;
        return {
          ...item.page,
          template: resolved.template,
          data: resolved.data,
          theme: resolved.theme,
          tokenOverrides: resolved.tokenOverrides,
        };
      }),
    });
    return checked.success
      ? { validProject: checked.data, projectError: null }
      : { validProject: null, projectError: errorMessage(checked.error) };
  }, [project, previews]);

  const { remember, forget } = history;
  useEffect(() => {
    if (loading || loadError || deleted || !identity.editKey || record?.owner_id) return;
    const baseline = pristine.current;
    if (baseline) {
      if (
        !record &&
        !entriesRef.current.some((entry) => entry.id === identity.id) &&
        sameJsonContent(baseline.project, project) &&
        sameJsonContent(baseline.pageJson, pageJson)
      )
        return;
      pristine.current = null;
    }
    try {
      remember({
        ...identity,
        document: validProject ?? project,
        pageJson,
        saved: !!record,
        revision: record?.revision,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // useDesignHistory exposes the storage error beside the editor.
    }
  }, [project, pageJson, validProject, identity, record, loading, loadError, deleted, remember]);

  const canUpdate =
    !deleted &&
    (!record || (record.owner_id ? record.owner_id === options.userId : !!identity.editKey));
  const dirty = !record || !validProject || !sameJsonContent(validProject, record.document);
  const createNewDesign = async () => {
    if (busyRef.current) return false;
    const session = ownerSession.current;
    const userId = session.userId;
    if (!userId) {
      options.onNavigate("/");
      return true;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (newDesignAttempt.current?.userId !== userId)
        newDesignAttempt.current = {
          userId,
          id: crypto.randomUUID(),
          editKey: createPrivateEditKey(),
          document: projectFromDocument(createBlankDocument()),
        };
      const attempt = newDesignAttempt.current;
      const saved = await saveDesign({ ...attempt, expectedUserId: userId });
      if (saved.owner_id !== userId)
        throw new Error("The new design was not saved to your account. Retry New design.");
      newDesignAttempt.current = null;
      options.onPersisted();
      if (!workspaceActive.current || ownerSession.current !== session) return false;
      options.onNavigate(`/d/${saved.id}`);
      return true;
    } catch (err) {
      if (workspaceActive.current && ownerSession.current === session)
        setError(`Could not create your cloud design: ${errorMessage(err)}`);
      return false;
    } finally {
      busyRef.current = false;
      if (workspaceActive.current) setBusy(false);
    }
  };
  const save = useCallback(async () => {
    if (busyRef.current) return;
    if (!validProject) {
      setError("Fix the page errors before saving.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const target = canUpdate
        ? identity
        : { id: crypto.randomUUID(), editKey: createPrivateEditKey() };
      const needsGuestRecovery = record && canUpdate ? !record.owner_id : !options.userId;
      if (needsGuestRecovery)
        remember({
          ...target,
          document: validProject,
          pageJson,
          saved: !!record && canUpdate,
          revision: canUpdate ? record?.revision : undefined,
          updatedAt: new Date().toISOString(),
        });
      const saved = await saveDesign({
        ...target,
        document: validProject,
        editKey: target.editKey || null,
        revision: canUpdate ? record?.revision : undefined,
      });
      setRecord(saved);
      setSelectedVersion("latest");
      setIdentity(target);
      if (saved.owner_id) {
        try {
          forget(saved.id);
        } catch (err) {
          setError(`Saved online, but browser history cleanup failed: ${errorMessage(err)}`);
        }
      } else
        remember({
          ...target,
          document: saved.document,
          pageJson,
          saved: true,
          revision: saved.revision,
          updatedAt: new Date().toISOString(),
        });
      options.onPersisted();
      setMessage("Saved. Anyone with the link can view and make a copy.");
      if (workspaceActive.current && designId !== saved.id) options.onNavigate(`/d/${saved.id}`);
      return saved;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [validProject, canUpdate, identity, record, remember, forget, pageJson, options, designId]);

  const claim = useCallback(async () => {
    if (busyRef.current || deleted) return false;
    if (!record) {
      if (!options.userId) {
        setError("Sign in before claiming a browser draft.");
        return false;
      }
      const saved = await save();
      if (saved && !saved.owner_id)
        setError("Sign-in changed. Your draft was saved unclaimed; sign in and claim it.");
      return !!saved?.owner_id;
    }
    if (!validProject) {
      setError("Fix the page errors before claiming. Your existing saved link is unchanged.");
      return false;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let claimRevision = record.revision;
      if (dirty) {
        const updated = await saveDesign({
          id: record.id,
          document: validProject,
          editKey: identity.editKey,
          revision: record.revision,
        });
        setRecord(updated);
        setSelectedVersion("latest");
        claimRevision = updated.revision;
      }
      const claimed = await claimDesign(record.id, identity.editKey, claimRevision);
      setRecord(claimed);
      setSelectedVersion("latest");
      try {
        forget(claimed.id);
      } catch (err) {
        setError(`Claimed successfully, but browser history cleanup failed: ${errorMessage(err)}`);
      }
      options.onPersisted();
      setMessage("This design is now yours. Its guest edit key has been retired.");
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [record, identity.editKey, forget, options, dirty, validProject, save, deleted]);

  const actOnDesign = async (target: DesignListTarget, mutation: DesignListMutation) => {
    if (busyRef.current) return false;
    const isActive = target.id === identity.id;
    if (mutation.action === "claim" && isActive) return claim();
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    let completed: string | null = null;
    try {
      if (mutation.action === "rename") {
        const title = DesignTitleSchema.parse(mutation.title);
        const initialTitle = project.title;
        const renamed = target.saved ? await renameSavedDesign(target, title) : null;
        if (renamed) {
          completed = "Renamed online";
          options.onPersisted();
        }
        if (entriesRef.current.some((entry) => entry.id === target.id))
          history.rename(target.id, title, renamed?.revision);
        else if (!target.saved)
          throw new Error("This browser draft was removed. Refresh your designs.");
        if (isActive) {
          if (renamed) setRecord(renamed);
          setProject((current) =>
            current.title === initialTitle ? { ...current, title } : current,
          );
        }
        setMessage("Design renamed.");
      } else if (mutation.action === "delete") {
        if (target.saved) {
          await deleteSavedDesign(target);
          completed = "Deleted online";
          options.onPersisted();
        }
        if (isActive) setDeleted(true);
        forget(target.id);
        if (isActive && workspaceActive.current) options.onNavigate("/");
        else setMessage("Design deleted permanently.");
      } else {
        if (!options.userId) throw new Error("Sign in before claiming a design.");
        const local = entriesRef.current.find((entry) => entry.id === target.id);
        let claimed: SavedWorkspaceDesign;
        if (target.saved) {
          let latest = await getSavedDesign(target.id);
          if (latest.owner_id !== null) throw new Error("This design has already been claimed.");
          if (local) {
            if (local.revision !== latest.revision)
              throw new Error(
                "Claim refused: the design changed. Open it and recover your browser draft first.",
              );
            const document = checkedLocalProject(local);
            if (!sameJsonContent(document, latest.document)) {
              latest = await saveDesign({
                id: target.id,
                document,
                editKey: target.editKey,
                revision: latest.revision,
              });
              remember({
                ...local,
                revision: latest.revision,
                updatedAt: new Date().toISOString(),
              });
            }
          }
          claimed = await claimDesign(target.id, target.editKey ?? "", latest.revision);
        } else {
          if (!local) throw new Error("This browser draft was removed. Refresh your designs.");
          claimed = await saveDesign({
            id: target.id,
            document: checkedLocalProject(local),
            editKey: local.editKey,
          });
        }
        options.onPersisted();
        if (!claimed.owner_id)
          throw new Error(
            "Sign-in changed. Your saved draft remains unclaimed; sign in and try again.",
          );
        completed = "Claimed online";
        forget(target.id);
        setMessage("This design is now yours.");
      }
      return true;
    } catch (err) {
      setError(
        completed
          ? `${completed}, but browser history cleanup failed: ${errorMessage(err)}`
          : errorMessage(err),
      );
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const loadVersion = async (revision: "latest" | number) => {
    if (busyRef.current) return false;
    if (!record || !canUpdate) {
      setError("Saved versions are only available to this design's editor.");
      return false;
    }
    busyRef.current = true;
    setBusy(true);
    setVersionLoading(true);
    setError(null);
    setMessage(null);
    try {
      const latest = await getSavedDesign(record.id);
      const next =
        revision === "latest"
          ? latest.document
          : (await getDesignVersion(record.id, revision, identity.editKey || null)).document;
      setRecord(latest);
      setProject(next);
      setPageJson(restorePageJson(next));
      setSelectedPageId(next.pages[0]!.id);
      setActiveSlideIndex(1);
      setSourceSession((value) => value + 1);
      setSelectedVersion(revision === latest.revision ? "latest" : revision);
      setMessage(
        revision === "latest"
          ? "Latest saved version loaded."
          : `Version ${revision} loaded as an editable draft. Save to create a new latest version.`,
      );
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
      setVersionLoading(false);
    }
  };

  const recoverAsCopy = () => {
    if (!conflictingDraft) return;
    try {
      const id = crypto.randomUUID();
      remember({
        ...conflictingDraft,
        id,
        editKey: createPrivateEditKey(),
        saved: false,
        revision: undefined,
        updatedAt: new Date().toISOString(),
      });
      options.onNavigate(`/local/${id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const selectPage = (id: string) => {
    setSelectedPageId(id);
    if (id !== activePage.id) setActiveSlideIndex(1);
  };
  const addPage = () => {
    if (project.pages.length >= MAX_WORKSPACE_PAGES) {
      setError("A design can contain at most 20 pages.");
      return;
    }
    const page = {
      ...projectFromDocument(createBlankDocument()).pages[0]!,
      id: crypto.randomUUID(),
      title: `Page ${project.pages.length + 1}`,
    };
    setProject({ ...project, pages: [...project.pages, page] });
    setPageJson({
      ...pageJson,
      [page.id]: createTemplateJson(artboardDocument(page, project.size)),
    });
    selectPage(page.id);
  };
  const removePage = (id: string) => {
    if (project.pages.length === 1) {
      setError("Keep at least one page in the design.");
      return;
    }
    const pages = project.pages.filter((page) => page.id !== id);
    setProject({ ...project, pages });
    setPageJson(Object.fromEntries(Object.entries(pageJson).filter(([key]) => key !== id)));
    if (activePage.id === id) selectPage(pages[0]!.id);
  };

  const restoreDocument = (
    next: WorkspaceProject,
    recovery?: WorkspaceSourceRecovery,
    selectedId = next.pages[0]!.id,
  ) => {
    setProject(next);
    setPageJson(restorePageJson(next, recovery));
    setSelectedPageId(
      next.pages.some((page) => page.id === selectedId) ? selectedId : next.pages[0]!.id,
    );
    setActiveSlideIndex(1);
  };

  return {
    project,
    validProject,
    projectError,
    previews,
    activePageId: activePage.id,
    document,
    setDocument: (next: WorkspaceDocument) =>
      setProject((current) => ({
        ...current,
        size: next.size,
        pages: current.pages.map((page) =>
          page.id === activePage.id
            ? {
                ...page,
                title: next.title,
                template: next.template,
                data: next.data,
                theme: next.theme,
                tokenOverrides: next.tokenOverrides,
              }
            : page,
        ),
      })),
    setTitle: (title: string) => setProject((current) => ({ ...current, title })),
    updatePage: (id: string, update: Pick<Partial<WorkspaceArtboard>, "title" | "description">) =>
      setProject((current) => ({
        ...current,
        pages: current.pages.map((page) => (page.id === id ? { ...page, ...update } : page)),
      })),
    templateJson,
    setTemplateJson: (text: string) =>
      setPageJson((current) => ({ ...current, [activePage.id]: text })),
    recovery: { document: project, pageJson },
    restoreDocument,
    applyGeneratedProject: (next: WorkspaceProject, recovery?: WorkspaceSourceRecovery) => {
      restoreDocument(next, recovery, activePage.id);
      setSourceSession((value) => value + 1);
    },
    selectPage,
    addPage,
    removePage,
    record,
    loading,
    loadError,
    error,
    message,
    busy,
    preview,
    dirty,
    canUpdate,
    selectedVersion,
    sourceSession,
    versionLoading,
    canReadVersions: !!record && canUpdate,
    listVersions: (before?: number) => {
      if (!record || !canUpdate)
        throw new Error("Saved versions are only available to this design's editor.");
      return listDesignVersions(record.id, identity.editKey || null, before);
    },
    loadVersion,
    activeId: record?.id ?? identity.id,
    createNewDesign,
    save,
    claim,
    actOnDesign,
    clearError: () => setError(null),
    conflictingDraft,
    recoverAsCopy,
    activeSlideIndex,
    setActiveSlideIndex,
    canClaim: !deleted && !!identity.editKey && (!record || record.owner_id === null),
  };
}
