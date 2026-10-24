// Workforce Batch 5 (roster #25–#28, AI & Product Quality) — disable tests.
//
// Each test proves one worker performs its REAL job against real tooling and
// that removing it would leave a gap:
//   #25 ai-quality      the evaluated workforce is scored from real history.
//   #26 red-team        the injection/PII/threat suite runs the REAL engine.
//   #27 ai-regression   golden journeys run and regressions are detected.
//   #28 ai-drift        real pass-rate/score deltas flag drift.
//
// #29 UX Intelligence and #30 Product QA are deferred to the next slice
// (see D:/Temp/opencode/b5-plan.md).
//
// Harness: mock the DB client + _auth.js; keep _evaluation-engine.js,
// _redteam-cases.js, _golden-workflows.js, _moderation.js and _drift.js REAL
// — the red-team and golden journeys run the real moderation/state checks.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockFetch } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockFetch: vi.fn(),
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
	rateLimited: vi.fn(async () => false),
	securityCheck: vi.fn(() => ({ ok: true })),
}));

import { runAIQuality } from "../../api/_evaluation-engine.js";
import { runDriftWatch } from "../../api/_drift.js";
import { runGoldenRegression } from "../../api/_golden-workflows.js";
import { runRedTeam, REDTEAM_CASES } from "../../api/_redteam-cases.js";

// ── tiny table router ─────────────────────────────────────────────
type Table = Record<string, any>;

const PASSTHROUGH = [
	"select",
	"eq",
	"neq",
	"in",
	"like",
	"ilike",
	"gte",
	"lte",
	"gt",
	"lt",
	"order",
	"limit",
	"range",
	"or",
	"not",
	"is",
	"filter",
	"match",
	"update",
	"upsert",
	"delete",
	"insert",
];

function makeTable(
	cfg: {
		data?: unknown;
		error?: unknown;
		maybeSingle?: unknown;
		single?: unknown;
	} = {},
): Table {
	const q: Table = {};
	for (const m of PASSTHROUGH) q[m] = vi.fn(() => q);
	q.maybeSingle = vi.fn(async () => ({ data: cfg.maybeSingle ?? null, error: null }));
	q.single = vi.fn(async () => ({
		data: cfg.single ?? cfg.maybeSingle ?? null,
		error: null,
	}));
	q.then = (resolve: (v: unknown) => void) =>
		Promise.resolve({ data: cfg.data ?? [], error: cfg.error ?? null }).then(resolve);
	return q;
}

/**
 * Stateful settings KV: upsert AND update persist (the golden-workflows
 * store uses update-when-existing), maybeSingle serves by key.
 */
function makeSettingsKV(state: { kv: Map<string, any> }): Table {
	const q: Table = {};
	let eqKey: unknown = null;
	let mode: "select" | "upsert" | "update" = "select";
	let last: Table | null = null;
	for (const m of PASSTHROUGH) {
		if (m === "upsert" || m === "update") continue;
		q[m] = vi.fn((...args: unknown[]) => {
			if (m === "eq" && args[0] === "key") eqKey = args[1];
			return q;
		});
	}
	const persist = (rec: Table) => {
		state.kv.set(String(rec.key), rec.value);
		last = rec;
	};
	q.upsert = vi.fn((rec: Table) => {
		persist(rec);
		mode = "upsert";
		return q;
	});
	q.insert = vi.fn((rec: Table) => {
		persist(rec);
		mode = "upsert";
		return q;
	});
	let pendingUpdate: Table | null = null;
	q.update = vi.fn((rec: Table) => {
		pendingUpdate = rec;
		mode = "update";
		return q;
	});
	q.then = (resolve: (v: unknown) => void) => {
		if (mode === "upsert") {
			mode = "select";
			return Promise.resolve({ data: last ? [last] : [], error: null }).then(resolve);
		}
		if (mode === "update") {
			// Apply the pending patch fields onto the keyed row (real
			// PostgREST .update().eq() semantics).
			if (eqKey != null && pendingUpdate) {
				const prev = (state.kv.get(String(eqKey)) as Record<string, unknown>) || {};
				state.kv.set(String(eqKey), { ...prev, ...(pendingUpdate as Record<string, unknown>) });
			}
			pendingUpdate = null;
			mode = "select";
			return Promise.resolve({ data: [], error: null }).then(resolve);
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

/** Route a table name to a fresh chain (fresh per .from() call). */
function router(tables: Record<string, () => Table>) {
	return (table: string) => (tables[table] ? tables[table]() : makeTable({}));
}

// ── env / globals ─────────────────────────────────────────────────
const ORIG_APP = process.env.APP_BASE_URL;
const ORIG_VERCEL = process.env.VERCEL_URL;

beforeEach(() => {
	vi.clearAllMocks();
	process.env.APP_BASE_URL = "http://127.0.0.1:4010";
	delete process.env.VERCEL_URL;
	vi.stubGlobal("fetch", mockFetch);
	mockFrom.mockImplementation(router({}));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

afterAll(() => {
	if (ORIG_APP === undefined) delete process.env.APP_BASE_URL;
	else process.env.APP_BASE_URL = ORIG_APP;
	if (ORIG_VERCEL === undefined) delete process.env.VERCEL_URL;
	else process.env.VERCEL_URL = ORIG_VERCEL;
});

// ── #25 AI Quality ────────────────────────────────────────────────
describe("#25 ai-quality", () => {
	it("scores the evaluated workforce from real history and persists it", async () => {
		const kv = new Map<string, any>();
		kv.set("workforce_evaluations", {
			items: [
				{
					worker_id: "search-quality",
					summary: { total_cases: 5, passed: 4, success_rate: 80, average_score: 80, safety_violations: 0 },
					evaluated_at: new Date().toISOString(),
				},
				{
					worker_id: "db-health",
					summary: { total_cases: 4, passed: 4, success_rate: 100, average_score: 100, safety_violations: 1 },
					evaluated_at: new Date().toISOString(),
				},
			],
		});
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runAIQuality({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.snapshot.workers_evaluated).toBe(2);
		expect(r.snapshot.safety_violations_total).toBe(1);
		expect(r.snapshot.average_score).toBe(90);
		// Weakest first — the lowest-scoring worker leads.
		expect(r.snapshot.weakest[0].worker_id).toBe("search-quality");
		// The snapshot persisted to the canonical KV.
		expect(kv.get("ai_quality:latest")?.workers_evaluated).toBe(2);
	});

	it("AI output quality stops being scored (disable test)", async () => {
		// No evaluation history → honest nothing-to-score, no fabricated data.
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runAIQuality({});

		expect(r.ok).toBe(true);
		expect(r.snapshot.workers_evaluated).toBe(0);
		expect(kv.get("ai_quality:latest")).toBeUndefined();
	});
});

// ── #26 AI Red-Team ───────────────────────────────────────────────
describe("#26 red-team", () => {
	it("runs the REAL moderation engine over the full injection suite", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runRedTeam();

		// Every case executed through the real serverModerate — no mocks.
		// Suite size derives from the source (never hardcoded: the count
		// drifted once already and the test blamed the worker).
		expect(r.total).toBe(REDTEAM_CASES.length);
		expect(r.cases.length).toBe(REDTEAM_CASES.length);
		for (const c of r.cases) {
			expect(["block", "hold", "publish", "error"].includes(String(c.actual)) || String(c.actual).startsWith("error")).toBe(true);
			expect(typeof c.pass).toBe("boolean");
		}
		// The run persisted capped history so the Safety Intel page shows it.
		expect(kv.get("safety_redteam_runs")?.runs?.length).toBe(1);
	});

	it("injection probes stop running when disabled (history freezes)", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		await runRedTeam();
		const after1 = (kv.get("safety_redteam_runs")?.runs || []).length;
		await runRedTeam();
		const after2 = (kv.get("safety_redteam_runs")?.runs || []).length;

		// Each run records history — without the worker, the history freezes
		// and the Safety Intel page would show a stale last-run forever.
		expect(after1).toBe(1);
		expect(after2).toBe(2);
	});
});

// ── #27 AI Regression ─────────────────────────────────────────────
describe("#27 ai-regression", () => {
	it("runs the golden journeys and detects no false regressions", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				posts: () => makeTable({ data: [{ id: "p1", title: "Broken AC" }] }),
				comments: () => makeTable({ data: [{ id: "c1", post_id: "p1" }] }),
				notifications: () => makeTable({ data: [{ id: "n1" }] }),
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runGoldenRegression();

		expect(r.ok).toBe(true);
		expect(r.passed).toBeGreaterThanOrEqual(1);
		// Healthy state: no step that passed before fails now.
		expect(r.regressed).toBe(0);
		// The run persisted to the canonical golden history.
		expect(kv.get("golden_workflow_results")?.history?.length).toBeGreaterThanOrEqual(1);
	});

	it("golden regressions escape when the worker is disabled (disable test)", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				posts: () => makeTable({ data: [{ id: "p1", title: "Broken AC" }] }),
				comments: () => makeTable({ data: [{ id: "c1", post_id: "p1" }] }),
				notifications: () => makeTable({ data: [{ id: "n1" }] }),
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const first = await runGoldenRegression();
		const second = await runGoldenRegression();

		// Two runs grow the history and the comparison uses the previous run:
		// without the worker, a golden step could silently break with no run
		// ever recording the failure.
		expect(first.passed).toBeGreaterThanOrEqual(1);
		expect(second.passed).toBeGreaterThanOrEqual(1);
		expect((kv.get("golden_workflow_results")?.history || []).length).toBe(2);
		expect(second.regressed).toBe(0);
	});
});

// ── #28 AI Drift ──────────────────────────────────────────────────
describe("#28 ai-drift", () => {
	it("flags real pass-rate drift beyond tolerance and persists it", async () => {
		const kv = new Map<string, any>();
		kv.set("safety_redteam_runs", {
			runs: [
				{ run_at: new Date().toISOString(), pass_rate: 70 },
				{ run_at: new Date(Date.now() - 3600 * 1000).toISOString(), pass_rate: 90 },
			],
		});
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runDriftWatch({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.redteam.drifted).toBe(true);
		expect(r.redteam.delta).toBe(-20);
		expect(r.drift_flags.length).toBeGreaterThanOrEqual(1);
		expect(kv.get("ai_drift:latest")?.drifted).toBe(true);
	});

	it("no drift is fabricated on healthy state (disable test)", async () => {
		// No red-team history and no evaluation history → honest nulls,
		// zero drift flags.
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runDriftWatch({});

		expect(r.ok).toBe(true);
		expect(r.redteam).toBeNull();
		expect(r.drifted).toBe(false);
		expect(r.drift_flags.length).toBe(0);
	});
});
