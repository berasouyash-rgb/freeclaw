// ═══════════════════════════════════════════════════════════════════
// Provisional identity — slow-boot discipline for native shells
// ═══════════════════════════════════════════════════════════════════
// The ID-death mechanism this locks out: on a slow first boot after an
// update, device-store hydration can exceed its timeout while the durable
// ID sits unreadable. Minting + persisting a fresh ID in that window
// overwrites the real one and orphans every vote, comment and reaction.
// So while the device backend is unsettled, getAnonId mints MEMORY-ONLY
// and converges once the store is readable: the durable ID wins unless
// this session already wrote under the provisional one.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetIdentityForTests,
	getAnonId,
	markIdentityUsed,
} from "../lib/identity";
import {
	__resetStoreForTests,
	__setStoreBackendForTests,
	hydrateStore,
	storageReady,
} from "../lib/storage";
import type { NativeStore } from "../lib/storage";

function fakeStore(initial: Record<string, string> = {}): NativeStore & {
	data: Map<string, string>;
} {
	const data = new Map(Object.entries(initial));
	return {
		data,
		get: async (k: string) => data.get(k) ?? null,
		set: async (k: string, v: string) => void data.set(k, v),
		remove: async (k: string) => void data.delete(k),
		keys: async () => [...data.keys()],
	};
}

function neverStore(): NativeStore {
	const hang = () => new Promise<never>(() => {});
	return {
		get: hang,
		set: hang,
		remove: hang,
		keys: hang,
	};
}

beforeEach(() => {
	localStorage.clear();
	document.cookie.split("; ").forEach((c) => {
		const eq = c.indexOf("=");
		const name = (eq > -1 ? c.slice(0, eq) : c).trim();
		if (name) document.cookie = `${name}=; path=/; max-age=0`;
	});
	__resetStoreForTests();
	__resetIdentityForTests();
	vi.useRealTimers();
});

describe("provisional identity on an unsettled device backend", () => {
	it("mints memory-only when hydration cannot finish — nothing durable is written", async () => {
		__setStoreBackendForTests("device", neverStore());
		// Hydration hangs past its 1.5s ceiling → give-up path.
		vi.useFakeTimers();
		try {
			const p = hydrateStore();
			await vi.advanceTimersByTimeAsync(2_000);
			await p;
		} finally {
			vi.useRealTimers();
		}
		expect(storageReady()).toBe(false);

		const id = getAnonId();
		expect(id).toMatch(/^anon_[a-z0-9]+$/);
		// Memory-only: localStorage, cookies and a re-read agree WITHOUT
		// any durable write… (re-read returns the same provisional id)
		expect(getAnonId()).toBe(id);
		expect(localStorage.getItem("vb:anonId")).toBeNull();
		expect(document.cookie.includes("vb_anonId")).toBe(false);
	});

	it("converges to the durable id once hydration completes (unused provisional)", async () => {
		const store = fakeStore();
		__setStoreBackendForTests("device", store);
		// Bridge answers slowly: first hydration attempt hangs → give-up.
		const slow = neverStore();
		__setStoreBackendForTests("device", slow);
		vi.useFakeTimers();
		try {
			const p = hydrateStore();
			await vi.advanceTimersByTimeAsync(2_000);
			await p;
		} finally {
			vi.useRealTimers();
		}
		const provisional = getAnonId();

		// The bridge answers (20s retry path): durable id arrives.
		__setStoreBackendForTests("device", fakeStore({ "vb:anonId": "anon_durable1" }));
		await hydrateStore();
		expect(storageReady()).toBe(true);
		expect(getAnonId()).toBe("anon_durable1");
		expect(getAnonId()).not.toBe(provisional);
	});

	it("a used provisional sticks — newest write wins, documented split-brain rule", async () => {
		__setStoreBackendForTests("device", neverStore());
		vi.useFakeTimers();
		try {
			const p = hydrateStore();
			await vi.advanceTimersByTimeAsync(2_000);
			await p;
		} finally {
			vi.useRealTimers();
		}
		const provisional = getAnonId();
		markIdentityUsed(); // a vote/comment went out under it

		__setStoreBackendForTests("device", fakeStore({ "vb:anonId": "anon_durable1" }));
		await hydrateStore();
		expect(getAnonId()).toBe(provisional);
	});

	it("true first launch on a settled device backend mints and persists", async () => {
		__setStoreBackendForTests("device", fakeStore());
		await hydrateStore();
		expect(storageReady()).toBe(true);
		const id = getAnonId();
		expect(id).toMatch(/^anon_[a-z0-9]+$/);
		expect(localStorage.getItem("vb:anonId")).toBeNull(); // device mirror owns it, not LS
		expect(getAnonId()).toBe(id);
	});

	it("web backend behavior is unchanged (immediate mint + persist)", () => {
		__setStoreBackendForTests("browser", null);
		const id = getAnonId();
		expect(id).toMatch(/^anon_[a-z0-9]+$/);
		expect(localStorage.getItem("vb:anonId")).toBe(id);
	});
});
