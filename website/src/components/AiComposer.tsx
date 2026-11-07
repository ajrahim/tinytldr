import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Square,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  AI_PROVIDER_NAMES,
  AiContextItemsSchema,
  AiGenerationInputSchema,
  type AiContext,
  type WorkspaceProject,
} from "@tinytldr/core";
import type { AiConnections } from "../hooks/useAiConnections.js";
import { useAiGeneration } from "../hooks/useAiGeneration.js";
import {
  AI_BACKEND_UNAVAILABLE_MESSAGE,
  readAiContextFile,
  selectAiModel,
} from "../lib/AiRepository.js";
import { saveUploadedImage } from "../lib/MediaLibrary.js";
import type { WorkspaceSourceRecovery } from "../lib/WorkspacePages.js";
import { Dropdown } from "./Dropdown.js";
import { DropdownSelect } from "./DropdownSelect.js";

// Keep in sync with the phone breakpoints in AiComposer.css and SiteFooter.css.
const PHONE_LANDSCAPE_QUERY = "(max-width: 950px) and (max-height: 500px)";
const PHONE_QUERY = `(max-width: 650px), ${PHONE_LANDSCAPE_QUERY}`;
const matches = (query: string) =>
  typeof window !== "undefined" && !!window.matchMedia?.(query).matches;

export function AiComposer(props: {
  userId?: string;
  document: WorkspaceProject | null;
  sourcePath: string;
  recovery: WorkspaceSourceRecovery & { document: WorkspaceProject };
  providers: AiConnections;
  disabled: boolean;
  onSignIn: () => void;
  onManageProviders: () => void;
  onApply: (project: WorkspaceProject, recovery?: WorkspaceSourceRecovery) => void;
  onHeightChange: (height: number) => void;
  controlsRoot: HTMLDivElement | null;
  workspaceVisible: boolean;
  sourceEditorsOpen?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const listId = useId();
  const promptId = useId();
  // A landscape phone has no room for both the canvas and the prompt, so it starts collapsed.
  const [promptVisible, setPromptVisible] = useState(() => !matches(PHONE_LANDSCAPE_QUERY));
  const collapsedForEditors = useRef(false);
  useEffect(() => {
    if (props.sourceEditorsOpen) {
      if (!matches(PHONE_QUERY)) return;
      setPromptVisible((visible) => {
        collapsedForEditors.current = visible;
        return false;
      });
    } else if (collapsedForEditors.current) {
      collapsedForEditors.current = false;
      setPromptVisible(true);
    }
  }, [props.sourceEditorsOpen]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [context, setContext] = useState<AiContext[]>([]);
  const [contextError, setContextError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textName, setTextName] = useState("");
  const [text, setText] = useState("");
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(
    null,
  );
  const [highlighted, setHighlighted] = useState(0);
  const modelRequest = useRef<AbortController | null>(null);
  const [selectingModel, setSelectingModel] = useState(false);
  const selected = props.providers.connections[0];
  const generation = useAiGeneration({
    userId: props.userId,
    recovery: props.recovery,
    onApply: props.onApply,
    providerRevision: selected
      ? JSON.stringify([
          selected.id,
          selected.provider,
          selected.base_url,
          selected.model,
          selected.updated_at,
        ])
      : undefined,
  });
  const pages = props.recovery.document.pages;
  const suggestions = mention
    ? pages.filter(
        (page) =>
          !targets.includes(page.id) &&
          page.title.toLowerCase().includes(mention.query.toLowerCase().trim()),
      )
    : [];
  const blocked = props.disabled || generation.busy || reading || selectingModel;
  const latestHistory = generation.history.at(-1);
  useEffect(() => {
    if (!latestHistory) return;
    setHistoryOpen(true);
    if (latestHistory.status === "succeeded")
      setPrompt((value) => (value.trim() === latestHistory.prompt ? "" : value));
  }, [latestHistory?.id, latestHistory?.status]);
  useEffect(() => () => modelRequest.current?.abort(), [props.userId]);
  useEffect(() => {
    alive.current = true;
    const node = root.current;
    if (!node) return;
    const measure = () => props.onHeightChange(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      alive.current = false;
      observer.disconnect();
    };
  }, [props.onHeightChange]);

  const updateMention = (value: string, cursor: number) => {
    const match = /(?:^|\s)@([^@\n]{0,80})$/.exec(value.slice(0, cursor));
    setMention(
      match ? { start: cursor - match[1]!.length - 1, end: cursor, query: match[1]! } : null,
    );
    setHighlighted(0);
  };
  const selectTarget = (id: string) => {
    if (!mention) return;
    setTargets((current) => [...new Set([...current, id])]);
    setPrompt((value) => value.slice(0, mention.start) + value.slice(mention.end));
    setMention(null);
    input.current?.focus();
  };
  const appendContext = (items: AiContext[]) => {
    const checked = AiContextItemsSchema.safeParse([...context, ...items]);
    if (!checked.success) {
      setContextError(checked.error.issues.map((issue) => issue.message).join(" "));
      return false;
    }
    setContextError(null);
    setContext([...context, ...checked.data.slice(context.length)]);
    return true;
  };
  const submit = () => {
    setContextError(null);
    if (blocked) return;
    if (!props.userId) {
      props.onSignIn();
      return;
    }
    if (props.providers.loading) {
      setContextError("Wait for provider connections to load.");
      return;
    }
    if (!selected) {
      props.onManageProviders();
      return;
    }
    if (!selected.model) {
      setContextError("Choose a model before generating.");
      props.onManageProviders();
      return;
    }
    if (!props.document) {
      setContextError(
        "Fix the source errors before generating; unfinished source will not be overwritten.",
      );
      return;
    }
    if (mention) {
      setContextError(
        "Select an artboard from the @ menu, or press Escape to keep the text without targeting.",
      );
      return;
    }
    const checked = AiGenerationInputSchema.safeParse({
      connectionId: selected.id,
      prompt,
      document: props.document,
      targetPageIds: targets,
      context,
    });
    if (!checked.success) {
      setContextError(checked.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    setTextOpen(false);
    const submittedContext = context;
    void generation.generate(checked.data).then((applied) => {
      if (!applied || !alive.current) return;
      setContext((current) => current.filter((item) => !submittedContext.includes(item)));
    });
  };
  const chooseModel = async (model: string) => {
    if (!selected || modelRequest.current) return;
    const controller = new AbortController();
    modelRequest.current = controller;
    setSelectingModel(true);
    setContextError(null);
    try {
      const connections = await selectAiModel(selected.id, model, controller.signal);
      if (!controller.signal.aborted) props.providers.update(connections);
    } catch (error) {
      if (!controller.signal.aborted)
        setContextError(error instanceof Error ? error.message : "The model could not be changed.");
    } finally {
      if (modelRequest.current === controller) modelRequest.current = null;
      if (!controller.signal.aborted) setSelectingModel(false);
    }
  };
  return (
    <>
      <div ref={root} className="ai-composer" data-canvas-overlay>
        <form
          id={promptId}
          hidden={!promptVisible}
          aria-label="AI design composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {(targets.length > 0 || context.length > 0) && (
            <div className="composer-chips">
              {targets.map((id) => (
                <span className="composer-chip" key={id}>
                  @{pages.find((page) => page.id === id)?.title ?? "Removed artboard"}
                  <button
                    type="button"
                    aria-label={`Remove artboard target ${pages.find((page) => page.id === id)?.title ?? id}`}
                    disabled={blocked}
                    onClick={() => setTargets((current) => current.filter((value) => value !== id))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {context.map((item, index) => (
                <span
                  className="composer-chip"
                  key={`${index}-${item.name}`}
                  title={item.kind === "text" ? "Text context" : "Image reference"}
                >
                  {item.name}
                  <button
                    type="button"
                    aria-label={`Remove context ${item.name}`}
                    disabled={blocked}
                    onClick={() =>
                      setContext((current) => current.filter((_, position) => position !== index))
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-prompt-wrap">
            <textarea
              ref={input}
              aria-label="Describe your idea"
              role="combobox"
              aria-expanded={!!mention}
              aria-autocomplete="list"
              aria-controls={mention ? listId : undefined}
              aria-activedescendant={
                mention && suggestions[highlighted] ? `${listId}-${highlighted}` : undefined
              }
              placeholder="Describe your idea. Attach a design to guide the result."
              value={prompt}
              maxLength={8000}
              disabled={blocked}
              rows={2}
              onChange={(event) => {
                setPrompt(event.target.value);
                updateMention(event.target.value, event.target.selectionStart);
              }}
              onClick={(event) =>
                updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
              }
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (mention && event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setMention(null);
                } else if (
                  mention &&
                  suggestions.length &&
                  ["ArrowDown", "ArrowUp"].includes(event.key)
                ) {
                  event.preventDefault();
                  setHighlighted(
                    (value) =>
                      (value + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
                      suggestions.length,
                  );
                } else if (mention && suggestions[highlighted] && event.key === "Enter") {
                  event.preventDefault();
                  selectTarget(suggestions[highlighted]!.id);
                } else if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            {mention && (
              <div
                className="dropdown-panel composer-mentions"
                id={listId}
                role="listbox"
                aria-label="Choose artboards"
              >
                {suggestions.length ? (
                  suggestions.map((page, index) => (
                    <button
                      type="button"
                      role="option"
                      className="dropdown-item"
                      tabIndex={-1}
                      id={`${listId}-${index}`}
                      key={page.id}
                      aria-selected={highlighted === index}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectTarget(page.id)}
                    >
                      <span>{page.title}</span>
                      <small>Artboard {pages.indexOf(page) + 1}</small>
                    </button>
                  ))
                ) : (
                  <p>No matching artboards.</p>
                )}
              </div>
            )}
          </div>
          {textOpen && (
            <div className="composer-text-context">
              <input
                aria-label="Context name"
                placeholder="Context name"
                maxLength={120}
                value={textName}
                disabled={blocked}
                onChange={(event) => setTextName(event.target.value)}
              />
              <textarea
                aria-label="Text context"
                placeholder="Paste text to guide the result..."
                maxLength={32000}
                value={text}
                disabled={blocked}
                onChange={(event) => setText(event.target.value)}
              />
              <div>
                <button
                  type="button"
                  disabled={blocked || !text.trim()}
                  onClick={() => {
                    if (
                      appendContext([
                        { kind: "text", name: textName.trim() || "Text context", text },
                      ])
                    ) {
                      setTextOpen(false);
                      setText("");
                      setTextName("");
                    }
                  }}
                >
                  Add context
                </button>
                <button type="button" onClick={() => setTextOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="composer-toolbar">
            <Dropdown
              label="Add context"
              placement="top"
              className="composer-add-menu"
              triggerProps={{
                className: "composer-add-trigger",
                title: "Add text or image context",
              }}
              trigger={<Plus size={19} aria-hidden="true" />}
            >
              {(close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="dropdown-item"
                    tabIndex={-1}
                    disabled={blocked || context.length >= 4}
                    onClick={() => {
                      setTextOpen(true);
                      close();
                    }}
                  >
                    Add text
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="dropdown-item composer-attach-item"
                    tabIndex={-1}
                    disabled={blocked || context.length >= 4 || !props.userId}
                    title={props.userId ? undefined : "Sign in to attach files"}
                    aria-label="Attach image or text file"
                    onClick={() => {
                      fileInput.current?.click();
                      close();
                    }}
                  >
                    Attach image or text file
                    {!props.userId && <span className="composer-menu-hint">Sign in</span>}
                  </button>
                </>
              )}
            </Dropdown>
            <span className="composer-scope">
              {targets.length ? `${targets.length} selected` : "All artboards"}{" "}
              <span className="composer-mention-hint">· @ to select</span>
            </span>
            <DropdownSelect
              label="Model"
              className="composer-provider"
              placement="top"
              title={
                selected
                  ? `${AI_PROVIDER_NAMES[selected.provider]} · ${selected.model_name ?? selected.model ?? "Choose a model"} · Sends prompts, design sources & attached context to the provider`
                  : "Connect AI to choose a model"
              }
              disabled={blocked || props.providers.loading}
              value={selected?.model ? `model:${selected.model}` : ""}
              onChange={(value) => {
                if (value === "manage") {
                  if (props.userId) props.onManageProviders();
                  else props.onSignIn();
                } else if (value.startsWith("model:")) void chooseModel(value.slice(6));
              }}
              options={[
                { value: "", label: selected ? "Choose a model" : "Connect AI", disabled: true },
                ...(selected?.model &&
                !selected.models?.some((model) => model.id === selected.model)
                  ? [
                      {
                        value: `model:${selected.model}`,
                        label: selected.model_name ?? selected.model,
                        disabled: true,
                      },
                    ]
                  : []),
                ...(selected?.models ?? []).map((model) => ({
                  value: `model:${model.id}`,
                  label: model.name,
                })),
                {
                  value: "manage",
                  label: selected ? "Manage AI connection..." : "Connect AI...",
                },
              ]}
            />
            {generation.busy ? (
              <button
                className="composer-send"
                type="button"
                aria-label="Cancel generation"
                title="Cancel generation"
                onClick={(event) => {
                  event.preventDefault();
                  generation.cancel();
                }}
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                className="composer-send"
                type="submit"
                aria-label="Generate design"
                title={props.userId ? "Generate an unsaved draft" : "Sign in to generate"}
                disabled={props.disabled || reading || selectingModel || !prompt.trim()}
              >
                <ArrowUp size={19} />
              </button>
            )}
          </div>
        </form>
        <input
          ref={fileInput}
          className="composer-file-input"
          type="file"
          aria-label="Attach reference files"
          disabled={!props.userId || props.disabled}
          multiple
          accept="image/png,image/jpeg,image/webp,.txt,.md,.html,.css,.json"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            if (!files.length) return;
            if (files.length + context.length > 4) {
              setContextError("Add at most four context items.");
              return;
            }
            setReading(true);
            setContextError(null);
            void Promise.all(files.map(readAiContextFile))
              .then((items) => {
                if (!alive.current || !appendContext(items)) return;
                const images = files.filter((file) => file.type.startsWith("image/"));
                void Promise.all(
                  images.map((file) => saveUploadedImage(file, props.sourcePath, props.userId)),
                ).catch((failure: unknown) => {
                  if (alive.current)
                    setContextError(
                      `${failure instanceof Error ? failure.message : "The image could not be saved to My Library."} It is still attached.`,
                    );
                });
              })
              .catch((failure: unknown) => {
                if (alive.current)
                  setContextError(
                    failure instanceof Error ? failure.message : "The reference could not be read.",
                  );
              })
              .finally(() => {
                if (alive.current) setReading(false);
              });
          }}
        />
        {(contextError || generation.error || props.providers.error) && (
          <p className="composer-feedback notice-error" role="alert">
            {contextError ?? generation.error ?? props.providers.error}
            {props.providers.error && !AI_BACKEND_UNAVAILABLE_MESSAGE && (
              <button type="button" onClick={props.providers.refresh}>
                Retry connections
              </button>
            )}
          </p>
        )}
        {(generation.busy || generation.message || reading) && (
          <p className={reading ? "composer-feedback" : "sr-only"} role="status">
            {reading
              ? "Reading context..."
              : generation.busy
                ? "Creating your design..."
                : generation.message}
          </p>
        )}
      </div>
      {props.controlsRoot &&
        createPortal(
          <>
            <button
              type="button"
              className="composer-prompt-toggle"
              aria-label="Prompt"
              title={promptVisible ? "Hide prompt" : "Show prompt"}
              aria-expanded={promptVisible}
              aria-controls={promptId}
              onClick={() => setPromptVisible((visible) => !visible)}
            >
              <MessageSquareText size={14} aria-hidden="true" />
              <span>Prompt</span>
            </button>
            <Dropdown
              label="Prompt history"
              role="dialog"
              align="end"
              className="composer-history"
              open={historyOpen && props.workspaceVisible}
              onOpenChange={setHistoryOpen}
              triggerProps={{
                className: "composer-history-toggle",
                title: historyOpen ? "Hide history" : "Show history",
              }}
              trigger={<ChevronDown size={13} aria-hidden="true" />}
            >
              {(close) => (
                <>
                  <div className="composer-history-heading">
                    <h2>Chat history</h2>
                    <button type="button" aria-label="Close prompt history" onClick={() => close()}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div
                    className="composer-history-log"
                    role="log"
                    aria-label="Generation history"
                    aria-live="off"
                  >
                    {generation.history.length === 0 ? (
                      <p>No prompts yet.</p>
                    ) : (
                      <ol>
                        {generation.history.map((entry) => (
                          <li key={entry.id} data-status={entry.status}>
                            <p className="composer-history-prompt">
                              <strong>You</strong>
                              {entry.prompt}
                            </p>
                            <p
                              className={`composer-history-response${entry.status === "failed" ? " notice-error" : ""}`}
                            >
                              {entry.status === "thinking" && (
                                <LoaderCircle
                                  size={13}
                                  className="animate-spin"
                                  aria-hidden="true"
                                />
                              )}
                              {entry.message}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  {(generation.canUndo || (generation.busy && !promptVisible)) && (
                    <div className="composer-history-actions">
                      {generation.busy && !promptVisible && (
                        <button type="button" onClick={generation.cancel}>
                          Cancel generation
                        </button>
                      )}
                      {generation.canUndo && (
                        <button type="button" onClick={generation.undo}>
                          Undo generation
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </Dropdown>
          </>,
          props.controlsRoot,
        )}
    </>
  );
}
