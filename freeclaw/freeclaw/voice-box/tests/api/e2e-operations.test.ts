// ═══════════════════════════════════════════════════════════════════
// SPEC §45 end-to-end operation tests — owned modules, full flows
// ═══════════════════════════════════════════════════════════════════
// §45 asks for tests of the COMPLETE system, not units. This file
// chains real multi-step scenarios end to end through the committed
// modules:
//   TEST 5 → api/_notification-delivery.js: failure → dead-letter
//            fallback (with evidence) → retry → delivery counted ONLY
//            after independent read-back; lying writes burn attempts
//            down to a dead letter, never a fake "delivered".
//   TEST 6 → api/_work-queue.js: worker dies mid-run → watchdog sweep
//            (recoverStaleJobs) detects the stale claim → attempt
//            burned → backoff release → a second worker finishes the
//            job to COMPLETED through the verification gate.
//   TEST 9 → api/_work-queue.js: worker claims success but state did
//            not change → independent verification rejects → RETRYING
//            (never COMPLETED) → recovery begins → real completion.
//            Plus the ownership / mandatory-evidence / failureReason
//            gates that make a false success impossible.
// Harness mirrors tests/api/work-queue.test.ts: hoisted db double,
// settings-KV + activity_logs tables, fixed fake clock.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// hoisted: static module imports pull in _db-client at module-eval
// time, so `from` must exist before them
const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

vi.mock("../../api/_auth.js", () => ({ cors: vi.fn() }));

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── in-memory settings KV + activity evidence log ──────────────
const settings: Record<string, any> = {};
const activityLog: Array<Record<string, unknown>> = [];
const state = {
	// false-success injection: notification-store upserts REPORT ok but
	// nothing persists — the independent read-back must catch it
	notificationDrop: false,
};

/** Chainable supabase double for the two tables these flows touch. */
function chainFor(table: string) {
	const chain: any = {
		op: "select",
		filters: {} as Record<string, unknown>,
		likePrefix: undefined as string | undefined,
		patch: undefined as Record<string, unknown> | undefined,
		newRow: undefined as Record<string, unknown> | undefined,
		select() {
			return this;
		},
		eq(field: string, value: unknown) {
			this.filters[field] = value;
			return this;
		},
		in() {
			return this;
		},
		gte() {
			return this;
		},
		order() {
			return this;
		},
		limit() {
			return this;
		},
		like(_field: string, pattern: string) {
			this.likePrefix = String(pattern).replace(/%/g, "");
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
					if (key !== undefined && this.patch && "value" in this.patch) {
						settings[key] = this.patch.value;
					}
					fn({ data: null, error: null });
					return;
				}
				if (this.op === "insert" || this.op === "upsert") {
					const row = this.newRow as Record<string, any>;
					const rowKey = String(row.key);
					const drop =
						state.notificationDrop && rowKey.startsWith("notifications:");
					if (!drop) settings[rowKey] = row.value;
					fn({ data: row, error: null });
					return;
				}
				if (this.op === "maybeSingle" || this.op === "single") {
					fn({
						data:
							key !== undefined && key in settings ? { value: settings[key] } : null,
						error: null,
					});
					return;
				}
				if (this.likePrefix !== undefined) {
					const prefix = this.likePrefix as string;
					const rows = Object.entries(settings)
						.filter(([k]) => k.startsWith(prefix))
						.map(([k, v]) => ({ key: k, value: v }));
					fn({ data: rows, error: null });
					return;
				}
				fn({ data: [], error: null });
				return;
			}
			if (table === "activity_logs") {
				if (this.op === "insert") {
					activityLog.push(this.newRow as Record<string, unknown>);
					fn({ data: this.newRow, error: null });
					return;
				}
				fn({ data: activityLog, error: null });
				return;
			}
			fn({ data: [], count: 0, error: null });
		},
	};
	return chain;
}

// ─── module surfaces (dynamic import per test file lifetime) ────
let enqueueJob: (input: Record<string, unknown>) => Promise<any>;
let enqueueClaim: (worker: string, opts?: Record<string, unknown>) => Promise<any>;
let startJob: (id: string, worker: string) => Promise<any>;
let submitVerification: (id: string, opts: Record<string, unknown>) => Promise<any>;
let resolveVerification: (id: string, opts: Record<string, unknown>) => Promise<any>;
let releaseRetried: () => Promise<number>;
let recoverStaleJobs: () => Promise<number>;
let getJob: (id: string) => Promise<any>;
let DEFAULT_TIMEOUT_MS: number;

let recordPendingDelivery: (
	anonId: string,
	entry: Record<string, unknown>,
	reason?: string,
) => Promise<boolean>;
let retryPendingDeliveries: (opts?: { limit?: number }) => Promise<any>;
let verifyNotificationStored: (anonId: string, notificationId: string) => Promise<boolean>;
let notificationUserKey: (anonId: string) => string;
let MAX_DELIVERY_ATTEMPTS: number;
let LEDGER_KEY: string;

/** Move the fake clock strictly past an ISO timestamp. */
function advanceTo(iso: string | null | undefined) {
	vi.setSystemTime(new Date(Date.parse(String(iso)) + 100));
}

function entry(id: string) {
	return { id, title: `notification ${id}`, read: false };
}

beforeEach(async () => {
	vi.clearAllMocks();
	for (const k of Object.keys(settings)) delete settings[k];
	activityLog.length = 0;
	state.notificationDrop = false;
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-23T10:00:00.000Z"));
	from.mockImplementation((table: string) => chainFor(table));

	({
		enqueueJob,
		enqueueClaim,
		startJob,
		submitVerification,
		resolveVerification,
		releaseRetried,
		recoverStaleJobs,
		getJob,
		DEFAULT_TIMEOUT_MS,
	} = await import("../../api/_work-queue.js"));
	({
		recordPendingDelivery,
		retryPendingDeliveries,
		verifyNotificationStored,
		notificationUserKey,
		MAX_DELIVERY_ATTEMPTS,
		LEDGER_KEY,
	} = await import("../../api/_notification-delivery.js"));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("§45 TEST 5 — notification fails → retry → fallback → delivery verified", () => {
	it("records the exhausted immediate attempts in the fallback ledger with evidence", async () => {
		const ok = await recordPendingDelivery("AnonUser123", entry("ntf-1"), "notifyUser exhausted retries");
		expect(ok).toBe(true);

		const ledger = settings[LEDGER_KEY] as { entries: any[] };
		expect(ledger.entries).toHaveLength(1);
		expect(ledger.entries[0]).toMatchObject({
			id: "dl_ntf-1",
			anon_id: "anonuser123",
			status: "pending",
			attempts: 0,
			reason: "notifyUser exhausted retries",
		});
		expect(ledger.entries[0].first_failed_at).toBeTruthy();

		// idempotent on the notification id — a double failure cannot duplicate
		expect(await recordPendingDelivery("AnonUser123", entry("ntf-1"))).toBe(true);
		expect((settings[LEDGER_KEY] as { entries: any[] }).entries).toHaveLength(1);

		// evidence: the dead-letter is recorded in activity_logs
		expect(
			activityLog.some(
				(r) => r.action === "notification_dead_lettered" && String(r.detail).includes("ntf-1"),
			),
		).toBe(true);

		// the delivery is honestly absent until a verified write puts it there
		expect(await verifyNotificationStored("AnonUser123", "ntf-1")).toBe(false);
	});

	it("retries the real write and marks delivered only after independent read-back", async () => {
		await recordPendingDelivery("AnonUser123", entry("ntf-2"));

		const report = await retryPendingDeliveries();
		expect(report.ledger_ok).toBe(true);
		expect(report).toMatchObject({
			retried: 1,
			delivered: 1,
			failed: 0,
			dead: 0,
			pending_after: 0,
		});
		expect(report.delivered_ids).toEqual(["ntf-2"]);

		// independent verification: the id is in the user's real store now
		const store = settings[notificationUserKey("AnonUser123")] as { notifications: any[] };
		expect(store.notifications.some((n) => n && n.id === "ntf-2")).toBe(true);
		expect(await verifyNotificationStored("AnonUser123", "ntf-2")).toBe(true);

		// proven-delivered entries are pruned from the ledger + evidence row
		expect((settings[LEDGER_KEY] as { entries: any[] }).entries).toHaveLength(0);
		expect(
			activityLog.some(
				(r) =>
					r.action === "notification_delivery_verified" && String(r.detail).includes("ntf-2"),
			),
		).toBe(true);

		// a second pass finds nothing to do — no duplicate deliveries
		const again = await retryPendingDeliveries();
		expect(again).toMatchObject({ retried: 0, delivered: 0, dead: 0 });
	});

	it("never claims delivery when the write lies — attempts burn down to a dead letter", async () => {
		await recordPendingDelivery("anon-b", entry("ntf-3"));
		state.notificationDrop = true; // upsert reports success, nothing persists

		const r1 = await retryPendingDeliveries();
		expect(r1).toMatchObject({ retried: 1, delivered: 0, failed: 1, dead: 0, pending_after: 1 });
		expect(await verifyNotificationStored("anon-b", "ntf-3")).toBe(false);

		const r2 = await retryPendingDeliveries();
		expect(r2).toMatchObject({ retried: 1, delivered: 0, failed: 1 });

		// attempt 3 hits MAX_DELIVERY_ATTEMPTS → dead, never "delivered"
		const r3 = await retryPendingDeliveries();
		expect(r3).toMatchObject({ retried: 1, delivered: 0, failed: 0, dead: 1, pending_after: 0 });
		expect(r3.dead_ids).toEqual(["ntf-3"]);
		expect(r3.delivered_ids).toEqual([]);
		expect(await verifyNotificationStored("anon-b", "ntf-3")).toBe(false);

		// dead letters wait for a human — never silently retried again
		state.notificationDrop = false;
		const r4 = await retryPendingDeliveries();
		expect(r4).toMatchObject({ retried: 0, delivered: 0 });

		const kept = (settings[LEDGER_KEY] as { entries: any[] }).entries;
		expect(kept).toHaveLength(1);
		expect(kept[0]).toMatchObject({
			id: "dl_ntf-3",
			status: "dead",
			attempts: MAX_DELIVERY_ATTEMPTS,
		});
		expect(
			activityLog.some(
				(r) => r.action === "notification_delivery_dead" && String(r.detail).includes("ntf-3"),
			),
		).toBe(true);
	});
});

describe("§45 TEST 6 — queue worker dies → watchdog detects → worker recovered → job continues", () => {
	it("detects the stale claim, burns the attempt, and a second worker finishes the job", async () => {
		const { job } = await enqueueJob({
			type: "e2e.stale",
			idempotencyKey: "e2e-t6-1",
			priority: "critical",
		});
		expect(job.state).toBe("PENDING");

		const c1 = await enqueueClaim("worker-a", { type: "e2e.stale" });
		expect(c1.claimed).toBe(true);
		await startJob(job.id, "worker-a");

		// control: a healthy claim is never swept
		expect(await recoverStaleJobs()).toBe(0);

		// worker dies — no heartbeat, no completion; the clock passes timeout
		vi.setSystemTime(new Date(Date.now() + DEFAULT_TIMEOUT_MS + 1000));
		expect(await recoverStaleJobs()).toBe(1);

		const swept = await getJob(job.id);
		expect(swept.state).toBe("RETRYING");
		expect(swept.attempts).toBe(1);
		expect(swept.failureReason).toMatch(/stale claim recovered/);
		expect(swept.worker).toBeNull();
		expect(swept.completedAt).toBeNull();

		// backoff elapses → released to PENDING → the job continues
		advanceTo(swept.nextRetryAt);
		expect(await releaseRetried()).toBe(1);

		const c2 = await enqueueClaim("worker-b", { type: "e2e.stale" });
		expect(c2.claimed).toBe(true);
		await startJob(job.id, "worker-b");
		await submitVerification(job.id, {
			worker: "worker-b",
			evidence: [{ kind: "state_change", detail: "recovered run applied the change" }],
			result: "recovered",
		});
		const done = await resolveVerification(job.id, { passed: true, worker: "worker-b" });

		expect(done.state).toBe("COMPLETED");
		expect(done.attempts).toBe(1); // one burned attempt, one success
		expect(done.completedAt).toBeTruthy();
	});
});

describe("§45 TEST 9 — worker claims success but state did not change", () => {
	it("rejects the false success, marks the worker's attempt failed, and recovery completes", async () => {
		const { job } = await enqueueJob({
			type: "e2e.false-success",
			idempotencyKey: "e2e-t9-1",
		});
		await enqueueClaim("worker-x", { type: "e2e.false-success" });
		await startJob(job.id, "worker-x");

		// the worker claims success…
		const claimed = await submitVerification(job.id, {
			worker: "worker-x",
			evidence: [{ kind: "self_report", detail: "done, trust me" }],
			result: "success",
		});
		expect(claimed.state).toBe("VERIFYING");
		expect(claimed.completedAt).toBeNull(); // a claim is not a completion

		// …but independent verification does not buy it
		const failed = await resolveVerification(job.id, {
			passed: false,
			failureReason: "independent re-read: target state unchanged",
			worker: "worker-x",
		});
		expect(failed.state).toBe("RETRYING");
		expect(failed.attempts).toBe(1);
		expect(failed.worker).toBeNull();
		expect(failed.completedAt).toBeNull();
		expect(failed.failureReason).toMatch(/state unchanged/);

		// recovery begins: release + second attempt completes on real evidence
		advanceTo(failed.nextRetryAt);
		expect(await releaseRetried()).toBe(1);
		await enqueueClaim("worker-y", { type: "e2e.false-success" });
		await startJob(job.id, "worker-y");
		await submitVerification(job.id, {
			worker: "worker-y",
			evidence: [{ kind: "state_change", detail: "re-read shows the applied change" }],
			result: "success",
		});
		const done = await resolveVerification(job.id, { passed: true, worker: "worker-y" });

		expect(done.state).toBe("COMPLETED");
		expect(done.attempts).toBe(1);
		expect(done.completedAt).toBeTruthy();
	});

	it("enforces ownership, mandatory evidence, and a failure reason at the gate", async () => {
		const { job } = await enqueueJob({ type: "e2e.gates", idempotencyKey: "e2e-t9-gate" });
		await enqueueClaim("worker-x", { type: "e2e.gates" });
		await startJob(job.id, "worker-x");

		await expect(
			submitVerification(job.id, { worker: "worker-y", evidence: [{ kind: "x" }] }),
		).rejects.toThrow(/not claimed by/);

		await expect(
			submitVerification(job.id, { worker: "worker-x", evidence: [] }),
		).rejects.toThrow(/non-empty evidence/);

		const verifying = await submitVerification(job.id, {
			worker: "worker-x",
			evidence: [{ kind: "state_change", detail: "row re-read" }],
		});
		expect(verifying.state).toBe("VERIFYING");

		// a failed verification without a reason is refused — no silent pass
		await expect(resolveVerification(job.id, { passed: false })).rejects.toThrow(/failureReason/);
		const still = await getJob(job.id);
		expect(still.state).toBe("VERIFYING");
		expect(still.completedAt).toBeNull();
	});
});
