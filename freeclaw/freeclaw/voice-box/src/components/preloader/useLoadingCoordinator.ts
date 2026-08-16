// ═══════════════════════════════════════════════════════════════════
// useLoadingCoordinator — real readiness, not a timed animation.
// ═══════════════════════════════════════════════════════════════════
// Owns the boot state machine and drives it from REAL application
// initialization:
//
//   • shell  (CRITICAL) — the React app shell has mounted & committed
//   • fonts  (CRITICAL) — document.fonts.ready resolved (with timeout)
//   • data   (CRITICAL) — a lightweight public API probe answered
//
// The timeline REACTS to these flags. It never fakes completion, never
// blocks forever (MAX_WAIT_MS → ERROR with retry/continue), and enforces
// only a tiny anti-flash floor (MIN_DISPLAY_MS) so a 300ms load doesn't
// render a blank flash.
//
// LOOPS ARE IMPOSSIBLE: inline `dataProbe` functions (a common caller
// pattern) are held in a ref so identity changes never re-trigger the
// probe effect, and retry uses a real state counter (not a ref) so the
// init effects genuinely re-run.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import {
	MAX_WAIT_MS,
	MIN_DISPLAY_MS,
	progressFromTasks,
	statusFromFlags,
	type LoadTask,
	type PreloaderStatus,
	type ReadinessFlags,
} from "./PreloaderStatus";

export interface BootOptions {
	/** Override the data probe (defaults to a public, lightweight endpoint). */
	dataProbe?: () => Promise<unknown>;
	/** Max ms before the loader gives up and shows the error state. */
	maxWaitMs?: number;
	/** Minimum ms the overlay must remain visible (anti-flash). */
	minDisplayMs?: number;
}

export interface CoordinatorState {
	status: PreloaderStatus;
	flags: ReadinessFlags;
	tasks: LoadTask[];
	progress: number;
	elapsedMs: number;
	errored: boolean;
	retry: () => void;
	continueLimited: () => void;
}

const EMPTY_FLAGS: ReadinessFlags = {
	shellReady: false,
	fontsReady: false,
	dataReady: false,
};

function defaultDataProbe(): Promise<unknown> {
	return fetch("/api/categories", { signal: AbortSignal.timeout(4000) }).then(
		(r) => {
			if (!r.ok) throw new Error(`probe ${r.status}`);
			return r.json();
		},
	);
}	export function useLoadingCoordinator(opts?: BootOptions): CoordinatorState {
	const maxWaitMs = opts?.maxWaitMs ?? MAX_WAIT_MS;
	const minDisplayMs = opts?.minDisplayMs ?? MIN_DISPLAY_MS;

	// Inline probe identities are unstable — hold the CALLABLE in a ref so
	// re-renders never re-fire the probe effect (loop-proof).
	const probeRef = useRef(opts?.dataProbe ?? defaultDataProbe);
	probeRef.current = opts?.dataProbe ?? defaultDataProbe;

	const [flags, setFlags] = useState<ReadinessFlags>(EMPTY_FLAGS);
	const [errored, setErrored] = useState(false);
	const [elapsedMs, setElapsedMs] = useState(0);
	// Real state counter — retry() bumps it so init effects re-run.
	const [retryCount, setRetryCount] = useState(0);

	// Clock: lightweight ticker so statusFromFlags can evaluate the
	// min-display gate. Re-starts on retry.
	useEffect(() => {
		const start = Date.now();
		setElapsedMs(0);
		const id = window.setInterval(() => {
			setElapsedMs(Date.now() - start);
		}, 120);
		return () => window.clearInterval(id);
	}, [retryCount]);

	// Shell: the app is mounted above this overlay, so it's ready once this
	// effect runs (after first commit). Re-runs on retry.
	useEffect(() => {
		setFlags((f) => ({ ...f, shellReady: true }));
	}, [retryCount]);

	// Fonts: real font readiness with a timeout so a blocked font CDN can
	// never trap the user behind the loader.
	useEffect(() => {
		let alive = true;
		const done = () => alive && setFlags((f) => ({ ...f, fontsReady: true }));
		try {
			const fonts = document.fonts;
			if (!fonts?.ready) {
				done();
				return undefined;
			}
			fonts.ready.then(done).catch(done);
			const t = window.setTimeout(done, 3500);
			return () => {
				alive = false;
				window.clearTimeout(t);
			};
		} catch {
			done();
			return undefined;
		}
	}, [retryCount]);

	// Data: the critical probe. A failure marks dataReady=false so the state
	// machine can't reach READY, but the max-wait watchdog turns that into a
	// graceful ERROR state rather than an infinite spinner.
	useEffect(() => {
		let alive = true;
		setFlags((f) => ({ ...f, dataReady: false }));
		probeRef
			.current()
			.then(() => alive && setFlags((f) => ({ ...f, dataReady: true })))
			.catch(() => {
				/* dataReady stays false — watchdog handles it */
			});
		return () => {
			alive = false;
		};
	}, [retryCount]);

	// Watchdog: never an infinite loader. If the max wait elapses before all
	// critical flags are green, surface the error state (user picks retry or
	// continue-with-limited-experience).
	useEffect(() => {
		if (elapsedMs < maxWaitMs) return;
		const criticalReady = flags.shellReady && flags.fontsReady && flags.dataReady;
		if (criticalReady) return;
		setErrored(true);
	}, [elapsedMs, maxWaitMs, flags]);

	const retry = useCallback(() => {
		setErrored(false);
		setFlags(EMPTY_FLAGS);
		setElapsedMs(0); // clear the stale elapsed BEFORE the watchdog effect runs
		setRetryCount((c) => c + 1);
	}, []);

	const continueLimited = useCallback(() => {
		// User chooses to proceed without critical data — treat the remaining
		// flags as satisfied and go READY (the app's own error handling covers
		// any degraded features).
		setErrored(false);
		setFlags((f) => ({ ...f, dataReady: true, fontsReady: true }));
	}, []);

	const status = statusFromFlags(flags, { elapsedMs, errored, minDisplayMs });

	const tasks: LoadTask[] = [
		{ id: "shell", label: "Starting", priority: "CRITICAL", done: flags.shellReady, failed: false },
		{ id: "fonts", label: "Preparing your workspace", priority: "CRITICAL", done: flags.fontsReady, failed: false },
		{ id: "data", label: "Connecting", priority: "CRITICAL", done: flags.dataReady, failed: errored },
	];

	return {
		status,
		flags,
		tasks,
		progress: progressFromTasks(tasks),
		elapsedMs,
		errored,
		retry,
		continueLimited,
	};
}
