// Storage worker — aged orphans reclaimed, referenced evidence kept,
// recent uploads grace-perioded, abuse bursts alerted.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockAudit, mockStorage } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockAudit: vi.fn(async () => {}),
	mockStorage: { from: vi.fn() },
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom, storage: mockStorage },
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: mockAudit,
}));

import { sweepStorage } from "../../api/_storage.js";

const NOW = new Date("2026-09-20T12:00:00.000Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 3600 * 1000).toISOString();
const URL = "https://xyz.supabase.co/storage/v1/object/public/chat-media/keep.png";

function table(result: unknown) {
	const q: Record<string, unknown> = {};
	for (const m of ["select", "eq", "not", "like", "limit", "upsert"]) {
		q[m] = vi.fn(() => q);
	}
	// Direct awaits (select paths) resolve the payload; maybeSingle/upsert
	// have their own explicit mocks below where needed.
	(q.then as unknown) = (resolve: (v: unknown) => void) =>
		Promise.resolve({ data: result, error: null }).then(resolve);
	(q.maybeSingle as unknown) = vi.fn(async () => ({ data: result }));
	(q.upsert as unknown) = vi.fn(async () => ({ error: null }));
	return q;
}

function wire(
	byBucket: Record<string, Array<{ name: string; created_at: string }>>,
	posts: unknown[] = [],
) {
	const removed: string[] = [];
	mockFrom.mockImplementation((t: string) => {
		if (t === "posts") return table(posts);
		if (t === "chat_messages") return table([]);
		return table(null);
	});
	// settings reads: sweep marker absent, alerts empty, review snapshots empty
	mockStorage.from.mockImplementation((bucket: string) => ({
		list: vi.fn(async () => ({ data: byBucket[bucket] || [], error: null })),
		remove: vi.fn(async (paths: string[]) => {
			removed.push(...paths.map((p) => `${bucket}/${p}`));
			return { error: null };
		}),
	}));
	return removed;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("sweepStorage", () => {
	it("deletes only aged unreferenced objects, keeps evidence", async () => {
		// posts table returns the referenced image; chat/reviews empty
		const removed = wire(
			{
				"chat-media": [
					{ name: "old.png", created_at: daysAgo(10) },
					{ name: "keep.png", created_at: daysAgo(10) },
					{ name: "fresh.png", created_at: daysAgo(1) },
				],
				"voicebox-media": [
					{ name: "vold.png", created_at: daysAgo(10) },
					{ name: "fresh.png", created_at: daysAgo(1) },
				],
			},
			[{ image_url: URL }],
		);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await sweepStorage(client, NOW);
		expect(r.ok).toBe(true);
		expect(r.deleted).toEqual(["chat-media/old.png", "voicebox-media/vold.png"]);
		expect(removed).toEqual(["chat-media/old.png", "voicebox-media/vold.png"]);
		expect(r.skipped_recent).toBe(2); // fresh.png x2 buckets
		expect(mockAudit).toHaveBeenCalledTimes(1);
	});

	it("throttles to once per 24h", async () => {
		mockFrom.mockImplementation(() => {
			const q = table({
				value: { last_sweep_at: new Date(NOW - 3600 * 1000).toISOString() },
			});
			return q;
		});
		const client = (await import("../../api/_db-client.js")).default;
		const r = await sweepStorage(client, NOW);
		expect(r.throttled).toBe(true);
		expect(r.checked).toBe(0);
	});
});
