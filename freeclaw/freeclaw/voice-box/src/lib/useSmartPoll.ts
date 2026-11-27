// ─── Smart Polling Hook ───────────────────────────────────────────
// Replace ALL raw `setInterval(load, N)` calls with this.
// Features:
//   - Exponential backoff on consecutive failures
//   - Pauses when tab is hidden (visibilitychange)
//   - Debounce: only fires if interval elapsed since last completion
//   - Coalesces simultaneous polls into one tick per interval bucket
//   - Cleans up on unmount automatically
//   - Returns { isPolling, lastError, forceRefresh }

import { useCallback, useEffect, useRef, useState } from "react";

export interface SmartPollOptions {
	/** Base interval in ms. Default 30000 (30s). */
	intervalMs?: number;
	/** Max interval with backoff. Default 300000 (5 min). */
	maxIntervalMs?: number;
	/** Backoff multiplier on failure. Default 2. */
	backoffFactor?: number;
	/** Whether to pause when tab is hidden. Default true. */
	pauseOnHidden?: boolean;
	/** Whether to immediately fire on mount. Default true. */
	immediate?: boolean;
	/** Called when the poll interval changes (for logging/debug). */
	onIntervalChange?: (newMs: number) => void;
}

export function useSmartPoll(
	fetcher: () => Promise<unknown>,
	options: SmartPollOptions = {},
) {
	const {
		intervalMs = 30000,
		maxIntervalMs = 300000,
		backoffFactor = 2,
		pauseOnHidden = true,
		immediate = true,
		onIntervalChange,
	} = options;

	const [isPolling, setIsPolling] = useState(false);
	const [lastError, setLastError] = useState<Error | null>(null);
	const fetcherRef = useRef(fetcher);
	const currentIntervalRef = useRef(intervalMs);
	const failuresRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);
	const hiddenRef = useRef(false);
	const runningRef = useRef(false);
	// Refs for props that the mount effect needs without being in its deps
	const intervalMsRef = useRef(intervalMs);
	intervalMsRef.current = intervalMs;
	const immediateRef = useRef(immediate);
	immediateRef.current = immediate;

	fetcherRef.current = fetcher;

	const clearTimer = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const scheduleNext = useCallback(() => {
		if (!mountedRef.current || hiddenRef.current) return;

		const ms = currentIntervalRef.current;
		clearTimer();

		timerRef.current = setTimeout(async () => {
			/* v8 ignore next 2 -- @preserve: timer is always cancelled on unmount/hide, and never scheduled while running, so this guard cannot fire */
			if (!mountedRef.current || hiddenRef.current || runningRef.current)
				return;
			runningRef.current = true;
			setIsPolling(true);

			try {
				await fetcherRef.current();
				// Success: reset backoff
				failuresRef.current = 0;
				currentIntervalRef.current = intervalMs;
				setLastError(null);
			} catch (err) {
				// Failure: exponential backoff
				failuresRef.current++;
				currentIntervalRef.current = Math.min(
					intervalMs * backoffFactor ** failuresRef.current,
					maxIntervalMs,
				);
				setLastError(err instanceof Error ? err : new Error(String(err)));
				onIntervalChange?.(currentIntervalRef.current);
			}

			runningRef.current = false;
			setIsPolling(false);
			scheduleNext();
		}, ms);
	}, [intervalMs, maxIntervalMs, backoffFactor, clearTimer, onIntervalChange]);

	const forceRefresh = useCallback(async () => {
		// Coalesce: a fetch already in flight covers this refresh. Without
		// this, a realtime burst landing mid-poll fired a second overlapping
		// fetch, and whichever response arrived LAST won — a slow stale
		// response could overwrite newer state until the next tick.
		if (runningRef.current) return;
		clearTimer();
		runningRef.current = true;
		setIsPolling(true);
		try {
			await fetcherRef.current();
			failuresRef.current = 0;
			currentIntervalRef.current = intervalMs;
			setLastError(null);
		} catch (err) {
			setLastError(err instanceof Error ? err : new Error(String(err)));
		}
		runningRef.current = false;
		setIsPolling(false);
		scheduleNext();
	}, [intervalMs, clearTimer, scheduleNext]);

	// Visibility change handler
	useEffect(() => {
		if (!pauseOnHidden) return;

		const onVisibility = () => {
			if (document.hidden) {
				hiddenRef.current = true;
				clearTimer();
			} else {
				hiddenRef.current = false;
				// Fire immediately on return, then resume schedule
				forceRefresh();
			}
		};

		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, [pauseOnHidden, clearTimer, forceRefresh]);

	// Start/stop polling
	useEffect(() => {
		mountedRef.current = true;
		hiddenRef.current = document.hidden;

		if (immediate && !document.hidden) {
			forceRefresh();
		} else {
			scheduleNext();
		}

		return () => {
			mountedRef.current = false;
			clearTimer();
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	return { isPolling, lastError, forceRefresh };
}
