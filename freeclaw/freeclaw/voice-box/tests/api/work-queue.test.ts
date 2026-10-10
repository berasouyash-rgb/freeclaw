// ═══════════════════════════════════════════════════════════════════
// Durable Work Queue — SPEC §5 states, fields, retries, dead-letter,
// crash/orphan recovery, dependencies + cron housekeeping/read-back
// ═══════════════════════════════════════════════════════════════════
// Locks the queue contract end to end: the 11-state machine with
// illegal transitions throwing, the 17 required job fields, enqueue
// idempotency, WAITING→promote→PENDING and dead-dep→BLOCKED, claim
// priority order + ownership, the mandatory-evidence verification
// gate, exact exponential backoff timing, dead-letter at maxAttempts,
// stale-claim crash recovery, block/quarantine/cancel + release,
// bounded trimming that never drops active/FAILED rows, queueStats /
// listJobs read-backs, and the incident-cron housekeeping step
// (results.queue) plus the action=queue independent read-back.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assignIncident, detectIncidents, loadIncidents } from "../../api/_incidents.js";
import { TRIAGE_JOB_TYPE, TRIAGE_WORKER, triagePriority } from "../../api/_incident-triage.js";

// untyped access to the _incidents.js mocks (real module types are
// narrower than what these fixtures return)
const triageMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// hoisted: static _incident-triage/_incidents imports now pull in
// _db-client at module-eval time, so `from` must exist before them
const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

// isCronAuthorized: these suites exercise the queue housekeeping BUSINESS
// logic, not the route's authorization — that contract is locked separately
// in incident-cron-authz.test.ts.
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isCronAuthorized: vi.fn(async () => true),
	CRON_UNAUTHORIZED_BODY: { error: "Unauthorized" },
}));

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../api/_incidents.js", () => ({
	detectIncidents: vi.fn(async () => []),
	loadIncidents: vi.fn(async () => []),
	saveIncidents: vi.fn(async () => undefined),
	addTimeline: vi.fn(),
	assignIncident: vi.fn(async () => ({ error: "not stubbed" })),
}));

// ─── in-memory settings KV + query state ────────────────────────
const settings: Record<string, unknown> = {};
const state = {
	postsCount: 0,
	reportsCount: 0,
	executions: [] as Array<{ status: string }>,
	settingsWriteFail: false,
	queueWriteFail: false,
};

/** Chainable supabase double covering every query the cron makes. */
function chainFor(table: string) {
	const chain = {
		op: "select",
		col: undefined as unknown,
		filters: {} as Record<string, unknown>,
		patch: undefined as Record<string, unknown> | undefined,
		newRow: undefined as Record<string, unknown> | undefined,
		countMode: false,
		select(col?: unknown, opts?: unknown) {
			this.col = col;
			if (opts && typeof opts === "object" && (opts as { count?: string }).count) {
				this.countMode = true;
			}
			return this;
		},
		eq(field: string, value: unknown) {
			this.filters[field] = value;
			return this;
		},
		in(field: string, value: unknown) {
			this.filters[field] = value;
			return this;
		},
		gte(field: string, value: unknown) {
			this.filters[field] = value;
			return this;
		},
		order() {
			return this;
		},
		limit() {
			return this;
		},
		maybeSingle() {
			this.op = "maybeSingle";
			return this;
		},
		single() {
			this.op = "single";
			return this;
		},
		update(patch: Record<string, unknown>) {
			this.op = "update";
			this.patch = patch;
			return this;
		},
		insert(row: Record<string, unknown>) {
			this.op = "insert";
			this.newRow = row;
			return this;
		},
		upsert(row: Record<string, unknown>) {
			this.op = "upsert";
			this.newRow = row;
			return this;
		},
		then(fn: (v: unknown) => void) {
			if (table === "settings") {
				const key = this.filters.key as string | undefined;
				if (this.op === "update") {
					if (
						state.settingsWriteFail ||
						(state.queueWriteFail && key === "work_queue")
					) {
						fn({ data: null, error: { message: "simulated write failure" } });
						return;
					}
					if (key !== undefined && this.patch && "value" in this.patch) {
						settings[key] = this.patch.value;
					}
					fn({ data: null, error: null });
					return;
				}
				if (this.op === "insert") {
					if (
						state.settingsWriteFail ||
						(state.queueWriteFail &&
							(this.newRow as Record<string, unknown>)?.key === "work_queue")
					) {
						fn({ data: null, error: { message: "simulated write failure" } });
						return;
					}
					const row = this.newRow as Record<string, unknown>;
					settings[row.key as string] = row.value;
					fn({ data: row, error: null });
					return;
				}
				if (this.op === "maybeSingle" || this.op === "single") {
					fn({
						data: key !== undefined && key in settings ? { value: settings[key] } : null,
						error: null,
					});
					return;
				}
				// plain select (latency probe)
				fn({ data: [], error: null });
				return;
			}
			if (table === "posts" && this.countMode) {
				fn({ data: null, count: state.postsCount, error: null });
				return;
			}
			if (table === "reports" && this.countMode) {
				fn({ data: null, count: state.reportsCount, error: null });
				return;
			}
			if (table === "agent_executions") {
				fn({ data: state.executions, error: null });
				return;
			}
			fn({ data: [], count: 0, error: null });
		},
	};
	return chain;
}

type Handler = (req: Record<string, unknown>, res: unknown) => Promise<unknown>;

let handler: Handler;
let buildJob: (input: Record<string, unknown>) => Record<string, any>;
let backoffDelayMs: (policy: unknown, attempts: number) => number;
let assertTransition: (from: string, to: string) => string;
let enqueueJob: (input: Record<string, unknown>) => Promise<any>;
let enqueueClaim: (worker: string, opts?: Record<string, unknown>) => Promise<any>;
let startJob: (id: string, worker: string) => Promise<any>;
let heartbeatJob: (id: string, worker: string) => Promise<any>;
let submitVerification: (id: string, opts: Record<string, unknown>) => Promise<any>;
let resolveVerification: (id: string, opts: Record<string, unknown>) => Promise<any>;
let failJob: (id: string, reason: string, opts?: Record<string, unknown>) => Promise<any>;
let releaseJob: (id: string, opts: Record<string, unknown>) => Promise<any>;
let blockJob: (id: string, reason: string) => Promise<any>;
let quarantineJob: (id: string, reason: string) => Promise<any>;
let unblockJob: (id: string) => Promise<any>;
let releaseQuarantine: (id: string) => Promise<any>;
let cancelJob: (id: string, reason: string) => Promise<any>;
let releaseRetried: () => Promise<number>;
let recoverStaleJobs: () => Promise<number>;
let promoteWaiting: () => Promise<{ promoted: number; blocked: number }>;
let getJob: (id: string) => Promise<any>;
let listJobs: (filters?: Record<string, unknown>) => Promise<any[]>;
let listDeadLetters: () => Promise<any[]>;
let queueStats: () => Promise<Record<string, number>>;
let QUEUE_STATES: string[];
let JOB_FIELDS: string[];

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

/** Queue rows as stored in the settings KV (mutable reference view). */
function storedJobs() {
	const row = settings.work_queue as { jobs: any[] } | undefined;
	return row?.jobs ?? [];
}

function makeJob(overrides: Record<string, unknown> = {}) {
	return buildJob({
		type: "test.task",
		idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
		...overrides,
	});
}

beforeEach(async () => {
	vi.clearAllMocks();
	for (const k of Object.keys(settings)) delete settings[k];
	state.postsCount = 7;
	state.reportsCount = 2;
	state.settingsWriteFail = false;
	state.queueWriteFail = false;
	state.executions = [
		{ status: "completed" },
		{ status: "completed" },
		{ status: "completed" },
		{ status: "failed" },
	];
	settings.system_metrics = {
		error_rate: 0.01,
		api_p95_ms: 120,
		cache_hit_rate: 0.95,
		search_zero_rate: 0.02,
		db_query_ms: 55,
	};
	settings.event_log = { events: [{ id: "e1" }, { id: "e2" }, { id: "e3" }] };
	from.mockImplementation((table: string) => chainFor(table));

	// triage mocks return to their inert defaults (implementations set in
	// one test must never leak into the next — clearAllMocks keeps impls)
	(detectIncidents as unknown as ReturnType<typeof vi.fn>).mockImplementation(
		async () => [],
	);
	(loadIncidents as unknown as ReturnType<typeof vi.fn>).mockImplementation(
		async () => [],
	);
	(assignIncident as unknown as ReturnType<typeof vi.fn>).mockImplementation(
		async () => ({ error: "not stubbed" }),
	);

	({ default: handler } = await import("../../api/_incident-cron.js"));
	({
		buildJob,
		backoffDelayMs,
		assertTransition,
		enqueueJob,
		enqueueClaim,
		startJob,
		heartbeatJob,
		submitVerification,
		resolveVerification,
		failJob,
		releaseJob,
		blockJob,
		quarantineJob,
		unblockJob,
		releaseQuarantine,
		cancelJob,
		releaseRetried,
		recoverStaleJobs,
		promoteWaiting,
		getJob,
		listJobs,
		listDeadLetters,
		queueStats,
		QUEUE_STATES,
		JOB_FIELDS,
	} = await import("../../api/_work-queue.js"));

	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-23T10:00:00.000Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("state machine + job fields — SPEC §5 (held-out)", () => {
	it("ships exactly the 11 durable states", () => {
		expect(QUEUE_STATES).toHaveLength(11);
		for (const s of [
			"PENDING", "CLAIMED", "RUNNING", "WAITING", "RETRYING", "VERIFYING",
			"COMPLETED", "FAILED", "BLOCKED", "QUARANTINED", "CANCELLED",
		]) {
			expect(QUEUE_STATES).toContain(s);
		}
		expect(QUEUE_STATES).not.toContain("UNKNOWN");
		expect(QUEUE_STATES).not.toContain("SUCCESS");
	});

	it("ships exactly the 17 required job fields (held-out count)", () => {
		expect(JOB_FIELDS).toHaveLength(17);
		const job = makeJob();
		for (const f of JOB_FIELDS) {
			expect(Object.keys(job)).toContain(f);
		}
	});

	it("rejects illegal transitions and terminal states are final", () => {
		expect(() => assertTransition("PENDING", "COMPLETED")).toThrow(
			"invalid transition: PENDING → COMPLETED",
		);
		expect(() => assertTransition("COMPLETED", "PENDING")).toThrow(/invalid transition/);
		expect(() => assertTransition("FAILED", "PENDING")).toThrow(/invalid transition/);
		expect(() => assertTransition("CANCELLED", "PENDING")).toThrow(/invalid transition/);
		expect(() => assertTransition("BOGUS", "PENDING")).toThrow(/unknown state/);
		expect(assertTransition("RUNNING", "RUNNING")).toBe("RUNNING");
		expect(assertTransition("RUNNING", "VERIFYING")).toBe("VERIFYING");
	});
});

describe("buildJob — validation", () => {
	it("requires type and idempotencyKey", () => {
		expect(() => buildJob({})).toThrow("type is required");
		expect(() => buildJob({ type: "t" })).toThrow("idempotencyKey is required");
		expect(() => buildJob(null)).toThrow("input object required");
		expect(() => buildJob([] as any)).toThrow("input object required");
	});

	it("rejects bad priority, maxAttempts, timeout, dependencies, input, evidence, retryPolicy", () => {
		expect(() => makeJob({ priority: "urgent" })).toThrow(/unknown priority/);
		expect(() => makeJob({ maxAttempts: 0 })).toThrow(/maxAttempts/);
		expect(() => makeJob({ timeout: -1 })).toThrow(/timeout/);
		expect(() => makeJob({ dependencies: [123] })).toThrow(/dependencies/);
		expect(() => makeJob({ parentJobId: 42 })).toThrow(/parentJobId/);
		expect(() => makeJob({ input: "nope" })).toThrow(/input payload/);
		expect(() => makeJob({ evidence: "not-array" })).toThrow(/evidence/);
		expect(() => makeJob({ retryPolicy: { backoffBaseMs: -5 } })).toThrow(/backoffBaseMs/);
		expect(() => makeJob({ retryPolicy: [] })).toThrow(/retryPolicy/);
	});

	it("defaults a new job to PENDING with attempts 0 and full policy", () => {
		const job = makeJob({ type: "demo" });
		expect(job.state).toBe("PENDING");
		expect(job.attempts).toBe(0);
		expect(job.maxAttempts).toBe(3);
		expect(job.priority).toBe("medium");
		expect(job.timeout).toBe(300000);
		expect(job.retryPolicy).toEqual({
			backoffBaseMs: 1000,
			backoffFactor: 2,
			backoffMaxMs: 300000,
		});
		expect(job.evidence).toEqual([]);
		expect(job.failureReason).toBeNull();
		expect(typeof job.traceId).toBe("string");
	});
});

describe("enqueueJob — idempotency, dedup, dependencies", () => {
	it("stores one record and dedupes a repeat idempotencyKey", async () => {
		const input = { type: "dedup.task", idempotencyKey: "key-1" };
		const r1 = await enqueueJob(input);
		const r2 = await enqueueJob(input);
		expect(r1.enqueued).toBe(true);
		expect(r2.enqueued).toBe(false);
		expect(r2.reason).toBe("duplicate");
		expect(r2.job.id).toBe(r1.job.id);
		expect(storedJobs()).toHaveLength(1);
	});

	it("starts jobs with dependencies in WAITING", async () => {
		const r = await enqueueJob({
			type: "dep.task",
			idempotencyKey: "dep-1",
			dependencies: ["some-other-job"],
		});
		expect(r.job.state).toBe("WAITING");
		expect(storedJobs()[0].state).toBe("WAITING");
	});

	it("throws on a failed write — failure never looks like success", async () => {
		await enqueueJob({ type: "wf.task", idempotencyKey: "wf-1" });
		state.settingsWriteFail = true;
		await expect(enqueueJob({ type: "wf.task", idempotencyKey: "wf-2" })).rejects.toThrow(
			"work_queue write failed",
		);
		expect(storedJobs()).toHaveLength(1);
	});
});

describe("dependencies — promote + dead-dep blocking", () => {
	it("promotes WAITING to PENDING when all deps COMPLETED", async () => {
		const dep = await enqueueJob({ type: "dep.a", idempotencyKey: "d-a" });
		await enqueueJob({
			type: "child.a",
			idempotencyKey: "c-a",
			dependencies: [dep.job.id],
		});
		// dep still PENDING → child stays WAITING
		let sweep = await promoteWaiting();
		expect(sweep.promoted).toBe(0);
		expect(await getJob(storedJobs()[1].id)).toMatchObject({ state: "WAITING" });

		// complete the dep through the real lifecycle
		await enqueueClaim("w1", { type: "dep.a" });
		await startJob(dep.job.id, "w1");
		await submitVerification(dep.job.id, { worker: "w1", evidence: [{ proof: 1 }] });
		await resolveVerification(dep.job.id, { passed: true, worker: "w1" });
		expect(await getJob(dep.job.id)).toMatchObject({ state: "COMPLETED" });

		sweep = await promoteWaiting();
		expect(sweep.promoted).toBe(1);
		expect(await getJob(storedJobs()[1].id)).toMatchObject({ state: "PENDING" });
	});

	it("BLOCKs a WAITING job whose dependency is FAILED, naming the dep", async () => {
		const dep = await enqueueJob({ type: "dep.b", idempotencyKey: "d-b", maxAttempts: 1 });
		const child = await enqueueJob({
			type: "child.b",
			idempotencyKey: "c-b",
			dependencies: [dep.job.id],
		});
		await enqueueClaim("w1", { type: "dep.b" });
		await startJob(dep.job.id, "w1");
		await failJob(dep.job.id, "upstream exploded", { worker: "w1" });
		expect(await getJob(dep.job.id)).toMatchObject({ state: "FAILED" });

		const sweep = await promoteWaiting();
		expect(sweep.blocked).toBe(1);
		const blocked = await getJob(child.job.id);
		expect(blocked.state).toBe("BLOCKED");
		expect(blocked.failureReason).toContain(dep.job.id);
		expect(blocked.failureReason).toContain("FAILED");
	});
});

describe("claim/start/heartbeat — priority, ownership", () => {
	it("claims highest priority first, then oldest", async () => {
		await enqueueJob({ type: "t.low", idempotencyKey: "p-low", priority: "low" });
		await enqueueJob({ type: "t.crit", idempotencyKey: "p-crit", priority: "critical" });
		await enqueueJob({ type: "t.med", idempotencyKey: "p-med", priority: "medium" });

		const c1 = await enqueueClaim("w1");
		expect(c1.job.priority).toBe("critical");
		const c2 = await enqueueClaim("w1");
		expect(c2.job.priority).toBe("medium");
		const c3 = await enqueueClaim("w1");
		expect(c3.job.priority).toBe("low");
		expect((await enqueueClaim("w1")).claimed).toBe(false);
	});

	it("never claims WAITING or RETRYING jobs", async () => {
		await enqueueJob({ type: "t.wait", idempotencyKey: "c-w", dependencies: ["missing"] });
		await enqueueJob({ type: "t.retry", idempotencyKey: "c-r" });
		await enqueueClaim("w1", { type: "t.retry" });
		await startJob(storedJobs()[1].id, "w1");
		await failJob(storedJobs()[1].id, "boom", { worker: "w1" });
		expect(storedJobs()[1].state).toBe("RETRYING");

		const claim = await enqueueClaim("w2");
		expect(claim.claimed).toBe(false);
	});

	it("enforces owner-only start, heartbeat, verification, and release", async () => {
		await enqueueJob({ type: "own.task", idempotencyKey: "own-1" });
		const { job } = await enqueueClaim("w1");
		await expect(startJob(job.id, "intruder")).rejects.toThrow(/not claimed by "intruder"/);
		await startJob(job.id, "w1");
		await expect(heartbeatJob(job.id, "intruder")).rejects.toThrow(/not claimed by/);
		await expect(
			submitVerification(job.id, { worker: "intruder", evidence: [{ x: 1 }] }),
		).rejects.toThrow(/not claimed by/);
		await expect(releaseJob(job.id, { worker: "intruder" })).rejects.toThrow(
			/not claimed by/,
		);
		// real owner can heartbeat and release
		await heartbeatJob(job.id, "w1");
		const released = await releaseJob(job.id, { worker: "w1" });
		expect(released.state).toBe("PENDING");
		expect(released.worker).toBeNull();
		expect(released.attempts).toBe(0);
	});

	it("rejects a claim without a worker", async () => {
		await expect(enqueueClaim("")).rejects.toThrow(/worker is required/);
		await expect(enqueueClaim(undefined as any)).rejects.toThrow(/worker is required/);
	});
});

describe("verification — evidence is mandatory", () => {
	it("requires non-empty evidence to leave RUNNING", async () => {
		await enqueueJob({ type: "verify.task", idempotencyKey: "v-1" });
		const { job } = await enqueueClaim("w1");
		await startJob(job.id, "w1");
		await expect(
			submitVerification(job.id, { worker: "w1", evidence: [] }),
		).rejects.toThrow(/non-empty evidence/);
		expect(await getJob(job.id)).toMatchObject({ state: "RUNNING" });

		const v = await submitVerification(job.id, {
			worker: "w1",
			evidence: [{ check: "re-read after write" }],
			result: { ok: true },
		});
		expect(v.state).toBe("VERIFYING");
		expect(v.evidence).toHaveLength(1);
		expect(v.result).toEqual({ ok: true });

		const done = await resolveVerification(job.id, { passed: true, worker: "w1" });
		expect(done.state).toBe("COMPLETED");
		expect(done.completedAt).not.toBeNull();
		expect(done.failureReason).toBeNull();
	});

	it("routes a failed verification to retry/dead-letter, never to COMPLETED", async () => {
		await enqueueJob({ type: "verify.fail", idempotencyKey: "v-2", maxAttempts: 3 });
		const { job } = await enqueueClaim("w1");
		await startJob(job.id, "w1");
		await submitVerification(job.id, { worker: "w1", evidence: [{ check: 1 }] });

		// a failed resolve without a reason is rejected while still VERIFYING
		await expect(
			resolveVerification(job.id, { passed: false, worker: "w1" }),
		).rejects.toThrow(/failureReason/);
		expect(await getJob(job.id)).toMatchObject({ state: "VERIFYING" });

		const failed = await resolveVerification(job.id, {
			passed: false,
			failureReason: "verification mismatch",
			worker: "w1",
		});
		expect(failed.state).toBe("RETRYING");
		expect(failed.attempts).toBe(1);
		expect(failed.failureReason).toBe("verification mismatch");
		expect(failed.completedAt).toBeNull();

		// VERIFYING → COMPLETED is the only completion edge; from RETRYING
		// there is no path to COMPLETED without re-running + re-verifying
		expect(() => assertTransition("RETRYING", "COMPLETED")).toThrow(/invalid transition/);
		// failure cleared ownership — the old worker can no longer act
		await expect(
			resolveVerification(job.id, { passed: false, failureReason: "x", worker: "w1" }),
		).rejects.toThrow(/not claimed by/);
	});
});

describe("retries, backoff, dead-letter — SPEC §5", () => {
	it("computes exact exponential backoff: attempt n → base·factor^(n-1), capped", () => {
		const policy = { backoffBaseMs: 1000, backoffFactor: 2, backoffMaxMs: 300000 };
		expect(backoffDelayMs(policy, 1)).toBe(1000);
		expect(backoffDelayMs(policy, 2)).toBe(2000);
		expect(backoffDelayMs(policy, 3)).toBe(4000);
		expect(backoffDelayMs(policy, 20)).toBe(300000);
		expect(backoffDelayMs(undefined, 1)).toBe(1000);
	});

	it("fails to RETRYING with exact nextRetryAt, releases only when due", async () => {
		await enqueueJob({ type: "retry.task", idempotencyKey: "r-1" });
		const { job } = await enqueueClaim("w1");
		await startJob(job.id, "w1");

		const t0 = Date.now();
		const failed = await failJob(job.id, "attempt 1 broke", { worker: "w1" });
		expect(failed.state).toBe("RETRYING");
		expect(failed.attempts).toBe(1);
		expect(failed.nextRetryAt).toBe(new Date(t0 + 1000).toISOString());
		expect(failed.worker).toBeNull();

		// not yet due → no release, no write
		expect(await releaseRetried()).toBe(0);
		expect((await getJob(job.id)).state).toBe("RETRYING");

		// advance past the 1000 ms backoff → released to PENDING
		vi.setSystemTime(new Date(t0 + 1001));
		expect(await releaseRetried()).toBe(1);
		const back = await getJob(job.id);
		expect(back.state).toBe("PENDING");
		expect(back.nextRetryAt).toBeNull();
		expect(back.attempts).toBe(1);
	});

	it("dead-letters at maxAttempts with reason + attempts retained, listable", async () => {
		await enqueueJob({ type: "dead.task", idempotencyKey: "dl-1", maxAttempts: 2 });
		const first = await enqueueClaim("w1");
		await startJob(first.job.id, "w1");
		await failJob(first.job.id, "first failure", { worker: "w1" });
		expect((await getJob(first.job.id)).state).toBe("RETRYING");

		vi.advanceTimersByTime(1001);
		await releaseRetried();
		const second = await enqueueClaim("w1");
		expect(second.job.id).toBe(first.job.id);
		await startJob(second.job.id, "w1");
		const dead = await failJob(second.job.id, "second failure", { worker: "w1" });

		expect(dead.state).toBe("FAILED");
		expect(dead.attempts).toBe(2);
		expect(dead.failureReason).toBe("second failure");

		const letters = await listDeadLetters();
		expect(letters).toHaveLength(1);
		expect(letters[0]).toMatchObject({
			id: first.job.id,
			type: "dead.task",
			attempts: 2,
			maxAttempts: 2,
			failureReason: "second failure",
		});

		// FAILED is terminal — no claim, no transition out
		expect((await enqueueClaim("w2")).claimed).toBe(false);
		expect(() => assertTransition("FAILED", "PENDING")).toThrow(/invalid transition/);
	});

	it("requires a failureReason and rejects non-system strangers", async () => {
		await enqueueJob({ type: "gate.task", idempotencyKey: "g-1" });
		const { job } = await enqueueClaim("w1");
		await expect(failJob(job.id, "")).rejects.toThrow(/failureReason/);
		await expect(failJob(job.id, "x", { worker: "intruder" })).rejects.toThrow(
			/not claimed by/,
		);
		// system recovery path (crash sweeper) may fail without ownership
		const sys = await failJob(job.id, "system recovery", { system: true });
		expect(sys.attempts).toBe(1);
	});
});

describe("crash/orphan recovery — SPEC §5", () => {
	it("recovers stale CLAIMED/RUNNING jobs after the job timeout", async () => {
		await enqueueJob({ type: "stale.task", idempotencyKey: "s-1", timeout: 5000 });
		const { job } = await enqueueClaim("w1");
		await startJob(job.id, "w1");

		// inside the timeout → untouched
		expect(await recoverStaleJobs()).toBe(0);
		expect(await getJob(job.id)).toMatchObject({ state: "RUNNING" });

		// past the timeout → failed like any attempt (crash burn)
		vi.advanceTimersByTime(5001);
		expect(await recoverStaleJobs()).toBe(1);
		const recovered = await getJob(job.id);
		expect(recovered.state).toBe("RETRYING");
		expect(recovered.attempts).toBe(1);
		expect(recovered.failureReason).toContain("stale claim");
		expect(recovered.worker).toBeNull();
	});

	it("dead-letters a stale job that already burned its attempts", async () => {
		await enqueueJob({ type: "stale.dead", idempotencyKey: "s-2", timeout: 1000, maxAttempts: 1 });
		const { job } = await enqueueClaim("w1");
		await startJob(job.id, "w1");
		vi.advanceTimersByTime(1001);
		expect(await recoverStaleJobs()).toBe(1);
		expect(await getJob(job.id)).toMatchObject({
			state: "FAILED",
			attempts: 1,
			failureReason: expect.stringContaining("stale claim"),
		});
	});
});

describe("block / quarantine / cancel + release", () => {
	it("blocks, quarantines, cancels with reasons; releases back to PENDING", async () => {
		await enqueueJob({ type: "hold.a", idempotencyKey: "h-1" });
		await enqueueJob({ type: "hold.b", idempotencyKey: "h-2" });
		await enqueueJob({ type: "hold.c", idempotencyKey: "h-3" });

		const a = storedJobs()[0];
		const b = storedJobs()[1];
		const c = storedJobs()[2];

		const blocked = await blockJob(a.id, "operator hold");
		expect(blocked.state).toBe("BLOCKED");
		expect(blocked.failureReason).toBe("operator hold");
		expect(await unblockJob(a.id)).toMatchObject({ state: "PENDING", failureReason: null });

		const quarantined = await quarantineJob(b.id, "safety ladder step 2");
		expect(quarantined.state).toBe("QUARANTINED");
		expect(await releaseQuarantine(b.id)).toMatchObject({ state: "PENDING" });

		const cancelled = await cancelJob(c.id, "operator cancelled");
		expect(cancelled.state).toBe("CANCELLED");
		expect(cancelled.failureReason).toBe("operator cancelled");

		// reasons are mandatory
		await expect(blockJob(a.id, "")).rejects.toThrow(/requires a reason/);
		await expect(quarantineJob(b.id, " ")).rejects.toThrow(/requires a reason/);
		await expect(cancelJob(c.id, "")).rejects.toThrow(/requires a reason/);
		// release only from the matching hold state
		await expect(unblockJob(b.id)).rejects.toThrow(/not BLOCKED/);
		await expect(releaseQuarantine(a.id)).rejects.toThrow(/not QUARANTINED/);
		// CANCELLED is terminal
		expect(() => assertTransition("CANCELLED", "PENDING")).toThrow(/invalid transition/);
		// nothing claimable once every row is terminal
		await cancelJob(a.id, "cleanup");
		await cancelJob(b.id, "cleanup");
		expect((await enqueueClaim("w1")).claimed).toBe(false);
	});

	it("blocks a RUNNING job (safety gate) and cannot promote it", async () => {
		await enqueueJob({ type: "gate.run", idempotencyKey: "gr-1" });
		const { job } = await enqueueClaim("w1");
		await startJob(job.id, "w1");
		const blocked = await blockJob(job.id, "detected unsafe action");
		expect(blocked.state).toBe("BLOCKED");
		expect(blocked.worker).toBeNull();
		expect((await promoteWaiting()).promoted).toBe(0);
	});
});

describe("read-backs — listJobs, queueStats, trimming", () => {
	it("filters by state/type/worker, newest first, and rejects unknown states", async () => {
		await enqueueJob({ type: "rb.a", idempotencyKey: "rb-1" });
		await enqueueJob({ type: "rb.b", idempotencyKey: "rb-2" });
		await enqueueJob({ type: "rb.a", idempotencyKey: "rb-3" });
		await enqueueClaim("w1", { type: "rb.a" });

		const all = await listJobs();
		expect(all).toHaveLength(3);
		expect(all[0].idempotencyKey).toBe("rb-3");
		expect(await listJobs({ type: "rb.a" })).toHaveLength(2);
		expect(await listJobs({ state: "CLAIMED" })).toHaveLength(1);
		expect(await listJobs({ worker: "w1" })).toHaveLength(1);
		expect(await listJobs({ limit: 1 })).toHaveLength(1);
		expect(await listJobs({ limit: 0 })).toHaveLength(0);
		await expect(listJobs({ state: "UNKNOWN" })).rejects.toThrow(/unknown state/);
	});

	it("queueStats counts all 11 states + total", async () => {
		const empty = await queueStats();
		expect(empty.total).toBe(0);
		expect(Object.keys(empty)).toHaveLength(12);

		await enqueueJob({ type: "st.a", idempotencyKey: "st-1" });
		await enqueueJob({ type: "st.b", idempotencyKey: "st-2" });
		await enqueueClaim("w1", { type: "st.a" });
		const stats = await queueStats();
		expect(stats.total).toBe(2);
		expect(stats.PENDING).toBe(1);
		expect(stats.CLAIMED).toBe(1);
		expect(stats.COMPLETED).toBe(0);
		expect(stats.FAILED).toBe(0);
	});

	it("trims oldest COMPLETED/CANCELLED past 500; active + FAILED survive", async () => {
		// seed 505 terminal jobs directly (skip per-call enqueue cost)
		const terminal = [];
		for (let i = 0; i < 505; i++) {
			const j = makeJob({ type: `seed.${i}`, idempotencyKey: `seed-${i}` });
			j.state = i % 2 === 0 ? "COMPLETED" : "CANCELLED";
			j.updatedAt = new Date(Date.now() + i).toISOString();
			terminal.push(j);
		}
		settings.work_queue = { jobs: terminal };

		// a write (any mutation) triggers trim
		await enqueueJob({ type: "trim.trigger", idempotencyKey: "trim-1" });
		const jobs = storedJobs();
		expect(jobs.length).toBe(500);
		expect(jobs.some((j: any) => j.idempotencyKey === "trim-1")).toBe(true);
		expect(jobs[0].idempotencyKey).toBe("seed-6"); // 506 → 500: six oldest trimmed
	});

	it("never trims active or FAILED rows even past the bound", async () => {
		const rows = [];
		for (let i = 0; i < 502; i++) {
			const j = makeJob({ type: `act.${i}`, idempotencyKey: `act-${i}` });
			j.state = "FAILED";
			j.failureReason = "kept";
			rows.push(j);
		}
		settings.work_queue = { jobs: rows };
		await enqueueJob({ type: "keep.trigger", idempotencyKey: "keep-1" });
		// nothing trimmable → correctness over bound (503 rows retained)
		expect(storedJobs().length).toBe(503);
	});
});

describe("GET /api/incident-cron — queue housekeeping + read-back", () => {
	it("run reports results.queue with housekeeping counts and stats", async () => {
		const res = response();
		await handler({ method: "GET", query: { action: "run" } }, res);
		expect(res.statusCode).toBe(200);
		const body = res.body as any;
		expect(body.queue).not.toBeNull();
		expect(body.queue).toMatchObject({ released: 0, recovered: 0, promoted: 0, blocked: 0 });
		expect(body.queue.stats.total).toBe(0);
		expect(body.queue.stats.PENDING).toBe(0);
	});

	it("run releases a due retry and recovers a stale claim in the same sweep", async () => {
		// due retry: failed earlier, backoff elapsed
		await enqueueJob({ type: "cron.retry", idempotencyKey: "cr-1" });
		const c1 = await enqueueClaim("w1");
		await startJob(c1.job.id, "w1");
		await failJob(c1.job.id, "flaky", { worker: "w1" });
		// stale claim: claimed and abandoned past timeout
		await enqueueJob({ type: "cron.stale", idempotencyKey: "cs-1", timeout: 1000 });
		const c2 = await enqueueClaim("w2");
		await startJob(c2.job.id, "w2");

		vi.advanceTimersByTime(300001); // > backoff (1000) and > timeout (1000)

		const res = response();
		await handler({ method: "GET", query: { action: "run" } }, res);
		const body = res.body as any;
		expect(body.queue.released).toBe(1);
		expect(body.queue.recovered).toBe(1);
		expect(body.queue.stats.total).toBe(2);
		expect((await getJob(c1.job.id)).state).toBe("PENDING");
		expect((await getJob(c2.job.id)).state).toBe("RETRYING");
	});

	it("promotes and blocks dependencies during the run sweep", async () => {
		const depOk = await enqueueJob({ type: "dep.ok", idempotencyKey: "d-ok" });
		await enqueueJob({ type: "dep.bad", idempotencyKey: "d-bad", maxAttempts: 1 });
		await enqueueJob({
			type: "child.ok",
			idempotencyKey: "c-ok",
			dependencies: [depOk.job.id],
		});
		await enqueueClaim("w1", { type: "dep.ok" });
		await startJob(depOk.job.id, "w1");
		await submitVerification(depOk.job.id, { worker: "w1", evidence: [{ ok: 1 }] });
		await resolveVerification(depOk.job.id, { passed: true, worker: "w1" });

		const depBad = await enqueueClaim("w2", { type: "dep.bad" });
		await startJob(depBad.job.id, "w2");
		await failJob(depBad.job.id, "kaput", { worker: "w2" });
		const childBad = await enqueueJob({
			type: "child.bad",
			idempotencyKey: "c-bad",
			dependencies: [depBad.job.id],
		});

		const res = response();
		await handler({ method: "GET", query: { action: "run" } }, res);
		const body = res.body as any;
		expect(body.queue.promoted).toBe(1);
		expect(body.queue.blocked).toBe(1);
		expect(body.queue.stats.PENDING).toBe(1);
		expect(body.queue.stats.BLOCKED).toBe(1);
		expect((await getJob(childBad.job.id)).state).toBe("BLOCKED");
	});

	it("reports a queue recovery failure in errors without faking success", async () => {
		await enqueueJob({ type: "wf.task", idempotencyKey: "qwf-1" });
		await enqueueClaim("w1");
		await failJob(storedJobs()[0].id, "boom", { worker: "w1" }); // RETRYING, due in 1000 ms
		vi.advanceTimersByTime(300001);

		state.settingsWriteFail = true; // releaseRetried must throw
		const res = response();
		await handler({ method: "GET", query: { action: "run" } }, res);
		const body = res.body as any;
		expect(body.queue).toBeNull();
		expect(
			body.errors.some((e: string) => e.includes("queue recovery failed")),
		).toBe(true);
		// the job is still RETRYING — the failed sweep changed nothing
		expect(storedJobs()[0].state).toBe("RETRYING");
	});

	it("serves action=queue as an independent read-back with stats", async () => {
		await enqueueJob({ type: "rbq.a", idempotencyKey: "rbq-1" });
		await enqueueJob({ type: "rbq.b", idempotencyKey: "rbq-2" });
		await enqueueClaim("w1", { type: "rbq.a" });

		const res = response();
		await handler({ method: "GET", query: { action: "queue" } }, res);
		expect(res.statusCode).toBe(200);
		const body = res.body as any;
		expect(body.count).toBe(2);
		expect(body.stats.total).toBe(2);
		expect(body.stats.CLAIMED).toBe(1);
		const ids = body.jobs.map((j: any) => j.id);
		const direct = await listJobs();
		expect(direct.map((j) => j.id)).toEqual(ids);

		const filtered = response();
		await handler(
			{ method: "GET", query: { action: "queue", state: "CLAIMED", type: "rbq.a" } },
			filtered,
		);
		const fbody = filtered.body as any;
		expect(fbody.count).toBe(1);
		expect(fbody.jobs[0].state).toBe("CLAIMED");

		const bad = response();
		await expect(
			handler({ method: "GET", query: { action: "queue", state: "UNKNOWN" } }, bad),
		).rejects.toThrow(/unknown state/);
	});

	it("keeps the 400 message accurate for unknown actions", async () => {
		const res = response();
		await handler({ method: "GET", query: { action: "bogus" } }, res);
		expect(res.statusCode).toBe(400);
		const msg = String((res.body as any).error);
		expect(msg).toContain("run|metrics|health|events|queue");
	});
});

// slice 17 — incident triage producer + verified queue worker (SPEC §5).
// loadIncidents returns this array BY REFERENCE, so the consumer's observe
// pass and its independent verification re-read both see mutations the
// assignIncident mock persists into the shared store.
describe("incident triage producer + verified queue worker", () => {
	let incidents: any[];

	beforeEach(() => {
		incidents = [];
		triageMock(loadIncidents).mockImplementation(async () => incidents);
	});

	function seedIncident(overrides: Record<string, unknown> = {}) {
		const inc: any = {
			id: "INC-1001",
			title: "checkout failures after deploy",
			severity: "critical",
			status: "DETECTED",
			affected_service: "payments",
			worker_assignments: [],
			...overrides,
		};
		incidents.push(inc);
		return inc;
	}

	async function runCycle() {
		const res = response();
		await handler({ method: "GET", query: { action: "run" } }, res);
		return res.body as any;
	}

	it("produces a job, assigns for real, and completes via independent verification", async () => {
		const inc = seedIncident();
		triageMock(detectIncidents).mockImplementation(async () => [inc]);
		triageMock(assignIncident).mockImplementation(
			async (id: string, workerId: string, task: string) => {
				const target = incidents.find((x) => x.id === id);
				if (!target) return { error: "Incident not found" };
				target.status = "ASSIGNED";
				target.worker_assignments.push({
					worker_id: workerId,
					task,
					assigned_at: "2026-09-23T10:00:00.000Z",
				});
				return target;
			},
		);

		const body = await runCycle();

		expect(body.errors.filter((e: string) => e.startsWith("triage "))).toEqual([]);
		expect(body.triage.produced).toEqual({ enqueued: 1, duplicates: 0, errors: [] });
		expect(body.triage.consumed).toEqual({
			claimed: 1,
			completed: 1,
			failed: 0,
			cancelled: 0,
			errors: [],
		});

		const jobs = storedJobs();
		expect(jobs).toHaveLength(1);
		const job = jobs[0];
		expect(job.type).toBe(TRIAGE_JOB_TYPE);
		expect(job.state).toBe("COMPLETED");
		expect(job.priority).toBe("critical");
		expect(job.worker).toBe(TRIAGE_WORKER);
		expect(job.attempts).toBe(0);
		expect(job.failureReason).toBeNull();
		expect(job.completedAt).toBeTruthy();
		expect(job.evidence).toHaveLength(3);
		expect(job.evidence.every((c: any) => c.pass)).toBe(true);
		expect(job.evidence.map((c: any) => c.check)).toEqual([
			"incident exists on independent re-read",
			"status is ASSIGNED",
			"assignment persisted for this job",
		]);

		expect(incidents[0].status).toBe("ASSIGNED");
		expect(incidents[0].worker_assignments[0]).toMatchObject({
			worker_id: TRIAGE_WORKER,
			task: `triage job ${job.id}`,
		});
		expect(body.queue.stats.COMPLETED).toBe(1);
		expect(body.queue.stats.total).toBe(1);

		// independent read-back through the queue action
		const readback = response();
		await handler({ method: "GET", query: { action: "queue", type: TRIAGE_JOB_TYPE } }, readback);
		const rbody = readback.body as any;
		expect(rbody.count).toBe(1);
		expect(rbody.jobs[0].state).toBe("COMPLETED");

		// replay dedupes on the idempotency key; nothing left to claim
		const replay = await runCycle();
		expect(replay.triage.produced).toEqual({ enqueued: 0, duplicates: 1, errors: [] });
		expect(replay.triage.consumed.claimed).toBe(0);
		expect(storedJobs()).toHaveLength(1);
	});

	it("routes a write that did not persist to RETRYING via failed verification", async () => {
		const inc = seedIncident();
		triageMock(detectIncidents).mockImplementation(async () => [inc]);
		// returns a success-looking object but never mutates the store
		triageMock(assignIncident).mockImplementation(async (id: string) => ({
			id,
			status: "ASSIGNED",
			worker_assignments: [],
		}));

		const body = await runCycle();

		expect(body.triage.consumed).toEqual({
			claimed: 1,
			completed: 0,
			failed: 1,
			cancelled: 0,
			errors: [],
		});
		const job = storedJobs()[0];
		expect(job.state).toBe("RETRYING");
		expect(job.attempts).toBe(1);
		expect(job.worker).toBeNull();
		expect(job.failureReason).toMatch(/^independent verification mismatch: /);
		expect(job.failureReason).toContain("status is ASSIGNED");
		expect(job.failureReason).toContain("assignment persisted for this job");
		expect(incidents[0].status).toBe("DETECTED");
	});

	it("cancels instead of triaging an already-resolved incident", async () => {
		const inc = seedIncident({ status: "RESOLVED" });
		triageMock(detectIncidents).mockImplementation(async () => [inc]);

		const body = await runCycle();

		expect(body.triage.consumed).toEqual({
			claimed: 1,
			completed: 0,
			failed: 0,
			cancelled: 1,
			errors: [],
		});
		const job = storedJobs()[0];
		expect(job.state).toBe("CANCELLED");
		expect(job.failureReason).toBe("incident already RESOLVED");
		expect(triageMock(assignIncident)).not.toHaveBeenCalled();
	});

	it("cancels when the incident record no longer exists", async () => {
		await enqueueJob({
			type: TRIAGE_JOB_TYPE,
			idempotencyKey: "incident.triage:INC-404",
			input: { incidentId: "INC-404" },
		});

		const body = await runCycle();

		expect(body.triage.produced).toEqual({ enqueued: 0, duplicates: 0, errors: [] });
		expect(body.triage.consumed).toEqual({
			claimed: 1,
			completed: 0,
			failed: 0,
			cancelled: 1,
			errors: [],
		});
		const job = storedJobs()[0];
		expect(job.state).toBe("CANCELLED");
		expect(job.failureReason).toBe("incident INC-404 not found");
	});

	it("captures an assign exception as a retried failure and surfaces it in errors", async () => {
		const inc = seedIncident();
		triageMock(detectIncidents).mockImplementation(async () => [inc]);
		triageMock(assignIncident).mockImplementation(async () => {
			throw new Error("kv write refused");
		});

		const body = await runCycle();

		expect(body.triage.consumed.claimed).toBe(1);
		expect(body.triage.consumed.completed).toBe(0);
		expect(body.triage.consumed.failed).toBe(1);
		expect(body.triage.consumed.errors).toHaveLength(1);
		expect(body.triage.consumed.errors[0]).toContain("kv write refused");
		expect(body.errors.some((e: string) => e.startsWith("triage consume: "))).toBe(true);

		const job = storedJobs()[0];
		expect(job.state).toBe("RETRYING");
		expect(job.attempts).toBe(1);
		expect(job.failureReason).toBe("worker exception: kv write refused");
	});

	it("surfaces a producer-side skip for an incident without an id", async () => {
		triageMock(detectIncidents).mockImplementation(async () => [{ severity: "high" }]);

		const body = await runCycle();

		expect(body.triage.produced).toEqual({
			enqueued: 0,
			duplicates: 0,
			errors: ["incident without id — not enqueued"],
		});
		expect(
			body.errors.some((e: string) => e.startsWith("triage produce: incident without id")),
		).toBe(true);
		expect(body.triage.consumed.claimed).toBe(0);
		expect(storedJobs()).toHaveLength(0);
	});

	it("keeps a queue write failure visible: no enqueue, error surfaced, stats empty", async () => {
		state.queueWriteFail = true;
		const inc = seedIncident();
		triageMock(detectIncidents).mockImplementation(async () => [inc]);

		const body = await runCycle();

		expect(body.triage.produced.enqueued).toBe(0);
		expect(body.triage.produced.errors).toHaveLength(1);
		expect(body.triage.produced.errors[0]).toContain("INC-1001");
		expect(body.triage.produced.errors[0]).toContain("work_queue write failed");
		expect(body.errors.some((e: string) => e.startsWith("triage produce: "))).toBe(true);
		expect(body.queue.stats.total).toBe(0);
		expect(storedJobs()).toHaveLength(0);
	});

	it("maps incident severity onto queue priority", () => {
		expect(triagePriority("critical")).toBe("critical");
		expect(triagePriority("high")).toBe("high");
		expect(triagePriority("info")).toBe("low");
		expect(triagePriority("unknown")).toBe("medium");
		expect(triagePriority(undefined)).toBe("medium");
	});

	it("retries when the domain API reports an assignment error", async () => {
		const inc = seedIncident();
		triageMock(detectIncidents).mockImplementation(async () => [inc]);
		triageMock(assignIncident).mockImplementation(async () => ({ error: "Incident not found" }));

		const body = await runCycle();

		expect(body.triage.consumed).toEqual({
			claimed: 1,
			completed: 0,
			failed: 1,
			cancelled: 0,
			errors: [],
		});
		const job = storedJobs()[0];
		expect(job.state).toBe("RETRYING");
		expect(job.attempts).toBe(1);
		expect(job.failureReason).toBe("assignIncident: Incident not found");
	});
});
