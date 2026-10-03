// ═══════════════════════════════════════════════════════════════════
// Identity — blocked-storage fallback tests
// ═══════════════════════════════════════════════════════════════════
// Regression tests for the "whole website full of errors" bug: on devices
// where localStorage throws (Safari Private Browsing, in-app browsers,
// school MDM policies, storage partitioning) the old identity module
// crashed at mount ("Couldn't start Voice Flow"). These tests prove the
// rewritten module NEVER throws and keeps identity consistent via the
// cookie + in-memory fallback layers.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Remove every cookie in the jsdom document (per-test isolation). */
function clearCookies() {
	document.cookie.split("; ").forEach((c) => {
		const eq = c.indexOf("=");
		const name = eq > -1 ? c.slice(0, eq) : c;
		document.cookie = `${name}=; path=/; max-age=0`;
	});
}

/** Simulate a locked-down browser where every localStorage access throws. */
// Note: jsdom's window.localStorage is an own DATA property whose prototype is
// NOT Storage.prototype — so spying on Storage.prototype never intercepts it.
// Redefining the property makes ANY access (getItem, setItem, length, ...)
// throw, exactly like Safari Private Browsing / partitioned storage.
const originalLsDescriptor = Object.getOwnPropertyDescriptor(
	window,
	"localStorage",
)!;

function blockStorage() {
	const boom = () => {
		throw new Error("SecurityError: The operation is insecure");
	};
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		get() {
			throw boom();
		},
	});
}

function unblockStorage() {
	Object.defineProperty(window, "localStorage", originalLsDescriptor);
}

/** Fresh module instance — resets the in-memory Map and the storage probe cache. */
async function freshModule() {
	vi.resetModules();
	return await import("../lib/identity");
}

beforeEach(() => {
	clearCookies();
	unblockStorage();
});

describe("Identity - blocked localStorage (crash regression)", () => {
	it("getAnonId returns a valid ID without throwing when storage is fully blocked", async () => {
		blockStorage();
		const { getAnonId } = await freshModule();
		let id: string | undefined;
		expect(() => {
			id = getAnonId();
		}).not.toThrow();
		expect(id).toMatch(/^anon_[a-z0-9]+$/);
	});

	it("writes the fallback cookie when storage is blocked", async () => {
		blockStorage();
		const { getAnonId } = await freshModule();
		getAnonId();
		expect(document.cookie).toContain("vb_anonId");
	});

	it("keeps the SAME identity across a reload (fresh module + memory cleared) via cookie", async () => {
		blockStorage();
		const mod1 = await freshModule();
		const id1 = mod1.getAnonId();
		// Simulate reload: new module instance, empty in-memory Map, storage still blocked
		const mod2 = await freshModule();
		expect(mod2.getAnonId()).toBe(id1);
	});

	it("keeps the identity when storage becomes available again after being blocked", async () => {
		blockStorage();
		const mod1 = await freshModule();
		const id1 = mod1.getAnonId();
		unblockStorage();
		const mod2 = await freshModule();
		expect(mod2.getAnonId()).toBe(id1);
	});

	it("resetAnonId works and produces a new ID when storage is blocked", async () => {
		blockStorage();
		const mod = await freshModule();
		const original = mod.getAnonId();
		const next = mod.resetAnonId();
		expect(next).not.toBe(original);
		expect(next).toMatch(/^anon_/);
	});

	it("clearAllLocalData sweeps fallback cookies when storage is blocked", async () => {
		blockStorage();
		const mod = await freshModule();
		mod.getAnonId();
		expect(document.cookie).toContain("vb_anonId");
		mod.clearAllLocalData();
		expect(document.cookie).not.toContain("vb_anonId");
	});
});

describe("Identity - helpers with blocked storage", () => {
	it("lsSet/lsGet round-trip values in memory when storage is blocked", async () => {
		blockStorage();
		const mod = await freshModule();
		expect(() => mod.lsSet("vb:test", { a: 1 })).not.toThrow();
		expect(mod.lsGet("vb:test", null)).toEqual({ a: 1 });
	});

	it("lsGet returns the fallback for a missing key when storage is blocked", async () => {
		blockStorage();
		const mod = await freshModule();
		expect(mod.lsGet("missing", "fallback")).toBe("fallback");
	});

	it("cooldowns still work when storage is blocked (cookie + memory fallback)", async () => {
		blockStorage();
		const mod = await freshModule();
		expect(mod.checkCooldown("vote", 60)).toBe(0);
		mod.stampCooldown("vote");
		const remaining = mod.checkCooldown("vote", 60);
		expect(remaining).toBeGreaterThan(0);
		expect(remaining).toBeLessThanOrEqual(60);
	});

	it("anonCreatedAt returns a valid timestamp when storage is blocked", async () => {
		blockStorage();
		const mod = await freshModule();
		mod.getAnonId();
		const createdAt = mod.anonCreatedAt();
		expect(() => new Date(createdAt)).not.toThrow();
	});
});
