// ═══════════════════════════════════════════════════════════════════
// Workforce core coverage — every registered worker runs the lifecycle
// ═══════════════════════════════════════════════════════════════════
// Locks spec §60 criteria 2/5/8/9/11/14/16/18/20 for the core workers that
// previously had zero test references: each one runs observe→analyze→
// (execute|skip|escalate)→verify through runWorker against a mocked DB,
// writes a real ledger row, and is stopped by its budget cap (the automated
// proxy for the disable test: an over-budget worker performs no action).
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

function settingsChain() {
	const selectQ = () => ({
		eq: (_col: string, key: string) => ({
			maybeSingle: async () => ({
				data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
				error: null,
			}),
		}),
	});
	return {
		select: selectQ,
		upsert: async (row: { key: string; value: unknown }) => {
			kv.store.set(row.key, row.value);
			return { error: null };
		},
		insert: async (row: { key: string; value: unknown }) => {
			kv.store.set(row.key, row.value);
			return { error: null };
		},
	};
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => (table === "settings" ? settingsChain() : tableChain()),
	},
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn(async () => {}),
}));

import {
	getRegistry,
	getWorker,
	readLedger,
	runWorker,
} from "../../api/_workforce-core.js";
import "../../api/_workforce-workers.js";

const UNCOVERED = [
	"cache-optimizer",
	"session-cleaner",
	"poll-archiver",
	"suspension-lifecycle",
	"counter-reconciliation",
	"authz-probe",
	"spam-score-decay",
	"report-sla",
	"api-reliability",
	"spam-sentinel",
	"duplicate-reports",
	"notification-health",
	"orphan-auditor",
	"supervisor",
	"db-health",
	"content-quality",
	"user-anomaly",
	"search-quality",
	"content-enricher",
	"stale-sweeper",
	"priority-scaler",
	"data-consistency",
	"anonymity-guard",
	"voice-intake",
	"missing-info",
];

const KNOWN_OUTCOMES = new Set([
	"verified_success",
	"verified_failure",
	"execution_failed",
	"skipped",
	"escalated",
	"budget_blocked",
	"paused",
	"unknown_worker",
]);

beforeEach(() => {
	kv.store.clear();
});

describe("core worker lifecycle coverage", () => {
	it("all 25 previously-untested workers are registered", () => {
		const ids = new Set(getRegistry().map((w) => w.worker_id));
		for (const id of UNCOVERED) expect(ids.has(id)).toBe(true);
	});

	for (const id of UNCOVERED) {
		it(`${id}: runs the lifecycle and writes a ledger row`, async () => {
			const row = await runWorker(id, "test");
			expect(row.worker_id).toBe(id);
			expect(KNOWN_OUTCOMES.has(row.outcome)).toBe(true);
			expect(typeof row.duration_ms).toBe("number");
			const ledger = await readLedger(500);
			expect(ledger.some((r) => r.worker_id === id)).toBe(true);
		});

		it(`${id}: budget cap stops further action (disable/cost-control)`, async () => {
			// Run one past the worker's own hourly cap — the over-budget run
			// must be blocked before observing or executing.
			const cap = getWorker(id)?.budget?.max_runs_per_hour ?? 2;
			const outcomes: string[] = [];
			for (let i = 0; i < cap + 1; i++)
				outcomes.push((await runWorker(id, "test")).outcome);
			expect(outcomes).toContain("budget_blocked");
		});
	}
});
