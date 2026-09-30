/**
 * Local anonymous identity — the ONLY identifier Voice Box ever uses.
 * Generated in the browser, stored in localStorage, never linked to any personal data.
 *
 * Storage is best-effort. Every access is guarded so a blocked/cleared
 * localStorage (Safari Private Browsing, in-app browsers, school MDM policies,
 * storage partitioning) can NEVER crash the app. When localStorage is
 * unavailable, the identity falls back to a cookie, then to in-memory for the
 * current page session — so votes/ownership stay consistent within a session
 * and (via the cookie) across refreshes even on locked-down devices.
 */

const ID_KEY = "vb:anonId";
const CREATED_KEY = "vb:anonCreated";

// ---- best-effort storage adapter ---------------------------------------
// Priority: localStorage → cookie (identity-critical only) → in-memory.
// Non-critical JSON (queues, prefs) uses memory only so large values never
// overflow a cookie's size limit.
const mem = new Map<string, string>();

/** Probe once whether localStorage is reachable. Uses getItem only — real
 *  blocked storage throws on getItem too, and the quota test mocks setItem
 *  without affecting this probe. */
let storageBlocked: boolean | null = null;
function isStorageBlocked(): boolean {
	if (storageBlocked === null) {
		try {
			window.localStorage.getItem("__vb_probe__");
			storageBlocked = false;
		} catch {
			storageBlocked = true;
		}
	}
	return storageBlocked;
}

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
	if (!isStorageBlocked()) {
		try {
			const v = window.localStorage.getItem(key);
			if (v !== null) return v;
		} catch {
			/* fall through */
		}
	}
	const c = readCookie(key);
	if (c !== null) return c;
	return mem.get(key) ?? null;
}

/** Write with cookie fallback — identity-critical keys only. */
function writeItem(key: string, value: string) {
	if (!isStorageBlocked()) {
		try {
			window.localStorage.setItem(key, value);
			return;
		} catch {
			/* fall through */
		}
	}
	writeCookie(key, value);
	mem.set(key, value);
}

function removeItem(key: string) {
	if (!isStorageBlocked()) {
		try {
			window.localStorage.removeItem(key);
		} catch {
			/* ignore */
		}
	}
	deleteCookie(key);
	mem.delete(key);
}

/** Read WITHOUT cookie fallback — for non-critical JSON (queues, prefs). */
function readMemItem(key: string): string | null {
	if (!isStorageBlocked()) {
		try {
			const v = window.localStorage.getItem(key);
			if (v !== null) return v;
		} catch {
			/* fall through */
		}
	}
	return mem.get(key) ?? null;
}

/** Write WITHOUT cookie fallback — for non-critical JSON (queues, prefs). */
function writeMemItem(key: string, value: string) {
	if (!isStorageBlocked()) {
		try {
			window.localStorage.setItem(key, value);
			return;
		} catch {
			/* fall through */
		}
	}
	mem.set(key, value);
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
	let id = readItem(ID_KEY);
	if (!id) {
		id = randomId();
		writeItem(ID_KEY, id);
		writeItem(CREATED_KEY, new Date().toISOString());
	}
	// IDs are always lowercase (case-insensitive everywhere)
	const normalized = id.toLowerCase();
	if (normalized !== id) writeItem(ID_KEY, normalized);
	return normalized;
}

export function resetAnonId(): string {
	const id = randomId();
	writeItem(ID_KEY, id);
	writeItem(CREATED_KEY, new Date().toISOString());
	// ownership data belongs to the old ID — clear it
	for (const k of [
		"vb:bookmarks",
		"vb:recentlyViewed",
		"vb:notifications",
		"vb:notifSnapshot",
		"vb:drafts",
	]) {
		removeItem(k);
	}
	return id;
}

export function anonCreatedAt(): string {
	return readItem(CREATED_KEY) || new Date().toISOString();
}

export function clearAllLocalData() {
	if (!isStorageBlocked()) {
		try {
			const keys = Object.keys(window.localStorage).filter((k) =>
				k.startsWith("vb:"),
			);
			keys.forEach((k) => window.localStorage.removeItem(k));
		} catch {
			/* ignore */
		}
	}
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

export function lsSet<T>(key: string, value: T) {
	try {
		writeMemItem(key, JSON.stringify(value));
	} catch (err) {
		console.warn("[identity] persist failed (storage full or blocked)", {
			key,
			error: err instanceof Error ? err.message : String(err),
		});
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
