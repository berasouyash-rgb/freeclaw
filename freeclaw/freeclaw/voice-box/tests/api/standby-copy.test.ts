// ═══════════════════════════════════════════════════════════════════
// Standby copy wiring — Supabase primary, Firebase standby
// ═══════════════════════════════════════════════════════════════════
// `_mirror.js` is tested on its own in mirror.test.ts. This file tests the
// part that can only be wrong once it is WIRED IN:
//
//   1. `/api/reliability` (backend.status()) must report the standby copy's
//      real state. A dashboard that says "redundant" while the queue is
//      backing up is worse than no dashboard.
//   2. The scheduled tick must drain queued copies even when the
//      failover/replication flags are OFF — those flags gate the swappable
//      adapter stack, not the write-path mirror. Coupling them would strand
//      pending copies on the normal deployment.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Backend } from "../../api/_backend/index.js";
import { MemoryAdapter } from "../../api/_backend/adapters/memory-adapter.js";
import { MemoryControlPlane } from "../../api/_backend/control-plane.js";
import {
	__resetMirrorForTests,
	flushMirrorQueue,
	mirrorStats,
	mirrorWrite,
} from "../../api/_mirror.js";

const ROW = {
	id: "post_1",
	school_id: "school_9",
	title: "Standby copy must be provable",
	updated_at: "2026-11-01T10:00:00.000Z",
};

function buildBackend() {
	const primary = new MemoryAdapter({ name: "supabase" });
	primary.seed("posts", [{ id: "post_1", title: "t", version: 1 }]);
	return new Backend({
		env: {},
		primary,
		standby: null,
		controlPlane: new MemoryControlPlane(),
		flags: { failover: false, replication: false },
	});
}

function okFetch() {
	return vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" }));
}

beforeEach(() => {
	__resetMirrorForTests();
	process.env.FIREBASE_ID_TOKEN = "test-id-token";
	process.env.FIREBASE_PROJECT_ID = "voicelflow";
	delete process.env.MIRROR_TABLES;
});

afterEach(() => {
	delete process.env.FIREBASE_ID_TOKEN;
	vi.restoreAllMocks();
});

describe("backend status exposes the standby copy", () => {
	it("names primary=supabase standby=firebase and reports lagging=false before any write", async () => {
		const status = await buildBackend().status();
		expect(status.standby_copy.primary).toBe("supabase");
		expect(status.standby_copy.standby).toBe("firebase");
		expect(status.standby_copy.configured).toBe(true);
		expect(status.standby_copy.lagging).toBe(false);
		expect(status.standby_copy.delivered).toBe(0);
		expect(status.standby_copy.pending).toBe(0);
	});

	it("reports configured=false when no Firebase credential is present", async () => {
		delete process.env.FIREBASE_ID_TOKEN;
		const status = await buildBackend().status();
		expect(status.standby_copy.configured).toBe(false);
		expect(status.standby_copy.transport).toBe("none");
		// Unconfigured is not "lagging": nothing was lost, nothing was attempted.
		expect(status.standby_copy.lagging).toBe(false);
	});

	it("turns lagging=true as soon as a copy is stuck in the retry queue", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })),
		);
		await mirrorWrite({ table: "posts", op: "insert", rows: ROW });

		const status = await buildBackend().status();
		expect(status.standby_copy.lagging).toBe(true);
		expect(status.standby_copy.failed).toBe(1);
		expect(status.standby_copy.pending).toBe(1);
		expect(status.standby_copy.lastError).toBe("http_503");
	});

	it("clears lagging once the queue drains", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })),
		);
		await mirrorWrite({ table: "posts", op: "insert", rows: ROW });
		vi.stubGlobal("fetch", okFetch());

		const backend = buildBackend();
		const flushed = await backend.flushStandbyCopy();
		expect(flushed.sent).toBe(1);

		const status = await backend.status();
		expect(status.standby_copy.pending).toBe(0);
		expect(status.standby_copy.delivered).toBe(1);
	});

	it("does not claim redundancy just because the copy is configured", async () => {
		const status = await buildBackend().status();
		// The failover stack is a separate switch and stays off until the
		// operator turns it on. The copy existing must not imply failover.
		expect(status.enabled.failover).toBe(false);
		expect(status.standby_configured).toBe(false);
		expect(status.mode).toBe("primary");
	});
});

describe("scheduled tick drains the standby copy independent of the flags", () => {
	it("flushes queued copies even with failover and replication disabled", async () => {
		// First delivery fails, so one event is queued.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 500, text: async () => "" })),
		);
		await mirrorWrite({ table: "posts", op: "insert", rows: ROW });
		expect(mirrorStats().pending).toBe(1);

		vi.stubGlobal("fetch", okFetch());
		const { runScheduledReplication } = await import("../../api/_replication-cron.js");
		const result = await runScheduledReplication();

		expect(result.standby_copy.flush.sent).toBe(1);
		expect(result.standby_copy.stats.pending).toBe(0);
		// The adapter-stack half of the tick still honestly skips.
		expect(result.skipped).toBe(true);
	});
});

describe("flushMirrorQueue is idempotent", () => {
	it("returns zeros when nothing is queued", async () => {
		vi.stubGlobal("fetch", okFetch());
		const first = await flushMirrorQueue();
		const second = await flushMirrorQueue();
		expect(first.sent).toBe(0);
		expect(second.sent).toBe(0);
		expect(second.pending).toBe(0);
	});
});
