// ═══════════════════════════════════════════════════════════════════
// Failover control plane — decision rules only, no I/O
// ═══════════════════════════════════════════════════════════════════
// These are the rules that decide whether VoiceFlow is allowed to move onto
// the Firebase standby. They are worth pinning precisely because the two
// failure modes are silent: failing over on a 401 (an auth bug) moves every
// user's writes into the wrong backend, and failing back early lets a stale
// primary overwrite the standby's newer rows.
import { describe, expect, it } from "vitest";

import {
	CircuitBreaker,
	DEFAULT_HEALTH,
	FAILURE_KINDS,
	STATES,
	acceptsWrites,
	acquireLease,
	backendFor,
	classifyFailure,
	isStaleFence,
	nextState,
} from "../../api/_failover.js";

describe("classifyFailure — what counts as an outage", () => {
	it("treats auth/validation/not-found as client errors, never outages", () => {
		// The whole point: these prove the primary is UP and answering.
		for (const code of [400, 401, 403, 404, 405, 409, 413, 422]) {
			expect(classifyFailure(code)).toBe(FAILURE_KINDS.CLIENT);
		}
	});

	it("treats quota exhaustion and rate limiting as failover-worthy", () => {
		expect(classifyFailure(402)).toBe(FAILURE_KINDS.QUOTA);
		expect(classifyFailure(429)).toBe(FAILURE_KINDS.QUOTA);
	});

	it("treats every 5xx as an outage", () => {
		for (const code of [500, 502, 503, 504]) {
			expect(classifyFailure(code)).toBe(FAILURE_KINDS.OUTAGE);
		}
	});

	it("treats a transport failure as an outage", () => {
		expect(classifyFailure(0, { name: "AbortError" })).toBe(FAILURE_KINDS.OUTAGE);
		expect(
			classifyFailure(0, { message: "getaddrinfo ENOTFOUND db.supabase.co" }),
		).toBe(FAILURE_KINDS.OUTAGE);
	});

	it("does not treat a 3xx redirect as an outage", () => {
		expect(classifyFailure(302)).toBe(FAILURE_KINDS.CLIENT);
	});
});

describe("CircuitBreaker — three failures to leave, five to return", () => {
	it("trips only after three consecutive failures", () => {
		const b = new CircuitBreaker();
		b.recordFailure(503);
		b.recordFailure(503);
		expect(b.isTripped).toBe(false);
		b.recordFailure(503);
		expect(b.isTripped).toBe(true);
		expect(b.consecutiveFailures).toBe(3);
	});

	it("ignores client errors entirely (an auth bug must not move the backend)", () => {
		const b = new CircuitBreaker();
		for (let i = 0; i < 10; i++) b.recordFailure(401);
		expect(b.isTripped).toBe(false);
		expect(b.consecutiveFailures).toBe(0);
	});

	it("resets the failure count on a success", () => {
		const b = new CircuitBreaker();
		b.recordFailure(503);
		b.recordFailure(503);
		b.recordSuccess();
		expect(b.consecutiveFailures).toBe(0);
		// Two more failures must not trip it: the counter restarted.
		b.recordFailure(503);
		b.recordFailure(503);
		expect(b.isTripped).toBe(false);
	});

	it("needs five consecutive successes to be considered recovered", () => {
		const b = new CircuitBreaker();
		for (let i = 0; i < 4; i++) b.recordSuccess();
		expect(b.isRecovered).toBe(false);
		b.recordSuccess();
		expect(b.isRecovered).toBe(true);
	});

	it("a single failure after recovery resets the recovery count", () => {
		const b = new CircuitBreaker();
		for (let i = 0; i < 4; i++) b.recordSuccess();
		b.recordFailure(500);
		expect(b.isRecovered).toBe(false);
		expect(b.consecutiveSuccesses).toBe(0);
	});

	it("exposes the last failure kind for alerting", () => {
		const b = new CircuitBreaker();
		b.recordFailure(429);
		expect(b.lastFailureKind).toBe(FAILURE_KINDS.QUOTA);
	});

	it("rejects nonsense thresholds instead of silently disabling failover", () => {
		expect(() => new CircuitBreaker({ failureThreshold: 0 })).toThrow();
		expect(() => new CircuitBreaker({ recoveryThreshold: 0 })).toThrow();
	});

	it("ships the documented starting values", () => {
		expect(DEFAULT_HEALTH.failureThreshold).toBe(3);
		expect(DEFAULT_HEALTH.recoveryThreshold).toBe(5);
		expect(DEFAULT_HEALTH.intervalMs).toBe(5000);
	});
});

describe("nextState — the failover state machine", () => {
	it("walks the full documented path: degrade → failover → standby", () => {
		let s = STATES.PRIMARY_ACTIVE;
		s = nextState(s, "probe_failed", FAILURE_KINDS.OUTAGE);
		expect(s).toBe(STATES.PRIMARY_DEGRADED);
		s = nextState(s, "breaker_tripped");
		expect(s).toBe(STATES.FAILOVER_PENDING);
		s = nextState(s, "failover_confirmed");
		expect(s).toBe(STATES.STANDBY_ACTIVE);
		expect(backendFor(s)).toBe("standby");
	});

	it("never fails back straight from standby: recovery must reconcile", () => {
		const s = nextState(STATES.STANDBY_ACTIVE, "recovered");
		expect(s).toBe(STATES.RECOVERY_PENDING);
		expect(backendFor(s)).toBe("standby");
		const r = nextState(s, "reconcile_started");
		expect(r).toBe(STATES.RECONCILING);
		const done = nextState(r, "reconcile_ok");
		expect(done).toBe(STATES.PRIMARY_RESTORED);
		expect(backendFor(done)).toBe("primary");
	});

	it("a failed reconciliation stops everything for a human", () => {
		const s = nextState(STATES.RECONCILING, "reconcile_failed");
		expect(s).toBe(STATES.MANUAL_INTERVENTION_REQUIRED);
		expect(backendFor(s)).toBe("none");
		expect(acceptsWrites(s)).toBe(false);
	});

	it("losing the standby as well stops writes instead of losing them", () => {
		const s = nextState(STATES.STANDBY_ACTIVE, "standby_down");
		expect(s).toBe(STATES.MANUAL_INTERVENTION_REQUIRED);
		expect(acceptsWrites(s)).toBe(false);
	});

	it("a recovered probe clears a degraded primary without a full failover", () => {
		const s = nextState(STATES.PRIMARY_DEGRADED, "probe_ok");
		expect(s).toBe(STATES.PRIMARY_ACTIVE);
	});

	it("ignores events that make no sense in the current state", () => {
		expect(nextState(STATES.PRIMARY_ACTIVE, "reconcile_ok")).toBe(
			STATES.PRIMARY_ACTIVE,
		);
		expect(nextState(STATES.STANDBY_ACTIVE, "breaker_tripped")).toBe(
			STATES.STANDBY_ACTIVE,
		);
	});

	it("falls back to PRIMARY_ACTIVE for an unknown state rather than guessing", () => {
		expect(nextState("NOT_A_STATE", "probe_ok")).toBe(STATES.PRIMARY_ACTIVE);
	});
});

describe("acquireLease — exactly one writer during a failover", () => {
	const now = 1_000_000;

	it("lets the first owner in and bumps the fencing epoch", () => {
		const a = acquireLease(null, { owner: "worker-a", now });
		expect(a.acquired).toBe(true);
		expect(a.epoch).toBe(1);
	});

	it("refuses a second owner while the lease is live", () => {
		const held = { owner: "worker-a", epoch: 3, expiresAt: now + 10_000 };
		const b = acquireLease(held, { owner: "worker-b", now });
		expect(b.acquired).toBe(false);
		expect(b.epoch).toBe(3);
	});

	it("is idempotent for the same owner (re-entry, not a new epoch)", () => {
		const held = { owner: "worker-a", epoch: 3, expiresAt: now + 10_000 };
		const again = acquireLease(held, { owner: "worker-a", now });
		expect(again.acquired).toBe(true);
	});

	it("allows takeover once the lease has expired, with a higher epoch", () => {
		const expired = { owner: "worker-a", epoch: 3, expiresAt: now - 1 };
		const b = acquireLease(expired, { owner: "worker-b", now });
		expect(b.acquired).toBe(true);
		expect(b.epoch).toBe(4);
	});

	it("rejects a stale writer's fencing token after takeover", () => {
		expect(isStaleFence(3, 4)).toBe(true);
		expect(isStaleFence(4, 4)).toBe(false);
	});

	it("requires an owner", () => {
		expect(() => acquireLease(null, {})).toThrow();
	});
});
