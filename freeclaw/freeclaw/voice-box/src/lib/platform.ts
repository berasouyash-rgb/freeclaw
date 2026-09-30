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
 * Absolute API origin for native shells, e.g. "https://voice-box.vercel.app".
 * Baked in at build time via VITE_API_BASE. Empty string = same-origin,
 * which is correct for the browser build served alongside /api.
 */
export function apiBase(): string {
	try {
		const raw =
			typeof import.meta !== "undefined"
				? ((import.meta.env?.VITE_API_BASE as string | undefined) ?? "")
				: "";
		const base = raw.trim().replace(/\/+$/, "");
		// Only http(s) origins are ever valid — a typo'd scheme must fail
		// closed to "" (same-origin) rather than produce garbage URLs.
		return /^https?:\/\//i.test(base) ? base : "";
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
