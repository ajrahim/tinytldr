import { useCallback, useEffect, useState } from "react";
import type { AiConnection } from "@tinytldr/core";
import { listAiConnections } from "../lib/AiRepository.js";

export function useAiConnections(userId?: string) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    owner?: string;
    connections: AiConnection[];
    loading: boolean;
    error: string | null;
  }>({ connections: [], loading: false, error: null });
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const update = useCallback(
    (connections: AiConnection[]) => {
      setState({ owner: userId, connections, loading: false, error: null });
    },
    [userId],
  );
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    setState((current) => ({
      owner: userId,
      connections: current.owner === userId ? current.connections : [],
      loading: true,
      error: null,
    }));
    void listAiConnections(controller.signal)
      .then((connections) => {
        if (!controller.signal.aborted)
          setState({ owner: userId, connections, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState((current) => ({
            owner: userId,
            connections: current.owner === userId ? current.connections : [],
            loading: false,
            error: error instanceof Error ? error.message : "Could not load provider connections.",
          }));
      });
    return () => controller.abort();
  }, [userId, version]);
  return {
    connections: state.owner === userId ? state.connections : [],
    loading: !!userId && (state.owner !== userId || state.loading),
    error: state.owner === userId ? state.error : null,
    refresh,
    update,
  };
}
export type AiConnections = ReturnType<typeof useAiConnections>;
