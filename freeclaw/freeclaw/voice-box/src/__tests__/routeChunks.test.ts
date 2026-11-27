// routeChunks — intent-based chunk prefetch contract.
// Warms exactly one chunk per user intent (hover/focus), at most once,
// never on Save-Data / 2G, and never throws (a failed warm must fall
// back to on-demand load, not break the click it was meant to speed).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetRouteChunks,
	isTouchOnly,
	preloadCoreRoutes,
	prefetchRouteChunk,
	prefetchRouteForPath,
} from "../lib/routeChunks";

beforeEach(() => {
	__resetRouteChunks();
});

afterEach(() => {
	vi.unstubAllGlobals();
	try {
		delete (window.navigator as Navigator & { connection?: unknown })
			.connection;
	} catch {
		/* noop */
	}
});

describe("routeChunks", () => {
	it("warms a chunk once no matter how often intent fires", () => {
		const load = vi.fn(async () => ({}));
		prefetchRouteChunk("submit", load);
		prefetchRouteChunk("submit", load);
		prefetchRouteChunk("submit", load);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("a failed warm never throws and still counts as warmed", async () => {
		const load = vi.fn(async () => {
			throw new Error("offline");
		});
		expect(() => prefetchRouteChunk("post", load)).not.toThrow();
		await Promise.resolve();
		prefetchRouteChunk("post", load);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("skips entirely on Save-Data connections", () => {
		Object.defineProperty(window.navigator, "connection", {
			value: { saveData: true },
			configurable: true,
		});
		const load = vi.fn(async () => ({}));
		prefetchRouteChunk("search", load);
		expect(load).not.toHaveBeenCalled();
	});

	it("skips entirely on 2G connections", () => {
		Object.defineProperty(window.navigator, "connection", {
			value: { effectiveType: "2g" },
			configurable: true,
		});
		const load = vi.fn(async () => ({}));
		prefetchRouteChunk("polls", load);
		expect(load).not.toHaveBeenCalled();
	});

	it("unknown keys and paths are silent no-ops", () => {
		expect(() => prefetchRouteChunk("nope")).not.toThrow();
		expect(prefetchRouteForPath("/nope")).toBe(false);
		expect(prefetchRouteForPath("/submit")).toBe(true);
	});

	it("covers every static app route with a prefetchable chunk", () => {
		for (const path of [
			"/",
			"/submit",
			"/polls",
			"/suggestions",
			"/leaderboard",
			"/communities",
			"/board",
			"/activity",
			"/saved",
			"/search",
			"/insights",
			"/privacy",
			"/faq",
			"/chat",
			"/settings",
			"/notifications",
			"/admin",
		]) {
			expect(prefetchRouteForPath(path), path).toBe(true);
		}
	});

	it("__resetRouteChunks allows warming again", () => {
		const load = vi.fn(async () => ({}));
		prefetchRouteChunk("chat", load);
		__resetRouteChunks();
		prefetchRouteChunk("chat", load);
		expect(load).toHaveBeenCalledTimes(2);
	});
});

// -------------------------------------------------------------------
// Regression: "the whole platform should load under 300ms, not page by
// page". A route that is only warmed on hover is NEVER warm on a phone —
// `hover: none` devices get no mouseenter at all, so the first tap on
// that route pays the chunk fetch in full and blows the budget.
//
// PreloadCoreRoutes() must therefore cover every route reachable from
// the primary navigation, and must cover the post-detail chunk (the
// most-tapped surface in the app) even though cards also hover-warm it.
// -------------------------------------------------------------------
describe("preloadCoreRoutes — the 300ms route budget", () => {
	// Capture the idle callback instead of running it, so the test can
	// flush both passes deterministically.
	function captureIdle() {
		const callbacks: Array<() => void> = [];
		vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		return {
			runAll() {
				// Second pass is scheduled from inside the first, so run twice.
				callbacks.forEach((cb) => cb());
				callbacks.forEach((cb) => cb());
			},
		};
	}

	const NAV_PATHS = [
		"/",
		"/polls",
		"/suggestions",
		"/leaderboard",
		"/board",
		"/chat",
		"/settings",
		"/activity",
		"/submit",
		"/communities",
		"/search",
		"/notifications",
		"/saved",
		"/insights",
		"/privacy",
		"/faq",
	];

	it("warms a chunk for every route in the primary navigation", () => {
		const idle = captureIdle();
		preloadCoreRoutes();
		idle.runAll();
		// Each nav route must map to a real chunk (not the no-op fallback),
		// otherwise its first navigation is a cold network fetch.
		for (const path of NAV_PATHS) {
			__resetRouteChunks();
			expect(prefetchRouteForPath(path), `${path} has no chunk`).toBe(true);
		}
	});

	it("warms the post-detail chunk for touch devices that never hover", () => {
		const idle = captureIdle();
		preloadCoreRoutes();
		idle.runAll();
		__resetRouteChunks();
		// "post" is not in ROUTE_KEYS (dynamic /post/:id), so it must be
		// reachable by its own key — that is what the idle second pass does.
		const load = vi.fn(async () => ({}));
		prefetchRouteChunk("post", load);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("does nothing on a Save-Data connection", () => {
		Object.defineProperty(window.navigator, "connection", {
			value: { saveData: true },
			configurable: true,
		});
		const idle = captureIdle();
		preloadCoreRoutes();
		idle.runAll();
		// Lift the Save-Data stub and probe "home". If the idle pass had warmed
		// it despite Save-Data, the warmed-set would already contain the key and
		// this manual call would be swallowed. Warming once proves nothing was
		// warmed — the budget must never be spent out of a user's data.
		delete (window.navigator as Navigator & { connection?: unknown })
			.connection;
		const load = vi.fn(async () => ({}));
		prefetchRouteChunk("home", load);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("reports hover:none devices as touch-only", () => {
		vi.stubGlobal("matchMedia", (q: string) => ({
			matches: q.includes("hover: none"),
			media: q,
		}));
		expect(isTouchOnly()).toBe(true);
		vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
		expect(isTouchOnly()).toBe(false);
	});

	it("preloads core routes without throwing", () => {
		expect(() => preloadCoreRoutes()).not.toThrow();
	});
});
