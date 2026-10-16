// Workforce Batch 1 (roster #1–#6, Intake & Understanding) — disable tests.
//
// Each test proves one worker performs its REAL job against real tooling
// (HTTP tool or table write) and that removing it would leave a gap:
//   #1 voice-intake            healthy probe stands down; a 503 escalates.
//   #2 submission-understanding writes posts.ai_summary via the real tool.
//   #3 missing-info            stale AI resolutions escalate for follow-up.
//   #4 category-assignment     writes posts.category from the taxonomy.
//   #5 category-correction     audits "Other" misfiles WITHOUT editing posts.
//   #6 suggestion-detection    runs the real proactive detector.
//
// Harness: mock the DB client, the improvement queue and _auth.js (mirrors
// workforce-automation.test.ts); keep _workforce-core.js and, for #6, the
// real _proactive.js. HTTP tools are served by a stubbed global fetch.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockQueueImprovement, mockFetch } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockQueueImprovement: vi.fn(async () => true),
	mockFetch: vi.fn(),
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

import {
	runCategoryAssignment,
	runCategoryCorrection,
	runMissingInfo,
	runSubmissionUnderstanding,
	runSuggestionDetection,
	runVoiceIntake,
} from "../../api/_workforce-workers.js";
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

/** Stateful activity_logs table for the Class-B audit worker (#5). */
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
		return Promise.resolve({ data, error: null }).then(resolve);
	};
	q.maybeSingle = vi.fn(async () => ({
		data: state.logs.find((l) => l.id === eqId) || null,
		error: null,
	}));
	q.single = q.maybeSingle;
	return q;
}

/** Route a table name to a fresh chain (fresh per .from() call). */
function router(tables: Record<string, () => Table>) {
	return (table: string) => (tables[table] ? tables[table]() : makeTable({}));
}

function lastBody(): Table {
	const call = mockFetch.mock.calls.at(-1);
	return JSON.parse(String(call?.[1]?.body || "{}"));
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

// ── #1 Voice-to-Case Intake (Class C) ─────────────────────────────
describe("#1 voice-intake", () => {
	it("stands down when the voice intake answers healthy", async () => {
		mockFetch.mockResolvedValue({
			status: 200,
			json: async () => ({ engine: "none" }),
		});

		const r = await runVoiceIntake();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("skipped");
		expect(mockFetch.mock.calls[0][0]).toContain("/api/assist?action=voice_complaint");
		expect(mockQueueImprovement).not.toHaveBeenCalled();
	});

	it("escalates to the queue when the voice intake is degraded", async () => {
		mockFetch.mockResolvedValue({ status: 503, json: async () => ({}) });

		const r = await runVoiceIntake();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("escalated");
		expect(mockQueueImprovement).toHaveBeenCalledTimes(1);
		expect(mockQueueImprovement.mock.calls[0][0]).toMatchObject({
			category: "infrastructure",
		});
	});
});

// ── #2 Submission Understanding (Class A) ─────────────────────────
describe("#2 submission-understanding", () => {
	it("stores a summary for an unsummarized post via the real tool", async () => {
		mockFrom.mockImplementation(
			router({
				posts: () =>
					makeTable({
						data: [
							{
								id: "p1",
								title: "Broken AC",
								description: "The air conditioning in Block B is broken.",
								category: "Facilities",
								ai_summary: "",
							},
						],
						maybeSingle: { ai_summary: "A stored summary" },
					}),
			}),
		);
		mockFetch.mockResolvedValue({
			status: 200,
			json: async () => ({ summary: "Broken AC in Block B", category_suggestion: "Facilities" }),
		});

		const r = await runSubmissionUnderstanding();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		expect(r.metrics.affected).toBe(1);
		expect(mockFetch.mock.calls[0][0]).toContain("/api/ai-summary");
		expect(lastBody().post_id).toBe("p1");
	});
});

// ── #3 Missing Information (Class C) ──────────────────────────────
describe("#3 missing-info", () => {
	it("escalates AI-resolved complaints that are still open past the window", async () => {
		const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
		mockFrom.mockImplementation(
			router({
				settings: () =>
					makeTable({
						data: [
							{
								key: "ai_resolution:p9",
								value: { analyzed_at: old },
								updated_at: old,
							},
						],
						maybeSingle: null,
					}),
				posts: () =>
					makeTable({
						data: [{ id: "p9", status: "open", title: "Broken fan" }],
					}),
			}),
		);

		const r = await runMissingInfo();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("escalated");
		expect(mockQueueImprovement).toHaveBeenCalledTimes(1);
		expect(mockQueueImprovement.mock.calls[0][0]).toMatchObject({ category: "follow-up" });
	});
});

// ── #4 Category Assignment (Class A) ──────────────────────────────
describe("#4 category-assignment", () => {
	it("assigns a real taxonomy category to an uncategorized post", async () => {
		mockFrom.mockImplementation(
			router({
				posts: () =>
					makeTable({
						data: [
							{
								id: "p2",
								title: "WiFi down in library",
								description: "The internet and wifi are not working.",
								category: "Other",
							},
						],
						maybeSingle: { category: "Technology" },
					}),
			}),
		);
		mockFetch.mockResolvedValue({
			status: 200,
			json: async () => ({ category_suggestion: "Technology" }),
		});

		const r = await runCategoryAssignment();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		expect(r.metrics.assigned).toBe(1);
		expect(mockFetch.mock.calls[0][0]).toContain("/api/ai-summary");
		// The suggestion probe must be side-effect-free: no post_id.
		expect(lastBody().post_id).toBeUndefined();
	});
});

// ── #5 Category Correction (Class B) ──────────────────────────────
describe("#5 category-correction", () => {
	it("audits a misfiled Other post without editing it", async () => {
		const state = { logs: [] as Table[] };
		const postsUpdate = vi.fn(() => makeTable({}));
		mockFrom.mockImplementation(
			router({
				posts: () => {
					const t = makeTable({
						data: [
							{
								id: "p3",
								title: "WiFi and network down",
								description: "The internet and computer lab network are broken.",
								category: "Other",
							},
						],
					});
					t.update = postsUpdate;
					return t;
				},
				activity_logs: () => makeActivityLogs(state),
			}),
		);

		const r = await runCategoryCorrection();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		expect(r.metrics.logged).toBe(1);
		expect(state.logs).toHaveLength(1);
		expect(state.logs[0].suggested).toBeUndefined(); // detail is JSON-encoded
		expect(String(state.logs[0].detail)).toContain("Technology");
		expect(postsUpdate).not.toHaveBeenCalled();
		expect(mockQueueImprovement).not.toHaveBeenCalled();
	});
});

// ── #6 Suggestion Detection (Class A) ─────────────────────────────
describe("#6 suggestion-detection", () => {
	it("runs the real proactive detector over the open queue", async () => {
		mockFrom.mockImplementation(
			router({
				reports: () =>
					makeTable({
						data: [
							{
								id: "r1",
								reason: "noise complaint",
								status: "pending",
								created_at: new Date().toISOString(),
								post_id: null,
							},
						],
					}),
				posts: () => makeTable({ data: [] }),
				agent_suggestions: () => makeTable({ data: [] }),
				activity_logs: () => makeTable({ data: [] }),
			}),
		);

		const r = await runSuggestionDetection();

		expect(r.ok).toBe(true);
		expect(r.outcome).toBe("verified_success");
		expect(r.metrics.detected).toBeGreaterThanOrEqual(1);
		expect(r.action_type).toBe("suggestion_detection");
	});
});
