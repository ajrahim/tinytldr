import { useCallback, useEffect, useState } from "react";
import {
  DESIGN_HISTORY_KEY,
  forgetLocalDesign,
  readDesignHistory,
  rememberLocalDesign,
  renameLocalDesign,
  type LocalDesign,
} from "../lib/DesignHistory.js";

function storageMessage(error: unknown): string {
  return `Browser history could not be saved or read. Download your design before leaving; private guest keys cannot be recovered if this browser's storage is cleared. ${error instanceof Error ? error.message : String(error)}`;
}

export function useDesignHistory() {
  const [entries, setEntries] = useState<LocalDesign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(() => {
    try {
      setEntries(readDesignHistory(window.localStorage));
      setError(null);
    } catch (err) {
      setError(storageMessage(err));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === DESIGN_HISTORY_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const remember = useCallback((entry: LocalDesign) => {
    try {
      setEntries(rememberLocalDesign(window.localStorage, entry));
      setError(null);
    } catch (err) {
      const message = storageMessage(err);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const forget = useCallback((id: string) => {
    try {
      setEntries(forgetLocalDesign(window.localStorage, id));
      setError(null);
    } catch (err) {
      const message = storageMessage(err);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const rename = useCallback((id: string, title: string, revision?: number) => {
    try {
      setEntries(renameLocalDesign(window.localStorage, id, title, revision));
      setError(null);
    } catch (err) {
      const message = storageMessage(err);
      setError(message);
      throw new Error(message);
    }
  }, []);

  return { entries, error, ready, remember, forget, rename };
}

export type DesignHistory = ReturnType<typeof useDesignHistory>;
