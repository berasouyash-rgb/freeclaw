// Platform shell detection — web vs Electron desktop vs Capacitor mobile.
// Pins: default web, vbDesktop bridge, Capacitor native flag, API base
// validation, and the honest storage-location copy per shell.
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBase, getPlatform, isNativeShell, storageWhere } from "../lib/platform";

function clearShellGlobals() {
	try {
		delete (window as unknown as Record<string, unknown>).Capacitor;
	} catch {
		/* ignore */
	}
	try {
		delete (window as unknown as Record<string, unknown>).vbDesktop;
	} catch {
		/* ignore */
	}
}

afterEach(() => {
	clearShellGlobals();
	vi.unstubAllEnvs();
});

describe("getPlatform", () => {
	it("defaults to web with no shell globals", () => {
		expect(getPlatform()).toBe("web");
		expect(isNativeShell()).toBe(false);
	});

	it("detects the Electron desktop bridge", () => {
		(window as unknown as Record<string, unknown>).vbDesktop = true;
		expect(getPlatform()).toBe("desktop");
		expect(isNativeShell()).toBe(true);
	});

	it("ignores a non-true desktop flag", () => {
		(window as unknown as Record<string, unknown>).vbDesktop = "yes";
		expect(getPlatform()).toBe("web");
	});

	it("detects Capacitor native", () => {
		(window as unknown as Record<string, unknown>).Capacitor = {
			isNativePlatform: () => true,
		};
		expect(getPlatform()).toBe("mobile");
		expect(isNativeShell()).toBe(true);
	});

	it("treats Capacitor web (isNativePlatform false) as web", () => {
		(window as unknown as Record<string, unknown>).Capacitor = {
			isNativePlatform: () => false,
		};
		expect(getPlatform()).toBe("web");
		expect(isNativeShell()).toBe(false);
	});

	it("prefers mobile when both globals are present", () => {
		(window as unknown as Record<string, unknown>).vbDesktop = true;
		(window as unknown as Record<string, unknown>).Capacitor = {
			isNativePlatform: () => true,
		};
		expect(getPlatform()).toBe("mobile");
	});
});

describe("apiBase", () => {
	it("is empty (same-origin) when VITE_API_BASE is unset", () => {
		expect(apiBase()).toBe("");
	});

	it("passes through a valid https origin and strips trailing slashes", () => {
		vi.stubEnv("VITE_API_BASE", "https://voice-box.vercel.app///");
		expect(apiBase()).toBe("https://voice-box.vercel.app");
	});

	it("rejects non-http schemes fail-closed to same-origin", () => {
		vi.stubEnv("VITE_API_BASE", "file:///etc/passwd");
		expect(apiBase()).toBe("");
		vi.stubEnv("VITE_API_BASE", "not a url");
		expect(apiBase()).toBe("");
	});

	// ── The native fallback constant ─────────────────────────────────
	//
	// An .exe built without VITE_API_BASE baked in falls back to a hardcoded
	// origin. That constant used to name a deployment that serves the static
	// frontend but 404s on every /api route, so the desktop app failed every
	// single request with "Failed to fetch" — while the web build was fine
	// and no test failed, because nothing pinned the constant at all.
	//
	// These tests name the value deliberately so the next deployment rename
	// cannot silently repeat it.
	it("falls back to the API host that actually serves /api, in the desktop shell", () => {
		vi.stubEnv("VITE_API_BASE", "");
		(window as unknown as Record<string, unknown>).vbDesktop = true;
		expect(apiBase()).toBe("https://voice-box-psi.vercel.app");
	});

	it("uses the same fallback in the mobile shell", () => {
		vi.stubEnv("VITE_API_BASE", "");
		(window as unknown as Record<string, unknown>).vbDesktop = true;
		(window as unknown as Record<string, unknown>).Capacitor = {
			isNativePlatform: () => true,
		};
		expect(apiBase()).toBe("https://voice-box-psi.vercel.app");
	});

	it("keeps the web build on same-origin so a typo'd env cannot leak cross-site", () => {
		vi.stubEnv("VITE_API_BASE", "");
		expect(apiBase()).toBe("");
	});

	it("lets a runtime override repoint a mis-pinned build without a reinstall", () => {
		vi.stubEnv("VITE_API_BASE", "");
		(window as unknown as Record<string, unknown>).vbDesktop = true;
		window.localStorage.setItem("vb:apiBase", "https://staging.example.com");
		expect(apiBase()).toBe("https://staging.example.com");
		window.localStorage.removeItem("vb:apiBase");
	});
});

describe("storageWhere", () => {
	it("names the browser on web", () => {
		expect(storageWhere()).toBe("in this browser");
	});

	it("names the computer in the desktop shell", () => {
		(window as unknown as Record<string, unknown>).vbDesktop = true;
		expect(storageWhere()).toContain("this computer");
		expect(storageWhere()).toContain("desktop app");
	});

	it("names the phone in the mobile shell", () => {
		(window as unknown as Record<string, unknown>).Capacitor = {
			isNativePlatform: () => true,
		};
		expect(storageWhere()).toContain("this phone");
	});
});
