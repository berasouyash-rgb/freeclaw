// ═══════════════════════════════════════════════════════════════════
// /api/errors authorization contract
// ═══════════════════════════════════════════════════════════════════
// REGRESSION: the aggregated error feed is internal diagnostics — raw
// error messages, source filenames, full stack traces + URLs, and
// per-device fingerprints. GET had no admin gate, so any anonymous
// caller could read the whole aggregate. POST must stay open (real
// browsers report their own errors); only the read is protected.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = {
	isAdmin: vi.fn(),
	cors: vi.fn(),
};
vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_security.js", () => ({
	securityCheck: () => ({ ok: true }),
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

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(false);
});

describe("GET /api/errors — authorization", () => {
	it("refuses anonymous callers", async () => {
		const { default: handler } = await import("../../api/_errors.js");
		const res = response();
		await handler({ method: "GET", query: {}, headers: {} }, res);

		expect(res.statusCode).toBe(403);
		expect((res.body as { errors?: unknown }).errors).toBeUndefined();
	});

	it("serves the aggregate to an admin", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		const { default: handler } = await import("../../api/_errors.js");
		const res = response();

		// Seed one real error through the public POST path.
		await handler(
			{
				method: "POST",
				body: {
					errors: [
						{
							message: "Boom",
							source: "fetch",
							filename: "app.js",
							stack: "at foo (app.js:1)",
							url: "https://x/y",
							device: "d1",
							timestamp: "2026-09-24T00:00:00.000Z",
						},
					],
				},
			},
			response(),
		);

		await handler({ method: "GET", query: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect((res.body as { errors: unknown[] }).errors.length).toBe(1);
	});

	it("keeps POST open so clients can report errors without a session", async () => {
		const { default: handler } = await import("../../api/_errors.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: {
					errors: [
						{
							message: "Client crash",
							source: "render",
							timestamp: "2026-09-24T00:00:00.000Z",
						},
					],
				},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(authMocks.isAdmin).not.toHaveBeenCalled();
	});
});
