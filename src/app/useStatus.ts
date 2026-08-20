import { useCallback, useEffect, useRef, useState } from "react";
import { fetchStatus } from "../pipeline-client";
import type { WorkshopStatus } from "../../server/status";

export interface StatusFeed {
  status: WorkshopStatus | null;
  error: string | null;
  refresh: () => void;
}

/**
 * Polls `/api/status` on an interval, pausing while the tab is hidden (the
 * status route runs live credential probes, so background polling is waste).
 * A failed poll keeps the last good status and reports the reason in `error`
 * rather than dropping it: the App turns that into a message card.
 */
export function useStatus(intervalMs = 3000): StatusFeed {
  const [status, setStatus] = useState<WorkshopStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await fetchStatus();
      if (!aliveRef.current) return;
      setStatus(next);
      setError(null);
    } catch (e) {
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refresh = useCallback((): void => {
    void load();
  }, [load]);

  useEffect(() => {
    aliveRef.current = true;
    let timer = 0;
    const tick = (): void => {
      if (!document.hidden) void load();
      timer = window.setTimeout(tick, intervalMs);
    };
    void load();
    timer = window.setTimeout(tick, intervalMs);
    // A tab coming back into view should not wait out the rest of the interval.
    const onVisible = (): void => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      aliveRef.current = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, load]);

  return { status, error, refresh };
}
