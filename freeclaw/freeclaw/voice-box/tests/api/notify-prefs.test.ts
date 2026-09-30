// ═══════════════════════════════════════════════════════════════════
// Notification channel prefs — /api/notify-prefs
// ═══════════════════════════════════════════════════════════════════
// Locks the contract:
//   1. GET returns current phone/email/toggles (defaults when unset)
//   2. POST validates phone + email, persists normalized values
//   3. Invalid phone / email → 400 with a clear message
//   4. Writes require a valid user (checkUser gate)
//   5. Invalid user_id → 400
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const from = vi.fn();
const checkUser = vi.fn();
const verifyCallerIdentity = vi.hoisted(() => vi.fn());

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	checkUser: (...args: unknown[]) => checkUser(...args),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
	verifyCallerIdentity,
	clientIp: vi.fn(() => "test-ip"),
}));

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	select.mockImplementation(() => ({ eq }));
	eq.mockImplementation(() => ({ maybeSingle, upsert }));
	maybeSingle.mockResolvedValue({ data: null, error: null });
	upsert.mockResolvedValue({ data: null, error: null });
	from.mockImplementation(() => ({ select, upsert }));
	verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "anon_abc123" });
	checkUser.mockResolvedValue({ ok: true });
});

describe("GET /api/notify-prefs", () => {
	it("returns default empty prefs when nothing is stored", async () => {
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{ method: "GET", query: { user_id: "anon_abc123" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			phone: "",
			email: "",
			sms_enabled: true,
			email_enabled: true,
		});
	});

	it("returns stored prefs", async () => {
		maybeSingle.mockResolvedValue({
			data: {
				value: {
					phone: "+15551234567",
					email: "me@example.com",
					sms_enabled: true,
					email_enabled: false,
				},
			},
			error: null,
		});
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{ method: "GET", query: { user_id: "anon_abc123" }, body: {}, headers: {} },
			res,
		);
		expect(res.body).toMatchObject({
			phone: "+15551234567",
			email: "me@example.com",
			email_enabled: false,
		});
	});

	it("requires the owner identity before reading stored contact values", async () => {
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { user_id: "anon_abc123" },
				body: {},
				headers: { "x-anon-id": "anon_abc123" },
			},
			res,
		);
		expect(verifyCallerIdentity).toHaveBeenCalledWith(
			expect.objectContaining({ headers: { "x-anon-id": "anon_abc123" } }),
			expect.anything(),
			"anon_abc123",
		);
		expect(from).toHaveBeenCalledWith("settings");
	});

	it("denies a cross-user read before touching the settings table", async () => {
		verifyCallerIdentity.mockResolvedValue({
			ok: false,
			status: 403,
			error: "Cannot operate on another user's data",
		});
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { user_id: "anon_victim" },
				body: {},
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(res.body).toEqual({ error: "Cannot operate on another user's data" });
		expect(from).not.toHaveBeenCalled();
	});

	it("denies a read with no caller identity before touching the settings table", async () => {
		verifyCallerIdentity.mockResolvedValue({
			ok: false,
			status: 403,
			error: "Missing session identity (x-anon-id header)",
		});
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{ method: "GET", query: { user_id: "anon_abc123" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(res.body).toEqual({ error: "Missing session identity (x-anon-id header)" });
		expect(from).not.toHaveBeenCalled();
	});

	it("rejects an invalid user_id", async () => {
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{ method: "GET", query: { user_id: "admin:1" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(400);
	});
});

describe("POST /api/notify-prefs", () => {
	it("persists validated phone + email and returns them normalized", async () => {
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					user_id: "anon_abc123",
					phone: "+1 (555) 123-4567",
					email: "  Me@Example.com ",
					sms_enabled: true,
					email_enabled: false,
				},
				headers: { "x-anon-id": "anon_abc123" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body.phone).toBe("+15551234567");
		expect(res.body.email).toBe("Me@Example.com");
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({ key: "notify_prefs:anon_abc123" }),
			{ onConflict: "key" },
		);
	});

	it("rejects a malformed phone with a helpful 400", async () => {
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_abc123", phone: "abc" },
				headers: { "x-anon-id": "anon_abc123" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect(String(res.body.error)).toMatch(/phone/i);
		expect(upsert).not.toHaveBeenCalled();
	});

	it("rejects a malformed email with a helpful 400", async () => {
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_abc123", email: "nope" },
				headers: { "x-anon-id": "anon_abc123" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect(String(res.body.error)).toMatch(/email/i);
	});

	it("allows clearing a field with an empty string", async () => {
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_abc123", phone: "", email: "" },
				headers: { "x-anon-id": "anon_abc123" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body.phone).toBe("");
		expect(res.body.email).toBe("");
	});

	it("blocks writes for banned/suspended users (checkUser gate)", async () => {
		checkUser.mockResolvedValue({ ok: false, error: "Account suspended" });
		const { default: handler } = await import("../../api/_notify-prefs.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_abc123", phone: "+15551234567" },
				headers: { "x-anon-id": "anon_abc123" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});
});
