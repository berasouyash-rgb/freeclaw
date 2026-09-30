/**
 * REGRESSION — audit rows must never be silently lost.
 *
 * The v3 `auditLog` wrote `actor_id` straight through, and the column is
 * NOT NULL — so any caller that omitted the actor (e.g. a session/bootstrap
 * flow with no user yet) failed the insert and the event vanished with only
 * a console.error left behind. On a school safety platform, losing audit
 * records is itself a security finding.
 *
 * The fix (api/_audit.js): coerce a missing actor to "unknown" so the row
 * always lands and the gap stays visible, instead of dropping the event.
 */
import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ inserted: [] as Array<Record<string, unknown>> }));

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: vi.fn(() => ({
			insert: vi.fn((row: Record<string, unknown>) => {
				db.inserted.push(row);
				return Promise.resolve({ error: null });
			}),
		})),
	},
}));

import { auditLog } from "../../api/_audit.js";

describe("auditLog never loses a row over a missing actor", () => {
	it("coerces a null actor to 'unknown' and still writes", async () => {
		db.inserted.length = 0;
		const entry = await auditLog({ action: "session.start" });
		expect(entry).not.toBeNull();
		expect(db.inserted).toHaveLength(1);
		expect(db.inserted[0].actor_id).toBe("unknown");
		expect(db.inserted[0].action).toBe("session.start");
	});

	it("passes an explicit actor through untouched", async () => {
		db.inserted.length = 0;
		await auditLog({ action: "post.approve", actorType: "admin", actorId: "anon_abc123" });
		expect(db.inserted).toHaveLength(1);
		expect(db.inserted[0].actor_id).toBe("anon_abc123");
		expect(db.inserted[0].actor_type).toBe("admin");
	});
});
