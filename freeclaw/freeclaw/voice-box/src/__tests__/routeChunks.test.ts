// routeChunks — intent-based chunk prefetch contract.
// Warms exactly one chunk per user intent (hover/focus), at most once,
// never on Save-Data / 2G, and never throws (a failed warm must fall
// back to on-demand load, not break the click it was meant to speed).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetRouteChunks,
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
