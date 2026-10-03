// App update check — native shells only (APK + EXE). Polls /api/version at
// most once a day, compares against the baked build version, and lets the
// shell surface an "Update detected" dialog with Update now / Later. Web
// browsers update on reload by themselves and never enter this path. Every
// failure mode (network down, bad payload, empty feed) resolves to "no
// update" — the check must never break or nag the app.

import { apiBase, getPlatform } from "./platform";
import { showBrowserNotification } from "./browserNotify";

/** Build baked at compile time; override with VITE_APP_VERSION per release. */
const CURRENT_VERSION: string =
	(import.meta.env?.VITE_APP_VERSION as string | undefined) || "2.0.0";

const LAST_CHECK_KEY = "vb:update:lastCheck";
const SNOOZE_KEY = "vb:update:snoozeUntil";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface AppUpdate {
	platform: "android" | "windows";
	version: string;
	url: string;
	notes?: string;
}

/** Numeric dotted-version compare. Garbage parses as 0.0.0 (never newer). */
export function compareVersions(a: string, b: string): number {
	const pa = String(a || "")
		.split(".")
		.map((n) => {
			const v = parseInt(n, 10);
			return Number.isFinite(v) && v >= 0 ? v : 0;
		});
	const pb = String(b || "")
		.split(".")
		.map((n) => {
			const v = parseInt(n, 10);
			return Number.isFinite(v) && v >= 0 ? v : 0;
		});
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d > 0 ? 1 : -1;
	}
	return 0;
}

function readTime(key: string): number {
	try {
		const v = Number(localStorage.getItem(key) || 0);
		return Number.isFinite(v) ? v : 0;
	} catch {
		return 0;
	}
}

/** Record "Later" — silence update prompts for 24h. */
export function snoozeUpdate(now = Date.now()): void {
	try {
		localStorage.setItem(SNOOZE_KEY, String(now + SNOOZE_MS));
	} catch {
		/* storage blocked — next check simply runs again */
	}
}

/**
 * Check once for a newer native build. Returns the update descriptor, or
 * null when current, unchecked (web/snoozed/cached), or on any failure.
 */
export async function checkForAppUpdate(now = Date.now()): Promise<AppUpdate | null> {
	const platform = getPlatform();
	if (platform !== "mobile" && platform !== "desktop") return null;
	if (readTime(SNOOZE_KEY) > now) return null;
	if (now - readTime(LAST_CHECK_KEY) < CHECK_INTERVAL_MS) {
		// Daily cache hit — re-derive from the last fetched feed instead of
		// hitting the network again. Without a stored find there is nothing.
		return lastFound();
	}
	try {
		const res = await fetch(`${apiBase()}/api/version`, {
			method: "GET",
			credentials: "omit",
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			platforms?: Record<string, { version?: unknown; url?: unknown; notes?: unknown }>;
		};
		const key = platform === "mobile" ? "android" : "windows";
		const entry = data?.platforms?.[key];
		const version = typeof entry?.version === "string" ? entry.version : "";
		const url = typeof entry?.url === "string" ? entry.url : "";
		if (!version || !url) return null;
		try {
			localStorage.setItem(LAST_CHECK_KEY, String(now));
		} catch {
			/* ignore */
		}
		if (compareVersions(version, CURRENT_VERSION) <= 0) {
			clearFound();
			return null;
		}
		const found: AppUpdate = {
			platform: key as AppUpdate["platform"],
			version,
			url,
			...(typeof entry?.notes === "string" && entry.notes
				? { notes: entry.notes.slice(0, 300) }
				: {}),
		};
		storeFound(found);
		return found;
	} catch {
		return null;
	}
}

const FOUND_KEY = "vb:update:found";

function storeFound(found: AppUpdate): void {
	try {
		localStorage.setItem(FOUND_KEY, JSON.stringify(found));
	} catch {
		/* ignore */
	}
}

function lastFound(): AppUpdate | null {
	try {
		const raw = localStorage.getItem(FOUND_KEY);
		if (!raw) return null;
		const f = JSON.parse(raw) as AppUpdate;
		if (!f || typeof f.url !== "string" || typeof f.version !== "string")
			return null;
		return f;
	} catch {
		return null;
	}
}

function clearFound(): void {
	try {
		localStorage.removeItem(FOUND_KEY);
	} catch {
		/* ignore */
	}
}

/**
 * Companion device notification for a detected app update. The in-app
 * "Update detected" dialog always shows; this ping additionally reaches
 * the student's PC/phone tray when the app isn't in front of them.
 * Preference-gated (browser channel) and permission-guarded — returns true
 * only when actually shown, never throws.
 */
export function maybeNotifyAppUpdate(update: AppUpdate | null): boolean {
	if (!update) return false;
	try {
		if (!document.hidden) return false;
		const mirror = JSON.parse(
			localStorage.getItem("vb:browser-notify") || "{}",
		) as { enabled?: boolean };
		if (mirror.enabled === false) return false;
		return showBrowserNotification({
			title: `Update detected — Voice Flow ${update.version}`,
			body: update.notes || "A new version is ready. Open the app to install it.",
			tag: "voice-flow-update",
			url: "/download",
		});
	} catch {
		return false;
	}
}
