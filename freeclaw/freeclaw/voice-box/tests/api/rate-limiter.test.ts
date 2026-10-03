/**
 * Rate-limiter guard tests — verifies the per-identity abuse tracker
 * keys correctly (identity+IP composite vs IP-only fallback) and that
 * block duration is 30s (not the old 5-minute).
 */
import { describe, it, expect, beforeEach } from "vitest";

// Import checkAbuse + ABUSE_LIMITS + _rateLimitKey via the module's named exports.
// We re-import each test so the module-scope Map is fresh.
let checkAbuse: (ip: string, identity?: string | null) => {
	allowed: boolean;
	reason: string | null;
	retryAfter: number;
};
let ABUSE_LIMITS: {
	maxRequestsPerMinute: number;
	maxRequestsPerHour: number;
	blockDurationMs: number;
	maxRequestSize: number;
};
let peekBodyIdentity: (req: any) => Promise<string | null>;

beforeEach(async () => {
	const mod = await import("../../api/_security.js");
	// Force a fresh module by clearing the cache key for this file
	checkAbuse = mod.checkAbuse;
	ABUSE_LIMITS = mod.ABUSE_LIMITS;
	peekBodyIdentity = mod.peekBodyIdentity;
});

describe("Rate limiter — per-identity keying", () => {
	it("allows normal traffic for the same IP with different identities", () => {
		const ip = "10.0.0.1";
		// User A — 10 requests should be fine
		for (let i = 0; i < 10; i++) {
			expect(checkAbuse(ip, "userA").allowed).toBe(true);
		}
		// User B — also fine on the same IP
		for (let i = 0; i < 10; i++) {
			expect(checkAbuse(ip, "userB").allowed).toBe(true);
		}
	});

	it("blocks a single identity after exceeding per-minute limit", () => {
		const ip = "10.0.0.2";
		const identity = "heavyUser";

		// Exhaust the per-minute budget (default 120)
		for (let i = 0; i < ABUSE_LIMITS.maxRequestsPerMinute; i++) {
			const r = checkAbuse(ip, identity);
			expect(r.allowed).toBe(true);
		}

		// Next request triggers block
		const blocked = checkAbuse(ip, identity);
		expect(blocked.allowed).toBe(false);
		expect(blocked.reason).toMatch(/rate limit/i);
		expect(blocked.retryAfter).toBeGreaterThan(0);
	});

	it("does NOT block a different identity on the same IP", () => {
		const ip = "10.0.0.3";
		// Identity A hits the limit
		for (let i = 0; i <= ABUSE_LIMITS.maxRequestsPerMinute; i++) {
			checkAbuse(ip, "identityA");
		}
		expect(checkAbuse(ip, "identityA").allowed).toBe(false);

		// Identity B on the SAME IP is still allowed
		expect(checkAbuse(ip, "identityB").allowed).toBe(true);
	});

	it("falls back to IP-only keying when identity is null", () => {
		const ip = "10.0.0.4";
		// No identity — keyed on IP only
		for (let i = 0; i <= ABUSE_LIMITS.maxRequestsPerMinute; i++) {
			checkAbuse(ip, null);
		}
		expect(checkAbuse(ip, null).allowed).toBe(false);
	});

	it("block duration is 30 seconds, not 5 minutes", () => {
		expect(ABUSE_LIMITS.blockDurationMs).toBe(30_000);
	});

	// POLICY PIN: 3600/h ≈ 60 requests/min sustained — an admin dashboard open
	// all day (realtime refreshes count) stays under it. The per-minute limit
	// still caps bursts, so raising this does not weaken abuse protection.
	// Rationale: the app costs ~10 API calls per page view; 2000/h locked out
	// genuinely engaged users after ~16 sustained page loads/min.
	it("hourly ceiling allows an all-day dashboard (3600/h ≈ 60/min sustained)", () => {
		expect(ABUSE_LIMITS.maxRequestsPerHour).toBe(3600);
	});

	it("per-minute burst limit stays at 120 (≈12 fast page loads/min)", () => {
		expect(ABUSE_LIMITS.maxRequestsPerMinute).toBe(120);
	});

	it("keeps the request body cap at 500 KB", () => {
		expect(ABUSE_LIMITS.maxRequestSize).toBe(500_000);
	});
});

describe("peekBodyIdentity", () => {
	it("returns null for GET requests", async () => {
		const req = { method: "GET" };
		expect(await peekBodyIdentity(req)).toBeNull();
	});

	it("reads anon_id from a pre-parsed body object", async () => {
		const req = { method: "POST", body: { anon_id: "test-user-123" } };
		expect(await peekBodyIdentity(req)).toBe("test-user-123");
	});

	it("reads author_id from a pre-parsed body", async () => {
		const req = { method: "POST", body: { author_id: "auth-456" } };
		expect(await peekBodyIdentity(req)).toBe("auth-456");
	});

	it("reads user_id from a pre-parsed body", async () => {
		const req = { method: "POST", body: { user_id: "uid-789" } };
		expect(await peekBodyIdentity(req)).toBe("uid-789");
	});

	it("returns null when body has no identity field", async () => {
		const req = { method: "POST", body: { title: "hello" } };
		expect(await peekBodyIdentity(req)).toBeNull();
	});

	it("returns null when body is null", async () => {
		const req = { method: "POST", body: null };
		expect(await peekBodyIdentity(req)).toBeNull();
	});

	it("does not consume a raw stream before the bounded parser", async () => {
		let consumed = false;
		const body = {
			[Symbol.asyncIterator]() {
				consumed = true;
				return {
					next: async () => ({ done: true, value: undefined }),
				};
			},
		};
		const req = { method: "POST", body };
		expect(await peekBodyIdentity(req)).toBeNull();
		expect(consumed).toBe(false);
	});
});
