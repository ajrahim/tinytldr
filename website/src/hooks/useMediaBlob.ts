import { useEffect, useState } from "react";
import type { MediaLibraryItem } from "@tinytldr/core";
import { readMediaBlob } from "../lib/MediaLibrary.js";

export function useMediaBlob(item: MediaLibraryItem, kind: "file" | "poster", userId: string) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setBlob(null);
    setError(null);
    void readMediaBlob(item, kind, userId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setBlob(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => controller.abort();
  }, [item, kind, userId]);
  return { blob, error };
}
