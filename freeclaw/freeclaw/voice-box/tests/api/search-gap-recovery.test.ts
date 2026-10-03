// Search gap recovery — repeated zero-result queries become filed,
// verified knowledge gaps (spec: real repair, not tracked-and-ignored).
import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
const queued = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>> }));

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			if (table !== "settings") throw new Error("unexpected table " + table);
			return {
				select: () => ({
					eq: (_c: string, key: string) => ({
						maybeSingle: async () => ({
							data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
							error: null,
						}),
					}),
				}),
				upsert: async (row: { key: string; value: unknown }) => {
					kv.store.set(row.key, row.value);
					return { error: null };
				},
			};
		},
	},
}));

vi.mock("../../api/_improvements.js", () => ({
	queueImprovement: vi.fn(async (item: Record<string, unknown>) => {
		queued.items.push(item);
		return true;
	}),
}));

import {
	recordSearchEvent,
	recoverSearchGaps,
} from "../../api/_search-quality.js";

beforeEach(() => {
	kv.store.clear();
	queued.items.length = 0;
	vi.clearAllMocks();
});

describe("recoverSearchGaps", () => {
	it("files a gap after 3 zero-result searches and verifies it", async () => {
		for (let i = 0; i < 3; i++)
			recordSearchEvent({ query: "dormitory wifi password", results: 0 });
		const r = await recoverSearchGaps();
		expect(r.ok).toBe(true);
		expect(r.gaps_filed).toEqual(["dormitory wifi password"]);
		expect(r.verified).toBe(true);
		expect(queued.items).toHaveLength(1);
		expect(queued.items[0]).toMatchObject({
			category: "search",
			source: "search-gap-recovery",
		});
		expect(String(queued.items[0].title)).toContain("dormitory wifi password");
	});

	it("does not refile within the dedupe window", async () => {
		for (let i = 0; i < 4; i++)
			recordSearchEvent({ query: "canteen holiday hours", results: 0 });
		const first = await recoverSearchGaps();
		expect(first.gaps_filed).toContain("canteen holiday hours");
		const second = await recoverSearchGaps();
		expect(second.gaps_filed).not.toContain("canteen holiday hours");
		expect(second.skipped_filed).toBeGreaterThanOrEqual(1);
		expect(second.ok).toBe(true);
	});

	it("ignores queries below threshold and stays honest when empty", async () => {
		// NOTE: zero-result tallies are module-level (same serving instance),
		// so earlier tests' queries still qualify here — the assertion scopes
		// to the new below-threshold query only.
		recordSearchEvent({ query: "one-off oddity xyz", results: 0 });
		const r = await recoverSearchGaps();
		expect(r.ok).toBe(true);
		expect(r.gaps_filed).not.toContain("one-off oddity xyz");
		expect(r.verified).toBe(true);
	});
});
