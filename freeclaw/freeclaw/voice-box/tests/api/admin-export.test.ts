// ═══════════════════════════════════════════════════════════════════
// Admin Export API — CSV export contract
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/admin-export contract:
//   1. POST { resource } as admin → 200 CSV with BOM, header + data rows.
//   2. REGRESSION: the payload must go out through res.end — this codebase's
//      response shim has no Express-style .send, so a .send() call turned
//      every successful export into a 500 ("Export failed") AFTER the data
//      was already fetched. The mock below deliberately has no .send.
//   3. Non-admin → 401; unknown resource → 400.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const isAdmin = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin,
}));

function chainedQueryBuilder(rows: unknown[]) {
	const q: Record<string, unknown> = {};
	const chain = () => q;
	for (const m of [
		"select",
		"eq",
		"gte",
		"lte",
		"or",
		"order",
		"limit",
	]) {
		q[m] = vi.fn(() => {
			if (m === "limit") return Promise.resolve({ data: rows, error: null });
			return q;
		});
	}
	return { builder: q, chain };
}

function response() {
	const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string> };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn((k: string, v: string) => {
			res.headers[k] = v;
			return res;
		}),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end(payload?: unknown) {
			res.body = payload;
			return this;
		},
		// NOTE: no .send — mirrors the real response shim and guards the regression.
	});
}

const POST_ROWS = [
	{
		id: "p1",
		title: "Broken elevator",
		description: "Stuck for days",
		category: "facilities",
		author_id: "anon-1",
		created_at: "2026-08-01T10:00:00.000Z",
		image_url: null,
	},
];

function makeFromMock(rows: unknown[]) {
	from.mockImplementation((_table: string) => chainedQueryBuilder(rows).builder);
}

beforeEach(() => {
	vi.clearAllMocks();
	isAdmin.mockResolvedValue(true);
	makeFromMock(POST_ROWS);
});

describe("admin-export", () => {
	it("returns 200 CSV via res.end with BOM, headers, data and metadata", async () => {
		const handler = (await import("../../api/_admin-export.js")).default;
		const res = response();
		await handler(
			{
				method: "POST",
				headers: { "x-admin-token": "tok" },
				body: { resource: "posts" },
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(typeof res.body).toBe("string");
		const csv = res.body as string;
		expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM for Excel
		const text = csv.slice(1);
		const lines = text.split("\n");
		expect(lines[0]).toContain("Title"); // header row
		expect(text).toContain("Broken elevator"); // data row
		expect(text).toContain("# Rows: 1"); // metadata footer
		expect(res.headers["Content-Type"]).toContain("text/csv");
		expect(res.headers["Content-Disposition"]).toContain("attachment");
	});

	it("rejects non-admin callers with 401", async () => {
		isAdmin.mockResolvedValue(false);
		const handler = (await import("../../api/_admin-export.js")).default;
		const res = response();
		await handler(
			{ method: "POST", headers: {}, body: { resource: "posts" } },
			res,
		);
		expect(res.statusCode).toBe(401);
		expect((res.body as { error: string }).error).toMatch(/admin/i);
	});

	it("rejects unknown resources with 400", async () => {
		const handler = (await import("../../api/_admin-export.js")).default;
		const res = response();
		await handler(
			{
				method: "POST",
				headers: { "x-admin-token": "tok" },
				body: { resource: "not_a_table" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toMatch(/resource/i);
	});
});
