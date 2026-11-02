import { useEffect, useId, useRef, useState } from "react";
import {
  AI_PROVIDER_BASE_URLS,
  AI_PROVIDER_NAMES,
  AiProviderConnectionInputSchema,
  AiProviderSchema,
  type AiConnection,
  type AiProvider,
} from "@tinytldr/core";
import type { AiConnections } from "../hooks/useAiConnections.js";
import {
  AI_BACKEND_UNAVAILABLE_MESSAGE,
  deleteAiConnection,
  connectAiProvider,
  refreshAiModels,
  selectAiModel,
} from "../lib/AiRepository.js";
import { Dialog } from "./Dialog.js";
import { DropdownSelect } from "./DropdownSelect.js";

export function FirebaseAiConnectionDialog(props: {
  providers: AiConnections;
  onClose: () => void;
}) {
  const formId = useId();
  const pending = useRef<AbortController | null>(null);
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [baseUrl, setBaseUrl] = useState(AI_PROVIDER_BASE_URLS.openai);
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connection = props.providers.connections[0];
  const showForm = (!connection || replacing) && !AI_BACKEND_UNAVAILABLE_MESSAGE;
  const blocked = busy || props.providers.loading;

  useEffect(() => () => pending.current?.abort(), []);

  const run = async (operation: (signal: AbortSignal) => Promise<AiConnection[]>) => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      const connections = await operation(controller.signal);
      if (controller.signal.aborted) return;
      props.providers.update(connections);
      setApiKey("");
      setReplacing(false);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "The AI connection could not be updated.",
        );
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <Dialog
      className="provider-dialog"
      title="AI connection"
      description="Connect once, then choose a model."
      closeLabel="Close AI connection"
      onClose={props.onClose}
      footer={
        <>
          <button
            type="button"
            className="dialog-secondary-button"
            disabled={busy}
            onClick={() => {
              if (!replacing) props.onClose();
              else {
                setReplacing(false);
                setApiKey("");
                setError(null);
              }
            }}
          >
            {replacing ? "Cancel replacement" : "Close"}
          </button>
          {showForm && (
            <button
              className="primary-button"
              type="submit"
              form={formId}
              disabled={blocked || (!!props.providers.error && !connection)}
            >
              {busy ? "Connecting..." : replacing ? "Replace key" : "Connect"}
            </button>
          )}
        </>
      }
    >
      <p className="muted">
        Your key stays encrypted on the server. Connecting fetches available models, not a
        generation. API access and billing are separate from chat subscriptions.
      </p>
      {AI_BACKEND_UNAVAILABLE_MESSAGE && (
        <p role="alert" className="notice-error">
          {AI_BACKEND_UNAVAILABLE_MESSAGE}
        </p>
      )}
      {props.providers.loading && <p role="status">Loading AI connection...</p>}
      {props.providers.error && (
        <p role="alert" className="notice-error">
          {props.providers.error}{" "}
          <button
            className="text-link"
            type="button"
            onClick={props.providers.refresh}
            disabled={busy}
          >
            Retry
          </button>
        </p>
      )}
      {connection && !replacing && (
        <>
          <section className="provider-connection">
            <h3>{AI_PROVIDER_NAMES[connection.provider]}</h3>
            <p className="muted">Connected · Key ending {connection.key_suffix}</p>
            {connection.provider === "custom" && <p className="muted">{connection.base_url}</p>}
          </section>
          <label>
            Model
            <DropdownSelect
              label="Model"
              className="provider-select"
              value={connection.model ?? ""}
              disabled={blocked || !connection.models}
              onChange={(model) =>
                void run((signal) => selectAiModel(connection.id, model, signal))
              }
              options={[
                { value: "", label: "Choose a model", disabled: true },
                ...(connection.model &&
                !connection.models?.some((model) => model.id === connection.model)
                  ? [
                      {
                        value: connection.model,
                        label: connection.model_name ?? connection.model,
                        disabled: true,
                      },
                    ]
                  : []),
                ...(connection.models ?? []).map((model) => ({
                  value: model.id,
                  label: model.name,
                })),
              ]}
            />
          </label>
          <div className="provider-row-actions">
            <button
              type="button"
              disabled={blocked}
              onClick={() => void run((signal) => refreshAiModels(connection.id, signal))}
            >
              Refresh models
            </button>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                setProvider(connection.provider);
                setBaseUrl(connection.base_url);
                setApiKey("");
                setReplacing(true);
                setError(null);
              }}
            >
              Replace key
            </button>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                if (
                  window.confirm(
                    "Disconnect AI and remove its stored key? This does not revoke the key at the provider.",
                  )
                )
                  void run((signal) => deleteAiConnection(connection.id, signal));
              }}
            >
              Disconnect
            </button>
          </div>
          {!connection.models && (
            <p className="muted">Refresh models to choose from the provider's current list.</p>
          )}
          <p className="muted">
            Model availability does not guarantee image support or generation permissions.
          </p>
        </>
      )}
      {showForm && (
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            const checked = AiProviderConnectionInputSchema.safeParse({
              ...(connection ? { id: connection.id } : {}),
              provider,
              baseUrl,
              apiKey,
            });
            if (!checked.success) {
              setError(checked.error.issues.map((issue) => issue.message).join(" "));
              return;
            }
            void run((signal) => connectAiProvider(checked.data, signal));
          }}
        >
          <label>
            Provider
            <DropdownSelect
              label="AI provider"
              className="provider-select"
              value={provider}
              disabled={blocked}
              options={AiProviderSchema.options.map((value) => ({
                value,
                label: AI_PROVIDER_NAMES[value],
              }))}
              onChange={(value) => {
                setProvider(value);
                setBaseUrl(value === "custom" ? "" : AI_PROVIDER_BASE_URLS[value]);
                setApiKey("");
              }}
            />
          </label>
          {provider === "custom" && (
            <label>
              API base URL
              <input
                type="url"
                required
                value={baseUrl}
                disabled={blocked}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setApiKey("");
                }}
              />
              <span className="muted">
                The server must allow this endpoint, and it must support /models.
              </span>
            </label>
          )}
          <label>
            Provider API key
            <input
              type="password"
              required
              autoComplete="off"
              value={apiKey}
              disabled={blocked}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        </form>
      )}
      {busy && <p role="status">Updating AI connection...</p>}
      {error && (
        <p role="alert" className="notice-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
