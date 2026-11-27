// ═══════════════════════════════════════════════════════════════════
// Worker backoff — consecutive failures defer scheduled runs (spec §43)
// ═══════════════════════════════════════════════════════════════════
// Locks: after a failure a cron run defers (60s, then 5min) instead of
// burning a full run per tick; explicit manual/test runs always execute;
// success clears the streak; pause still supersedes backoff at 3 strikes.
// Uses synthetic worker ids + fake timers so no production state moves.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

function tableChain(payload: unknown = { data: [], error: null, count: 0 }) {
	const q = {
		_payload: payload,
		then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
			return Promise.resolve((q as { _payload: unknown })._payload).then(res, rej);
		},
	};
	return new Proxy(q, {
		get(t, p) {
			if (p === "then") return (t as { then: unknown }).then;
			if (p === "maybeSingle" || p === "single")
				return async () => ({ data: null, error: null });
			if (p === "upsert" || p === "insert" || p === "update" || p === "delete")
				return async () => ({ data: null, error: null });
			if (typeof p === "string") return () => tableChain((t as { _payload: unknown })._payload);
			return undefined;
		},
	});
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) =>
			table === "settings"
				? {
						select: () => ({
							eq: (_c: string, key: string) => ({
								maybeSingle: async () => ({
									data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
									error: null,
								}),
							}),
						}),
						upsert: async (row: { key: string; value: unknown }) => {
							kv.store.set(row.key, row.value);
							return { error: null };
						},
					}
				: tableChain(),
	},
}));

import {
	backoffMsFor,
	getBackoffMs,
	getPausedWorkers,
	getSupervisorSummary,
	preExecutionCheck,
	recordFailure,
	recordSuccess,
	reloadSupervisorState,
	resetSupervisorState,
	unpauseWorker,
} from "../../api/_worker-supervisor.js";
import { registerWorker, runWorker } from "../../api/_workforce-core.js";

function failingWorker(id: string) {
	registerWorker({
		worker_id: id,
		name: `Backoff test ${id}`,
		responsibility: "synthetic backoff probe",
		execution_class: "A",
		trigger_types: ["test"],
		budget: { max_runs_per_hour: 100, max_affected_records: 100 },
		tools: [],
		observe: async () => ({ summary: "work" }),
		analyze: async () => ({ decision: "act", reason: "test" }),
		execute: async () => {
			throw new Error("boom");
		},
		verify: async () => ({ ok: false, proof: "n/a" }),
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
	kv.store.clear();
	for (const w of getPausedWorkers()) unpauseWorker(w);
});

describe("backoff schedule", () => {
	it("is 0 with no failures, 10min after one, 30min after two or more", () => {
		expect(backoffMsFor(0)).toBe(0);
		expect(backoffMsFor(1)).toBe(10 * 60 * 1000);
		expect(backoffMsFor(2)).toBe(30 * 60 * 1000);
		expect(backoffMsFor(9)).toBe(30 * 60 * 1000);
	});
});

describe("cron deferral vs explicit runs", () => {
	it("defers the next cron run after a failure but lets manual runs through", async () => {
		const id = "backoff-cron-worker";
		failingWorker(id);
		expect((await runWorker(id, "cron")).outcome).toBe("execution_failed");
		const deferred = await runWorker(id, "cron");
		expect(deferred.outcome).toBe("deferred");
		expect(deferred.decision).toMatch(/Backoff/);
		// Explicit intent bypasses the deferral (pause/loop gates still apply).
		expect((await runWorker(id, "test")).outcome).toBe("execution_failed");
	});

	it("escalates the window on the second consecutive failure, then expires", async () => {
		const id = "backoff-escalate-worker";
		failingWorker(id);
		await runWorker(id, "cron"); // failure 1 → 10min backoff
		await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
		await runWorker(id, "cron"); // failure 2 → 30min backoff
		const gate = preExecutionCheck(id, { trigger: "cron" });
		expect(gate.allowed).toBe(false);
		expect(gate.deferred).toBe(true);
		expect(gate.retry_after_ms).toBeGreaterThan(29 * 60 * 1000);
		await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
		expect(preExecutionCheck(id, { trigger: "cron" }).allowed).toBe(true);
	});

	it("a success clears the backoff streak", async () => {
		const id = "backoff-clear-worker";
		failingWorker(id);
		recordFailure(id);
		expect(getBackoffMs(id)).toBeGreaterThan(0);
		recordSuccess(id);
		expect(getBackoffMs(id)).toBe(0);
		expect(preExecutionCheck(id, { trigger: "cron" }).allowed).toBe(true);
	});

	it("pause still fires on rapid failures and unpause clears the backoff", async () => {
		const id = "backoff-pause-worker";
		failingWorker(id);
		await runWorker(id, "cron"); // failure 1 → backoff armed
		expect(getBackoffMs(id)).toBeGreaterThan(0);
		// Rapid explicit runs bypass the deferral and count toward pause.
		expect((await runWorker(id, "test")).outcome).toBe("execution_failed");
		expect((await runWorker(id, "test")).outcome).toBe("execution_failed");
		expect((await runWorker(id, "cron")).outcome).toBe("paused");
		expect(getPausedWorkers()).toContain(id);
		unpauseWorker(id);
		expect(getBackoffMs(id)).toBe(0);
		expect(preExecutionCheck(id, { trigger: "cron" }).allowed).toBe(true);
	});

	it("surfaces backed-off workers in the supervisor summary", async () => {
		const id = "backoff-summary-worker";
		failingWorker(id);
		await runWorker(id, "cron");
		expect(getSupervisorSummary().backed_off_workers).toContain(id);
	});
});

describe("durable retry state (restart recovery)", () => {
	// saveState is fire-and-forget: drain the short promise chain before
	// simulating the restart so the KV write has landed.
	async function flushSaves() {
		for (let i = 0; i < 10; i++) await Promise.resolve();
	}

	it("a backoff streak survives a restart — cron still defers", async () => {
		const id = "backoff-restart-worker";
		recordFailure(id);
		recordFailure(id);
		expect(getBackoffMs(id)).toBeGreaterThan(0);
		await flushSaves();
		// Simulate a restart: drop memory WITHOUT clearing durable state.
		resetSupervisorState({ persist: false });
		expect(getBackoffMs(id)).toBe(0);
		await reloadSupervisorState();
		expect(getBackoffMs(id)).toBeGreaterThan(0);
		const gate = preExecutionCheck(id, { trigger: "cron" });
		expect(gate.allowed).toBe(false);
		expect(gate.deferred).toBe(true);
		resetSupervisorState();
	});

	it("a recorded success clears the durable streak", async () => {
		const id = "backoff-restart-clear-worker";
		recordFailure(id);
		await flushSaves();
		resetSupervisorState({ persist: false });
		await reloadSupervisorState();
		expect(getBackoffMs(id)).toBeGreaterThan(0);
		recordSuccess(id);
		await flushSaves();
		resetSupervisorState({ persist: false });
		await reloadSupervisorState();
		expect(getBackoffMs(id)).toBe(0);
		expect(preExecutionCheck(id, { trigger: "cron" }).allowed).toBe(true);
		resetSupervisorState();
	});

	it("garbage in the durable row never crashes hydration", async () => {
		kv.store.set("workforce_supervisor", {
			paused_workers: [],
			failure_counts: { junk: "not-an-entry" },
			backoff_streaks: {
				bad: { consecutive: "many", last_failure: "soon" },
				zero: { consecutive: 0, last_failure: Date.now() },
			},
		});
		await reloadSupervisorState();
		expect(getBackoffMs("bad")).toBe(0);
		expect(getBackoffMs("zero")).toBe(0);
		resetSupervisorState();
	});
});
