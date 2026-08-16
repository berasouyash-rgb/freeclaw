// ═══════════════════════════════════════════════════════════════════
// Provider Degraded Fast-Guard Tests
// ═══════════════════════════════════════════════════════════════════
// Phase 43 of the production spec: when NO provider has a usable key
// (DB config, env fallback, or NIM chain), every LLM call would burn the
// full per-provider timeout chain before failing — a multi-minute hang
// for every agent execution. The fast-guard detects "no key anywhere"
// and returns an honest { ok:false, degraded:true } immediately, so the
// workforce surfaces AI PROVIDER DEGRADED instead of hanging.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mocks.from },
}));

// Clean env: no provider keys anywhere (the real-world degraded state).
// NOTE: local providers (ollama/lmstudio) are keyed by *_HOST env vars,
// NOT API keys — a bare machine has neither. Both must be cleared to
// simulate a truly provider-less deployment.
const PROVIDER_ENV_RE = /_(API_KEY|KEY|HOST)$/;
function clearProviderEnv() {
	for (const k of Object.keys(process.env)) {
		if (PROVIDER_ENV_RE.test(k)) delete process.env[k];
	}
}

beforeEach(() => {
	mocks.from.mockReset();
	// settings.api_providers read → empty object (no keys configured)
	mocks.from.mockReturnValue({
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		maybeSingle: vi
			.fn()
			.mockResolvedValue({ data: { value: {} }, error: null }),
	});
	clearProviderEnv();
});

describe("hasUsableLLM — degraded fast-guard", () => {
	it("returns false when no DB keys and no env keys exist", async () => {
		const { hasUsableLLM } = await import("../../api/_providers.js");
		expect(await hasUsableLLM()).toBe(false);
	});

	it("returns true when an env key exists (NIM chain usable)", async () => {
		process.env.NVIDIA_API_KEY = "nv-test-key";
		// Force a fresh cache so the newly-set env key is seen
		const mod = await import("../../api/_providers.js");
		mod.invalidateLLMStatus();
		expect(await mod.hasUsableLLM()).toBe(true);
		delete process.env.NVIDIA_API_KEY;
		mod.invalidateLLMStatus();
	});

	it("returns true when a local host is configured (ollama is usable)", async () => {
		process.env.OLLAMA_HOST = "0.0.0.0";
		const mod = await import("../../api/_providers.js");
		mod.invalidateLLMStatus();
		expect(await mod.hasUsableLLM()).toBe(true);
		delete process.env.OLLAMA_HOST;
		mod.invalidateLLMStatus();
	});
});

describe("callLLMChain — fast-fails instead of hanging", () => {
	it("returns degraded marker immediately with zero keys (no fetch attempted)", async () => {
		const { callLLMChain } = await import("../../api/_providers.js");
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		const result = await callLLMChain("system", "user");
		expect(result).toMatchObject({ ok: false, degraded: true });
		expect(String(result.error)).toContain("AI PROVIDER DEGRADED");
		// The whole point: with zero keys we never hit the network.
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe("callProviderStream — honest degraded signal", () => {
	it("invokes onError with degraded message and returns degraded result", async () => {
		const { callProviderStream } = await import("../../api/_providers.js");
		const onError = vi.fn();
		const result = await callProviderStream([{ role: "user", content: "hi" }], {
			onError,
		});
		expect(result).toMatchObject({ ok: false, degraded: true });
		expect(onError).toHaveBeenCalledTimes(1);
		expect(String(onError.mock.calls[0][0].message)).toContain(
			"AI PROVIDER DEGRADED",
		);
	});
});
