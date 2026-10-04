// ═══════════════════════════════════════════════════════════════════
// Capacitor Preferences adapter — the APK identity path
// ═══════════════════════════════════════════════════ adapter block
// On phones the anonymous identity must live in native storage
// (SharedPreferences via @capacitor/preferences), never in the WebView's
// localStorage — a WebView data wipe must not re-mint the student as a
// brand-new person. The device-storage suite pins the storage ENGINE
// against injected backends; this file pins the ADAPTER itself: the
// dynamic import, the shape validation, and the get/set/remove/keys
// pass-through, plus the two fallback paths (incomplete or absent
// Preferences degrades to localStorage instead of crashing boot).

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetStoreForTests,
	hydrateStore,
	storageBackend,
	storageReady,
	storeGet,
	storeKeys,
	storeRemove,
} from "../lib/storage";

const prefsState = vi.hoisted(() => ({
	data: new Map<string, string>(),
	calls: { get: 0, set: 0, remove: 0, keys: 0 },
	impl: "full" as "full" | "partial" | "absent",
}));

vi.mock("@capacitor/preferences", () => ({
	get Preferences() {
		if (prefsState.impl === "absent") return undefined;
		const base = {
			async get({ key }: { key: string }) {
				prefsState.calls.get++;
				const v = prefsState.data.get(key);
				return { value: v ?? null };
			},
			async set({ key, value }: { key: string; value: string }) {
				prefsState.calls.set++;
				prefsState.data.set(key, value);
			},
			async remove({ key }: { key: string }) {
				prefsState.calls.remove++;
				prefsState.data.delete(key);
			},
			async keys() {
				prefsState.calls.keys++;
				return { keys: [...prefsState.data.keys()] };
			},
		};
		if (prefsState.impl === "partial") {
			// A Preferences object missing methods (old/partial native
			// bridge) must be refused up front, never half-used.
			const { keys: _dropped, ...rest } = base;
			return rest;
		}
		return base;
	},
}));

function setMobileShell() {
	(window as unknown as Record<string, unknown>).Capacitor = {
		isNativePlatform: () => true,
	};
}

function clearMobileShell() {
	delete (window as unknown as Record<string, unknown>).Capacitor;
}

beforeEach(() => {
	prefsState.data.clear();
	prefsState.calls.get = 0;
	prefsState.calls.set = 0;
	prefsState.calls.remove = 0;
	prefsState.calls.keys = 0;
	prefsState.impl = "full";
	clearMobileShell();
	localStorage.clear();
	__resetStoreForTests();
});

describe("Capacitor Preferences adapter", () => {
	it("serves the device identity from native storage on mobile", async () => {
		prefsState.data.set("vb:anonId", "anon_device123");
		setMobileShell();
		expect(storageBackend()).toBe("device");

		await hydrateStore();

		expect(storageReady()).toBe(true);
		expect(storeGet("vb:anonId")).toBe("anon_device123");
		// The identity never touched the WebView store.
		expect(localStorage.getItem("vb:anonId")).toBeNull();
		expect(prefsState.calls.keys).toBeGreaterThan(0);
		expect(storeKeys()).toContain("vb:anonId");
	});

	it("removes through the native bridge, not just the mirror", async () => {
		prefsState.data.set("vb:drafts", "[]");
		setMobileShell();
		await hydrateStore();
		expect(storeGet("vb:drafts")).toBe("[]");

		storeRemove("vb:drafts");
		// Removal is synchronous through the mirror; the bridge flush is
		// async — the native row must actually be gone afterwards.
		await vi.waitFor(() => {
			expect(prefsState.calls.remove).toBeGreaterThan(0);
		});
		expect(prefsState.data.has("vb:drafts")).toBe(false);
	});

	it("refuses a partial native bridge and falls back to localStorage", async () => {
		prefsState.impl = "partial";
		setMobileShell();
		localStorage.setItem("vb:theme", "dark");

		await hydrateStore();

		expect(storageReady()).toBe(false);
		expect(storeGet("vb:theme")).toBe("dark");
		expect(prefsState.calls.set).toBe(0);
	});

	it("falls back to localStorage when the Preferences module is absent", async () => {
		prefsState.impl = "absent";
		setMobileShell();
		localStorage.setItem("vb:theme", "dark");

		await hydrateStore();

		expect(storageReady()).toBe(false);
		expect(storeGet("vb:theme")).toBe("dark");
	});
});
