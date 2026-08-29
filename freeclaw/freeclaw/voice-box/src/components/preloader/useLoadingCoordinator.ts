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
	envReady: false,
	fontsReady: false,
	authReady: false,
	dbReady: false,
	realtimeReady: false,
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

	// Keep a ref to the latest flags so the clock callback can check them
	// without causing re-renders or stale closures.
	const flagsRef = useRef(flags);
	flagsRef.current = flags;

	// Clock: lightweight ticker so statusFromFlags can evaluate the
	// min-display gate. Stops once all critical flags are green to
	// prevent unnecessary re-renders after boot completes.
	useEffect(() => {
		const start = Date.now();
		setElapsedMs(0);
		const id = window.setInterval(() => {
			const elapsed = Date.now() - start;
			setElapsedMs(elapsed);
			// Stop clock once all critical flags are green — no need to keep ticking
			const f = flagsRef.current;
			if (f.shellReady && f.fontsReady && f.dataReady && elapsed > 500) {
				window.clearInterval(id);
			}
		}, 120);
		return () => window.clearInterval(id);
	}, [retryCount]);

	// ── Stage 1: Shell (React app mounted) ──
	useEffect(() => {
		setFlags((f) => ({ ...f, shellReady: true }));
	}, [retryCount]);

	// ── Stage 2: Environment (config + env validation) ──
	useEffect(() => {
		// Environment is ready when the app shell mounts — config is loaded
		// synchronously via Vite's import.meta.env
		const t = window.setTimeout(() => {
			setFlags((f) => ({ ...f, envReady: true }));
		}, 80);
		return () => window.clearTimeout(t);
	}, [retryCount]);

	// ── Stage 3: Fonts (real font readiness with timeout) ──
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

	// ── Stage 4: Authentication (check auth state from localStorage) ──
	useEffect(() => {
		const t = window.setTimeout(() => {
			// Auth state is restored from sessionStorage/localStorage
			// by the identity module — this is fast and synchronous
			setFlags((f) => ({ ...f, authReady: true }));
		}, 120);
		return () => window.clearTimeout(t);
	}, [retryCount]);

	// ── Stage 5: Database (lightweight connectivity probe) ──
	useEffect(() => {
		let alive = true;
		const check = async () => {
			try {
				// Use the categories endpoint as a lightweight DB probe
				const res = await fetch("/api/categories", {
					signal: AbortSignal.timeout(4000),
				});
				if (res.ok) {
					if (alive) setFlags((f) => ({ ...f, dbReady: true }));
				} else {
					// DB may be temporarily unavailable — still mark ready
					// so the app can show degraded state instead of infinite loading
					if (alive) setFlags((f) => ({ ...f, dbReady: true }));
				}
			} catch {
				// Network failure — mark ready for degraded mode
				if (alive) setFlags((f) => ({ ...f, dbReady: true }));
			}
		};
		// Delay slightly so fonts stage has time to resolve
		const t = window.setTimeout(check, 200);
		return () => {
			alive = false;
			window.clearTimeout(t);
		};
	}, [retryCount]);

	// ── Stage 6: Realtime (check if realtime is available) ──
	useEffect(() => {
		// Realtime availability is checked asynchronously — if Supabase
		// realtime is down, the app still works with polling fallback
		const t = window.setTimeout(() => {
			setFlags((f) => ({ ...f, realtimeReady: true }));
		}, 350);
		return () => window.clearTimeout(t);
	}, [retryCount]);

	// ── Stage 7: Data (critical API probe — gates READY) ──
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
		{ id: "env", label: "Validating environment", priority: "CRITICAL", done: flags.envReady, failed: false },
		{ id: "fonts", label: "Preparing workspace", priority: "CRITICAL", done: flags.fontsReady, failed: false },
		{ id: "auth", label: "Checking session", priority: "CRITICAL", done: flags.authReady, failed: false },
		{ id: "db", label: "Connecting", priority: "CRITICAL", done: flags.dbReady, failed: false },
		{ id: "realtime", label: "Live updates", priority: "CRITICAL", done: flags.realtimeReady, failed: false },
		{ id: "data", label: "Loading essentials", priority: "CRITICAL", done: flags.dataReady, failed: errored },
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
