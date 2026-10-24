// ═══════════════════════════════════════════════════════════════════
// Search flood guard (regression).
// GET /api/search runs full-table scans (posts 500 + comments 1000 +
// polls 1000 + users 200) per DISTINCT query — the 15s SWR collapses
// repeats, but a rotating-query flood still scans. The handler must throttle
// per identity (viewer) with a loose per-IP backstop so a school NAT shares
// headroom (same lesson as _users.js). Trivial queries (empty/short) return
// before the scan and must never burn quota.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn((res, retry) =>
		res.status(429).json({ error: "Too many searches", retry }),
	),
	clientIp: vi.fn(
		(req: { headers?: Record<string, string> }) =>
			req.headers?.["x-forwarded-for"] || "test-ip",
	),
	isAdmin: vi.fn(async () => false),
}));
// Every scan returns empty — the guard is exercised, not the scorer.
function chainStub() {
	const self: Record<string, (...a: unknown[]) => unknown> = {};
	for (const m of ["select", "eq", "neq", "ilike", "or", "order", "limit", "in"])
		self[m] = () => self;
	self.then = (fn: (v: unknown) => void) =>
		fn({ data: [], error: null }) as unknown;
	return self;
}
vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn(() => chainStub()) },
}));
vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

async function search(ip: string, q: string, viewer = "") {
	const { default: handler } = await import("../../api/_search.js");
	const res = response();
	await handler(
		{
			method: "GET",
			query: { q, type: "all", viewer },
			headers: { "x-forwarded-for": ip },
		},
		res,
	);
	return res;
}

describe("GET /api/search — flood guard", () => {
	it("429s past 120 scans/min from one identity", async () => {
		const codes: number[] = [];
		for (let i = 0; i < 121; i++) {
			codes.push(
				(await search("198.51.100.7", "canteen", "anon-qa-search")).statusCode,
			);
		}
		expect(codes[0]).toBe(200);
		expect(codes[120]).toBe(429);
	});

	it("does not burn quota on trivial queries", async () => {
		for (let i = 0; i < 61; i++) {
			expect((await search("198.51.100.8", "")).statusCode).toBe(200);
		}
	});

	it("keeps quotas per identity, not global", async () => {
		const res = await search("198.51.100.9", "canteen", "anon-qa-other");
		expect(res.statusCode).toBe(200);
	});
});
