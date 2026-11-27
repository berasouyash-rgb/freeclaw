// Backend router: routing, failover gating, lease exclusivity, recovery.
// Exercises production logic through the real MemoryAdapter (not a mock):
// it implements the same contract, including versioned writes and
// simulated outages.

import { describe, expect, it } from "vitest";

import { MemoryAdapter } from "../../api/_backend/adapters/memory-adapter.js";
import { MemoryControlPlane } from "../../api/_backend/control-plane.js";
import { AdapterUnavailableError, StaleWriteError } from "../../api/_backend/errors.js";
import { BackendRouter, isFailoverEligible } from "../../api/_backend/router.js";

function build(overrides = {}) {
	const primary = new MemoryAdapter({ name: "supabase" });
	const secondary = new MemoryAdapter({ name: "firebase" });
	const controlPlane = new MemoryControlPlane();
	primary.seed("posts", [{ id: "p1", title: "primary", version: 1 }]);
	secondary.seed("posts", [{ id: "p2", title: "standby", version: 1 }]);
	const router = new BackendRouter({
		primary,
		secondary,
		controlPlane,
		owner: "router-a",
		...overrides,
	});
	return { primary, secondary, controlPlane, router };
}

describe("BackendRouter reads", () => {
	it("serves reads from the primary while it is active", async () => {
		const { router } = build();
		const res = await router.read("posts");
		expect(res.backend).toBe("supabase");
		expect(res.failed_over).toBe(false);
		expect(res.data.map((r) => r.id)).toEqual(["p1"]);
	});

	it("falls back to the standby on an infrastructure failure", async () => {
		const { primary, router } = build();
		primary.down = true;
		const res = await router.read("posts");
		expect(res.backend).toBe("firebase");
		expect(res.failed_over).toBe(true);
		expect(res.data.map((r) => r.id)).toEqual(["p2"]);
	});

	it("does not fail over on an application error", async () => {
		const { router } = build();
		// Out-of-scope table throws a plain Error, not a BackendError.
		await expect(router.read("not_a_table")).rejects.toThrow(/outside the VoiceFlow scope/);
		const state = await router.routeState();
		expect(state.active).toBe("primary");
	});
});

describe("BackendRouter writes", () => {
	it("writes to the primary when healthy", async () => {
		const { router, secondary } = build();
		const res = await router.write("posts", "insert", [
			{ id: "p3", title: "new", version: 1 },
		]);
		expect(res.backend).toBe("supabase");
		expect(res.pending_sync).toBe(false);
		expect(secondary.count("posts")).toBe(1);
	});

	it("fails closed instead of writing to the standby without a recorder", async () => {
		const { primary, secondary, router } = build();
		primary.down = true;
		await expect(
			router.write("posts", "insert", [{ id: "p4", title: "x", version: 1 }]),
		).rejects.toBeInstanceOf(AdapterUnavailableError);
		expect(secondary.count("posts")).toBe(1); // unchanged
		expect((await router.routeState()).active).toBe("primary");
	});

	it("fails over only with a lease and records the pending write", async () => {
		const { primary, secondary, router } = build();
		primary.down = true;
		const events = [];
		const res = await router.write(
			"posts",
			"insert",
			[{ id: "p5", title: "fallback", version: 1 }],
			{ onFallbackWrite: async (e) => events.push(e) },
		);
		expect(res.backend).toBe("firebase");
		expect(res.pending_sync).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ table: "posts", op: "insert", backend: "firebase" });
		expect(secondary.count("posts")).toBe(2);
		expect((await router.routeState()).active).toBe("secondary");
	});

	it("never fails over a stale version conflict", async () => {
		const { secondary, router } = build();
		const events = [];
		await expect(
			router.write(
				"posts",
				"update",
				["p1", { title: "stale" }, { expectedVersion: 9 }],
				{ onFallbackWrite: async (e) => events.push(e) },
			),
		).rejects.toBeInstanceOf(StaleWriteError);
		expect(events).toHaveLength(0);
		expect(secondary.count("posts")).toBe(1);
		expect((await router.routeState()).active).toBe("primary");
		expect(isFailoverEligible(new StaleWriteError("posts", "p1", 9, 1))).toBe(false);
	});
});

describe("BackendRouter failover control", () => {
	it("grants the failover lease to exactly one router", async () => {
		const { controlPlane, primary, secondary } = build();
		const a = new BackendRouter({
			primary,
			secondary,
			controlPlane,
			owner: "router-a",
		});
		const b = new BackendRouter({
			primary,
			secondary,
			controlPlane,
			owner: "router-b",
		});
		expect(await a.acquireFailover()).toBe(true);
		expect(await b.acquireFailover()).toBe(false);
		expect((await a.routeState()).active).toBe("secondary");
	});

	it("restores the primary only after recovery", async () => {
		const { primary, router } = build();
		primary.down = true;
		await router.write("posts", "insert", [{ id: "p6", version: 1 }], {
			onFallbackWrite: async () => {},
		});
		expect((await router.routeState()).active).toBe("secondary");
		primary.down = false;
		expect(await router.restorePrimary()).toBe(true);
		const res = await router.read("posts");
		expect(res.backend).toBe("supabase");
	});

	it("reports durable=false for the in-memory control plane", async () => {
		const { router } = build();
		const status = await router.status();
		expect(status.active).toBe("primary");
		expect(status.control_plane.durable).toBe(false);
		expect(status.health.backends.supabase.status).toBe("unknown");
	});
});
