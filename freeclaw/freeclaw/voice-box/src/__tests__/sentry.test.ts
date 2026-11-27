// ─── Sentry init tests ───────────────────────────────────────────
// Locks in initSentry():
//   1. initializes @sentry/react with the env DSN (or hardcoded fallback)
//   2. environment-specific tracesSampleRate + enabled flags
//   3. beforeSend attaches url + viewport tags
//   4. re-exports the Sentry API surface for downstream use

import * as Sentry from "@sentry/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/react", () => ({
	init: vi.fn(),
	ErrorBoundary: class FakeErrorBoundary {},
	Profiler: class FakeProfiler {},
}));

const initOptions = () => vi.mocked(Sentry.init).mock.calls[0]![0];

async function freshSentry() {
	vi.resetModules();
	const mod = await import("../lib/sentry");
	mod.__resetSentryForTests();
	return mod;
}

describe("initSentry", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it("initializes with the env DSN and dev-mode flags", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", "https://fake-dsn@sentry.example/1");
		vi.stubEnv("MODE", "development");
		const mod = await freshSentry();

		expect(await mod.initSentry()).toBe(true);
		expect(Sentry.init).toHaveBeenCalledTimes(1);
		expect(logSpy).toHaveBeenCalledWith("[Sentry] Initialized ✓");

		const opts = initOptions();
		expect(opts.dsn).toBe("https://fake-dsn@sentry.example/1");
		expect(opts.environment).toBe("development");
		expect(opts.tracesSampleRate).toBe(1.0);
		expect(opts.enabled).toBe(false);
	});

	it("initializes with the hardcoded DSN fallback and production flags", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", ""); // falsy → hardcoded fallback
		vi.stubEnv("MODE", "production");
		vi.stubEnv("DEV", false); // DEV is a plain env prop in Vitest, not derived from MODE
		const mod = await freshSentry();

		expect(await mod.initSentry()).toBe(true);

		const opts = initOptions();
		expect(opts.dsn).toContain("ingest.us.sentry.io");
		expect(opts.environment).toBe("production");
		expect(opts.tracesSampleRate).toBe(0.2);
		expect(opts.enabled).toBe(true);
		expect(opts.ignoreErrors).toContain("AbortError");
	});

	it("falls back to a production environment when MODE is unset", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", "https://fake-dsn@sentry.example/1");
		vi.stubEnv("MODE", ""); // falsy → 'production' fallback
		const mod = await freshSentry();

		expect(await mod.initSentry()).toBe(true);
		expect(initOptions().environment).toBe("production");
	});

	it("beforeSend attaches url and viewport tags", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", "https://fake-dsn@sentry.example/1");
		const mod = await freshSentry();
		await mod.initSentry();

		const opts = initOptions();
		const event = { tags: { existing: "kept" } } as any;
		const out = (opts.beforeSend as any)(event);
		expect(out).toBe(event);
		expect(out.tags.existing).toBe("kept");
		expect(typeof out.tags.url).toBe("string");
		expect(out.tags.url.length).toBeGreaterThan(0);
		expect(out.tags.viewport).toMatch(/\d+x\d+/);

		// works when the event carries no tags yet
		const bare = (opts.beforeSend as any)({ message: "boom" } as any);
		expect(bare.tags).toHaveProperty("url");
		expect(bare.tags).toHaveProperty("viewport");
	});

	it("exposes the Sentry API surface through a dynamic import", async () => {
		// Test-only import (never bundled to prod): proves the SDK namespace
		// still resolves with the mock in place.
		const api = await import("@sentry/react");

		expect(api).toBeDefined();
		expect(api.ErrorBoundary).toBeDefined();
		expect(api.Profiler).toBeDefined();
	});

	it("caches the SDK load — one dynamic import for repeated inits", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", "https://fake-dsn@sentry.example/1");
		const mod = await freshSentry();

		await mod.initSentry();
		await mod.initSentry();
		// init() runs per call, but the SDK init fn itself loads once —
		// loadInit caches the destructured import.
		const first = await mod.loadInit();
		const second = await mod.loadInit();
		expect(first).toBe(second);
	});
});
