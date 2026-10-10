// Search visibility boundary — public-content rule enforced in search.
// Locks (all verified against the real handler with a filtering mock):
//   1. Private posts never surface for strangers (no visibility leak).
//   2. pending_review posts never surface (no moderation-bypass snippets).
//   3. A viewer still finds their OWN private/pending posts.
//   4. Blocked (hidden) polls never surface.
//   5. Comments on non-visible posts never surface.
//   6. Non-admin user search is exact-match only with no ban disclosure;
//      admins keep partial search + status (moderation need).
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.now();

const POSTS = () => [
	{
		id: "pub-1",
		type: "problem",
		title: "Canteen food stale zzzpub",
		description: "Lunch quality poor",
		category: "Food",
		status: "reported",
		priority: "medium",
		author_id: "anon_other",
		created_at: new Date(NOW - 1000).toISOString(),
		tags: [],
		deleted: false,
		hidden: false,
		visibility: "public",
	},
	{
		id: "priv-mine",
		type: "problem",
		title: "Canteen food stale zzzpriv",
		description: "My private note",
		category: "Food",
		status: "reported",
		priority: "medium",
		author_id: "anon_me",
		created_at: new Date(NOW - 2000).toISOString(),
		tags: [],
		deleted: false,
		hidden: false,
		visibility: "private",
	},
	{
		id: "priv-theirs",
		type: "problem",
		title: "Canteen food stale zzztheirs",
		description: "Someone else private",
		category: "Food",
		status: "reported",
		priority: "medium",
		author_id: "anon_other",
		created_at: new Date(NOW - 3000).toISOString(),
		tags: [],
		deleted: false,
		hidden: false,
		visibility: "private",
	},
	{
		id: "pend-1",
		type: "problem",
		title: "Canteen food stale zzzpend",
		description: "Awaiting review",
		category: "Food",
		status: "pending_review",
		priority: "medium",
		author_id: "anon_other",
		created_at: new Date(NOW - 4000).toISOString(),
		tags: [],
		deleted: false,
		hidden: false,
		visibility: "public",
	},
];

const COMMENTS = () => [
	{
		id: "c-pub",
		post_id: "pub-1",
		body: "canteen zzcomment pub",
		author_id: "anon_x",
		created_at: new Date(NOW - 500).toISOString(),
		hidden: false,
		deleted: false,
	},
	{
		id: "c-priv",
		post_id: "priv-theirs",
		body: "canteen zzcomment priv",
		author_id: "anon_x",
		created_at: new Date(NOW - 600).toISOString(),
		hidden: false,
		deleted: false,
	},
];

const POLLS = () => [
	{
		id: "poll-open",
		title: "canteen zzpoll open",
		options: ["Yes", "No"],
		ptype: "yesno",
		author_id: "anon_x",
		created_at: new Date(NOW - 700).toISOString(),
		archived: false,
		deleted: false,
		hidden: false,
	},
	{
		id: "poll-blocked",
		title: "canteen zzpoll blocked",
		options: ["Yes", "No"],
		ptype: "yesno",
		author_id: "anon_x",
		created_at: new Date(NOW - 800).toISOString(),
		archived: false,
		deleted: false,
		hidden: true,
	},
];

const USERS = () => [
	{ anon_id: "anon_me", created_at: new Date(NOW - 900).toISOString() },
	{
		anon_id: "anon_banned_1",
		created_at: new Date(NOW - 950).toISOString(),
		banned: true,
	},
];

const state = vi.hoisted(() => ({
	admin: false,
}));

function likeMatch(value: unknown, pattern: string): boolean {
	const m = /^%(.*)%$/.exec(String(pattern).replace(/\\(.)/g, "$1"));
	if (!m) return String(value ?? "") === pattern;
	return String(value ?? "").toLowerCase().includes((m[1] ?? "").toLowerCase());
}

function chainFor(table: string, source: Array<Record<string, unknown>>) {
	let rows = [...source];
	const self: Record<string, (...a: never[]) => unknown> = {};
	self.select = () => self;
	self.eq = ((col: string, val: unknown) => {
		rows = rows.filter((r) => r[col] === val);
		return self;
	}) as (...a: never[]) => unknown;
	self.neq = ((col: string, val: unknown) => {
		rows = rows.filter((r) => r[col] !== val);
		return self;
	}) as (...a: never[]) => unknown;
	self.ilike = ((col: string, pattern: string) => {
		rows = rows.filter((r) => likeMatch(r[col], pattern));
		return self;
	}) as (...a: never[]) => unknown;
	self.or = ((expr: string) => {
		// top-level comma split (tag overlap term has no commas)
		const terms = String(expr).split(",");
		rows = rows.filter((r) =>
			terms.some((t) => {
				const ov = /^(\w+)\.ov\.\{([^}]*)\}$/.exec(t);
				if (ov) {
					const arr = r[ov[1]];
					return Array.isArray(arr) && arr.includes(ov[2]);
				}
				const m = /^(\w+)\.ilike\.(.+)$/.exec(t);
				if (!m) return false;
				return likeMatch(r[m[1]], m[2] ?? "");
			}),
		);
		return self;
	}) as (...a: never[]) => unknown;
	self.in = ((col: string, vals: unknown[]) => {
		rows = rows.filter((r) => (vals as unknown[]).includes(r[col]));
		return self;
	}) as (...a: never[]) => unknown;
	self.order = () => self;
	self.limit = ((n: number) => {
		rows = rows.slice(0, n);
		return self;
	}) as (...a: never[]) => unknown;
	self.then = (resolve: (v: unknown) => void) => {
		resolve({ data: rows, error: null });
	};
	return self;
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			if (table === "posts") return chainFor(table, POSTS());
			if (table === "comments") return chainFor(table, COMMENTS());
			if (table === "polls") return chainFor(table, POLLS());
			if (table === "users_meta") return chainFor(table, USERS());
			return chainFor(table, []);
		},
	},
}));

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn(async () => state.admin),
}));

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
		setHeader: vi.fn(),
	});
}

async function search(query: Record<string, unknown>) {
	vi.resetModules();
	const { default: handler } = await import("../../api/_search.js");
	const res = response();
	await handler(
		{ method: "GET", query: { type: "all", ...query }, headers: {} },
		res as never,
	);
	return res;
}

function ids(body: unknown): string[] {
	return ((body as { results: Array<{ id: string }> }).results || []).map(
		(r) => r.id,
	);
}

beforeEach(() => {
	state.admin = false;
});

describe("search visibility boundary", () => {
	it("hides private and pending-review posts from strangers", async () => {
		const res = await search({ q: "zzzpub" });
		expect(res.statusCode).toBe(200);
		expect(ids(res.body)).toContain("pub-1");
	});

	it("never surfaces another author's private post", async () => {
		const res = await search({ q: "zzztheirs" });
		expect(ids(res.body)).not.toContain("priv-theirs");
	});

	it("never surfaces pending-review posts (no snippet leak)", async () => {
		const res = await search({ q: "zzzpend" });
		expect(ids(res.body)).not.toContain("pend-1");
	});

	it("returns the viewer's own private post to them", async () => {
		const res = await search({
			q: "zzzpriv",
			viewer: "anon_me",
		});
		expect(ids(res.body)).toContain("priv-mine");
		expect(ids(res.body)).not.toContain("priv-theirs");
		expect(ids(res.body)).not.toContain("pend-1");
	});

	it("never surfaces blocked polls", async () => {
		const res = await search({ q: "zzpoll" });
		expect(ids(res.body)).toContain("poll-open");
		expect(ids(res.body)).not.toContain("poll-blocked");
	});

	it("never surfaces comments on non-visible posts", async () => {
		const res = await search({ q: "zzcomment" });
		expect(ids(res.body)).toContain("c-pub");
		expect(ids(res.body)).not.toContain("c-priv");
	});

	it("restricts non-admin user search to exact matches with no status disclosure", async () => {
		const partial = await search({ q: "anon_ban", type: "users" });
		expect(ids(partial.body)).not.toContain("anon_banned_1");
		const exact = await search({ q: "anon_banned_1", type: "users" });
		const row = (exact.body as { results: Array<Record<string, unknown>> })
			.results.find((r) => r.id === "anon_banned_1");
		expect(row).toBeTruthy();
		expect(row?.description).toBe("Member");
	});

	it("admins keep partial user search with moderation status", async () => {
		state.admin = true;
		const res = await search({ q: "anon_ban", type: "users" });
		const row = (res.body as { results: Array<Record<string, unknown>> }).results.find(
			(r) => r.id === "anon_banned_1",
		);
		expect(row).toBeTruthy();
		expect(row?.description).toBe("Banned");
	});
});
