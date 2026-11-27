// Direct coverage for the reliability primitives that had none:
// health, idempotency, conflict, dlq, tables.
//
// These are the modules the router and replication worker stand on. They were
// exercised only indirectly (through BackendRouter / replication tests), which
// means a regression in the hysteresis thresholds, the CAS takeover path, the
// per-entity conflict rules, or the table allowlist could pass unnoticed while
// every indirect test stayed green.
//
// Everything runs against the real MemoryControlPlane — the same CAS contract
// the Redis backend implements — not a mock of it.

import { describe, expect, it } from "vitest";

import { ConflictError, ConflictResolver } from "../../api/_backend/conflict.js";
import { MemoryControlPlane } from "../../api/_backend/control-plane.js";
import { DeadLetterQueue } from "../../api/_backend/dlq.js";
import { StaleWriteError } from "../../api/_backend/errors.js";
import { HealthMonitor } from "../../api/_backend/health.js";
import {
	IdempotencyStore,
	deriveIdempotencyKey,
	runIdempotent,
	stableId,
} from "../../api/_backend/idempotency.js";
import {
	ANON_READABLE_TABLES,
	STORAGE_BUCKETS,
	TABLE_META,
	VOICEFLOW_TABLES,
	fullScanTables,
	inScope,
	tableMeta,
	watermarkTables,
} from "../../api/_backend/tables.js";

// ─── Health monitor ─────────────────────────────────────────────

type Probe = () => Promise<{ ok: boolean; latencyMs?: number }>;

function healthHarness(
	probes: Record<string, Probe>,
	opts: Record<string, unknown> = {},
) {
	let clock = 1_000_000;
	const monitor = new HealthMonitor({
		now: () => clock,
		intervalMs: 0,
		...opts,
	});
	for (const [name, probe] of Object.entries(probes)) monitor.register(name, probe);
	return {
		monitor,
		advance(ms: number) {
			clock += ms;
		},
		at() {
			return clock;
		},
	};
}

describe("HealthMonitor hysteresis", () => {
	it("needs failureThreshold consecutive failures before declaring down", async () => {
		const { monitor } = healthHarness({ supabase: async () => ({ ok: false }) }, {
			failureThreshold: 3,
		});

		await monitor.evaluate({ force: true });
		expect(monitor.statusOf("supabase")).toBe("degraded");
		expect(monitor.isDown("supabase")).toBe(false);

		await monitor.evaluate({ force: true });
		expect(monitor.statusOf("supabase")).toBe("degraded");

		await monitor.evaluate({ force: true });
		expect(monitor.statusOf("supabase")).toBe("down");
		expect(monitor.isDown("supabase")).toBe(true);
	});

	it("needs recoveryThreshold consecutive successes to come back from down", async () => {
		let healthy = false;
		const { monitor } = healthHarness(
			{ supabase: async () => ({ ok: healthy }) },
			{ failureThreshold: 1, recoveryThreshold: 3 },
		);

		await monitor.evaluate({ force: true });
		expect(monitor.isDown("supabase")).toBe(true);

		healthy = true;
		// A single success must NOT declare recovery — that is the flapping
		// protection the threshold exists for.
		await monitor.evaluate({ force: true });
		expect(monitor.isDown("supabase")).toBe(true);

		await monitor.evaluate({ force: true });
		expect(monitor.isDown("supabase")).toBe(true);

		await monitor.evaluate({ force: true });
		expect(monitor.isHealthy("supabase")).toBe(true);
		expect(monitor.isDown("supabase")).toBe(false);
	});

	it("recovers immediately from degraded (never failed the threshold)", async () => {
		let healthy = false;
		const { monitor } = healthHarness({ supabase: async () => ({ ok: healthy }) }, {
			failureThreshold: 3,
		});

		await monitor.evaluate({ force: true });
		expect(monitor.statusOf("supabase")).toBe("degraded");

		healthy = true;
		await monitor.evaluate({ force: true });
		expect(monitor.isHealthy("supabase")).toBe(true);
	});

	it("resets the failure streak on any success", async () => {
		const outcomes = [false, false, true, false, false];
		let i = 0;
		const { monitor } = healthHarness(
			{ supabase: async () => ({ ok: outcomes[i++] ?? false }) },
			{ failureThreshold: 3 },
		);

		for (let n = 0; n < 5; n++) await monitor.evaluate({ force: true });
		// false,false -> degraded; true -> healthy; false,false -> degraded again
		expect(monitor.statusOf("supabase")).toBe("degraded");
		expect(monitor.snapshot().backends.supabase.consecutive_failures).toBe(2);
	});
});

describe("HealthMonitor probing", () => {
	it("treats a throwing probe as a failure with the message recorded", async () => {
		const { monitor } = healthHarness({
			firebase: async () => {
				throw new Error("connect ECONNREFUSED");
			},
		});

		await monitor.evaluate({ force: true });
		const state = monitor.snapshot().backends.firebase;
		expect(state.status).toBe("degraded");
		expect(state.last_error).toContain("ECONNREFUSED");
	});

	it("enforces the probe deadline instead of hanging the request", async () => {
		const { monitor } = healthHarness(
			{ slow: () => new Promise<{ ok: boolean }>(() => {}) },
			{ probeTimeoutMs: 10 },
		);

		await monitor.evaluate({ force: true });
		expect(monitor.statusOf("slow")).toBe("degraded");
		expect(monitor.snapshot().backends.slow.last_error).toMatch(/timed out after 10ms/);
	});

	it("self-throttles: a call inside the interval returns the cached snapshot", async () => {
		let calls = 0;
		const { monitor, advance } = healthHarness(
			{
				supabase: async () => {
					calls += 1;
					return { ok: true };
				},
			},
			{ intervalMs: 5_000 },
		);

		await monitor.evaluate();
		expect(calls).toBe(1);

		advance(4_000);
		await monitor.evaluate();
		expect(calls).toBe(1);

		advance(2_000);
		await monitor.evaluate();
		expect(calls).toBe(2);
	});

	it("force bypasses the throttle", async () => {
		let calls = 0;
		const { monitor } = healthHarness(
			{
				supabase: async () => {
					calls += 1;
					return { ok: true };
				},
			},
			{ intervalMs: 60_000 },
		);

		await monitor.evaluate();
		await monitor.evaluate({ force: true });
		expect(calls).toBe(2);
	});

	it("snapshot is a pure read and reports ISO timestamps", async () => {
		const { monitor, at } = healthHarness({ supabase: async () => ({ ok: true, latencyMs: 42 }) });
		expect(monitor.snapshot().evaluated_at).toBeNull();

		await monitor.evaluate({ force: true });
		const snap = monitor.snapshot();
		expect(snap.evaluated_at).toBe(new Date(at()).toISOString());
		expect(snap.backends.supabase.last_check_at).toBe(new Date(at()).toISOString());
		expect(snap.backends.supabase.last_latency_ms).toBe(42);
		expect(snap.backends.supabase.consecutive_successes).toBe(1);
	});

	it("register rejects a non-function probe and unregister removes state", () => {
		const monitor = new HealthMonitor();
		// @ts-expect-error deliberately invalid
		expect(() => monitor.register("x", null)).toThrow(/must be a function/);

		monitor.register("x", async () => ({ ok: true }));
		expect(monitor.statusOf("x")).toBe("unknown");
		monitor.unregister("x");
		expect(monitor.statusOf("x")).toBe("unknown");
		expect(monitor.snapshot().backends.x).toBeUndefined();
	});

	it("reset clears counters and the evaluation clock", async () => {
		const { monitor } = healthHarness({ supabase: async () => ({ ok: false }) });
		await monitor.evaluate({ force: true });
		expect(monitor.statusOf("supabase")).toBe("degraded");

		monitor.reset();
		expect(monitor.statusOf("supabase")).toBe("unknown");
		expect(monitor.snapshot().evaluated_at).toBeNull();
		expect(monitor.snapshot().backends.supabase.consecutive_failures).toBe(0);
	});
});

// ─── Idempotency ────────────────────────────────────────────────

function idemHarness() {
	let clock = Date.now();
	const cp = new MemoryControlPlane();
	const store = new IdempotencyStore({ controlPlane: cp, now: () => clock });
	return {
		cp,
		store,
		advance(ms: number) {
			clock += ms;
		},
	};
}

describe("idempotency keys", () => {
	it("derives a deterministic 64-hex key from the operation's meaning", () => {
		const parts = { scope: "vf", actorId: "a1", entity: "posts", id: "p1", op: "insert" };
		const a = deriveIdempotencyKey(parts);
		const b = deriveIdempotencyKey(parts);
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});

	it("changes when the payload changes", () => {
		const base = { actorId: "a1", entity: "posts", op: "insert", payload: { title: "x" } };
		expect(deriveIdempotencyKey(base)).not.toBe(
			deriveIdempotencyKey({ ...base, payload: { title: "y" } }),
		);
	});

	it("namespaces a client-supplied key by actor", () => {
		const a = deriveIdempotencyKey({ clientKey: "submit-1", actorId: "alice" });
		const b = deriveIdempotencyKey({ clientKey: "submit-1", actorId: "bob" });
		expect(a).not.toBe(b);
		expect(deriveIdempotencyKey({ clientKey: "submit-1", actorId: "alice" })).toBe(a);
	});

	it("stableId is short, deterministic, and input-sensitive", () => {
		expect(stableId("posts", "p1")).toHaveLength(32);
		expect(stableId("posts", "p1")).toBe(stableId("posts", "p1"));
		expect(stableId("posts", "p1")).not.toBe(stableId("posts", "p2"));
	});
});

describe("IdempotencyStore", () => {
	it("grants the key to the first caller only", async () => {
		const { store } = idemHarness();
		const first = await store.begin("k1");
		expect(first.acquired).toBe(true);
		expect(first.state).toBe("in_flight");

		const second = await store.begin("k1");
		expect(second.acquired).toBe(false);
		expect(second.state).toBe("in_flight");
	});

	it("replays the stored result verbatim once complete", async () => {
		const { store } = idemHarness();
		await store.begin("k2");
		await store.complete("k2", { id: "p9" });

		const replay = await store.begin("k2");
		expect(replay.acquired).toBe(false);
		expect(replay.state).toBe("done");
		expect(replay.result).toEqual({ id: "p9" });
	});

	it("lets a retry re-acquire after fail()", async () => {
		const { store } = idemHarness();
		await store.begin("k3");
		await store.fail("k3", new Error("upstream 500"));
		expect((await store.get("k3")).state).toBe("failed");

		const retry = await store.begin("k3");
		expect(retry.acquired).toBe(true);
	});

	it("takes over an abandoned in-flight attempt after its TTL", async () => {
		const { store, advance } = idemHarness();
		await store.begin("k4");

		advance(30_000);
		expect((await store.begin("k4")).acquired).toBe(false);

		advance(31_000); // past the 60s in-flight TTL
		expect((await store.begin("k4")).acquired).toBe(true);
	});

	it("release() removes the record", async () => {
		const { store } = idemHarness();
		await store.begin("k5");
		await store.release("k5");
		expect(await store.get("k5")).toBeNull();
		expect((await store.begin("k5")).acquired).toBe(true);
	});
});

describe("runIdempotent", () => {
	it("runs the function once and replays the result", async () => {
		const { store } = idemHarness();
		let calls = 0;
		const fn = async () => {
			calls += 1;
			return { ok: true };
		};

		const first = await runIdempotent(store, "r1", fn);
		expect(first).toMatchObject({ replayed: false, inFlight: false, result: { ok: true } });

		const second = await runIdempotent(store, "r1", fn);
		expect(second).toMatchObject({ replayed: true, inFlight: false, result: { ok: true } });
		expect(calls).toBe(1);
	});

	it("reports in-flight instead of silently serialising a concurrent submit", async () => {
		const { store } = idemHarness();
		await store.begin("r2"); // someone else holds it
		let calls = 0;

		const res = await runIdempotent(store, "r2", async () => {
			calls += 1;
		});
		expect(res).toMatchObject({ replayed: false, inFlight: true });
		expect(calls).toBe(0);
	});

	it("marks the key failed when the work throws, so a retry can proceed", async () => {
		const { store } = idemHarness();
		const boom = async () => {
			throw new Error("insert failed");
		};

		await expect(runIdempotent(store, "r3", boom)).rejects.toThrow("insert failed");
		expect((await store.get("r3")).state).toBe("failed");

		const recovered = await runIdempotent(store, "r3", async () => ({ ok: true }));
		expect(recovered.replayed).toBe(false);
		expect(recovered.result).toEqual({ ok: true });
	});
});

// ─── Conflict resolution ────────────────────────────────────────

function conflictHarness() {
	const cp = new MemoryControlPlane();
	const resolver = new ConflictResolver({ controlPlane: cp, now: () => 1_700_000_000_000 });
	return { cp, resolver };
}

describe("ConflictResolver.prepareWrite", () => {
	it("rejects an update to an append-only table", async () => {
		const { resolver } = conflictHarness();
		await expect(
			resolver.prepareWrite({
				table: "notifications",
				id: "n1",
				current: { id: "n1" },
			}),
		).rejects.toBeInstanceOf(ConflictError);

		await expect(
			resolver.prepareWrite({ table: "notifications", id: "n1", current: { id: "n1" } }),
		).rejects.toMatchObject({ code: "APPEND_ONLY" });

		await expect(
			resolver.prepareWrite({
				table: "notifications",
				id: "n1",
				current: { id: "n1" },
				force: true,
			}),
		).resolves.toEqual({ action: "insert" });
	});

	it("turns a unique-key table into an upsert on its natural key", async () => {
		const { resolver } = conflictHarness();
		await expect(resolver.prepareWrite({ table: "poll_votes", id: "v1" })).resolves.toEqual({
			action: "upsert",
			onConflict: "poll_id,author_id",
		});

		await expect(resolver.prepareWrite({ table: "reactions", id: "r1" })).resolves.toEqual({
			action: "upsert",
			onConflict: "target_id,target_type,author_id,kind",
		});
	});

	it("kv tables CAS on the control-plane version", async () => {
		const { cp, resolver } = conflictHarness();

		const insert = await resolver.prepareWrite({ table: "settings", id: "theme" });
		expect(insert).toMatchObject({ action: "insert", currentVersion: 0 });
		expect(insert.versionKey).toBe("entity_version:settings:theme");

		await expect(
			resolver.prepareWrite({ table: "settings", id: "theme", expectedVersion: 1 }),
		).rejects.toBeInstanceOf(StaleWriteError);

		await cp.compareAndSet("entity_version:settings:theme", null, { v: 1 });
		const update = await resolver.prepareWrite({
			table: "settings",
			id: "theme",
			current: { key: "theme" },
			expectedVersion: 1,
		});
		expect(update).toMatchObject({ action: "update", currentVersion: 1 });
	});

	it("requires the native version column that was read (posts.updated_at)", async () => {
		const { resolver } = conflictHarness();
		const current = { id: "p1", updated_at: "2026-01-01T00:00:00.000Z" };

		await expect(resolver.prepareWrite({ table: "posts", id: "p1", current })).rejects.toMatchObject({
			code: "MISSING_VERSION",
		});

		await expect(
			resolver.prepareWrite({
				table: "posts",
				id: "p1",
				current,
				expectedVersion: "2026-01-01T00:00:01.000Z",
			}),
		).rejects.toBeInstanceOf(StaleWriteError);

		await expect(
			resolver.prepareWrite({
				table: "posts",
				id: "p1",
				current,
				expectedVersion: "2026-01-01T00:00:00.000Z",
			}),
		).resolves.toMatchObject({
			action: "update",
			expectedVersion: "2026-01-01T00:00:00.000Z",
		});
	});

	it("falls back to control-plane CAS for versioned tables with no version column (comments)", async () => {
		const { resolver } = conflictHarness();
		const current = { id: "c1" };

		await expect(resolver.prepareWrite({ table: "comments", id: "c1", current })).rejects.toMatchObject({
			code: "MISSING_VERSION",
		});

		const prepared = await resolver.prepareWrite({
			table: "comments",
			id: "c1",
			current,
			expectedVersion: 0,
		});
		expect(prepared).toMatchObject({ action: "update", currentVersion: 0 });
		expect(prepared.versionKey).toBe("entity_version:comments:c1");
	});

	it("never demands a version for a brand-new row", async () => {
		const { resolver } = conflictHarness();
		await expect(
			resolver.prepareWrite({ table: "posts", id: "new", current: null }),
		).resolves.toMatchObject({ action: "insert" });
	});
});

describe("ConflictResolver.commitWrite", () => {
	it("bumps the control-plane version and rejects a second stale commit", async () => {
		const { resolver } = conflictHarness();
		const prepared = await resolver.prepareWrite({
			table: "comments",
			id: "c1",
			current: { id: "c1" },
			expectedVersion: 0,
		});

		await expect(resolver.commitWrite("comments", "c1", prepared)).resolves.toBe(1);
		await expect(resolver.commitWrite("comments", "c1", prepared)).rejects.toBeInstanceOf(
			StaleWriteError,
		);
	});

	it("is a no-op for native-version tables (the column advances itself)", async () => {
		const { resolver } = conflictHarness();
		await expect(resolver.commitWrite("posts", "p1", {})).resolves.toBeNull();
		await expect(resolver.commitWrite("posts", "p1", null)).resolves.toBeNull();
	});

	it("readVersion returns null for native-version tables and the CAS version otherwise", async () => {
		const { cp, resolver } = conflictHarness();
		expect(await resolver.readVersion("posts", "p1")).toBeNull();
		expect(await resolver.readVersion("comments", "c1")).toBe(0);
		await cp.compareAndSet("entity_version:comments:c1", null, { v: 1 });
		expect(await resolver.readVersion("comments", "c1")).toBe(1);
	});
});

describe("ConflictResolver.resolveReplicationConflict", () => {
	it("returns the only side that exists", () => {
		const { resolver } = conflictHarness();
		expect(resolver.resolveReplicationConflict("posts", null, { id: "p1" })).toMatchObject({
			winner: { id: "p1" },
			reason: "no-local",
			conflict: false,
		});
		expect(resolver.resolveReplicationConflict("posts", { id: "p1" }, null)).toMatchObject({
			winner: { id: "p1" },
			reason: "no-remote",
			conflict: false,
		});
	});

	it("keeps the primary authoritative for append-only rows", () => {
		const { resolver } = conflictHarness();
		const res = resolver.resolveReplicationConflict(
			"notifications",
			{ id: "n1", body: "local" },
			{ id: "n1", body: "primary" },
		);
		expect(res.winner.body).toBe("primary");
		expect(res.reason).toBe("append-only-primary-authoritative");
		expect(res.conflict).toBe(true);
	});

	it("lets the earliest row win for unique-key tables (no double vote)", () => {
		const { resolver } = conflictHarness();
		const res = resolver.resolveReplicationConflict(
			"reactions",
			{ id: "r1", created_at: "2026-01-01T00:00:00Z" },
			{ id: "r1", created_at: "2026-02-01T00:00:00Z" },
		);
		expect(res.winner.created_at).toBe("2026-01-01T00:00:00Z");
		expect(res.reason).toBe("unique-key-earliest");
	});

	it("takes the newest updated_at for kv settings", () => {
		const { resolver } = conflictHarness();
		const res = resolver.resolveReplicationConflict(
			"settings",
			{ key: "theme", updated_at: "2026-01-01T00:00:00Z" },
			{ key: "theme", updated_at: "2026-03-01T00:00:00Z" },
		);
		expect(res.winner.updated_at).toBe("2026-03-01T00:00:00Z");
		expect(res.reason).toBe("kv-newest-updated_at");
	});

	it("compares the native version column for versioned tables", () => {
		const { resolver } = conflictHarness();
		const res = resolver.resolveReplicationConflict(
			"posts",
			{ id: "p1", updated_at: "2026-01-01T00:00:00Z" },
			{ id: "p1", updated_at: "2026-04-01T00:00:00Z" },
		);
		expect(res.winner.updated_at).toBe("2026-04-01T00:00:00Z");
		expect(res.reason).toBe("versioned-updated_at");
	});

	it("uses the recorded control-plane revision when no column exists", () => {
		const { resolver } = conflictHarness();
		const res = resolver.resolveReplicationConflict(
			"comments",
			{ id: "c1", __meta: { version: 2 } },
			{ id: "c1", __meta: { version: 5 } },
		);
		expect(res.winner.__meta.version).toBe(5);
		expect(res.reason).toBe("versioned-control-plane");
	});
});

// ─── Dead-letter queue ──────────────────────────────────────────

function dlqHarness(opts: Record<string, unknown> = {}) {
	const cp = new MemoryControlPlane();
	const dlq = new DeadLetterQueue({
		controlPlane: cp,
		now: () => 1_700_000_000_000,
		...opts,
	});
	return { cp, dlq };
}

describe("DeadLetterQueue", () => {
	it("stores a failure with enough context to replay it", async () => {
		const { dlq } = dlqHarness();
		const { id, indexed } = await dlq.push({
			table: "posts",
			op: "insert",
			error: Object.assign(new Error("upstream 503"), { code: "UPSTREAM" }),
			payload: { id: "p1" },
			source: "replication",
		});

		expect(indexed).toBe(true);
		const rec = await dlq.get(id);
		expect(rec).toMatchObject({
			table: "posts",
			op: "insert",
			source: "replication",
			attempts: 1,
			error: "upstream 503",
			code: "UPSTREAM",
			payload: { id: "p1" },
		});
		expect(rec.at).toBe(new Date(1_700_000_000_000).toISOString());
	});

	it("stringifies a non-Error failure and defaults attempts to 1", async () => {
		const { dlq } = dlqHarness();
		const { id } = await dlq.push({ error: "plain string failure" });
		const rec = await dlq.get(id);
		expect(rec.error).toBe("plain string failure");
		expect(rec.attempts).toBe(1);
		expect(rec.source).toBe("backend");
		expect(rec.table).toBeNull();
	});

	it("lists newest first and honours the limit", async () => {
		const { dlq } = dlqHarness();
		const a = await dlq.push({ error: "a" });
		const b = await dlq.push({ error: "b" });
		const c = await dlq.push({ error: "c" });

		const all = await dlq.list();
		expect(all.map((e) => e.id)).toEqual([c.id, b.id, a.id]);

		const limited = await dlq.list({ limit: 2 });
		expect(limited.map((e) => e.id)).toEqual([c.id, b.id]);
	});

	it("drops an entry from both the entry store and the index", async () => {
		const { dlq } = dlqHarness();
		const { id } = await dlq.push({ error: "x" });

		await expect(dlq.drop(id)).resolves.toEqual({ dropped: true, indexUpdated: true });
		expect(await dlq.get(id)).toBeNull();
		expect(await dlq.size()).toBe(0);
	});

	it("drop on an unknown id is a no-op, not an error", async () => {
		const { dlq } = dlqHarness();
		await expect(dlq.drop("never-existed")).resolves.toEqual({
			dropped: true,
			indexUpdated: true,
		});
	});

	it("caps the index so a storm cannot grow it without bound", async () => {
		const { dlq } = dlqHarness({ maxIndex: 2 });
		await dlq.push({ error: "1" });
		await dlq.push({ error: "2" });
		await dlq.push({ error: "3" });

		expect(await dlq.size()).toBe(2);
		const listed = await dlq.list();
		expect(listed.map((e) => e.error)).toEqual(["3", "2"]);
	});

	it("never throws when the control plane is down — the caller is already failing", async () => {
		class BrokenPlane extends MemoryControlPlane {
			override async set(): Promise<{ ok: boolean; version: number }> {
				throw new Error("control plane unreachable");
			}
		}
		const errors: unknown[] = [];
		const dlq = new DeadLetterQueue({
			controlPlane: new BrokenPlane(),
			now: () => 1_700_000_000_000,
			logger: { error: (...args: unknown[]) => errors.push(args) },
		});

		await expect(dlq.push({ error: "boom" })).resolves.toMatchObject({ indexed: false });
		expect(errors).toHaveLength(1);
	});

	it("keeps the entry durable when the index CAS loses", async () => {
		class ContendedIndex extends MemoryControlPlane {
			failIndexCas = false;
			override async compareAndSet(
				key: string,
				expectedVersion: number | null,
				value: unknown,
				opts: { ttlMs?: number } = {},
			): Promise<{ ok: boolean; version: number }> {
				if (this.failIndexCas && key === "dlq:index") return { ok: false, version: 0 };
				return super.compareAndSet(key, expectedVersion, value, opts);
			}
		}
		const cp = new ContendedIndex();
		const dlq = new DeadLetterQueue({ controlPlane: cp, now: () => 1_700_000_000_000 });

		cp.failIndexCas = true;
		const { id, indexed } = await dlq.push({ error: "still durable" });
		expect(indexed).toBe(false);
		expect((await dlq.get(id)).error).toBe("still durable");

		// The entry is durable but unlisted: losing a list slot is recoverable,
		// losing the failure record is not.
		expect((await dlq.list()).map((e) => e.id)).toEqual([]);

		// Dropping an entry that never made it into the index has nothing to
		// update, so the CAS is never attempted and the index is already correct.
		await expect(dlq.drop(id)).resolves.toEqual({ dropped: true, indexUpdated: true });
		expect(await dlq.get(id)).toBeNull();
		expect(await dlq.list()).toEqual([]);
	});

	it("never resurrects a handled failure when the index CAS stays stuck", async () => {
		class ContendedIndex extends MemoryControlPlane {
			failIndexCas = false;
			override async compareAndSet(
				key: string,
				expectedVersion: number | null,
				value: unknown,
				opts: { ttlMs?: number } = {},
			): Promise<{ ok: boolean; version: number }> {
				if (this.failIndexCas && key === "dlq:index") return { ok: false, version: 0 };
				return super.compareAndSet(key, expectedVersion, value, opts);
			}
		}
		const cp = new ContendedIndex();
		const dlq = new DeadLetterQueue({ controlPlane: cp, now: () => 1_700_000_000_000 });

		const { id, indexed } = await dlq.push({ error: "handled" });
		expect(indexed).toBe(true);

		// Now the index cannot be rewritten: the entry must still be deleted and
		// the stale index id must not resurface as a phantom record.
		cp.failIndexCas = true;
		await expect(dlq.drop(id)).resolves.toEqual({ dropped: true, indexUpdated: false });
		expect(await dlq.get(id)).toBeNull();
		expect(await dlq.list()).toEqual([]);
	});

	it("clear() empties entries and the index", async () => {
		const { dlq } = dlqHarness();
		await dlq.push({ error: "1" });
		await dlq.push({ error: "2" });

		await dlq.clear();
		expect(await dlq.size()).toBe(0);
		expect(await dlq.list()).toEqual([]);
	});
});

// ─── Table allowlist ────────────────────────────────────────────

const STRATEGIES = ["append_only", "versioned", "kv", "unique_key"];

describe("VoiceFlow table scope", () => {
	it("declares exactly the 34 VoiceFlow tables", () => {
		expect(VOICEFLOW_TABLES).toHaveLength(34);
		expect(new Set(VOICEFLOW_TABLES).size).toBe(34);
	});

	it("gives every table a complete, well-formed descriptor", () => {
		for (const table of VOICEFLOW_TABLES) {
			const meta = TABLE_META[table];
			expect(typeof meta.pk, table).toBe("string");
			expect(meta.pk.length, table).toBeGreaterThan(0);
			expect(STRATEGIES, table).toContain(meta.strategy);
			expect(typeof meta.fullScan, table).toBe("boolean");
			expect(meta, table).toHaveProperty("watermark");
			expect(meta, table).toHaveProperty("versionColumn");
			expect(meta, table).toHaveProperty("softDelete");
		}
	});

	it("never gives an append-only table a version column", () => {
		for (const table of VOICEFLOW_TABLES) {
			if (TABLE_META[table].strategy === "append_only") {
				expect(TABLE_META[table].versionColumn, table).toBeNull();
			}
		}
	});

	it("gives every unique-key table a natural key", () => {
		for (const table of VOICEFLOW_TABLES) {
			if (TABLE_META[table].strategy === "unique_key") {
				expect(Array.isArray(TABLE_META[table].uniqueOn), table).toBe(true);
				expect(TABLE_META[table].uniqueOn?.length, table).toBeGreaterThan(0);
			}
		}
	});

	it("keeps the live-schema facts the migrations get wrong", () => {
		expect(TABLE_META.chat_threads.pk).toBe("thread_id");
		expect(TABLE_META.settings.pk).toBe("key");
		expect(TABLE_META.users_meta.pk).toBe("anon_id");
		expect(TABLE_META.audit_logs.watermark).toBe("timestamp");
		expect(TABLE_META.agent_executions.watermark).toBe("started_at");

		// Only agent_config has a genuine integer revision column.
		const withVersion = VOICEFLOW_TABLES.filter((t) => TABLE_META[t].versionColumn === "version");
		expect(withVersion).toEqual(["agent_config"]);
	});

	it("excludes every table outside the VoiceFlow scope", () => {
		expect(inScope("posts")).toBe(true);
		expect(inScope("cricket_stats")).toBe(false);
		expect(inScope("toString")).toBe(false); // prototype keys must not leak in
		expect(() => tableMeta("cricket_stats")).toThrow(/outside the VoiceFlow replication scope/);
		expect(tableMeta("posts")).toBe(TABLE_META.posts);
	});

	it("splits the scope into full-scan and watermark tables with no overlap", () => {
		const full = fullScanTables();
		const watermark = watermarkTables();

		expect(full).toHaveLength(10);
		expect(watermark).toHaveLength(24);
		expect(full.filter((t) => watermark.includes(t))).toEqual([]);
		expect([...full, ...watermark].sort()).toEqual([...VOICEFLOW_TABLES].sort());
		for (const table of watermark) expect(TABLE_META[table].watermark, table).toBeTruthy();
	});

	it("declares exactly the anon-readable realtime allowlist", () => {
		expect([...ANON_READABLE_TABLES].sort()).toEqual(["comments", "polls", "posts"]);
		for (const table of ANON_READABLE_TABLES) expect(inScope(table), table).toBe(true);
	});

	it("declares only the VoiceFlow storage buckets", () => {
		expect([...STORAGE_BUCKETS]).toEqual(["chat-media", "voicebox-media"]);
	});

	it("is frozen so a runtime mutation cannot widen the replication scope", () => {
		expect(Object.isFrozen(TABLE_META)).toBe(true);
		expect(Object.isFrozen(VOICEFLOW_TABLES)).toBe(true);
		expect(Object.isFrozen(ANON_READABLE_TABLES)).toBe(true);
		expect(Object.isFrozen(STORAGE_BUCKETS)).toBe(true);
	});
});
