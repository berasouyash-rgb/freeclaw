// ═══════════════════════════════════════════════════════════════════
// Ops-summary health contract — the Overview System Health card reads
// top-level `health` + `recent` from this payload. They were missing, so
// the card sat on "Loading…" forever. This locks their presence and shape.
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
						like: async () => ({ data: [], error: null }),
						limit: async () => ({ data: [], error: null }),
					}),
					upsert: async (row: { key: string; value: unknown }) => {
						kv.store.set(row.key, row.value);
						return { error: null };
					},
				};
			}
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
	// Real signature is (res, err, context) and it SENDS the response itself.
	sanitizeError: vi.fn(
		(
			res: { status: (c: number) => { json: (b: unknown) => unknown } },
			_err: unknown,
		) => res.status(500).json({ error: "Internal server error" }),
	),
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
	getEvaluationHistory: vi.fn(async () => []),
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

beforeEach(() => {
	vi.clearAllMocks();
	kv.store.clear();
	fail.on = false;
});

describe("ops-summary health contract", () => {
	// NOTE: the down-state test runs FIRST: getOverview caches per process,
	// so a successful build would mask the failure path in later tests.
	it("reports db down instead of healthy zeros when the database is unreachable", async () => {
		fail.on = true;
		const res = response();
		await workforceHandler(
			{ method: "GET", headers: {}, body: undefined, query: { action: "ops-summary" }, socket: {} },
			res,
		);
		// Either a 500 envelope or a payload with db: down — never ok.
		if (res.statusCode === 200) {
			const body = res.body as { health?: { db?: string } };
			expect(body.health?.db).toBe("down");
		} else {
			expect(res.statusCode).toBe(500);
		}
	});

	it("ships measured health states plus recent agent activity", async () => {
		const res = response();
		await workforceHandler(
			{ method: "GET", headers: {}, body: undefined, query: { action: "ops-summary" }, socket: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as {
			health: { db: string; api: string; cache: string; realtime: string };
			recent: Array<{ worker: string; action: string; at: string }>;
		};
		expect(["ok", "slow", "down"]).toContain(body.health.db);
		expect(body.health.api).toBe("ok");
		expect(["ok", "stale", "down"]).toContain(body.health.cache);
		expect(["ok", "reconnecting", "down", "unknown"]).toContain(body.health.realtime);
		expect(Array.isArray(body.recent)).toBe(true);
	});
});
