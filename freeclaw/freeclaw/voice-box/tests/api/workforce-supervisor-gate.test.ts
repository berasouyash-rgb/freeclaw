// ═══════════════════════════════════════════════════════════════════
// Supervisor gate — pause, quarantine, loop detection inside runWorker
// ═══════════════════════════════════════════════════════════════════
// Locks spec §43/§44: repeated failures pause a worker (no infinite retry
// loops), a runaway loop pauses it, successes clear the streak, and only an
// explicit unpause resumes it. Uses synthetic worker ids so no production
// worker state is touched.
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
	getFailureCounts,
	getPausedWorkers,
	unpauseWorker,
} from "../../api/_worker-supervisor.js";
import { registerWorker, runWorker } from "../../api/_workforce-core.js";

function failingWorker(id: string) {
	registerWorker({
		worker_id: id,
		name: `Gate test ${id}`,
		responsibility: "synthetic gate probe",
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

function skippingWorker(id: string) {
	registerWorker({
		worker_id: id,
		name: `Gate test ${id}`,
		responsibility: "synthetic gate probe",
		execution_class: "A",
		trigger_types: ["test"],
		budget: { max_runs_per_hour: 100, max_affected_records: 100 },
		tools: [],
		observe: async () => ({ empty: true }),
		analyze: async () => ({ decision: "skip", reason: "test" }),
		execute: async () => ({ action_type: "noop" }),
		verify: async () => ({ ok: true, proof: "noop" }),
	});
}

beforeEach(() => {
	kv.store.clear();
	for (const w of getPausedWorkers()) unpauseWorker(w);
});

describe("supervisor gate in runWorker", () => {
	it("pauses a worker after 3 failures — no infinite retry", async () => {
		const id = "gate-fail-worker";
		failingWorker(id);
		const outcomes = [];
		for (let i = 0; i < 4; i++) outcomes.push((await runWorker(id, "test")).outcome);
		expect(outcomes.slice(0, 3)).toEqual([
			"execution_failed",
			"execution_failed",
			"execution_failed",
		]);
		expect(outcomes[3]).toBe("paused");
		expect(getPausedWorkers()).toContain(id);
		expect(getFailureCounts()[id]?.count).toBeGreaterThanOrEqual(3);
	});

	it("only an explicit unpause resumes a paused worker", async () => {
		const id = "gate-unpause-worker";
		failingWorker(id);
		for (let i = 0; i < 4; i++) await runWorker(id, "test");
		expect((await runWorker(id, "test")).outcome).toBe("paused");
		unpauseWorker(id);
		expect((await runWorker(id, "test")).outcome).toBe("execution_failed");
		expect(getPausedWorkers()).not.toContain(id);
	});

	it("pauses a runaway loop (>10 executions in 5 minutes)", async () => {
		const id = "gate-loop-worker";
		skippingWorker(id);
		let last = "";
		for (let i = 0; i < 11; i++) last = (await runWorker(id, "test")).outcome;
		expect(last).toBe("paused");
		expect(getPausedWorkers()).toContain(id);
	});

	it("a success clears the failure streak", async () => {
		const id = "gate-reset-worker";
		registerWorker({
			worker_id: id,
			name: "Gate test reset",
			responsibility: "synthetic gate probe",
			execution_class: "A",
			trigger_types: ["test"],
			budget: { max_runs_per_hour: 100, max_affected_records: 100 },
			tools: [],
			observe: async () => ({ summary: "work" }),
			analyze: async () => ({ decision: "act", reason: "test" }),
			execute: async () => ({ action_type: "test", target: "t" }),
			verify: async () => ({ ok: true, proof: "done" }),
		});
		// Two failures build a streak, one success must wipe it.
		const { recordFailure } = await import("../../api/_worker-supervisor.js");
		recordFailure(id);
		recordFailure(id);
		expect(getFailureCounts()[id]?.count).toBe(2);
		expect((await runWorker(id, "test")).outcome).toBe("verified_success");
		expect(getFailureCounts()[id]).toBeUndefined();
	});
});
