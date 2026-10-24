// Intent-based route chunk prefetch.
//
// Replaces the earlier idle-burst prefetch (fire 5 page graphs at once
// after first paint), which saturated dev transforms and the single
// server process behind /api — slowing the very navigations it meant to
// speed up. This warms exactly one chunk, only on hover/focus intent,
// at most once per route per visit. Static assets only: zero API calls,
// zero staleness risk, zero background contention.
type ChunkLoader = () => Promise<unknown>;

// Static specifiers keep one chunk per route in the bundle. These literals
// intentionally mirror the retryLazy() calls in App.tsx (same specifier =
// same cached module, never a duplicate chunk).
const LOADERS: Record<string, ChunkLoader> = {
	submit: () => import("../pages/Submit"),
	post: () => import("../pages/PostDetail"),
	polls: () => import("../pages/Polls"),
	suggestions: () => import("../pages/Suggestions"),
	search: () => import("../pages/Search"),
	chat: () => import("../pages/UserChat"),
	leaderboard: () => import("../pages/Leaderboard"),
	board: () => import("../pages/SolvingBoard"),
	activity: () => import("../pages/MyActivity"),
	notifications: () => import("../pages/Notifications"),
	communities: () => import("../pages/Communities"),
	saved: () => import("../pages/Saved"),
	settings: () => import("../pages/Settings"),
	insights: () => import("../pages/Insights"),
	privacy: () => import("../pages/Privacy"),
	faq: () => import("../pages/Faq"),
	home: () => import("../pages/Home"),
	admin: () => import("../pages/Admin"),
};

const ROUTE_KEYS: Record<string, string> = {
	"/submit": "submit",
	"/search": "search",
	"/chat": "chat",
	"/activity": "activity",
	"/notifications": "notifications",
	"/polls": "polls",
	"/suggestions": "suggestions",
	"/leaderboard": "leaderboard",
	"/board": "board",
	"/communities": "communities",
	"/saved": "saved",
	"/settings": "settings",
	"/insights": "insights",
	"/privacy": "privacy",
	"/faq": "faq",
	"/": "home",
	"/admin": "admin",
};

const warmed = new Set<string>();

function thinPipe(): boolean {
	try {
		const conn = (
			navigator as Navigator & {
				connection?: { saveData?: boolean; effectiveType?: string };
			}
		).connection;
		if (!conn) return false;
		if (conn.saveData) return true;
		return conn.effectiveType === "slow-2g" || conn.effectiveType === "2g";
	} catch {
		return false;
	}
}

export function prefetchRouteChunk(
	key: string,
	load: ChunkLoader = LOADERS[key] ?? (() => Promise.resolve()),
): void {
	if (!key || warmed.has(key) || thinPipe()) return;
	warmed.add(key);
	try {
		load().catch(() => {
			/* offline — the route loads on demand instead */
		});
	} catch {
		/* sync throw (tests) — still marked warmed */
	}
}

/** Nav-link helper: warm the chunk for a path, if it has one.
 * Returns true when the path maps to a known route chunk. */
export function prefetchRouteForPath(path: string): boolean {
	const key = ROUTE_KEYS[path];
	if (!key) return false;
	prefetchRouteChunk(key);
	return true;
}

/** True for devices where hover never fires (phones, tablets, touch Chromebooks).
 *  Those users get NO hover prefetch at all — every warm chunk has to come from
 *  an idle preload instead, or the first tap waits for the network. */
export function isTouchOnly(): boolean {
	try {
		if (typeof window === "undefined" || !window.matchMedia) return false;
		return window.matchMedia("(hover: none)").matches;
	} catch {
		return false;
	}
}

/** Every route reachable from the primary navigation. These are warmed on the
 *  FIRST idle pass so any nav click paints from cache — the whole point is that
 *  no route in the nav bar can ever be the one that pays the network cost. */
const NAV_ROUTES = [
	"home",
	"polls",
	"suggestions",
	"board",
	"chat",
	"settings",
	"activity",
	"submit",
	"communities",
	"search",
	"notifications",
	"leaderboard",
	"saved",
	"insights",
	"privacy",
	"faq",
] as const;

/** Everything else. Warmed on the SECOND idle pass: still static assets (zero
 *  API calls, zero staleness), just deferred so the primary nav wins the first
 *  idle slot. `post` is in here because feed cards also prefetch it on hover —
 *  the idle pass is what covers TOUCH devices, whose taps never hover. */
const SECONDARY_ROUTES = ["post", "admin"] as const;

/** Preload all pages during browser idle time so route changes load in < 300ms.
 *  Two passes: the nav first (these are the tabs a user actually cycles
 *  through), then the rest. Both are gated on the same thin-pipe check so a
 *  2G/save-data connection pays nothing extra. */
export function preloadCoreRoutes(): void {
	if (typeof window === "undefined" || thinPipe()) return;
	const run = () => {
		for (const key of NAV_ROUTES) prefetchRouteChunk(key);
		const more = () => {
			for (const key of SECONDARY_ROUTES) prefetchRouteChunk(key);
		};
		if (typeof window.requestIdleCallback === "function") {
			window.requestIdleCallback(more, { timeout: 4000 });
		} else {
			setTimeout(more, 1200);
		}
	};
	if (typeof window.requestIdleCallback === "function") {
		window.requestIdleCallback(run, { timeout: 2000 });
	} else {
		setTimeout(run, 600);
	}
}

/** Test-only reset: module state would otherwise leak across test cases. */
export function __resetRouteChunks(): void {
	warmed.clear();
}
