// Workforce Batch 5b (roster #29 UX Intelligence + durable vitals) — tests.
//
// #29 proves the UX worker measures REAL durable vitals and flags
// regressions; the vitals tests prove the /api/vitals receiver now persists
// cumulative counts across cold starts (previously in-memory only).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => {}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn(),
}));
vi.mock("../../api/_security.js", () => ({
	securityCheck: vi.fn(() => ({ ok: true })),
}));

import { runUXIntel } from "../../api/_ux-intel.js";
import handler from "../../api/_vitals.js";

// ── tiny table router + stateful KV ───────────────────────────────
type Table = Record<string, any>;

const PASSTHROUGH = [
	"select", "eq", "neq", "in", "like", "ilike", "gte", "lte", "gt", "lt",
	"order", "limit", "range", "or", "not", "is", "filter", "match",
	"update", "upsert", "delete", "insert",
];

function makeTable(cfg: { data?: unknown; error?: unknown } = {}): Table {
	const q: Table = {};
	for (const m of PASSTHROUGH) q[m] = vi.fn(() => q);
	q.then = (resolve: (v: unknown) => void) =>
		Promise.resolve({ data: cfg.data ?? [], error: cfg.error ?? null }).then(resolve);
	return q;
}

function makeSettingsKV(state: { kv: Map<string, any> }): Table {
	const q: Table = {};
	let eqKey: unknown = null;
	let mode: "select" | "upsert" = "select";
	let last: Table | null = null;
	for (const m of PASSTHROUGH) {
		if (m === "upsert") continue;
		q[m] = vi.fn((...args: unknown[]) => {
			if (m === "eq" && args[0] === "key") eqKey = args[1];
			return q;
		});
	}
	q.upsert = vi.fn((rec: Table) => {
		state.kv.set(String(rec.key), rec.value);
		last = rec;
		mode = "upsert";
		return q;
	});
	q.then = (resolve: (v: unknown) => void) => {
		if (mode === "upsert") {
			mode = "select";
			return Promise.resolve({ data: last ? [last] : [], error: null }).then(resolve);
		}
		const data =
			eqKey != null && state.kv.has(String(eqKey))
				? [{ key: eqKey, value: state.kv.get(String(eqKey)) }]
				: [];
		return Promise.resolve({ data, error: null }).then(resolve);
	};
	q.maybeSingle = vi.fn(async () => ({
		data:
			eqKey != null && state.kv.has(String(eqKey))
				? { key: eqKey, value: state.kv.get(String(eqKey)) }
				: null,
		error: null,
	}));
	q.single = q.maybeSingle;
	return q;
}

function router(tables: Record<string, () => Table>) {
	return (table: string) => (tables[table] ? tables[table]() : makeTable({}));
}

function makeRes() {
	const res: Table = {};
	res.status = vi.fn(() => res);
	res.json = vi.fn(async () => res);
	res.setHeader = vi.fn();
	res.end = vi.fn();
	return res;
}

// ── env / globals ─────────────────────────────────────────────────
const ORIG_APP = process.env.APP_BASE_URL;
const ORIG_VERCEL = process.env.VERCEL_URL;

beforeEach(() => {
	vi.clearAllMocks();
	process.env.APP_BASE_URL = "http://127.0.0.1:4010";
	delete process.env.VERCEL_URL;
	mockFrom.mockImplementation(router({}));
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => {
	if (ORIG_APP === undefined) delete process.env.APP_BASE_URL;
	else process.env.APP_BASE_URL = ORIG_APP;
	if (ORIG_VERCEL === undefined) delete process.env.VERCEL_URL;
	else process.env.VERCEL_URL = ORIG_VERCEL;
});

const vitalsDurable = (lcpPoor: number) => ({
	metrics: {
		LCP: { good: 100 - lcpPoor, needsImprovement: 0, poor: lcpPoor, total: 100, sum: 25000 },
		CLS: { good: 98, needsImprovement: 0, poor: 2, total: 100, sum: 12 },
	},
});

// ── #29 UX Intelligence ───────────────────────────────────────────
describe("#29 ux-intel", () => {
	it("measures real durable vitals and flags a regression climb", async () => {
		const kv = new Map<string, any>();
		kv.set("vitals:durable", vitalsDurable(10));
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const first = await runUXIntel({});

		expect(first.ok).toBe(true);
		expect(first.verified).toBe(true);
		expect(first.snapshot.metrics_tracked).toBe(2);
		expect(first.snapshot.metrics.LCP.poor_rate).toBe(10);
		// First snapshot: nothing to compare against yet — no false positive.
		expect(first.snapshot.regressed).toBe(false);
		expect(kv.get("ux_intel:latest")?.metrics?.LCP?.poor_rate).toBe(10);

		// The poor rate climbs 10% → 30% (20 points, beyond the 5 tolerance).
		kv.set("vitals:durable", vitalsDurable(30));
		const second = await runUXIntel({});

		expect(second.ok).toBe(true);
		expect(second.snapshot.regressed).toBe(true);
		expect(second.snapshot.regressions[0].metric).toBe("LCP");
		expect(second.snapshot.regressions[0].poor_rate_before).toBe(10);
		expect(second.snapshot.regressions[0].poor_rate_now).toBe(30);
	});

	it("experience signals stop being measured (disable test)", async () => {
		// Empty durable store → honest nothing-to-measure, no fabricated zero.
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runUXIntel({});

		expect(r.ok).toBe(true);
		expect(r.snapshot.metrics_tracked).toBe(0);
		expect(kv.get("ux_intel:latest")).toBeUndefined();
	});
});

// ── Durable vitals receiver ───────────────────────────────────────
describe("vitals receiver durability", () => {
	it("persists cumulative counts across cold starts", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);
		const req = {
			method: "POST",
			body: { metrics: [{ name: "LCP", value: 2500, rating: "good" }, { name: "CLS", value: 0.2, rating: "poor" }] },
			headers: {},
		};

		const res1 = makeRes();
		await handler(req as any, res1);
		expect(kv.get("vitals:durable")?.metrics?.LCP?.total).toBe(1);

		// A second POST (a fresh cold start would have empty memory — the
		// durable KV accumulates regardless).
		const res2 = makeRes();
		await handler(req as any, res2);
		const durable = kv.get("vitals:durable")?.metrics;
		expect(durable.LCP.total).toBe(2);
		expect(durable.LCP.good).toBe(2);
		expect(durable.CLS.poor).toBe(2);
	});
});

// ── Durable search telemetry ──────────────────────────────────────
describe("search telemetry durability", () => {
	it("search-intel reads durable evidence when the live window is empty", async () => {
		const kv = new Map<string, any>();
		// Durable store has real accumulated usage; the in-memory window is empty.
		kv.set("search_events:durable", {
			total_searches: 200,
			zero_result_count: 40, // 20% zero-result — past the 10% threshold
			zero_result_map: { "projector broken": 25, "wifi down": 15 },
		});
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
				activity_logs: () => makeTable({ data: [] }),
			}),
		);

		const { runSearchIntel: searchIntel } = await import("../../api/_search-quality.js");
		const out = await searchIntel();

		expect(out.ok).toBe(true);
		expect(out.verified).toBe(true);
		expect(out.durable.total_searches).toBe(200);
		expect(out.durable.zero_result_rate).toBe("20%");
		expect(out.degraded).toBe(true);
		expect(out.durable.top_zero_result_queries[0].query).toBe("projector broken");
		// The snapshot persisted to the canonical KV.
		expect(kv.get("search_intel:latest")?.durable?.total_searches).toBe(200);
	});
});
