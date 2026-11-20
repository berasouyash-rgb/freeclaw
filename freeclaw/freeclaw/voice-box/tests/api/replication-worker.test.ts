// Replication worker: at-least-once delivery, idempotency, retry, dead-letter.

import { describe, expect, it } from "vitest";

import { MemoryAdapter } from "../../api/_backend/adapters/memory-adapter.js";
import { BackendError } from "../../api/_backend/errors.js";
import {
	MemoryOutbox,
	ReplicationWorker,
	applyEvent,
} from "../../api/_backend/replication.js";

function target() {
	const adapter = new MemoryAdapter({ name: "firebase" });
	adapter.seed("posts", [{ id: "p2", title: "to-delete", version: 1 }]);
	return adapter;
}

describe("ReplicationWorker", () => {
	it("applies insert, update and remove, then acks", async () => {
		const outbox = new MemoryOutbox([
			{ id: "e1", table: "posts", op: "insert", payload: { id: "p1", title: "a", version: 1 } },
			{ id: "e2", table: "posts", op: "update", payload: { id: "p1", title: "b" } },
			{ id: "e3", table: "posts", op: "remove", entity_id: "p2" },
		]);
		const adapter = target();
		const worker = new ReplicationWorker({ outbox, target: adapter });
		const result = await worker.drain();
		expect(result).toEqual({ claimed: 3, applied: 3, failed: 0 });
		expect(await adapter.get("posts", "p1")).toMatchObject({ title: "b", version: 2 });
		expect(await adapter.get("posts", "p2")).toBeNull();
		expect(outbox.acked.sort()).toEqual(["e1", "e2", "e3"]);
	});

	it("acks a duplicate insert (lost ack replay) as already applied", async () => {
		const duplicateTarget = {
			name: "firebase",
			async insert() {
				throw new BackendError("duplicate", { code: "DUPLICATE", retryable: false });
			},
		};
		const applied = [];
		const outbox = new MemoryOutbox([
			{ id: "e1", table: "posts", op: "insert", payload: { id: "p1" } },
		]);
		const worker = new ReplicationWorker({
			outbox,
			target: duplicateTarget,
			onApplied: (e, meta) => applied.push({ id: e.id, duplicate: meta.duplicate }),
		});
		const result = await worker.drain();
		expect(result).toEqual({ claimed: 1, applied: 1, failed: 0 });
		expect(outbox.acked).toEqual(["e1"]);
		expect(applied).toEqual([{ id: "e1", duplicate: true }]);
	});

	it("leaves a failed event queued for retry", async () => {
		const adapter = target();
		adapter.down = true;
		const outbox = new MemoryOutbox([
			{ id: "e1", table: "posts", op: "insert", payload: { id: "p9" } },
		]);
		const worker = new ReplicationWorker({ outbox, target: adapter });
		const first = await worker.drain();
		expect(first).toEqual({ claimed: 1, applied: 0, failed: 1 });
		expect(outbox.lastError.e1).toMatch(/simulated outage/);
		expect(outbox.acked).toEqual([]);

		adapter.down = false;
		const retry = await worker.drain();
		expect(retry).toEqual({ claimed: 1, applied: 1, failed: 0 });
		expect(outbox.acked).toEqual(["e1"]);
	});

	it("respects batch size", async () => {
		const events = Array.from({ length: 60 }, (_, i) => ({
			id: `e${i}`,
			table: "posts",
			op: "insert",
			payload: { id: `p${i}`, version: 1 },
		}));
		const outbox = new MemoryOutbox(events);
		const adapter = new MemoryAdapter({ name: "firebase" });
		const worker = new ReplicationWorker({ outbox, target: adapter, batchSize: 50 });
		expect((await worker.drain()).claimed).toBe(50);
		expect((await worker.drain()).claimed).toBe(10);
	});

	it("dead-letters an event after max attempts", async () => {
		const adapter = target();
		adapter.down = true;
		const outbox = new MemoryOutbox(
			[{ id: "e1", table: "posts", op: "insert", payload: { id: "p9" } }],
			{ maxAttempts: 2 },
		);
		const worker = new ReplicationWorker({ outbox, target: adapter });
		await worker.drain();
		await worker.drain();
		expect(outbox.dead).toEqual(["e1"]);
		expect((await worker.drain()).claimed).toBe(0);
	});
});

describe("applyEvent", () => {
	it("rejects unknown operations", async () => {
		await expect(
			applyEvent(target(), { id: "e1", table: "posts", op: "truncate" }),
		).rejects.toThrow(/unsupported replication op/);
	});

	it("rejects tables outside the scope", async () => {
		await expect(
			applyEvent(target(), {
				id: "e1",
				table: "cricket_stats",
				op: "insert",
				payload: { id: "x" },
			}),
		).rejects.toThrow(/outside the VoiceFlow replication scope/);
	});
});
