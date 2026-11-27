// ═══════════════════════════════════════════════════════════════════
// Overnight briefing — every number from real system data (spec §50)
// ═══════════════════════════════════════════════════════════════════
// The briefing aggregates the workforce ledger, supervisor state, reports
// count, pending approvals, eval violations and red-team status. Unknowns
// stay null (rendered as —), never 0.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
const fail = vi.hoisted(() => ({ on: false }));

function chain(payload: unknown = { data: [], error: null, count: 0 }) {
	const q: Record<string, unknown> = {};
	const h: ProxyHandler<Record<string, unknown>> = {
		get(_t, p) {
			if (p === "then")
				return (res: (v: unknown) => unknown) => Promise.resolve(payload).then(res);
			if (p === "maybeSingle" || p === "single")
				return async () => ({ data: null, error: null });
			if (p === "upsert" || p === "insert" || p === "update" || p === "delete")
				return async () => ({ data: null, error: null });
			return (..._a: unknown[]) => new Proxy(q, h);
		},
	};
	return new Proxy(q, h);
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			if (fail.on) throw new Error("db down");
			if (table === "settings") {
				return {
					select: () => ({
						eq: (_c: string, key: string) => ({
							maybeSingle: async () => ({
								data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
								error: null,
							}),
						}),
						limit: async () => ({ data: [], error: null }),
					}),
					upsert: async (row: { key: string; value: unknown }) => {
						kv.store.set(row.key, row.value);
						return { error: null };
					},
				};
			}
			if (table === "reports") return chain({ data: [], error: null, count: 5 });
			return chain();
		},
	},
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => {}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(async () => {}),
	emitEventAndBridge: vi.fn(async () => {}),
	EVENT_TYPES: {},
}));
vi.mock("../../api/_agent-team.js", () => ({
	ALL_AGENTS: [],
	processAgentTask: vi.fn(),
	classifyTask: vi.fn(),
	setAgentState: vi.fn(),
	getAgentState: vi.fn(() => ({ state: "idle", task: null })),
}));
vi.mock("../../api/agents/_runner.js", () => ({
	runAgent: vi.fn(),
	logActivity: vi.fn(async () => {}),
	recordMetric: vi.fn(async () => {}),
	getRecentActivity: vi.fn(async () => []),
}));
vi.mock("../../api/_providers.js", () => ({
	hasUsableLLM: vi.fn(async () => false),
	invalidateLLMStatus: vi.fn(),
	buildChain: vi.fn(async () => []),
	callLLMChain: vi.fn(async () => null),
	callProviderStream: vi.fn(async () => ({ ok: false, text: "", provider: null, model: null })),
	getProviderConfig: vi.fn(async () => null),
}));
vi.mock("../../api/_evaluation-engine.js", () => ({
	registerEvaluation: vi.fn(),
	getEvaluationHistory: vi.fn(async () => [
		{ worker_id: "w1", summary: { total_cases: 10, passed: 9, safety_violations: 2 }, evaluated_at: new Date().toISOString() },
	]),
}));

import workforceHandler from "../../api/_workforce.js";

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

function req(method: string, body: unknown) {
	return {
		method,
		headers: { "x-admin-token": "test" },
		body: method === "POST" ? body : undefined,
		query: method === "GET" ? body : {},
		socket: { remoteAddress: "127.0.0.1" },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	kv.store.clear();
	fail.on = false;
});

describe("overnight-briefing", () => {
	it("aggregates real ledger, supervisor, reports, evals and redteam numbers", async () => {
		const now = new Date().toISOString();
		kv.store.set("workforce_actions_kv", {
			items: [
				{ worker_id: "a", outcome: "verified_success", started_at: now },
				{ worker_id: "b", outcome: "verified_success", started_at: now },
				{ worker_id: "c", outcome: "verified_failure", started_at: now },
			],
		});
		const res = response();
		await workforceHandler(req("GET", { action: "overnight-briefing" }), res);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			ok: boolean;
			window: string;
			items: Array<{ label: string; value: number | null; detail: string; source: string }>;
			needs_attention: number;
		};
		expect(body.ok).toBe(true);
		expect(body.window).toBe("24h");
		const byLabel = Object.fromEntries(body.items.map((i) => [i.label, i]));
		// ledger: 3 executions, 2 ok / 1 failed
		expect(byLabel["Workforce executions (24h)"].value).toBe(3);
		expect(byLabel["Workforce executions (24h)"].detail).toContain("2 verified ok");
		// reports count comes from the real count query
		expect(byLabel["Open reports"].value).toBe(5);
		// eval violations aggregated, not invented
		expect(byLabel["Evaluation safety violations"].value).toBe(2);
		// supervisor fresh: nothing paused
		expect(byLabel["Workers paused by supervisor"].value).toBe(0);
		// every item cites its source
		for (const i of body.items) expect(i.source).toBeTruthy();
	});

	it("reports a readable-but-empty ledger as zero, unknowns as null", async () => {
		const res = response();
		await workforceHandler(req("GET", { action: "overnight-briefing" }), res);
		expect(res.statusCode).toBe(200);
		const body = res.body as { items: Array<{ label: string; value: number | null }> };
		const byLabel = Object.fromEntries(body.items.map((i) => [i.label, i]));
		// Empty ledger was READ successfully: 0 executions is measured, not
		// fabricated. Genuinely unreadable sources stay null (see Open
		// reports when its count query throws — covered by the shape below).
		expect(byLabel["Workforce executions (24h)"].value).toBe(0);
		expect(byLabel["Workers paused by supervisor"].value).toBe(0);
	});

	it("reports null — never 0 — when the database is unreachable", async () => {
		fail.on = true;
		const res = response();
		await workforceHandler(req("GET", { action: "overnight-briefing" }), res);
		expect(res.statusCode).toBe(200);
		const body = res.body as { items: Array<{ label: string; value: number | null }> };
		const byLabel = Object.fromEntries(body.items.map((i) => [i.label, i]));
		expect(byLabel["Workforce executions (24h)"].value).toBeNull();
		expect(byLabel["Open reports"].value).toBeNull();
	});
});
