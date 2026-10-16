/**
 * REGRESSION — audit rows must never be silently lost.
 *
 * The v3 `auditLog` wrote `actor_id` straight through, and the column is
 * NOT NULL — so any caller that omitted the actor (e.g. a session/bootstrap
 * flow with no user yet) failed the insert and the event vanished with only
 * a console.error left behind. On a school safety platform, losing audit
 * records is itself a security finding.
 *
 * The first fix (api/_audit.js) coerced a missing ACTOR to "unknown". The
 * identical defect survived on the three other NOT NULL columns —
 * `resource_type`, `resource_id` and `action` — so 8 of the 10 `log.*`
 * convenience loggers (system, security, error, auth, userAction, adminAction,
 * aiAction, toolExecution) still produced inserts PostgREST rejected. Observed
 * live during a local run:
 *
 *   [AUDIT] Failed to write audit log: null value in column "resource_id"
 *           of relation "audit_logs" violates not-null constraint
 *
 * which is precisely the rate_limit_abuse / hourly_limit_abuse path in
 * api/_security.js: the abuse event itself was the row being dropped.
 *
 * This file ENFORCES the real audit_logs constraints instead of blindly
 * accepting every insert, so an omitted NOT NULL column fails the test rather
 * than failing the database.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Constraints transcribed from api/migrations/003_v3_enterprise.sql.
 * Kept inside vi.hoisted so the (hoisted) mock factory can use them, and
 * re-checked against the migration file by the test below, so they cannot
 * silently drift from the schema.
 */
const db = vi.hoisted(() => {
	const NOT_NULL = [
		"actor_type",
		"actor_id",
		"action",
		"resource_type",
		"resource_id",
	];
	const ACTOR_TYPES = ["user", "admin", "ai", "system"];
	const inserted: Array<Record<string, unknown>> = [];
	let authError: string | null = null;
	return {
		NOT_NULL,
		ACTOR_TYPES,
		inserted,
		get authError() {
			return authError;
		},
		set authError(value: string | null) {
			authError = value;
		},
		reset() {
			inserted.length = 0;
			authError = null;
		},
		/** The message Postgres would return for an invalid audit_logs row. */
		validateAuditLogs(row: Record<string, unknown>): string | null {
			for (const col of NOT_NULL) {
				if (row[col] === null || row[col] === undefined) {
					return `null value in column "${col}" of relation "audit_logs" violates not-null constraint`;
				}
			}
			if (!ACTOR_TYPES.includes(String(row.actor_type))) {
				return `new row for relation "audit_logs" violates check constraint "audit_logs_actor_type_check"`;
			}
			return null;
		},
	};
});

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => ({
			insert: (row: Record<string, unknown>) => {
				if (table === "audit_logs") {
					const message = db.validateAuditLogs(row);
					if (message) return Promise.resolve({ error: { message } });
				}
				// PostgREST reports failures via the returned error object —
				// it never throws, so a caller that ignores it sees "success".
				if (table === "activity_logs" && db.authError) {
					const message = db.authError;
					db.authError = null;
					return Promise.resolve({ error: { message } });
				}
				db.inserted.push(row);
				return Promise.resolve({ error: null });
			},
		}),
		rpc: async () => ({ data: null, error: null }),
	},
}));

import { auditLog, log } from "../../api/_audit.js";
import { auditFailedCount, auditLog as authAuditLog } from "../../api/_auth.js";

describe("audit_logs schema transcription", () => {
	it("matches the migration file", () => {
		const sql = readFileSync(
			resolve(process.cwd(), "api/migrations/003_v3_enterprise.sql"),
			"utf8",
		);
		const block = sql.match(/CREATE TABLE IF NOT EXISTS audit_logs \(([\s\S]*?)\n\);/);
		expect(block).not.toBeNull();
		const body = block![1];
		for (const col of db.NOT_NULL) {
			const line = body.split("\n").find((l) => l.trim().startsWith(`${col} `));
			expect(line, `column ${col} not found in migration`).toBeTruthy();
			expect(line, `column ${col} is no longer NOT NULL`).toMatch(/NOT NULL/);
		}
		expect(body).toMatch(/actor_type TEXT NOT NULL CHECK \(/);
	});
});

describe("auditLog never loses a row over a missing actor", () => {
	it("coerces a null actor to 'unknown' and still writes", async () => {
		db.reset();
		const entry = await auditLog({ action: "session.start" });
		expect(entry).not.toBeNull();
		expect(db.inserted).toHaveLength(1);
		expect(db.inserted[0].actor_id).toBe("unknown");
		expect(db.inserted[0].action).toBe("session.start");
	});

	it("passes an explicit actor through untouched", async () => {
		db.reset();
		await auditLog({
			action: "post.approve",
			actorType: "admin",
			actorId: "anon_abc123",
		});
		expect(db.inserted).toHaveLength(1);
		expect(db.inserted[0].actor_id).toBe("anon_abc123");
		expect(db.inserted[0].actor_type).toBe("admin");
	});
});

describe("every audit path writes a row the schema accepts", () => {
	// Real call shapes from api/_audit.js and its callers in api/_security.js.
	const CASES: Array<{
		name: string;
		run: () => unknown;
	}> = [
		{ name: "auditLog({action}) — bare minimum", run: () => auditLog({ action: "x" }) },
		{ name: "log.system", run: () => log.system("audit_cleanup", { n: 1 }) },
		{
			name: "log.security — the live rate_limit_abuse failure",
			run: () => log.security("rate_limit_abuse", { ip: "1.2.3.4" }),
		},
		{ name: "log.error", run: () => log.error("boom", new Error("x"), {}) },
		{ name: "log.auth", run: () => log.auth("login", "anon_1") },
		{ name: "log.userAction", run: () => log.userAction("post.create", "anon_1") },
		{ name: "log.adminAction", run: () => log.adminAction("user.ban", "admin_1") },
		{ name: "log.aiAction", run: () => log.aiAction("summarise", "s1") },
		{
			name: "log.toolExecution",
			run: () => log.toolExecution("search", {}, { hits: 1 }, "s1"),
		},
		{
			name: "log.toolApproval with an id",
			run: () => log.toolApproval("call_1", "admin_1", "approve"),
		},
		{
			name: "log.conversation without a conversation id",
			run: () => log.conversation("started", null),
		},
		{
			name: "log.conversation with a conversation id",
			run: () => log.conversation("started", "conv_1"),
		},
	];

	for (const c of CASES) {
		it(`${c.name} lands exactly one row`, async () => {
			db.reset();
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				await c.run();
				expect(db.inserted).toHaveLength(1);
				expect(
					errorSpy.mock.calls.flat().some((a) => String(a).includes("[AUDIT]")),
					"audit insert was rejected",
				).toBe(false);
				// Every NOT NULL column must carry a real value.
				for (const col of db.NOT_NULL) {
					expect(db.inserted[0][col], `${col} must not be null`).toBeTruthy();
				}
			} finally {
				errorSpy.mockRestore();
			}
		});
	}

	it("attributes a system error to the system, not to a user", async () => {
		db.reset();
		await log.error("handler.crash", new Error("x"), {});
		// actor_id is "unknown" (no actor available), so claiming actor_type
		// "user" would be a false attribution in the audit trail.
		expect(db.inserted[0].actor_type).toBe("system");
		expect(db.inserted[0].actor_id).toBe("unknown");
	});

	it("keeps an out-of-constraint actor_type inside the CHECK", async () => {
		db.reset();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await auditLog({ action: "x", actorType: "robot" as "user" });
			expect(db.inserted).toHaveLength(1);
			expect(db.inserted[0].actor_type).toBe("system");
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe("activity_logs writer reports failures honestly", () => {
	it("returns false and counts the failure when PostgREST rejects the insert", async () => {
		db.reset();
		db.authError = 'null value in column "id"';
		const before = auditFailedCount;
		const ok = await authAuditLog("anon_1", "post.create", "hello");
		expect(ok).toBe(false);
		expect(auditFailedCount).toBe(before + 1);
	});

	it("returns true when the row lands", async () => {
		db.reset();
		const before = auditFailedCount;
		const ok = await authAuditLog("anon_1", "post.create", "hello");
		expect(ok).toBe(true);
		expect(auditFailedCount).toBe(before);
	});
});
