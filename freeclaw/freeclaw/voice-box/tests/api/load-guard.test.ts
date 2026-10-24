// ═══════════════════════════════════════════════════════════════════
// Load-management harness — per-instance shed cap + dispatcher wiring.
// Locks: acquire up to MAX, the overflow sheds exactly once per call,
// release floors at zero, stats report live counters, and api/index.js
// fails fast with 503 + Retry-After + OVERLOADED instead of queueing.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	__resetLoadGuard,
	getLoadStats,
	loadGuardAcquire,
	loadGuardRelease,
} from "../../api/_load-guard.js";

beforeEach(() => {
	__resetLoadGuard();
});

describe("load guard counters", () => {
	it("admits up to the cap and sheds the overflow", () => {
		const { max_inflight } = getLoadStats();
		for (let i = 0; i < max_inflight; i++) {
			expect(loadGuardAcquire()).toBe(true);
		}
		expect(loadGuardAcquire()).toBe(false);
		expect(loadGuardAcquire()).toBe(false);
		expect(getLoadStats()).toMatchObject({
			inflight: max_inflight,
			shed_total: 2,
		});
	});

	it("a release frees exactly one slot", () => {
		const { max_inflight } = getLoadStats();
		for (let i = 0; i < max_inflight; i++) loadGuardAcquire();
		expect(loadGuardAcquire()).toBe(false);
		loadGuardRelease();
		expect(loadGuardAcquire()).toBe(true);
		expect(loadGuardAcquire()).toBe(false);
	});

	it("release never drives the counter below zero", () => {
		loadGuardRelease();
		loadGuardRelease();
		expect(getLoadStats().inflight).toBe(0);
		expect(loadGuardAcquire()).toBe(true);
	});
});

describe("dispatcher wiring (static contract)", () => {
	const source = readFileSync(resolve(process.cwd(), "api/index.js"), "utf8");

	it("fails fast with 503 + Retry-After + OVERLOADED when saturated", () => {
		expect(source).toContain("loadGuardAcquire()");
		expect(source).toContain("loadGuardRelease()");
		expect(source).toContain('code: "OVERLOADED"');
		expect(source).toContain('Retry-After", "2"');
		expect(source).toContain("503");
	});

	it("releases in a finally so throws never leak a slot", () => {
		const i = source.indexOf("loadGuardAcquire()");
		const fin = source.indexOf("finally", i);
		expect(fin).toBeGreaterThan(i);
		expect(source.slice(fin, fin + 60)).toContain("loadGuardRelease()");
	});

	it("lets the _ping health check bypass the cap", () => {
		expect(source.indexOf("_ping")).toBeLessThan(
			source.indexOf("loadGuardAcquire()"),
		);
	});
});
