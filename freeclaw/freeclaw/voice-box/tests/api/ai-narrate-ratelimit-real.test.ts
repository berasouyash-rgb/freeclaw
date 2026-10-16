// ═══════════════════════════════════════════════════════════════════
// AI narrate limiter — the promise must be awaited (regression).
// api/_ai.js called rateLimited() WITHOUT await: an async function always
// returns a promise (truthy), so EVERY admin narrate was 429'd while the
// mock-based throttle test stayed green (mocks are sync). This file drives
// the REAL limiter with a stubbed DB count: the first call must be allowed
// (proves the promise is awaited) and the 11th inside a minute must be 429
// (proves the 10/min/IP budget is enforced).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/_auth.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../api/_auth.js")>();
	return {
		...actual,
		cors: vi.fn(),
		isAdmin: vi.fn().mockResolvedValue(true),
	};
});
// The limiter's DB seed COUNTs ai_narrate rows by author (no such table —
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
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const NOTES = {
	cover: "c",
	complaints: "c",
	feed: "c",
	reports: "c",
	polls: "c",
	trends: "c",
	actions: "c",
};
vi.mock("../../api/_providers.js", () => ({
	callLLMChain: vi.fn(async () => ({
		ok: true,
		provider: "t",
		model: "m",
		text: JSON.stringify({ notes: NOTES }),
	})),
}));

const BRIEF = {
	totals: { posts: 5, open: 4, solved: 1, reports_open: 1, reports_resolved: 1, polls: 1, votes: 2 },
	by_category: [{ category: "Transport", open: 2, solved: 0, total: 2 }],
	by_status: [
		{ status: "reported", count: 3 },
		{ status: "solved", count: 1 },
	],
	top_supported: [],
};

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

async function narrate(ip: string) {
	const { default: handler } = await import("../../api/_ai.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			body: { task: "narrate", brief: BRIEF },
			headers: { "x-forwarded-for": ip },
		},
		res,
	);
	return res;
}

beforeEach(() => {
	vi.resetModules();
});

describe("POST /api/ai narrate — real limiter", () => {
	it("allows the first narration from an IP (the limiter promise is awaited)", async () => {
		const res = await narrate("203.0.113.9");
		expect(res.statusCode).toBe(200);
	});

	it("429s the 11th narration inside a minute from one IP", async () => {
		const codes: number[] = [];
		for (let i = 0; i < 11; i++) {
			codes.push((await narrate("203.0.113.10")).statusCode);
		}
		expect(codes.slice(0, 10)).toEqual(new Array(10).fill(200));
		expect(codes[10]).toBe(429);
	});
});
