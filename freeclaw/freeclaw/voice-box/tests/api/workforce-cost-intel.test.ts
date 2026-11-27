// ═══════════════════════════════════════════════════════════════════
// cost-intelligence worker — ledger-derived compute accounting (spec §47)
// ═══════════════════════════════════════════════════════════════════
// Locks: with a starved worker on the ledger the run names it, queues an
// alert, writes an audit row, and verifies BOTH the queued alert and a
// fresh-ledger re-confirmation (plus the independent engine check); a
// nominal fleet skips honestly; an unreadable ledger escalates instead of
// inventing numbers. No dollar figures anywhere — the contract forbids
// estimating cost from run counts.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
const auditRows = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
const mode = vi.hoisted(() => ({ ledgerError: false }));

function row(worker_id: string, outcome: string, duration_ms = 100) {
	return {
		worker_id,
		outcome,
		duration_ms,
		started_at: new Date().toISOString(),
	};
}

function settingsTable() {
	return {
		select: (_cols: string) => ({
			eq: (_c: string, key: string) => ({
				maybeSingle: async () => {
					if (mode.ledgerError) return { data: null, error: { message: "down" } };
					return {
						data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
						error: null,
					};
				},
			}),
			limit: async () => ({ data: [{ key: "k" }], error: null }),
		}),
		upsert: async (rec: { key: string; value: unknown }) => {
			kv.store.set(rec.key, rec.value);
			return { error: null };
		},
	};
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			if (table === "settings") return settingsTable();
			if (table === "activity_logs")
				return {
					insert: async (rec: Record<string, unknown>) => {
						auditRows.rows.push(rec);
						return { data: [{ id: `a${auditRows.rows.length}` }], error: null };
					},
				};
			return {
				select: () => ({
					eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
				}),
			};
		},
	},
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn(async () => {}),
}));

vi.mock("../../api/_improvements.js", () => ({
	queueImprovement: vi.fn(async (item: Record<string, unknown>) => {
		const key = "improvement_queue";
		const cur = (kv.store.get(key) as { items: unknown[] }) || { items: [] };
		cur.items.push(item);
		kv.store.set(key, cur);
		return { ok: true };
	}),
}));

import { runWorker } from "../../api/_workforce-core.js";
import { resetSupervisorState } from "../../api/_worker-supervisor.js";
import "../../api/_workforce-workers.js";

function seedStarvedLedger() {
	const rows = [
		row("w-starved", "budget_blocked"),
		row("w-starved", "budget_blocked"),
		row("w-starved", "budget_blocked"),
		row("w-starved", "budget_blocked"),
		row("w-starved", "verified_success"),
		row("w-starved", "verified_success"),
		row("w-other", "verified_success"),
		row("w-other", "verified_success"),
	];
	kv.store.set("workforce_actions_kv", { items: rows });
}

beforeEach(() => {
	kv.store.clear();
	auditRows.rows.length = 0;
	mode.ledgerError = false;
	vi.clearAllMocks();
	resetSupervisorState();
});

describe("cost-intelligence worker", () => {
	it("names a starved worker, alerts, audits, and re-confirms on a fresh read", async () => {
		seedStarvedLedger();
		const out = await runWorker("cost-intelligence", "test");
		expect(out.outcome).toBe("verified_success");
		expect(out.verification).toMatch(/1\/1 starvation finding\(s\) re-confirmed/);
		expect(out.verification).toMatch(/independent\[api-health\]/);
		expect(out.action_type).toBe("compute_accounting");
		const queued = (kv.store.get("improvement_queue") as { items: Array<Record<string, unknown>> })?.items || [];
		expect(queued.some((q) => q.source === "cost-intelligence")).toBe(true);
		expect(
			auditRows.rows.some(
				(r) => r.actor === "worker:cost-intelligence" && r.action === "compute_anomaly_reported",
			),
		).toBe(true);
		expect(out.metrics).toMatchObject({ metric: "workforce.compute_anomalies" });
	});

	it("skips honestly when compute distribution is nominal", async () => {
		kv.store.set("workforce_actions_kv", {
			items: [row("a", "verified_success"), row("b", "verified_success"), row("c", "verified_success")],
		});
		const out = await runWorker("cost-intelligence", "test");
		expect(out.outcome).toBe("skipped");
		expect(kv.store.has("improvement_queue")).toBe(false);
	});

	it("escalates instead of inventing numbers when the ledger is unreadable", async () => {
		mode.ledgerError = true;
		const out = await runWorker("cost-intelligence", "test");
		expect(out.outcome).toBe("escalated");
		expect(out.decision).toMatch(/ledger unreadable/);
	});
});
