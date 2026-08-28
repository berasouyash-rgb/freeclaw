// ═══════════════════════════════════════════════════════════════════
// Reactions API — GET listing + error-fallback coverage
// ═══════════════════════════════════════════════════════════════════
// Complements reactions.test.ts (POST toggle contract) with:
//   - GET listing: author/target filters, author masking (owner + admin
//     exceptions), private no-cache header (viewer-scoped is_mine data).
//   - POST counts-query failure: the toggle still succeeds with empty
//     counts (counts are best-effort).
//   - Method routing: OPTIONS 204, PATCH 405.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
let reactionsData: Array<Record<string, unknown>> = [];
let deleteResult: Array<{ id: string }> = [];
let countsThrow = false;

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
const authMocks = {
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true, user: { id: "u1" } }),
};
vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
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

function chainFor(table: string) {
	const chain: {
		op: string | null;
		select(c: string): unknown;
		eq(): unknown;
		limit(): unknown;
		delete(): unknown;
		insert(): unknown;
		update(): unknown;
		then(cb: (v: unknown) => void): Promise<unknown>;
	} = {
		op: null,
		select(_c: string) {
			if (!this.op) this.op = "list";
			return this;
		},
		eq() {
			return this;
		},
		limit() {
			return this;
		},
		delete() {
			this.op = "delete";
			return this;
		},
		insert() {
			this.op = "insert";
			return this;
		},
		update() {
			this.op = "update";
			return this;
		},
		then(onResolve: (v: unknown) => void) {
			if (this.op === "delete") onResolve({ data: deleteResult, error: null });
			else if (this.op === "insert") onResolve({ data: null, error: null });
			else if (this.op === "update") onResolve({ data: null, error: null });
			else if (this.op === "list" && table === "reactions") {
				if (countsThrow) throw new Error("counts query failed");
				onResolve({ data: reactionsData, error: null });
			} else onResolve({ data: [], error: null });
			return Promise.resolve(undefined);
		},
	};
	return chain;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	reactionsData = [];
	deleteResult = [];
	countsThrow = false;
	from.mockImplementation((table: string) => chainFor(table));
});

describe("GET /api/reactions", () => {
	it("lists reactions and sets the private no-cache header", async () => {
		reactionsData = [
			{ id: "r1", kind: "support", author_id: "anon-9", target_id: "post-1" },
		];
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		const setHeader = res.setHeader as ReturnType<typeof vi.fn>;
		const cache = setHeader.mock.calls.find(
			(c) => c[0] === "Cache-Control",
		)?.[1] as string;
		expect(cache).toBe("private, no-cache");
	});

	it("masks foreign author ids and marks is_mine for the viewer", async () => {
		reactionsData = [
			{ id: "r1", kind: "support", author_id: "anon-99", target_id: "post-1" },
			{ id: "r2", kind: "upvote", author_id: "anon-2", target_id: "post-1" },
		];
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{ method: "GET", query: { viewer: "anon-2" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as Array<{ author_id: string; is_mine: boolean }>;
		expect(body[0].author_id).toBe("anon-99...");
		expect(body[0].is_mine).toBe(false);
		expect(body[1].author_id).toBe("anon-2");
		expect(body[1].is_mine).toBe(true);
	});

	it("does not mask authors for admins", async () => {
		reactionsData = [
			{ id: "r1", kind: "support", author_id: "anon-9", target_id: "post-1" },
		];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		const body = res.body as Array<{ author_id: string }>;
		expect(body[0].author_id).toBe("anon-9");
	});

	it("supports author and target filters", async () => {
		reactionsData = [
			{ id: "r1", kind: "support", author_id: "anon-3", target_id: "post-7" },
		];
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { author: "anon-3", target: "post-7" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toHaveLength(1);
	});
});

describe("POST /api/reactions — counts error fallback", () => {
	it("still returns success with empty counts when the counts query fails", async () => {
		deleteResult = [];
		countsThrow = true;
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				headers: { "x-anon-id": "anon-1" },
				body: {
					author_id: "anon-1",
					target_id: "post-1",
					target_type: "post",
					kind: "support",
				},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ toggled: true, counts: {}, mine: [] });
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});

describe("method routing", () => {
	it("answers OPTIONS with 204", async () => {
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler({ method: "OPTIONS", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(204);
	});

	it("405s on unhandled methods", async () => {
		const { default: handler } = await import("../../api/_reactions.js");
		const res = response();
		await handler({ method: "PATCH", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});
