// Workforce Batch 4 (roster #19–#24, Polls, Community & Moderation) — disable tests.
//
// Each test proves one worker performs its REAL job against real tooling and
// that removing it would leave a gap:
//   #19 poll-create        engaged suggestions get a real poll via createPoll.
//   #20 poll-integrity     vote fraud (burst/bot) is quarantined + alerted.
//   #21 community-health   real participation signals are measured + stored.
//   #23 abuse              rapid-fire floods are quarantined via pending_review.
//   #24 upload-intel       bucket occupancy is measured + stored.
//
// #22 Content Moderation ships with the parallel moderation-gate slice and is
// not re-tested here.
//
// Harness: mirrors batch3 (mock DB client + storage + _auth.js + _error.js +
// the _workforce.js task-layer transitive deps); keep the real modules
// (_poll-create.js / _poll-integrity.js / _community-health.js / _abuse.js /
// _storage.js) and the real _artifact-filter.js + _moderation.js.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockFetch, mockQueueImprovement, mockCallLLMChain, mockStorage } =
	vi.hoisted(() => ({
		mockFrom: vi.fn(),
		mockFetch: vi.fn(),
		mockQueueImprovement: vi.fn(async () => true),
		mockCallLLMChain: vi.fn(async () => null),
		mockStorage: { from: () => ({ list: vi.fn(async () => []), upload: vi.fn(async () => ({ error: null })), getPublicUrl: vi.fn(() => ({ publicUrl: "https://x.test/img.png" })) }) },
	}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom, storage: mockStorage },
}));
vi.mock("../../api/_improvements.js", () => ({
	queueImprovement: mockQueueImprovement,
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => {}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	maskProfanity: (s: unknown) => String(s ?? ""),
	checkUser: vi.fn(async () => ({ ok: true })),
	ensureUser: vi.fn(async () => {}),
	rateLimitResponse: vi.fn(),
	rateLimited: vi.fn(async () => false),
	securityCheck: vi.fn(() => ({ ok: true })),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(async () => {}),
	emitEventAndBridge: vi.fn(async () => {}),
	EVENT_TYPES: {},
}));
vi.mock("../../api/_email.js", () => ({
	sendEmail: vi.fn(async () => ({})),
	sendPollClosedEmail: vi.fn(async () => {}),
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

import { runAbuseWatch } from "../../api/_abuse.js";
import { runCommunityHealth } from "../../api/_community-health.js";
import { runPollCreate } from "../../api/_poll-create.js";
import { checkPollIntegrity } from "../../api/_poll-integrity.js";
import { runUploadIntel } from "../../api/_storage.js";

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

/** Stateful polls table: inserts persist, maybeSingle re-reads by id. */
function makePolls(state: { polls: Table[] }): Table {
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
		lastInsert = { ...rec };
		state.polls.push(lastInsert);
		mode = "insert";
		return q;
	});
	q.then = (resolve: (v: unknown) => void) => {
		if (mode === "insert") {
			mode = "select";
			return Promise.resolve({ data: lastInsert ? [lastInsert] : [], error: null }).then(resolve);
		}
		return Promise.resolve({ data: state.polls.slice(), error: null }).then(resolve);
	};
	q.maybeSingle = vi.fn(async () => ({
		data: state.polls.find((p) => p.id === eqId) || null,
		error: null,
	}));
	q.single = vi.fn(async () => ({ data: lastInsert, error: null }));
	return q;
}

/** Stateful posts table with update-at-then (for #23's quarantine). */
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
			return Promise.resolve({ data, error: null }).then(resolve);
		}
		return Promise.resolve({ data: state.posts.slice(), error: null }).then(resolve);
	};
	q.maybeSingle = vi.fn(async () => ({
		data: eqId != null ? state.posts.find((p) => p.id === eqId) || null : null,
		error: null,
	}));
	q.single = q.maybeSingle;
	return q;
}

/** Stateful settings KV (alerts + reports): upsert persists, maybeSingle serves. */
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

const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString();

// ── #19 Poll Creation ─────────────────────────────────────────────
describe("#19 poll-create", () => {
	it("creates a real poll for an engaged suggestion via createPoll", async () => {
		const polls: Table[] = [];
		const posts: Table[] = [
			{
				id: "sug1",
				title: "Longer lunch breaks",
				description: "Students want longer lunch breaks.",
				category: "Suggestion",
				status: "reported",
				author_id: "anon_student1",
				created_at: minutesAgo(60),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				polls: () => makePolls({ polls }),
				comments: () => makeTable({ data: [{ post_id: "sug1" }, { post_id: "sug1" }] }),
			}),
		);

		const r = await runPollCreate();

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.created.length).toBe(1);
		expect(polls.length).toBe(1);
		// The real createPoll path: masked title, yesno options, linked post.
		expect(polls[0].title).toBe("Do you agree: Longer lunch breaks");
		expect(polls[0].ptype).toBe("yesno");
		expect(polls[0].options).toEqual(["Yes", "No"]);
		expect(polls[0].post_id).toBe("sug1");
	});

	it("auto poll lifecycle stops at creation (disable test)", async () => {
		// An already-polled suggestion pre-filters → no duplicate poll.
		const polls: Table[] = [{ id: "poll_x", post_id: "sug1", title: "Do you agree: Longer lunch breaks" }];
		const posts: Table[] = [
			{
				id: "sug1",
				title: "Longer lunch breaks",
				category: "Suggestion",
				status: "reported",
				author_id: "anon_student1",
				created_at: minutesAgo(60),
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				polls: () => makePolls({ polls }),
				comments: () => makeTable({ data: [{ post_id: "sug1" }, { post_id: "sug1" }] }),
			}),
		);

		const r = await runPollCreate();

		expect(r.ok).toBe(true);
		expect(r.created.length).toBe(0);
		expect(polls.length).toBe(1);
	});
});

// ── #20 Poll Intelligence ─────────────────────────────────────────
describe("#20 poll-integrity", () => {
	it("quarantines bot voting and records the fraud alert", async () => {
		const kv = new Map<string, any>();
		// One bot author voting 12 polls — 30s ago, safely inside both the
		// 60s burst window and the 5min bot window (minutesAgo(1) sat exactly
		// ON the 60s boundary and flaked with test-execution skew).
		const recent = new Date(Date.now() - 30 * 1000).toISOString();
		const votes: Table[] = Array.from({ length: 12 }, (_, i) => ({
			id: `v${i}`,
			poll_id: `p${i}`,
			author_id: "bot1",
			choices: [0],
			created_at: recent,
		}));
		const client = {
			from: router({
				poll_votes: () => makeTable({ data: votes }),
				settings: () => makeSettingsKV({ kv }),
			}),
		};

		const r = await checkPollIntegrity(client as any, Date.now());

		expect(r.ok).toBe(true);
		expect(r.quarantined).toBeGreaterThanOrEqual(1);
		const alerts = kv.get("workforce_alerts")?.alerts || [];
		expect(alerts.length).toBeGreaterThanOrEqual(1);
		// Newest-first feed (worker unshifts): order-independent assertion.
		expect(alerts.some((a: { key: string }) => a.key === "poll-fraud:p0")).toBe(true);
		expect(alerts.some((a: { key: string }) => a.key === "poll-fraud:p11")).toBe(true);
	});

	it("vote fraud stops being quarantined (disable test)", async () => {
		// Normal voting: few votes, distinct authors → no quarantine, no alert.
		const kv = new Map<string, any>();
		const votes: Table[] = [
			{ id: "v0", poll_id: "p0", author_id: "student1", choices: [0], created_at: minutesAgo(1) },
			{ id: "v1", poll_id: "p0", author_id: "student2", choices: [1], created_at: minutesAgo(2) },
		];
		const client = {
			from: router({
				poll_votes: () => makeTable({ data: votes }),
				settings: () => makeSettingsKV({ kv }),
			}),
		};

		const r = await checkPollIntegrity(client as any, Date.now());

		expect(r.ok).toBe(true);
		expect(r.quarantined).toBe(0);
		expect(kv.get("workforce_alerts")).toBeUndefined();
	});
});

// ── #21 Community Health ──────────────────────────────────────────
describe("#21 community-health", () => {
	it("measures real participation signals and stores the report", async () => {
		const kv = new Map<string, any>();
		const now = new Date().toISOString();
		const posts: Table[] = [
			{
				id: "post1",
				title: "Water leak in Science Lab",
				category: "Facilities",
				status: "reported",
				created_at: now,
			},
		];
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
				comments: () => makeTable({ data: [{ post_id: "post1" }] }),
				votes: () => makeTable({ data: [{ post_id: "post1" }] }),
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runCommunityHealth({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.report.posts.new_24h).toBe(1);
		expect(r.report.comments_24h).toBe(1);
		expect(r.report.votes_24h).toBe(1);
		expect(kv.get("community_health:latest")?.posts?.new_24h).toBe(1);
	});

	it("community health signals stop (disable test)", async () => {
		// No activity at all → honest zeros, no fabricated sections.
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				posts: () => makeTable({ data: [] }),
				comments: () => makeTable({ data: [] }),
				votes: () => makeTable({ data: [] }),
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runCommunityHealth({});

		expect(r.ok).toBe(true);
		expect(r.report.posts.new_24h).toBe(0);
		expect(kv.get("community_health:latest")?.comments_24h).toBe(0);
	});
});

// ── #23 Abuse Detection ───────────────────────────────────────────
describe("#23 abuse", () => {
	it("quarantines a rapid-fire flood via pending_review", async () => {
		const posts: Table[] = Array.from({ length: 6 }, (_, i) => ({
			id: `flood${i}`,
			title: `Spam message number ${i} from the same author flooding the queue`,
			author_id: "flooder1",
			status: "reported",
			created_at: minutesAgo(2 + i),
		}));
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
			}),
		);

		const r = await runAbuseWatch({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.quarantined.length).toBe(6);
		// The real quarantine status: the moderation queue owns the review.
		expect(posts[0].status).toBe("pending_review");
		expect(posts[5].status).toBe("pending_review");
	});

	it("spam/rapid-fire abuse stops being blocked (disable test)", async () => {
		// Posts spread over hours, not a burst → no quarantine.
		const posts: Table[] = Array.from({ length: 6 }, (_, i) => ({
			id: `calm${i}`,
			title: `Regular message number ${i} spread across the day`,
			author_id: "calm1",
			status: "reported",
			created_at: minutesAgo(60 + i * 30),
		}));
		mockFrom.mockImplementation(
			router({
				posts: () => makePosts({ posts }),
			}),
		);

		const r = await runAbuseWatch({});

		expect(r.ok).toBe(true);
		expect(r.quarantined.length).toBe(0);
		expect(posts[0].status).toBe("reported");
	});
});

// ── #24 Upload Intelligence ───────────────────────────────────────
describe("#24 upload-intel", () => {
	it("measures bucket occupancy and stores the report", async () => {
		const kv = new Map<string, any>();
		mockStorage.from = () => ({
			list: vi.fn(async () => ({
				data: [
					{ name: "img_a.png", created_at: new Date(Date.now() - 3600 * 1000).toISOString() },
					{ name: "img_b.jpg", created_at: new Date(Date.now() - 7200 * 1000).toISOString() },
				],
				error: null,
			})),
		});
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
			}),
		);

		const r = await runUploadIntel({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.buckets["chat-media"]?.objects).toBe(2);
		expect(r.buckets["chat-media"]?.oldest_age_days).toBe(0);
		expect(kv.get("upload_intel:latest")?.buckets?.["chat-media"]?.objects).toBe(2);
	});

	it("unsafe uploads stop being scanned/reclaimed (disable test)", async () => {
		// All buckets unreachable → honest failure, no fabricated report.
		mockStorage.from = () => {
			throw new Error("storage down");
		};
		mockFrom.mockImplementation(router({}));

		const r = await runUploadIntel({});

		expect(r.ok).toBe(false);
		expect(r.error).toBe("all storage buckets unreachable");
	});
});
