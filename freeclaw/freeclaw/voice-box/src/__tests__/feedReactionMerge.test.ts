/**
 * Unit tests for the parent-side reaction merge.
 *
 * The contract: after your own toggle, the parent list must carry the
 * server's authoritative counts AND mine list at once — counts without mine
 * (or vice versa) leave the card showing one user's truth and another
 * user's badge, which is exactly the "reactions don't update" report.
 */
import { describe, it, expect } from "vitest";
import {
	mergeReactionCounts,
	applyServerMine,
} from "../lib/feedReactionMerge";
import type { PostData } from "../types";

function makePost(id: string, reactions: Record<string, number>): PostData {
	return { id, reactions } as PostData;
}

describe("mergeReactionCounts", () => {
	it("replaces only the toggled row's counts", () => {
		const posts = [
			makePost("a", { support: 5 }),
			makePost("b", { support: 1 }),
		];
		const next = mergeReactionCounts(posts, "a", { support: 6 });
		expect(next.find((p) => p.id === "a")?.reactions).toEqual({
			support: 6,
		});
		expect(next.find((p) => p.id === "b")?.reactions).toEqual({
			support: 1,
		});
	});

	it("drops stale kinds the server no longer reports", () => {
		const posts = [makePost("a", { support: 5, disagree: 2 })];
		const next = mergeReactionCounts(posts, "a", { support: 6 });
		expect(next.find((p) => p.id === "a")?.reactions).toEqual({
			support: 6,
		});
	});

	it("does not mutate the input list", () => {
		const posts = [makePost("a", { support: 5 })];
		mergeReactionCounts(posts, "a", { support: 6 });
		expect(posts[0]?.reactions).toEqual({ support: 5 });
	});

	it("leaves an unknown id untouched", () => {
		const posts = [makePost("a", { support: 5 })];
		const next = mergeReactionCounts(posts, "zzz", { support: 9 });
		expect(next).toEqual(posts);
	});
});

describe("applyServerMine", () => {
	it("stores the server mine list for the row", () => {
		const next = applyServerMine({}, "a", ["support"]);
		expect(next).toEqual({ a: ["support"] });
	});

	it("replaces a stale mine entry (toggle-off on another device)", () => {
		const next = applyServerMine({ a: ["support"] }, "a", []);
		expect(next).toEqual({});
	});

	it("keeps other rows' entries", () => {
		const next = applyServerMine({ b: ["upvote"] }, "a", ["support"]);
		expect(next).toEqual({ b: ["upvote"], a: ["support"] });
	});

	it("copies the array so later caller mutation cannot corrupt state", () => {
		const mine = ["support"];
		const next = applyServerMine({}, "a", mine);
		mine.push("upvote");
		expect(next).toEqual({ a: ["support"] });
	});
});
