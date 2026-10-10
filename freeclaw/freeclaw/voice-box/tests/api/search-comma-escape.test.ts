import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
	calls: [] as Array<{ table: string; or: string[] }>,
}));

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			const state = { table, or: [] as string[] };
			const builder: Record<string, (...a: never[]) => unknown> = {};
			builder.select = () => builder;
			builder.eq = () => builder;
			builder.neq = () => builder;
			builder.in = () => builder;
			builder.or = ((s: string) => {
				state.or.push(s);
				return builder;
			}) as (...a: never[]) => unknown;
			builder.ilike = () => builder;
			builder.order = () => builder;
			builder.limit = () => builder;
			builder.then = (resolve: (v: unknown) => void) => {
				db.calls.push({ table, or: state.or });
				resolve({
					data: [],
					error: null,
				});
			};
			return builder;
		},
	},
}));

import handler from "../../api/_search.js";

function mockRes() {
	const res: {
		statusCode?: number;
		body?: unknown;
		status: (n: number) => unknown;
		json: (b: unknown) => unknown;
		setHeader: () => void;
	} = {
		status: (n: number) => {
			res.statusCode = n;
			return res;
		},
		json: (b: unknown) => {
			res.body = b;
			return res;
		},
		setHeader: () => {},
	};
	return res;
}

describe("search comma and PostgREST separator escaping", () => {
	it("strips commas from search queries so they do not break out of PostgREST .or() filter clauses", async () => {
		db.calls.length = 0;
		const req = {
			method: "GET",
			query: { q: "canteen, food", type: "posts" },
			headers: {},
		};
		const res = mockRes();
		await handler(req as never, res as never);

		expect(res.statusCode).toBe(200);
		const postCall = db.calls.find((c) => c.table === "posts");
		expect(postCall).toBeDefined();
		const orClauses = postCall?.or[0] || "";

		// The .or() argument has exactly 3 clauses: title.ilike, description.ilike, id.ilike
		// It must NOT contain an unescaped or unparsed extra clause from a comma breakout
		const parts = orClauses.split(",");
		// Each part must start with a valid column condition (title., description., id., or tags.)
		for (const part of parts) {
			expect(
				part.startsWith("title.ilike.") ||
				part.startsWith("description.ilike.") ||
				part.startsWith("id.ilike.") ||
				part.startsWith("tags.ov.")
			).toBe(true);
		}
		expect(orClauses).not.toContain(", food%");
	});
});
