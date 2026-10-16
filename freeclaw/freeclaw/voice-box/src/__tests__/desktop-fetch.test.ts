// ═══════════════════════════════════════════════════════════════════
// Desktop "Failed to fetch" regression — apiBase() + fetch transport
// ═══════════════════════════════════════════════════════════════════
// Root cause: an EXE built without VITE_API_BASE baked in called
// fetch("/api/...") from a file:// page — guaranteed TypeError.
// Even with the env set, fetch omitted credentials:include so the
// vb_session cookie never crossed origins, and errors.ts/vitals.ts/offline.ts
// hardcoded same-origin paths that can never work on desktop.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiBase } from "../lib/platform";

// The API origin the native shells fall back to. This MUST be the deployment
// that actually serves /api — it previously named the static-only deployment,
// so this file "passed" while every request in the shipped EXE 404'd.
// See BUG-044. platform.test.ts pins the same value independently.
const PROD = "https://voice-box-psi.vercel.app";

function setDesktop(on: boolean) {
	try {
		delete (window as unknown as Record<string, unknown>).vbDesktop;
		delete (window as unknown as Record<string, unknown>).Capacitor;
	} catch {
		/* ignore */
	}
	if (on) (window as unknown as Record<string, unknown>).vbDesktop = true;
}

beforeEach(() => {
	setDesktop(false);
	vi.unstubAllEnvs();
	try {
		window.localStorage.removeItem("vb:apiBase");
		delete (window as unknown as Record<string, unknown>).__VB_API_BASE;
	} catch {
		/* ignore */
	}
});

afterEach(() => {
	setDesktop(false);
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	try {
		window.localStorage.removeItem("vb:apiBase");
		delete (window as unknown as Record<string, unknown>).__VB_API_BASE;
	} catch {
		/* ignore */
	}
});

describe("apiBase — desktop fallback", () => {
	it("stays same-origin on web when the env is unset", () => {
		expect(apiBase()).toBe("");
	});

	it("falls back to production in the desktop shell when the env is unset", () => {
		setDesktop(true);
		expect(apiBase()).toBe(PROD);
	});

	it("prefers a valid baked env over the fallback", () => {
		setDesktop(true);
		vi.stubEnv("VITE_API_BASE", "https://voice-box-psi.vercel.app///");
		expect(apiBase()).toBe("https://voice-box-psi.vercel.app");
	});

	it("fail-closes to the fallback (never garbage) on a typo'd env in desktop", () => {
		setDesktop(true);
		vi.stubEnv("VITE_API_BASE", "file:///etc/passwd");
		expect(apiBase()).toBe(PROD);
	});

	it("fail-closes to same-origin on web even with a typo'd env", () => {
		vi.stubEnv("VITE_API_BASE", "not a url");
		expect(apiBase()).toBe("");
	});

	it("honors a runtime localStorage override", () => {
		setDesktop(true);
		window.localStorage.setItem("vb:apiBase", "https://custom.example.com/");
		expect(apiBase()).toBe("https://custom.example.com");
	});
});

describe("api transport — desktop", () => {
	it("calls the absolute prod URL with credentials:include in the desktop shell", async () => {
		setDesktop(true);
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			headers: { get: () => null },
			text: async () => JSON.stringify({ ok: true }),
		}));
		vi.stubGlobal("fetch", fetchMock);
		// Fresh import so the stubbed fetch is picked up per-call (api.ts reads
		// global fetch at call time, no re-import needed).
		const { api, resetConcurrencyForTests } = await import("../lib/api");
		resetConcurrencyForTests();
		await api.get("/api/posts?limit=1");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		const [url, init] = call;
		expect(url).toBe(PROD + "/api/posts?limit=1");
		expect(init.credentials).toBe("include");
		vi.unstubAllGlobals();
	});
});
