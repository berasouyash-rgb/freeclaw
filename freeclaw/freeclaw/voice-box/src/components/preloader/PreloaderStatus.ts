// ═══════════════════════════════════════════════════════════════════
// PreloaderStatus — typed state machine for the boot experience.
// ═══════════════════════════════════════════════════════════════════
// The preloader is a REAL readiness layer, not a timed animation:
//
//   INITIALIZING → LOADING → VERIFYING → READY → REVEAL
//   any state → ERROR → (RETRY | CONTINUE)
//
// Transitions are driven by actual readiness flags (shell mounted, fonts
// ready, critical data fetched). The animation is a visual representation
// of those flags — never a fixed 8–10s wait.
//
// SCENE-BY-SCENE PACING: each stage is held for at least SCENE_FLOOR_MS
// so the sequence reads as three distinct scenes instead of a blur of
// labels. Readiness can only SLOW the machine down (a slow probe keeps
// LOADING for as long as it takes) — it can never skip ahead of the
// current scene. A fast load still plays every scene; the total stays
// ~2.2s, never an artificial minutes-long wait.
// ═══════════════════════════════════════════════════════════════════

export type PreloaderStatus =
	| "INITIALIZING" // React shell mounting (first frame)
	| "LOADING" // critical readiness tasks in flight
	| "VERIFYING" // critical flags green, confirming final state
	| "READY" // everything required is genuinely ready
	| "REVEAL" // exit morph playing — app is interactive beneath
	| "ERROR"; // something critical failed; user chooses retry/continue

/** Individual readiness flags. Each corresponds to a REAL initialization
 *  step the platform performs — none are fabricated. */
export interface ReadinessFlags {
	/** React application shell mounted and committed. */
	shellReady: boolean;
	/** Document fonts (the app's typeface) finished loading. */
	fontsReady: boolean;
	/** Critical data probe succeeded (public, non-blocking API check). */
	dataReady: boolean;
}

/** A single load task the coordinator tracks. CRITICAL tasks gate the
 *  transition to READY; OPTIONAL tasks run but never block it. */
export type TaskPriority = "CRITICAL" | "OPTIONAL";

export interface LoadTask {
	id: string;
	label: string;
	priority: TaskPriority;
	done: boolean;
	failed: boolean;
}

/** Each scene (INITIALIZING / LOADING / VERIFYING) is held at least this long
 *  so the sequence plays scene-by-scene rather than flashing past. */
export const SCENE_FLOOR_MS = 700;
// Back-compat alias — used by the coordinator's anti-flash floor.
export const MIN_DISPLAY_MS = SCENE_FLOOR_MS;
export const MAX_WAIT_MS = 8000; // never let the user stare forever

/** The user-facing status label for each machine state. */
export const STATUS_LABELS: Record<PreloaderStatus, string> = {
	INITIALIZING: "Starting",
	LOADING: "Preparing your workspace",
	VERIFYING: "Verifying",
	READY: "Ready",
	REVEAL: "Ready",
	ERROR: "Something needs attention",
};

/** Derive the machine status from raw readiness flags + coordinator gates.
 *  Pure and deterministic — the animation layer simply reacts to this.
 *
 *  The scene schedule holds each stage for one floor (INITIALIZING < f,
 *  LOADING < 2f, VERIFYING < 3f, then READY). Real readiness is the brake:
 *  the machine never advances past a stage whose real condition is unmet,
 *  but it also never rushes past the current scene once conditions are met. */
export function statusFromFlags(
	flags: ReadinessFlags,
	opts?: {
		elapsedMs?: number;
		errored?: boolean;
		revealing?: boolean;
		/** Per-scene minimum ms (each of the 3 scenes plays for at least this long). */
		minDisplayMs?: number;
	},
): PreloaderStatus {
	if (opts?.revealing) return "REVEAL";
	if (opts?.errored) return "ERROR";

	const { elapsedMs = Infinity } = opts || {};
	const floor = opts?.minDisplayMs ?? MIN_DISPLAY_MS;
	const allCritical = flags.shellReady && flags.fontsReady && flags.dataReady;

	// Scene schedule by elapsed time (Infinity → past the last floor).
	const t = elapsedMs === Infinity ? 3 * floor : elapsedMs;
	const byTime: PreloaderStatus =
		t < floor
			? "INITIALIZING"
			: t < 2 * floor
				? "LOADING"
				: t < 3 * floor
					? "VERIFYING"
					: "READY";

	// Real readiness can only slow the machine down, never speed it up.
	if (!flags.shellReady) return "INITIALIZING";
	if (!allCritical) return byTime === "INITIALIZING" ? "INITIALIZING" : "LOADING";
	return byTime;
}

/** Clamp progress into [0,1] for the thin progress line. */
export function progressFromTasks(tasks: LoadTask[]): number {
	if (!tasks.length) return 0;
	const done = tasks.filter((t) => t.done || t.failed).length;
	return Math.min(1, done / tasks.length);
}
