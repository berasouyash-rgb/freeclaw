// ─── Load-management harness (baseline load shedding) ───────────
// Industry-standard pattern: when one serverless instance is saturated,
// fail fast with 503 + Retry-After so clients back off instead of piling
// timeouts onto an overloaded function (which is what turns a spike into
// a full outage). Per-instance, in-memory: no DB, no timers, no leaks —
// every acquire is paired with exactly one release in index.js finally.
//
// MAX_INFLIGHT history (re-tune only with measured p95 + shed rate, never by gut):
//   100 → 25.6% shed at 300 readers / 74 rps
//   200 → 0% shed at 500 readers / 194 rps (measured 2026-10-26)
//   200 → 43.0% shed at 1000 readers      (cap, not the DB, is binding)
// The routes are I/O-bound on Supabase HTTP round-trips, so the event loop
// multiplexes far more than 200 sockets. The cap exists to fail fast instead
// of letting an unbounded queue convert a spike into timeouts — it is a
// backstop, not a target throughput. Raise it only with a measured p95.
// Per-instance, in-memory. Watch /api/health load.shed_total after any change.
// Env-overridable so capacity can be swept without a code change; the default
// is the last value proven at 0% shed with p95 under 1s.
const DEFAULT_MAX_INFLIGHT = 200;
const MAX_INFLIGHT = (() => {
	const raw = Number.parseInt(process.env.MAX_INFLIGHT || "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_INFLIGHT;
})();

// Reserve the top slice of the budget for mutations: background polling is
// shed first so a burst of heartbeats can never starve a user's post/vote.
const PRIORITY_THRESHOLD = Math.floor(MAX_INFLIGHT * 0.85);

let inflight = 0;
let shedTotal = 0;
let backgroundShedTotal = 0;

/**
 * Take a slot with priority admission.
 * Under normal load (inflight < 170): admits all requests.
 * Under heavy load (170-200): sheds background heartbeats & polling first,
 * reserving critical capacity for user writes (posts, votes, comments).
 * At saturation (>= 200): fails fast with 503 + jittered Retry-After.
 */
export function loadGuardAcquire(pathname = "", method = "GET") {
	if (inflight >= MAX_INFLIGHT) {
		shedTotal += 1;
		return false;
	}

	// Priority-aware shedding: preserve headroom for mutations
	if (inflight >= PRIORITY_THRESHOLD && method === "GET") {
		const isBackground =
			pathname.includes("heartbeat") ||
			pathname.endsWith("/me") ||
			pathname.includes("stats") ||
			pathname.includes("metrics");
		if (isBackground) {
			backgroundShedTotal += 1;
			shedTotal += 1;
			return false;
		}
	}

	inflight += 1;
	return true;
}

/** Release a slot. Floored at zero so a double-release can never corrupt. */
export function loadGuardRelease() {
	inflight = Math.max(0, inflight - 1);
}

/** Compute jittered Retry-After recommendation (1 to 3 seconds) */
export function getRetryAfterHeader() {
	return String(Math.floor(1 + Math.random() * 2));
}

/** Live counters for /api/health and tests. */
export function getLoadStats() {
	return {
		inflight,
		max_inflight: MAX_INFLIGHT,
		shed_total: shedTotal,
		background_shed_total: backgroundShedTotal,
	};
}

/** Test-only reset: module state would otherwise leak across test cases. */
export function __resetLoadGuard() {
	inflight = 0;
	shedTotal = 0;
	backgroundShedTotal = 0;
}
