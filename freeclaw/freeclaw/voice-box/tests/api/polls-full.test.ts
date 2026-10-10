// ═══════════════════════════════════════════════════════════════════
// Polls API — full CRUD + branch coverage
// ═══════════════════════════════════════════════════════════════════
// Complements polls-filter.test.ts (artifact filter) and poll-close.test.ts
// (close notifications) with: GET shapes (voter, id, post_id, admin view,
// side-effect-free reads, masking) and the POST vote / POST create / PUT / DELETE
// surface (auth gate, rate limit, validation, moderation, ownership,
// ADMIN-spoof protection, admin patches, hard delete).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	polls: [] as unknown[],
	poll_votes: [] as unknown[],
	posts: [] as unknown[],
	singleRow: null as unknown,
	existingVote: null as unknown,
	lastInsert: null as unknown,
	lastUpdate: null as unknown,
	// Every update() with its target table. `lastUpdate` alone cannot tell a
	// poll_votes write apart from the liveness touch on the parent poll row
	// (which also calls update() on "polls"), so a vote assertion has to
	// name the table it expected.
	updateCalls: [] as Array<{ table: string; patch: unknown }>,
	// Error-injection switches for the vote write-failure regression tests.
	probeError: null as unknown,
	writeError: null as unknown,
	resultsError: null as unknown,
	// Simulates the PostgREST max-rows page (1000): uncapped plain selects
	// return at most the first page, ranged selects return the slice. Lets
	// scale tests prove pagination instead of silent truncation.
	enforceCap: false as boolean,
	// Race drivers for the concurrent-first-vote (23505) branch. Every
	// `poll_votes .select("id").maybeSingle()` probe consumes `probeSeq`
	// first and every insert consumes `insertErrorSeq` first, falling back to
	// `existingVote` / `writeError` once the queue is empty — so a test can
	// script "initial probe misses → insert loses the race → winner probe
	// sees the winner" while every pre-existing test keeps its single-value
	// behaviour. `null` in `insertErrorSeq` means "this insert succeeds".
	probeSeq: [] as unknown[],
	insertErrorSeq: [] as Array<Error | null>,
	// Every insert() payload, in order. Without it a test cannot tell
	// "recovery went through the winner's UPDATE" from "recovery retried the
	// INSERT" — both end at 200, so the attempt count is the only witness.
	insertCalls: [] as unknown[],
	// Fails ONLY the polls-table update (the realtime liveness touch), so a
	// test can break the vote signal without breaking the ballot write
	// itself — `writeError` would take down both and prove nothing.
	touchError: null as unknown,
	// Makes the touch update REJECT (transport failure) instead of resolving
	// {error} — the only way to reach the catch around the liveness touch.
	touchReject: null as unknown,
	// Per-table delete failures + call log for the DELETE regression
	// contracts (loud failure, wipe ordering).
	deleteErrors: {} as Record<string, Error | undefined>,
	deleteCalls: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
};

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

const authMocks = {
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	auditLog: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
	// Default-allow session gate (feature tests exercise behavior, not
	// auth; the impersonation tests below override with denial).
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: "" })),
};

vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({
		blocked: false,
		requiresReview: false,
		flags: [],
	})),
}));

// Route verdicts come from the unified safety pipeline: mock the seam
// (default ALLOW) and override per test.
const pipelineMocks = vi.hoisted(() => ({
	evaluateContent: vi.fn(() => ({
		action: "ALLOW",
		classification: "clean",
		confidence: "high",
		policy: null,
		reasons: [],
		trace: [],
		flags: [],
		language: "en",
		blocked: false,
		needsReview: false,
	})),
	messageFor: vi.fn((_surface: string, code: string) => `${code} message`),
	evaluateContentDeep: vi.fn(async (...args: unknown[]) => (pipelineMocks.evaluateContent as (...a: unknown[]) => unknown)(...args)),
}));
vi.mock("../../api/_safety-pipeline.js", () => pipelineMocks);

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

interface Chain {
	op: string;
	selCol: string;
	rangeFrom: number | null;
	rangeTo: number | null;
	select: (col?: unknown, opts?: unknown) => Chain;
	eq: (col?: unknown, val?: unknown) => Chain;
	in: (col?: unknown, values?: unknown) => Chain;
	order: () => Chain;
	limit: () => Chain;
	range: (from: number, to: number) => Chain;
	maybeSingle: () => Chain;
	single: () => Chain;
	update: (patch: unknown) => Chain;
	insert: (row: unknown) => Chain;
	delete: () => Chain;
	then: (fn: (v: unknown) => void) => void;
}

function chainFor(table: string): Chain {
	const chain = {
		op: "select",
		selCol: "",
		rangeFrom: null as number | null,
		rangeTo: null as number | null,
		filters: [] as Array<[string, unknown]>,
		inFilters: [] as Array<[string, unknown[]]>,
		select(col?: unknown) {
			this.selCol = String(col ?? "");
			return this;
		},
		eq(col?: unknown, val?: unknown) {
			if (typeof col === "string") this.filters.push([col, val]);
			return this;
		},
		in(col?: unknown, values?: unknown) {
			if (typeof col === "string" && Array.isArray(values)) {
				this.inFilters.push([col, values]);
			}
			return this;
		},
		order() {
			return this;
		},
		limit() {
			return this;
		},
		range(from: number, to: number) {
			this.rangeFrom = from;
			this.rangeTo = to;
			return this;
		},
		maybeSingle() {
			this.op = "maybeSingle";
			return this;
		},
		single() {
			return this;
		},
		update(patch: unknown) {
			this.op = "update";
			state.lastUpdate = patch;
			state.updateCalls.push({ table, patch });
			return this;
		},
		insert(row: unknown) {
			this.op = "insert";
			state.lastInsert = row;
			state.insertCalls.push(row);
			return this;
		},
		delete() {
			this.op = "delete";
			return this;
		},
		then(fn: (v: unknown) => void) {
			if (this.op === "insert") {
				// Race scripts override the blanket `writeError` per insert, so a
				// test can fail ONLY the first insert with a duplicate key and
				// let the recovery insert succeed.
				const insertErr =
					state.insertErrorSeq.length > 0
						? state.insertErrorSeq.shift()
						: state.writeError;
				if (insertErr) {
					fn({ data: null, error: insertErr });
					return;
				}
				fn({ data: state.lastInsert, error: null });
				return;
			}
			if (this.op === "update") {
				// Transport failure: reject so the touch's catch (not just its
				// {error} branch) is exercised.
				if (table === "polls" && state.touchReject) throw state.touchReject;
				const err =
					table === "polls" && state.touchError
						? state.touchError
						: state.writeError;
				if (err) {
					fn({ data: null, error: err });
					return;
				}
				fn({ data: state.lastUpdate, error: null });
				return;
			}
			if (this.op === "maybeSingle") {
				// The vote-existence probe selects only `id` from poll_votes. The
				// race branch probes a SECOND time (winner lookup) with an
				// identical signature, so both probes consume `probeSeq` in call
				// order: [firstMiss, winnerRow]. Empty queue => `existingVote`.
				if (table === "poll_votes" && this.selCol === "id") {
					if (state.probeError) {
						fn({ data: null, error: state.probeError });
						return;
					}
					const v =
						state.probeSeq.length > 0
							? state.probeSeq.shift()
							: state.existingVote;
					// A queued Error fails ONLY that probe — lets a test fail the
					// winner re-probe while the first probe still misses.
					if (v instanceof Error) {
						fn({ data: null, error: v });
						return;
					}
					fn({ data: v, error: null });
					return;
				}
				fn({ data: state.singleRow, error: null });
				return;
			}
			if (this.op === "delete") {
				// Record every delete so tests can assert wipe ORDERING (votes
				// must not be erased before the parent row is proven gone).
				state.deleteCalls.push({
					table,
					filters: [...this.filters],
				});
				const delErr = state.deleteErrors[table];
				if (delErr) {
					fn({ data: null, error: delErr });
					return;
				}
				// Simulate PostgREST delete().select(): honor eq() filters so a
				// delete resolves the rows it removed — the handler proves the
				// delete landed (0 rows => 404). Rows are NOT mutated, matching
				// the posts mock (keeps seeded fixtures stable across tests).
				const rows =
					table === "polls"
						? state.polls
						: table === "poll_votes"
							? state.poll_votes
							: state.posts;
				const matched = rows.filter((r) =>
					this.filters.every(
						([col, val]) => (r as Record<string, unknown>)?.[col] === val,
					),
				);
				fn({ data: matched, error: null });
				return;
			}
			// Post-write results read (attachResults strict) — select('poll_id,choices').
			if (
				this.op === "select" &&
				table === "poll_votes" &&
				this.selCol === "poll_id,choices" &&
				state.resultsError
			) {
				fn({ data: null, error: state.resultsError });
				return;
			}
			const rows =
				table === "polls"
					? state.polls
					: table === "poll_votes"
						? state.poll_votes
						: state.posts;
			const filteredRows = rows.filter((row) => {
				const record = row as Record<string, unknown>;
				return (
					this.filters.every(([key, value]) => record[key] === value) &&
					this.inFilters.every(([key, values]) => values.includes(record[key] as never))
				);
			});
			// Server pagination faithfulness: ranged reads slice, uncapped
			// reads stop at max-rows when the cap is enforced. All
			// pre-existing fixtures are far below the page, so this is a
			// no-op for them.
			let out = filteredRows;
			if (this.rangeFrom !== null && this.rangeTo !== null)
				out = out.slice(this.rangeFrom, this.rangeTo + 1);
			else if (state.enforceCap) out = out.slice(0, 1000);
			fn({ data: out, error: null });
		},
	};
	return chain;
}

function makePoll(over: Record<string, unknown> = {}) {
	return {
		id: "poll-1",
		title: "Should we prioritize lab repairs?",
		ptype: "yesno",
		options: ["Yes", "No"],
		post_id: null,
		author_id: "anon-2",
		expires_at: null,
		deleted: false,
		archived: false,
		// Migration 018 adds polls.hidden. Public listings filter on it, so a
		// fixture without the column would (correctly) be filtered out.
		hidden: false,
		created_at: "2026-07-15T00:00:00Z",
		...over,
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	Object.assign(state, {
		polls: [],
		poll_votes: [],
		posts: [],
		singleRow: null,
		updateCalls: [],
		existingVote: null,
		lastInsert: null,
		lastUpdate: null,
		probeError: null,
		writeError: null,
		resultsError: null,
		probeSeq: [],
		insertErrorSeq: [],
		insertCalls: [],
		touchError: null,
		touchReject: null,
		enforceCap: false,
		deleteErrors: {},
		deleteCalls: [],
	});
	from.mockImplementation((table: string) => chainFor(table));
	// Drain any leaked one-shot gate denial so a broken gate fails its own
	// test instead of poisoning the next test's session check.
	authMocks.verifyCallerIdentity.mockReset();
	authMocks.verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "" });
});

describe("GET /api/polls", () => {
	it("returns the voter poll_votes rows when ?voter= is set", async () => {
		state.poll_votes = [
			{ poll_id: "poll-1", choices: [0], author_id: "anon-2" },
			{ poll_id: "poll-2", choices: [1, 2], author_id: "anon-2" },
		];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{ method: "GET", query: { voter: "anon-2" }, body: {}, headers: { "x-anon-id": "anon-1" } },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual(state.poll_votes);
	});

	it("does not archive stale polls during a public GET", async () => {
		state.polls = [
			makePoll({
				id: "poll-stale",
				expires_at: "2020-01-01T00:00:00.000Z",
				archived: false,
			}),
		];
		state.poll_votes = [];
		state.posts = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toBeNull();
		expect(state.polls[0]?.archived).toBe(false);
	});

	it("returns only the requested poll ids for a bounded batch", async () => {
		state.polls = [
			makePoll({ id: "poll-1" }),
			makePoll({ id: "poll-2" }),
			makePoll({ id: "poll-3" }),
		];
		state.poll_votes = [];
		state.posts = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { ids: "poll-1,poll-2" },
				body: {},
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as Array<{ id: string }>).map((p) => p.id)).toEqual([
			"poll-1",
			"poll-2",
		]);
	});

	// ── List-path results failure (the "poll totals flap to 0" class) ──
	// attachResults used to swallow a poll_votes read error on the LIST path
	// (non-strict) and return total_votes: 0 for every poll — a transient DB
	// hiccup rendered as "all votes vanished" until the next refresh. The
	// list path is strict now: the read throws (→ honest 500 via the error
	// middleware) instead of serving fake zeros.
	it("throws (no fake zeros) when the list-path results read fails", async () => {
		state.polls = [makePoll({ id: "poll-1" })];
		state.poll_votes = [{ poll_id: "poll-1", choices: [0], author_id: "anon-2" }];
		state.resultsError = new Error("results read failed");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler({ method: "GET", query: {}, body: {}, headers: {} }, res),
		).rejects.toThrow("results read failed");
		expect(res.statusCode).toBe(200); // handler never completed a response
	});

	// ── Scale correctness (the silent-truncation class) ──
	// PostgREST caps uncapped selects at max-rows (1000). A viral poll must
	// still report exact totals, not the first page.
	it("counts votes past the 1000-row server page instead of truncating", async () => {
		state.enforceCap = true;
		state.polls = [makePoll({ id: "poll-1" })];
		state.poll_votes = Array.from({ length: 1500 }, (_, i) => ({
			poll_id: "poll-1",
			choices: [i % 2],
			author_id: `voter-${i}`,
		}));
		state.posts = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { ids: "poll-1" },
				body: {},
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{
			total_votes: number;
			vote_counts: Record<string, number>;
		}>;
		expect(p.total_votes).toBe(1500);
		expect(p.vote_counts).toEqual({ 0: 750, 1: 750 });
	});

	it("unmasks author_id and sets is_mine when the viewer owns the poll", async () => {
		state.polls = [makePoll({ author_id: "anon-7" })];
		state.poll_votes = [];
		state.posts = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{ method: "GET", query: { viewer: "anon-7" }, body: {}, headers: { "x-anon-id": "anon-1" } },
			res,
		);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ author_id: string; is_mine: boolean }>;
		expect(p.is_mine).toBe(true);
		expect(p.author_id).toBe("anon-7");
	});

	it("masks foreign author ids with a trailing ellipsis for anonymous viewers", async () => {
		state.polls = [makePoll({ author_id: "anon-99" })];
		state.poll_votes = [];
		state.posts = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ author_id: string }>;
		expect(p.author_id).toBe("anon-99...");
	});

	it("never masks ADMIN-authored polls", async () => {
		state.polls = [makePoll({ author_id: "ADMIN" })];
		state.poll_votes = [];
		state.posts = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ author_id: string }>;
		expect(p.author_id).toBe("ADMIN");
	});

	it("does not mutate orphaned post_id references during a public GET", async () => {
		state.polls = [
			makePoll({
				id: "poll-orphan",
				post_id: "post-gone",
				author_id: "anon-5",
			}),
		];
		state.poll_votes = [];
		state.posts = []; // linked post does not exist → orphan
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ post_id: string | null }>;
		expect(p.post_id).toBe("post-gone");
		expect(state.lastUpdate).toBeNull();
	});

	it("keeps post_id intact when the linked post still exists", async () => {
		state.polls = [
			makePoll({ id: "poll-linked", post_id: "post-1", author_id: "anon-5" }),
		];
		state.poll_votes = [];
		state.posts = [{ id: "post-1" }];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ post_id: string | null }>;
		expect(p.post_id).toBe("post-1");
		expect(state.lastUpdate).toBeNull();
	});

	it("lets admins see deleted polls (no deleted=false filter)", async () => {
		state.polls = [
			makePoll({ id: "poll-del", deleted: true, author_id: "anon-4" }),
		];
		state.poll_votes = [];
		state.posts = [];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ deleted: boolean }>;
		expect(p.deleted).toBe(true);
	});
});

describe("POST /api/polls { action: vote }", () => {
	it("rejects unauthenticated voters", async () => {
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "Invalid handle",
		});
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("404s when the poll does not exist", async () => {
		state.singleRow = null;
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "nope",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("404s when the poll is soft-deleted", async () => {
		state.singleRow = makePoll({ deleted: true });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("rejects votes on archived polls", async () => {
		state.singleRow = makePoll({ archived: true });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("archived");
	});

	it("rejects votes after expiry", async () => {
		state.singleRow = makePoll({ expires_at: "2020-01-01T00:00:00.000Z" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("ended");
	});

	it("rejects empty choice arrays", async () => {
		state.singleRow = makePoll();
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("option");
	});

	it("rejects multi-option votes on single-choice polls", async () => {
		state.singleRow = makePoll({ ptype: "single" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0, 1],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
	});

	it("inserts a new vote and returns live results", async () => {
		state.singleRow = makePoll();
		state.existingVote = null;
		state.poll_votes = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastInsert).toMatchObject({
			poll_id: "poll-1",
			author_id: "anon-2",
			choices: [0],
		});
		expect(res.body).toMatchObject({ total_votes: 0, vote_counts: {} });
	});

	it("updates an existing vote instead of inserting a duplicate", async () => {
		state.singleRow = makePoll();
		state.existingVote = { id: "v1", poll_id: "poll-1", choices: [1] };
		state.poll_votes = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		// The BALLOT write must have been an update of the existing vote row,
		// not an insert of a second one. Assert on the poll_votes update
		// specifically: the handler also touches the parent polls row for
		// realtime liveness, which is a separate, intentional write.
		expect(state.updateCalls).toContainEqual({
			table: "poll_votes",
			patch: { choices: [0] },
		});
		expect(
			state.updateCalls.filter((u) => u.table === "poll_votes"),
		).toHaveLength(1);
		expect(state.lastInsert).toBeNull();
	});

	// ── Vote write-failure regression (the "refresh resets my vote to 0" bug) ──
	// Old behavior: DB errors were unchecked → handler replied 200 with zeroed
	// results → client showed "Vote recorded 🔒" but nothing persisted.
	// New behavior: every DB step throws on error → sanitizeError → 500.
	// The handler must reject and must NOT write a fake 200 response.

	it("throws (no fake 200) when the vote-existence probe fails", async () => {
		state.singleRow = makePoll();
		state.probeError = new Error("probe failed");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("probe failed");
		expect(res.statusCode).toBe(200); // handler never completed a response
	});

	it("throws (no fake 200) when the vote insert fails", async () => {
		state.singleRow = makePoll();
		state.existingVote = null;
		state.writeError = new Error("RLS denied insert");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("RLS denied insert");
		expect(res.statusCode).toBe(200);
	});

	it("throws (no fake 200) when the vote update fails", async () => {
		state.singleRow = makePoll();
		state.existingVote = { id: "v1", poll_id: "poll-1", choices: [1] };
		state.writeError = new Error("RLS denied update");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("RLS denied update");
		expect(res.statusCode).toBe(200);
	});

	// ── Concurrent first-vote (23505) race branch ────────────────────────
	// Two clients can both pass the existence probe and both INSERT; with
	// migration 009's UNIQUE (poll_id, author_id) the loser gets 23505. The
	// handler's comment claims a regression suite covers this — these are
	// that suite. Three outcomes must all be real: convert to an update,
	// retry when the winner vanished, and REJECT (never fake 200) when the
	// retry also loses.

	const dupKey = (msg: string) =>
		Object.assign(new Error(msg), {
			code: "23505",
		});

	it("converts a lost race into an update of the winning row", async () => {
		state.singleRow = makePoll();
		state.poll_votes = [];
		// probe#1 misses (no row yet) → insert loses → winner probe finds it.
		state.probeSeq = [null, { id: "winner-1" }];
		state.insertErrorSeq = [
			dupKey(
				'duplicate key value violates unique constraint "poll_votes_poll_id_author_id_key"',
			),
		];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		// The ballot write landed as an UPDATE on poll_votes — the losing
		// request CHANGED its vote rather than erroring or double-inserting.
		expect(state.updateCalls).toContainEqual({
			table: "poll_votes",
			patch: { choices: [0] },
		});
		// And the recovery went through the winner's id: exactly ONE insert
		// attempt (the loser), then an UPDATE — not a blind second insert.
		expect(state.insertCalls).toHaveLength(1);
	});

	it("retries the insert when the winning row vanished mid-flight", async () => {
		state.singleRow = makePoll();
		state.poll_votes = [];
		// probe#1 miss → 23505 → winner probe returns null (row deleted
		// between the conflict and the re-probe) → retry insert succeeds.
		state.probeSeq = [null, null];
		state.insertErrorSeq = [
			dupKey("duplicate key value violates unique constraint"),
			null, // retry succeeds
		];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastInsert).toMatchObject({
			poll_id: "poll-1",
			author_id: "anon-2",
			choices: [0],
		});
		// Exactly two insert attempts: the loser plus ONE retry. One attempt
		// means the branch never ran; three means it loops instead of
		// giving up after the single documented retry.
		expect(state.insertCalls).toHaveLength(2);
		expect(state.updateCalls.filter((u) => u.table === "poll_votes")).toHaveLength(0);
	});

	it("throws (no fake 200) when the retry insert also loses the race", async () => {
		state.singleRow = makePoll();
		state.poll_votes = [];
		state.probeSeq = [null, null];
		state.insertErrorSeq = [
			dupKey("duplicate key value violates unique constraint"),
			dupKey("duplicate key value violates unique constraint"),
		];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow(/duplicate key/);
		// The response was never completed — no zeroed results, no 200.
		expect(res.statusCode).toBe(200);
		expect(state.updateCalls.filter((u) => u.table === "poll_votes")).toHaveLength(0);
		// Both attempts happened: the initial insert AND the single retry.
		// Without this the test passes vacuously — a bare "insert failed →
		// throw" would look identical even if the retry branch never ran.
		expect(state.insertCalls).toHaveLength(2);
	});

	it("throws (no fake 200) when the winner re-probe itself fails", async () => {
		state.singleRow = makePoll();
		state.poll_votes = [];
		// probe#1 miss → 23505 → winner re-probe errors (DB down mid-race).
		// The ballot must surface the failure, never a fabricated success.
		state.probeSeq = [null, new Error("winner probe failed")];
		state.insertErrorSeq = [
			dupKey("duplicate key value violates unique constraint"),
		];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("winner probe failed");
		expect(res.statusCode).toBe(200);
		expect(state.updateCalls.filter((u) => u.table === "poll_votes")).toHaveLength(0);
	});

	// ── Realtime liveness touch visibility ────────────────────────────────
	// `poll_votes` has no anon SELECT policy, so this touch on the parent
	// `polls` row is the ONLY thing that makes a vote reach realtime
	// readers. It was wrapped in try/catch — but PostgREST resolves with
	// {error} and never throws, so the catch could never fire and a failed
	// touch was invisible to every metric. A silent lost vote signal is
	// indistinguishable from a broken realtime feed, so it must be counted.

	it("counts a failed liveness touch without failing the ballot", async () => {
		state.singleRow = makePoll();
		state.existingVote = null;
		state.poll_votes = [];
		state.touchError = Object.assign(new Error("touch denied"), {
			code: "42501",
		});
		const mod = await import("../../api/_polls.js");
		const before = Number(mod.touchFailureCount ?? 0);
		const res = response();
		await mod.default(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		// The ballot already counted — a broken realtime signal must not
		// turn into a rejected vote.
		expect(res.statusCode).toBe(200);
		expect(state.lastInsert).toMatchObject({ poll_id: "poll-1" });
		// …but the failure is no longer silent.
		expect(Number(mod.touchFailureCount ?? 0)).toBe(before + 1);
	});

	it("counts a transport-level touch failure without failing the ballot", async () => {
		// PostgREST resolves {error}; a dropped socket REJECTS. Both must
		// count — the catch is the only thing standing between a dead touch
		// and an invisible one.
		state.singleRow = makePoll();
		state.existingVote = null;
		state.poll_votes = [];
		state.touchReject = new Error("socket hang up");
		const mod = await import("../../api/_polls.js");
		const before = Number(mod.touchFailureCount ?? 0);
		const res = response();
		await mod.default(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastInsert).toMatchObject({ poll_id: "poll-1" });
		expect(Number(mod.touchFailureCount ?? 0)).toBe(before + 1);
	});

	it("does not count a successful liveness touch", async () => {
		state.singleRow = makePoll();
		state.existingVote = null;
		state.poll_votes = [];
		const mod = await import("../../api/_polls.js");
		const before = Number(mod.touchFailureCount ?? 0);
		const res = response();
		await mod.default(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.updateCalls).toContainEqual({
			table: "polls",
			patch: expect.objectContaining({ updated_at: expect.any(String) }),
		});
		// Control: the counter moves only on real failures.
		expect(Number(mod.touchFailureCount ?? 0)).toBe(before);
	});

	it("throws (no fake 200) when the post-write results read fails", async () => {
		state.singleRow = makePoll();
		state.existingVote = null;
		state.resultsError = new Error("results read failed");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("results read failed");
		expect(res.statusCode).toBe(200);
	});
});

describe("POST /api/polls — create", () => {
	it("creates a poll with yesno defaults for a plain user", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Should the library open longer?", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		const row = state.lastInsert as Record<string, unknown>;
		expect(String(row.id)).toMatch(/^poll_/);
		expect(row.ptype).toBe("yesno");
		expect(row.options).toEqual(["Yes", "No"]);
		expect(row.author_id).toBe("anon-2");
		expect(res.body).toEqual(state.lastInsert);
	});

	it("rate-limits poll creation for plain users", async () => {
		const { rateLimited } = await import("../../api/_auth.js");
		(rateLimited as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Should we change the schedule?", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(429);
	});

	it("rejects titles shorter than 5 characters", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Ques", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("5 characters");
	});

	it("validates 2–10 options for non-yesno poll types", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Pick your favorite?",
					ptype: "single",
					options: ["Only one"],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("2–10");
	});

	it("blocks PII in poll questions", async () => {
		pipelineMocks.evaluateContent.mockReturnValueOnce({
			action: "BLOCK_ACTION",
			classification: "privacy",
			confidence: "high",
			policy: "pipeline-test",
			reasons: ["test"],
			trace: [],
			flags: [{ type: "privacy" }],
			language: "en",
			blocked: true,
			needsReview: false,
			code: "PII_BLOCKED",
		});
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Where does Alex live?", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("PII_BLOCKED");
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"poll_blocked",
			expect.any(String),
		);
	});

	it("blocks content that violates safety guidelines", async () => {
		pipelineMocks.evaluateContent.mockReturnValueOnce({
			action: "BLOCK_ACTION",
			classification: "hate_speech",
			confidence: "high",
			policy: "pipeline-test",
			reasons: ["test"],
			trace: [],
			flags: [{ type: "hate_speech" }],
			language: "en",
			blocked: true,
			needsReview: false,
			code: "CONTENT_BLOCKED",
		});
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "A dangerous question", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("CONTENT_BLOCKED");
	});

	it("stores a valid expires_at as ISO and drops invalid dates", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res1 = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Deadline poll?",
					expires_at: "2099-05-01T12:00:00Z",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res1,
		);
		expect(res1.statusCode).toBe(201);
		expect((state.lastInsert as { expires_at: string }).expires_at).toBe(
			"2099-05-01T12:00:00.000Z",
		);

		const res2 = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Deadline poll two?",
					expires_at: "not-a-date",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res2,
		);
		expect(res2.statusCode).toBe(201);
		expect(
			(state.lastInsert as { expires_at: string | null }).expires_at,
		).toBeNull();
	});

	it("attributes anonymous admin-created polls to ADMIN and skips rate limiting", async () => {
		const { isAdmin, rateLimited } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Official town hall poll?" },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		expect((state.lastInsert as { author_id: string }).author_id).toBe("ADMIN");
		expect(rateLimited).not.toHaveBeenCalled();
	});

	it("links a poll to the author's own post", async () => {
		state.singleRow = { id: "post-own", author_id: "anon-2" };
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Do you support this fix?",
					post_id: "post-own",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		expect((state.lastInsert as { post_id: string }).post_id).toBe("post-own");
	});

	it("403s when linking a poll to someone else's post", async () => {
		state.singleRow = { id: "post-theirs", author_id: "anon-9" };
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Do you support this fix?",
					post_id: "post-theirs",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { error: string }).error).toContain("your own posts");
	});

	it("404s when linking a poll to a missing post", async () => {
		state.singleRow = null;
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Do you support this fix?",
					post_id: "post-gone",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});
});

describe("PUT /api/polls", () => {
	it("404s for an unknown poll", async () => {
		state.singleRow = null;
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "nope", archived: true, author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("rejects a spoofed ADMIN author", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", archived: true, author_id: "ADMIN" },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects non-owner updates", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", archived: true, author_id: "anon-9" },
				headers: { "x-anon-id": "anon-9" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("lets the owner archive or delete their own poll", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", archived: true, author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toEqual({ archived: true });
		expect(authMocks.auditLog).not.toHaveBeenCalled();
	});

	it("lets admins patch expires_at and audit the change", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", expires_at: "2099-01-01T00:00:00Z" },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toEqual({ expires_at: "2099-01-01T00:00:00Z" });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"update_poll",
			"poll-1",
		);
	});
});

describe("polls — ban deny, migration fallback, admin scan, create errors", () => {
	it("rejects an owner PUT when checkUser denies (banned)", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "This anonymous ID has been permanently banned.",
		});
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", archived: true, author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("answers 400 (not a crash) when the hidden column is missing pre-migration", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		state.writeError = Object.assign(new Error('column "hidden" does not exist'), {
			code: "PGRST204",
		});
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", hidden: true },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("migration 018");
	});

	it("rejects poll creation when checkUser denies", async () => {
		state.singleRow = { id: "post-own", author_id: "anon-2" };
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "This anonymous ID has been permanently banned.",
		});
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Banned user poll?",
					post_id: "post-own",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("throws (no fake 201) when the create insert fails", async () => {
		state.singleRow = { id: "post-own", author_id: "anon-2" };
		state.polls = [];
		state.writeError = new Error("insert blew up");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						title: "Doomed poll?",
						post_id: "post-own",
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("insert blew up");
	});

	it("lets an admin scan a poll read-only and audits it", async () => {
		state.singleRow = makePoll({ id: "poll-1", title: "Clean question?", options: ["Yes", "No"] });
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "scan", poll_id: "poll-1" },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { blocked: boolean }).blocked).toBe(false);
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"poll_scan",
			expect.stringContaining("poll-1"),
		);
	});
});

describe("DELETE /api/polls", () => {
	it("rejects non-admins", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "poll-1" }, headers: { "x-anon-id": "anon-1" } },
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("hard-deletes the poll and its votes as an admin", async () => {
		// beforeEach leaves state.polls empty; the handler now proves the
		// delete landed (0 rows => 404), so seed the poll being deleted.
		state.polls = [makePoll()];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "poll-1" }, headers: { "x-anon-id": "anon-1" } },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ ok: true });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"delete_poll",
			"poll-1",
		);
		// Cascade order: the poll row is deleted (and proved) BEFORE its
		// votes — never the reverse (a failed poll delete would otherwise
		// leave a live poll with every vote already erased).
		expect(state.deleteCalls.map((c) => c.table)).toEqual([
			"polls",
			"poll_votes",
		]);
		expect(state.deleteCalls[1]?.filters).toEqual([["poll_id", "poll-1"]]);
	});

	// REGRESSION: an id that matches no row used to no-op with ok:true —
	// the same "row comes back on refresh" bug posts had. A delete that
	// removes 0 rows must 404 and must not audit a deletion.
	it("404s when the id matches no row instead of returning ok:true", async () => {
		state.polls = [makePoll({ id: "some-other-poll" })];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "poll-1" }, headers: { "x-anon-id": "anon-1" } },
			res,
		);
		expect(res.statusCode).toBe(404);
		expect((res.body as { ok?: boolean }).ok).not.toBe(true);
		expect((res.body as { error: string }).error).toBe("Poll not found");
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"delete_poll",
			"poll-1",
		);
	});

	// Vercel drops DELETE request bodies — the id must arrive via query.
	it("accepts the id from the query string with an empty body", async () => {
		state.polls = [makePoll()];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: { id: "poll-1" },
				body: {},
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ ok: true });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"delete_poll",
			"poll-1",
		);
	});

	it("400s when the id is missing from both query and body", async () => {
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: {},
				body: {},
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toBe("Missing id");
	});

	// REGRESSION: votes were wiped BEFORE the poll row delete was proved.
	// A transient error on the poll delete then left a live poll with every
	// vote already erased. The poll row must go first, and a failed delete
	// must leave poll_votes untouched.
	it("does not touch poll_votes when the poll row delete fails", async () => {
		state.polls = [makePoll()];
		state.deleteErrors.polls = new Error("poll row delete failed");
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "DELETE",
					query: {},
					body: { id: "poll-1" },
					headers: { "x-anon-id": "anon-1" },
				},
				res,
			),
		).rejects.toThrow("poll row delete failed");
		expect(state.deleteCalls.some((c) => c.table === "poll_votes")).toBe(
			false,
		);
		expect((res.body as { ok?: boolean } | undefined)?.ok).not.toBe(true);
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"delete_poll",
			"poll-1",
		);
	});

	// REGRESSION: the poll_votes delete error was discarded — orphan votes
	// shipped with ok:true and an audit entry. Fail loudly instead.
	it("surfaces a poll_votes wipe failure instead of answering ok:true", async () => {
		state.polls = [makePoll()];
		state.deleteErrors.poll_votes = new Error("votes wipe failed");
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "DELETE",
					query: {},
					body: { id: "poll-1" },
					headers: { "x-anon-id": "anon-1" },
				},
				res,
			),
		).rejects.toThrow("votes wipe failed");
		expect((res.body as { ok?: boolean } | undefined)?.ok).not.toBe(true);
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"delete_poll",
			"poll-1",
		);
	});
});

describe("method routing", () => {
	it("answers OPTIONS with 204", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "OPTIONS", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(204);
	});
});

describe("polls — session binding (anti-impersonation)", () => {
	async function denySession() {
		const { verifyCallerIdentity } = await import("../../api/_auth.js");
		(verifyCallerIdentity as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 403,
			error: "Invalid session identity",
		});
	}

	it("refuses a vote when the session gate denies, even with a matching header", async () => {
		state.singleRow = makePoll();
		state.existingVote = null;
		await denySession();
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "vote", poll_id: "poll-1", choices: [0], author_id: "victim_1" },
				headers: { "x-anon-id": "victim_1" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(state.insertCalls).toHaveLength(0);
	});

	it("refuses poll creation when the session gate denies", async () => {
		state.singleRow = { id: "post-own", author_id: "victim_1" };
		await denySession();
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Forged poll question?", post_id: "post-own", author_id: "victim_1" },
				headers: { "x-anon-id": "victim_1" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("refuses an owner PUT when the session gate denies", async () => {
		state.singleRow = makePoll({ author_id: "victim_1" });
		await denySession();
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", archived: true, author_id: "victim_1" },
				headers: { "x-anon-id": "victim_1" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});
});
