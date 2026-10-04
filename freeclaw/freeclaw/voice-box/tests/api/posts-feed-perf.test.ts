// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE GUARD — feed cache contract
// ═══════════════════════════════════════════════════════════════════
// Layer 1 (mechanism): staleWhileRevalidate MUST collapse N identical reads
//   into ONE underlying fetch — this is the number that protects the DB
//   under load (N visitors ⇒ ~1 scan per TTL window).
// Layer 2 (route): the anonymous feed uses that mechanism and write paths
//   invalidate it. Route-level query-count assertions live in production,
//   not Vitest: the test runner's dynamic-import graph can instantiate a
//   fresh _cache per import, which would make counts here lie about prod.
// Production handler enables the cache when process.env.VITEST is absent;
// these tests delete the flag where they exercise the route.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
// Every `.select()` issued through the mocked client, so a test can assert on
// QUERY SHAPE (e.g. `{ count: "exact", head: true }`) instead of only on how
// many times `from()` was touched.
const selectCalls: { table: string; columns: string; opts?: unknown }[] = [];
// Real Postgres round trips. `from()` fires when a query CHAIN is built, but a
// PostgREST builder only reaches the database when it is awaited — so counting
// `from()` over-reports. This counter ticks inside `then()`/`maybeSingle()`/
// `single()`/`upsert()`, i.e. at the moment a request would leave the process.
const roundTrips = { n: 0 };

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
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(() => Promise.resolve()),
	emitEventAndBridge: vi.fn(() => Promise.resolve()),
	EVENT_TYPES: {},
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: () => ({ blocked: false, requiresReview: false, flags: [] }),
	getLearnedWeakStats: () => Promise.resolve({ approved: 0, blocked: 0 }),
	recordModerationDecision: () => Promise.resolve(),
	recordSafetyRepost: () => Promise.resolve(false),
	checkSafetyRepost: () => Promise.resolve({ blocked: false }),
}));
vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(() => Promise.resolve()),
}));

const POSTS = Array.from({ length: 5 }, (_, i) => ({
	id: `p${i}`,
	title: `Real community issue ${i}`,
	description: "Genuine description",
	category: "Other",
	status: "reported",
	hidden: false,
	deleted: false,
	pinned: false,
	featured: false,
	author_id: `anon_${i}`,
	created_at: new Date(Date.now() - i * 60_000).toISOString(),
	updated_at: new Date().toISOString(),
	status_history: [],
	tags: [],
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
	const rows = table === "posts" ? POSTS : [];
	const c = {
		select: vi.fn(),
		eq: vi.fn().mockReturnThis(),
		neq: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		lt: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		maybeSingle: vi.fn(async () => {
			roundTrips.n++;
			return { data: null, error: null };
		}),
		single: vi.fn(async () => {
			roundTrips.n++;
			return { data: null, error: null };
		}),
		upsert: vi.fn(async () => {
			roundTrips.n++;
			return { data: null, error: null };
		}),
		delete: vi.fn().mockReturnThis(),
		then(fn: (r: unknown) => unknown) {
			// A PostgREST builder only talks to Postgres when it is awaited, so
			// THIS is the moment a database round trip actually happens. Building
			// a chain (`.from()...select()`) is free — which is why counting
			// `from()` calls would over-report and hide a real regression.
			roundTrips.n++;
			fn({ data: rows, error: null });
		},
	};
	// Record every select() so tests can assert on query SHAPE — notably that
	// `{ count: "exact", head: true }` (the COUNT(*) scans) only fires where
	// the handler is allowed to issue one.
	c.select.mockImplementation((columns: unknown, opts?: unknown) => {
		selectCalls.push({
			table,
			columns: String(columns ?? ""),
			opts,
		});
		return c;
	});
	return c;
}

/** COUNT(*) probes: exact-head selects, regardless of table. */
function exactCountSelects(table?: string) {
	return selectCalls.filter(
		(s) =>
			(!table || s.table === table) &&
			!!s.opts &&
			(s.opts as { count?: string }).count === "exact" &&
			(s.opts as { head?: boolean }).head === true,
	);
}

describe("PERF GUARD — feed cache", () => {
	// ── Layer 1: the mechanism itself ───────────────────────────────
	it("staleWhileRevalidate collapses 50 identical reads into 1 fetch", async () => {
		const { staleWhileRevalidate } = await import("../../api/_cache.js");
		let fetches = 0;
		const swr = staleWhileRevalidate(
			async (key: string) => {
				fetches++;
				return [{ id: key }];
			},
			{ ttl: 10_000, staleTtl: 60_000, keyPrefix: "guard" },
		);

		for (let i = 0; i < 50; i++) {
			const out = await swr("same-key");
			expect(out).toEqual([{ id: "same-key" }]);
		}
		// THE MEASURED CONTRACT: 50 reads ⇒ 1 underlying fetch.
		expect(fetches).toBe(1);
	});

	it("distinct keys fetch independently; TTL expiry refetches", async () => {
		vi.useFakeTimers();
		try {
			const { staleWhileRevalidate } = await import("../../api/_cache.js");
			let fetches = 0;
			const swr = staleWhileRevalidate(
				async (k: string) => {
					fetches++;
					return { k };
				},
				{ ttl: 10_000, staleTtl: 60_000, keyPrefix: "guard2" },
			);

			await swr("a");
			await swr("b");
			expect(fetches).toBe(2); // distinct keys

			await swr("a"); // still fresh
			expect(fetches).toBe(2);

			vi.advanceTimersByTime(11_000); // past ttl, inside stale window
			const staleVal = await swr("a");
			expect(staleVal).toEqual({ k: "a" }); // served instantly from stale
			await vi.advanceTimersByTimeAsync(0); // background refresh completes
			expect(fetches).toBe(3); // exactly ONE background revalidation
		} finally {
			vi.useRealTimers();
		}
	});

	it("invalidate() clears every key so a write is visible immediately", async () => {
		const { staleWhileRevalidate } = await import("../../api/_cache.js");
		let fetches = 0;
		let version = 1;
		const swr = staleWhileRevalidate(
			async () => {
				fetches++;
				return [`v${version}`];
			},
			{ ttl: 60_000, staleTtl: 300_000, keyPrefix: "guard-invalidate" },
		);

		expect(await swr("feed")).toEqual(["v1"]);
		expect(await swr("feed")).toEqual(["v1"]);
		expect(fetches).toBe(1); // fresh hit — no second scan

		// A post is created. The OLD write path called cacheClear("^postsfeed"),
		// which only touched the cacheMem store — this closure kept serving the
		// pre-write value for the whole staleTtl, hiding new posts. The fix is
		// swrFn.invalidate(), which clears THIS closure's private map.
		version = 2;
		swr.invalidate();

		expect(await swr("feed")).toEqual(["v2"]);
		expect(fetches).toBe(2); // invalidated → real read
	});

	it("regression: without invalidate() the stale value hides a write for staleTtl", async () => {
		vi.useFakeTimers();
		try {
			const { staleWhileRevalidate } = await import("../../api/_cache.js");
			let fetches = 0;
			const swr = staleWhileRevalidate(
				async () => {
					fetches++;
					return fetches;
				},
				{ ttl: 100, staleTtl: 10_000, keyPrefix: "guard-stale-visibility" },
			);

			expect(await swr("k")).toBe(1);
			vi.advanceTimersByTime(200); // past ttl, deep inside the stale window
			// A write at t=200 is NOT visible: the stale v1 is served. Calling
			// invalidate() is what closes this window; the assertion documents it.
			expect(await swr("k")).toBe(1);
			await vi.advanceTimersByTimeAsync(0);
			expect(fetches).toBe(2); // one background refresh fired
		} finally {
			vi.useRealTimers();
		}
	});

	it("write paths in _posts.js call feedSWR.invalidate() (POST + PUT + DELETE)", async () => {
		const { readFileSync } = await import("node:fs");
		const src = readFileSync(
			new URL("../../api/_posts.js", import.meta.url),
			"utf8",
		);
		const calls = src.match(/feedSWR\.invalidate\(\)/g) || [];
		// Three write paths: POST (create), PUT (update/moderation), DELETE (remove).
		// A missing call means new/changed rows stay stale up to staleTtl again.
		expect(calls.length).toBeGreaterThanOrEqual(3);
	});

	it("every derived-count writer calls invalidateCounts()", async () => {
		const { readFileSync } = await import("node:fs");
		// _counts.js caches reactions/comments/polls/poll_votes aggregates. A
		// mutation that does not invalidate it leaves a wrong badge for up to
		// staleTtl (6s) — and worse, the counts SWR entry is keyed by id-set, so
		// the stale value is served as if fresh.
		const writers: [file: string, minCalls: number][] = [
			["_reactions.js", 1], // like/unlike toggle
			["_comments.js", 3], // create / update / delete
			["_polls.js", 4], // createPoll + vote + update + delete
			["_posts.js", 4], // purge sweep + create + update + hard delete
		];
		for (const [file, minCalls] of writers) {
			const src = readFileSync(
				new URL(`../../api/${file}`, import.meta.url),
				"utf8",
			);
			const calls = src.match(/invalidateCounts\(\)/g) || [];
			expect(calls.length, `${file} invalidateCounts() calls`).toBeGreaterThanOrEqual(minCalls);
		}
	});

	// ── Page-1 count query: the p95 line item ────────────────────────
	it("page 1 (paginate=1, no cursor) issues NO exact COUNT(*) on posts", async () => {
		from.mockImplementation((table: string) => chainFor(table));
		delete (process.env as { VITEST?: string }).VITEST;
		try {
			const { default: handler } = await import("../../api/_posts.js");
			const res = response();
			selectCalls.length = 0;
			await handler(
				{ method: "GET", query: { paginate: "1" }, headers: {} },
				res,
			);
			expect(res.statusCode).toBe(200);
			const body = res.body as { data: unknown[]; total: number };
			// Page 1 sees the whole filtered window, so rows.length IS the total.
			expect(body.total).toBe(POSTS.length);
			expect(body.data).toHaveLength(POSTS.length);
			// THE CONTRACT: the exact COUNT(*) used to run on EVERY page-1 read
			// and then be thrown away by `cursor ? sqlCount : rows.length`.
			expect(exactCountSelects("posts")).toHaveLength(0);
		} finally {
			process.env.VITEST = "1";
			vi.resetModules();
		}
	});

	it("cursor pages still run the exact COUNT(*) (their total is not observed)", async () => {
		from.mockImplementation((table: string) => chainFor(table));
		delete (process.env as { VITEST?: string }).VITEST;
		try {
			const { default: handler } = await import("../../api/_posts.js");
			const res = response();
			selectCalls.length = 0;
			await handler(
				{
					method: "GET",
					query: {
						paginate: "1",
						cursor: "2020-01-01T00:00:00.000Z",
					},
					headers: {},
				},
				res,
			);
			expect(res.statusCode).toBe(200);
			// Deeper pages never scanned the full set, so the header total has to
			// come from SQL — exactly one, not one per request shape.
			expect(exactCountSelects("posts")).toHaveLength(1);
		} finally {
			process.env.VITEST = "1";
			vi.resetModules();
		}
	});

	it("a warm page-1 read costs ZERO database round trips", async () => {
		from.mockImplementation((table: string) => chainFor(table));
		delete (process.env as { VITEST?: string }).VITEST;
		try {
			const { default: handler } = await import("../../api/_posts.js");
			const req = { method: "GET", query: { paginate: "1" }, headers: {} };

			// Cold: page-size settings + feed scan + 4 derived count queries.
			const res = response();
			await handler(req, res);
			expect(res.statusCode).toBe(200);
			const coldTrips = roundTrips.n;
			expect(coldTrips).toBeGreaterThan(1);

			// Warm (same second): feedSWR (10s) and countsSWR (3s) are both
			// fresh, the page-size settings read is memoized for 60s, and page 1
			// needs no total query. Nothing at all reaches Postgres — that is the
			// whole point of the derived-count layer.
			roundTrips.n = 0;
			const warm = response();
			await handler(req, warm);
			expect(warm.statusCode).toBe(200);
			expect((warm.body as { data: unknown[] }).data).toHaveLength(POSTS.length);
			expect(roundTrips.n).toBe(0);
		} finally {
			process.env.VITEST = "1";
			vi.resetModules();
		}
	});

	// ── Layer 2: route wiring ───────────────────────────────────────
	it("anonymous feed returns the cached shape and status 200", async () => {
		from.mockImplementation((table: string) => chainFor(table));
		delete (process.env as { VITEST?: string }).VITEST;
		try {
			const { default: handler } = await import("../../api/_posts.js");
			const res = response();
			await handler({ method: "GET", query: {}, headers: {} }, res);
			expect(res.statusCode).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			expect(res.body.length).toBe(POSTS.length);
		} finally {
			process.env.VITEST = "1";
			vi.resetModules();
		}
	});

	it("anonymous feed serves a warm read without repeating the full-table scan", async () => {
		from.mockImplementation((table: string) => chainFor(table));
		delete (process.env as { VITEST?: string }).VITEST;
		try {
			const { default: handler } = await import("../../api/_posts.js");
			const req = { method: "GET", query: {}, headers: {} };
			const postsScans = () =>
				from.mock.calls.filter(([t]) => t === "posts").length;

			await handler(req, response());
			const coldScans = postsScans();
			expect(coldScans).toBeGreaterThanOrEqual(1); // cold read hit the DB

			from.mockClear();
			await handler(req, response());
			// Warm read is served from staleWhileRevalidate's fresh entry, so the
			// expensive feed scan is skipped. Derived queries (counts) may still
			// run, hence "fewer", not "zero". This is the precondition that makes
			// write-time invalidation necessary — and the Layer-1 tests above prove
			// feedSWR.invalidate() is what closes the stale window.
			expect(postsScans()).toBeLessThan(coldScans);
		} finally {
			process.env.VITEST = "1";
			vi.resetModules();
		}
	});
});

// Shared helpers kept AFTER usage for readability parity with other suites
beforeEachShared();

function beforeEachShared() {
	from.mockReset();
	from.mockImplementation((table: string) => chainFor(table));
}

afterEach(() => {
	process.env.VITEST = "1";
});
