// Optimistic row updates — instant reflect, exact rollback on failure.
import { describe, expect, it } from "vitest";
import { applyOptimistic, revertOptimistic } from "../lib/optimistic";

interface Row {
	id: string;
	hidden?: boolean;
	status?: string;
}

const ROWS: Row[] = [
	{ id: "a", hidden: false, status: "reported" },
	{ id: "b", hidden: false, status: "reported" },
];

describe("applyOptimistic", () => {
	it("patches the matching row and snapshots the previous row", () => {
		const { rows, prev } = applyOptimistic(ROWS, "a", { hidden: true });
		expect(rows.find((r) => r.id === "a")).toEqual({
			id: "a",
			hidden: true,
			status: "reported",
		});
		expect(prev).toEqual({ id: "a", hidden: false, status: "reported" });
		// Untouched rows keep referential identity (no wasteful re-render).
		expect(rows.find((r) => r.id === "b")).toBe(ROWS[1]);
		// Input is never mutated.
		expect(ROWS[0]).toEqual({ id: "a", hidden: false, status: "reported" });
	});

	it("snapshots undefined when the id is absent and changes nothing", () => {
		const { rows, prev } = applyOptimistic(ROWS, "zzz", { hidden: true });
		expect(prev).toBeUndefined();
		expect(rows).toEqual(ROWS);
	});
});

describe("revertOptimistic", () => {
	it("restores the exact previous row", () => {
		const { rows, prev } = applyOptimistic(ROWS, "a", {
			hidden: true,
			status: "solved",
		});
		expect(revertOptimistic(rows, prev)).toEqual(ROWS);
	});

	it("is a no-op when there was no previous row", () => {
		const { rows, prev } = applyOptimistic(ROWS, "zzz", { hidden: true });
		expect(revertOptimistic(rows, prev)).toEqual(ROWS);
	});
});
