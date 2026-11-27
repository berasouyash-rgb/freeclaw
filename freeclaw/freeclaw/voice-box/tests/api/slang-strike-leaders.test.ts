// Slang escalation + leaders — regression tests.
// Rule: EVERY unique school-slang term in one blocked submission counts as
// one violation (repeating the same term inside a submission does not farm
// extra counts). The counter is SEPARATE from `users_meta.strikes`, which is
// owned by the human report ladder — slang NEVER auto-suspends or auto-bans.
// At ESCALATE_AT=3 violations the user is escalated for an admin scope
// decision (full block / browse only / feed only) or dismissal; nothing is
// blocked automatically. Leaders page aggregates the same scanSlang finder
// the gates use — never drifts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	users: {} as Record<string, Record<string, unknown>>,
	posts: [] as Array<Record<string, unknown>>,
	comments: [] as Array<Record<string, unknown>>,
}));

type Chain = Record<string, unknown> & {
	then: (fn: (v: unknown) => void) => void;
};

function chainFor(table: string): Chain {
	const eqs: Array<[string, unknown]> = [];
	let inFilter: { col: string; vals: Array<unknown> } | null = null;
	let op = "select";
	let patch: Record<string, unknown> = {};
	let single = false;
	let limitN: number | null = null;
	const rows = () =>
		table === "users_meta"
			? Object.values(state.users)
			: table === "posts"
				? state.posts
				: table === "comments"
					? state.comments
					: [];
	const matches = (r: Record<string, unknown>) =>
		eqs.every(([c, v]) => r[c] === v) &&
		(!inFilter || inFilter.vals.includes(r[inFilter.col]));
	const self: Chain = {
		then(fn) {
			if (op === "update") {
				for (const r of rows()) if (matches(r)) Object.assign(r, patch);
				fn({ data: null, error: null });
				return;
			}
			if (table === "users_meta" && !single) {
				fn({ data: rows().filter(matches), error: null });
				return;
			}
			let out = rows().filter(matches);
			if (limitN !== null) out = out.slice(0, limitN);
			fn({ data: single ? (out[0] ?? null) : out, error: null });
		},
		select() {
			return self;
		},
		eq(c: string, v: unknown) {
			eqs.push([c, v]);
			return self;
		},
		in(c: string, v: Array<unknown>) {
			inFilter = { col: c, vals: v };
			return self;
		},
		order() {
			return self;
		},
		limit(n: number) {
			limitN = n;
			return self;
		},
		gte() {
			return self;
		},
		maybeSingle() {
			single = true;
			return self;
		},
		single() {
			single = true;
			return self;
		},
		insert(row: Record<string, unknown>) {
			op = "insert";
			if (table === "users_meta" && row?.anon_id)
				state.users[String(row.anon_id)] = { ...(row as Record<string, unknown>) };
			return self;
		},
		update(p: Record<string, unknown>) {
			op = "update";
			patch = p;
			return self;
		},
		upsert() {
			return self;
		},
		delete() {
			return self;
		},
	};
	return self;
}

const from = vi.fn((t: string) => chainFor(t));
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
	notifyUser: vi.fn(),
}));
vi.mock("../../api/_auth.js", () => ({
	...authMocks,
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	clientIp: () => "test-ip",
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
	verifyCallerIdentity: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_events.js", () => ({
	EVENT_TYPES: {},
	emitEventAndBridge: vi.fn(async () => {}),
}));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	state.users = {};
	state.posts = [];
	state.comments = [];
	authMocks.isAdmin.mockResolvedValue(false);
});

// Four distinct school slangs (all in the shared lexicon).
const HEAVY = "sucks dumb bewakoof bakwas";

describe("strikeSlangAbuse (slang escalation)", () => {
	it("counts ONE violation per unique term — a single term already counts", async () => {
		const { strikeSlangAbuse } = await import("../../api/_reports.js");
		const out = await strikeSlangAbuse("anon_1", "comment", "dumb dumb dumb menu dumb");
		// "dumb" is the only unique slang term; repetition does not farm counts.
		expect(out).toMatchObject({ strike_applied: true, violations: 1, escalated: false });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"slang_violation",
			expect.stringContaining("anon_1"),
		);
		expect(authMocks.notifyUser).toHaveBeenCalledWith(
			"anon_1",
			"warning",
			expect.stringContaining("1/3"),
			expect.any(String),
		);
	});

	it("escalates in one submission once unique terms reach ESCALATE_AT", async () => {
		const { strikeSlangAbuse } = await import("../../api/_reports.js");
		// HEAVY = 4 unique terms → 4 violations ≥ 3 → escalate immediately.
		const out = await strikeSlangAbuse("anon_1", "post", HEAVY);
		expect(out).toMatchObject({ strike_applied: true, violations: 4, escalated: true });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"slang_escalated",
			expect.stringContaining("anon_1"),
		);
		expect(authMocks.notifyUser).toHaveBeenCalledWith(
			"anon_1",
			"warning",
			expect.stringContaining("moderator is reviewing"),
			expect.any(String),
		);
	});

	it("NEVER auto-suspends, auto-bans, or touches users_meta.strikes", async () => {
		// Seed a real row so the assertions are meaningful (not just
		// "undefined because no row exists").
		state.users["anon_1"] = { anon_id: "anon_1", strikes: 0, warnings: [] };
		const { strikeSlangAbuse } = await import("../../api/_reports.js");
		await strikeSlangAbuse("anon_1", "post", HEAVY);
		// The report ladder owns users_meta.strikes (STRIKE_SUSPEND_AT /
		// STRIKE_BAN_AT); slang must not write it or escalate on its own.
		expect(state.users["anon_1"]?.strikes).toBe(0);
		expect(state.users["anon_1"]?.suspended_until).toBeFalsy();
		expect(state.users["anon_1"]?.banned).toBeFalsy();
	});

	it("exempts ADMIN and non-anon ids", async () => {
		const { strikeSlangAbuse } = await import("../../api/_reports.js");
		for (const id of ["ADMIN", "anonymous", "", null]) {
			const out = await strikeSlangAbuse(id as unknown as string, "post", HEAVY);
			expect(out.strike_applied).toBe(false);
		}
		expect(authMocks.auditLog).not.toHaveBeenCalled();
	});

	it("records nothing when the text has no slang at all", async () => {
		const { strikeSlangAbuse } = await import("../../api/_reports.js");
		const out = await strikeSlangAbuse("anon_1", "post", "just a perfectly normal sentence");
		expect(out).toMatchObject({ strike_applied: false, violations: 0, escalated: false });
		expect(authMocks.auditLog).not.toHaveBeenCalled();
	});
});

describe("GET /api/admin slang_leaders", () => {
	function seed() {
		state.posts = [
			{ author_id: "anon_a", title: "sucks dumb menu", description: "bewakoof bakwas food", created_at: "2026-09-29T10:00:00Z" },
			{ author_id: "anon_b", title: "clean title", description: "clean description", created_at: "2026-09-29T10:00:00Z" },
		];
		state.comments = [
			{ author_id: "anon_a", body: "chup kar yaar", created_at: "2026-09-29T10:00:00Z" },
			{ author_id: "anon_c", body: "sucks", created_at: "2026-09-29T10:00:00Z" },
		];
		state.users = {
			"anon_a": { anon_id: "anon_a", strikes: 2, suspended_until: null, banned: false },
		};
	}

	async function get() {
		const { default: handler } = await import("../../api/_admin.js");
		const res = {
			statusCode: 200,
			body: undefined as unknown,
			status(code: number) {
				res.statusCode = code;
				return res;
			},
			json(body: unknown) {
				res.body = body;
				return res;
			},
			end() {
				return res;
			},
			setHeader() {
				return res;
			},
		};
		await handler(
			{ method: "GET", query: { action: "slang_leaders" }, body: {}, headers: { "x-admin-token": "tok" }, socket: { remoteAddress: "x" } },
			res,
		);
		return res;
	}

	it("ranks authors by hits with terms, items and live strike state", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		seed();
		const res = await get();
		expect(res.statusCode).toBe(200);
		const body = res.body as {
			leaders: Array<{ anon_id: string; hits: number; terms: string[]; items: number; strikes: number }>;
			scanned: { posts: number; comments: number };
			strike_terms_threshold: number;
		};
		expect(body.strike_terms_threshold).toBe(4);
		expect(body.scanned).toEqual({ posts: 2, comments: 2 });
		// anon_a: 4 post terms + chup kar + yaar = 6 hits across 2 items, first.
		expect(body.leaders[0].anon_id).toBe("anon_a");
		expect(body.leaders[0].hits).toBeGreaterThanOrEqual(5);
		expect(body.leaders[0].items).toBe(2);
		expect(body.leaders[0].strikes).toBe(2);
		// anon_c (1 hit) trails; clean anon_b absent entirely.
		expect(body.leaders.map((l) => l.anon_id)).toContain("anon_c");
		expect(body.leaders.map((l) => l.anon_id)).not.toContain("anon_b");
	});

	it("returns an honest empty state when nothing matches", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		const res = await get();
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ leaders: [], scanned: { posts: 0, comments: 0 } });
	});

	it("403s non-admins", async () => {
		authMocks.isAdmin.mockResolvedValue(false);
		seed();
		const res = await get();
		expect(res.statusCode).toBe(403);
	});
});
