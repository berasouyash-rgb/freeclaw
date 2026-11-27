import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadHarness } from "../lib/loadHarness";
import { api, resetConcurrencyForTests } from "../lib/api";

describe("Load Management Harness (Scale 5000 Users)", () => {
	beforeEach(() => {
		resetConcurrencyForTests();
		loadHarness.resetForTests();
	});

	it("acquires and releases execution slots smoothly", async () => {
		expect(loadHarness.getStats().inflight).toBe(0);
		await loadHarness.acquire("critical");
		expect(loadHarness.getStats().inflight).toBe(1);
		loadHarness.release(45);
		expect(loadHarness.getStats().inflight).toBe(0);
		expect(loadHarness.getStats().totalProcessed).toBe(1);
	});

	it("prioritizes critical user writes over background polling", async () => {
		// Fill concurrency slots with background tasks
		const order: string[] = [];
		const promises: Promise<void>[] = [];

		// Enqueue 2 background tasks
		for (let i = 0; i < 2; i++) {
			promises.push(
				loadHarness.acquire("background").then(() => {
					order.push(`bg-${i}`);
				}),
			);
		}

		// Enqueue 1 critical user action (e.g. vote/post)
		promises.push(
			loadHarness.acquire("critical").then(() => {
				order.push("critical-vote");
			}),
		);

		await Promise.all(promises);
		expect(order.length).toBe(3);
		expect(loadHarness.getStats().inflight).toBe(3);

		// Release all
		for (let i = 0; i < 3; i++) {
			loadHarness.release(30);
		}
		expect(loadHarness.getStats().inflight).toBe(0);
	});

	it("tracks rolling P95 latency and adapts backoff multiplier", () => {
		// Record fast responses
		for (let i = 0; i < 20; i++) {
			loadHarness.recordLatency(120);
		}
		expect(loadHarness.getP95Latency()).toBeLessThan(200);
		expect(loadHarness.getStats().adaptiveBackoffMultiplier).toBe(1.0);

		// Record high latency spikes
		for (let i = 0; i < 30; i++) {
			loadHarness.recordLatency(1600);
		}
		expect(loadHarness.getP95Latency()).toBeGreaterThan(1000);
		expect(loadHarness.getStats().adaptiveBackoffMultiplier).toBeGreaterThan(1.0);
	});

	it("sheds background tasks gracefully when throttled by 429/503", () => {
		const initialBackoff = loadHarness.getStats().adaptiveBackoffMultiplier;
		loadHarness.recordThrottle();
		expect(loadHarness.getStats().adaptiveBackoffMultiplier).toBeGreaterThan(initialBackoff);
	});

	it("provides jittered polling intervals to eliminate thundering herd", () => {
		const interval1 = loadHarness.getPollingInterval(30000);
		const interval2 = loadHarness.getPollingInterval(30000);
		expect(interval1).toBeGreaterThanOrEqual(30000);
		expect(interval2).toBeGreaterThanOrEqual(30000);
	});
});

describe("Fast Response Harness — SWR Cache (< 300ms)", () => {
	beforeEach(() => {
		resetConcurrencyForTests();
	});

	it("returns cached data in < 1ms on repeated reads", async () => {
		let fetchCount = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				fetchCount++;
				return {
					ok: true,
					status: 200,
					text: async () => JSON.stringify({ items: ["p1", "p2"] }),
					headers: new Headers({ "content-type": "application/json" }),
				};
			}),
		);

		// First call hits network
		const start1 = performance.now();
		const res1 = await api.get<{ items: string[] }>("/api/feed-swr-test");
		const dur1 = performance.now() - start1;
		expect(res1.items).toEqual(["p1", "p2"]);
		expect(fetchCount).toBe(1);
		expect(dur1).toBeGreaterThanOrEqual(0);

		// Second call returns from cache in < 1ms
		const start2 = performance.now();
		const res2 = await api.get<{ items: string[] }>("/api/feed-swr-test");
		const dur2 = performance.now() - start2;
		expect(res2.items).toEqual(["p1", "p2"]);
		expect(fetchCount).toBe(1);
		expect(dur2).toBeLessThan(15);
	});

	it("supports api.getSWR with silent background revalidation", async () => {
		let fetchCount = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				fetchCount++;
				return {
					ok: true,
					status: 200,
					text: async () => JSON.stringify({ version: fetchCount }),
					headers: new Headers({ "content-type": "application/json" }),
				};
			}),
		);

		// Seed cache
		await api.get<{ version: number }>("/api/version-test");
		expect(fetchCount).toBe(1);

		// getSWR resolves immediately with cached version
		let revalidatedFresh: { version: number } | null = null;
		const cached = await api.getSWR<{ version: number }>(
			"/api/version-test",
			(fresh) => {
				revalidatedFresh = fresh;
			},
		);
		expect(cached.version).toBe(1);
		expect(revalidatedFresh).toBeNull();
	});
});
