// Concurrency cap — at most 6 requests in flight, rest wait FIFO.
// Locks the 100+ simultaneous users behavior: no socket exhaustion, no
// 429 storms, and every queued request eventually fires in order.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, resetConcurrencyForTests } from "../lib/api";

let resolvers: Array<(v: unknown) => void>;

function hangingFetch() {
	return new Promise((res) => {
		resolvers.push(res as (v: unknown) => void);
	});
}

async function pump(rounds = 30) {
	for (let i = 0; i < rounds; i++) await Promise.resolve();
}

beforeEach(() => {
	resolvers = [];
	resetConcurrencyForTests();
	global.fetch = vi.fn().mockImplementation(hangingFetch) as unknown as typeof fetch;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("concurrency cap", () => {
	it("holds at most 6 in flight and releases FIFO", async () => {
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		const ok = () => ({
			ok: true,
			status: 200,
			text: async () => "{}",
			headers: { get: () => null },
		});
		const drain = () => {
			for (const r of resolvers.splice(0)) r(ok());
		};
		const calls = Array.from({ length: 8 }, (_, i) =>
			api.getFresh(`/api/cap-${i}`),
		);
		await pump();
		// 8 distinct GETs (noCache → no dedup), only 6 may start
		expect(fetchMock).toHaveBeenCalledTimes(6);

		// Resolve exactly one; the 7th must fire (FIFO)
		resolvers.shift()!(ok());
		await pump();
		expect(fetchMock).toHaveBeenCalledTimes(7);

		// Drain everything — the 8th fires, then all settle
		drain();
		await pump();
		expect(fetchMock).toHaveBeenCalledTimes(8);
		drain();
		const results = await Promise.all(calls);
		expect(results).toHaveLength(8);
	});
});
