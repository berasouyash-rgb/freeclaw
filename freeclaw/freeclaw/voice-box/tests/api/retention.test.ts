// ═══════════════════════════════════════════════════════════════════
// Closed-post retention — one rule, two sweeps, one countdown
// ═══════════════════════════════════════════════════════════════════
// Regression harness for the reported defect: solved posts were never
// auto-deleted. The fix moved the deadline into api/_retention.js so the
// student countdown, POST-level purgeExpired() and the janitor's closed
// sweep cannot disagree.
//
// These tests pin the behaviour that actually matters:
//   • solved AND archived are both terminal
//   • the deadline is max(close stamp, updated_at, created_at) + 5 days,
//     so a comment/reaction (which bumps updated_at) resets the countdown
//   • neither sweep fires on rows with no parseable timestamp
//   • the admin master toggle and the `solved_posts` class toggle both
//     stop the sweep
//   • the unlink-first order is preserved, and a failed unlink aborts
//     before a parent post row is removed
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

type Row = Record<string, unknown>;

type Filter = {
	kind: "eq" | "neq" | "in" | "is" | "lt" | "lte" | "gt" | "gte" | "like";
	col: string;
	val: unknown;
};

type Op = {
	table: string;
	op: "select" | "update" | "delete" | "insert" | "upsert";
	filters: Filter[];
	ids: unknown[];
	payload: unknown;
	matched: unknown[];
};

function escapeRe(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function likeToRe(pattern: string) {
	return new RegExp(`^${pattern.split("%").map(escapeRe).join(".*")}$`);
}

function matches(row: Row, f: Filter): boolean {
	const v = row[f.col];
	switch (f.kind) {
		case "eq":
			return v === f.val;
		case "neq":
			return v !== f.val;
		case "in":
			return Array.isArray(f.val) && f.val.includes(v);
		case "is":
			return f.val === null ? v === null || v === undefined : v === f.val;
		case "lt":
			return v != null && String(v) < String(f.val);
		case "lte":
			return v != null && String(v) <= String(f.val);
		case "gt":
			return v != null && String(v) > String(f.val);
		case "gte":
			return v != null && String(v) >= String(f.val);
		case "like":
			return typeof v === "string" && likeToRe(String(f.val)).test(v);
		default:
			return true;
	}
}

class Query {
	table: string;
	op: Op["op"] = "select";
	filters: Filter[] = [];
	payload: unknown = null;
	opts: Record<string, unknown> = {};
	singleMode: "none" | "maybe" | "single" = "none";
	limitN: number | null = null;
	orders: Array<{ col: string; ascending: boolean }> = [];

	constructor(private readonly db: FakeDb, table: string) {
		this.table = table;
	}

	private add(kind: Filter["kind"], col: unknown, val?: unknown) {
		this.filters.push({ kind, col: String(col), val });
		return this;
	}

	select(_cols?: unknown, opts?: unknown) {
		this.op = "select";
		if (opts && typeof opts === "object") this.opts = opts as Record<string, unknown>;
		return this;
	}
	eq(col: unknown, val: unknown) {
		return this.add("eq", col, val);
	}
	neq(col: unknown, val: unknown) {
		return this.add("neq", col, val);
	}
	in(col: unknown, val: unknown) {
		return this.add("in", col, val);
	}
	is(col: unknown, val: unknown) {
		return this.add("is", col, val);
	}
	lt(col: unknown, val: unknown) {
		return this.add("lt", col, val);
	}
	lte(col: unknown, val: unknown) {
		return this.add("lte", col, val);
	}
	gt(col: unknown, val: unknown) {
		return this.add("gt", col, val);
	}
	gte(col: unknown, val: unknown) {
		return this.add("gte", col, val);
	}
	like(col: unknown, val: unknown) {
		return this.add("like", col, val);
	}
	not(col: unknown, val: unknown) {
		// Only used as `.not("x","is",null)` style in other modules; record as neq.
		return this.add("neq", col, val);
	}
	match(obj: Record<string, unknown>) {
		for (const [k, v] of Object.entries(obj)) this.add("eq", k, v);
		return this;
	}
	order(col: unknown, opts?: { ascending?: boolean }) {
		this.orders.push({ col: String(col), ascending: opts?.ascending !== false });
		return this;
	}
	limit(n: unknown) {
		this.limitN = Number(n);
		return this;
	}
	maybeSingle() {
		this.singleMode = "maybe";
		return this;
	}
	single() {
		this.singleMode = "single";
		return this;
	}
	update(patch: unknown) {
		this.op = "update";
		this.payload = patch;
		return this;
	}
	insert(rows: unknown) {
		this.op = "insert";
		this.payload = rows;
		return this;
	}
	upsert(rows: unknown, opts?: unknown) {
		this.op = "upsert";
		this.payload = rows;
		if (opts) this.opts = opts as Record<string, unknown>;
		return this;
	}
	delete() {
		this.op = "delete";
		return this;
	}

	then<TResult1 = unknown, TResult2 = never>(
		onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
		onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
	): Promise<TResult1 | TResult2> {
		return this.db.execute(this).then(onFulfilled as never, onRejected as never);
	}
}

class FakeDb {
	tables: Record<string, Row[]> = {};
	ops: Op[] = [];
	/** `${table}:${op}` → error the query must resolve/reject with. */
	failures = new Map<string, Error>();

	reset() {
		this.tables = {};
		this.ops = [];
		this.failures.clear();
	}

	rows(table: string): Row[] {
		const rows = this.tables[table];
		if (!rows) {
			this.tables[table] = [];
			return this.tables[table];
		}
		return rows;
	}

	query(table: string) {
		return new Query(this, table);
	}

	private matchedRows(table: string, filters: Filter[]): Row[] {
		return this.rows(table).filter((r) => filters.every((f) => matches(r, f)));
	}

	private idsOf(table: string, filters: Filter[], hit: Row[]): unknown[] {
		const key = filters.find((f) => f.kind === "in")?.col;
		const values = filters.find((f) => f.kind === "in")?.val;
		if (key && (key === "id" || key === "post_id" || key === "target_id")) {
			return Array.isArray(values) ? values : [];
		}
		return hit.map((r) => r.id ?? r.key);
	}

	execute(q: Query): Promise<{ data: unknown; error: unknown; count?: number }> {
		const failure = this.failures.get(`${q.table}:${q.op}`);
		const hit = this.matchedRows(q.table, q.filters);
		this.ops.push({
			table: q.table,
			op: q.op,
			filters: [...q.filters],
			ids: this.idsOf(q.table, q.filters, hit),
			payload: q.payload,
			matched: hit.map((r) => r.id ?? r.key),
		});
		if (failure) return Promise.resolve({ data: null, error: failure });

		return Promise.resolve().then(() => {
			switch (q.op) {
				case "select": {
					if (q.opts.head) {
						return { data: null, error: null, count: hit.length };
					}
					let out = [...hit];
					for (const o of [...q.orders].reverse()) {
						out.sort((a, b) => {
							const av = String(a[o.col] ?? "");
							const bv = String(b[o.col] ?? "");
							return o.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
						});
					}
					if (q.limitN !== null) out = out.slice(0, q.limitN);
					if (q.singleMode !== "none") {
						return { data: out[0] ?? null, error: null };
					}
					return { data: out, error: null };
				}
				case "update": {
					for (const r of hit) Object.assign(r, q.payload as Row);
					return { data: hit, error: null };
				}
				case "delete": {
					const kept = this.rows(q.table).filter((r) => !hit.includes(r));
					this.tables[q.table] = kept;
					return { data: null, error: null };
				}
				case "insert":
				case "upsert": {
					const items = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Row[];
					const rows = this.rows(q.table);
					for (const item of items) {
						if (!item) continue;
						const keyed = q.table === "settings" && typeof item.key === "string";
						if (keyed) {
							const idx = rows.findIndex((r) => r.key === item.key);
							if (idx >= 0) rows[idx] = { ...rows[idx], ...item };
							else rows.push({ ...item });
						} else {
							rows.push({ ...item });
						}
					}
					return { data: q.payload, error: null };
				}
				default:
					return { data: null, error: null };
			}
		});
	}
}

const db = new FakeDb();
const from = vi.fn((table: string) => db.query(table));

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const authMocks = {
	cors: vi.fn(),
	clientIp: () => "127.0.0.1",
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	ensureUser: vi.fn(),
	auditLog: vi.fn().mockResolvedValue(undefined),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn(),
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: "" })),
};

vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(() => Promise.resolve()),
	emitEventAndBridge: vi.fn(() => Promise.resolve()),
	EVENT_TYPES: {},
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({ blocked: false, requiresReview: false, flags: [] })),
	getLearnedWeakStats: vi.fn(() => Promise.resolve({ approved: 0, blocked: 0 })),
	recordModerationDecision: vi.fn(() => Promise.resolve()),
	recordSafetyRepost: vi.fn(() => Promise.resolve(false)),
	checkSafetyRepost: vi.fn(() => Promise.resolve({ blocked: false })),
	alertAdminThreat: vi.fn(async () => ({ alerted: false, reason: "not-a-threat" })),
	getSpamConfig: vi.fn(() => Promise.resolve({ flag: 40, review: 60, quarantine: 80 })),
	spamAnalyze: vi.fn(() => ({ spam_score: 0, signals: {}, action: "allow", details: {} })),
}));
vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(() => Promise.resolve()),
}));

function addSettings(key: string, value: unknown) {
	db.rows("settings").push({ key, value });
}

function closedPost(over: Row = {}): Row {
	const now = Date.now();
	return {
		id: "post-1",
		status: "solved",
		deleted: false,
		status_history: [
			{ status: "reported", at: iso(now - 10 * DAY) },
			// Past the 7-day solved window (and the 5-day archived one) so every
			// "due" fixture stays due under both rules.
			{ status: "solved", at: iso(now - 9 * DAY) },
		],
		updated_at: iso(now - 9 * DAY),
		created_at: iso(now - 10 * DAY),
		...over,
	};
}

async function loadRetention() {
	return import("../../api/_retention.js");
}

beforeEach(() => {
	vi.resetModules();
	db.reset();
	vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────
// Pure rule
// ───────────────────────────────────────────────────────────────────

describe("closed-post retention rule", () => {
	it("treats solved and archived as terminal, and nothing else", async () => {
		const { CLOSED_STATUSES, CLOSED_RETENTION_DAYS, isClosedStatus } = await loadRetention();
		expect(CLOSED_STATUSES).toEqual(["solved", "archived"]);
		// One window for every closed status — a solved-specific constant here
		// is what let the served countdown and the sweep disagree.
		expect(CLOSED_RETENTION_DAYS).toBe(5);
		expect(isClosedStatus("solved")).toBe(true);
		expect(isClosedStatus("archived")).toBe(true);
		for (const s of ["reported", "verified", "in_progress", "waiting", "pending_review", undefined, null, ""]) {
			expect(isClosedStatus(s as string)).toBe(false);
		}
	});

	it("reads the newest closed status_history stamp, ignoring driving-status entries", async () => {
		const { closedAtMs } = await loadRetention();
		const now = Date.now();
		const post = {
			status_history: [
				{ status: "solved", at: iso(now - 30 * DAY) },
				{ status: "verified", at: iso(now - 20 * DAY) },
				{ status: "archived", at: iso(now - 9 * DAY) },
			],
		};
		expect(closedAtMs(post)).toBe(now - 9 * DAY);
	});

	it("skips malformed stamps instead of treating them as epoch 0", async () => {
		const { closedAtMs } = await loadRetention();
		const now = Date.now();
		const post = {
			status_history: [
				{ status: "solved", at: "not-a-date" },
				{ status: "archived", at: iso(now - 4 * DAY) },
				{ status: "solved", at: undefined },
			],
		};
		expect(closedAtMs(post)).toBe(now - 4 * DAY);
	});

	it("returns null when no closed entry exists", async () => {
		const { closedAtMs } = await loadRetention();
		expect(closedAtMs({ status_history: [{ status: "solved", at: iso(Date.now()) }] })).not.toBeNull();
		expect(closedAtMs({ status_history: [{ status: "verified", at: iso(Date.now()) }] })).toBeNull();
		expect(closedAtMs({ status_history: [] })).toBeNull();
		expect(closedAtMs({})).toBeNull();
		expect(closedAtMs(null)).toBeNull();
	});

	it("archived: uses the newest of close stamp / updated_at / created_at, plus 5 days", async () => {
		const { closedRetentionDueAt, CLOSED_RETENTION_MS } = await loadRetention();
		const now = Date.now();
		const post = {
			status: "archived",
			status_history: [{ status: "archived", at: iso(now - 8 * DAY) }],
			updated_at: iso(now - 2 * DAY),
			created_at: iso(now - 40 * DAY),
		};
		expect(closedRetentionDueAt(post)).toBe(now - 2 * DAY + CLOSED_RETENTION_MS);
	});

	it("archived: lets a comment/reaction (updated_at bump) reset the countdown", async () => {
		const { isClosedRetentionDue } = await loadRetention();
		const now = Date.now();
		// Archived 30 days ago, but still active 1 hour ago.
		const post = {
			status: "archived",
			status_history: [{ status: "archived", at: iso(now - 30 * DAY) }],
			updated_at: iso(now - 60 * 60 * 1000),
			created_at: iso(now - 60 * DAY),
		};
		expect(isClosedRetentionDue(post)).toBe(false);
	});

	it("solved: activity resets the countdown exactly like archived", async () => {
		const { closedRetentionDueAt, isClosedRetentionDue, CLOSED_RETENTION_MS } =
			await loadRetention();
		const now = Date.now();
		const solvedAt = iso(now - 30 * DAY);
		// A comment 1 hour ago bumped updated_at. The deadline must follow the
		// activity (5 days after it), NOT a fixed window from the solve — this
		// is the case where a solve-specific rule used to delete a live thread
		// while the student countdown promised 5 more days.
		const post = {
			status: "solved",
			status_history: [{ status: "solved", at: solvedAt }],
			updated_at: iso(now - 60 * 60 * 1000),
			created_at: iso(now - 40 * DAY),
		};
		expect(closedRetentionDueAt(post)).toBe(now - 60 * 60 * 1000 + CLOSED_RETENTION_MS);
		expect(isClosedRetentionDue(post)).toBe(false);

		const identical = {
			...post,
			status: "archived",
			status_history: [{ status: "archived", at: solvedAt }],
		};
		expect(closedRetentionDueAt(identical)).toBe(closedRetentionDueAt(post));
	});

	it("solved: a fresh close is not due until 5 full days have passed", async () => {
		const { isClosedRetentionDue } = await loadRetention();
		const now = Date.now();
		const base = { status: "solved", created_at: iso(now - 40 * DAY) };
		const solvedDaysAgo = (d: number) => [{ status: "solved", at: iso(now - d * DAY) }];
		expect(isClosedRetentionDue({ ...base, status_history: solvedDaysAgo(4) })).toBe(false);
		expect(isClosedRetentionDue({ ...base, status_history: solvedDaysAgo(6) })).toBe(true);
	});

	it("solved: falls back to updated_at when the close stamp is unparseable", async () => {
		const { closedRetentionDueAt, CLOSED_RETENTION_MS } = await loadRetention();
		const now = Date.now();
		expect(
			closedRetentionDueAt({
				status: "solved",
				status_history: [{ status: "solved", at: "garbage" }],
				updated_at: iso(now - 10 * DAY),
				created_at: iso(now - 20 * DAY),
			}),
		).toBe(now - 10 * DAY + CLOSED_RETENTION_MS);
	});

	it("falls back to created_at when the close stamp and activity are missing", async () => {
		const { closedRetentionDueAt } = await loadRetention();
		const now = Date.now();
		expect(closedRetentionDueAt({ created_at: iso(now - 10 * DAY) })).toBe(
			now - 10 * DAY + 5 * DAY,
		);
	});

	it("never purges a row whose timestamps are all unparseable", async () => {
		const { closedRetentionDueAt, isClosedRetentionDue } = await loadRetention();
		expect(closedRetentionDueAt({})).toBeNull();
		expect(closedRetentionDueAt({ updated_at: "nope", created_at: null })).toBeNull();
		expect(isClosedRetentionDue({})).toBe(false);
	});

	it("is not due at the boundary and is due one millisecond later", async () => {
		const { isClosedRetentionDue } = await loadRetention();
		const due = Date.now();
		const post = { created_at: iso(due - 5 * DAY) };
		expect(isClosedRetentionDue(post, due)).toBe(true);
		expect(isClosedRetentionDue(post, due - 1)).toBe(false);
	});
});

// ───────────────────────────────────────────────────────────────────
// Policy
// ───────────────────────────────────────────────────────────────────

describe("getRetentionPolicy", () => {
	it("defaults to everything enabled with a 5h user-delete window", async () => {
		const { getRetentionPolicy } = await loadRetention();
		expect(await getRetentionPolicy()).toEqual({
			autoDeleteEnabled: true,
			closedPostsEnabled: true,
			userDeleteHours: 5,
		});
	});

	it("honours the master toggle and the solved_posts class toggle", async () => {
		const { getRetentionPolicy } = await loadRetention();
		addSettings("retention_config", {
			auto_delete_enabled: false,
			classes: { solved_posts: false },
		});
		const policy = await getRetentionPolicy();
		expect(policy.autoDeleteEnabled).toBe(false);
		expect(policy.closedPostsEnabled).toBe(false);
	});

	it("only a literal false disables auto-delete", async () => {
		const { getRetentionPolicy } = await loadRetention();
		addSettings("retention_config", { auto_delete_enabled: "yes" });
		expect((await getRetentionPolicy()).autoDeleteEnabled).toBe(true);
	});

	it("accepts a valid user_delete_hours and ignores out-of-range values", async () => {
		const { getRetentionPolicy } = await loadRetention();
		for (const [input, expected] of [
			[24, 24],
			[1, 1],
			[168, 168],
			[0, 5],
			[169, 5],
			[5.5, 5],
			// Numeric strings match the admin write path, which accepts and
			// persists them as numbers; legacy/hand-edited settings may hold one.
			["12", 12],
			["", 5],
			[undefined, 5],
			// These are the values `Number()` would silently coerce into a real
			// window (true → 1h, [12] → 12h) and hard-delete user content.
			[true, 5],
			[false, 5],
			[[12], 5],
			[{}, 5],
		] as const) {
			db.reset();
			addSettings("retention_config", { user_delete_hours: input });
			expect((await getRetentionPolicy()).userDeleteHours).toBe(expected);
		}
	});

	it("survives a settings read failure with defaults (retention must not switch itself off)", async () => {
		const { getRetentionPolicy } = await loadRetention();
		db.failures.set("settings:select", new Error("db down"));
		expect(await getRetentionPolicy()).toEqual({
			autoDeleteEnabled: true,
			closedPostsEnabled: true,
			userDeleteHours: 5,
		});
	});
});

// ───────────────────────────────────────────────────────────────────
// purgeExpired — the POST-level sweep
// ───────────────────────────────────────────────────────────────────

describe("purgeExpired", () => {
	async function loadPosts() {
		return import("../../api/_posts.js");
	}

	function postOps(op: Op["op"], table = "posts") {
		return db.ops.filter((o) => o.table === table && o.op === op);
	}

	it("hard-deletes an expired solved post and its dependents", async () => {
		const { purgeExpired } = await loadPosts();
		db.rows("posts").push(closedPost({ id: "due-1" }));

		const result = await purgeExpired();

		expect(result).toEqual({ purged: 1, skipped: false });
		expect(db.rows("posts")).toHaveLength(0);
		expect(postOps("delete")[0].ids).toEqual(["due-1"]);
		expect(postOps("delete", "comments")[0].ids).toEqual(["due-1"]);
		expect(postOps("delete", "reactions")[0].ids).toEqual(["due-1"]);
	});

	it("deletes archived posts too (the old rule only looked at solved)", async () => {
		const { purgeExpired } = await loadPosts();
		db.rows("posts").push(closedPost({ id: "archived-1", status: "archived" }));

		expect(await purgeExpired()).toEqual({ purged: 1, skipped: false });
		expect(db.rows("posts")).toHaveLength(0);
	});		it("keeps a solved post that is still inside its 7-day window", async () => {
		const { purgeExpired } = await loadPosts();
		const now = Date.now();
		db.rows("posts").push(
			closedPost({
				id: "recent-1",
				status_history: [{ status: "solved", at: iso(now - 3 * DAY) }],
				updated_at: iso(now - 1 * 60 * 60 * 1000),
			}),
		);

		expect(await purgeExpired()).toEqual({ purged: 0, skipped: false });
		expect(db.rows("posts")).toHaveLength(1);
		expect(postOps("delete")).toHaveLength(0);
	});

	it("skips a closed-looking row with no parseable timestamps", async () => {
		const { purgeExpired } = await loadPosts();
		db.rows("posts").push({
			id: "broken-1",
			status: "solved",
			deleted: false,
			status_history: [{ status: "solved", at: "garbage" }],
			updated_at: null,
			created_at: null,
		});

		expect(await purgeExpired()).toEqual({ purged: 0, skipped: false });
		expect(db.rows("posts")).toHaveLength(1);
	});

	it("unlinks linked polls before deleting the post row", async () => {
		const { purgeExpired } = await loadPosts();
		db.rows("posts").push(closedPost({ id: "due-1" }));
		db.rows("polls").push({ id: "poll-1", post_id: "due-1" });

		await purgeExpired();

		const unlinkIdx = db.ops.findIndex(
			(o) => o.table === "polls" && o.op === "update",
		);
		const deleteIdx = db.ops.findIndex(
			(o) => o.table === "posts" && o.op === "delete",
		);
		expect(unlinkIdx).toBeGreaterThanOrEqual(0);
		expect(deleteIdx).toBeGreaterThan(unlinkIdx);
		expect(db.rows("polls")[0].post_id).toBeNull();
	});

	it("aborts before deleting the post when the poll unlink fails", async () => {
		const { purgeExpired } = await loadPosts();
		db.rows("posts").push(closedPost({ id: "due-1" }));
		db.failures.set("polls:update", new Error("unlink failed"));

		await expect(purgeExpired()).rejects.toThrow("unlink failed");

		// The parent row must survive — otherwise the next sweep can never
		// re-select it and polls.post_id dangles forever.
		expect(db.rows("posts")).toHaveLength(1);
		expect(postOps("delete")).toHaveLength(0);
	});

	it("does nothing when the master auto-delete toggle is off", async () => {
		const { purgeExpired } = await loadPosts();
		addSettings("retention_config", { auto_delete_enabled: false });
		db.rows("posts").push(closedPost({ id: "due-1" }));

		expect(await purgeExpired()).toEqual({ purged: 0, skipped: false });
		expect(postOps("select")).toHaveLength(0);
		expect(db.rows("posts")).toHaveLength(1);
	});

	it("does nothing when the solved_posts class toggle is off", async () => {
		const { purgeExpired } = await loadPosts();
		addSettings("retention_config", { classes: { solved_posts: false } });
		db.rows("posts").push(closedPost({ id: "due-1" }));

		expect(await purgeExpired()).toEqual({ purged: 0, skipped: false });
		// Only the CLOSED sweep is class-gated. The user-deleted sweep is a
		// separate class and legitimately still selects deleted rows, so assert
		// on the closed-status select rather than on every `posts` select.
		const closedSelects = db.ops.filter(
			(o) =>
				o.table === "posts" &&
				o.op === "select" &&
				o.filters.some((f) => f.kind === "in" && f.col === "status"),
		);
		expect(closedSelects).toHaveLength(0);
		expect(postOps("delete")).toHaveLength(0);
		expect(db.rows("posts")).toHaveLength(1);
	});

	it("respects the persisted 1h cooldown across cold starts", async () => {
		const { purgeExpired } = await loadPosts();
		addSettings("purge_state", { last_purge_at: iso(Date.now() - 60 * 1000) });
		db.rows("posts").push(closedPost({ id: "due-1" }));

		expect(await purgeExpired()).toEqual({ purged: 0, skipped: true });
		expect(postOps("select")).toHaveLength(0);
		expect(db.rows("posts")).toHaveLength(1);
	});

	it("runs again once the persisted cooldown has elapsed", async () => {
		const { purgeExpired } = await loadPosts();
		addSettings("purge_state", { last_purge_at: iso(Date.now() - 2 * 60 * 60 * 1000) });
		db.rows("posts").push(closedPost({ id: "due-1" }));

		expect(await purgeExpired()).toEqual({ purged: 1, skipped: false });
		expect(db.rows("posts")).toHaveLength(0);
	});

	it("records the run timestamp so the next call is throttled", async () => {
		const { purgeExpired } = await loadPosts();
		db.rows("posts").push(closedPost({ id: "due-1" }));

		await purgeExpired();

		const state = db.rows("settings").find((s) => s.key === "purge_state");
		expect(state).toBeTruthy();
		expect(typeof (state?.value as Row)?.last_purge_at).toBe("string");
	});
});

// ───────────────────────────────────────────────────────────────────
// runCleanup — the janitor sweep
// ───────────────────────────────────────────────────────────────────

describe("runCleanup closed sweep", () => {
	async function loadCleanup() {
		return import("../../api/_cleanup.js");
	}

	function closedDeletes() {
		return db.ops.filter((o) => o.table === "posts" && o.op === "delete");
	}

	it("hard-deletes expired solved and archived posts", async () => {
		const { runCleanup } = await loadCleanup();
		db.rows("posts").push(
			closedPost({ id: "solved-1", status: "solved" }),
			closedPost({ id: "archived-1", status: "archived" }),
		);

		const result = await runCleanup();

		expect(result?.details.deleted_solved_posts).toBe(2);
		expect(closedDeletes()[0].ids).toEqual(["solved-1", "archived-1"]);
		expect(db.rows("posts")).toHaveLength(0);
	});

	it("leaves a closed post inside the activity window alone", async () => {
		const { runCleanup } = await loadCleanup();
		const now = Date.now();
		db.rows("posts").push(
			closedPost({
				id: "recent-1",
				status_history: [{ status: "solved", at: iso(now - 3 * DAY) }],
				updated_at: iso(now - 2 * 60 * 60 * 1000),
			}),
		);

		const result = await runCleanup();

		expect(result?.details.deleted_solved_posts).toBeUndefined();
		expect(closedDeletes()).toHaveLength(0);
		expect(db.rows("posts")).toHaveLength(1);
	});

	it("skips the closed sweep when the solved_posts class is disabled", async () => {
		const { runCleanup } = await loadCleanup();
		addSettings("retention_config", { classes: { solved_posts: false } });
		db.rows("posts").push(closedPost({ id: "due-1" }));

		const result = await runCleanup();

		expect(result?.details.solved_posts_skipped).toBe(true);
		expect(result?.details.deleted_solved_posts).toBeUndefined();
		expect(closedDeletes()).toHaveLength(0);
		expect(db.rows("posts")).toHaveLength(1);
	});

	it("skips the closed sweep when the master auto-delete toggle is off", async () => {
		const { runCleanup } = await loadCleanup();
		addSettings("retention_config", { auto_delete_enabled: false });
		db.rows("posts").push(closedPost({ id: "due-1" }));

		const result = await runCleanup();

		expect(result?.details.auto_delete_skipped).toBe(true);
		expect(result?.details.deleted_solved_posts).toBeUndefined();
		expect(closedDeletes()).toHaveLength(0);
		expect(db.rows("posts")).toHaveLength(1);
	});

	it("does not touch open posts that share the table", async () => {
		const { runCleanup } = await loadCleanup();
		db.rows("posts").push(
			{ id: "open-1", status: "in_progress", deleted: false, created_at: iso(Date.now() - 90 * DAY), updated_at: iso(Date.now() - 90 * DAY) },
			closedPost({ id: "due-1" }),
		);

		const result = await runCleanup();

		expect(result?.details.deleted_solved_posts).toBe(1);
		expect(db.rows("posts").map((p) => p.id)).toEqual(["open-1"]);
	});

	it("respects the 15-minute cleanup cooldown", async () => {
		const { runCleanup } = await loadCleanup();
		addSettings("cleanup_state", { last_run_at: iso(Date.now() - 60 * 1000) });
		db.rows("posts").push(closedPost({ id: "due-1" }));

		expect(await runCleanup()).toBeNull();
		expect(closedDeletes()).toHaveLength(0);
		expect(db.rows("posts")).toHaveLength(1);
	});

	it("reports one closed-post window for both solved and archived", async () => {
		const { runCleanup } = await loadCleanup();
		const { CLOSED_RETENTION_DAYS } = await loadRetention();
		const result = await runCleanup();
		// Both keys survive for response compatibility, but a second value here
		// is exactly how the served copy and the sweep drifted apart before.
		expect(result?.retention.solved_posts_days).toBe(CLOSED_RETENTION_DAYS);
		expect(result?.retention.archived_posts_days).toBe(CLOSED_RETENTION_DAYS);
		expect(result?.retention.solved_posts_days).toBe(result?.retention.archived_posts_days);
	});
});
