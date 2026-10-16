/**
 * Device-local storage for Voice Flow.
 *
 * One durable key/value store, three real backends:
 *
 *   web     — the browser's localStorage. Unchanged, and still the only
 *             durable store on the web build.
 *   mobile  — Capacitor Preferences (`@capacitor/preferences`), which on
 *             Android is backed by native SharedPreferences, not the
 *             WebView's localStorage. Survives WebView data eviction and
 *             is readable/writable without a page load.
 *   desktop — a JSON file in Electron's `userData` directory, reached over
 *             the preload bridge (`window.vbStore`). This is the machine's
 *             own storage, not the Chromium profile, so "Clear browsing
 *             data" style actions cannot silently erase a student's
 *             identity, drafts, or bookmarks.
 *
 * ── Why a mirror ────────────────────────────────────────────────────
 * Both native backends are asynchronous (IPC, plugin bridge), but every
 * caller in this app needs a *synchronous* read: `getAnonId()` runs during
 * the first render, and a value that arrives a tick later is useless —
 * worse, a `null` would mint a second anonymous identity and orphan the
 * student's history.
 *
 * So we hydrate once at boot (`hydrateStore`, awaited in main.tsx) into an
 * in-memory mirror, then serve every read synchronously from that mirror.
 * Writes land in the mirror immediately and are persisted to the device in
 * the background, debounced — the UI never waits on a disk or IPC write.
 *
 * ── Failure policy ──────────────────────────────────────────────────
 * Every native call is best-effort. If the bridge is missing, the plugin
 * is absent, or hydration errors/times out, `deviceMode` stays false and
 * the app transparently keeps using localStorage — i.e. exactly today's
 * behaviour. A broken native store must never lose data or hang boot, so
 * hydration is capped by a timeout and we never migrate into a store we
 * could not read.
 */

import { getPlatform } from "./platform";

/** Which store is currently durable for this session. */
export type StoreBackend = "device" | "browser" | "memory";

/**
 * The minimal async contract every durable native backend implements.
 * Kept tiny on purpose so the Electron bridge and the Capacitor plugin can
 * both satisfy it, and so tests can inject a fake.
 */
export interface NativeStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

/** Reserved prefix for Voice Flow user data. Nothing else is stored here. */
const PREFIX = "vb:";

/**
 * Debounce for durable writes. Short enough that a force-quit moments after
 * a tap still lands, long enough that a burst (typing a draft) collapses to
 * one round trip.
 */
const PERSIST_DEBOUNCE_MS = 120;

/**
 * Boot ceiling for hydration. A native bridge that never answers must not
 * hold the splash up; past this we run the session on localStorage instead.
 */
const HYDRATE_TIMEOUT_MS = 1500;

// ── module state ────────────────────────────────────────────────────
let backend: StoreBackend | null = null;
/** undefined = not yet resolved, null = resolved-and-unavailable. */
let nativeStore: NativeStore | null | undefined;
let hydrated = false;
let hydrating: Promise<void> | null = null;
const mirror = new Map<string, string>();
/** Keys explicitly deleted this session — tombstones, so a stale value in
 *  localStorage can never resurrect after the device store says "gone". */
const removed = new Set<string>();
const dirty = new Set<string>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** Serializes persist runs so two flushes can't interleave writes. */
let persistChain: Promise<void> = Promise.resolve();
/** Set once hydration has definitively failed — never retried this session. */
let hydrationGaveUp = false;
/** One delayed second chance after a give-up (slow first-boot bridge). */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const HYDRATE_RETRY_MS = 20_000;

// ── localStorage probe ──────────────────────────────────────────────
let lsBlocked: boolean | null = null;

/** Probe once whether localStorage is usable. `getItem` only. */
function lsUsable(): boolean {
	if (lsBlocked === null) {
		try {
			window.localStorage.getItem("__vb_store_probe__");
			lsBlocked = false;
		} catch {
			lsBlocked = true;
		}
	}
	return !lsBlocked;
}

function lsRead(key: string): string | null {
	if (!lsUsable()) return null;
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Returns true only when localStorage actually accepted the write, so
 *  callers can fall back (see identity.ts writeItem / cookie fallback). */
function lsWrite(key: string, value: string): boolean {
	if (!lsUsable()) return false;
	try {
		window.localStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

function lsRemove(key: string): void {
	if (!lsUsable()) return;
	try {
		window.localStorage.removeItem(key);
	} catch {
		/* ignore */
	}
}

function lsKeys(): string[] {
	if (!lsUsable()) return [];
	try {
		return Object.keys(window.localStorage);
	} catch {
		return [];
	}
}

// ── backend detection ───────────────────────────────────────────────

interface DesktopBridge {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

/** The Electron preload bridge, if present and complete. */
function desktopBridge(): DesktopBridge | null {
	try {
		const candidate = (
			window as unknown as { vbStore?: Partial<DesktopBridge> }
		).vbStore;
		if (!candidate) return null;
		if (
			typeof candidate.get !== "function" ||
			typeof candidate.set !== "function" ||
			typeof candidate.remove !== "function" ||
			typeof candidate.keys !== "function"
		) {
			return null;
		}
		return candidate as DesktopBridge;
	} catch {
		return null;
	}
}

/** Capacitor Preferences, wrapped in the NativeStore contract. */
async function capacitorStore(): Promise<NativeStore | null> {
	try {
		const mod = await import("@capacitor/preferences");
		const prefs = mod?.Preferences;
		if (
			!prefs ||
			typeof prefs.get !== "function" ||
			typeof prefs.set !== "function" ||
			typeof prefs.remove !== "function" ||
			typeof prefs.keys !== "function"
		) {
			return null;
		}
		return {
			async get(key) {
				const res = await prefs.get({ key });
				return typeof res?.value === "string" ? res.value : null;
			},
			async set(key, value) {
				await prefs.set({ key, value });
			},
			async remove(key) {
				await prefs.remove({ key });
			},
			async keys() {
				const res = await prefs.keys();
				return Array.isArray(res?.keys)
					? res.keys.filter((k): k is string => typeof k === "string")
					: [];
			},
		};
	} catch {
		return null;
	}
}

function detectBackend(): StoreBackend {
	try {
		const platform = getPlatform();
		if (platform === "desktop" && desktopBridge()) return "device";
		if (platform === "mobile") return "device";
	} catch {
		/* fall through to the web path */
	}
	return lsUsable() ? "browser" : "memory";
}

/** Which store this session is using. Resolved once, then cached. */
export function storageBackend(): StoreBackend {
	if (backend === null) backend = detectBackend();
	return backend;
}

/**
 * True only when the device store is confirmed live: a real backend AND a
 * completed hydration. Any read/write path that branches on device storage
 * must check this rather than `storageBackend()` alone, so pre-hydration and
 * post-failure sessions stay on localStorage instead of reading an empty
 * mirror.
 */
function deviceMode(): boolean {
	return storageBackend() === "device" && hydrated;
}

/**
 * True when a write should go to the device mirror instead of localStorage.
 *
 * Broader than `deviceMode()`: a write that arrives while hydration is still
 * in flight must land in the mirror (it is the newer value, and hydration
 * refuses to clobber it), and it is flushed once hydration completes.
 *
 * But once hydration has definitively FAILED we must NOT swallow writes into
 * a mirror that will never be persisted — that would silently lose the
 * student's data. In that state we fall back to localStorage, which is
exactly what the web build uses.
 */
function deviceWritable(): boolean {
	if (storageBackend() !== "device") return false;
	return !hydrationGaveUp;
}

async function resolveNativeStore(): Promise<NativeStore | null> {
	if (nativeStore !== undefined) return nativeStore;
	try {
		const platform = getPlatform();
		if (platform === "desktop") {
			nativeStore = desktopBridge();
		} else if (platform === "mobile") {
			nativeStore = await capacitorStore();
		} else {
			nativeStore = null;
		}
	} catch {
		nativeStore = null;
	}
	return nativeStore;
}

// ── hydration ───────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
	return new Promise<T | null>((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve(null);
		}, ms);
		promise.then(
			(value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(null);
			},
		);
	});
}

/**
 * Copy existing localStorage `vb:*` data into an empty device store.
 *
 * This is the upgrade path: a student who used the web build (or an earlier
 * native build that only had localStorage) keeps the same anonymous identity,
 * drafts, and bookmarks. Only runs when the device store has no keys at all,
 * so it can never overwrite real device data.
 */
async function migrateFromLocalStorage(store: NativeStore): Promise<void> {
	const existing = lsKeys().filter((k) => k.startsWith(PREFIX));
	for (const key of existing) {
		if (removed.has(key)) continue;
		const value = lsRead(key);
		if (value === null) continue;
		try {
			await store.set(key, value);
			// Mirror it too, so a post-hydration read is consistent with what
			// we just migrated even if the store read-back is eventually
			// consistent rather than immediate.
			if (!mirror.has(key)) mirror.set(key, value);
		} catch {
			/* one bad key must not abort the whole migration */
		}
	}
}

/**
 * Load the device store into the mirror. Safe to call repeatedly — the work
 * happens once. Never throws and never hangs past HYDRATE_TIMEOUT_MS; on any
 * failure the session silently keeps using localStorage.
 */
export async function hydrateStore(): Promise<void> {
	if (hydrated) return;
	if (hydrationGaveUp) return;
	if (hydrating) return hydrating;

	hydrating = (async () => {
		try {
			const store = await withTimeout(resolveNativeStore(), HYDRATE_TIMEOUT_MS);
			if (!store) {
				hydrationGaveUp = true;
				return;
			}
			const keys = await withTimeout(store.keys(), HYDRATE_TIMEOUT_MS);
			if (keys === null) {
				hydrationGaveUp = true;
				return;
			}
			if (keys.length === 0) {
				await migrateFromLocalStorage(store);
			} else {
				for (const key of keys) {
					if (typeof key !== "string" || !key.startsWith(PREFIX)) continue;
					const value = await withTimeout(store.get(key), HYDRATE_TIMEOUT_MS);
					// Merge rule: never clobber a value already written this
					// session (a write that raced ahead of hydration wins,
					// because it is the newer one), and never resurrect one the
					// caller has deleted.
					if (value !== null && !mirror.has(key) && !removed.has(key)) {
						mirror.set(key, value);
					}
				}
			}
			hydrated = true;
			// Writes that landed while hydration was in flight are still dirty
			// and were never persisted (they could not be). Flush them now.
			if (dirty.size > 0) schedulePersist();
		} catch {
			hydrationGaveUp = true;
		} finally {
			hydrating = null;
		}

	})();

	// One delayed second chance, settled no matter which path gave up:
	// a bridge that was merely slow (cold first boot after an update)
	// gets another shot, so a session that minted a temporary identity
	// converges back to the durable one via the merge rules above.
	// Exactly once per session, and only when a bridge actually exists —
	// a missing bridge would just fail again on a 20s loop forever.
	void hydrating.finally(() => {
		if (
			hydrationGaveUp &&
			!hydrated &&
			nativeStore &&
			retryTimer === null &&
			typeof setTimeout === "function"
		) {
			retryTimer = setTimeout(() => {
				retryTimer = null;
				hydrationGaveUp = false;
				void hydrateStore();
			}, HYDRATE_RETRY_MS);
		}
	});

	return hydrating;
}

// ── persistence ─────────────────────────────────────────────────────

/**
 * Persist everything currently dirty. Runs are serialized so an in-flight
 * flush cannot be interleaved with the next one.
 */
export async function flushStore(): Promise<void> {
	if (persistTimer) {
		clearTimeout(persistTimer);
		persistTimer = null;
	}
	persistChain = persistChain.then(async () => {
		if (!deviceMode() || dirty.size === 0) return;
		const store = nativeStore;
		if (!store) return;
		const batch = Array.from(dirty);
		dirty.clear();
		for (const key of batch) {
			const value = mirror.get(key);
			try {
				if (value === undefined) await store.remove(key);
				else await store.set(key, value);
			} catch {
				// Re-queue so the next flush retries, but bound the retry set
				// by only keeping keys we still believe are dirty.
				dirty.add(key);
			}
		}
	});
	await persistChain;
}

function schedulePersist(): void {
	if (typeof setTimeout !== "function") return;
	if (persistTimer) return;
	persistTimer = setTimeout(() => {
		persistTimer = null;
		void flushStore();
	}, PERSIST_DEBOUNCE_MS);
}

/** Flush synchronously-ish on the way out — the last chance before a kill. */
function installLifecycleFlush(): void {
	if (typeof window === "undefined") return;
	const flushNow = () => {
		if (deviceMode() && dirty.size > 0) void flushStore();
	};
	try {
		window.addEventListener("pagehide", flushNow);
		window.addEventListener("beforeunload", flushNow);
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") flushNow();
		});
	} catch {
		/* no DOM (tests/SSR) — the debounced flush still runs */
	}
}
installLifecycleFlush();

// ── synchronous store API (the seam identity.ts consumes) ───────────

/**
 * Read a value. Mirror-first on the device backend, localStorage everywhere
 * else.
 *
 * On the device backend, before hydration finishes the mirror is not yet
 * authoritative for every key, so we fall back to localStorage — an older
 * build wrote there and that data must not appear lost mid-boot. Once
 * hydration completes the mirror IS authoritative, and a missing key means
 * genuinely absent (unless tombstoned), never "ask localStorage".
 */
export function storeGet(key: string): string | null {
	if (storageBackend() === "device") {
		if (removed.has(key)) return null;
		const v = mirror.get(key);
		if (v !== undefined) return v;
		return hydrated ? null : lsRead(key);
	}
	return lsRead(key);
}

/**
 * Write a value. Durable write is deferred so callers stay synchronous.
 * Returns true when the value was accepted — on the device backend the
 * mirror has it from this instant, so it is accepted even though the disk
 * write is still pending. False means nothing could hold it.
 */
export function storeSet(key: string, value: string): boolean {
	if (deviceWritable()) {
		mirror.set(key, value);
		removed.delete(key);
		dirty.add(key);
		schedulePersist();
		return true;
	}
	return lsWrite(key, value);
}

/** Remove a value. */
export function storeRemove(key: string): void {
	if (deviceWritable()) {
		mirror.delete(key);
		removed.add(key);
		dirty.add(key); // flush turns this tombstone into a real delete
		schedulePersist();
		return;
	}
	lsRemove(key);
}

/** All keys under the Voice Flow prefix. */
export function storeKeys(): string[] {
	if (deviceWritable()) {
		const keys = new Set(
			Array.from(mirror.keys()).filter((k) => k.startsWith(PREFIX)),
		);
		// Pre-hydration, the WebView may still hold keys we have not loaded.
		if (!hydrated) {
			for (const k of lsKeys()) if (k.startsWith(PREFIX)) keys.add(k);
		}
		for (const k of removed) keys.delete(k);
		return Array.from(keys);
	}
	return lsKeys().filter((k) => k.startsWith(PREFIX));
}

/** Delete every key under the prefix. */
export function storeClear(prefix: string = PREFIX): void {
	if (deviceWritable()) {
		const keys = new Set(Array.from(mirror.keys()));
		if (!hydrated) for (const k of lsKeys()) keys.add(k);
		for (const key of keys) {
			if (!key.startsWith(prefix)) continue;
			mirror.delete(key);
			removed.add(key);
			dirty.add(key);
		}
		void flushStore();
		return;
	}
	for (const key of lsKeys()) {
		if (key.startsWith(prefix)) lsRemove(key);
	}
}

/** True once the device mirror is live. Used by diagnostics/tests. */
export function storageReady(): boolean {
	return deviceMode();
}

// ── test seam ───────────────────────────────────────────────────────

/** Inject a fake native store and/or force a backend. Tests only. */
export function __setStoreBackendForTests(
	next: StoreBackend | null,
	store?: NativeStore | null,
): void {
	backend = next;
	if (store !== undefined) nativeStore = store;
	hydrated = false;
	hydrationGaveUp = false;
	hydrating = null;
	if (retryTimer) {
		clearTimeout(retryTimer);
		retryTimer = null;
	}
	mirror.clear();
	removed.clear();
	dirty.clear();
	lsBlocked = null;
	if (persistTimer) {
		clearTimeout(persistTimer);
		persistTimer = null;
	}
}

/** Reset all module state between tests. */
export function __resetStoreForTests(): void {
	backend = null;
	nativeStore = undefined;
	hydrated = false;
	hydrationGaveUp = false;
	hydrating = null;
	if (retryTimer) {
		clearTimeout(retryTimer);
		retryTimer = null;
	}
	mirror.clear();
	removed.clear();
	dirty.clear();
	persistChain = Promise.resolve();
	lsBlocked = null;
	if (persistTimer) {
		clearTimeout(persistTimer);
		persistTimer = null;
	}
}
