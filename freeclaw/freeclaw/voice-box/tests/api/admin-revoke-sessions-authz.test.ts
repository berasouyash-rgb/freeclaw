// ═══════════════════════════════════════════════════════════════════
// Admin API — revoke_all_sessions must be admin-authenticated
// ═══════════════════════════════════════════════════════════════════
// CRITICAL REGRESSION: `revoke_all_sessions` sat ABOVE the `isAdmin` gate in
// `api/_admin.js` (the gate is further down the handler, at the
// "everything below requires admin" marker). Its own comment claimed it
// "sits below the isAdmin gate" — the code never implemented that.
//
// Impact: ANY unauthenticated caller could POST `{action:"revoke_all_sessions"}`
// and instantly wipe EVERY outstanding admin session — a platform-wide admin
// lockout (all moderators/admins signed out at once) — while also writing a
// forged `admin` audit entry claiming a legitimate admin did it.
//
// Contract:
//   1. A non-admin (including a caller with NO token) gets 403.
//   2. The session store is NOT touched on refusal.
//   3. No audit entry is written on refusal.
//   4. An admin still succeeds.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	settings: {
		admin_sessions: {
			tokens: [{ t: "tok-1", exp: Date.now() + 3_600_000 }],
		},
	} as Record<string, unknown>,
	settingWrites: [] as Array<{ key: string; value: unknown }>,
}));

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	cors: vi.fn(),
	invalidateAdminTokenCache: vi.fn(),
	notifyUser: vi.fn(),
	rateLimitResponse: vi.fn((res: unknown) => res,
	),
}));
vi.mock("../../api/_auth.js", () => authMocks);

// settings-backed get/set, faithful to the real helpers' behaviour.
const from = vi.fn((table: string) => {
	const filters: Array<[string, unknown]> = [];
	let op: "select" | "update" | "insert" = "select";
	let patch: Record<string, unknown> | null = null;
	const keyFromFilter = () =>
		filters.find(([c]) => c === "key")?.[1] as string | undefined;
	const self: Record<string, unknown> = {
		then(fn: (v: unknown) => void) {
			if (table !== "settings") {
				fn({ data: null, error: null });
				return;
			}
			// Mirrors the real setSetting(): read the key, then UPDATE by the
			// eq() filter or INSERT with the key on the row.
			if (op === "update" || op === "insert") {
				const key =
					op === "insert"
						? (patch as { key: string }).key
						: keyFromFilter();
				if (key !== undefined) {
					state.settingWrites.push({ key, value: patch?.value });
					state.settings[key] = patch?.value;
				}
				fn({ data: null, error: null });
				return;
			}
			const key = keyFromFilter();
			fn({ data: key ? { key, value: state.settings[key] } : null, error: null });
		},
		select: () => self,
		upsert: (row: unknown) => {
			op = "update";
			patch = row as Record<string, unknown>;
			return self;
		},
		insert: (row: unknown) => {
			op = "insert";
			patch = row as Record<string, unknown>;
			return self;
		},
		update: (row: unknown) => {
			op = "update";
			patch = row as Record<string, unknown>;
			return self;
		},
		eq: (col: string, val: unknown) => {
			filters.push([col, val]);
			return self;
		},
		maybeSingle: () => self,
		single: () => self,
	};
	return self;
});
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_moderation.js", () => ({
	getSpamConfig: vi.fn(),
	normalizeSpamConfig: vi.fn((c: unknown) => c),
}));

function response() {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
		setHeader() {
			return res;
		},
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(body: unknown) {
			res.body = body;
			return res;
		},
		end() {
			return res;
		},
	};
	return res;
}

async function callRevoke(headers: Record<string, string> = {}) {
	const { default: handler } = await import("../../api/_admin.js");
	const res = response();
	await handler(
		{ method: "POST", query: {}, body: { action: "revoke_all_sessions" }, headers },
		res,
	);
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	state.settings = {
		admin_sessions: { tokens: [{ t: "tok-1", exp: Date.now() + 3_600_000 }] },
	};
	state.settingWrites = [];
	authMocks.isAdmin.mockResolvedValue(false);
	authMocks.auditLog.mockResolvedValue(undefined);
});

describe("POST /api/admin revoke_all_sessions", () => {
	it("refuses a caller with NO admin token", async () => {
		const res = await callRevoke({});
		expect(res.statusCode).toBe(403);
	});

	it("refuses a caller whose token is not an admin", async () => {
		const res = await callRevoke({ "x-admin-token": "not-an-admin-token" });
		expect(res.statusCode).toBe(403);
	});

	it("does NOT wipe the admin sessions on refusal", async () => {
		await callRevoke({});
		const sessions = state.settings.admin_sessions as { tokens: unknown[] };
		expect(sessions.tokens).toHaveLength(1);
		expect(state.settingWrites).toHaveLength(0);
	});

	it("does not forge an admin audit entry on refusal", async () => {
		await callRevoke({});
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"revoke_all_sessions",
			expect.anything(),
		);
	});

	it("still lets a real admin revoke every session", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		const res = await callRevoke({ "x-admin-token": "tok-1" });
		expect(res.statusCode).toBe(200);
		const sessions = state.settings.admin_sessions as { tokens: unknown[] };
		expect(sessions.tokens).toHaveLength(0);
	});
});
