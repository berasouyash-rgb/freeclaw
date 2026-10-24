// /api/transcribe — server-side speech-to-text contract.
//
// The whole point of this endpoint is that the transcript is a property of the
// RECORDED AUDIO, not of a browser recognition session. These tests pin the
// behaviour that makes that honest:
//   - malformed / absurd payloads are rejected (no silent empty transcript)
//   - with no provider key it reports a capability gap (503 degraded) and
//     NEVER invents text
//   - Groq is tried first (fastest), then NVIDIA, then OpenAI failover
//     (the NVIDIA audio path 404s for this deployment as of 2026-09-26,
//     so Groq/OpenAI carry transcription until a key exists for them)
//   - when every provider fails it returns 502, not a fabricated transcript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRateLimited, mockRateLimitResponse, mockVerifyCallerIdentity } =
	vi.hoisted(() => ({
		mockRateLimited: vi.fn(async () => false),
		mockRateLimitResponse: vi.fn(),
		mockVerifyCallerIdentity: vi.fn(async () => ({
			ok: true,
			callerId: "anon-test",
		})),
	}));

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	rateLimited: mockRateLimited,
	rateLimitResponse: mockRateLimitResponse,
	clientIp: vi.fn(() => "203.0.113.9"),
	verifyCallerIdentity: mockVerifyCallerIdentity,
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));

import handler from "../../api/_transcribe.js";

type Res = {
	status: (n: number) => Res;
	json: (b: unknown) => Res;
	end: () => Res;
	setHeader: (k: string, v: string) => void;
};

function mockRes() {
	const res: Res & { statusCode?: number; body?: unknown } = {
		status: vi.fn(function (this: Res, n: number) {
			(res as { statusCode?: number }).statusCode = n;
			return res;
		}) as unknown as Res["status"],
		json: vi.fn(function (this: Res, b: unknown) {
			(res as { body?: unknown }).body = b;
			return res;
		}) as unknown as Res["json"],
		end: vi.fn(() => res) as unknown as Res["end"],
		setHeader: vi.fn(),
	};
	return res;
}

/** ~2 KB of fake audio — above the minimum, below the maximum. */
const okAudio = () => Buffer.alloc(2048, 7).toString("base64");

const req = (body: unknown, method = "POST") => ({
	method,
	body,
	headers: { "x-forwarded-for": "203.0.113.9", "x-anon-id": "anon-test" },
});

const jsonResponse = (status: number, payload: unknown) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => payload,
	text: async () => JSON.stringify(payload),
});

const ORIG_NVIDIA = process.env.NVIDIA_API_KEY;
const ORIG_OPENAI = process.env.OPENAI_API_KEY;
const ORIG_GROQ = process.env.GROQ_API_KEY;

beforeEach(() => {
	vi.clearAllMocks();
	mockRateLimited.mockResolvedValue(false);
	delete process.env.NVIDIA_API_KEY;
	delete process.env.OPENAI_API_KEY;
	delete process.env.GROQ_API_KEY;
});

afterEach(() => {
	vi.unstubAllGlobals();
	if (ORIG_NVIDIA === undefined) delete process.env.NVIDIA_API_KEY;
	else process.env.NVIDIA_API_KEY = ORIG_NVIDIA;
	if (ORIG_OPENAI === undefined) delete process.env.OPENAI_API_KEY;
	else process.env.OPENAI_API_KEY = ORIG_OPENAI;
	if (ORIG_GROQ === undefined) delete process.env.GROQ_API_KEY;
	else process.env.GROQ_API_KEY = ORIG_GROQ;
});

describe("/api/transcribe", () => {
	it("rejects a non-POST method", async () => {
		const res = mockRes();
		await handler(req(null, "GET") as never, res as never);
		expect(res.statusCode).toBe(405);
	});

	it("rejects a missing audio payload", async () => {
		const res = mockRes();
		await handler(req({}) as never, res as never);
		expect(res.statusCode).toBe(400);
	});

	it("rejects an unsupported audio type", async () => {
		const res = mockRes();
		await handler(
			req({ audioBase64: okAudio(), contentType: "application/pdf" }) as never,
			res as never,
		);
		expect(res.statusCode).toBe(415);
	});

	it("rejects audio that is too short to contain speech", async () => {
		const res = mockRes();
		await handler(
			req({
				audioBase64: Buffer.alloc(16).toString("base64"),
				contentType: "audio/webm",
			}) as never,
			res as never,
		);
		expect(res.statusCode).toBe(400);
	});

	it("rejects audio beyond the payload cap with an actionable message", async () => {
		const res = mockRes();
		await handler(
			req({
				audioBase64: Buffer.alloc(400_000).toString("base64"),
				contentType: "audio/webm",
			}) as never,
			res as never,
		);
		expect(res.statusCode).toBe(413);
		expect(JSON.stringify(res.body)).toMatch(/90 seconds/);
	});

	it("reports an honest capability gap when no ASR provider is configured", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const res = mockRes();

		await handler(
			req({ audioBase64: okAudio(), contentType: "audio/webm" }) as never,
			res as never,
		);

		expect(res.statusCode).toBe(503);
		expect((res.body as { degraded?: boolean }).degraded).toBe(true);
		// Crucially: no provider was called and no text was invented.
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(res.body).not.toHaveProperty("text");
	});

	it("prefers Groq when configured (fastest lane)", async () => {
		process.env.GROQ_API_KEY = "gq-test";
		process.env.NVIDIA_API_KEY = "nv-test";
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(jsonResponse(200, { text: "  the canteen food is cold  " }));
		vi.stubGlobal("fetch", fetchSpy);
		const res = mockRes();

		await handler(
			req({ audioBase64: okAudio(), contentType: "audio/webm" }) as never,
			res as never,
		);

		expect(res.statusCode).toBe(200);
		const body = res.body as { ok?: boolean; text?: string; provider?: string };
		expect(body.ok).toBe(true);
		expect(body.text).toBe("the canteen food is cold");
		expect(body.provider).toBe("groq");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(String(fetchSpy.mock.calls[0][0])).toContain("api.groq.com");
	});

	it("fails over Groq → NVIDIA → OpenAI in order", async () => {
		process.env.GROQ_API_KEY = "gq-test";
		process.env.NVIDIA_API_KEY = "nv-test";
		process.env.OPENAI_API_KEY = "oa-test";
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(500, { error: "groq busy" }))
			.mockResolvedValueOnce(jsonResponse(404, { error: "gone" }))
			.mockResolvedValueOnce(jsonResponse(200, { text: "projector is broken" }));
		vi.stubGlobal("fetch", fetchSpy);
		const res = mockRes();

		await handler(
			req({ audioBase64: okAudio(), contentType: "audio/webm" }) as never,
			res as never,
		);

		expect(res.statusCode).toBe(200);
		expect((res.body as { provider?: string }).provider).toBe("openai");
		expect(fetchSpy).toHaveBeenCalledTimes(3);
		const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
		expect(urls[0]).toContain("api.groq.com");
		expect(urls[1]).toContain("nvidia.com");
		expect(urls[2]).toContain("api.openai.com");
	});

	it("transcribes with NVIDIA when no Groq key is set", async () => {
		process.env.NVIDIA_API_KEY = "nv-test";
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(jsonResponse(200, { text: "  the canteen food is cold  " }));
		vi.stubGlobal("fetch", fetchSpy);
		const res = mockRes();

		await handler(
			req({
				audioBase64: okAudio(),
				contentType: "audio/webm",
				lang: "hi-IN",
			}) as never,
			res as never,
		);

		expect(res.statusCode).toBe(200);
		const body = res.body as { ok?: boolean; text?: string; provider?: string };
		expect(body.ok).toBe(true);
		expect(body.text).toBe("the canteen food is cold");
		expect(body.provider).toBe("nvidia");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		// The BCP-47 tag from the client is mapped to ISO-639-1 for Whisper.
		const sentBody = fetchSpy.mock.calls[0][1].body as FormData;
		expect(sentBody.get("language")).toBe("hi");
	});

	it("falls back to OpenAI when the primary provider fails", async () => {
		process.env.NVIDIA_API_KEY = "nv-test";
		process.env.OPENAI_API_KEY = "oa-test";
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(500, { error: "upstream" }))
			.mockResolvedValueOnce(jsonResponse(200, { text: "projector is broken" }));
		vi.stubGlobal("fetch", fetchSpy);
		const res = mockRes();

		await handler(
			req({ audioBase64: okAudio(), contentType: "audio/webm" }) as never,
			res as never,
		);

		expect(res.statusCode).toBe(200);
		expect((res.body as { provider?: string }).provider).toBe("openai");
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("reports failure instead of inventing a transcript when every provider fails", async () => {
		process.env.NVIDIA_API_KEY = "nv-test";
		process.env.OPENAI_API_KEY = "oa-test";
		const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(429, { error: "busy" }));
		vi.stubGlobal("fetch", fetchSpy);
		const res = mockRes();

		await handler(
			req({ audioBase64: okAudio(), contentType: "audio/webm" }) as never,
			res as never,
		);

		expect(res.statusCode).toBe(502);
		expect(res.body).not.toHaveProperty("text");
		expect(JSON.stringify(res.body)).toContain("detail");
	});

	it("treats an empty provider transcript as a failure, not a success", async () => {
		process.env.NVIDIA_API_KEY = "nv-test";
		const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { text: "   " }));
		vi.stubGlobal("fetch", fetchSpy);
		const res = mockRes();

		await handler(
			req({ audioBase64: okAudio(), contentType: "audio/webm" }) as never,
			res as never,
		);

		expect(res.statusCode).toBe(502);
		expect(res.body).not.toHaveProperty("text");
	});

	it("rate-limits repeated transcription requests", async () => {
		mockRateLimited.mockResolvedValue(true);
		const res = mockRes();

		await handler(
			req({ audioBase64: okAudio(), contentType: "audio/webm" }) as never,
			res as never,
		);

		expect(mockRateLimitResponse).toHaveBeenCalled();
	});
});

describe("transcribe language auto-detect", () => {
	it("omits the language field for unknown/auto tags so Whisper detects it", async () => {
		process.env.NVIDIA_API_KEY = "nv-test";
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(jsonResponse(200, { text: "pani nahi aa raha hai" }));
		vi.stubGlobal("fetch", fetchSpy);
		const res = mockRes();

		await handler(
			req({
				audioBase64: okAudio(),
				contentType: "audio/webm",
				lang: "auto",
			}) as never,
			res as never,
		);

		expect(res.statusCode).toBe(200);
		const sentBody = fetchSpy.mock.calls[0][1].body as FormData;
		expect(sentBody.get("language")).toBeNull();
	});
});
