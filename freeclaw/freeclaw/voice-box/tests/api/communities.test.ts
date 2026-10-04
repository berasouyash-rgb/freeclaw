// ═══════════════════════════════════════════════════════════════════
// Communities API — settings-backed community CRUD + discussion feed
// ═══════════════════════════════════════════════════════════════════
// Locks the real behavior: create with validation + per-user cap, list
// (hidden filtered), detail with membership state, join/leave, member-only
// posting with a 15s cooldown, comments, reaction toggles, reports flowing
// into the `reports` table, and admin hide/unhide/delete.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const tableData: Record<string, Record<string, unknown>> = {};
const from = vi.fn();
const isAdminMock = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: isAdminMock,
	clean: (v: unknown, max: number) => {
		const s = typeof v === "string" ? v : "";
		return s.length > max ? s.slice(0, max) : s;
	},
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (err: unknown) => (err instanceof Error ? err.message : null),
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

function settingsChain() {
	const filters: Record<string, unknown> = {};
	let _limit = 200;
	let _select = "";
	const chain = {
		select(cols: string) {
			_select = cols;
			return this;
		},
		eq(col: string, val: unknown) {
			filters[col] = val;
			return this;
		},
		ilike(col: string, pattern: unknown) {
			filters[col] = pattern;
			return this;
		},
		limit(n: number) {
			_limit = n;
			return this;
		},
		async maybeSingle() {
			// settings rows are stored as { key, value } — callers read row.value
			const key = String(filters["key"] ?? "");
			const row = tableData["settings"][key];
			return { data: row ?? null, error: null };
		},
		then(onResolve: (v: unknown) => void) {
			// list-style query (ilike on key) — thenable contract: call onResolve
			const pattern = String(filters["key"] ?? "community:%");
			const prefix = pattern.replace("%", "");
			const rows = Object.entries(tableData["settings"])
				.filter(([k, v]) => k.startsWith(prefix) && v !== undefined)
				.slice(0, _limit)
				.map(([, value]) => ({ key: value.key, value: value.value }));
			onResolve({ data: rows, error: null });
		},
		async upsert(payload: { key: string; value: unknown }) {
			// stored as a { key, value } row, matching the real settings table
			tableData["settings"][payload.key] = { key: payload.key, value: payload.value };
			return { error: null };
		},
		delete() {
			// `delete().eq("key", k)` — eq runs after delete() returns, so the
			// deletion must happen at await time (thenable), not synchronously.
			const thenable = {
				eq(col: string, val: unknown) {
					filters[col] = val;
					return thenable;
				},
				then(onResolve: (v: unknown) => void) {
					const key = String(filters["key"] ?? "");
					delete tableData["settings"][key];
					onResolve({ error: null });
				},
			};
			return thenable;
		},
	};
	return chain;
}

from.mockImplementation((table: string) => {
	if (table === "reports") {
		return {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			ilike: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			async insert(payload: Record<string, unknown>) {
				const rows = (tableData["reports"] = tableData["reports"] || {});
				const id = `r_${Object.keys(rows).length + 1}`;
				rows[id] = { id, ...payload };
				return { error: null };
			},
			async maybeSingle() {
				return { data: null, error: null };
			},
		};
	}
	return settingsChain();
});

function req(action: string, body: Record<string, unknown> = {}) {
	return {
		method: "POST",
		query: {},
		body: { action, ...body },
	};
}
function getReq(action: string, query: Record<string, string> = {}) {
	return { method: "GET", query: { action, ...query }, body: {} };
}

let handler: (req: unknown, res: unknown) => Promise<unknown>;

beforeEach(async () => {
	tableData["settings"] = {};
	tableData["reports"] = {};
	isAdminMock.mockReset();
	isAdminMock.mockResolvedValue(false);
	vi.resetModules();
	({ default: handler } = await import("../../api/_communities.js"));
});

describe("communities — create & list", () => {
	it("creates a community and lists it publicly", async () => {
		const res = response();
		await handler(req("create", { name: "Study Gang", description: "Cram together", avatar: "📚", anon_id: "anon_a" }), res);
		expect(res.statusCode).toBe(201);
		expect((res.body as { community: { slug: string } }).community.slug).toBe("study-gang");

		const res2 = response();
		await handler(getReq("list"), res2);
		const list = (res2.body as { communities: { slug: string; member_count: number }[] }).communities;
		expect(list).toHaveLength(1);
		expect(list[0].slug).toBe("study-gang");
		expect(list[0].member_count).toBe(1); // creator auto-joined
	});

	it("rejects a duplicate name with 409", async () => {
		await handler(req("create", { name: "Study Gang", anon_id: "anon_a" }), response());
		const res = response();
		await handler(req("create", { name: "Study Gang", anon_id: "anon_b" }), res);
		expect(res.statusCode).toBe(409);
	});

	it("rejects invalid names and bad avatars", async () => {
		for (const name of ["", "A", "!!!@@@###"]) {
			const res = response();
			await handler(req("create", { name, anon_id: "anon_a" }), res);
			expect(res.statusCode).toBe(400);
		}
		const res = response();
		await handler(req("create", { name: "OK Name", avatar: "not-an-emoji!", anon_id: "anon_a" }), res);
		expect(res.statusCode).toBe(400);
	});

	it("clamps over-long names to 40 chars instead of rejecting them", async () => {
		const res = response();
		await handler(req("create", { name: "x".repeat(50), anon_id: "anon_a" }), res);
		expect(res.statusCode).toBe(201);
		const slug = (res.body as { community: { slug: string } }).community.slug;
		expect(slug.length).toBeLessThanOrEqual(40);
	});

	it("caps a single user at 5 created communities", async () => {
		for (let i = 0; i < 5; i++) {
			const res = response();
			await handler(req("create", { name: `Group ${i}`, anon_id: "anon_a" }), res);
			expect(res.statusCode).toBe(201);
		}
		const res = response();
		await handler(req("create", { name: "Sixth One", anon_id: "anon_a" }), res);
		expect(res.statusCode).toBe(400);
		// other users are unaffected
		const res2 = response();
		await handler(req("create", { name: "Other User's", anon_id: "anon_b" }), res2);
		expect(res2.statusCode).toBe(201);
	});
});

describe("communities — membership", () => {
	beforeEach(async () => {
		await handler(req("create", { name: "Gamers", anon_id: "anon_creator" }), response());
	});

	it("join adds a member and leave removes them", async () => {
		const res = response();
		await handler(req("join", { slug: "gamers", anon_id: "anon_2" }), res);
		expect(res.statusCode).toBe(200);

		const detail = response();
		await handler(getReq("get", { slug: "gamers", anon_id: "anon_2" }), detail);
		const d = detail.body as { is_member: boolean; member_count: number };
		expect(d.is_member).toBe(true);
		expect(d.member_count).toBe(2);

		await handler(req("leave", { slug: "gamers", anon_id: "anon_2" }), response());
		const detail2 = response();
		await handler(getReq("get", { slug: "gamers", anon_id: "anon_2" }), detail2);
		expect((detail2.body as { is_member: boolean }).is_member).toBe(false);
	});

	it("posts are member-only", async () => {
		const res = response();
		await handler(req("post", { slug: "gamers", anon_id: "anon_outsider", text: "hi" }), res);
		expect(res.statusCode).toBe(403);

		await handler(req("join", { slug: "gamers", anon_id: "anon_outsider" }), response());
		const res2 = response();
		await handler(req("post", { slug: "gamers", anon_id: "anon_outsider", text: "hello!" }), res2);
		expect(res2.statusCode).toBe(201);
	});

	it("enforces a 15s posting cooldown per user", async () => {
		const res = response();
		await handler(req("post", { slug: "gamers", anon_id: "anon_creator", text: "first" }), res);
		expect(res.statusCode).toBe(201);
		const res2 = response();
		await handler(req("post", { slug: "gamers", anon_id: "anon_creator", text: "second" }), res2);
		expect(res2.statusCode).toBe(429);
	});
});

describe("communities — discussion feed", () => {
	beforeEach(async () => {
		await handler(req("create", { name: "Book Club", anon_id: "anon_a" }), response());
		await handler(req("join", { slug: "book-club", anon_id: "anon_b" }), response());
	});

	it("stores posts, comments, and reaction toggles", async () => {
		await handler(req("post", { slug: "book-club", anon_id: "anon_a", author: "Alice", text: "Reading Dune?" }), response());
		const detail = response();
		await handler(getReq("get", { slug: "book-club", anon_id: "anon_b" }), detail);
		const d = detail.body as { posts: { id: string }[] };
		expect(d.posts).toHaveLength(1);
		const postId = d.posts[0].id;

		// comment
		const c = response();
		await handler(req("comment", { slug: "book-club", post_id: postId, anon_id: "anon_b", author: "Bob", text: "Yes!" }), c);
		expect(c.statusCode).toBe(201);

		// react on → off (toggle)
		const r1 = response();
		await handler(req("react", { slug: "book-club", post_id: postId, anon_id: "anon_b", kind: "support" }), r1);
		expect((r1.body as { active: boolean }).active).toBe(true);
		const r2 = response();
		await handler(req("react", { slug: "book-club", post_id: postId, anon_id: "anon_b", kind: "support" }), r2);
		expect((r2.body as { active: boolean }).active).toBe(false);

		// reflected in detail (no double count)
		const d2 = response();
		await handler(getReq("get", { slug: "book-club", anon_id: "anon_a" }), d2);
		const post = (d2.body as { posts: { comments: unknown[]; reaction_counts: Record<string, number>; mine_reactions: Record<string, boolean> }[] }).posts[0];
		expect(post.comments).toHaveLength(1);
		// support was toggled on then off → no key, never a stale count
		expect(post.reaction_counts.support ?? 0).toBe(0);
		expect(post.mine_reactions.support ?? false).toBe(false);
	});

	it("reports a post into the reports table for admin review", async () => {
		await handler(req("post", { slug: "book-club", anon_id: "anon_a", text: "spam spam" }), response());
		const detail = response();
		await handler(getReq("get", { slug: "book-club", anon_id: "anon_b" }), detail);
		const postId = (detail.body as { posts: { id: string }[] }).posts[0].id;

		const res = response();
		await handler(req("report", { slug: "book-club", post_id: postId, anon_id: "anon_b", reason: "Spam" }), res);
		expect(res.statusCode).toBe(201);
		const reports = Object.values(tableData["reports"] as Record<string, { target_type: string; target_id: string; status: string }>);
		expect(reports).toHaveLength(1);
		expect(reports[0].target_type).toBe("community_post");
		expect(reports[0].target_id).toBe(`book-club::${postId}`);
		expect(reports[0].status).toBe("pending");
	});

	it("blocks school-prohibited content in posts and comments via the safety pipeline", async () => {
		const bad = response();
		await handler(
			req("post", { slug: "book-club", anon_id: "anon_a", text: "fuck this homework" }),
			bad,
		);
		expect(bad.statusCode).toBe(403);
		expect((bad.body as { code?: string }).code).toBe("CONTENT_BLOCKED");

		const good = response();
		await handler(
			req("post", { slug: "book-club", anon_id: "anon_b", text: "Reading Dune this weekend?" }),
			good,
		);
		expect(good.statusCode).toBe(201);

		const detail = response();
		await handler(getReq("get", { slug: "book-club", anon_id: "anon_b" }), detail);
		const postId = (detail.body as { posts: { id: string }[] }).posts[0].id;

		const badComment = response();
		await handler(
			req("comment", { slug: "book-club", post_id: postId, anon_id: "anon_b", text: "you are a bitch" }),
			badComment,
		);
		expect(badComment.statusCode).toBe(403);
	});
});	describe("communities — admin moderation", () => {
	let admin = false;
	beforeEach(async () => {
		admin = false;
		isAdminMock.mockImplementation(() => Promise.resolve(admin));
		await handler(req("create", { name: "Hot Takes", anon_id: "anon_a" }), response());
	});

	it("blocks non-admins from hide/delete", async () => {
		const res = response();
		await handler(req("admin", { slug: "hot-takes", op: "hide" }), res);
		expect(res.statusCode).toBe(403);
	});

	it("hides a community from public lists but keeps it for admins", async () => {
		admin = true;
		await handler(req("admin", { slug: "hot-takes", op: "hide" }), response());

		// public list (admin=false) filters hidden
		admin = false;
		const pub = response();
		await handler(getReq("list"), pub);
		expect((pub.body as { communities: unknown[] }).communities).toHaveLength(0);

		// admin list shows it flagged hidden
		admin = true;
		const adminList = response();
		await handler(getReq("list"), adminList);
		expect((adminList.body as { communities: { hidden: boolean }[] }).communities[0].hidden).toBe(true);

		// unhide → public again
		await handler(req("admin", { slug: "hot-takes", op: "unhide" }), response());
		const pub2 = response();
		await handler(getReq("list"), pub2);
		expect((pub2.body as { communities: unknown[] }).communities).toHaveLength(1);
	});

	it("deletes a community entirely", async () => {
		admin = true;
		await handler(req("admin", { slug: "hot-takes", op: "delete" }), response());
		const pub = response();
		await handler(getReq("list"), pub);
		expect((pub.body as { communities: unknown[] }).communities).toHaveLength(0);
	});
});

describe("communities — photos & polls", () => {
	beforeEach(async () => {
		await handler(req("create", { name: "Tech Talk", anon_id: "anon_a", photo: "data:image/png;base64,AAAA" }), response());
		await handler(req("join", { slug: "tech-talk", anon_id: "anon_b" }), response());
	});

	it("stores and returns a community photo", async () => {
		const res = response();
		await handler(getReq("get", { slug: "tech-talk" }), res);
		expect((res.body as { photo: string }).photo).toBe("data:image/png;base64,AAAA");
	});

	it("rejects non-image photo URLs on create", async () => {
		const res = response();
		await handler(req("create", { name: "Bad Photo", photo: "javascript:alert(1)", anon_id: "anon_x" }), res);
		expect(res.statusCode).toBe(400);
	});

	it("creates a post with a poll and exposes vote counts + my_vote", async () => {
		const res = response();
		await handler(req("post", { slug: "tech-talk", anon_id: "anon_a", text: "Which stack?", poll: { question: "React or Vue?", options: ["React", "Vue", "Svelte"] } }), res);
		expect(res.statusCode).toBe(201);

		const detail = response();
		await handler(getReq("get", { slug: "tech-talk", anon_id: "anon_b" }), detail);
		const post = (detail.body as { posts: { poll: { question: string; options: { id: string; text: string; votes: number }[]; total_votes: number; my_vote: string | null } }[] }).posts[0];
		expect(post.poll.question).toBe("React or Vue?");
		expect(post.poll.options).toHaveLength(3);
		expect(post.poll.total_votes).toBe(0);
		expect(post.poll.my_vote).toBeNull();
	});

	it("enforces one-person-one-vote and records the vote", async () => {
		await handler(req("post", { slug: "tech-talk", anon_id: "anon_a", text: "Poll", poll: { question: "A or B?", options: ["A", "B"] } }), response());
		const detail = response();
		await handler(getReq("get", { slug: "tech-talk", anon_id: "anon_b" }), detail);
		const postId = (detail.body as { posts: { id: string }[] }).posts[0].id;

		const poll = (detail.body as { posts: { poll: { options: { id: string; text: string }[] } }[] }).posts[0].poll;
		const optA = poll.options.find((o) => o.text === "A");
		const optB = poll.options.find((o) => o.text === "B");

		// vote A
		const v1 = response();
		await handler(req("vote", { slug: "tech-talk", post_id: postId, anon_id: "anon_b", option_id: optA?.id }), v1);
		expect(v1.statusCode).toBe(200);

		// vote B — moves the previous vote
		await handler(req("vote", { slug: "tech-talk", post_id: postId, anon_id: "anon_b", option_id: optB?.id }), response());

		const d2 = response();
		await handler(getReq("get", { slug: "tech-talk", anon_id: "anon_b" }), d2);
		const post = (d2.body as { posts: { poll: { options: { id: string; votes: number }[]; my_vote: string } }[] }).posts[0];
		expect(post.poll.my_vote).toBe(optB?.id);
		const b = post.poll.options.find((o) => o.id === optB?.id);
		expect(b?.votes).toBe(1);
	});

	it("rejects posts with fewer than 2 poll options", async () => {
		const res = response();
		await handler(req("post", { slug: "tech-talk", anon_id: "anon_a", text: "Poll", poll: { question: "Only one?", options: ["Only"] } }), res);
		expect(res.statusCode).toBe(400);
	});

	it("solving a poll deletes the poll together with the post", async () => {
		await handler(req("post", { slug: "tech-talk", anon_id: "anon_a", text: "Poll", poll: { question: "Yes?", options: ["Yes", "No"] } }), response());
		const detail = response();
		await handler(getReq("get", { slug: "tech-talk" }), detail);
		const postId = (detail.body as { posts: { id: string }[] }).posts[0].id;

		// non-creator cannot solve
		const denied = response();
		await handler(req("solve_poll", { slug: "tech-talk", post_id: postId, anon_id: "anon_b" }), denied);
		expect(denied.statusCode).toBe(403);

		// creator solves → post (and its poll) deleted
		const solved = response();
		await handler(req("solve_poll", { slug: "tech-talk", post_id: postId, anon_id: "anon_a" }), solved);
		expect(solved.statusCode).toBe(200);
		expect((solved.body as { deleted: boolean }).deleted).toBe(true);

		const d2 = response();
		await handler(getReq("get", { slug: "tech-talk" }), d2);
		expect((d2.body as { posts: unknown[] }).posts).toHaveLength(0);
	});

	it("allows the author to delete a post (poll included)", async () => {
		await handler(req("post", { slug: "tech-talk", anon_id: "anon_b", text: "Hello", poll: { question: "Q?", options: ["1", "2"] } }), response());
		const detail = response();
		await handler(getReq("get", { slug: "tech-talk" }), detail);
		const postId = (detail.body as { posts: { id: string }[] }).posts[0].id;

		const deleted = response();
		await handler(req("delete_post", { slug: "tech-talk", post_id: postId, anon_id: "anon_b" }), deleted);
		expect((deleted.body as { deleted: boolean }).deleted).toBe(true);

		const d2 = response();
		await handler(getReq("get", { slug: "tech-talk" }), d2);
		expect((d2.body as { posts: unknown[] }).posts).toHaveLength(0);
	});
});

describe("communities — detail edge cases", () => {
	it("returns 404 for unknown or hidden communities", async () => {
		const res = response();
		await handler(getReq("get", { slug: "nope" }), res);
		expect(res.statusCode).toBe(404);
	});

	it("returns 400 for unknown actions", async () => {
		const res = response();
		await handler(req("explode", {}), res);
		expect(res.statusCode).toBe(400);
	});
});

describe("communities — artifact hygiene & link integrity", () => {
	function seed(value: Record<string, unknown>, key?: string) {
		const k = key || `community:${value.slug}`;
		tableData["settings"][k] = { key: k, value };
	}

	it("hides test/fuzz artifact communities from the list", async () => {
		seed({
			slug: "study-gang",
			name: "Study Gang",
			created_at: "2026-09-01T00:00:00.000Z",
			members: ["anon_a"],
			posts: [],
		});
		seed({
			slug: "full-crud-test-210145",
			name: "Full CRUD Test 210145",
			created_at: "2026-09-02T00:00:00.000Z",
			members: [],
			posts: [],
		});
		seed({
			slug: "qa-test-community",
			name: "QA test community",
			created_at: "2026-09-03T00:00:00.000Z",
			members: [],
			posts: [],
		});
		const res = response();
		await handler(getReq("list"), res);
		const names = (res.body as { communities: { name: string }[] }).communities.map(
			(c) => c.name,
		);
		expect(names).toContain("Study Gang");
		expect(names).not.toContain("Full CRUD Test 210145");
		expect(names).not.toContain("QA test community");
	});

	it("repairs the link slug from the KV key when the value lost it", async () => {
		// Legacy row without `slug` inside the value — the list must still emit
		// a slug that resolves, or "Open" navigates to a 404 page.
		seed(
			{
				name: "Legacy Group",
				created_at: "2026-09-01T00:00:00.000Z",
				members: ["anon_a"],
				posts: [],
			},
			"community:legacy-group",
		);
		const res = response();
		await handler(getReq("list"), res);
		const list = (res.body as { communities: { slug: string }[] }).communities;
		expect(list.map((c) => c.slug)).toContain("legacy-group");

		const detail = response();
		await handler(getReq("get", { slug: "legacy-group" }), detail);
		expect(detail.statusCode).toBe(200);
		expect((detail.body as { slug: string }).slug).toBe("legacy-group");
	});

	it("filters seeded test posts and comments from the detail feed", async () => {
		seed({
			slug: "tech-talk",
			name: "Tech Talk",
			created_at: "2026-09-01T00:00:00.000Z",
			members: ["anon_a"],
			posts: [
				{
					id: "p-real",
					anon_id: "anon_a",
					author: "A",
					text: "Anyone else hyped for the science fair?",
					created_at: "2026-09-02T00:00:00.000Z",
					comments: [
						{ id: "c-real", text: "Same!" },
						{ id: "c-junk", text: "This is a test comment" },
					],
				},
				{
					id: "p-junk",
					anon_id: "anon_t",
					author: "T",
					text: "QA test post seeded by the harness",
					created_at: "2026-09-03T00:00:00.000Z",
					comments: [],
				},
			],
		});
		const res = response();
		await handler(getReq("get", { slug: "tech-talk" }), res);
		const body = res.body as {
			post_count: number;
			posts: { id: string; comments: { id: string }[] }[];
		};
		expect(body.posts.map((p) => p.id)).toEqual(["p-real"]);
		expect(body.posts[0].comments.map((c) => c.id)).toEqual(["c-real"]);
		expect(body.post_count).toBe(1);
	});
});
