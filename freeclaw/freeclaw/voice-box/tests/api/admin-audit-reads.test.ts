// Admin reads must query tables that EXIST with columns that EXIST.
// Regression lock for the live-schema reconciliation: /api/abuse and
// /api/spam admin GETs used to read a nonexistent `audit_log` table (one
// 500'd, the other silently empty). Both now read activity_logs, the table
// auditLog() actually writes, with its real columns.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
	activity: [] as Array<Record<string, unknown>>,
	posts: [] as Array<Record<string, unknown>>,
	admin: true,
}));

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			if (table === "activity_logs") {
				return {
					select: () => ({
						eq: (col: string, val: string) => ({
							order: () => ({
								limit: async () => ({
									data: db.activity.filter((r) => String((r as Record<string, unknown>)[col]) === val),
									error: null,
								}),
							}),
						}),
					}),
				};
			}
			if (table === "posts") {
				return {
					select: () => ({
						eq: () => ({
							order: () => ({
								limit: async () => ({ data: db.posts, error: null }),
							}),
						}),
					}),
				};
			}
			throw new Error("unexpected table " + table);
		},
	},
}));

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn(async () => db.admin),
	checkUser: vi.fn(async () => ({ ok: true })),
	ensureUser: vi.fn(async () => {}),
	auditLog: vi.fn(async () => true),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn(async () => false),
	rateLimitResponse: vi.fn((res) => res.status(429).json({ error: "slow" })),
}));

vi.mock("../../api/_security.js", () => ({
	securityCheck: vi.fn(() => ({ ok: true })),
}));

import abuseHandler from "../../api/_abuse.js";
import spamHandler from "../../api/_spam.js";

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	db.activity.length = 0;
	db.posts.length = 0;
	db.admin = true;
});

describe("GET /api/abuse — quarantine event history", () => {
	it("reads rapid_fire_quarantine rows from activity_logs", async () => {
		db.activity.push(
			{ id: 1, action: "rapid_fire_quarantine", detail: "p1 by anon-x", created_at: new Date().toISOString() },
			{ id: 2, action: "unrelated_action", detail: "noise", created_at: new Date().toISOString() },
		);
		const res = response();
		await abuseHandler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect((res.body as { quarantine_events: number }).quarantine_events).toBe(1);
		expect((res.body as { recent: unknown[] }).recent).toHaveLength(1);
	});

	it("returns an empty list (not 500) when nothing was quarantined", async () => {
		const res = response();
		await abuseHandler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect((res.body as { quarantine_events: number }).quarantine_events).toBe(0);
	});
});

describe("GET /api/spam — audit trail", () => {
	it("reads spam-actor rows from activity_logs", async () => {
		db.activity.push(
			{ id: 1, actor: "spam", action: "post_quarantined", detail: "p9", created_at: new Date().toISOString() },
		);
		const res = response();
		await spamHandler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect((res.body as { audit_entries: unknown[] }).audit_entries).toHaveLength(1);
	});
});
