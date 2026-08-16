// ═══════════════════════════════════════════════════════════════════
// Poll-close notifications — author notified when a poll closes
// ═══════════════════════════════════════════════════════════════════
// Locks the POST /api/polls { action: 'closed', poll_id } contract:
//   1. Expired poll → creates one 'poll_closed' notification for the author.
//   2. Already notified for that poll → no duplicate, { notified: false }.
//   3. Open poll → { closed: false }, no notification written.
//   4. Unknown poll → 404.  Unhandled method → 405.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	auditLog: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	maskProfanity: (s: unknown) => s,
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((res) =>
		res.status(500).json({ error: "Internal error" }),
	),
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({ blocked: false, flags: [] })),
}));

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

const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

let tables: Record<string, unknown>;
const upsert = vi.fn();
const settingsUpsert = vi.fn();

function mockTables() {
	from.mockImplementation((table: string) => ({
		select: vi.fn(() => ({
			eq: vi.fn(() => {
				const v = tables[table];
				const q = Promise.resolve({ data: v ?? null, error: null });
				return Object.assign(q, {
					maybeSingle: async () => ({
						data: Array.isArray(v) ? null : (v ?? null),
						error: null,
					}),
					order: async () => ({
						data: Array.isArray(v) ? v : null,
						error: null,
					}),
				});
			}),
		})),
		upsert: table === "settings" ? settingsUpsert : upsert,
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	}));
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	tables = {
		polls: {
			id: "poll-1",
			title: "Coffee machine",
			ptype: "single",
			options: ["Yes", "No"],
			author_id: "author-1",
			expires_at: PAST,
			deleted: false,
			archived: false,
		},
		settings: { value: { notifications: [] } },
	};
	upsert.mockResolvedValue({ data: null, error: null });
	settingsUpsert.mockResolvedValue({ data: null, error: null });
	mockTables();
});

describe("POST /api/polls { action: closed }", () => {
	it("notifies the author once when the poll has expired", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { action: "closed", poll_id: "poll-1" },
				query: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ closed: true, notified: true });
		expect(settingsUpsert).toHaveBeenCalledTimes(1);
		const [row] = settingsUpsert.mock.calls[0];
		expect(row.key).toBe("notifications:author-1");
		const added = row.value.notifications[0];
		expect(added.type).toBe("poll_closed");
		expect(added.poll_id).toBe("poll-1");
		expect(added.read).toBe(false);
	});

	it("does not duplicate the notification when already notified", async () => {
		tables.settings = {
			value: {
				notifications: [
					{
						id: "n1",
						type: "poll_closed",
						poll_id: "poll-1",
						read: false,
						created_at: "x",
					},
				],
			},
		};
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { action: "closed", poll_id: "poll-1" },
				query: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			closed: true,
			notified: false,
			already_notified: true,
		});
		expect(settingsUpsert).not.toHaveBeenCalled();
	});

	it("does nothing for a poll that is still open", async () => {
		tables.polls = {
			...(tables.polls as object),
			expires_at: FUTURE,
		} as Record<string, unknown>;
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { action: "closed", poll_id: "poll-1" },
				query: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ closed: false, notified: false });
		expect(settingsUpsert).not.toHaveBeenCalled();
	});

	it("404s for an unknown poll", async () => {
		tables.polls = null;
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { action: "closed", poll_id: "nope" },
				query: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("405s on unhandled methods", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "PATCH", body: {}, query: {}, headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});
