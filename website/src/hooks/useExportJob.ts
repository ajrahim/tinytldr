import { useCallback, useEffect, useRef, useState } from "react";
import { RenderedExportSchema, type MediaFormat, type WorkspaceProject } from "@tinytldr/core";
import { retainRenderedExport } from "../lib/MediaLibrary.js";
import { fetchFirebaseArtifact, fetchFirebaseService } from "../lib/FirebaseClient.js";

export interface ExportStatus {
  readonly state: "idle" | "exporting" | "done" | "error";
  readonly message?: string;
  readonly warnings?: readonly string[];
}

export function useExportJob(userId: string | null): {
  readonly apiUrl: string | undefined;
  readonly exportStatus: ExportStatus;
  readonly dismissExportStatus: () => void;
  readonly downloadHtmlFile: (filename: string, htmlContent: string) => void;
  readonly downloadJsonFile: (filename: string, jsonObject: unknown) => void;
  readonly downloadTextFile: (filename: string, text: string, mimeType: string) => void;
  readonly requestWorkspaceExport: (params: {
    document: WorkspaceProject;
    format: MediaFormat;
    sourcePath: string;
  }) => Promise<void>;
} {
  const rawEnvUrl = import.meta.env.VITE_TINYTLDR_API_URL as string | undefined;
  const apiUrl = rawEnvUrl && rawEnvUrl.trim().length > 0 ? rawEnvUrl.trim() : undefined;

  const [exportStatus, setExportStatus] = useState<ExportStatus>({ state: "idle" });
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setExportStatus({ state: "idle" });
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [userId]);

  const triggerBlobDownload = useCallback((filename: string, blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  }, []);

  const downloadHtmlFile = useCallback(
    (filename: string, htmlContent: string) => {
      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      triggerBlobDownload(filename, blob);
    },
    [triggerBlobDownload],
  );

  const downloadJsonFile = useCallback(
    (filename: string, jsonObject: unknown) => {
      const text = JSON.stringify(jsonObject, null, 2);
      const blob = new Blob([text], { type: "application/json;charset=utf-8" });
      triggerBlobDownload(filename, blob);
    },
    [triggerBlobDownload],
  );

  const requestWorkspaceExport = useCallback(
    async (params: { document: WorkspaceProject; format: MediaFormat; sourcePath: string }) => {
      if (!userId) {
        setExportStatus({
          state: "error",
          message: "Sign in to save rendered exports to My Library.",
        });
        return;
      }
      if (!apiUrl) {
        setExportStatus({
          state: "error",
          message:
            "Rendered exports need a tinytldr render server. Set VITE_TINYTLDR_API_URL and restart the website. HTML and JSON downloads still work.",
        });
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setExportStatus({
        state: "exporting",
        message: `Rendering ${params.format.toUpperCase()}...`,
      });

      try {
        const endpoint = new URL(`${apiUrl.replace(/\/+$/, "")}/v1/render`);
        const body = { document: params.document, format: params.format };
        const localRenderer =
          import.meta.env.DEV &&
          endpoint.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
        const response = localRenderer
          ? await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            })
          : await fetchFirebaseService(endpoint.href, body, "export", controller.signal, {
              requireSignIn: true,
              expectedUserId: userId,
            });

        if (!response.ok) {
          throw new Error(
            `Render server responded with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
          );
        }

        const payload = RenderedExportSchema.parse(await response.json());
        const count = await retainRenderedExport(
          payload,
          params.document,
          params.sourcePath,
          controller.signal,
          localRenderer
            ? undefined
            : (url) => fetchFirebaseArtifact(url, endpoint.origin, controller.signal, userId),
          userId,
        );
        if (abortControllerRef.current !== controller) return;
        setExportStatus({
          state: "done",
          message: `${count === 1 ? "Export" : `${count} exports`} saved to My Library in your account.`,
          warnings: payload.warnings,
        });
      } catch (err) {
        if (abortControllerRef.current !== controller) return;
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setExportStatus({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [apiUrl, userId],
  );

  return {
    apiUrl,
    exportStatus,
    dismissExportStatus: () => setExportStatus({ state: "idle" }),
    downloadHtmlFile,
    downloadJsonFile,
    downloadTextFile: (filename, text, mimeType) =>
      triggerBlobDownload(filename, new Blob([text], { type: mimeType })),
    requestWorkspaceExport,
  };
}
