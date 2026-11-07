import { useEffect, useState } from "react";
import { readChain, type ChainState } from "../data/squeekchain";

const INITIAL_STATE: ChainState = { core: null, measurement: null, checkedAt: null, error: null };

export function useSqueekchain() {
  const [state, setState] = useState<ChainState>(INITIAL_STATE);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const next = await readChain(controller.signal);
        if (!stopped) {
          setState(next);
          timer = window.setTimeout(poll, next.core ? 15_000 : 7_000);
        }
      } catch (error) {
        if (!stopped && !controller.signal.aborted) {
          setState((current) => ({ ...current, error: error instanceof Error ? error.message : "Connection interrupted." }));
          timer = window.setTimeout(poll, 7_000);
        }
      }
    };

    void poll();
    return () => {
      stopped = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshKey]);

  return { ...state, refresh: () => setRefreshKey((key) => key + 1) };
}
