// ═══════════════════════════════════════════════════════════════════
// Reactions API — POST toggle contract (speedup regression lock)
// ═══════════════════════════════════════════════════════════════════
// Locks the optimized POST /api/reactions behavior:
//   - Toggle ON: single DELETE ... .select('id') returns nothing removed
//     → INSERT. NO pre-SELECT roundtrip (the old check-then-toggle flow).
//   - Toggle OFF: DELETE ... .select('id') returns the removed row → no INSERT.
//   - Counts + the caller's own reactions come from ONE query
//     (select kind, author_id; "mine" derived in JS), and the posts
//     updated_at bump runs in parallel via Promise.all.
//   - POST roundtrips on 'reactions' table are exactly 2: delete + counts.
//   - Invalid kind → 400 before any auth; checkUser gate failure → 403.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
let reactionsData: Array<{ kind: string; author_id: string }> = [];
let deleteResult: Array<{ id: string }> = [];

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true, user: { id: "u1" } }),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
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

function chainFor(table: string) {
	const chain: {
		op: string | null;
		select(c: string): unknown;
		eq(): unknown;
		delete(): unknown;
		insert(): unknown;
		update(): unknown;
		maybeSingle(): Promise<unknown>;
		then(cb: (v: unknown) => void): Promise<unknown>;
	} = {
		op: null,
		select(_c: string) {
			if (!this.op) this.op = "counts";
			return this;
		},
		eq() {
			return this;
		},
		delete() {
			this.op = "delete";
			return this;
		},
		insert() {
			this.op = "insert";
			return this;
		},
		update() {
			this.op = "update";
			return this;
		},
		maybeSingle() {
			// Fire-and-forget side paths (event bridge settings lookup).
			return Promise.resolve({ data: null, error: null });
		},
		then(onResolve: (v: unknown) => void) {
			if (this.op === "delete") onResolve({ data: deleteResult, error: null });
			else if (this.op === "insert") onResolve({ data: null, error: null });
			else if (this.op === "update") onResolve({ data: null, error: null });
			else if (this.op === "counts" && table === "reactions")
				onResolve({ data: reactionsData, error: null });
			else onResolve({ data: [], error: null });
			return Promise.resolve(undefined);
		},
	};
	return chain;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	reactionsData = [];
	deleteResult = [];
	from.mockImplementation((table: string) => chainFor(table));
});

function body() {
	return {
		author_id: "anon-1",
		target_id: "post-1",
		target_type: "post",
		kind: "support",
	};
}

describe("POST /api/reactions — optimized toggle contract", () => {
	it("toggle ON: one-shot DELETE finds nothing → INSERT, and no pre-SELECT", async () => {
		deleteResult = []; // nothing removed → toggled ON
		reactionsData = [{ kind: "support", author_id: "anon-1" }];

		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			toggled: true,
			counts: { support: 1 },
			mine: ["support"],
		});

		// reactions roundtrips = delete + insert + counts (NO pre-SELECT).
		// Scoped to the reactions table: fire-and-forget side paths (event
		// bridge settings lookup, posts bumps) hit other tables and must not
		// pollute this contract.
		const ops = from.mock.calls.map(
			(args, i) =>
				`${args[0]}:${(from.mock.results[i].value as { op: string | null }).op}`,
		);
		const reactionsOps = ops
			.filter((o) => o.startsWith("reactions:"))
			.map((o) => o.split(":")[1]);
		expect(reactionsOps.filter((o) => o === "delete").length).toBe(1);
		expect(reactionsOps.filter((o) => o === "insert").length).toBe(1);
		expect(reactionsOps.filter((o) => o === "counts").length).toBe(1);
		// posts updated_at bump ran in parallel (Promise.all)
		expect(ops).toContain("posts:update");
	});

	it("accepts the suggestion downvote alias as a disagree vote", async () => {
		deleteResult = [];
		reactionsData = [{ kind: "disagree", author_id: "anon-1" }];

		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { ...body(), kind: "downvote" },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			toggled: true,
			counts: { disagree: 1 },
			mine: ["disagree"],
		});
	});

	it("toggle OFF: DELETE removes the existing row → no INSERT", async () => {
		deleteResult = [{ id: "r1" }]; // already voted → toggled OFF
		reactionsData = []; // after removal nothing remains

		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ toggled: false, counts: {}, mine: [] });
		// delete + counts only — no INSERT, no pre-SELECT (reactions table only)
		const ops = from.mock.calls.map(
			(args, i) =>
				`${args[0]}:${(from.mock.results[i].value as { op: string | null }).op}`,
		);
		const reactionsOps = ops
			.filter((o) => o.startsWith("reactions:"))
			.map((o) => o.split(":")[1]);
		expect(reactionsOps.filter((o) => o === "delete").length).toBe(1);
		expect(reactionsOps).not.toContain("insert");
		expect(reactionsOps.filter((o) => o === "counts").length).toBe(1);
	});

	it("counts aggregate ALL authors; mine filters to the caller only", async () => {
		deleteResult = [];
		reactionsData = [
			{ kind: "support", author_id: "anon-1" },
			{ kind: "support", author_id: "anon-2" },
			{ kind: "concerned", author_id: "anon-1" },
		];

		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			toggled: true,
			counts: { support: 2, concerned: 1 },
			mine: ["support", "concerned"],
		});
	});

	it("invalid kind → 400 before any DB roundtrip", async () => {
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { ...body(), kind: "nonsense" },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);

		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toBe("Invalid reaction");
		expect(from).not.toHaveBeenCalled();
	});

	it("checkUser gate failure → 403", async () => {
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "not_allowed",
		});

		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		expect(res.statusCode).toBe(403);
		expect(from).not.toHaveBeenCalled();
	});

	it("supports suggestion target_type", async () => {
		deleteResult = [];
		reactionsData = [{ kind: "upvote", author_id: "anon-1" }];

		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				headers: { "x-anon-id": "anon-1" },
				body: {
					author_id: "anon-1",
					target_id: "sug-1",
					target_type: "suggestion",
					kind: "upvote",
				},
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			toggled: true,
			counts: { upvote: 1 },
			mine: ["upvote"],
		});
	});

	it("rate-limits toggle floods → 429 before any DB roundtrip", async () => {
		const { rateLimited } = await import("../../api/_auth.js");
		(rateLimited as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		expect(res.statusCode).toBe(429);
		expect(from).not.toHaveBeenCalled();
	});
});
