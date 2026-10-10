// Polls block + scan — admin poll control contracts.
// Block hides a poll from every public read without deleting anything
// (votes stay intact for audit/unblock). Scan is a read-only,
// audited moderation probe for polls that predate the write-time gate.
// Pre-migration (no polls.hidden column): listings retry without the
// filter (nothing can be blocked yet) and block attempts 400 naming
// migration 018 instead of 500ing.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	polls: [] as unknown[],
	singleRow: null as unknown,
	lastUpdate: null as unknown,
	// When true, any query filtering eq("hidden", …) fails like PostgREST
	// on a missing column — then succeeds (proves the retry path).
	missingHiddenFails: 0,
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
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({
		blocked: false,
		requiresReview: false,
		flags: [],
	})),
}));

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

vi.mock("../../api/_email.js", () => ({ sendPollClosedEmail: vi.fn() }));
vi.mock("../../api/_events.js", () => ({
	emitEventAndBridge: vi.fn(async () => undefined),
	EVENT_TYPES: {},
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

interface Chain {
	op: string;
	filters: Array<[string, unknown]>;
	select: () => Chain;
	eq: (col?: unknown, val?: unknown) => Chain;
	in: () => Chain;
	order: () => Chain;
	limit: () => Chain;
	range: (from?: unknown, to?: unknown) => Chain;
	maybeSingle: () => Chain;
	single: () => Chain;
	update: (patch: unknown) => Chain;
	insert: () => Chain;
	delete: () => Chain;
	then: (fn: (v: unknown) => void) => void;
}

// `table` is accepted so the mock reads like the real client; the assertions
// below only ever touch polls/users_meta semantics, so it stays unused here.
function chainFor(_table: string): Chain {
	const chain = {
		op: "select",
		filters: [] as Array<[string, unknown]>,
		rangeFrom: null as number | null,
		rangeTo: null as number | null,
		select() {
			return this;
		},
		eq(col?: unknown, val?: unknown) {
			if (typeof col === "string") this.filters.push([col, val]);
			return this;
		},
		in() {
			return this;
		},
		order() {
			return this;
		},
		limit() {
			return this;
		},
		range(from?: unknown, to?: unknown) {
			if (typeof from === "number") this.rangeFrom = from;
			if (typeof to === "number") this.rangeTo = to;
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
			// Pre-migration simulation: patching an unknown column fails.
			if (
				(patch as Record<string, unknown>)?.hidden !== undefined &&
				state.missingHiddenFails > 0
			) {
				state.missingHiddenFails -= 1;
				this.op = "update-missing";
				return this;
			}
			state.lastUpdate = patch;
			return this;
		},
		insert() {
			return this;
		},
		delete() {
			return this;
		},
		then(fn: (v: unknown) => void) {
			if (this.op === "update-missing") {
				fn({
					data: null,
					error: {
						code: "PGRST204",
						message: "Could not find the 'hidden' column of 'polls' in the schema cache",
					},
				});
				return;
			}
			if (this.op === "update") {
				fn({ data: state.lastUpdate, error: null });
				return;
			}
			if (this.op === "maybeSingle") {
				fn({ data: state.singleRow, error: null });
				return;
			}
			// Listing: honor eq filters; simulate a missing hidden column.
			if (
				this.filters.some(([c]) => c === "hidden") &&
				state.missingHiddenFails > 0
			) {
				state.missingHiddenFails -= 1;
				fn({
					data: null,
					error: {
						code: "PGRST204",
						message: "Could not find the 'hidden' column of 'polls' in the schema cache",
					},
				});
				return;
			}
			const rows = (state.polls as Array<Record<string, unknown>>).filter((r) =>
				this.filters.every(([col, val]) => r?.[col] === val),
			);
			// Ranged reads slice (server page faithfulness); fixtures here
			// are far below the page, so this is a no-op for these tests.
			const out =
				this.rangeFrom !== null && this.rangeTo !== null
					? rows.slice(this.rangeFrom, this.rangeTo + 1)
					: rows;
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
		singleRow: null,
		lastUpdate: null,
		missingHiddenFails: 0,
	});
	authMocks.isAdmin.mockResolvedValue(false);
	authMocks.checkUser.mockResolvedValue({ ok: true });
	from.mockImplementation((table: string) => chainFor(table));
});

describe("GET /api/polls hides blocked polls from the public", () => {
	it("excludes hidden polls for anonymous readers, shows them to admins", async () => {
		state.polls = [makePoll({ id: "open" }), makePoll({ id: "shut", hidden: true })];
		const { default: handler } = await import("../../api/_polls.js");
		const pub = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, pub);
		expect(pub.statusCode).toBe(200);
		expect((pub.body as Array<{ id: string }>).map((p) => p.id)).toEqual(["open"]);
		authMocks.isAdmin.mockResolvedValue(true);
		const adm = response();
		await handler(
			{ method: "GET", query: {}, body: {}, headers: { "x-admin-token": "tok" } },
			adm,
		);
		expect((adm.body as Array<{ id: string }>).map((p) => p.id).sort()).toEqual([
			"open",
			"shut",
		]);
	});

	it("retries without the filter pre-migration instead of 500ing", async () => {
		state.polls = [makePoll({ id: "open" })];
		state.missingHiddenFails = 1; // first hidden-filtered query errors
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect((res.body as Array<{ id: string }>).map((p) => p.id)).toEqual(["open"]);
	});
});

describe("PUT /api/polls hidden flag is admin-only", () => {
	it("lets an admin block and unblock, audited", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state.singleRow = makePoll();
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", hidden: true },
				headers: { "x-admin-token": "tok", "x-anon-id": "ADMIN" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toMatchObject({ hidden: true });
		expect(authMocks.auditLog).toHaveBeenCalledWith("admin", "update_poll", "poll-1");
	});

	it("ignores hidden from owners (moderation-only field)", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", hidden: true, archived: true },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toMatchObject({ archived: true });
		expect(state.lastUpdate as Record<string, unknown>).not.toHaveProperty("hidden");
	});

	it("400s with the migration pointer when the column is missing", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state.singleRow = makePoll();
		state.missingHiddenFails = 1;
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", hidden: true },
				headers: { "x-admin-token": "tok", "x-anon-id": "ADMIN" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toMatch(/migration 018/);
	});
});

describe("POST /api/polls votes respect blocks", () => {
	it("refuses votes on blocked polls", async () => {
		state.singleRow = makePoll({ hidden: true });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "vote", poll_id: "poll-1", choices: [0], author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toBe("Poll is blocked.");
	});
});

describe("POST /api/polls scan action", () => {
	it("returns the pipeline verdict and audits it (admin only)", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		pipelineMocks.evaluateContent.mockReturnValueOnce({
			action: "BLOCK_ACTION",
			classification: "profanity",
			confidence: "high",
			policy: "school-zero-tolerance",
			reasons: ["Profanity"],
			trace: [],
			flags: [{ type: "profanity" }],
			language: "en",
			blocked: true,
			needsReview: true,
		});
		state.singleRow = makePoll({ title: "shitty lab when" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "scan", poll_id: "poll-1" },
				headers: { "x-admin-token": "tok" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ id: "poll-1", blocked: true, flags: ["profanity"] });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"poll_scan",
			expect.stringContaining("poll-1"),
		);
	});

	it("reports clean polls honestly", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state.singleRow = makePoll();
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "scan", poll_id: "poll-1" },
				headers: { "x-admin-token": "tok" },
			},
			res,
		);
		expect(res.body).toMatchObject({ blocked: false, flags: [] });
		expect((res.body as { message: string }).message).toMatch(/Clean/);
	});

	it("403s non-admins and 404s unknown polls", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const denied = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "scan", poll_id: "poll-1" }, headers: {} },
			denied,
		);
		expect(denied.statusCode).toBe(403);
		authMocks.isAdmin.mockResolvedValue(true);
		state.singleRow = null;
		const missing = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "scan", poll_id: "nope" },
				headers: { "x-admin-token": "tok" },
			},
			missing,
		);
		expect(missing.statusCode).toBe(404);
	});
});
