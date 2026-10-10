// ═══════════════════════════════════════════════════════════════════
// Derived feed counts — scale correctness (silent-truncation class)
// ═══════════════════════════════════════════════════════════════════
// PostgREST silently caps uncapped selects at max-rows (1000). fetchRawCounts
// reads every reaction/comment/poll/vote row per chunk in single uncapped
// fetches, so a viral post's feed counts would freeze at the first page.
// The mock enforces the server cap (uncapped -> first 1000; ranged ->
// slice) so this file proves pagination instead of truncation. getRawCounts
// bypasses the SWR cache under VITEST, so this exercises the real query path.
import { beforeEach, describe, expect, it, vi } from "vitest";

const tables: Record<string, Array<Record<string, unknown>>> = {
	reactions: [],
	comments: [],
	polls: [],
	poll_votes: [],
};

const from = vi.fn();

vi.mock("../../api/_cache.js", () => ({
	staleWhileRevalidate: (fn: unknown) => ({
		// Only the fetch path is exercised here; the cache is bypassed.
		invalidate: vi.fn(),
		fetch: fn,
	}),
}));
vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

function chainFor(table: string) {
	const chain = {
		inF: [] as Array<[string, unknown[]]>,
		eqF: [] as Array<[string, unknown]>,
		rf: null as number | null,
		rt: null as number | null,
		select() {
			return this;
		},
		eq(col: string, val: unknown) {
			this.eqF.push([col, val]);
			return this;
		},
		in(col: string, values: unknown[]) {
			this.inF.push([col, values]);
			return this;
		},
		range(f: number, t: number) {
			this.rf = f;
			this.rt = t;
			return this;
		},
		then(onResolve: (v: unknown) => void) {
			const rows = (tables[table] || []).filter((r) =>
				this.eqF.every(([c, v]) => r[c] === v) &&
				this.inF.every(([c, vs]) => (vs as unknown[]).includes(r[c])),
			);
			// Server faithfulness: ranged reads slice, uncapped reads stop
			// at max-rows (1000).
			const out =
				this.rf !== null && this.rt !== null
					? rows.slice(this.rf, this.rt + 1)
					: rows.slice(0, 1000);
			onResolve({ data: out, error: null });
			return Promise.resolve(undefined);
		},
	};
	return chain;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	tables.reactions = [];
	tables.comments = [];
	tables.polls = [];
	tables.poll_votes = [];
	from.mockImplementation((table: string) => chainFor(table));
});

describe("getRawCounts — viral-post scale", () => {
	it("counts reactions past the 1000-row server page instead of truncating", async () => {
		tables.reactions = Array.from({ length: 1500 }, () => ({
			target_id: "post-1",
			kind: "support",
		}));
		tables.comments = [
			{ post_id: "post-1", deleted: false, hidden: false },
			{ post_id: "post-1", deleted: false, hidden: false },
			{ post_id: "post-1", deleted: false, hidden: false },
			{ post_id: "post-1", deleted: true, hidden: false },
		];
		tables.polls = [{ id: "poll-1", post_id: "post-1" }];
		tables.poll_votes = Array.from({ length: 5 }, () => ({
			poll_id: "poll-1",
		}));

		const { getRawCounts } = await import("../../api/_counts.js");
		const { rMap, cMap, pMap, pvMap } = await getRawCounts(["post-1"]);

		expect(rMap["post-1"]?.support).toBe(1500);
		expect(cMap["post-1"]).toBe(3);
		expect(pMap["post-1"]).toBe("poll-1");
		expect(pvMap["poll-1"]).toBe(5);
	});

	it("small chunks still cost a single page per query", async () => {
		tables.reactions = [{ target_id: "post-1", kind: "support" }];
		const { getRawCounts } = await import("../../api/_counts.js");
		const { rMap } = await getRawCounts(["post-1"]);
		expect(rMap["post-1"]?.support).toBe(1);
		// One short page stops the loop: no extra round trips for small data.
		const reactionCalls = from.mock.calls.filter(
			(args: unknown[]) => args[0] === "reactions",
		);
		expect(reactionCalls.length).toBe(1);
	});
});
