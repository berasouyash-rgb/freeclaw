// ═══════════════════════════════════════════════════════════════════
// Categories API — admin-managed category list contract
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/categories contract:
//   1. GET  /api/categories                    → { categories, source }
//         source: 'stored' when settings has a custom list, else 'default'
//   2. PUT  /api/categories (admin only)       → replaces the stored list
//         body { categories: string[] } — 3..30 entries, trimmed + deduped
// Non-admins get 403; invalid lists get 400; unknown methods get 405.
// Persists in the settings table under key `categories`.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const from = vi.fn();
const isAdmin = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin,
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
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
	select.mockImplementation(() => ({ eq }));
	eq.mockImplementation(() => ({ maybeSingle, upsert }));
	maybeSingle.mockResolvedValue({ data: null, error: null });
	upsert.mockResolvedValue({ data: null, error: null });
	from.mockImplementation(() => ({ select, upsert }));
	isAdmin.mockResolvedValue(false);
});

describe("GET /api/categories", () => {
	it("returns the default list when nothing is stored", async () => {
		const { default: handler } = await import("../../api/_categories.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ source: "default" });
		expect(Array.isArray(res.body.categories)).toBe(true);
		expect(res.body.categories.length).toBeGreaterThanOrEqual(3);
		expect(from).toHaveBeenCalledWith("settings");
	});

	it("returns the stored list when one exists", async () => {
		maybeSingle.mockResolvedValue({
			data: { value: { categories: ["Custom A", "Custom B", "Custom C"] } },
			error: null,
		});
		const { default: handler } = await import("../../api/_categories.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			categories: ["Custom A", "Custom B", "Custom C"],
			source: "stored",
		});
	});
});

describe("PUT /api/categories", () => {
	it("403s when the caller is not an admin", async () => {
		isAdmin.mockResolvedValue(false);
		const { default: handler } = await import("../../api/_categories.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { categories: ["A", "B", "C"] },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(res.body).toMatchObject({ error: "Admin only" });
		expect(upsert).not.toHaveBeenCalled();
	});

	it("400s when categories is missing or not an array", async () => {
		isAdmin.mockResolvedValue(true);
		const { default: handler } = await import("../../api/_categories.js");
		const res = response();
		await handler({ method: "PUT", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(400);
		expect(res.body).toMatchObject({ error: expect.any(String) });
		expect(upsert).not.toHaveBeenCalled();
	});

	it("400s when the list has fewer than 3 categories", async () => {
		isAdmin.mockResolvedValue(true);
		const { default: handler } = await import("../../api/_categories.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { categories: ["A", "B"] },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(400);
	});

	it("400s when a category name is empty or too long", async () => {
		isAdmin.mockResolvedValue(true);
		const { default: handler } = await import("../../api/_categories.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { categories: ["A", "B", "   "] },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(400);
	});

	it("stores a normalized, deduped list on success", async () => {
		isAdmin.mockResolvedValue(true);
		const { default: handler } = await import("../../api/_categories.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				headers: {},
				body: {
					categories: [
						"Academics",
						"  facilities ",
						"FACILITIES",
						"Events",
						"Transport",
					],
				},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			categories: ["Academics", "facilities", "Events", "Transport"],
		});
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "categories",
				value: expect.objectContaining({
					categories: ["Academics", "facilities", "Events", "Transport"],
				}),
			}),
			{ onConflict: "key" },
		);
	});
});

describe("unsupported method", () => {
	it("405s on DELETE", async () => {
		const { default: handler } = await import("../../api/_categories.js");
		const res = response();
		await handler({ method: "DELETE", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});
