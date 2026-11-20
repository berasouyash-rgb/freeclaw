// ─── Backend failover control plane ─────────────────────────────────
// Supabase is the primary backend, Firebase is the standby. This module is
// the DECISION half of that architecture: it says what state the system is
// in and whether a request may be routed to the standby. It holds no
// credentials, performs no I/O and never touches a database, so the rules
// below can be tested exhaustively without either provider being reachable.
//
// The I/O halves (Supabase/Firebase adapters, the replication outbox and the
// recovery worker) are separate modules; keeping the decision logic pure is
// what stops "is the primary down?" from being answered differently in three
// places — the failure this module exists to prevent.
//
// Two rules are load-bearing:
//
//   1. A 400/401/403/404/422 is NOT an outage. It is the app telling us the
//      request was wrong. Counting those as primary failures would flip the
//      whole deployment onto the standby during an auth bug or a client
//      sending bad JSON, and every user's data would silently land in the
//      wrong backend. They are classified as `client` and never trip the
//      breaker.
//   2. Failover needs CONSECUTIVE failures, and failing back needs MORE
//      consecutive successes than failures (3 vs 5). A flapping primary must
//      not oscillate the active backend, because each flip is a window where
//      two writers could accept the same record.

export const STATES = Object.freeze({
	PRIMARY_ACTIVE: "PRIMARY_ACTIVE",
	PRIMARY_DEGRADED: "PRIMARY_DEGRADED",
	FAILOVER_PENDING: "FAILOVER_PENDING",
	STANDBY_ACTIVE: "STANDBY_ACTIVE",
	RECOVERY_PENDING: "RECOVERY_PENDING",
	RECONCILING: "RECONCILING",
	PRIMARY_RESTORED: "PRIMARY_RESTORED",
	MANUAL_INTERVENTION_REQUIRED: "MANUAL_INTERVENTION_REQUIRED",
});

/** Which backend serves writes in each state. */
export const ACTIVE_BACKEND = Object.freeze({
	[STATES.PRIMARY_ACTIVE]: "primary",
	[STATES.PRIMARY_DEGRADED]: "primary",
	[STATES.FAILOVER_PENDING]: "primary",
	[STATES.STANDBY_ACTIVE]: "standby",
	[STATES.RECOVERY_PENDING]: "standby",
	[STATES.RECONCILING]: "standby",
	[STATES.PRIMARY_RESTORED]: "primary",
	// Nobody writes when humans are needed: accepting writes here is how a
	// divergent copy becomes the source of truth by accident.
	[STATES.MANUAL_INTERVENTION_REQUIRED]: "none",
});

export const FAILURE_KINDS = Object.freeze({
	OUTAGE: "outage", // unreachable / 5xx: counts toward failover
	QUOTA: "quota", // 402 / 429: a real fault, but retrying elsewhere is the FIX
	CLIENT: "client", // 4xx from the app: never an outage
});

/**
 * Map one failed attempt to a failure kind.
 *
 * `status` is the HTTP status the primary returned (0/undefined for a
 * transport failure). Anything not explicitly listed as a client error is
 * treated as an outage so a new provider error code fails SAFE (toward the
 * standby) instead of being silently ignored.
 */
export function classifyFailure(status, error) {
	const code = Number(status) || 0;
	// Auth / validation / not-found: the request is at fault, not the backend.
	if ([400, 401, 403, 404, 405, 409, 413, 422].includes(code)) {
		return FAILURE_KINDS.CLIENT;
	}
	// 402 = payment required (quota exhausted), 429 = rate limited. Neither
	// means the data is gone, and both are cured by changing backend.
	if (code === 402 || code === 429) return FAILURE_KINDS.QUOTA;
	if (code >= 500) return FAILURE_KINDS.OUTAGE;
	if (code === 0) {
		// Transport failure. AbortError/timeout/DNS all land here; an
		// explicitly non-retryable error is still an outage of the primary.
		const name = error?.name || "";
		const msg = String(error?.message || "");
		if (name === "AbortError" || /timed? ?out|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
			return FAILURE_KINDS.OUTAGE;
		}
		return FAILURE_KINDS.OUTAGE;
	}
	// 3xx and anything unclassified: not evidence the primary is down.
	return FAILURE_KINDS.CLIENT;
}

/**
 * Consecutive-failure circuit breaker with asymmetric thresholds.
 *
 * Only OUTAGE/QUOTA failures move the counter. A successful call resets it —
 * a primary that answers 50% of requests is degraded, not down, and failing
 * over on that would move every user onto the standby for a blip.
 */
export class CircuitBreaker {
	#failureThreshold;
	#recoveryThreshold;
	#consecutiveFailures = 0;
	#consecutiveSuccesses = 0;
	#lastFailureKind = null;
	#lastFailureAt = 0;

	constructor({ failureThreshold = 3, recoveryThreshold = 5 } = {}) {
		if (failureThreshold < 1) throw new Error("failureThreshold must be >= 1");
		if (recoveryThreshold < 1) throw new Error("recoveryThreshold must be >= 1");
		this.#failureThreshold = failureThreshold;
		this.#recoveryThreshold = recoveryThreshold;
	}

	get consecutiveFailures() {
		return this.#consecutiveFailures;
	}

	get consecutiveSuccesses() {
		return this.#consecutiveSuccesses;
	}

	get lastFailureKind() {
		return this.#lastFailureKind;
	}

	/** True once the primary has failed enough times in a row to be replaced. */
	get isTripped() {
		return this.#consecutiveFailures >= this.#failureThreshold;
	}

	/** True once the primary has answered enough times in a row to come back. */
	get isRecovered() {
		return this.#consecutiveSuccesses >= this.#recoveryThreshold;
	}

	/**
	 * Record a failed attempt. Returns the kind that was recorded so callers
	 * can log/alert on it. CLIENT failures are ignored entirely.
	 */
	recordFailure(status, error, now = Date.now()) {
		const kind = classifyFailure(status, error);
		if (kind === FAILURE_KINDS.CLIENT) {
			// A client error proves the primary is UP (it answered). It still
			// must not count as a success though, or a stream of 401s would
			// keep a dead-ish primary looking healthy.
			return kind;
		}
		this.#consecutiveFailures += 1;
		this.#consecutiveSuccesses = 0;
		this.#lastFailureKind = kind;
		this.#lastFailureAt = now;
		return kind;
	}

	recordSuccess() {
		this.#consecutiveSuccesses += 1;
		this.#consecutiveFailures = 0;
	}

	reset() {
		this.#consecutiveFailures = 0;
		this.#consecutiveSuccesses = 0;
		this.#lastFailureKind = null;
		this.#lastFailureAt = 0;
	}

	snapshot() {
		return {
			consecutiveFailures: this.#consecutiveFailures,
			consecutiveSuccesses: this.#consecutiveSuccesses,
			lastFailureKind: this.#lastFailureKind,
			lastFailureAt: this.#lastFailureAt,
			tripped: this.isTripped,
			recovered: this.isRecovered,
		};
	}
}

/**
 * State transitions. Pure: same (state, event) always yields the same state,
 * so a controller restart cannot invent a state that was never written down.
 *
 * Events:
 *   probe_failed{kind}  a primary attempt failed
 *   probe_ok            a primary attempt succeeded
 *   breaker_tripped     consecutive failures crossed the threshold
 *   recovered           consecutive successes crossed the recovery threshold
 *   reconcile_ok        failback data comparison passed
 *   reconcile_failed    failback data comparison failed
 *   standby_down        the standby itself became unavailable
 *   primary_stable      operator confirmed primary health
 */
export function nextState(state, event, kind) {
	const s = STATES[state] ? state : STATES.PRIMARY_ACTIVE;
	switch (event) {
		case "probe_failed":
			// QUOTA failures are a fault worth leaving for, but only an
			// OUTAGE/QUOTA kind that keeps repeating trips the breaker.
			return s === STATES.PRIMARY_ACTIVE || s === STATES.PRIMARY_RESTORED
				? STATES.PRIMARY_DEGRADED
				: s;
		case "probe_ok":
			if (s === STATES.PRIMARY_DEGRADED) return STATES.PRIMARY_ACTIVE;
			if (s === STATES.RECOVERY_PENDING || s === STATES.RECONCILING) return s;
			return s;
		case "breaker_tripped":
			if (s === STATES.PRIMARY_DEGRADED || s === STATES.PRIMARY_ACTIVE) {
				return STATES.FAILOVER_PENDING;
			}
			return s;
		case "failover_confirmed":
			return s === STATES.FAILOVER_PENDING ? STATES.STANDBY_ACTIVE : s;
		case "recovered":
			// Never fail back straight to serving: reconcile first.
			return s === STATES.STANDBY_ACTIVE ? STATES.RECOVERY_PENDING : s;
		case "reconcile_started":
			return s === STATES.RECOVERY_PENDING ? STATES.RECONCILING : s;
		case "reconcile_ok":
			return s === STATES.RECONCILING ? STATES.PRIMARY_RESTORED : s;
		case "reconcile_failed":
			return s === STATES.RECONCILING
				? STATES.MANUAL_INTERVENTION_REQUIRED
				: s;
		case "standby_down":
			// No writable backend left. Stop rather than lose writes silently.
			return STATES.MANUAL_INTERVENTION_REQUIRED;
		default:
			return s;
	}
}

export function backendFor(state) {
	return ACTIVE_BACKEND[STATES[state] ? state : STATES.PRIMARY_ACTIVE] || "none";
}

/** Whether a state may accept user writes at all. */
export function acceptsWrites(state) {
	return backendFor(state) !== "none";
}

/**
 * Exclusive failover ownership.
 *
 * Two function instances can notice the outage at the same moment. Exactly
 * one may become the writer, or both publish "standby is now active" with
 * different epochs and the recovery step cannot tell which events are
 * authoritative. `compareAndSet` is supplied by the control plane (a row with
 * a conditional update, or Firestore's transaction) — this function only
 * encodes the rule, so it is testable without either store.
 *
 * Returns { acquired, epoch, expiresAt }.
 */
export function acquireLease(holder, { owner, ttlMs = 30_000, now = Date.now() } = {}) {
	if (!owner) throw new Error("owner is required");
	const current = holder || null;
	const held = current && current.expiresAt > now;
	if (held && current.owner !== owner) {
		return { acquired: false, epoch: current.epoch, expiresAt: current.expiresAt };
	}
	const epoch = (current?.epoch || 0) + 1;
	return { acquired: true, epoch, expiresAt: now + ttlMs };
}

/**
 * A fencing token must be strictly increasing across takeovers so a stale
 * writer that wakes up after its lease expired can be rejected by the
 * backend it writes to.
 */
export function isStaleFence(token, currentEpoch) {
	const t = Number(token) || 0;
	const e = Number(currentEpoch) || 0;
	return t < e;
}

export const DEFAULT_HEALTH = Object.freeze({
	intervalMs: 5_000,
	timeoutMs: 4_000,
	failureThreshold: 3,
	recoveryThreshold: 5,
	leaseTtlMs: 30_000,
});
