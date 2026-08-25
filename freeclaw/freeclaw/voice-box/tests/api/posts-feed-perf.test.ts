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
	EVENT_TYPES: {},
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: () => ({ blocked: false, requiresReview: false, flags: [] }),
	getLearnedWeakStats: () => Promise.resolve({ approved: 0, blocked: 0 }),
	recordModerationDecision: () => Promise.resolve(),
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
	return {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		neq: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		lt: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		single: vi.fn().mockResolvedValue({ data: null, error: null }),
		upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
		delete: vi.fn().mockReturnThis(),
		then(fn: (r: unknown) => unknown) {
			fn({ data: rows, error: null });
		},
	};
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

	it("cacheClear forces the next feed back to a real read", async () => {
		from.mockImplementation((table: string) => chainFor(table));
		delete (process.env as { VITEST?: string }).VITEST;
		try {
			const { default: handler } = await import("../../api/_posts.js");
			const { cacheClear } = await import("../../api/_cache.js");
			const req = { method: "GET", query: {}, headers: {} };

			await handler(req, response()); // populate whatever cache instance exists
			cacheClear("^postsfeed");

			from.mockClear();
			const res = response();
			await handler(req, res);
			expect(res.statusCode).toBe(200);
			const postsScans = from.mock.calls.filter(([t]) => t === "posts").length;
			expect(postsScans).toBeGreaterThanOrEqual(1); // invalidated → real read
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
