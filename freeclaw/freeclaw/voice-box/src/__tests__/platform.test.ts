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
