// Workforce Batch 3 (roster #13–#18, Resolution & Insight) — disable tests.
//
// Each test proves one worker performs its REAL job against real tooling
// (the platform's own detectors, real table writes, real telemetry) and that
// removing it would leave a gap:
//   #14 trends         24h category spikes raise a keyed, deduped alert.
//   #15 multilingual   non-platform-language posts get advisory translations.
//   #16 search-intel   degraded search telemetry is measured and reported.
//   #17 knowledge      resolved cases are harvested into the KB, searchably.
//   #18 briefing       the operations digest is built from real reads.
//
// #13 resolution-verification (report-target re-verification) ships with the
// parallel workforce slice and is not re-tested here.
//
// Harness: mirrors batch2 (mock DB client + _auth.js + _error.js + the
// _workforce.js task-layer transitive deps); keep the real modules
// (_trend-watch.js / _translate.js / _search-quality.js / _kb-maintain.js /
// _briefing.js) and the real _artifact-filter.js. NOTE: _search-quality.js
// holds in-memory telemetry across tests in this file — the empty-window
// (disable) test must run BEFORE the seeded (real-run) test.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockFrom,
	mockFetch,
	mockQueueImprovement,
	mockCallLLMChain,
} = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockFetch: vi.fn(),
	mockQueueImprovement: vi.fn(async () => true),
	mockCallLLMChain: vi.fn(async () => null),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));
vi.mock("../../api/_improvements.js", () => ({
	queueImprovement: mockQueueImprovement,
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
vi.mock("../../api/_continuous-learning.js", () => ({
	getLearningStatus: vi.fn(async () => ({})),
	runContinuousEvaluation: vi.fn(async () => ({})),
}));
vi.mock("../../api/_evaluation-engine.js", () => ({
	getEvaluationHistory: vi.fn(async () => []),
}));
vi.mock("../../api/_training-lab.js", () => ({
	TRAINING_SCENARIOS: [],
}));
vi.mock("../../api/_providers.js", () => ({
	hasUsableLLM: vi.fn(async () => true),
	invalidateLLMStatus: vi.fn(),
	buildChain: vi.fn(async () => []),
	callLLMChain: mockCallLLMChain,
	callProviderStream: vi.fn(async () => ({
		ok: false,
		text: "",
		provider: null,
		model: null,
	})),
	getProviderConfig: vi.fn(async () => null),
}));

import { runMultilingual, runSearchIntel } from "../../api/_workforce-workers.js";
import { generateBriefing } from "../../api/_briefing.js";
import { maintainKB } from "../../api/_kb-maintain.js";
import { recordSearchEvent } from "../../api/_search-quality.js";
import { checkTrends } from "../../api/_trend-watch.js";
import { resetSupervisorState } from "../../api/_worker-supervisor.js";

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
	q.then = (resolve: (v: unknown) => void) => {
		const data = (cfg.data ?? []) as unknown[];
		// A readable store answers count queries: the independent engine
		// verifier (record-count) re-reads this after every run.
		return Promise.resolve({
			data,
			count: Array.isArray(data) ? data.length : 0,
			error: cfg.error ?? null,
		}).then(resolve);
	};
	return q;
}

/** Stateful activity_logs table (inserts persist, maybeSingle re-reads). */
function makeActivityLogs(state: { logs: Table[] }): Table {
	const q: Table = {};
	let mode: "select" | "insert" = "select";
	let lastInsert: Table | null = null;
	let eqId: unknown = null;
	for (const m of PASSTHROUGH) {
		if (m === "insert") continue;
		q[m] = vi.fn((...args: unknown[]) => {
			if (m === "eq" && args[0] === "id") eqId = args[1];
			return q;
		});
	}
	q.insert = vi.fn((rec: Table) => {
		lastInsert = { id: `log_${state.logs.length + 1}`, ...rec };
		state.logs.push(lastInsert);
		mode = "insert";
		return q;
	});
	q.then = (resolve: (v: unknown) => void) => {
		const data = mode === "insert" ? (lastInsert ? [lastInsert] : []) : state.logs.slice();
		mode = "select";
		return Promise.resolve({ data, count: data.length, error: null }).then(resolve);
	};
	q.maybeSingle = vi.fn(async () => ({
		data: state.logs.find((l) => l.id === eqId) || null,
		error: null,
	}));
	q.single = q.maybeSingle;
	return q;
}

/** Stateful knowledge_base table: inserts persist, maybeSingle re-reads by
 * id; searchKB's usage-count update is a tolerated passthrough. */
function makeKB(state: { entries: Table[] }): Table {
	const q: Table = {};
	let eqId: unknown = null;
	let mode: "select" | "insert" = "select";
	let lastInsert: Table | null = null;
	for (const m of PASSTHROUGH) {
		if (m === "insert") continue;
		q[m] = vi.fn((...args: unknown[]) => {
			if (m === "eq" && args[0] === "id") eqId = args[1];
			return q;
		});
	}
	q.insert = vi.fn((rec: Table) => {
		lastInsert = { id: `kb_${state.entries.length + 1}`, ...rec };
		state.entries.push(lastInsert);
		mode = "insert";
		return q;
	});
	q.then = (resolve: (v: unknown) => void) => {
		if (mode === "insert") {
			mode = "select";
			return Promise.resolve({ data: lastInsert ? [lastInsert] : [], error: null }).then(resolve);
		}
		return Promise.resolve({ data: state.entries.slice(), error: null }).then(resolve);
	};
	q.maybeSingle = vi.fn(async () => ({
		data: state.entries.find((e) => e.id === eqId) || null,
		error: null,
	}));
	q.single = q.maybeSingle;
	return q;
}

/** Stateful settings KV (workforce_actions_kv ledger, workforce_alerts,
 * translation:{id}, briefing:latest): upsert persists, maybeSingle serves. */
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

/** Route a table name to a fresh chain (fresh per .from() call). */
function router(tables: Record<string, () => Table>) {
	return (table: string) => (tables[table] ? tables[table]() : makeTable({}));
}

// ── env / globals ─────────────────────────────────────────────────
const ORIG_APP = process.env.APP_BASE_URL;
const ORIG_VERCEL = process.env.VERCEL_URL;

beforeEach(() => {
	vi.clearAllMocks();
	resetSupervisorState();
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

const hoursAgo = (n: number) => new Date(Date.now() - n * 3600 * 1000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

// ── #14 Recurring Problem / Trend Watch ───────────────────────────
describe("#14 trends", () => {
	it("raises a keyed alert for a 24h category spike and does not flood", async () => {
		const kv = new Map<string, any>();
		// 5 posts in one category inside the last 24h, zero in the prior
		// baseline days → spike (recent >= MIN_RECENT and 5 >= 3 * 0.5 floor).
		const posts: Table[] = Array.from({ length: 5 }, (_, i) => ({
			id: `sp${i}`,
			category: "Facilities",
			created_at: hoursAgo(2),
		}));
		const client = {
			from: router({
				posts: () => makeTable({ data: posts }),
				settings: () => makeSettingsKV({ kv }),
			}),
		};

		const r = await checkTrends(client as any, Date.now());

		expect(r.ok).toBe(true);
		expect(r.spikes.length).toBe(1);
		expect(r.spikes[0].category).toBe("Facilities");
		const alerts = kv.get("workforce_alerts")?.alerts || [];
		expect(alerts.length).toBe(1);
		expect(alerts[0].key).toBe("trend:Facilities");
		expect(alerts[0].agent).toBe("trend-watch");
		expect(alerts[0].resolved_at).toBeFalsy();

		// Keyed dedupe: an unresolved spike alert suppresses repeat raises.
		const second = await checkTrends(client as any, Date.now());
		expect(second.spikes.length).toBe(0);
		expect((kv.get("workforce_alerts")?.alerts || []).length).toBe(1);
	});

	it("recurring problems stop being surfaced (disable test)", async () => {
		// Posts only in the baseline period → recent 0 → no spike, no alert.
		const kv = new Map<string, any>();
		const posts: Table[] = Array.from({ length: 5 }, (_, i) => ({
			id: `old${i}`,
			category: "Facilities",
			created_at: daysAgo(5),
		}));
		const client = {
			from: router({
				posts: () => makeTable({ data: posts }),
				settings: () => makeSettingsKV({ kv }),
			}),
		};

		const r = await checkTrends(client as any, Date.now());

		expect(r.ok).toBe(true);
		expect(r.spikes.length).toBe(0);
		expect(kv.get("workforce_alerts")).toBeUndefined();
	});
});

// ── #15 Multilingual ──────────────────────────────────────────────
describe("#15 multilingual", () => {
	it("stores an advisory translation for a non-platform-language post", async () => {
		const logs: Table[] = [];
		const kv = new Map<string, any>();
		const posts: Table[] = [
			{
				id: "hi1",
				title: "पानी की समस्या block में",
				description: "पानी आ रहा है corridor में",
				category: "Facilities",
				status: "reported",
				created_at: daysAgo(1),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makeTable({ data: posts }),
				activity_logs: () => makeActivityLogs({ logs }),
				settings: () => makeSettingsKV({ kv }),
			}),
		);
		mockCallLLMChain.mockResolvedValue({
			text: JSON.stringify({
				title_translation: "Water problem in the block",
				description_translation: "Water is coming in the corridor",
			}),
		});

		const r = await runMultilingual();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		expect(r.metrics.stored).toBe(1);
		expect(logs.length).toBe(1);
		expect(logs[0].actor).toBe("worker:multilingual");
		expect(logs[0].action).toBe("translation_stored");
		// The translation persisted to the canonical KV and is re-readable.
		const stored = kv.get("translation:hi1");
		expect(stored?.language).toBe("hi");
		expect(stored?.title_translation).toBe("Water problem in the block");
		// The original text was never replaced.
		expect(posts[0].title).toBe("पानी की समस्या block में");
	});

	it("non-localized content stops being translated (disable test)", async () => {
		const logs: Table[] = [];
		const kv = new Map<string, any>();
		const posts: Table[] = [
			{
				id: "en1",
				title: "Water problem in the block",
				description: "Water is coming in the corridor",
				category: "Facilities",
				status: "reported",
				created_at: daysAgo(1),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makeTable({ data: posts }),
				activity_logs: () => makeActivityLogs({ logs }),
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runMultilingual();

		expect(r.outcome).toBe("skipped");
		expect(logs.length).toBe(0);
		expect(kv.get("translation:en1")).toBeUndefined();
	});
});

// ── #16 Search Intelligence ───────────────────────────────────────
// NOTE: the module keeps in-memory telemetry across tests in this file, so
// the empty-window (disable) test MUST run before the seeded (real) test.
describe("#16 search-intel", () => {
	it("stands down on an empty telemetry window (disable test)", async () => {
		const logs: Table[] = [];
		mockFrom.mockImplementation(
			router({
				activity_logs: () => makeActivityLogs({ logs }),
			}),
		);

		const r = await runSearchIntel();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("skipped");
		// Skipped runs never execute, so nothing is measured: metrics stays
		// null by design (core only measures after a real execution).
		expect(r.metrics).toBeNull();
		expect(logs.length).toBe(0);
	});

	it("reports degraded search telemetry with a verified audit row", async () => {
		const logs: Table[] = [];
		mockFrom.mockImplementation(
			router({
				activity_logs: () => makeActivityLogs({ logs }),
			}),
		);
		// Seed the real telemetry window: all zero-result, slow searches.
		for (let i = 0; i < 4; i++)
			recordSearchEvent({ query: "projector broken", results: 0, latency_ms: 600 });
		for (let i = 0; i < 2; i++)
			recordSearchEvent({ query: "wifi down", results: 0, latency_ms: 550 });

		const r = await runSearchIntel();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		// mapRunResult carries the ledger evidence string (not raw telemetry):
		// the seeded 6-search window must be visible in the recorded evidence.
		expect(String(r.evidence)).toMatch(/6 searches/);
		expect(r.metrics.logged).toBeGreaterThanOrEqual(1);
		expect(logs.length).toBeGreaterThanOrEqual(1);
		expect(logs[0].actor).toBe("worker:search-intel");
		expect(logs[0].action).toBe("search_quality_report");
	});
});

// ── #17 Knowledge ─────────────────────────────────────────────────
describe("#17 knowledge", () => {
	it("harvests a resolved case into the KB and proves it is searchable", async () => {
		const kbEntries: Table[] = [];
		const posts: Table[] = [
			{
				id: "kbpost",
				title: "Broken lift in Science building",
				description: "The lift is stuck between floors.",
				category: "Facilities",
				status: "resolved",
				admin_reply: "Replaced the lift motor and inspected the shaft",
				updated_at: daysAgo(1),
				created_at: daysAgo(2),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makeTable({ data: posts }),
				knowledge_base: () => makeKB({ entries: kbEntries }),
			}),
		);

		const r = await maintainKB();

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.harvested.length).toBe(1);
		expect(r.harvested[0].post_id).toBe("kbpost");
		expect(kbEntries.length).toBe(1);
		// The KB entry carries the resolution content from the real case.
		expect(kbEntries[0].source).toBe("resolved_case");
		expect(String(kbEntries[0].content)).toContain("Replaced the lift motor");
	});

	it("knowledge base stops being maintained (disable test)", async () => {
		// A resolved post without a claimed fix is not approved data — the
		// harvest stands down and never fabricates a KB entry.
		const kbEntries: Table[] = [];
		const posts: Table[] = [
			{
				id: "kbpost2",
				title: "Broken lift in Gymnasium",
				category: "Facilities",
				status: "resolved",
				admin_reply: null,
				created_at: daysAgo(2),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makeTable({ data: posts }),
				knowledge_base: () => makeKB({ entries: kbEntries }),
			}),
		);

		const r = await maintainKB();

		expect(r.ok).toBe(true);
		expect(r.harvested.length).toBe(0);
		expect(kbEntries.length).toBe(0);
	});
});

// ── #18 Admin Briefing ────────────────────────────────────────────
describe("#18 briefing", () => {
	it("stores a briefing built from real reads and verifies by re-read", async () => {
		const kv = new Map<string, any>();
		const now = new Date().toISOString();
		// Seed the real workforce ledger so the digest reads real outcomes.
		kv.set("workforce_actions_kv", {
			items: [
				{
					worker_id: "duplicate-case",
					outcome: "verified_success",
					decision: "act: logging 1 duplicate groups for review",
					completed_at: now,
				},
			],
		});
		const posts: Table[] = [
			{
				id: "fresh1",
				title: "Water leak in Science Lab",
				status: "reported",
				priority: "low",
				created_at: now,
				updated_at: now,
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makeTable({ data: posts }),
				activity_logs: () => makeTable({ data: [] }),
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await generateBriefing({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.briefing.posts.new_24h).toBe(1);
		expect(r.briefing.workforce.verified_successes).toBe(1);
		expect(r.briefing.workforce.top_workers[0].name).toBe("duplicate-case");
		// The briefing persisted to the canonical KV.
		expect(kv.get("briefing:latest")?.posts?.new_24h).toBe(1);
	});

	it("reads real alert and activity state into the digest", async () => {
		const kv = new Map<string, any>();
		kv.set("workforce_alerts", {
			alerts: [
				{
					key: "sla-breach:br1",
					severity: "high",
					title: "SLA breached: broken lift escalated to medium",
					agent: "sla-worker",
					created_at: new Date().toISOString(),
					occurrences: 1,
				},
			],
		});
		const logs: Table[] = [
			{
				id: "log_1",
				actor: "worker:duplicate-case",
				action: "duplicate_case",
				detail: "group_1",
				created_at: new Date().toISOString(),
			},
			{
				id: "log_2",
				actor: "worker:priority",
				action: "priority_triage",
				detail: "p1: low -> medium",
				created_at: new Date().toISOString(),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makeTable({ data: [] }),
				activity_logs: () => makeTable({ data: logs }),
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await generateBriefing({});

		expect(r.ok).toBe(true);
		expect(r.briefing.activity.total_24h).toBe(2);
		expect(r.briefing.activity.by_action.duplicate_case).toBe(1);
		expect(r.briefing.attention.unresolved_alerts).toBe(1);
		expect(r.briefing.attention.top[0].key).toBe("sla-breach:br1");
	});
});
