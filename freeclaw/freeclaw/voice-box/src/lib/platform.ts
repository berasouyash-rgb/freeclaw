/**
 * Shell detection + native-shell configuration for Voice Box.
 *
 * One codebase ships three ways:
 *   web     — Chrome/browser. Identity + activity stay in the browser's
 *             localStorage (see lib/identity.ts).
 *   desktop — Electron wrapper. The same localStorage API persists inside
 *             the app's on-device profile (Electron userData), so
 *             activity is recorded on the local computer.
 *   mobile  — Capacitor wrapper. localStorage persists in the app's
 *             on-device WebView data, so activity is recorded on the phone.
 *
 * No code path branches on platform for *behavior* — only transport
 * (router type, API base URL) adapts. Everything the user can do is
 * identical on all three shells.
 */

export type AppPlatform = "web" | "desktop" | "mobile";

interface CapacitorGlobal {
	isNativePlatform?: () => boolean;
}

/** The Electron preload bridge sets `window.vbDesktop = true`. */
function hasDesktopBridge(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			(window as unknown as { vbDesktop?: unknown }).vbDesktop === true
		);
	} catch {
		return false;
	}
}

function hasCapacitorNative(): boolean {
	try {
		const cap =
			typeof window !== "undefined"
				? (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
				: undefined;
		return typeof cap?.isNativePlatform === "function"
			? cap.isNativePlatform() === true
			: false;
	} catch {
		return false;
	}
}

/** Which shell is hosting the app. Pure function of window globals. */
export function getPlatform(): AppPlatform {
	if (hasCapacitorNative()) return "mobile";
	if (hasDesktopBridge()) return "desktop";
	return "web";
}

/** True inside the Electron or Capacitor shells (hash routing, remote API). */
export function isNativeShell(): boolean {
	return getPlatform() !== "web";
}

/**
 * True ONLY inside the Capacitor Android app (the APK). Use for APK-only
 * UI layers — mobile sticky header, entrance animations, skeleton loaders,
 * alternate logo. Web and desktop builds never take these branches, so
 * their experience is byte-for-byte unchanged.
 */
export function isMobileApp(): boolean {
	return getPlatform() === "mobile";
}

/**
 * Absolute API origin for native shells, e.g. "https://voice-box-psi.vercel.app".
 * Baked in at build time via VITE_API_BASE. Empty string = same-origin,
 * which is correct for the browser build served alongside /api.
 *
 * Desktop fallback (Failed-to-fetch fix): an EXE built without VITE_API_BASE
 * baked in used to call fetch("/api/...") from a file:// page — which always
 * throws TypeError: Failed to fetch. In a native shell an empty base can
 * never work, so fall back to the production origin instead of same-origin.
 * A runtime override (localStorage vb:apiBase or window.__VB_API_BASE) wins
 * over both, so a mis-pinned build can still be repointed without reinstall.
 *
 * WHICH origin matters. There are two deployments:
 *   - voice-box-psi.vercel.app — serves the API (/api/posts returns real JSON).
 *   - voice-box.vercel.app    — serves the static frontend; /api/* 404s on EVERY route.
 * This constant previously named the second one, so every request the desktop
 * and mobile shells made failed with "Failed to fetch" while the browser build
 * was perfectly healthy — and no test caught it, because nothing pinned the
 * value. Verified against the live deployments when this was corrected.
 */
const DEFAULT_NATIVE_API_BASE = "https://voice-box-psi.vercel.app";

function runtimeApiOverride(): string {
	try {
		const w = window as unknown as { __VB_API_BASE?: unknown };
		const raw =
			(typeof w.__VB_API_BASE === "string" && w.__VB_API_BASE) ||
			window.localStorage?.getItem("vb:apiBase") ||
			"";
		const base = raw.trim().replace(/\/+$/, "");
		return /^https?:\/\//i.test(base) ? base : "";
	} catch {
		return "";
	}
}

export function apiBase(): string {
	try {
		const raw =
			typeof import.meta !== "undefined"
				? ((import.meta.env?.VITE_API_BASE as string | undefined) ?? "")
				: "";
		const base = raw.trim().replace(/\/+$/, "");
		if (/^https?:\/\//i.test(base)) return base;
		// Baked value missing/invalid — honor a runtime override first.
		const override = runtimeApiOverride();
		if (override) return override;
		// Native shells have no same-origin /api (file:// page) — fail open
		// to production rather than fail every request with Failed to fetch.
		// Web keeps "" (same-origin) so a typo'd env can never leak cross-site.
		try {
			if (isNativeShell()) return DEFAULT_NATIVE_API_BASE;
		} catch {
			/* ignore — fall through to same-origin */
		}
		return "";
	} catch {
		return "";
	}
}

/** Honest one-liner for UI copy about where local data lives. */
export function storageWhere(): string {
	switch (getPlatform()) {
		case "desktop":
			return "on this computer (inside the Voice Box desktop app)";
		case "mobile":
			return "on this phone (inside the Voice Box app)";
		default:
			return "in this browser";
	}
}
