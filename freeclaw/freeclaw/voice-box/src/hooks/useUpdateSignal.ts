import { useCallback, useState } from "react";

const MAX_VISIBLE_UPDATES = 99;

/**
 * A local freshness signal for stable admin snapshots.
 *
 * Realtime consumers call `markUpdatesAvailable` when a relevant row changes.
 * This hook deliberately does not fetch, subscribe, or schedule work: the
 * page owner decides when a new snapshot is requested.
 */
export function useUpdateSignal() {
  const [updatesAvailable, setUpdatesAvailable] = useState(0);

  const markUpdatesAvailable = useCallback(() => {
    setUpdatesAvailable((current) =>
      Math.min(MAX_VISIBLE_UPDATES, current + 1),
    );
  }, []);

  const clearUpdates = useCallback(() => {
    setUpdatesAvailable(0);
  }, []);

  return {
    updatesAvailable,
    markUpdatesAvailable,
    clearUpdates,
  };
}
