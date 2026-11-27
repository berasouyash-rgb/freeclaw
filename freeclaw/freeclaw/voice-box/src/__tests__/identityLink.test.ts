// Identity stability across updates, reinstalls, and devices.
// Locks:
//   1. Link codes round-trip: create → parse returns the same id.
//   2. A single typo is rejected (checksum), never adopted.
//   3. adoptIdentity swaps the stored id; invalid codes change nothing.
//   4. Slow-bridge retry: a session that minted a temporary id while
//      hydration had given up converges back to the durable device id
//      when the retry succeeds (no flap, no overwrite of device data).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	adoptIdentity,
	createLinkCode,
	getAnonId,
	parseLinkCode,
} from "../lib/identity";
import {
	__resetStoreForTests,
	__setStoreBackendForTests,
	hydrateStore,
	storeGet,
	type NativeStore,
} from "../lib/storage";

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	__resetStoreForTests();
	vi.useRealTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	__resetStoreForTests();
	localStorage.clear();
});

describe("identity link codes", () => {
	it("round-trips create → parse to the same id", () => {
		const id = getAnonId();
		const code = createLinkCode(id);
		expect(code).toMatch(/^VF-/);
		expect(parseLinkCode(code!)).toBe(id);
	});

	it("accepts lowercase and spaces", () => {
		const id = getAnonId();
		const code = createLinkCode(id)!;
		expect(parseLinkCode(code.toLowerCase().replace(/-/g, " "))).toBe(id);
	});

	it("refuses non-id formats (legacy hyphen ids cannot link)", () => {
		expect(createLinkCode("anon-test")).toBeNull();
		expect(parseLinkCode("VF-TEST-ZZ")).toBeNull();
	});

	it("rejects typos, garbage, and wrong prefixes", () => {
		const id = getAnonId();
		const code = createLinkCode(id)!;
		const typo =
			code.slice(0, 5) + (code[5] === "A" ? "B" : "A") + code.slice(6);
		expect(parseLinkCode(typo)).toBeNull();
		expect(parseLinkCode("hello world")).toBeNull();
		expect(parseLinkCode("XX-ABCD-12")).toBeNull();
		expect(parseLinkCode("")).toBeNull();
	});

	it("adoptIdentity swaps the stored id; invalid codes change nothing", () => {
		const before = getAnonId();
		expect(adoptIdentity("not a code")).toBeNull();
		expect(getAnonId()).toBe(before);

		const other = "anon_abcdefghij1234";
		const code = createLinkCode(other)!;
		expect(adoptIdentity(code)).toBe(other);
		expect(getAnonId()).toBe(other);
		expect(localStorage.getItem("vb:anonId")).toBe(other);
	});
});

describe("slow-bridge hydration retry", () => {
	it("converges a temporary session id back to the durable device id", async () => {
		vi.useFakeTimers();
		const DEVICE_ID = "anon_deviceid0001";
		let keysCalls = 0;
		const data = new Map<string, string>([["vb:anonId", DEVICE_ID]]);
		const flaky: NativeStore = {
			get: async (k) => data.get(k) ?? null,
			set: async (k, v) => {
				data.set(k, v);
			},
			remove: async (k) => {
				data.delete(k);
			},
			keys: async () => {
				keysCalls++;
				if (keysCalls === 1) throw new Error("cold boot too slow");
				return Array.from(data.keys());
			},
		};
		__setStoreBackendForTests("device", flaky);

		// First hydration fails → session mints a temporary id.
		await hydrateStore();
		const tempId = getAnonId();
		expect(tempId).not.toBe(DEVICE_ID);
		expect(tempId).toMatch(/^anon_/);

		// Retry fires → durable id wins everywhere (mirror authoritative).
		await vi.advanceTimersByTimeAsync(20_000);
		expect(storeGet("vb:anonId")).toBe(DEVICE_ID);
		expect(getAnonId()).toBe(DEVICE_ID);
		// The device record itself was never clobbered by the temp id.
		expect(data.get("vb:anonId")).toBe(DEVICE_ID);
	});
});
