// ═══════════════════════════════════════════════════════════════════
// Assist API — voice_complaint task
// ═══════════════════════════════════════════════════════════════════
// Proves that a raw spoken transcript (English, Hindi, or Bengali) is
// structured into an English complaint draft, and that short/empty input
// returns no draft instead of a fabricated one.
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

describe("POST /api/assist { task: voice_complaint }", () => {
	it("structures a transcript into an English complaint draft", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				title: "Broken water cooler on second floor",
				description:
					"The water cooler on the second floor has not worked for three days and students have no drinking water.",
				category: "Facilities",
				tags: ["water-cooler", "second-floor"],
				priority: "high",
			}),
		});
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { task: "voice_complaint", text: "paani wala cooler kharab hai" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const draft = (res.body as { draft: Record<string, unknown> }).draft;
		expect(draft.title).toBe("Broken water cooler on second floor");
		expect(draft.category).toBe("Facilities");
		expect(draft.priority).toBe("high");
	});

	it("prefers the fast NVIDIA lane when it answers", async () => {
		providerMocks.callNvidiaFast.mockResolvedValueOnce({
			provider: "nvidia-fast",
			model: "nvidia/nemotron-3.5-lightning-30b-a3b",
			text: JSON.stringify({
				title: "Canteen food quality is poor",
				description:
					"The food served in the canteen has been stale for several days.",
				category: "Food",
				tags: ["canteen"],
				priority: "medium",
			}),
		});
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { task: "voice_complaint", text: "canteen ka khana kharab hai" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as { engine: string; draft: Record<string, unknown> };
		expect(body.engine).toContain("nvidia-fast");
		expect(body.draft.category).toBe("Food");
		// The chain is never touched when the fast lane answers.
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});

	it("serves an identical transcript from cache without a second LLM call", async () => {
		providerMocks.callNvidiaFast.mockResolvedValueOnce({
			provider: "nvidia-fast",
			model: "nvidia/nemotron-3.5-lightning-30b-a3b",
			text: JSON.stringify({
				title: "Canteen food quality is poor",
				description:
					"The food served in the canteen has been stale for several days.",
				category: "Food",
				tags: ["canteen"],
				priority: "medium",
			}),
		});
		const { default: handler } = await import("../../api/_assist.js");
		const req = {
			method: "POST",
			query: {},
			body: { task: "voice_complaint", text: "canteen ka khana kharab hai" },
			headers: {},
		};
		const first = response();
		await handler(req, first);
		expect(
			(first.body as { cached?: boolean }).cached,
		).toBeUndefined();
		const second = response();
		await handler(req, second);
		const body = second.body as {
			engine: string;
			cached: boolean;
			draft: Record<string, unknown>;
		};
		expect(body.cached).toBe(true);
		expect(body.draft.title).toBe("Canteen food quality is poor");
		expect(providerMocks.callNvidiaFast).toHaveBeenCalledTimes(1);
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});

	it("returns no draft for short input instead of fabricating one", async () => {
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { task: "voice_complaint", text: "hi" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { draft: null }).draft).toBeNull();
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});

	it("still returns a structured draft when the LLM fails (local backbone)", async () => {
		providerMocks.callLLMChain.mockRejectedValueOnce(new Error("timeout"));
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { task: "voice_complaint", text: "the library roof leaks every rain" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as { engine: string; draft: Record<string, unknown> };
		expect(body.engine).toBe("local");
		expect(body.draft).toBeTruthy();
		expect(body.draft.category).toBe("Facilities");
		expect(typeof body.draft.title).toBe("string");
	});

	it("detects Hindi keywords and urgent priority without any LLM", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			ok: false,
			degraded: true,
			error: "AI PROVIDER DEGRADED — no API key configured",
		});
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					task: "voice_complaint",
					text: "school ke paani wala cooler teen din se kharab hai, turant thik karo",
				},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as { engine: string; draft: Record<string, unknown> };
		expect(body.engine).toBe("local");
		expect(body.draft.category).toBe("Facilities");
		expect(body.draft.priority).toBe("high");
	});
});

describe("POST /api/assist { task: structure_complaint }", () => {
	// Typed-text twin of voice_complaint: a pasted rambling paragraph gets
	// the same structured draft (title + description + category + tags +
	// priority + extracted details) through the same pipeline and guards.
	async function callStructure(text: string) {
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { task: "structure_complaint", text },
				headers: {},
			},
			res,
		);
		return res.body as {
			engine: string;
			draft: {
				title: string;
				description: string;
				category: string;
				tags: string[];
				priority: string;
				details: string[];
			} | null;
		};
	}

	it("structures a typed paragraph exactly like a transcript", async () => {
		providerMocks.callNvidiaFast.mockResolvedValueOnce({
			provider: "nvidia-fast",
			model: "test-model",
			text: JSON.stringify({
				title: "Broken taps in block C washroom",
				description:
					"The washroom taps in block C have been broken since Monday and students cannot wash hands.",
				category: "Facilities",
				tags: ["block-c"],
				priority: "medium",
				details: ["block C", "since Monday"],
			}),
		});
		const body = await callStructure(
			"block c ke washroom ke saare taps monday se toote hue hain, haath dhone mein dikkat ho rahi hai",
		);
		expect(body.draft?.title).toBe("Broken taps in block C washroom");
		expect(body.draft?.category).toBe("Facilities");
		expect(body.draft?.details).toEqual(["block C", "since Monday"]);
	});

	it("caps details at 4 entries of 40 chars", async () => {
		providerMocks.callNvidiaFast.mockResolvedValueOnce({
			provider: "nvidia-fast",
			model: "test-model",
			text: JSON.stringify({
				title: "Fees issue",
				description: "The fee counter overcharged this month.",
				category: "Academics",
				tags: [],
				priority: "medium",
				details: ["one", "two", "three", "four", "five", "six"],
			}),
		});
		const body = await callStructure("fee counter ne is mahine zyada paise le liye hain");
		expect(body.draft?.details).toEqual(["one", "two", "three", "four"]);
	});

	it("strips PII out of extracted details", async () => {
		providerMocks.callNvidiaFast.mockResolvedValueOnce({
			provider: "nvidia-fast",
			model: "test-model",
			text: JSON.stringify({
				title: "Bus delay",
				description: "The school bus is late every morning.",
				category: "Transport",
				tags: [],
				priority: "medium",
				details: ["every morning", "call 98765 43210", "mail me at a@b.com"],
			}),
		});
		const body = await callStructure("school bus roz subah late aati hai");
		expect(body.draft?.details).toEqual(["every morning"]);
	});

	it("treats malformed details as absent, never crashes", async () => {
		providerMocks.callNvidiaFast.mockResolvedValueOnce({
			provider: "nvidia-fast",
			model: "test-model",
			text: JSON.stringify({
				title: "Noise",
				description: "Construction noise during exams.",
				category: "Academics",
				tags: [],
				priority: "low",
				details: "not-an-array",
			}),
		});
		const body = await callStructure("construction ka shor exams ke time par hota hai");
		expect(body.draft?.details).toEqual([]);
	});

	it("returns details:[] on the local backbone (honest, never invented)", async () => {
		providerMocks.callLLMChain.mockRejectedValueOnce(new Error("timeout"));
		const body = await callStructure("the library roof leaks every rain near block D");
		expect(body.engine).toBe("local");
		expect(body.draft?.details).toEqual([]);
		expect(body.draft?.category).toBe("Facilities");
	});

	it("returns no draft for short typed input", async () => {
		const { default: handler } = await import("../../api/_assist.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { task: "structure_complaint", text: "hi" }, headers: {} },
			res,
		);
		expect((res.body as { draft: null }).draft).toBeNull();
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});
});
