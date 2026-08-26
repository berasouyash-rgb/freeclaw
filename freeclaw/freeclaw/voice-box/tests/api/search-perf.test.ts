// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE GUARD — global search cache contract
// ═══════════════════════════════════════════════════════════════════
// The search endpoint previously re-ran up to 3 DB scans (~4,000 rows)
// for EVERY request. It now routes scans through module-scope
// stale-while-revalidate, so N identical searches inside the TTL window
// collapse into ONE set of DB scans.
//
// Layer 1 (mechanism): SWR collapses N identical search calls into 1 scan,
//   distinct queries scan independently, and maxEntries eviction bounds
//   memory for unbounded user-typed keys.
// Layer 2 (route): /api/search serves cached rows with correct shape and
//   per-request viewer masking still applied on top of cached data.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn(),
}));

const POSTS = Array.from({ length: 3 }, (_, i) => ({
	id: `p${i}`,
	type: "issue",
	title: `Library noise problem ${i}`,
	description: "Students cannot study",
	category: "Academics",
	status: "reported",
	priority: "medium",
	author_id: `anon_${i}`,
	created_at: new Date(Date.now() - i * 60_000).toISOString(),
	tags: ["library"],
	deleted: false,
	hidden: false,
}));
const COMMENTS = [
	{
		id: "c1",
		post_id: "p0",
		body: "I agree, the library is too loud",
		author_id: "anon_x",
		created_at: new Date().toISOString(),
		hidden: false,
	},
];
const POLLS = [];

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
	const rows =
		table === "posts" ? POSTS : table === "comments" ? COMMENTS : POLLS;
	return {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		neq: vi.fn().mockReturnThis(),
		ilike: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		then(fn: (r: unknown) => unknown) {
			fn({ data: rows, error: null });
		},
	};
}

describe("PERF GUARD — search cache", () => {
	beforeEach(() => {
		from.mockClear();
	});

	// ── Layer 1: mechanism ──────────────────────────────────────────
	it("staleWhileRevalidate evicts oldest entries past maxEntries (memory bound)", async () => {
		const { staleWhileRevalidate } = await import("../../api/_cache.js");
		let fetches = 0;
		const swr = staleWhileRevalidate(
			async (k: string) => {
				fetches++;
				return k;
			},
			{ ttl: 60_000, keyPrefix: "evict-guard", maxEntries: 10 },
		);

		// Fill beyond capacity — must not grow unbounded or throw
		for (let i = 0; i < 50; i++) await swr(`key-${i}`);
		expect(fetches).toBe(50);

		// Old entries were evicted; re-fetching an early key hits the fn again
		await swr("key-0");
		expect(fetches).toBe(51);
		// A recent key is still fresh
		await swr("key-49");
		expect(fetches).toBe(51);
	});

	// ── Layer 2: route wiring ───────────────────────────────────────
	it("N identical searches perform ONE set of DB scans; response keeps its shape", async () => {
		let postScans = 0;
		from.mockImplementation((table: string) => {
			if (table === "posts") postScans++;
			return chainFor(table);
		});

		const { default: handler } = await import("../../api/_search.js");

		let lastBody: { results: unknown[]; total: number } | undefined;
		for (let i = 0; i < 25; i++) {
			const res = response();
			await handler(
				{ method: "GET", query: { q: "library" }, headers: {} },
				res,
			);
			expect(res.statusCode).toBe(200);
			lastBody = res.body as typeof lastBody;
		}
		// THE MEASURED CONTRACT: 25 searches ⇒ 1 posts scan per table set.
		expect(postScans).toBe(1);
		expect(lastBody?.results.length).toBe(POSTS.length + COMMENTS.length);
		expect(lastBody?.total).toBe(POSTS.length + COMMENTS.length);
	});

	it("viewer masking stays per-request even when rows come from cache", async () => {
		from.mockImplementation((table: string) => chainFor(table));
		const { default: handler } = await import("../../api/_search.js");

		// Anonymous viewer: author ids masked to null
		const anonRes = response();
		await handler(
			{ method: "GET", query: { q: "library" }, headers: {} },
			anonRes,
		);
		const anonAuthors = (
			anonRes.body as { results: { author_id: string | null }[] }
		).results.map((r) => r.author_id);
		expect(anonAuthors.every((a) => a === null)).toBe(true);

		// Owner viewer: own author id revealed
		const ownerRes = response();
		await handler(
			{
				method: "GET",
				query: { q: "library", viewer: "anon_1" },
				headers: {},
			},
			ownerRes,
		);
		const ownerResults = (
			ownerRes.body as { results: { author_id: string | null }[] }
		).results;
		expect(ownerResults.some((r) => r.author_id === "anon_1")).toBe(true);
	});

	it("short queries are rejected without touching the DB", async () => {
		from.mockImplementation((table: string) => chainFor(table));
		const scansBefore = from.mock.calls.length;
		const { default: handler } = await import("../../api/_search.js");
		const res = response();
		await handler({ method: "GET", query: { q: "ab" }, headers: {} }, res);
		expect(res.statusCode).toBe(400);
		expect(from.mock.calls.length).toBe(scansBefore);
	});
});
