// ═══════════════════════════════════════════════════════════════════
// Independent verification — self-report AND engine verifier (spec §56)
// ═══════════════════════════════════════════════════════════════════
// Locks: runWorker requires BOTH the worker's own verify() and the mapped
// independent verifier (VERIFIER_MAP) for verified_success. A passing
// self-report with a failing engine check is a verified_failure (with
// rollback when the worker declares one); unmapped workers keep the legacy
// self-verify path. Uses synthetic worker ids + temporary map entries so no
// production worker or map content is touched.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
const db = vi.hoisted(() => ({ failPosts: false }));

function settingsChain() {
	return {
		select: () => ({
			eq: (_c: string, key: string) => ({
				maybeSingle: async () => ({
					data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
					error: null,
				}),
			}),
			limit: async () => ({ data: [{ key: "k" }], error: null }),
		}),
		upsert: async (row: { key: string; value: unknown }) => {
			kv.store.set(row.key, row.value);
			return { error: null };
		},
	};
}

function postsChain() {
	return {
		select: () => {
			if (db.failPosts) throw new Error("posts table down");
			return {
				then(res: (v: unknown) => unknown) {
					return Promise.resolve({ count: 5, data: [], error: null }).then(res);
				},
				ilike: () => ({ limit: async () => ({ data: [], error: null }) }),
			};
		},
	};
}

function emptyChain() {
	const q: Record<string, unknown> = {};
	return new Proxy(q, {
		get(_t, p) {
			if (p === "then")
				return (res: (v: unknown) => unknown) =>
					Promise.resolve({ data: [], error: null }).then(res);
			if (p === "maybeSingle" || p === "single")
				return async () => ({ data: null, error: null });
			return (..._a: unknown[]) => emptyChain();
		},
	});
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			if (table === "settings") return settingsChain();
			if (table === "posts") return postsChain();
			return emptyChain();
		},
	},
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn(async () => {}),
}));

import { VERIFIER_MAP } from "../../api/_workforce-verification.js";
import { registerWorker, runWorker } from "../../api/_workforce-core.js";
import { getPausedWorkers, unpauseWorker } from "../../api/_worker-supervisor.js";

function probeWorker(id: string, opts: { rollback?: boolean } = {}) {
	registerWorker({
		worker_id: id,
		name: `Verify probe ${id}`,
		responsibility: "synthetic independent-verification probe",
		execution_class: "A",
		trigger_types: ["test"],
		budget: { max_runs_per_hour: 100, max_affected_records: 100 },
		tools: [],
		observe: async () => ({ summary: "work" }),
		analyze: async () => ({ decision: "act", reason: "test", affected: 1 }),
		execute: async () => ({ action_type: "probe", target: "t", affected: 1 }),
		verify: async () => ({ ok: true, proof: "self: effect present" }),
		...(opts.rollback
			? {
					rollback_strategy: async () => {
						rolledBack.push(id);
					},
				}
			: {}),
	});
}

const rolledBack: string[] = [];

beforeEach(() => {
	kv.store.clear();
	db.failPosts = false;
	rolledBack.length = 0;
	for (const w of getPausedWorkers()) unpauseWorker(w);
});

afterEach(() => {
	for (const k of Object.keys(VERIFIER_MAP))
		if (k.startsWith("iv-")) delete (VERIFIER_MAP as Record<string, unknown>)[k];
});

describe("independent verification AND-gate", () => {
	it("requires both self-report and engine check for success", async () => {
		(VERIFIER_MAP as Record<string, unknown>)["iv-ok"] = {
			verifier: "record-count",
			context: { table: "posts" },
		};
		probeWorker("iv-ok");
		const row = await runWorker("iv-ok", "test");
		expect(row.outcome).toBe("verified_success");
		expect(row.verification).toMatch(/self: effect present/);
		expect(row.verification).toMatch(/independent\[record-count\]/);
	});

	it("fails the run when the engine check fails, and rolls back", async () => {
		(VERIFIER_MAP as Record<string, unknown>)["iv-bad"] = {
			verifier: "record-count",
			context: { table: "posts" },
		};
		db.failPosts = true;
		probeWorker("iv-bad", { rollback: true });
		const row = await runWorker("iv-bad", "test");
		expect(row.outcome).toBe("verified_failure");
		expect(row.verification).toMatch(/independent\[record-count\] failed/);
		expect(rolledBack).toContain("iv-bad");
	});

	it("keeps the legacy self-verify path for unmapped workers", async () => {
		probeWorker("iv-legacy");
		const row = await runWorker("iv-legacy", "test");
		expect(row.outcome).toBe("verified_success");
		expect(row.verification).toMatch(/self: effect present/);
		expect(row.verification).not.toMatch(/independent\[/);
	});
});
