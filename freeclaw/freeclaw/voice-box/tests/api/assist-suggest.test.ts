// ═══════════════════════════════════════════════════════════════════
// Assist API — suggest task three-lane backbone
// ═══════════════════════════════════════════════════════════════════
// The type-mode live suggestions must never go blank: fast NVIDIA first,
// full chain second, guaranteed local keywords last.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = {
	cors: vi.fn(),
	clientIp: (req: {
		headers?: Record<string, string | undefined>;
		socket?: { remoteAddress?: string };
	}) =>
		String(
			req?.headers?.["x-forwarded-for"] ||
				req?.socket?.remoteAddress ||
				"unknown",
		),
	isAdmin: vi.fn().mockResolvedValue(false),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
};

vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

const providerMocks = {
	callLLMChain: vi.fn(),
	callNvidiaFast: vi.fn().mockResolvedValue(null),
	hasUsableLLM: vi.fn().mockResolvedValue(true),
};

vi.mock("../../api/_providers.js", () => providerMocks);

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
});

describe("POST /api/assist { task: suggest }", () => {
	it("returns chain suggestions when the LLM answers", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				category: "Food",
				confidence: 0.9,
				tags: ["canteen"],
				priority: "medium",
				improved_title: "Stale food in the canteen",
			}),
		});
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { task: "suggest", text: "canteen food is stale" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as Record<string, unknown>;
		expect(body.category).toBe("Food");
		expect(body.improved_title).toBe("Stale food in the canteen");
	});

	it("serves identical input from cache without calling the LLM twice", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				category: "Food",
				confidence: 0.9,
				tags: ["canteen"],
				priority: "medium",
				improved_title: "Stale food in the canteen",
			}),
		});
		const { default: handler } = await import("../../api/_assist.js");
		const req = {
			method: "POST",
			query: {},
			body: { task: "suggest", text: "canteen food is stale" },
			headers: {},
		};
		const first = response();
		await handler(req, first);
		expect((first.body as Record<string, unknown>).cached).toBeUndefined();
		const second = response();
		await handler(req, second);
		const body = second.body as Record<string, unknown>;
		expect(body.cached).toBe(true);
		expect(body.category).toBe("Food");
		expect(body.improved_title).toBe("Stale food in the canteen");
		// One LLM round-trip total — the second identical keystroke pause
		// costs nothing and waits nothing.
		expect(providerMocks.callNvidiaFast).toHaveBeenCalledTimes(1);
		expect(providerMocks.callLLMChain).toHaveBeenCalledTimes(1);
	});

	it("falls back to local keywords when every LLM lane fails", async () => {
		providerMocks.callLLMChain.mockRejectedValueOnce(new Error("down"));
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { task: "suggest", text: "the school bus driver skips stops" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as Record<string, unknown>;
		expect(body.engine).toBe("local");
		expect(body.category).toBe("Transport");
		expect(body.improved_title).toBeUndefined();
	});

	it("returns empty (not fake) suggestions for short input", async () => {
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { task: "suggest", text: "hi" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { category: null }).category).toBeNull();
		expect(providerMocks.callNvidiaFast).not.toHaveBeenCalled();
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});
});
