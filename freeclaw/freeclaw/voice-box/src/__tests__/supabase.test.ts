// ─── Supabase client tests ───────────────────────────────────────
// Locks in supabase.ts hardening:
//   1. creates the client with real env credentials when both are valid
//   2. exports `null` (never throws) when config is missing or malformed —
//      useRealtime then runs its polling fallback and the app still boots
//   3. passes the realtime/auth options
//
// Regression guard: this module used to throw at import time when env was
// broken, which prevented the ENTIRE app from booting (splash screen stuck).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateClient = vi.fn(() => ({ from: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({ createClient: mockCreateClient }));

describe("supabase client module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("creates the client with env credentials when both are valid", async () => {
		vi.stubEnv("VITE_SUPABASE_URL", "https://db.example.co");
		vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key-123");
		vi.resetModules();
		const { default: supabase } = await import("../lib/supabase");

		expect(mockCreateClient).toHaveBeenCalledTimes(1);
		const [url, key, opts] = mockCreateClient.mock.calls[0] as unknown as [
			string,
			string,
			object,
		];
		expect(url).toBe("https://db.example.co");
		expect(key).toBe("anon-key-123");
		expect(opts).toEqual({
			realtime: { params: { eventsPerSecond: 5 } },
			auth: { persistSession: false, autoRefreshToken: false },
		});
		expect(supabase).toBeDefined();
	});

	it("exports null instead of throwing when both credentials are missing", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubEnv("VITE_SUPABASE_URL", undefined);
		vi.stubEnv("VITE_SUPABASE_ANON_KEY", undefined);
		vi.resetModules();
		const { default: supabase } = await import("../lib/supabase");

		expect(errSpy).toHaveBeenCalledTimes(1);
		expect(supabase).toBeNull();
		// The old buggy behavior created a client with placeholder creds — that
		// must never happen; no client means polling fallback instead.
		expect(mockCreateClient).not.toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it("exports null instead of throwing when the URL is malformed (non-URL junk)", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubEnv("VITE_SUPABASE_URL", "not-a-url");
		vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key-123");
		vi.resetModules();
		const { default: supabase } = await import("../lib/supabase");

		expect(supabase).toBeNull();
		expect(mockCreateClient).not.toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it("exports null when the URL is missing but the key is set", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubEnv("VITE_SUPABASE_URL", undefined);
		vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key-123");
		vi.resetModules();
		const { default: supabase } = await import("../lib/supabase");

		expect(supabase).toBeNull();
		expect(mockCreateClient).not.toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it("exports null when the URL is set but the key is missing", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubEnv("VITE_SUPABASE_URL", "https://db.example.co");
		vi.stubEnv("VITE_SUPABASE_ANON_KEY", undefined);
		vi.resetModules();
		const { default: supabase } = await import("../lib/supabase");

		expect(supabase).toBeNull();
		expect(mockCreateClient).not.toHaveBeenCalled();
		errSpy.mockRestore();
	});
});
