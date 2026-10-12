// ═══════════════════════════════════════════════════════════════════
// AI summary limiter — correct signature AND awaited (regression).
// api/_ai-summary.js called rateLimited(req, res, "ai-summary", 20): wrong
// argument shape for the (table, author, seconds, limit) helper AND missing
// await, so the limiter was a silent no-op and the NVIDIA-backed endpoint
// was unthrottled. This file drives the REAL limiter: the first call must
// be allowed and the 21st inside a minute from one IP must be 429.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/_auth.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../api/_auth.js")>();
	return { ...actual, cors: vi.fn() };
});
// The limiter's DB seed COUNTs ai-summary rows by author (no such table —
// the seed fails open with count 0 and the in-memory counter enforces).
function chainStub() {
	const self: Record<string, (...a: unknown[]) => unknown> = {};
	for (const m of ["select", "eq", "gte"]) self[m] = () => self;
	self.then = (fn: (v: unknown) => void) =>
		fn({ count: 0, error: null }) as unknown;
	return self;
}
vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn(() => chainStub()) },
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

async function summarize(ip: string) {
	const { default: handler } = await import("../../api/_ai-summary.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			body: {
				title: "Canteen prices up again",
				description: "Rice meals cost more this term and portions look smaller.",
			},
			headers: { "x-forwarded-for": ip },
		},
		res,
	);
	return res;
}

beforeEach(() => {
	vi.resetModules();
});

describe("POST /api/ai-summary — real limiter", () => {
	it("allows the first summary from an IP", async () => {
		const res = await summarize("203.0.113.11");
		expect(res.statusCode).toBe(200);
	});

	it("429s the 21st summary inside a minute from one IP", async () => {
		const codes: number[] = [];
		for (let i = 0; i < 21; i++) {
			codes.push((await summarize("203.0.113.12")).statusCode);
		}
		expect(codes.slice(0, 20)).toEqual(new Array(20).fill(200));
		expect(codes[20]).toBe(429);
	});
});
