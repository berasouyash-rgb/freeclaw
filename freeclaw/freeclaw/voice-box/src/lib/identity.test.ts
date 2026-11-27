/**
 * Anon-ID permanence — the regression that made returning users appear to
 * "lose their identity" (reputation/growth reset to zero) every time they
 * reopened the app.
 *
 * Root cause: on the APK/desktop shells `storageBackend()` is "device" from
 * the first frame, but the device store only becomes readable after an async
 * hydration. Inside that window `getAnonId()` minted a provisional id in
 * module memory ONLY — nothing durable. Two ways that lost the identity:
 *
 *   1. Hydration hangs → every launch mints a fresh temp id.
 *   2. The user transacts during the window → the provisional is kept and
 *      never persisted → the next launch mints a different one.
 *
 * Both are reproduced faithfully here by simulating a REBOOT (fresh module
 * state, durable store untouched) and asserting the id is stable.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	__resetIdentityForTests,
	getAnonId,
	markIdentityUsed,
} from "./identity";
import {
	__resetStoreForTests,
	__setStoreBackendForTests,
	hydrateStore,
	type NativeStore,
} from "./storage";

/** In-memory stand-in for the Capacitor/Electron native key-value store. */
function memoryNativeStore(seed: Record<string, string> = {}): NativeStore {
	const map = new Map(Object.entries(seed));
	return {
		async get(key) {
			return map.has(key) ? map.get(key)! : null;
		},
		async set(key, value) {
			map.set(key, value);
		},
		async remove(key) {
			map.delete(key);
		},
		async keys() {
			return Array.from(map.keys());
		},
	};
}

/** Simulate closing and reopening the app: fresh identity-module state
 *  (what a page reload gives you) with the durable store left untouched. */
function reboot(): void {
	__resetIdentityForTests();
}

const ANON_RE = /^anon_[a-z0-9]+$/;

beforeEach(() => {
	localStorage.clear();
	document.cookie
		.split("; ")
		.forEach((c) => (document.cookie = `${c.split("=")[0]}=; path=/; max-age=0`));
	__resetStoreForTests();
	__resetIdentityForTests();
});

afterEach(() => {
	__resetStoreForTests();
	__resetIdentityForTests();
});

describe("anon id permanence on the device backend", () => {
	it("keeps the SAME id across reboots when hydration never completes", async () => {
		// Device backend present, but hydration never finishes (slow/hung
		// bridge). Before the fix this minted a fresh memory-only temp each
		// boot; now the id is bootstrapped to the local channels.
		__setStoreBackendForTests("device", memoryNativeStore());

		const first = getAnonId();
		expect(first).toMatch(ANON_RE);

		const seen = new Set<string>([first]);
		for (let i = 0; i < 5; i++) {
			reboot();
			seen.add(getAnonId());
		}

		expect(
			seen.size,
			`anon id churned across reboots: ${Array.from(seen).join(", ")}`,
		).toBe(1);
	});

	it("keeps the id stable when the user transacts during the hydration window", async () => {
		// Returning student: the device store already holds durable id D.
		__setStoreBackendForTests(
			"device",
			memoryNativeStore({ "vb:anonId": "anon_durable00000" }),
		);

		// Boot lands in the unsettled window: a provisional is minted.
		const provisional = getAnonId();
		expect(provisional).toMatch(ANON_RE);
		expect(provisional).not.toBe("anon_durable00000");

		// The user acts (upvotes/saves/posts) before hydration completes.
		markIdentityUsed();

		// Hydration now lands, carrying the older durable id.
		await hydrateStore();

		// The transacting provisional wins — it owns this session's writes.
		expect(getAnonId()).toBe(provisional);

		// …and it must survive the next launch, not be re-minted.
		reboot();
		expect(getAnonId()).toBe(provisional);
	});

	it("adopts the durable id once, when the user did NOT transact in the window", async () => {
		__setStoreBackendForTests(
			"device",
			memoryNativeStore({ "vb:anonId": "anon_durable00000" }),
		);

		// Unsettled boot mints a provisional…
		expect(getAnonId()).toMatch(ANON_RE);

		// …hydration lands with no writes under the provisional, so the
		// durable id wins and stays stable across every later launch.
		await hydrateStore();
		expect(getAnonId()).toBe("anon_durable00000");

		reboot();
		await hydrateStore();
		expect(getAnonId()).toBe("anon_durable00000");
	});

	it("mints a durable id on true first launch (empty device store)", async () => {
		__setStoreBackendForTests("device", memoryNativeStore());

		const first = getAnonId();
		await hydrateStore();
		expect(getAnonId()).toBe(first);

		reboot();
		await hydrateStore();
		expect(getAnonId()).toBe(first);
	});
});
