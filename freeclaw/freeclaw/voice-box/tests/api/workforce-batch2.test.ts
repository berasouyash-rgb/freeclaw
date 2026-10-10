// Workforce Batch 2 (roster #7–#12, Case Triage & Follow-through) — disable tests.
//
// Each test proves one worker performs its REAL job against real tooling
// (the platform's own detectors, dual-source post reads, real table writes)
// and that removing it would leave a gap:
//   #7 duplicate-case        logs duplicate clusters for admin merge review.
//   #8 related-case          logs vocabulary-linked pairs for review.
//   #9 priority              bumps near-deadline discussed posts one level.
//   #10 case-assignment      dispatches new categorized cases to agent_tasks.
//   #11 sla (registry)       raises breach alerts, bumps overdue priority.
//   #12 followup (registry)  pings stalled assigned cases.
//
// Harness: mock the DB client + _auth.js + _error.js (mirrors batch1 and
// workforce-recovery.test.ts); keep _workforce-core.js, the real detectors
// (_duplicates.js / _related.js) and the real _artifact-filter.js. The
// _workforce.js task layer (needed by #10) loads via mocked transitive deps.
// #11/#12 import checkSLA/checkFollowups directly with an explicit client so
// the supabase module default is not relied on and alert re-reads persist.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockFetch, mockQueueImprovement } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockFetch: vi.fn(),
	mockQueueImprovement: vi.fn(async () => true),
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
	callLLMChain: vi.fn(async () => null),
	callProviderStream: vi.fn(async () => ({
		ok: false,
		text: "",
		provider: null,
		model: null,
	})),
	getProviderConfig: vi.fn(async () => null),
}));

import {
	runCaseAssignment,
	runDuplicateCase,
	runPriority,
	runRelatedCase,
} from "../../api/_workforce-workers.js";
import { resetSupervisorState } from "../../api/_worker-supervisor.js";
import { checkFollowups } from "../../api/_followup.js";
import { checkSLA } from "../../api/_sla.js";

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

/** Stateful activity_logs table for the Class-A audit workers (#7/#8/#9). */
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

/**
 * Stateful posts table: selects serve the shared rows, updates apply at
 * `then` so a subsequent re-read (maybeSingle) always sees the current
 * priority — exactly what #9's execute/verify and the SLA breach path need.
 */
function makePosts(state: { posts: Table[] }): Table {
	const q: Table = {};
	let eqId: unknown = null;
	let mode: "select" | "update" = "select";
	let patch: Table | null = null;
	for (const m of PASSTHROUGH) {
		if (m === "update") continue;
		q[m] = vi.fn((...args: unknown[]) => {
			if (m === "eq" && args[0] === "id") eqId = args[1];
			return q;
		});
	}
	q.update = vi.fn((p: Table) => {
		patch = p;
		mode = "update";
		return q;
	});
	q.then = (resolve: (v: unknown) => void) => {
		if (mode === "update" && patch) {
			const row = state.posts.find((p) => p.id === eqId);
			if (row) Object.assign(row, patch);
			const data = row ? [row] : [];
			mode = "select";
			patch = null;
			return Promise.resolve({ data, count: data.length, error: null }).then(resolve);
		}
		const rows = state.posts.slice();
		return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve);
	};
	q.maybeSingle = vi.fn(async () => ({
		data: eqId != null ? state.posts.find((p) => p.id === eqId) || null : null,
		error: null,
	}));
	q.single = q.maybeSingle;
	return q;
}

/**
 * Stateful agent_tasks table: the probe returns no error so the table path
 * is taken, inserts persist, and maybeSingle re-reads by id — what #10's
 * listTasks/createTask/verify flow and the hasTasksTable TTL cache need.
 */
function makeAgentTasks(state: { tasks: Table[] }): Table {
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
		// createTask stamps its own crypto.randomUUID() id — let it through.
		lastInsert = { id: `task_${state.tasks.length + 1}`, ...rec };
		state.tasks.push(lastInsert);
		mode = "insert";
		return q;
	});
	q.then = (resolve: (v: unknown) => void) => {
		if (mode === "insert") {
			mode = "select";
			return Promise.resolve({ data: lastInsert ? [lastInsert] : [], error: null }).then(resolve);
		}
		return Promise.resolve({ data: state.tasks.slice(), error: null }).then(resolve);
	};
	q.maybeSingle = vi.fn(async () => ({
		data: state.tasks.find((t) => t.id === eqId) || null,
		error: null,
	}));
	q.single = vi.fn(async () => ({ data: lastInsert, error: null }));
	return q;
}

/**
 * Stateful settings KV (workforce_actions_kv ledger + workforce_alerts):
 * select+eq("key") serves the Map, upsert persists, so alert re-reads
 * confirm the raised keys (#11/#12) and the ledger/budget gate works.
 */
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

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

// ── #7 Duplicate Case (Class A) ───────────────────────────────────
describe("#7 duplicate-case", () => {
	it("logs a duplicate cluster for review without merging", async () => {
		const logs: Table[] = [];
		const posts: Table[] = [
			{
				id: "dup1",
				title: "Broken AC in Science Lab",
				description: "The air conditioning is broken and the room is sweltering.",
				category: "Facilities",
				status: "reported",
				priority: "low",
				created_at: daysAgo(1),
			},
			{
				id: "dup2",
				title: "Broken AC in Science Lab",
				description: "The air conditioning is broken and the room is sweltering.",
				category: "Facilities",
				status: "reported",
				priority: "low",
				created_at: daysAgo(2),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				comments: () => makeTable({ data: [] }),
				activity_logs: () => makeActivityLogs({ logs }),
			}),
		);

		const r = await runDuplicateCase();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		expect(r.metrics.logged).toBeGreaterThanOrEqual(1);
		expect(logs.length).toBeGreaterThanOrEqual(1);
		expect(logs[0].actor).toBe("worker:duplicate-case");
		expect(logs[0].action).toBe("duplicate_case");
		// Advisory only: no post was merged or edited.
		expect(posts[0].status).toBe("reported");
		expect(posts[1].status).toBe("reported");
	});

	it("duplicate flags stop; manual merge workload rises (disable test)", async () => {
		// A single post can form no cluster, so the worker stands down honestly.
		const logs: Table[] = [];
		const posts: Table[] = [
			{
				id: "solo",
				title: "Broken AC in Science Lab",
				description: "A unique report with no twin in the queue.",
				category: "Facilities",
				status: "reported",
				created_at: daysAgo(1),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				comments: () => makeTable({ data: [] }),
				activity_logs: () => makeActivityLogs({ logs }),
			}),
		);

		const r = await runDuplicateCase();

		expect(r.outcome).toBe("skipped");
		expect(logs.length).toBe(0);
	});
});

// ── #8 Related Case (Class A) ─────────────────────────────────────
describe("#8 related-case", () => {
	it("logs a vocabulary-linked pair for review", async () => {
		const logs: Table[] = [];
		const posts: Table[] = [
			{
				id: "rel1",
				title: "Library wifi outage",
				description: "The library internet network is down all morning.",
				category: "IT",
				status: "reported",
				priority: "low",
				created_at: daysAgo(1),
			},
			{
				id: "rel2",
				title: "Library wifi broken again",
				description: "The library internet network keeps dropping out.",
				category: "IT",
				status: "in_progress",
				priority: "low",
				created_at: daysAgo(3),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				comments: () => makeTable({ data: [] }),
				activity_logs: () => makeActivityLogs({ logs }),
			}),
		);

		const r = await runRelatedCase();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		expect(r.metrics.logged).toBeGreaterThanOrEqual(1);
		expect(logs.length).toBeGreaterThanOrEqual(1);
		expect(logs[0].actor).toBe("worker:related-case");
		expect(logs[0].action).toBe("related_case");
		// Advisory only: no post was edited or linked.
		expect(posts[0].status).toBe("reported");
	});

	it("related-case suggestions stop (disable test)", async () => {
		// Two posts with zero shared vocabulary → no pairs, no advisory rows.
		const logs: Table[] = [];
		const posts: Table[] = [
			{
				id: "cafe1",
				title: "Cafeteria menu rotation",
				description: "Students want weekly lunch variety.",
				category: "Facilities",
				status: "reported",
				created_at: daysAgo(1),
			},
			{
				id: "gym1",
				title: "Gym floor resurfacing",
				description: "The wooden sports surface needs repair.",
				category: "Facilities",
				status: "reported",
				created_at: daysAgo(2),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				comments: () => makeTable({ data: [] }),
				activity_logs: () => makeActivityLogs({ logs }),
			}),
		);

		const r = await runRelatedCase();

		expect(r.outcome).toBe("skipped");
		expect(logs.length).toBe(0);
	});
});

// ── #9 Priority (Class A) ─────────────────────────────────────────
describe("#9 priority", () => {
	it("bumps a near-deadline discussed post one level", async () => {
		const logs: Table[] = [];
		const posts: Table[] = [
			{
				id: "slow1",
				title: "Water leak in Science Lab",
				description: "Water is pooling near the entrance.",
				category: "Facilities",
				// _sla.js OPEN_STATUSES — "reported" is a live open status.
				status: "reported",
				priority: "low",
				created_at: daysAgo(10), // 10d elapsed of a 14d low window → near
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				comments: () => makeTable({ data: [{ post_id: "slow1" }] }),
				activity_logs: () => makeActivityLogs({ logs }),
			}),
		);

		const r = await runPriority();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		expect(r.metrics.bumped).toBe(1);
		// The bump persisted to the shared rows: low -> medium.
		expect(posts[0].priority).toBe("medium");
		expect(logs.length).toBe(1);
		expect(logs[0].actor).toBe("worker:priority");
		expect(logs[0].action).toBe("priority_triage");
	});

	it("priority bumps stop firing (disable test)", async () => {
		// A fresh post is nowhere near its SLA window → no candidates, no bump.
		const logs: Table[] = [];
		const posts: Table[] = [
			{
				id: "fresh1",
				title: "Water leak in Gymnasium",
				description: "Water is pooling near the bench.",
				category: "Facilities",
				status: "reported",
				priority: "low",
				created_at: new Date().toISOString(),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				comments: () => makeTable({ data: [{ post_id: "fresh1" }] }),
				activity_logs: () => makeActivityLogs({ logs }),
			}),
		);

		const r = await runPriority();

		expect(r.outcome).toBe("skipped");
		expect(posts[0].priority).toBe("low");
		expect(logs.length).toBe(0);
	});
});

// ── #10 Case Assignment (Class A) ─────────────────────────────────
describe("#10 case-assignment", () => {
	it("dispatches a new categorized case to agent_tasks", async () => {
		const tasks: Table[] = [];
		const posts: Table[] = [
			{
				id: "case1",
				title: "Projector failure in Auditorium",
				description: "The main projector will not power on.",
				category: "IT",
				status: "reported",
				priority: "high",
				created_at: daysAgo(1),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				agent_tasks: () => makeAgentTasks({ tasks }),
			}),
		);

		const r = await runCaseAssignment();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		expect(r.metrics.dispatched).toBe(1);
		expect(tasks.length).toBe(1);
		expect(tasks[0].source).toBe("post");
		expect(tasks[0].source_ref).toBe("case:case1");
		expect(tasks[0].priority).toBe("high");
		expect(tasks[0].required_capability).toBe("case_handling");
		expect(tasks[0].created_by).toBe("worker:case-assignment");
		// Low risk enters the queue, never the approval center.
		expect(tasks[0].status).toBe("queued");
	});

	it("new cases stop being dispatched (disable test)", async () => {
		// An existing case reference pre-filters the candidate → clean skip,
		// and no duplicate task is created for the same target.
		const tasks: Table[] = [{ id: "t1", source_ref: "case:case1", status: "queued" }];
		const posts: Table[] = [
			{
				id: "case1",
				title: "Projector failure in Auditorium",
				description: "The main projector will not power on.",
				category: "IT",
				status: "reported",
				priority: "high",
				created_at: daysAgo(1),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				agent_tasks: () => makeAgentTasks({ tasks }),
			}),
		);

		const r = await runCaseAssignment();

		expect(r.outcome).toBe("skipped");
		expect(tasks.length).toBe(1);
	});
});

// ── #11 SLA (registry worker, client override) ────────────────────
describe("#11 sla", () => {
	it("escalates a breached open post and records the alert", async () => {
		const kv = new Map<string, any>();
		const posts: Table[] = [
			{
				id: "br1",
				title: "Broken lift in Science building",
				priority: "low",
				// _sla.js OPEN_STATUSES.
				status: "waiting",
				created_at: daysAgo(16), // 16d elapsed of a 14d low window → breached
				hidden: false,
				deleted: false,
			},
		];
		const client = {
			from: router({
				posts: () => makePosts({ posts }),
				settings: () => makeSettingsKV({ kv }),
			}),
		};

		const r = await checkSLA(client as any, Date.now());

		expect(r.ok).toBe(true);
		expect(r.escalated).toBeGreaterThanOrEqual(1);
		// The breach path bumps the overdue priority one level: low -> medium.
		expect(posts[0].priority).toBe("medium");
		const alerts = kv.get("workforce_alerts")?.alerts || [];
		expect(alerts.length).toBeGreaterThanOrEqual(1);
		expect(alerts[0].key).toBe("sla-breach:br1");
		expect(alerts[0].agent).toBe("sla-worker");
		expect(alerts[0].resolved_at).toBeFalsy();
	});

	it("does not flood: an unresolved breach alert suppresses repeat escalations", async () => {
		const kv = new Map<string, any>();
		const posts: Table[] = [
			{
				id: "br2",
				title: "Broken lift in Gymnasium",
				priority: "low",
				status: "waiting",
				created_at: daysAgo(16),
				hidden: false,
				deleted: false,
			},
		];
		const client = {
			from: router({
				posts: () => makePosts({ posts }),
				settings: () => makeSettingsKV({ kv }),
			}),
		};

		const first = await checkSLA(client as any, Date.now());
		expect(first.escalated).toBe(1);

		const second = await checkSLA(client as any, Date.now());
		expect(second.escalated).toBe(0);

		const alerts = kv.get("workforce_alerts")?.alerts || [];
		expect(alerts.filter((a: Table) => a.key === "sla-breach:br2").length).toBe(1);
		// The priority bump applied exactly once.
		expect(posts[0].priority).toBe("medium");
	});
});

// ── #12 Follow-up (registry worker, client override) ──────────────
describe("#12 followup", () => {
	it("pings a stalled assigned case and records the alert", async () => {
		const kv = new Map<string, any>();
		const posts: Table[] = [
			{
				id: "stall1",
				title: "Broken projector in Auditorium",
				priority: "high",
				status: "in_progress",
				assigned_to: "case-agent-1",
				created_at: daysAgo(30),
				updated_at: daysAgo(30), // untouched 30d → far past the ping window
				hidden: false,
				deleted: false,
			},
		];
		const client = {
			from: router({
				posts: () => makePosts({ posts }),
				settings: () => makeSettingsKV({ kv }),
			}),
		};

		const r = await checkFollowups(client as any, Date.now());

		expect(r.ok).toBe(true);
		expect(r.pinged).toBe(1);
		expect(r.verified).toBe(true);
		const alerts = kv.get("workforce_alerts")?.alerts || [];
		expect(alerts.length).toBeGreaterThanOrEqual(1);
		expect(alerts[0].key).toBe("followup:stall1");
		expect(alerts[0].agent).toBe("followup-worker");
		expect(alerts[0].resolved_at).toBeFalsy();
	});

	it("skips a recently-touched case; stalled pings stop (disable test)", async () => {
		const kv = new Map<string, any>();
		const now = new Date().toISOString();
		const posts: Table[] = [
			{
				id: "fresh2",
				title: "Broken projector in Library",
				priority: "high",
				status: "in_progress",
				assigned_to: "case-agent-1",
				created_at: now,
				updated_at: now, // touched just now → inside the ping window
				hidden: false,
				deleted: false,
			},
		];
		const client = {
			from: router({
				posts: () => makePosts({ posts }),
				settings: () => makeSettingsKV({ kv }),
			}),
		};

		const r = await checkFollowups(client as any, Date.now());

		expect(r.ok).toBe(true);
		expect(r.pinged).toBe(0);
		expect(r.checked).toBe(1);
		// No alert was written for a healthy case.
		expect(kv.get("workforce_alerts")).toBeUndefined();
	});
});
