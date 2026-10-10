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
// Default-allow session gate (feature tests exercise behavior, not auth;
// the impersonation test below overrides with header==claim semantics).
const verifyCallerMock = vi.fn(async () => ({ ok: true, callerId: "" }));
// Error-injection + side-effect capture for resilience/priority tests.
let deleteError: Error | null = null;
let insertError: Error | null = null;
let countsError: Error | null = null;
let priorityPatches: Array<Record<string, unknown>> = [];

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
	verifyCallerIdentity: verifyCallerMock,
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
		update(patch?: unknown): unknown;
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
		update(patch?: unknown) {
			this.op = "update";
			if (patch && typeof patch === "object" && "priority" in (patch as Record<string, unknown>))
				priorityPatches.push(patch as Record<string, unknown>);
			return this;
		},
		maybeSingle() {
			// Fire-and-forget side paths (event bridge settings lookup).
			return Promise.resolve({ data: null, error: null });
		},
		then(onResolve: (v: unknown) => void) {
			if (this.op === "delete") onResolve({ data: deleteResult, error: deleteError });
			else if (this.op === "insert") onResolve({ data: null, error: insertError });
			else if (this.op === "update") onResolve({ data: null, error: null });
			else if (this.op === "counts" && table === "reactions")
				onResolve({ data: reactionsData, error: countsError });
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
	deleteError = null;
	insertError = null;
	countsError = null;
	priorityPatches = [];
	// Drain any leaked one-shot gate denial so a broken gate fails its own
	// test instead of poisoning the next test's session check.
	verifyCallerMock.mockReset();
	verifyCallerMock.mockResolvedValue({ ok: true, callerId: "" });
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

	it("rejects a missing identity before any DB roundtrip", async () => {
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: {} },
			res,
		);

		expect(res.statusCode).toBe(403);
		expect(from).not.toHaveBeenCalled();
	});

	it("throws when the toggle DELETE fails instead of reporting success", async () => {
		deleteResult = [];
		deleteError = new Error("delete blew up");
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();

		await expect(
			handler(
				{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
				res,
			),
		).rejects.toThrow("delete blew up");
	});

	it("throws when the toggle INSERT fails instead of reporting success", async () => {
		deleteResult = []; // toggle ON → insert path
		insertError = new Error("insert blew up");
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();

		await expect(
			handler(
				{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
				res,
			),
		).rejects.toThrow("insert blew up");
	});

	it("concurrent same-identity toggle (23505) succeeds — the reaction is already active", async () => {
		// Web + app open on one identity fire two toggles in the same instant:
		// both DELETEs find no row, both INSERT. The unique index
		// reactions_target_author_kind_uidx turns the loser into a duplicate-key
		// error, which means the winner already made THIS reaction active —
		// exactly what toggle-ON wanted — so it must not surface as a 500.
		deleteResult = [];
		insertError = Object.assign(
			new Error(
				'duplicate key value violates unique constraint "reactions_target_author_kind_uidx"',
			),
			{ code: "23505" },
		);
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
	});

	it("still returns success when the counts query fails after a good toggle", async () => {
		deleteResult = [];
		countsError = new Error("counts blew up");
		reactionsData = [];
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		// The toggle itself worked — counts are best-effort, never fatal.
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ toggled: true, counts: {}, mine: [] });
	});

	function supportRows(n: number) {
		return Array.from({ length: n }, (_, i) => ({ kind: "support", author_id: `voter-${i}` }));
	}

	it("escalates priority to critical at 20 supports", async () => {
		deleteResult = [];
		reactionsData = supportRows(20);
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(priorityPatches).toContainEqual({ priority: "critical" });
	});

	it("escalates priority to high at 10 supports", async () => {
		deleteResult = [];
		reactionsData = supportRows(10);
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(priorityPatches).toContainEqual({ priority: "high" });
	});

	it("drops priority to low below 3 supports with no concern", async () => {
		deleteResult = [];
		reactionsData = supportRows(2);
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(priorityPatches).toContainEqual({ priority: "low" });
	});

	it("keeps priority at medium for ordinary counts", async () => {
		deleteResult = [];
		reactionsData = supportRows(5);
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: body(), headers: { "x-anon-id": "anon-1" } },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(priorityPatches).toContainEqual({ priority: "medium" });
	});

	it("refuses a toggle when the session gate denies, even with a matching header", async () => {
		// Stolen-cookie scenario: header and body both claim victim_1, but
		// the session proof fails. Header-only auth would allow this toggle;
		// the bound gate must deny it.
		verifyCallerMock.mockImplementation(async () => ({
			ok: false,
			status: 403,
			error: "Invalid session identity",
		}));
		deleteResult = [];
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { ...body(), author_id: "victim_1" },
				headers: { "x-anon-id": "victim_1" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		const calls = verifyCallerMock.mock.calls as Array<[unknown, unknown, string]>;
		expect(calls.length).toBeGreaterThan(0);
		expect(calls[calls.length - 1]?.[2]).toBe("victim_1");
	});
});
