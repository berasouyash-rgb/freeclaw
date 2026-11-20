// ═══════════════════════════════════════════════════════════════════
// Rate limiter must report the REMAINING window, not a flat window length.
// Reported symptom: students were told to "try again in 60s" when the real
// limit was about to clear. `rateLimited()` returned a boolean, so every 429
// call site had to hardcode its own guess at the wait.
//
// This drives the REAL limiter (not a mock) with a stubbed DB count so the
// in-memory window arithmetic is exercised — the same approach as
// ai-narrate-ratelimit-real.test.ts.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

function chainStub(count: number) {
	const self: Record<string, (...a: unknown[]) => unknown> = {};
	for (const m of ["select", "eq", "gte"]) self[m] = () => self;
	self.then = (fn: (v: unknown) => void) =>
		fn({ count, error: null }) as unknown;
	return self;
}

const dbCount = { value: 0 };
vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn(() => chainStub(dbCount.value)) },
}));

const { rateLimited } = await import("../../api/_auth.js");

beforeEach(() => {
	vi.restoreAllMocks();
	dbCount.value = 0;
});

describe("rateLimited returns the time left in the window", () => {
	it("returns 0 while the caller is under the limit", async () => {
		// A non-table bucket keeps the counter purely in memory, which is the
		// path most 429s come from.
		const key = `bucket-under-${Math.random()}`;
		expect(await rateLimited(key, "anon_a", 60, 3)).toBe(0);
		expect(await rateLimited(key, "anon_a", 60, 3)).toBe(0);
		expect(await rateLimited(key, "anon_a", 60, 3)).toBe(0);
	});

	it("shrinks the wait as the window ages instead of repeating 60", async () => {
		const key = `bucket-age-${Math.random()}`;
		let now = 1_700_000_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);

		// Fill the budget.
		expect(await rateLimited(key, "anon_b", 60, 2)).toBe(0);
		expect(await rateLimited(key, "anon_b", 60, 2)).toBe(0);

		// Immediately blocked: the full window is left.
		expect(await rateLimited(key, "anon_b", 60, 2)).toBe(60);

		// 50 seconds later the answer must be ~10, NOT 60. This is the exact
		// lie the flat hardcoded 60 produced.
		now += 50_000;
		expect(await rateLimited(key, "anon_b", 60, 2)).toBe(10);

		// Never reports 0 while still blocked: 0 means "you may proceed".
		now += 9_900;
		expect(await rateLimited(key, "anon_b", 60, 2)).toBe(1);
	});

	it("opens a fresh window once the old one expires", async () => {
		const key = `bucket-reset-${Math.random()}`;
		let now = 1_700_000_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);

		expect(await rateLimited(key, "anon_c", 30, 1)).toBe(0);
		expect(await rateLimited(key, "anon_c", 30, 1)).toBe(30);
		now += 30_001;
		expect(await rateLimited(key, "anon_c", 30, 1)).toBe(0);
	});

	it("stays truthy when blocked, so existing boolean call sites still work", async () => {
		const key = `bucket-truthy-${Math.random()}`;
		expect(await rateLimited(key, "anon_d", 60, 1)).toBe(0);
		const blocked = await rateLimited(key, "anon_d", 60, 1);
		expect(blocked).toBeGreaterThan(0);
		expect(Boolean(blocked)).toBe(true);
	});
});
