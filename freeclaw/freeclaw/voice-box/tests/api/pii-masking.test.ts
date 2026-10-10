// Outbound PII masking tests.
//
// Verifies that (1) maskPII() redacts residual emails / phones / addresses /
// pin codes while preserving dates and plain text, and (2) the real provider
// layer (_providers.js) scrubs every message before it is POSTed to the LLM
// API (NVIDIA NIM and any other provider) — on both the batch and streaming
// paths.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock supabase (settings query → no DB-configured providers) ──────────
const { supabaseMock } = vi.hoisted(() => {
	const queryChain = {
		select: () => queryChain,
		eq: () => queryChain,
		maybeSingle: async () => ({ data: null, error: null }),
		update: async () => ({ data: null, error: null }),
		insert: async () => ({ data: null, error: null }),
	};
	const supabaseMock = { from: vi.fn(() => queryChain) };
	return { supabaseMock };
});

vi.mock("../../api/_db-client.js", () => ({ default: supabaseMock }));

// ─── Mock fetch and capture the outbound request body ─────────────────────
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(content: string) {
	return {
		ok: true,
		status: 200,
		json: async () => ({ choices: [{ message: { content } }] }),
		text: async () => "",
	} as unknown as Response;
}

function streamResponse(chunks: string[]) {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(encoder.encode(c));
			controller.close();
		},
	});
	return {
		ok: true,
		status: 200,
		body,
		json: async () => ({}),
	} as unknown as Response;
}

function sentBody(callIndex = 0): any {
	const init = mockFetch.mock.calls[callIndex]?.[1] as
		| { body?: string }
		| undefined;
	return init?.body ? JSON.parse(init.body) : null;
}

// ─── Module under test (real implementation) ──────────────────────────────
import { maskPII } from "../../api/_moderation.js";
import { callLLMChain, callProviderStream } from "../../api/_providers.js";

beforeEach(() => {
	mockFetch.mockReset();
});

describe("maskPII unit behavior", () => {
	it("masks emails", () => {
		const out = maskPII("Reach me at jane.doe@example.com asap");
		expect(out).toContain("[EMAIL]");
		expect(out).not.toContain("jane.doe@example.com");
	});

	it("masks phone numbers (with country code and spaces)", () => {
		const out = maskPII("Call +91 98765 43210 now");
		expect(out).toContain("[PHONE]");
		expect(out).not.toContain("98765");
	});

	it("masks street addresses with numbers", () => {
		const out = maskPII("Meet at 12 rose street, kolkata");
		expect(out).toContain("[ADDRESS]");
		expect(out).not.toContain("12 rose street");
	});

	it("masks name + location patterns", () => {
		const out = maskPII("MAAM KAULI LIVES IN STREE 123");
		expect(out).toContain("[ADDRESS]");
		expect(out).not.toContain("STREE 123");
	});

	it("masks bare 6-digit pin codes", () => {
		const out = maskPII("pin 700001");
		expect(out).toContain("[PINCODE]");
		expect(out).not.toContain("700001");
	});

	it("masks room-level addresses", () => {
		const out = maskPII("flat b, hostel block 3");
		expect(out).toContain("[ADDRESS]");
		expect(out).not.toContain("flat b");
	});

	it("does NOT mask date-like strings or academic-year ranges", () => {
		expect(maskPII("exam year 2026-2027")).toContain("2026-2027");
		expect(maskPII("exam year 2026-2027")).not.toContain("[PHONE]");
		expect(maskPII("Meeting on 07/30/2026 at office")).toContain("07/30/2026");
		expect(maskPII("deadline 2026-07-30, call 5551234567")).toContain(
			"2026-07-30",
		);
		expect(maskPII("deadline 2026-07-30, call 5551234567")).toContain(
			"[PHONE]",
		);
	});

	it("leaves plain text untouched", () => {
		const plain = "the quick brown fox jumps over the lazy dog";
		expect(maskPII(plain)).toBe(plain);
	});

	it("passes non-string input through untouched", () => {
		expect(maskPII(123)).toBe(123);
		expect(maskPII(null)).toBe(null);
		expect(maskPII(undefined)).toBe(undefined);
		expect(maskPII("")).toBe("");
	});
});

describe("outbound masking through the real provider layer", () => {
	// Hermetic key: the provider fast-guard (hasUsableLLM) needs at least one
	// usable key or both paths return DEGRADED without ever POSTing. The local
	// dev machine happened to have a machine-level key, so these passed
	// locally and failed on keyless CI runners. A dummy key keeps the test
	// on the real NIM request path (fetch is mocked — no network) on every
	// machine. vi.stubEnv restores the ambient env after each test.
	beforeEach(() => {
		vi.stubEnv("NVIDIA_API_KEY", "test-key-for-masking-assertions");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});
	it("callLLMChain scrubs PII from the body sent to NIM (batch path)", async () => {
		mockFetch.mockResolvedValue(jsonResponse("sure"));

		const result = await callLLMChain(
			"You are a helpful admin assistant.",
			"Reach jane.doe@example.com or +91 98765 43210, flat 12 rose street",
		);

		expect(result.text).toBe("sure");
		expect(mockFetch).toHaveBeenCalledTimes(1);

		const body = sentBody(0);
		expect(body).toBeTruthy();
		const user =
			body.messages.find((m: any) => m.role === "user")?.content ?? "";
		expect(user).toContain("[EMAIL]");
		expect(user).toContain("[PHONE]");
		expect(user).toContain("[ADDRESS]");
		expect(user).not.toContain("jane.doe@example.com");
		expect(user).not.toContain("98765");
		expect(user).not.toContain("rose street");
	});

	it("callProviderStream scrubs PII from the body sent to NIM (streaming path)", async () => {
		mockFetch.mockResolvedValue(
			streamResponse([
				'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
			]),
		);

		const tokens: string[] = [];
		const result = await callProviderStream(
			[
				{ role: "system", content: "You are a helpful admin assistant." },
				{ role: "user", content: "ping sarah@example.com, pin 700001" },
			],
			{ onToken: (t: string) => tokens.push(t) },
		);

		expect(result.ok).toBe(true);
		expect(mockFetch).toHaveBeenCalledTimes(1);

		const body = sentBody(0);
		expect(body).toBeTruthy();
		expect(body.stream).toBe(true);
		const user =
			body.messages.find((m: any) => m.role === "user")?.content ?? "";
		expect(user).toContain("[EMAIL]");
		expect(user).toContain("[PINCODE]");
		expect(user).not.toContain("sarah@example.com");
		expect(user).not.toContain("700001");

		// Streaming still works end-to-end with the masked body.
		expect(tokens.join("")).toBe("ok");
	});
});
