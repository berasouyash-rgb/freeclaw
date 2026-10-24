// ═══════════════════════════════════════════════════════════════════
// Reports API — moderation queue + auto-strike enforcement
// ═══════════════════════════════════════════════════════════════════
// Locks the POST /api/reports contract and the real moderation work it
// does: resolve target author (post/comment/poll), auto-strike once per
// target per 24h (dedupe + TOCTOU guard), progressive enforcement
// (3 strikes in a week → 7-day suspension, 6 → ban), immediate in-app
// notification to the struck user, admin-gated GET (enriched with
// target_author_id, artifact reasons hidden) and PUT resolve.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state: Record<string, unknown> = {};

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

const authMocks = {
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) =>
		String(s ?? "")
			.replace(/[\u0000-\u001f]/g, "")
			.trim()
			.slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
	notifyUser: vi.fn(),
	// Default-allow session gate (feature tests exercise behavior, not
	// auth; the impersonation test below overrides with denial).
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: "" })),
};

vi.mock("../../api/_auth.js", () => authMocks);

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

vi.mock("../../api/_artifact-filter.js", () => ({
	isTestArtifact: vi.fn(() => false),
	TEST_THREAD_ID_RE: /never/i,
}));

let handler: (req: Record<string, unknown>, res: unknown) => Promise<unknown>;
let isTestArtifact: ReturnType<typeof vi.fn>;

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
	col?: unknown;
	row?: unknown;
	select: (col?: unknown, opts?: unknown) => Chain;
	eq: () => Chain;
	in: () => Chain;
	gte: () => Chain;
	order: () => Chain;
	limit: () => Chain;
	maybeSingle: () => Chain;
	single: () => Chain;
	update: (patch: unknown) => Chain;
	insert: (row: unknown) => Chain;
	upsert: (row: unknown, opts?: unknown) => Chain;
	then: (fn: (v: unknown) => void) => void;
}

function chainFor(table: string): Chain {
	const chain = {
		op: "select",
		col: undefined as unknown,
		row: undefined as unknown,
		select(col?: unknown) {
			this.col = col;
			return this;
		},
		eq() {
			return this;
		},
		in() {
			return this;
		},
		gte() {
			return this;
		},
		order() {
			return this;
		},
		limit() {
			return this;
		},
		maybeSingle() {
			this.op = "maybeSingle";
			return this;
		},
		single() {
			this.op = "single";
			this.row =
				state[`${table}:lastInsert`] ?? state[`${table}:singleRow`] ?? null;
			return this;
		},
		update(patch: unknown) {
			this.op = "update";
			state[`${table}:lastUpdate`] = patch;
			// Real update().select().single() returns the UPDATED row —
			// merge the patch so downstream status checks see it.
			if (state[`${table}:singleRow`]) {
				state[`${table}:singleRow`] = {
					...(state[`${table}:singleRow`] as Record<string, unknown>),
					...(patch as Record<string, unknown>),
				};
			}
			return this;
		},
		insert(row: unknown) {
			this.op = "insert";
			state[`${table}:lastInsert`] = row;
			return this;
		},
		upsert(row: unknown) {
			this.op = "upsert";
			state[`${table}:lastUpsert`] = row;
			return this;
		},
		then(fn: (v: unknown) => void) {
			if (this.op === "insert") {
				fn({ data: state[`${table}:lastInsert`], error: null });
				return;
			}
			if (this.op === "update") {
				fn({ data: state[`${table}:lastUpdate`], error: null });
				return;
			}
			if (this.op === "upsert") {
				fn({ data: state[`${table}:lastUpsert`], error: null });
				return;
			}
			if (this.op === "single") {
				fn({ data: this.row, error: null });
				return;
			}
			if (this.op === "maybeSingle") {
				if (table === "users_meta" && this.col === "warnings") {
					fn({ data: state["users_meta:preWarnings"] ?? null, error: null });
					return;
				}
				if (table === "settings") {
					fn({ data: state["settings:row"] ?? null, error: null });
					return;
				}
				fn({ data: state[`${table}:singleRow`] ?? null, error: null });
				return;
			}
			// plain select
			if (table === "reports" && this.col === "id") {
				fn({ data: state["reports:recent"] ?? [], error: null });
				return;
			}
			fn({ data: state[`${table}:list`] ?? [], error: null });
		},
	};
	return chain;
}

beforeEach(async () => {
	vi.clearAllMocks();
	// reset dynamic state
	for (const k of Object.keys(state)) delete state[k];
	from.mockImplementation((table: string) => chainFor(table));
	authMocks.checkUser.mockResolvedValue({ ok: true });
	authMocks.isAdmin.mockResolvedValue(false);
	authMocks.rateLimited.mockResolvedValue(false);
	// Drain any leaked one-shot gate denial so a broken gate fails its own
	// test instead of poisoning the next test's session check.
	authMocks.verifyCallerIdentity.mockReset();
	authMocks.verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "" });
	({ default: handler } = await import("../../api/_reports.js"));
	isTestArtifact = (await import("../../api/_artifact-filter.js"))
		.isTestArtifact as ReturnType<typeof vi.fn>;
	isTestArtifact.mockImplementation(() => false);
});

/** Default target: a real anon author with no prior strikes. */
function seedPostTarget() {
	state["posts:singleRow"] = {
		id: "p1",
		author_id: "anon_target",
		title: "Bad post",
	};
	state["reports:recent"] = [];
	state["users_meta:preWarnings"] = { warnings: [] };
	state["users_meta:singleRow"] = {
		anon_id: "anon_target",
		warnings: [],
		strikes: 0,
	};
	state["settings:row"] = { value: { notifications: [] } };
}

const REPORT = {
	target_id: "p1",
	target_type: "post",
	reason: "Spam",
	author_id: "anon_reporter",
};

describe("POST /api/reports", () => {
	it("inserts the report and auto-strikes the target author once", async () => {
		seedPostTarget();
		const res = response();
		await handler({ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } }, res);

		expect(res.statusCode).toBe(201);
		expect(res.body.target_id).toBe("p1");
		expect(res.body.enforcement).toEqual({ strike_applied: true, strikes: 1 });
		// strike persisted on the TARGET author, not the reporter
		expect(state["users_meta:lastUpdate"]).toMatchObject({ strikes: 1 });
		expect(state["users_meta:lastInsert"]).toBeUndefined();
		// immediate warning pushed to the target's notification store
		expect(authMocks.notifyUser).toHaveBeenCalledWith(
			"anon_target",
			"warning",
			expect.stringContaining("Strike"),
			expect.any(String),
		);
	});

	it("400s when target_id is missing", async () => {
		const res = response();
		await handler(
			{ method: "POST", body: { ...REPORT, target_id: "" }, headers: { "x-anon-id": "anon_reporter" } },
			res,
		);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe("Missing target");
		expect(state["users_meta:lastUpdate"]).toBeUndefined();
	});

	it("403s when the reporter is banned", async () => {
		authMocks.checkUser.mockResolvedValue({
			ok: false,
			error: "This anonymous ID has been permanently banned.",
		});
		const res = response();
		await handler({ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } }, res);
		expect(res.statusCode).toBe(403);
		expect(state["reports:lastInsert"]).toBeUndefined();
	});

	it("refuses a report when the session gate denies, even with a matching header", async () => {
		(authMocks.verifyCallerIdentity as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 403,
			error: "Invalid session identity",
		});
		const res = response();
		await handler(
			{ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } },
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(state["reports:lastInsert"]).toBeUndefined();
	});

	it("429s when rate limited (max 10 reports / 5 min)", async () => {
		authMocks.rateLimited.mockResolvedValue(true);
		const res = response();
		await handler({ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } }, res);
		expect(res.statusCode).toBe(429);
	});

	it("defaults an unknown target_type to post", async () => {
		seedPostTarget();
		const res = response();
		await handler(
			{
				method: "POST",
				body: { ...REPORT, target_type: "garbage" },
				headers: { "x-anon-id": "anon_reporter" },
			},
			res,
		);
		expect(res.body.target_type).toBe("post");
	});

	it("does NOT strike when the target author is not a real anon account", async () => {
		// pre-publish fallback id ('anonymous') and admin are not strikable
		state["posts:singleRow"] = { id: "p1", author_id: "anonymous", title: "x" };
		const res = response();
		await handler({ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } }, res);
		expect(res.body.enforcement).toEqual({ strike_applied: false, strikes: 0 });
		expect(state["users_meta:lastUpdate"]).toBeUndefined();
	});

	it("does NOT strike when the reporter reports their own content", async () => {
		state["posts:singleRow"] = {
			id: "p1",
			author_id: "anon_reporter",
			title: "self",
		};
		const res = response();
		await handler({ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } }, res);
		expect(res.body.enforcement.strike_applied).toBe(false);
		expect(state["users_meta:lastUpdate"]).toBeUndefined();
	});

	it("dedupes: a second report on the same target within 24h does not double-strike", async () => {
		state["posts:singleRow"] = {
			id: "p1",
			author_id: "anon_target",
			title: "x",
		};
		state["reports:recent"] = [{ id: "r-old" }, { id: "r-new" }]; // this insert + a prior one
		state["users_meta:preWarnings"] = { warnings: [] };
		const res = response();
		await handler({ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } }, res);
		expect(res.body.enforcement).toEqual({ strike_applied: false, strikes: 0 });
		expect(state["users_meta:lastUpdate"]).toBeUndefined();
	});

	it("dedupes via the TOCTOU guard: existing auto_report warning on the target in the window", async () => {
		state["posts:singleRow"] = {
			id: "p1",
			author_id: "anon_target",
			title: "x",
		};
		state["reports:recent"] = [{ id: "r-only" }]; // no second row
		state["users_meta:preWarnings"] = {
			warnings: [
				{
					source: "auto_report",
					target_id: "p1",
					at: new Date().toISOString(),
				},
			],
		};
		const res = response();
		await handler({ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } }, res);
		expect(res.body.enforcement).toEqual({ strike_applied: false, strikes: 0 });
		expect(state["users_meta:lastUpdate"]).toBeUndefined();
	});

	it("suspends for 7 days when the target reaches 3 strikes in a week", async () => {
		state["posts:singleRow"] = {
			id: "p1",
			author_id: "anon_target",
			title: "x",
		};
		state["reports:recent"] = [];
		state["users_meta:preWarnings"] = { warnings: [] };
		const week = new Date(Date.now() - 86400000).toISOString();
		state["users_meta:singleRow"] = {
			anon_id: "anon_target",
			strikes: 2,
			warnings: [
				{ source: "auto_report", target_id: "p9", at: week },
				{ source: "auto_report", target_id: "p8", at: week },
			],
		};
		state["settings:row"] = { value: { notifications: [] } };
		const res = response();
		await handler({ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } }, res);
		expect(res.body.enforcement).toEqual({ strike_applied: true, strikes: 3 });
		expect(
			(state["users_meta:lastUpdate"] as { suspended_until?: string })
				.suspended_until,
		).toBeDefined();
		expect(authMocks.notifyUser).toHaveBeenCalledWith(
			"anon_target",
			"warning",
			expect.stringContaining("suspended"),
			expect.any(String),
		);
	});

	it("bans permanently at 6 strikes", async () => {
		state["posts:singleRow"] = {
			id: "p1",
			author_id: "anon_target",
			title: "x",
		};
		state["reports:recent"] = [];
		state["users_meta:preWarnings"] = { warnings: [] };
		const week = new Date(Date.now() - 86400000).toISOString();
		const warnings = Array.from({ length: 5 }, (_, i) => ({
			source: "auto_report",
			target_id: `p${i}`,
			at: week,
		}));
		state["users_meta:singleRow"] = {
			anon_id: "anon_target",
			strikes: 5,
			warnings,
		};
		state["settings:row"] = { value: { notifications: [] } };
		const res = response();
		await handler({ method: "POST", body: { ...REPORT }, headers: { "x-anon-id": "anon_reporter" } }, res);
		expect(res.body.enforcement).toEqual({ strike_applied: true, strikes: 6 });
		expect(state["users_meta:lastUpdate"]).toMatchObject({ banned: true });
		expect(authMocks.notifyUser).toHaveBeenCalledWith(
			"anon_target",
			"warning",
			expect.stringContaining("permanently banned"),
			expect.any(String),
		);
	});

	it("strikes comment and poll targets via their tables", async () => {
		state["comments:singleRow"] = {
			id: "c1",
			author_id: "anon_commenter",
			body: "rude",
		};
		state["reports:recent"] = [];
		state["users_meta:preWarnings"] = { warnings: [] };
		state["users_meta:singleRow"] = {
			anon_id: "anon_commenter",
			warnings: [],
			strikes: 0,
		};
		state["settings:row"] = { value: { notifications: [] } };
		const res = response();
		await handler(
			{
				method: "POST",
				body: { ...REPORT, target_id: "c1", target_type: "comment" },
				headers: { "x-anon-id": "anon_reporter" },
			},
			res,
		);
		expect(res.body.enforcement).toEqual({ strike_applied: true, strikes: 1 });
		expect(state["users_meta:lastUpdate"]).toMatchObject({ strikes: 1 });
	});
});

describe("GET /api/reports (admin)", () => {
	it("403s without an admin token", async () => {
		const res = response();
		await handler({ method: "GET", query: {}, headers: {} }, res);
		expect(res.statusCode).toBe(403);
	});

	it("returns enriched rows with the reported target author, latest first", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:list"] = [
			{
				id: "r1",
				target_type: "post",
				target_id: "p1",
				reason: "Spam",
				status: "open",
			},
			{
				id: "r2",
				target_type: "comment",
				target_id: "c1",
				reason: "Harassment",
				status: "open",
			},
			{
				id: "r3",
				target_type: "poll",
				target_id: "v1",
				reason: "Misleading",
				status: "resolved",
			},
		];
		state["posts:list"] = [{ id: "p1", author_id: "anon_target" }];
		state["comments:list"] = [{ id: "c1", author_id: "anon_commenter" }];
		state["polls:list"] = [{ id: "v1", author_id: "anon_poller" }];
		const res = response();
		await handler({ method: "GET", query: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect(res.body).toHaveLength(3);
		expect(res.body[0]).toMatchObject({
			id: "r1",
			target_author_id: "anon_target",
		});
		expect(res.body[1].target_author_id).toBe("anon_commenter");
		expect(res.body[2].target_author_id).toBe("anon_poller");
	});

	it("hides artifact/test reasons from the admin queue", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		(isTestArtifact as ReturnType<typeof vi.fn>).mockImplementation(
			(r: string) => /^test$|qa|fuzz/i.test(r),
		);
		state["reports:list"] = [
			{
				id: "r1",
				target_type: "post",
				target_id: "p1",
				reason: "Spam",
				status: "open",
			},
			{
				id: "r2",
				target_type: "post",
				target_id: "p2",
				reason: "test",
				status: "open",
			},
			{
				id: "r3",
				target_type: "post",
				target_id: "p3",
				reason: "qa fuzz",
				status: "open",
			},
		];
		state["posts:list"] = [
			{ id: "p1", author_id: "anon_a" },
			{ id: "p2", author_id: "anon_b" },
			{ id: "p3", author_id: "anon_c" },
		];
		const res = response();
		await handler({ method: "GET", query: {}, headers: {} }, res);
		expect(res.body).toHaveLength(1);
		expect(res.body[0].id).toBe("r1");
	});
});

describe("GET /api/reports — workforce evidence join", () => {
	const reportRow = (id: string, status = "resolved") => ({
		id,
		target_type: "post",
		target_id: "p1",
		reason: "Harassment",
		status,
	});

	it("attaches the worker's audit evidence to the report it acted on", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:list"] = [reportRow("r1")];
		state["posts:list"] = [{ id: "p1", author_id: "anon_target" }];
		state["activity_logs:list"] = [
			{
				actor: "worker:report-disposition",
				action: "report_dispositioned",
				created_at: "2026-09-22T10:00:00.000Z",
				detail: JSON.stringify({
					report_id: "r1",
					target: "post:p1",
					disposition: "enforced",
					enforced: true,
					evidence: "public + violating (harassment)",
				}),
			},
		];
		const res = response();
		await handler({ method: "GET", query: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		expect(res.body[0].worker_action).toMatchObject({
			worker: "report-disposition",
			disposition: "enforced",
			enforced: true,
			evidence: "public + violating (harassment)",
			target: "post:p1",
		});
	});

	it("surfaces the false-resolution correction from worker #13", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:list"] = [reportRow("r2", "open")];
		state["activity_logs:list"] = [
			{
				actor: "worker:resolution-verification",
				action: "false_resolution_reopened",
				created_at: "2026-09-22T11:00:00.000Z",
				detail: JSON.stringify({
					report_id: "r2",
					target: "post:p1",
					flags: ["harassment", "threat"],
					enforced: true,
				}),
			},
		];
		const res = response();
		await handler({ method: "GET", query: {}, headers: {} }, res);

		expect(res.body[0].worker_action).toMatchObject({
			worker: "resolution-verification",
			action: "false_resolution_reopened",
			enforced: true,
			evidence: "harassment, threat",
		});
	});

	it("never fabricates evidence for a report no worker acted on", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:list"] = [reportRow("r1"), reportRow("r9")];
		state["activity_logs:list"] = [
			{
				actor: "worker:report-disposition",
				action: "report_dispositioned",
				created_at: "2026-09-22T10:00:00.000Z",
				detail: JSON.stringify({
					report_id: "r1",
					disposition: "no_violation",
					enforced: false,
				}),
			},
		];
		const res = response();
		await handler({ method: "GET", query: {}, headers: {} }, res);

		expect(res.body[0].worker_action).toBeTruthy();
		expect(res.body[1].worker_action).toBeUndefined();
	});

	it("keeps the newest decision when a report was acted on twice", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:list"] = [reportRow("r1")];
		// activity_logs is read newest-first, matching the real query's order.
		state["activity_logs:list"] = [
			{
				actor: "worker:report-disposition",
				action: "report_dispositioned",
				created_at: "2026-09-22T12:00:00.000Z",
				detail: JSON.stringify({
					report_id: "r1",
					disposition: "already_handled",
					enforced: false,
				}),
			},
			{
				actor: "worker:report-disposition",
				action: "report_dispositioned",
				created_at: "2026-09-22T09:00:00.000Z",
				detail: JSON.stringify({
					report_id: "r1",
					disposition: "enforced",
					enforced: true,
				}),
			},
		];
		const res = response();
		await handler({ method: "GET", query: {}, headers: {} }, res);

		expect(res.body[0].worker_action.disposition).toBe("already_handled");
	});

	it("skips a malformed audit row instead of failing the queue", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:list"] = [reportRow("r1")];
		state["activity_logs:list"] = [
			{
				actor: "worker:report-disposition",
				action: "report_dispositioned",
				created_at: "2026-09-22T10:00:00.000Z",
				detail: "{not json",
			},
		];
		const res = response();
		await handler({ method: "GET", query: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		expect(res.body[0].worker_action).toBeUndefined();
	});
});

describe("PUT /api/reports (admin resolve)", () => {
	it("403s without admin", async () => {
		const res = response();
		await handler(
			{ method: "PUT", body: { id: "r1", status: "resolved" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("marks a report resolved and audits the action", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:singleRow"] = {
			id: "r1",
			target_type: "post",
			target_id: "p-gone",
			reason: "Spam",
			status: "open",
		};
		state["posts:singleRow"] = null; // target already removed
		const res = response();
		await handler(
			{ method: "PUT", body: { id: "r1", status: "resolved" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state["reports:lastUpdate"]).toEqual({ status: "resolved" });
		expect(res.body.verification).toMatchObject({
			verified: true,
			target_state: "gone",
		});
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"resolve_report",
			expect.stringContaining("verified=true"),
		);
	});

	it("hides a still-live violating comment on resolve (verification enforces)", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:singleRow"] = {
			id: "r2",
			target_type: "comment",
			target_id: "c-evil",
			reason: "abuse",
			status: "open",
		};
		state["comments:singleRow"] = {
			id: "c-evil",
			body: "You are an idiot, shut up",
			hidden: false,
			deleted: false,
		};
		const res = response();
		await handler(
			{ method: "PUT", body: { id: "r2", status: "resolved" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state["comments:lastUpdate"]).toEqual({ hidden: true });
		expect(res.body.verification).toMatchObject({
			verified: true,
			target_state: "hidden",
			action_taken: "hidden",
		});
	});

	it("resolves as reviewed when the live target is clean (no fake enforcement)", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:singleRow"] = {
			id: "r3",
			target_type: "post",
			target_id: "p-clean",
			reason: "disagreement",
			status: "open",
		};
		state["posts:singleRow"] = {
			id: "p-clean",
			title: "Water cooler broken",
			description: "Near Block B, please fix",
			hidden: false,
			deleted: false,
		};
		const res = response();
		await handler(
			{ method: "PUT", body: { id: "r3", status: "resolved" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state["posts:lastUpdate"]).toBeUndefined();
		expect(res.body.verification).toMatchObject({
			verified: true,
			target_state: "live",
			action_taken: "none",
		});
	});

	it("404s on an unknown report instead of resolving blindly", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		state["reports:singleRow"] = null;
		const res = response();
		await handler(
			{ method: "PUT", body: { id: "r-nope", status: "resolved" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(404);
	});
});

describe("misc", () => {
	it("405s on unsupported methods", async () => {
		const res = response();
		await handler({ method: "DELETE", headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});

	it("answers OPTIONS preflight with 204", async () => {
		const res = response();
		await handler({ method: "OPTIONS", headers: {} }, res);
		expect(res.statusCode).toBe(204);
	});
});
