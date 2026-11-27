import { beforeEach, describe, expect, it } from "vitest";
import { getAnonId } from "../lib/identity";

beforeEach(() => {
	localStorage.clear();
});

describe("permanent anonymous identity", () => {
	it("mints once and returns the exact same ID on every call", () => {
		const first = getAnonId();
		expect(first).toMatch(/^anon_/);
		expect(getAnonId()).toBe(first);
		expect(getAnonId()).toBe(first);
	});

	it("persists under a version-independent key (upgrades never rotate it)", () => {
		const first = getAnonId();
		expect(localStorage.getItem("vb:anonId")).toBe(first);
		// Simulate an app update: module state is untouched, storage is the
		// source of truth — the ID must survive with zero migration.
		expect(getAnonId()).toBe(first);
	});
});
