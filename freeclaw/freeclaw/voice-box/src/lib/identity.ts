/**
 * Local anonymous identity — the ONLY identifier Voice Flow ever uses.
 * Generated in the browser, stored in localStorage, never linked to any personal data.
 *
 * Storage is best-effort. Every access is guarded so a blocked/cleared
 * localStorage (Safari Private Browsing, in-app browsers, school MDM policies,
 * storage partitioning) can NEVER crash the app. When localStorage is
 * unavailable, the identity falls back to a cookie, then to in-memory for the
 * current page session — so votes/ownership stay consistent within a session
 * and (via the cookie) across refreshes even on locked-down devices.
 */

import { storeClear, storeGet, storeRemove, storeSet } from "./storage";
import { storageBackend, storageReady } from "./storage";

const ID_KEY = "vb:anonId";
const CREATED_KEY = "vb:anonCreated";
// Provisional id + the "it owns writes" flag, mirrored into the local
// channels (localStorage / cookie) rather than the device store. The device
// store keeps the durable id untouched — the mirror only stops a slow boot
// from minting a NEW temp id every launch, which is what made a returning
// student's reputation appear to reset.
const PROVISIONAL_KEY = "vb:anonProvisional";
const PROVISIONAL_USED_KEY = "vb:anonProvisionalUsed";

// ---- best-effort storage adapter ---------------------------------------
// The durable store is picked by lib/storage.ts: the device's OWN storage in
// the native shells (Capacitor Preferences on the phone, a userData file in
// the desktop app), and localStorage on the web. Everything below is the
// escalation ladder on top of it, in priority order:
//
//   device / localStorage → cookie (identity-critical only) → in-memory
//
// Non-critical JSON (queues, prefs) uses memory only so large values never
// overflow a cookie's size limit.
const mem = new Map<string, string>();

// Provisional identity (slow-boot discipline): when the device backend is
// unsettled and no id is readable anywhere, getAnonId mints memory-only.
// Persisting a guess would overwrite the real id. convergeProvisional
// settles it once the store is readable.
let provisionalId: string | null = null;
let provisionalUsed = false;

function cookieName(key: string): string {
	// Cookie names cannot contain ':' (RFC 6265 separator) — normalize it away.
	return key.replace(/:/g, "_");
}

function readCookie(key: string): string | null {
	try {
		const name = cookieName(key);
		const hit = document.cookie
			.split("; ")
			.find((c) => c.startsWith(name + "="));
		return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
	} catch {
		return null;
	}
}

function writeCookie(key: string, value: string) {
	try {
		document.cookie = `${cookieName(key)}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
	} catch {
		/* cookies blocked too — memory fallback remains */
	}
}

function deleteCookie(key: string) {
	try {
		document.cookie = `${cookieName(key)}=; path=/; max-age=0; SameSite=Lax`;
	} catch {
		/* ignore */
	}
}

/** Read with cookie fallback — identity-critical keys only. */
function readItem(key: string): string | null {
	const stored = storeGet(key);
	if (stored !== null) return stored;
	const c = readCookie(key);
	if (c !== null) return c;
	return mem.get(key) ?? null;
}

/** Write with cookie fallback — identity-critical keys only. */
function writeItem(key: string, value: string) {
	if (storeSet(key, value)) return;
	writeCookie(key, value);
	mem.set(key, value);
}

function removeItem(key: string) {
	storeRemove(key);
	deleteCookie(key);
	mem.delete(key);
}

/** Read WITHOUT cookie fallback — for non-critical JSON (queues, prefs). */
function readMemItem(key: string): string | null {
	const stored = storeGet(key);
	if (stored !== null) return stored;
	return mem.get(key) ?? null;
}

/**
 * Write WITHOUT cookie fallback — for non-critical JSON (queues, prefs).
 * Returns whether the durable backend accepted the write. `false` means the
 * value survives only in this tab's memory (`mem`), so it is gone after a
 * reload; callers that show a saved state must branch on this instead of
 * assuming success.
 */
function writeMemItem(key: string, value: string): boolean {
	if (storeSet(key, value)) return true;
	mem.set(key, value);
	return false;
}

function randomId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(9));
	const raw = Array.from(bytes)
		.map((b) => b.toString(36).padStart(2, "0"))
		.join("")
		.slice(0, 14);
	return `anon_${raw}`;
}

export function getAnonId(): string {
	// A provisional id minted while the device store was still hydrating
	// always converges first: hydration may have completed since (the 20s
	// retry, a slow bridge answering late), and the durable id wins unless
	// this session already wrote under the provisional one.
	if (provisionalId) return convergeProvisional();
	// A previous launch's provisional that already owns content outranks the
	// device store: it is the identity the student's visible writes belong
	// to. Without this, every reboot during a slow boot advertised a brand
	// new identity and the durable one silently took back over next launch.
	const mirrored = readProvisionalMirror();
	if (mirrored && readProvisionalUsed()) {
		provisionalId = mirrored;
		provisionalUsed = true;
		return convergeProvisional();
	}
	let id = readItem(ID_KEY);
	if (!id) {
		if (deviceBackendUnsettled()) {
			// The durable id may exist but be unreadable yet (slow first
			// boot after an update). Mint memory-only: persisting now would
			// overwrite the real id with a temp and orphan every vote,
			// comment and reaction the student made. convergeProvisional
			// adopts the durable id (or persists this one) once known.
			// Reuse the mirrored temp id when a previous unsettled launch
			// already minted one — a hung bridge must not churn identities.
			provisionalId = mirrored ?? randomId();
			if (!mirrored) writeItem(PROVISIONAL_KEY, provisionalId);
			return provisionalId;
		}
		id = randomId();
		writeItem(ID_KEY, id);
		writeItem(CREATED_KEY, new Date().toISOString());
	}
	// IDs are always lowercase (case-insensitive everywhere)
	const normalized = id.toLowerCase();
	if (normalized !== id) writeItem(ID_KEY, normalized);
	return normalized;
}

/** True while the device store is the backend but its keys are not yet
 *  readable — the window where minting a durable id would be a guess. */
function deviceBackendUnsettled(): boolean {
	try {
		return storageBackend() === "device" && !storageReady();
	} catch {
		return false;
	}
}

/**
 * Settle a provisional id against the now-readable device store. Returns
 * the id to use from here on. Durable wins unless this session already
 * wrote under the provisional one (then the provisional stays: switching
 * would orphan the just-written content AND the durable content — the
 * newest write wins and the loss is contained to the race window).
 */
function convergeProvisional(): string {
	const current = provisionalId;
	if (!current) return getAnonId();
	try {
		if (!storageReady()) return current;
		const durable = readItem(ID_KEY);
		if (durable && durable.toLowerCase() !== current.toLowerCase()) {
			if (!provisionalUsed) {
				clearProvisionalMirror();
				provisionalId = null;
				return durable.toLowerCase();
			}
			// Used provisional: keep the durable id where it is, but keep the
			// mirror (with its used flag) so the next launch continues under
			// the identity that owns the writes the student can still see.
			writeItem(PROVISIONAL_KEY, current);
			writeItem(PROVISIONAL_USED_KEY, "1");
			return current;
		}
		if (!durable) {
			// True first launch on a device backend: the provisional id
			// becomes the real one, persisted exactly once.
			writeItem(ID_KEY, current);
			writeItem(CREATED_KEY, new Date().toISOString());
			clearProvisionalMirror();
			provisionalId = null;
			return current;
		}
		clearProvisionalMirror();
		provisionalId = null;
		return durable.toLowerCase();
	} catch {
		return current;
	}
}

/**
 * Marks the current identity as having issued a server-side write this
 * session. Called by the api layer on every mutating request — lets a
 * provisional id that already owns fresh content refuse to be swapped
 * out from under it (see convergeProvisional).
 */
export function markIdentityUsed(): void {
	provisionalUsed = true;
	// Persist the claim: if the app is closed mid-window, the next launch
	// must know this provisional already owns server-side writes.
	if (provisionalId) {
		writeItem(PROVISIONAL_KEY, provisionalId);
		writeItem(PROVISIONAL_USED_KEY, "1");
	}
}

/** The mirrored provisional id, or null. Normalized like every other id. */
function readProvisionalMirror(): string | null {
	const raw = readItem(PROVISIONAL_KEY);
	if (!raw) return null;
	const id = raw.toLowerCase();
	return id.startsWith("anon_") ? id : null;
}

function readProvisionalUsed(): boolean {
	return readItem(PROVISIONAL_USED_KEY) === "1";
}

/** A settled identity has no provisional — drop both mirror keys. */
function clearProvisionalMirror(): void {
	removeItem(PROVISIONAL_KEY);
	removeItem(PROVISIONAL_USED_KEY);
}

export function resetAnonId(): string {
	const id = randomId();
	writeItem(ID_KEY, id);
	writeItem(CREATED_KEY, new Date().toISOString());
	// An explicit reset is a settled decision, never provisional.
	clearProvisionalMirror();
	provisionalId = null;
	provisionalUsed = false;
	// ownership data belongs to the old ID — clear it
	for (const k of [
		"vb:bookmarks",
		"vb:recentlyViewed",
		"vb:notifications",
		"vb:notifSnapshot",
		"vb:drafts",
		"vb:sessionToken",
	]) {
		removeItem(k);
	}
	return id;
}

// ---------- session token persistence -----------------------------
const SESSION_TOKEN_KEY = "vb:sessionToken";

export function getSessionToken(): string | null {
	return readItem(SESSION_TOKEN_KEY);
}

export function setSessionToken(token: string): void {
	if (typeof token === "string" && token.trim()) {
		writeItem(SESSION_TOKEN_KEY, token.trim());
	}
}

export function clearSessionToken(): void {
	removeItem(SESSION_TOKEN_KEY);
}

// ---------- cross-device identity linking -------------------------
// Browser localStorage, the APK's native store, and the EXE's userData file
// are separate silos BY OPERATING-SYSTEM DESIGN — no code can silently share
// one ID between Chrome and the app on the same phone. The honest bridge is
// explicit and user-driven: a proven device shows a 6-digit pairing code
// (a server ticket), the student types it into device B, and the server
// hands B the same ID *and* a live session for it — both surfaces then act
// as one identity concurrently (POST /api/identity-link). The VF link code
// below only ENCODES the id: it is verification (compare across devices),
// never a session — id knowledge alone must not mint one, or a leaked id
// would take the identity over. Adopting an id locally (adoptIdentity*)
// therefore only ever writes storage; the server session is established by
// pairing (see adoptIdentityById's caller, Settings → pairing redeem).
const LINK_PREFIX = "VF";

function linkChecksum(payload: string): string {
	let h = 0;
	for (let i = 0; i < payload.length; i++) {
		h = (h * 31 + payload.charCodeAt(i)) % 1296;
	}
	return h.toString(36).toUpperCase().padStart(2, "0");
}

/** Short typeable code for the given identity (defaults to this device). */
export function createLinkCode(id: string = getAnonId()): string | null {
	const m = /^anon_([a-z0-9]+)$/.exec(id.toLowerCase());
	if (!m) return null;
	const payload = m[1]!.toUpperCase();
	const groups: string[] = [];
	for (let i = 0; i < payload.length; i += 4) {
		groups.push(payload.slice(i, i + 4));
	}
	return `${LINK_PREFIX}-${groups.join("-")}-${linkChecksum(payload)}`;
}

/** Parse a link code back to an anon id, or null when malformed/mistyped. */
export function parseLinkCode(code: string): string | null {
	const clean = String(code || "")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
	if (!clean.startsWith(LINK_PREFIX) || clean.length < LINK_PREFIX.length + 3) {
		return null;
	}
	const rest = clean.slice(LINK_PREFIX.length);
	if (rest.length < 3) return null;
	const payload = rest.slice(0, -2).toLowerCase();
	const check = rest.slice(-2);
	if (!/^[a-z0-9]+$/.test(payload) || payload.length > 32) return null;
	if (linkChecksum(payload.toUpperCase()) !== check.toUpperCase()) return null;
	return `anon_${payload}`;
}

/**
 * Adopt an identity the SERVER just confirmed via pairing redeem. Same
 * storage rules as adoptIdentity: the old local id is abandoned, so the
 * confirm UI must say so before calling this — and by then the response
 * has already set this device's session cookie for the adopted id.
 * Returns the adopted id, or null when the server's id is malformed
 * (nothing changes).
 */
export function adoptIdentityById(id: string): string | null {
	const normalized = String(id || "").trim().toLowerCase();
	if (!/^anon_[a-z0-9]+$/.test(normalized)) return null;
	writeItem(ID_KEY, normalized);
	// An explicit adoption is a settled decision, never provisional.
	provisionalId = null;
	provisionalUsed = false;
	return normalized;
}

/**
 * Adopt another device's identity (from a verified link code). Returns the
 * adopted id, or null when the code is invalid (nothing changes). The old
 * local id is abandoned: its published content stays up, but this device
 * stops owning it — the confirm UI must say so before calling this.
 * NOTE: this swaps STORAGE only. A device that adopts an id it has no
 * session for is denied every write by the server (proof-of-possession),
 * so the live pairing flow (Settings → /api/identity-link redeem) is the
 * only path that makes the adopted identity usable.
 */
export function adoptIdentity(code: string): string | null {
	const id = parseLinkCode(code);
	if (!id) return null;
	return adoptIdentityById(id);
}

export function anonCreatedAt(): string {
	return readItem(CREATED_KEY) || new Date().toISOString();
}

export function clearAllLocalData() {
	provisionalId = null;
	provisionalUsed = false;
	// Clears the durable store as well — on the native shells that is the
	// device's own storage, not just the WebView's localStorage, so "reset my
	// data" is actually complete there.
	storeClear("vb:");
	// Sweep cookie fallback too (cookie names are vb_* after normalization).
	try {
		document.cookie.split("; ").forEach((c) => {
			const eq = c.indexOf("=");
			const name = eq > -1 ? c.slice(0, eq) : c;
			if (name.startsWith("vb_")) deleteCookie(name.replace(/_/g, ":"));
		});
	} catch {
		/* ignore */
	}
	mem.clear();
}

// ---------- test seam ----------
/** Reset provisional module state between tests. */
export function __resetIdentityForTests(): void {
	// Module memory only: callers use this to simulate a reboot, so the
	// durable channels (device store, localStorage, cookies — including the
	// provisional mirror) must survive it exactly as they do in a real
	// relaunch.
	provisionalId = null;
	provisionalUsed = false;
}

// ---------- typed localStorage helpers ----------
const corruptWarned = new Set<string>();
export function lsGet<T>(key: string, fallback: T): T {
	try {
		const raw = readMemItem(key);
		if (!raw) return fallback;
		const parsed: unknown = JSON.parse(raw);
		return parsed as T;
	} catch (err) {
		// Corrupt JSON previously meant a silent reset to defaults (e.g. the
		// dashboard layout vanishing). Back the raw value up and warn once so
		// the reset is explainable instead of mysterious.
		try {
			writeMemItem(`vb:corrupt:${key}`, String(readMemItem(key) ?? "").slice(0, 2000));
		} catch {
			/* backup is best-effort */
		}
		if (!corruptWarned.has(key)) {
			corruptWarned.add(key);
			console.warn("[identity] corrupt stored value, restored defaults", {
				key,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return fallback;
	}
}

/**
 * Persist JSON to the device store.
 *
 * Returns `true` only when the durable backend (localStorage / Capacitor
 * Preferences / Electron file) accepted the write. `false` means storage was
 * full, blocked, or the value was unserialisable: the value still lives in
 * this tab so the UI stays usable, but it will not survive a reload. Never
 * throws, so callers must branch on the return value rather than assume a
 * green "saved" state.
 */
export function lsSet<T>(key: string, value: T): boolean {
	try {
		return writeMemItem(key, JSON.stringify(value));
	} catch (err) {
		console.warn("[identity] persist failed (storage full or blocked)", {
			key,
			error: err instanceof Error ? err.message : String(err),
		});
		return false;
	}
}

// ---------- display name (client side, optional) -----------------
// Users can give themselves a friendly display name while keeping the
// anonymous ID as the real identifier. Stored locally, never sent.
const DISPLAY_KEY = "vb:displayName";

export function getDisplayName(): string {
	try {
		return lsGet<string>(DISPLAY_KEY, "").trim();
	} catch {
		return "";
	}
}

export function setDisplayName(name: string) {
	try {
		lsSet(DISPLAY_KEY, name.trim().slice(0, 24));
	} catch {
		/* storage blocked — ignore */
	}
}

export function resetDisplayName() {
	try {
		lsSet(DISPLAY_KEY, "");
	} catch {
		/* ignore */
	}
}

// ---------- local profile (avatar + photo + bio, client side, optional) ----------
// A small optional identity flourish: an emoji avatar, an uploaded profile
// photo (kept as a data URL so it NEVER leaves the device), and a short bio.
// Stored locally, never sent to the server.
const PROFILE_KEY = "vb:profile";
const AVATAR_EMOJI_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF]{1,4}$/u;
const PHOTO_RE = /^(data:image\/(png|jpe?g|gif|webp);base64,|https?:\/\/)/i;
const PHOTO_MAX_CHARS = 500000; // ~375KB base64 — generous, keeps localStorage safe

export interface LocalProfile {
	avatar?: string;
	bio?: string;
	photo?: string;
}

const EMPTY_PROFILE: LocalProfile = { avatar: "", bio: "", photo: "" };

export function getProfile(): LocalProfile {
	try {
		const p = lsGet<LocalProfile>(PROFILE_KEY, EMPTY_PROFILE);
		return {
			avatar: typeof p?.avatar === "string" ? p.avatar.slice(0, 8) : "",
			bio: typeof p?.bio === "string" ? p.bio.trim().slice(0, 160) : "",
			photo:
				typeof p?.photo === "string" && PHOTO_RE.test(p.photo)
					? p.photo.slice(0, PHOTO_MAX_CHARS)
					: "",
		};
	} catch {
		return EMPTY_PROFILE;
	}
}

export function setProfile(p: LocalProfile): LocalProfile {
	// Start from the stored profile so a rejected field (e.g. an invalid photo
	// or non-emoji avatar) never clobbers the previously-saved valid value.
	const prev = getProfile();
	const clean: LocalProfile = {
		avatar:
			typeof p?.avatar === "string" && AVATAR_EMOJI_RE.test(p.avatar.trim())
				? p.avatar.trim().slice(0, 4)
				: prev.avatar || "",
		bio: typeof p?.bio === "string" ? p.bio.trim().slice(0, 160) : prev.bio || "",
		photo:
			p?.photo === ""
				? ""
				: typeof p?.photo === "string" && PHOTO_RE.test(p.photo)
					? p.photo.slice(0, PHOTO_MAX_CHARS)
					: prev.photo || "",
	};
	try {
		lsSet(PROFILE_KEY, clean);
	} catch {
		/* storage blocked — ignore */
	}
	return clean;
}

export function profileInitial(name: string): string {
	const base = name.trim();
	if (!base) return "•";
	const first = Array.from(base)[0] ?? "•";
	return first.toUpperCase();
}

// ---------- cooldown / flood prevention (client side) ----------
export function checkCooldown(action: string, seconds: number): number {
	const key = `vb:cd:${action}`;
	const last = Number(readItem(key) || 0);
	const remaining = Math.ceil((last + seconds * 1000 - Date.now()) / 1000);
	return remaining > 0 ? remaining : 0;
}

export function stampCooldown(action: string) {
	writeItem(`vb:cd:${action}`, String(Date.now()));
}
