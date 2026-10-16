// ═══════════════════════════════════════════════════════════════════
// Device-local storage
// ═══════════════════════════════════════════════════════════════════
// Pins the three-backend contract in src/lib/storage.ts:
//
//   web     → localStorage, exactly as before (no behaviour change)
//   mobile  → Capacitor Preferences (native SharedPreferences)
//   desktop → a file in Electron userData, over the preload bridge
//
// The load-bearing guarantees, in order of how much they would hurt:
//
//   1. A student's anonymous identity lives in the DEVICE store on native
//      shells, so wiping the WebView's localStorage does not orphan them
//      into a brand-new identity with no history.
//   2. Upgrading from the web build migrates existing vb:* data into the
//      device store instead of starting empty.
//   3. Nothing native is ever load-bearing for boot: a missing bridge, a
//      throwing bridge, or a bridge that never answers all degrade to
//      localStorage rather than losing data or hanging the splash.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetStoreForTests,
	__setStoreBackendForTests,
	flushStore,
	hydrateStore,
	type NativeStore,
	storageBackend,
	storageReady,
	storeClear,
	storeGet,
	storeKeys,
	storeRemove,
	storeSet,
} from "../lib/storage";
import { getAnonId } from "../lib/identity";

/** In-memory stand-in for a native backend, with call counters. */
function memStore(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	const calls = { get: 0, set: 0, remove: 0, keys: 0 };
	const store: NativeStore = {
		async get(key) {
			calls.get++;
			return data.get(key) ?? null;
		},
		async set(key, value) {
			calls.set++;
			data.set(key, value);
		},
		async remove(key) {
			calls.remove++;
			data.delete(key);
		},
		async keys() {
			calls.keys++;
			return Array.from(data.keys());
		},
	};
	return { data, calls, store };
}

/** A backend where every single call fails. */
const boomStore: NativeStore = {
	get: () => Promise.reject(new Error("bridge unavailable")),
	set: () => Promise.reject(new Error("bridge unavailable")),
	remove: () => Promise.reject(new Error("bridge unavailable")),
	keys: () => Promise.reject(new Error("bridge unavailable")),
};

function setShellGlobals(opts: {
	desktop?: boolean;
	bridge?: unknown;
	capacitor?: boolean;
}) {
	const w = window as unknown as Record<string, unknown>;
	if (opts.desktop) w.vbDesktop = true;
	if (opts.bridge !== undefined) w.vbStore = opts.bridge;
	if (opts.capacitor) w.Capacitor = { isNativePlatform: () => true };
}

function clearShellGlobals() {
	const w = window as unknown as Record<string, unknown>;
	delete w.vbDesktop;
	delete w.vbStore;
	delete w.Capacitor;
}

// jsdom's window.localStorage is an own DATA property whose prototype is NOT
// Storage.prototype, so `vi.spyOn(Storage.prototype, "setItem")` never
// intercepts it. Redefine the property instead (same approach as
// identity-blocked.test.ts).
const originalLsDescriptor = Object.getOwnPropertyDescriptor(
	window,
	"localStorage",
)!;

/** localStorage that reads fine but refuses every write, like a full quota.
 *  Reads must keep working so the reachability probe still passes — this is
 *  specifically the "accepted until you actually stored something" case. */
function blockWritesOnly() {
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		get() {
			const real = originalLsDescriptor.get!.call(window) as Storage;
			return {
				getItem: (k: string) => real.getItem(k),
				removeItem: (k: string) => real.removeItem(k),
				setItem: () => {
					throw new Error("QuotaExceededError");
				},
			};
		},
	});
}

function restoreStorage() {
	Object.defineProperty(window, "localStorage", originalLsDescriptor);
}

beforeEach(() => {
	restoreStorage();
	localStorage.clear();
	clearShellGlobals();
	__resetStoreForTests();
});

afterEach(() => {
	restoreStorage();
	vi.restoreAllMocks();
	vi.useRealTimers();
	localStorage.clear();
	clearShellGlobals();
	__resetStoreForTests();
});

describe("backend selection", () => {
	it("uses the browser store with no shell globals", () => {
		expect(storageBackend()).toBe("browser");
	});

	it("uses the device store in the desktop shell with a complete bridge", () => {
		const { store } = memStore();
		setShellGlobals({
			desktop: true,
			bridge: {
				get: (k: string) => store.get(k),
				set: (k: string, v: string) => store.set(k, v),
				remove: (k: string) => store.remove(k),
				keys: () => store.keys(),
			},
		});
		expect(storageBackend()).toBe("device");
	});

	it("stays on the browser store when the desktop bridge is incomplete", () => {
		// A bridge missing methods would fail on first use — refuse it up front
		// rather than half-work.
		setShellGlobals({ desktop: true, bridge: { get: () => null } });
		expect(storageBackend()).toBe("browser");
	});

	it("ignores a vbStore bridge without the desktop flag", () => {
		const { store } = memStore();
		setShellGlobals({ bridge: store });
		expect(storageBackend()).toBe("browser");
	});

	it("uses the device store in the mobile shell", () => {
		setShellGlobals({ capacitor: true });
		expect(storageBackend()).toBe("device");
		// …but it is not live until hydration succeeds.
		expect(storageReady()).toBe(false);
	});
});

describe("web backend — behaviour is unchanged", () => {
	it("round-trips through localStorage", () => {
		expect(storeSet("vb:theme", "dark")).toBe(true);
		expect(storeGet("vb:theme")).toBe("dark");
		expect(localStorage.getItem("vb:theme")).toBe("dark");

		storeRemove("vb:theme");
		expect(storeGet("vb:theme")).toBeNull();
	});

	it("reports failure when localStorage refuses the write", () => {
		// identity.ts relies on this signal to fall back to the identity cookie.
		blockWritesOnly();
		expect(storeSet("vb:drafts", "[]")).toBe(false);
	});

	it("lists and clears only vb:* keys", () => {
		localStorage.setItem("vb:a", "1");
		localStorage.setItem("vb:b", "2");
		localStorage.setItem("unrelated", "keep me");
		expect(storeKeys().sort()).toEqual(["vb:a", "vb:b"]);

		storeClear();
		expect(storeKeys()).toEqual([]);
		expect(localStorage.getItem("unrelated")).toBe("keep me");
	});
});

describe("device backend — hydration", () => {
	it("serves device values synchronously after hydration", async () => {
		const { store } = memStore({ "vb:theme": "device-dark" });
		__setStoreBackendForTests("device", store);
		await hydrateStore();

		expect(storageReady()).toBe(true);
		expect(storeGet("vb:theme")).toBe("device-dark");
	});

	it("keeps the anonymous identity in the device store, not localStorage", async () => {
		// The regression this whole layer exists to prevent: on a native shell
		// the identity must come from the device, so a WebView localStorage
		// wipe cannot silently re-mint the student as a brand-new person.
		const { store } = memStore({ "vb:anonId": "anon_keptindevice" });
		__setStoreBackendForTests("device", store);
		await hydrateStore();

		expect(localStorage.getItem("vb:anonId")).toBeNull();
		expect(getAnonId()).toBe("anon_keptindevice");
		// …and it survives a second boot from the same device store.
		__resetStoreForTests();
		localStorage.clear();
		__setStoreBackendForTests("device", store);
		await hydrateStore();
		expect(getAnonId()).toBe("anon_keptindevice");
	});

	it("migrates existing localStorage data into an empty device store", async () => {
		localStorage.setItem("vb:anonId", "anon_fromweb");
		localStorage.setItem("vb:bookmarks", JSON.stringify(["post-1"]));
		const { data, store } = memStore();
		__setStoreBackendForTests("device", store);

		await hydrateStore();

		expect(data.get("vb:anonId")).toBe("anon_fromweb");
		expect(data.get("vb:bookmarks")).toBe(JSON.stringify(["post-1"]));
		expect(getAnonId()).toBe("anon_fromweb");
	});

	it("never migrates over a device store that already has data", async () => {
		localStorage.setItem("vb:anonId", "anon_fromweb");
		const { data, store } = memStore({ "vb:anonId": "anon_fromdevice" });
		__setStoreBackendForTests("device", store);

		await hydrateStore();

		expect(data.get("vb:anonId")).toBe("anon_fromdevice");
		expect(storeGet("vb:anonId")).toBe("anon_fromdevice");
	});

	it("does not let hydration clobber a write that raced ahead of it", async () => {
		const { data, store } = memStore({ "vb:x": "device-old" });
		__setStoreBackendForTests("device", store);

		// Before hydration a write is already in flight…
		storeSet("vb:x", "newer");
		await hydrateStore();
		await flushStore();

		// …the newer value wins locally AND is persisted, not lost.
		expect(storeGet("vb:x")).toBe("newer");
		expect(data.get("vb:x")).toBe("newer");
	});

	it("persists a key first written before hydration finished", async () => {
		const { data, store } = memStore({ "vb:seed": "device" });
		__setStoreBackendForTests("device", store);

		storeSet("vb:fresh", "written-during-boot");
		await hydrateStore();
		await flushStore();

		expect(storeGet("vb:seed")).toBe("device");
		expect(data.get("vb:fresh")).toBe("written-during-boot");
	});

	it("tombstones a delete so a stale localStorage value cannot resurrect", async () => {
		localStorage.setItem("vb:drafts", JSON.stringify(["stale"]));
		const { data, store } = memStore();
		__setStoreBackendForTests("device", store);
		await hydrateStore();

		storeRemove("vb:drafts");
		await flushStore();

		// Gone locally, gone from the device store, and the localStorage copy
		// that hydration left behind is not consulted again.
		expect(storeGet("vb:drafts")).toBeNull();
		expect(data.has("vb:drafts")).toBe(false);
	});
});

describe("device backend — durability", () => {
	beforeEach(async () => {
		// Each test in this block starts from a live hydrated device store.
	});

	async function bootWith(initial: Record<string, string>) {
		const mem = memStore(initial);
		__setStoreBackendForTests("device", mem.store);
		await hydrateStore();
		return mem;
	}

	it("writes through to the device store on flush", async () => {
		const { data } = await bootWith({});
		storeSet("vb:notif-prefs", JSON.stringify({ email: true }));
		await flushStore();
		expect(data.get("vb:notif-prefs")).toBe(JSON.stringify({ email: true }));
	});

	it("deletes from the device store on flush", async () => {
		const { data, calls } = await bootWith({ "vb:gone": "1" });
		storeRemove("vb:gone");
		await flushStore();
		expect(data.has("vb:gone")).toBe(false);
		expect(calls.remove).toBe(1);
	});

	it("clears every vb:* key from the device store", async () => {
		const { data } = await bootWith({
			"vb:a": "1",
			"vb:b": "2",
			other: "untouched",
		});
		storeClear();
		await flushStore();

		expect(storeKeys()).toEqual([]);
		expect(data.has("vb:a")).toBe(false);
		expect(data.has("vb:b")).toBe(false);
		expect(data.get("other")).toBe("untouched");
	});
});

describe("graceful degradation — the device store is never load-bearing", () => {
	it("falls back to localStorage when the device store throws", async () => {
		localStorage.setItem("vb:anonId", "anon_localonly");
		__setStoreBackendForTests("device", boomStore);

		await hydrateStore();

		expect(storageReady()).toBe(false);
		expect(storeGet("vb:anonId")).toBe("anon_localonly");
		expect(getAnonId()).toBe("anon_localonly");
		// Writes are not lost — they land in the fallback store.
		storeSet("vb:theme", "still-works");
		expect(localStorage.getItem("vb:theme")).toBe("still-works");
	});

	it("gives up on a bridge that never answers instead of hanging boot", async () => {
		vi.useFakeTimers();
		const never: NativeStore = {
			get: () => new Promise<string | null>(() => {}),
			set: () => new Promise<void>(() => {}),
			remove: () => new Promise<void>(() => {}),
			keys: () => new Promise<string[]>(() => {}),
		};
		localStorage.setItem("vb:anonId", "anon_fromfallback");
		__setStoreBackendForTests("device", never);

		const pending = hydrateStore();
		// Past the hydration ceiling, boot must proceed.
		await vi.advanceTimersByTimeAsync(2000);
		await pending;

		expect(storageReady()).toBe(false);
		expect(storeGet("vb:anonId")).toBe("anon_fromfallback");
	});
});
