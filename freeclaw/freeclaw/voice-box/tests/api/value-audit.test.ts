// ═══════════════════════════════════════════════════════════════
// SPEC §45 TEST 10 — Worker value audit (producer + consumer + gate)
//
// Real queue, real verdict registry, real activity evidence:
//   - producer: declared + queue-discovered workers, one job per
//     worker per UTC day, rolling 24h window in input, discovery
//     failure surfaced without dropping declared workers.
//   - consumer: observe → decide → act → independent re-read → evidence.
//   - false-success gate: a flag write that reports success but does
//     not persist MUST fail verification (RETRYING, never COMPLETED).
//
// Harness: tabs-only indent; vi.hoisted `from`; fake clock fixed at
// 2026-09-23T10:00:00.000Z; settings-KV + activity_logs double with a
// named-key drop gate for `worker_value_flags`.
// ═══════════════════════════════════════════════════════════════

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));
// Route authorization is covered in incident-cron-authz.test.ts; this suite
// covers the value-audit producer/consumer behaviour.
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isCronAuthorized: vi.fn(async () => true),
	CRON_UNAUTHORIZED_BODY: { error: "Unauthorized" },
}));
vi.mock("../../api/_incidents.js", () => ({
	detectIncidents: vi.fn(async () => []),
	loadIncidents: vi.fn(async () => []),
	saveIncidents: vi.fn(async () => []),
	addTimeline: vi.fn(async () => {}),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const settings: Record<string, any> = {};
const activityLog: any[] = [];
const state = {
	flagDrop: false, // settings writes to a named key report success but do not persist
	settingsReadFailOnce: false,
};

const FIXED_NOW = "2026-09-23T10:00:00.000Z";

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

// ── settings-KV + activity_logs double ──────────────────────────
function tableChain(table: string) {
	if (table === "activity_logs") {
		const rows: any[] = [];
		let op = "select";
		let actionFilter: string | undefined;
		let payload: any = null;
		const c: any = {
			select: () => {
				op = "select";
				return c;
			},
			insert: (p: any) => {
				op = "insert";
				payload = p;
				return c;
			},
			eq: (_col: string, v: string) => {
				if (op === "select") actionFilter = v;
				return c;
			},
			then: (resolve: any, reject: any) => {
				if (op === "insert") {
					activityLog.push({ ...payload });
					return Promise.resolve({ data: null, error: null }).then(resolve, reject);
				}
				const data = actionFilter
					? activityLog.filter((r) => r.action === actionFilter)
					: activityLog.slice();
				rows.push(...data);
				return Promise.resolve({ data, error: null }).then(resolve, reject);
			},
		};
		return c;
	}

	// settings KV
	let op = "select";
	let key: string | undefined;
	let value: any;
	const c: any = {
		select: () => {
			op = "select";
			return c;
		},
		insert: (p: any) => {
			op = "insert";
			if (p && typeof p === "object") {
				key = p.key;
				value = p.value;
			}
			return c;
		},
		upsert: (p: any) => {
			op = "upsert";
			if (p && typeof p === "object") {
				key = p.key;
				value = p.value;
			}
			return c;
		},
		update: (p: any) => {
			op = "update";
			if (p && typeof p === "object") value = p.value;
			return c;
		},
		eq: (_col: string, v: string) => {
			key = v;
			return c;
		},
		like: (_col: string, prefix: string) => {
			key = prefix;
			return c;
		},
		maybeSingle: () => {
			if (state.settingsReadFailOnce) {
				state.settingsReadFailOnce = false;
				return Promise.reject(new Error("kv read refused"));
			}
			return Promise.resolve({
				data: key !== undefined && key in settings ? { key, value: settings[key] } : null,
				error: null,
			});
		},
		single: () => {
			const exists = key !== undefined && key in settings;
			return Promise.resolve(
				exists
					? { data: { key, value: settings[key] }, error: null }
					: { data: null, error: { message: "row not found" } },
			);
		},
		then: (resolve: any, reject: any) => {
			// terminal await on insert/update/upsert (optionally .eq-scoped)
			if (op === "insert" || op === "upsert" || op === "update") {
				if (state.flagDrop && key === "worker_value_flags") {
					// drop-gate: reports success, persists nothing
					return Promise.resolve({ data: null, error: null }).then(resolve, reject);
				}
				if (key !== undefined) settings[key] = value;
				return Promise.resolve({ data: null, error: null }).then(resolve, reject);
			}
			return Promise.resolve({
				data: key !== undefined && key in settings ? { key, value: settings[key] } : null,
				error: null,
			}).then(resolve, reject);
		},
	};
	return c;
}

from.mockImplementation((table: string) => tableChain(table));

type Handler = (req: any, res: any) => Promise<unknown>;
let handler: Handler;
let enqueueJob: any;
let enqueueClaim: any;
let startJob: any;
let submitVerification: any;
let resolveVerification: any;
let enqueueValueAudits: any;
let runValueAuditWorker: any;
let readAllVerdicts: any;
let VALUE_AUDIT_JOB_TYPE: string;
let VALUE_AUDIT_WORKER: string;
let TRIAGE_WORKER: string;

async function getFlags(): Promise<Record<string, any>> {
	return readAllVerdicts();
}

function auditJobs() {
	return storedJobs().filter((j) => j.type === VALUE_AUDIT_JOB_TYPE);
}

async function completeJob(jobId: string, worker: string) {
	await submitVerification(jobId, { worker, evidence: [{ check: "seed", pass: true }] });
	await resolveVerification(jobId, { worker, passed: true });
}

beforeEach(async () => {
	vi.clearAllMocks();
	for (const k of Object.keys(settings)) delete settings[k];
	activityLog.length = 0;
	state.flagDrop = false;
	state.settingsReadFailOnce = false;
	vi.useFakeTimers();
	vi.setSystemTime(new Date(FIXED_NOW));
	from.mockImplementation((table: string) => tableChain(table));
	handler = ((await import("../../api/_incident-cron.js")) as any).default;
	({ enqueueJob, enqueueClaim, startJob, submitVerification, resolveVerification } = await import(
		"../../api/_work-queue.js"
	));
	({
		enqueueValueAudits,
		runValueAuditWorker,
		readAllVerdicts,
		VALUE_AUDIT_JOB_TYPE,
		VALUE_AUDIT_WORKER,
	} = await import("../../api/_value-audit.js"));
	({ TRIAGE_WORKER } = await import("../../api/_incident-triage.js"));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("producer — enqueueValueAudits", () => {
	it("audits declared + queue-discovered workers once per UTC day and dedupes replay", async () => {
		// history: one claimed job by a worker only the queue knows about
		await enqueueJob({ type: "other.task", idempotencyKey: "hist-1" });
		await enqueueClaim("w:legacy");

		const s1 = await enqueueValueAudits({ declaredWorkers: ["w:a", "w:b"] });
		expect(s1).toEqual({ enqueued: 3, duplicates: 0, errors: [] });

		const jobs = auditJobs();
		expect(jobs).toHaveLength(3);
		for (const j of jobs) {
			expect(j.type).toBe(VALUE_AUDIT_JOB_TYPE);
			expect(j.priority).toBe("low");
			expect(j.input.windowStart).toBe("2026-09-22T10:00:00.000Z");
			expect(j.input.windowEnd).toBe(FIXED_NOW);
			expect(typeof j.input.workerId).toBe("string");
			expect(j.idempotencyKey).toContain(":2026-09-23");
		}
		expect(jobs.map((j) => j.input.workerId).sort()).toEqual(["w:a", "w:b", "w:legacy"]);

		const s2 = await enqueueValueAudits({ declaredWorkers: ["w:a", "w:b"] });
		expect(s2).toEqual({ enqueued: 0, duplicates: 3, errors: [] });
		expect(auditJobs()).toHaveLength(3);
	});

	it("surfaces a discovery read failure without dropping the declared workers", async () => {
		state.settingsReadFailOnce = true;
		const s = await enqueueValueAudits({ declaredWorkers: ["w:a", "w:b"] });
		expect(s.enqueued).toBe(2);
		expect(s.errors).toHaveLength(1);
		expect(s.errors[0]).toContain("worker discovery failed");
		expect(s.errors[0]).toContain("kv read refused");
	});
});

describe("TEST 10 — GET /api/incident-cron?action=value-audit", () => {
	it("flags workers doing no meaningful work, verifies ones producing evidenced work", async () => {
		// control worker: one completed, evidenced job inside the window
		await enqueueJob({ type: "ok.task", idempotencyKey: "g-1" });
		const goodClaim = await enqueueClaim("w:good", { type: "ok.task" });
		await startJob(goodClaim.job.id, "w:good");
		await completeJob(goodClaim.job.id, "w:good");

		// ghost worker: claimed and running, nothing ever completes
		await enqueueJob({ type: "ghost.task", idempotencyKey: "gh-1" });
		const ghostClaim = await enqueueClaim("w:ghost", { type: "ghost.task" });
		await startJob(ghostClaim.job.id, "w:ghost");

		const res = response();
		await handler({ method: "GET", query: { action: "value-audit" } }, res);
		expect(res.statusCode).toBe(200);
		const body = res.body as any;

		// producer: 2 declared + 2 discovered, no errors
		expect(body.valueAudit.produced).toEqual({ enqueued: 4, duplicates: 0, errors: [] });
		expect(body.errors).toEqual([]);

		// consumer: every audit job carried through the full chain
		expect(body.valueAudit.consumed).toEqual({
			claimed: 4,
			completed: 4,
			flagged: 2, // w:ghost (open, no output) + TRIAGE_WORKER (idle)
			verified: 2, // w:good + the auditor's own completed audit job
			failed: 0,
			errors: [],
		});

		const jobs = auditJobs();
		expect(jobs).toHaveLength(4);
		expect(jobs.every((j) => j.state === "COMPLETED")).toBe(true);
		expect(jobs.every((j) => j.evidence.length > 0)).toBe(true);
		expect(jobs.every((j) => j.evidence.every((c: any) => c.pass === true))).toBe(true);
		expect(jobs.every((j) => j.worker === VALUE_AUDIT_WORKER)).toBe(true);

		// verdicts from the independent read-back in the response
		const flags = body.flags;
		expect(Object.keys(flags).sort()).toEqual(
			[TRIAGE_WORKER, VALUE_AUDIT_WORKER, "w:ghost", "w:good"].sort(),
		);
		expect(flags["w:good"]).toMatchObject({
			verdict: "verified",
			reason: null,
			completedWithEvidence: 1,
			heldOpen: 0,
			windowStart: "2026-09-22T10:00:00.000Z",
			windowEnd: FIXED_NOW,
		});
		expect(flags["w:ghost"].verdict).toBe("flagged");
		expect(flags["w:ghost"].reason).toContain("holds 1 open job(s)");
		expect(flags["w:ghost"]).toMatchObject({ heldOpen: 1, completedWithEvidence: 0 });
		expect(flags[TRIAGE_WORKER].verdict).toBe("flagged");
		expect(flags[TRIAGE_WORKER].reason).toContain("idle or never dispatched");
		expect(flags[VALUE_AUDIT_WORKER].verdict).toBe("verified");

		// verdict registry is this audit job's verdict (pairable by jobId)
		const goodAudit = jobs.find((j) => j.input.workerId === "w:good");
		const ghostAudit = jobs.find((j) => j.input.workerId === "w:ghost");
		expect(flags["w:good"].jobId).toBe(goodAudit.id);
		expect(flags["w:ghost"].jobId).toBe(ghostAudit.id);

		// activity evidence rows exist and carry the matching audit jobId
		const verifiedRow = activityLog.find(
			(r) => r.action === "worker_value_verified" && String(r.detail).includes(goodAudit.id),
		);
		const flaggedRow = activityLog.find(
			(r) => r.action === "worker_flagged_for_removal" && String(r.detail).includes(ghostAudit.id),
		);
		expect(verifiedRow).toBeTruthy();
		expect(flaggedRow).toBeTruthy();
		expect(verifiedRow.actor).toBe(VALUE_AUDIT_WORKER);
		expect(String(verifiedRow.detail)).toContain("w:good");

		// non-audit queue work is never touched by the auditor
		expect(storedJobs().find((j) => j.idempotencyKey === "gh-1").state).toBe("RUNNING");
		expect(storedJobs().find((j) => j.idempotencyKey === "g-1").state).toBe("COMPLETED");

		// same-day replay through the real surface: no new jobs, flags survive
		const res2 = response();
		await handler({ method: "GET", query: { action: "value-audit" } }, res2);
		const body2 = res2.body as any;
		expect(body2.valueAudit.produced).toEqual({ enqueued: 0, duplicates: 4, errors: [] });
		expect(body2.valueAudit.consumed).toEqual({
			claimed: 0,
			completed: 0,
			flagged: 0,
			verified: 0,
			failed: 0,
			errors: [],
		});
		expect(body2.flags["w:ghost"].jobId).toBe(ghostAudit.id);
		expect(auditJobs()).toHaveLength(4);

		// the durable flags are readable through a fresh independent call
		const fresh = await getFlags();
		expect(fresh["w:ghost"].verdict).toBe("flagged");
		expect(fresh["w:good"].verdict).toBe("verified");
	});

	it("supersedes a stale flag when the worker later produces work, keeps idle workers flagged", async () => {
		// day 1: ghost is running, produces nothing → flagged
		await enqueueJob({ type: "ghost.task", idempotencyKey: "gh-1" });
		const c1 = await enqueueClaim("w:ghost", { type: "ghost.task" });
		await startJob(c1.job.id, "w:ghost");

		const r1 = response();
		await handler({ method: "GET", query: { action: "value-audit" } }, r1);
		const b1 = r1.body as any;
		expect(b1.valueAudit.produced.enqueued).toBe(3); // 2 declared + w:ghost
		const day1GhostAudit = auditJobs().find((j) => j.input.workerId === "w:ghost");
		expect(b1.flags["w:ghost"]).toMatchObject({ verdict: "flagged", jobId: day1GhostAudit.id });
		expect(b1.flags[TRIAGE_WORKER].verdict).toBe("flagged");

		// day 2: the ghost actually finishes its job inside the new window
		vi.setSystemTime(new Date("2026-09-24T11:00:00.000Z"));
		await completeJob(c1.job.id, "w:ghost");

		const r2 = response();
		await handler({ method: "GET", query: { action: "value-audit" } }, r2);
		const b2 = r2.body as any;
		expect(b2.valueAudit.produced).toEqual({ enqueued: 3, duplicates: 0, errors: [] });
		expect(b2.errors).toEqual([]);

		// stale removal demand cleared — verdict superseded, not appended
		expect(b2.flags["w:ghost"]).toMatchObject({ verdict: "verified", reason: null });
		expect(b2.flags["w:ghost"].jobId).not.toBe(day1GhostAudit.id);
		expect(b2.flags["w:ghost"].windowStart).toBe("2026-09-23T11:00:00.000Z");
		expect(b2.flags["w:ghost"].completedWithEvidence).toBe(1);

		// the worker that still produces nothing stays flagged
		expect(b2.flags[TRIAGE_WORKER].verdict).toBe("flagged");
		expect(b2.flags[TRIAGE_WORKER].reason).toContain("idle or never dispatched");

		const fresh = await getFlags();
		expect(fresh["w:ghost"].verdict).toBe("verified");
	});

	it("never marks an audit COMPLETED when the flag write does not actually persist", async () => {
		state.flagDrop = true;

		const res = response();
		await handler({ method: "GET", query: { action: "value-audit" } }, res);
		expect(res.statusCode).toBe(200);
		const body = res.body as any;

		// both audits attempted the flag path (no worker has work)
		expect(body.valueAudit.produced).toEqual({ enqueued: 2, duplicates: 0, errors: [] });
		expect(body.valueAudit.consumed).toEqual({
			claimed: 2,
			completed: 0,
			flagged: 0,
			verified: 0,
			failed: 2,
			errors: [],
		});

		// nothing was persisted → read-back is empty, no fake flag exists
		expect(body.flags).toEqual({});
		expect(await getFlags()).toEqual({});

		// independent verification caught it: RETRYING with the failing check named
		const jobs = auditJobs();
		expect(jobs).toHaveLength(2);
		for (const j of jobs) {
			expect(j.state).toBe("RETRYING");
			expect(j.attempts).toBe(1);
			expect(j.failureReason).toMatch(/independent verification mismatch/);
			expect(j.failureReason).toContain("verdict persisted on independent re-read");
		}

		// attempt-trail activity rows exist (documented: registry entry with
		// the matching jobId is authoritative — there is none)
		const attemptRows = activityLog.filter((r) => r.action === "worker_flagged_for_removal");
		expect(attemptRows).toHaveLength(2);
	});
});

describe("consumer — input contract", () => {
	it("fails an audit job whose input has no worker target instead of inventing one", async () => {
		await enqueueJob({ type: VALUE_AUDIT_JOB_TYPE, idempotencyKey: "bad-1", input: {} });

		const summary = await runValueAuditWorker();
		expect(summary).toEqual({
			claimed: 1,
			completed: 0,
			flagged: 0,
			verified: 0,
			failed: 1,
			errors: [],
		});

		const job = storedJobs().find((j) => j.idempotencyKey === "bad-1");
		expect(job.state).toBe("RETRYING");
		expect(job.attempts).toBe(1);
		expect(job.failureReason).toContain("missing workerId");
		expect(await getFlags()).toEqual({});
	});
});
