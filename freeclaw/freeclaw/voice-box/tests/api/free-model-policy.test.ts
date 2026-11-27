// Free-model-only policy pin.
//
// VoiceFlow must never spend money at an LLM provider. The provider chain is
// the only path to a real model, so these assertions lock the policy at its
// source: paid vendors are rejected, OpenRouter is restricted to :free model
// variants, and the NIM fallback lanes are recognised by vendor prefix.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({ default: { from: vi.fn() } }));

import {
	FREE_POLICY,
	isApprovedFreeModel,
	isApprovedFreeProvider,
} from "../../api/_providers.js";

describe("free-model-only policy", () => {
	it("is enforced and lists approved providers", () => {
		expect(FREE_POLICY.freeOnly).toBe(true);
		expect(FREE_POLICY.providers).toContain("groq");
		expect(FREE_POLICY.providers).not.toContain("openai");
		expect(FREE_POLICY.providers).not.toContain("anthropic");
	});

	it("accepts documented free-tier providers", () => {
		for (const id of [
			"groq",
			"gemini",
			"cerebras",
			"mistral",
			"nvidia",
			"cloudflare_ai",
			"ollama",
			"lmstudio",
		]) {
			expect(isApprovedFreeProvider(id)).toBe(true);
		}
	});

	it("rejects paid providers and unknown vendors", () => {
		for (const id of [
			"openai",
			"anthropic",
			"xai",
			"deepseek",
			"together",
			"fireworks",
			"cohere",
			"perplexity",
			"azure_openai",
			"",
		]) {
			expect(isApprovedFreeProvider(id)).toBe(false);
			expect(isApprovedFreeModel(id, "anything")).toBe(false);
		}
	});

	it("allows only :free OpenRouter models", () => {
		expect(
			isApprovedFreeModel(
				"openrouter",
				"meta-llama/llama-3.3-70b-instruct:free",
			),
		).toBe(true);
		expect(isApprovedFreeModel("openrouter", "openai/gpt-4o")).toBe(false);
	});

	it("recognises NIM fallback lane ids by vendor prefix", () => {
		expect(isApprovedFreeModel("groq-gpt-oss", "openai/gpt-oss-120b")).toBe(
			true,
		);
		expect(
			isApprovedFreeModel(
				"nvidia-nemotron-bolt",
				"nvidia/nemotron-3.5-bolt-e4b",
			),
		).toBe(true);
		expect(isApprovedFreeModel("openai-gpt", "gpt-4o")).toBe(false);
	});
});
