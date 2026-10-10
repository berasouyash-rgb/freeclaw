// ─── Load-management harness (baseline load shedding) ───────────
// Industry-standard pattern: when one serverless instance is saturated,
// fail fast with 503 + Retry-After so clients back off instead of piling
// timeouts onto an overloaded function (which is what turns a spike into
// a full outage). Per-instance, in-memory: no DB, no timers, no leaks —
// every acquire is paired with exactly one release in index.js finally.
//
// MAX_INFLIGHT=200, measured 2026-09-27: at 300 concurrent readers (74 rps)
// the DB returned zero 5xx with served p95 <2s while the old cap of 100 shed
// 25.6% as 503s — the cap, not the database, was the binding constraint.
// Per-instance, in-memory. Re-tune only with measured p95 + shed rate,
// never by gut. Watch /api/health load.shed_total after any change.
const MAX_INFLIGHT = 200;

let inflight = 0;
let shedTotal = 0;

/** Take a slot. Returns false when saturated — the caller must 503. */
export function loadGuardAcquire() {
	if (inflight >= MAX_INFLIGHT) {
		shedTotal += 1;
		return false;
	}
	inflight += 1;
	return true;
}

/** Release a slot. Floored at zero so a double-release can never corrupt. */
export function loadGuardRelease() {
	inflight = Math.max(0, inflight - 1);
}

/** Live counters for /api/health and tests. */
export function getLoadStats() {
	return { inflight, max_inflight: MAX_INFLIGHT, shed_total: shedTotal };
}

/** Test-only reset: module state would otherwise leak across test cases. */
export function __resetLoadGuard() {
	inflight = 0;
	shedTotal = 0;
}
