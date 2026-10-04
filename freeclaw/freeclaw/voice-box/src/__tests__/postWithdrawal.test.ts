import { describe, expect, it } from "vitest";
import { postWithdrawal } from "../lib/postWithdrawal";
import type { RealtimePayload } from "../lib/useRealtime";

/**
 * The server refuses to serve hidden/deleted rows on every public surface
 * (`api/_posts.js:456-460` feed filter, `:521-531` direct-id 404), so a
 * client holding one of those rows in memory is holding content the
 * authoritative read would not return. These cases pin the predicate that
 * decides "this row must leave the screen now".
 *
 * `permanent` separates the two server truths:
 *   - DELETE → the row is physically gone, nobody can load it again.
 *   - hidden/deleted → the row still exists and the OWNER is still served
 *     it by `_posts.js:528`, so a detail page owned by the viewer must not
 *     blank itself, while a feed (which never returns it, owner or not)
 *     must drop it.
 */
function payload(p: Record<string, unknown>): RealtimePayload {
	return p as RealtimePayload;
}

describe("postWithdrawal", () => {
	it("withdraws a hard-deleted row as permanent", () => {
		expect(
			postWithdrawal(
				"posts",
				payload({ eventType: "DELETE", old: { id: "p1" }, new: {} }),
			),
		).toEqual({ id: "p1", permanent: true });
	});

	it("falls back to the new record when a DELETE carries no old record", () => {
		expect(
			postWithdrawal(
				"posts",
				payload({ eventType: "DELETE", old: {}, new: { id: "p9" } }),
			),
		).toEqual({ id: "p9", permanent: true });
	});

	it("withdraws a moderation-hidden row as non-permanent", () => {
		expect(
			postWithdrawal(
				"posts",
				payload({
					eventType: "UPDATE",
					old: { id: "p2" },
					new: { id: "p2", hidden: true, deleted: false },
				}),
			),
		).toEqual({ id: "p2", permanent: false });
	});

	it("withdraws a soft-deleted row as non-permanent", () => {
		expect(
			postWithdrawal(
				"posts",
				payload({
					eventType: "UPDATE",
					old: { id: "p3" },
					new: { id: "p3", hidden: false, deleted: true },
				}),
			),
		).toEqual({ id: "p3", permanent: false });
	});

	it("applies the same rule to an INSERT that lands already hidden", () => {
		// A quarantined submission is never in a feed, so this is a no-op in
		// practice — but the predicate must not depend on which event carried
		// the flag, or a later reader would have to reason about the order.
		expect(
			postWithdrawal(
				"posts",
				payload({ eventType: "INSERT", old: {}, new: { id: "p4", hidden: true } }),
			),
		).toEqual({ id: "p4", permanent: false });
	});

	it("leaves an ordinary update alone", () => {
		expect(
			postWithdrawal(
				"posts",
				payload({
					eventType: "UPDATE",
					old: { id: "p5" },
					new: { id: "p5", hidden: false, deleted: false, status: "solved" },
				}),
			),
		).toBeNull();
	});

	it("leaves a live insert alone", () => {
		expect(
			postWithdrawal(
				"posts",
				payload({ eventType: "INSERT", old: {}, new: { id: "p6", hidden: false } }),
			),
		).toBeNull();
	});

	it("ignores other tables entirely", () => {
		expect(
			postWithdrawal(
				"comments",
				payload({ eventType: "DELETE", old: { id: "c1" }, new: {} }),
			),
		).toBeNull();
		expect(
			postWithdrawal(
				"polls",
				payload({ eventType: "UPDATE", old: { id: "pl1" }, new: { id: "pl1", hidden: true } }),
			),
		).toBeNull();
	});

	it("ignores a payload with no event type", () => {
		expect(postWithdrawal("posts", payload({ new: { id: "p7", hidden: true } }))).toBeNull();
	});

	it("ignores a payload that names no row", () => {
		expect(
			postWithdrawal("posts", payload({ eventType: "DELETE", old: {}, new: {} })),
		).toBeNull();
	});
});
