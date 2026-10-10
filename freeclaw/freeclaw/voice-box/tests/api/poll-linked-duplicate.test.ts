// ════════════════════════════════════════════════════════════════════
// One post must never end up with two polls attached.
//
// Reported symptom: "there are two different polls for the same 1 post,
// that is linked". Two independent defects combine to produce it:
//
//   1. SERVER: POST /api/polls validated that the linked post EXISTS and
//      that the caller OWNS it, but never checked whether that post
//      already had a poll. `post_id` has no uniqueness constraint, so the
//      second insert succeeded and both polls rendered on the post page.
//
//   2. CLIENT: when the post API deduped a repeat submission to an
//      existing post (`post.deduped`), the client STILL created the
//      attached poll — so re-submitting the same complaint with "attach a
//      poll" added a second poll to the original post. The same thing
//      happened on any retry after a lost response.
//
// The server is the enforcement point (the file's own precedent: "the
// client already filters the picker to own posts, but the server is the
// enforcement point"). This suite pins the server contract; the client
// behaviour is pinned in src/__tests__/Submit.test.tsx.
// ════════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = {
	polls: [] as Row[],
	posts: [] as Row[],
	inserts: [] as Row[],
};

const from = vi.fn((table: string) => {
	const filters: Array<[string, unknown]> = [];
	let inserted: Row | null = null;
	let mode: "select" | "insert" | "maybeSingle" = "select";

	const chain: Record<string, unknown> = {
		select: () => chain,
		eq: (col: string, val: unknown) => {
			filters.push([col, val]);
			return chain;
		},
		order: () => chain,
		limit: () => chain,
		insert: (row: Row) => {
			mode = "insert";
			inserted = row;
			return chain;
		},
		// PostgREST maybeSingle(): null when nothing matches, else the ROW
		// itself (not a one-element array like plain select()).
		maybeSingle: () => {
			mode = "maybeSingle";
			return chain;
		},
		// insert().select().single() — the write path used by createPoll.
		single: () => chain,
		// Resolves the filtered rows, honouring .limit(n) like PostgREST.
		then: (resolve: (v: unknown) => void) => {
			if (mode === "insert") {
				const pool = table === "polls" ? state.polls : state.posts;
				pool.push(inserted as Row);
				state.inserts.push(inserted as Row);
				resolve({ data: inserted, error: null });
				return;
			}
			const pool = table === "polls" ? state.polls : state.posts;
			const matched = pool.filter((r) =>
				filters.every(([c, v]) => r[c] === v),
			);
			if (mode === "maybeSingle") {
				resolve({ data: matched[0] ?? null, error: null });
				return;
			}
			resolve({ data: matched.length ? matched : null, error: null });
		},
	};
	return chain;
});

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const authMocks = {
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	notifyUser: vi.fn(),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: never) => res),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	maskProfanity: (s: unknown) => String(s ?? ""),
	// Default-allow session gate: the route under test binds writes to the
	// session, and these behavior tests do not model auth failures.
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: "" })),
};

vi.mock("../../api/_auth.js", () => authMocks);

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

vi.mock("../../api/_safety-pipeline.js", () => ({
	evaluateContentDeep: vi.fn().mockResolvedValue({
		action: "ALLOW",
		classification: "clean",
		confidence: "high",
		policy: null,
		reasons: [],
		trace: [],
		flags: [],
		blocked: false,
		needsReview: false,
	}),
	messageFor: vi.fn((_s: string, c: string) => `${c} message`),
}));

vi.mock("../../api/_moderation.js", () => ({
	getSpamConfig: vi.fn().mockResolvedValue({}),
	spamAnalyze: vi.fn().mockResolvedValue({ spam_score: 0 }),
	checkSafetyRepost: vi.fn().mockResolvedValue({}),
	recordSafetyRepost: vi.fn(),
	recordModerationDecision: vi.fn(),
	getLearnedWeakStats: vi.fn().mockResolvedValue({}),
}));

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

async function createPoll(body: Row) {
	const { default: handler } = await import("../../api/_polls.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			body,
			headers: { "x-anon-id": "anon-1" },
		},
		res,
	);
	return res;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	// clearAllMocks() drops the resolved values these gate mocks were built
	// with, which silently turned every create into a 403 (checkUser →
	// gate.ok undefined). Re-arm them explicitly every test.
	authMocks.checkUser.mockResolvedValue({ ok: true } as never);
	authMocks.isAdmin.mockResolvedValue(false as never);
	authMocks.rateLimited.mockResolvedValue(false as never);
	state.polls = [];
	state.posts = [{ id: "post_1", author_id: "anon-1" }];
	state.inserts = [];
});

describe("POST /api/polls — one poll per linked post", () => {
	it("creates the first poll linked to a post", async () => {
		const res = await createPoll({
			title: "Should the library open longer?",
			ptype: "single",
			options: ["Yes", "No"],
			post_id: "post_1",
			author_id: "anon-1",
		});

		expect(res.statusCode).toBe(201);
		expect(state.polls).toHaveLength(1);
		expect(state.polls[0].post_id).toBe("post_1");
	});

	it("does NOT create a second poll for the same post", async () => {
		// This is the reported bug. A second poll linked to post_1 made the
		// post page show two unrelated polls.
		const first = await createPoll({
			title: "Should the library open longer?",
			ptype: "single",
			options: ["Yes", "No"],
			post_id: "post_1",
			author_id: "anon-1",
		});
		expect(first.statusCode).toBe(201);

		const second = await createPoll({
			title: "Which day suits the sports meet best?",
			ptype: "single",
			options: ["Monday", "Friday"],
			post_id: "post_1",
			author_id: "anon-1",
		});

		// Exactly one row in the table — no second poll was written.
		expect(state.polls).toHaveLength(1);
		expect(state.inserts).toHaveLength(1);
		// …and the caller is told what actually happened instead of being
		// handed a success that silently duplicated their poll.
		expect(second.statusCode).not.toBe(201);
		expect((second.body as { error?: string })?.error ?? "").toMatch(
			/already has a poll/i,
		);
	});

	it("is idempotent for a retry with the SAME question", async () => {
		// A lost response is indistinguishable from a failed one, so the
		// client retries. That must not duplicate anything.
		await createPoll({
			title: "Should the library open longer?",
			ptype: "single",
			options: ["Yes", "No"],
			post_id: "post_1",
			author_id: "anon-1",
		});
		const retry = await createPoll({
			title: "Should the library open longer?",
			ptype: "single",
			options: ["Yes", "No"],
			post_id: "post_1",
			author_id: "anon-1",
		});

		expect(state.polls).toHaveLength(1);
		// A retry of the identical poll succeeds and returns the SAME row,
		// so a retrying client is not shown an error for work that landed.
		expect(retry.statusCode).toBe(200);
		expect((retry.body as Row)?.id).toBe(state.polls[0].id);
	});

	it("allows an unrelated poll with no post link", async () => {
		// Standalone polls are unaffected by the one-per-post rule.
		await createPoll({
			title: "Should the canteen stay open later?",
			author_id: "anon-1",
		});
		await createPoll({
			title: "Should we start a robotics club?",
			author_id: "anon-1",
		});
		expect(state.polls).toHaveLength(2);
	});

	it("allows a second poll on a DIFFERENT post", async () => {
		state.posts = [
			{ id: "post_1", author_id: "anon-1" },
			{ id: "post_2", author_id: "anon-1" },
		];
		await createPoll({
			title: "First poll question here?",
			ptype: "single",
			options: ["Yes", "No"],
			post_id: "post_1",
			author_id: "anon-1",
		});
		const res = await createPoll({
			title: "Second poll question here?",
			ptype: "single",
			options: ["Yes", "No"],
			post_id: "post_2",
			author_id: "anon-1",
		});

		expect(res.statusCode).toBe(201);
		expect(state.polls).toHaveLength(2);
	});

	it("ignores a soft-deleted poll when deciding the post is taken", async () => {
		// A deleted poll must not permanently block the post from ever
		// having a poll again.
		await createPoll({
			title: "Should the library open longer?",
			ptype: "single",
			options: ["Yes", "No"],
			post_id: "post_1",
			author_id: "anon-1",
		});
		state.polls[0].deleted = true;

		const res = await createPoll({
			title: "A different question after deletion?",
			ptype: "single",
			options: ["Yes", "No"],
			post_id: "post_1",
			author_id: "anon-1",
		});

		expect(res.statusCode).toBe(201);
		expect(state.polls).toHaveLength(2);
	});
});