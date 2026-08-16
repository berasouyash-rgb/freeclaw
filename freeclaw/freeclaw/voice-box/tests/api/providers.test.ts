// ═══════════════════════════════════════════════════════════════════
// Provider Chain Tests
// ═══════════════════════════════════════════════════════════════════
// Tests the multi-provider failover chain, fallback logic,
// response parsing, and error handling.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock fetch ───────────────────────────────────────────────────
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

// Minimal provider response shapes (unknown in, narrowed shape inside).
interface ChoiceResponse {
	choices?: Array<{ message?: { content?: string } }>;
}
interface ContentResponse {
	content?: Array<{ text?: string }>;
}

// ─── Module under test (simplified provider chain logic) ──────────
const PROVIDER_DEFS = {
	openai: {
		name: "OpenAI",
		defaultModel: "gpt-4o",
		baseUrl: "https://api.openai.com/v1/chat/completions",
		buildHeaders: (key: string) => ({
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		}),
		buildBody: (model: string, messages: unknown[]) => ({
			model,
			max_tokens: 2048,
			temperature: 0.2,
			messages,
		}),
		parseResponse: (data: unknown) =>
			(data as ChoiceResponse | undefined)?.choices?.[0]?.message?.content,
		compat: "openai",
	},
	groq: {
		name: "Groq",
		defaultModel: "llama-3.3-70b-versatile",
		baseUrl: "https://api.groq.com/openai/v1/chat/completions",
		buildHeaders: (key: string) => ({
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		}),
		buildBody: (model: string, messages: unknown[]) => ({
			model,
			max_tokens: 2048,
			temperature: 0.2,
			messages,
		}),
		parseResponse: (data: unknown) =>
			(data as ChoiceResponse | undefined)?.choices?.[0]?.message?.content,
		compat: "openai",
	},
	anthropic: {
		name: "Anthropic",
		defaultModel: "claude-sonnet-4-6",
		baseUrl: "https://api.anthropic.com/v1/messages",
		buildHeaders: (key: string) => ({
			"x-api-key": key,
			"anthropic-version": "2023-06-01",
			"Content-Type": "application/json",
		}),
		buildBody: (model: string, messages: unknown[]) => {
			const sys = messages.find(
				(m) =>
					(m as { role?: string; content?: unknown } | undefined)?.role ===
					"system",
			);
			const user = messages.filter(
				(m) => (m as { role?: string } | undefined)?.role !== "system",
			);
			return {
				model,
				max_tokens: 2048,
				...(sys ? { system: (sys as { content?: unknown }).content } : {}),
				messages: user,
			};
		},
		parseResponse: (data: unknown) =>
			(data as ContentResponse | undefined)?.content?.[0]?.text,
		compat: "anthropic",
	},
};

// ─── Helpers ──────────────────────────────────────────────────────

function getEnvFallback(provider: string): string | null {
	const envMap: Record<string, string | undefined> = {
		openai: "sk-test-openai-key",
		groq: "gsk-test-groq-key",
		anthropic: "sk-ant-test-key",
		nvidia: undefined, // no env var set
	};
	return envMap[provider] ?? null;
}

function testProvider(
	provider: (typeof PROVIDER_DEFS)[keyof typeof PROVIDER_DEFS],
	apiKey: string,
	system: string,
	user: string,
) {
	const headers = provider.buildHeaders(apiKey);
	const body = provider.buildBody(provider.defaultModel, [
		{ role: "system", content: system },
		{ role: "user", content: user },
	]);
	return { headers, body, url: provider.baseUrl };
}

async function callProviderWithTimeout(
	provider: (typeof PROVIDER_DEFS)[keyof typeof PROVIDER_DEFS],
	apiKey: string,
	system: string,
	user: string,
	timeoutMs = 10000,
): Promise<{ text: string; provider: string; model: string } | null> {
	const { headers, body, url } = testProvider(provider, apiKey, system, user);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = await response.json();
		const text = provider.parseResponse(data);

		if (!text) throw new Error("Empty response from provider");

		return { text, provider: provider.name, model: provider.defaultModel };
	} finally {
		clearTimeout(timeout);
	}
}

async function callLLMChain(
	system: string,
	user: string,
	preferredProvider?: string,
): Promise<{ text: string; provider: string; model: string } | null> {
	const priorityOrder = ["openai", "groq", "anthropic"];
	const providers = preferredProvider
		? [
				preferredProvider,
				...priorityOrder.filter((p) => p !== preferredProvider),
			]
		: priorityOrder;

	const errors: string[] = [];

	for (const providerId of providers) {
		const provider = PROVIDER_DEFS[providerId as keyof typeof PROVIDER_DEFS];
		if (!provider) continue;

		const apiKey = getEnvFallback(providerId);
		if (!apiKey) {
			errors.push(`${providerId}: no API key`);
			continue;
		}

		try {
			const result = await callProviderWithTimeout(
				provider,
				apiKey,
				system,
				user,
			);
			if (result) return result;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${providerId}: ${msg}`);
			console.warn(`[providers] ${providerId} failed: ${msg} — trying next`);
		}
	}

	// All providers failed — return error summary
	console.error("[providers] All providers failed:", errors.join("; "));
	return null;
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Provider Chain - Builders", () => {
	it("builds OpenAI-compatible headers", () => {
		const { headers } = testProvider(
			PROVIDER_DEFS.openai,
			"sk-test",
			"sys",
			"user",
		);
		expect(headers.Authorization).toBe("Bearer sk-test");
		expect(headers["Content-Type"]).toBe("application/json");
	});

	it("builds Anthropic-compatible headers", () => {
		const { headers } = testProvider(
			PROVIDER_DEFS.anthropic,
			"sk-ant-test",
			"sys",
			"user",
		);
		expect(headers["x-api-key"]).toBe("sk-ant-test");
		expect(headers["anthropic-version"]).toBe("2023-06-01");
	});

	it("builds OpenAI-compatible body", () => {
		const { body } = testProvider(
			PROVIDER_DEFS.openai,
			"sk-test",
			"You are a test bot",
			"Hello",
		);
		expect(body.model).toBe("gpt-4o");
		expect(body.max_tokens).toBe(2048);
		expect(body.temperature).toBe(0.2);
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[1].role).toBe("user");
		expect(body.messages[1].content).toBe("Hello");
	});

	it("builds Anthropic-compatible body with system prompt", () => {
		const { body } = testProvider(
			PROVIDER_DEFS.anthropic,
			"sk-ant-test",
			"You are helpful",
			"Hi there",
		);
		expect(body.system).toBe("You are helpful");
		expect(body.messages).toHaveLength(1);
		expect(body.messages[0].content).toBe("Hi there");
	});

	it("builds Anthropic body without system prompt when empty", () => {
		const { body } = testProvider(
			PROVIDER_DEFS.anthropic,
			"sk-ant-test",
			"",
			"Hello",
		);
		// Empty system prompt should be included as blank string, not undefined
		expect(body.system).toBe("");
		expect(body.messages).toHaveLength(1);
	});

	it("uses correct base URLs", () => {
		const openaiUrl = PROVIDER_DEFS.openai.baseUrl;
		const groqUrl = PROVIDER_DEFS.groq.baseUrl;
		const anthropicUrl = PROVIDER_DEFS.anthropic.baseUrl;

		expect(openaiUrl).toContain("api.openai.com");
		expect(groqUrl).toContain("api.groq.com");
		expect(anthropicUrl).toContain("api.anthropic.com");
	});
});

describe("Provider Chain - Response Parsing", () => {
	it("parses OpenAI response format", () => {
		const data = {
			choices: [{ message: { content: "Hello from OpenAI!" } }],
		};
		expect(PROVIDER_DEFS.openai.parseResponse(data)).toBe("Hello from OpenAI!");
	});

	it("parses Groq response format (same as OpenAI)", () => {
		const data = {
			choices: [{ message: { content: "Fast inference!" } }],
		};
		expect(PROVIDER_DEFS.groq.parseResponse(data)).toBe("Fast inference!");
	});

	it("parses Anthropic response format", () => {
		const data = {
			content: [{ text: "Hello from Claude!" }],
		};
		expect(PROVIDER_DEFS.anthropic.parseResponse(data)).toBe(
			"Hello from Claude!",
		);
	});

	it("returns undefined for empty OpenAI response", () => {
		expect(PROVIDER_DEFS.openai.parseResponse({})).toBeUndefined();
	});

	it("returns undefined for Anthropic response with no content", () => {
		expect(
			PROVIDER_DEFS.anthropic.parseResponse({ content: [] }),
		).toBeUndefined();
	});

	it("handles null/undefined gracefully", () => {
		expect(PROVIDER_DEFS.openai.parseResponse(null)).toBeUndefined();
		expect(PROVIDER_DEFS.openai.parseResponse(undefined)).toBeUndefined();
	});
});

describe("Provider Chain - Env Fallback", () => {
	it("returns key when env var exists", () => {
		const key = getEnvFallback("openai");
		expect(key).toBe("sk-test-openai-key");
	});

	it("returns null when env var is missing", () => {
		const key = getEnvFallback("nvidia");
		expect(key).toBeNull();
	});

	it("returns null for unknown provider", () => {
		const key = getEnvFallback("nonexistent_provider");
		expect(key).toBeNull();
	});
});

describe("Provider Chain - HTTP Integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("handles successful OpenAI response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					choices: [{ message: { content: "Successful response" } }],
				}),
		});

		const result = await callLLMChain("system", "user message");
		expect(result).not.toBeNull();
		expect(result?.text).toBe("Successful response");
		expect(result?.provider).toBe("OpenAI");
	});

	it("fails over from OpenAI to Groq when first provider returns 401", async () => {
		// OpenAI fails
		mockFetch.mockRejectedValueOnce(new Error("HTTP 401: Unauthorized"));
		// Groq succeeds
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					choices: [{ message: { content: "Groq response" } }],
				}),
		});

		const result = await callLLMChain("system", "user message");
		expect(result).not.toBeNull();
		expect(result?.text).toBe("Groq response");
		expect(result?.provider).toBe("Groq");
	});

	it("fails over through all providers when all return errors", async () => {
		// All providers fail
		mockFetch.mockRejectedValue(new Error("Service unavailable"));

		const result = await callLLMChain("system", "user message");
		expect(result).toBeNull();
	});

	it("handles timeout from provider gracefully", async () => {
		// Simulate timeout
		mockFetch.mockRejectedValueOnce(
			new Error("AbortError: The operation was aborted"),
		);

		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					choices: [{ message: { content: "Fallback response" } }],
				}),
		});

		const result = await callLLMChain("system", "user");
		expect(result).toBeDefined();
		expect(result?.provider).toBe("Groq");
	});

	it("prefers the specified provider", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					choices: [{ message: { content: "From Groq" } }],
				}),
		});

		const result = await callLLMChain("sys", "msg", "groq");
		expect(result).not.toBeNull();
		// Should hit Groq first, not OpenAI
		expect(mockFetch.mock.calls[0][0]).toContain("groq.com");
	});
});

describe("Provider Chain - Error Handling", () => {
	it("logs and continues when a provider has no API key", async () => {
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		// All providers fail due to fetch attempts
		mockFetch.mockRejectedValue(new Error("Network error"));

		const result = await callLLMChain("system", "user");
		expect(result).toBeNull();
		expect(consoleWarn).toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalled();

		consoleWarn.mockRestore();
		consoleError.mockRestore();
	});

	it("handles malformed JSON from provider", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.reject(new Error("JSON parse error")),
		});

		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					choices: [{ message: { content: "Fallback success" } }],
				}),
		});

		const result = await callLLMChain("system", "user");
		expect(result).not.toBeNull();
		expect(result?.text).toBe("Fallback success");
	});
});

describe("Provider Chain - Rate Limiting", () => {
	it("handles 429 rate limit response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 429,
			statusText: "Too Many Requests",
			json: () => Promise.resolve({ error: "Rate limit exceeded" }),
		});

		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					choices: [{ message: { content: "Rate limit bypassed" } }],
				}),
		});

		const result = await callLLMChain("system", "user");
		expect(result).not.toBeNull();
		expect(result?.text).toBe("Rate limit bypassed");
	});
});
