import { describe, expect, it } from "vitest";
import { collapseDuplicatePolls } from "../pages/Polls";
import type { PollData } from "../types";

function poll(over: Partial<PollData> & { id: string }): PollData {
	return {
		title: "kya haal chaal",
		ptype: "single",
		options: ["Badhiya ekdam"],
		total_votes: 0,
		created_at: "2026-02-14T00:00:00.000Z",
		...over,
	} as PollData;
}

describe("collapseDuplicatePolls", () => {
	it("collapses same-question rows, keeping highest votes", () => {
		const rows = [
			poll({ id: "a", total_votes: 1 }),
			poll({ id: "b", total_votes: 2 }),
		];
		const out = collapseDuplicatePolls(rows);
		expect(out).toHaveLength(1);
		expect(out[0]?.id).toBe("b");
	});

	it("keeps distinct questions separate", () => {
		const rows = [
			poll({ id: "a", title: "Question one" }),
			poll({ id: "b", title: "Question two" }),
		];
		expect(collapseDuplicatePolls(rows)).toHaveLength(2);
	});

	it("dedupes same id twice", () => {
		const rows = [poll({ id: "a" }), poll({ id: "a" })];
		expect(collapseDuplicatePolls(rows)).toHaveLength(1);
	});
});
