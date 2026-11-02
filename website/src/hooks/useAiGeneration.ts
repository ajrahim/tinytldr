import { useEffect, useRef, useState } from "react";
import { artboardDocument, type AiGenerationInput, type WorkspaceProject } from "@tinytldr/core";
import { generateAiDesign } from "../lib/AiRepository.js";
import {
  pageJsonValue,
  restorePageJson,
  type WorkspaceSourceRecovery,
} from "../lib/WorkspacePages.js";
import { compileBrowserPreview } from "../lib/BrowserCompiler.js";

interface Recovery extends WorkspaceSourceRecovery {
  document: WorkspaceProject;
}
interface GenerationHistoryEntry {
  id: number;
  prompt: string;
  status: "thinking" | "succeeded" | "failed" | "cancelled" | "undone";
  message: string;
}
export function useAiGeneration(options: {
  userId?: string;
  providerRevision?: string;
  recovery: Recovery;
  onApply: (project: WorkspaceProject, recovery?: WorkspaceSourceRecovery) => void;
}) {
  const snapshot = JSON.stringify(options.recovery);
  const latest = useRef({ ...options, snapshot });
  latest.current = { ...options, snapshot };
  const active = useRef<{
    controller: AbortController;
    snapshot: string;
    providerRevision?: string;
    historyId: number;
  } | null>(null);
  const nextHistoryId = useRef(1);
  const [history, setHistory] = useState<GenerationHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ before: Recovery; after: string; historyId: number } | null>(
    null,
  );
  const finishHistory = (id: number, status: GenerationHistoryEntry["status"], message: string) => {
    setHistory((entries) =>
      entries.map((entry) => (entry.id === id ? { ...entry, status, message } : entry)),
    );
  };
  useEffect(() => {
    setHistory([]);
    setBusy(false);
    setError(null);
    setMessage(null);
    setUndo(null);
    return () => {
      active.current?.controller.abort();
      active.current = null;
    };
  }, [options.userId]);
  useEffect(() => {
    if (
      !active.current ||
      (active.current.snapshot === snapshot &&
        active.current.providerRevision === options.providerRevision)
    )
      return;
    const designChanged = active.current.snapshot !== snapshot;
    const message = designChanged
      ? "The design changed while generating. The request was cancelled and your edits were preserved."
      : "The AI connection or model changed while generating. Nothing was applied.";
    finishHistory(active.current.historyId, "cancelled", message);
    active.current.controller.abort();
    active.current = null;
    setBusy(false);
    setError(message);
  }, [snapshot, options.providerRevision]);

  const generate = async (request: AiGenerationInput) => {
    if (active.current) return;
    setError(null);
    setMessage(null);
    if (!options.userId) {
      setError("Sign in before generating.");
      return;
    }
    const controller = new AbortController();
    const before = options.recovery;
    const initial = snapshot;
    const owner = options.userId;
    const historyId = nextHistoryId.current++;
    active.current = {
      controller,
      snapshot: initial,
      providerRevision: options.providerRevision,
      historyId,
    };
    setHistory((entries) => [
      ...entries,
      { id: historyId, prompt: request.prompt, status: "thinking", message: "Thinking..." },
    ]);
    setBusy(true);
    try {
      const project = await generateAiDesign(request, controller.signal);
      if (controller.signal.aborted || active.current?.controller !== controller) return;
      if (
        latest.current.userId !== owner ||
        latest.current.snapshot !== initial ||
        latest.current.providerRevision !== options.providerRevision
      )
        throw new Error("The design or account changed. The generated result was not applied.");
      for (const page of project.pages) {
        const document = artboardDocument(page, project.size);
        const compiled = compileBrowserPreview({
          templateId: document.template.manifest.id,
          templateBundle: document.template,
          size: document.size,
          theme: document.theme,
          data: document.data,
          tokenOverrides: document.tokenOverrides,
        });
        if (compiled.validationErrors.length)
          throw new Error("The generated template did not compile. Nothing was applied.");
      }
      const pageJson = restorePageJson(project);
      if (request.targetPageIds.length) {
        const targets = new Set(request.targetPageIds);
        for (const page of project.pages) {
          const raw = pageJsonValue(before.pageJson, page.id);
          if (!targets.has(page.id) && raw !== undefined) pageJson[page.id] = raw;
        }
      }
      const applied = { document: project, pageJson };
      active.current = null;
      latest.current.onApply(project, applied);
      setUndo({
        before,
        after: JSON.stringify(applied),
        historyId,
      });
      setMessage("Design updated as an unsaved draft.");
      finishHistory(historyId, "succeeded", "Design updated as an unsaved draft.");
    } catch (failure) {
      if (active.current?.controller === controller) {
        const message =
          failure instanceof Error
            ? failure.message
            : "Generation failed. Your design is unchanged.";
        setError(message);
        finishHistory(historyId, "failed", message);
      }
    } finally {
      if (active.current?.controller === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const canUndo = !!undo && undo.after === snapshot && !busy;
  return {
    busy,
    error,
    message,
    history,
    generate,
    canUndo,
    cancel: () => {
      if (!active.current) {
        setError("There is no active generation to cancel.");
        return;
      }
      const message = "Generation cancelled. The provider may already have incurred usage.";
      finishHistory(active.current.historyId, "cancelled", message);
      active.current?.controller.abort();
      active.current = null;
      setBusy(false);
      setMessage(message);
    },
    undo: () => {
      if (!undo || undo.after !== latest.current.snapshot || busy) {
        setError("The design changed after generation. Undo was refused to preserve your edits.");
        return;
      }
      latest.current.onApply(undo.before.document, undo.before);
      finishHistory(undo.historyId, "undone", "Generation undone.");
      setUndo(null);
      setMessage("Generation undone.");
    },
  };
}
