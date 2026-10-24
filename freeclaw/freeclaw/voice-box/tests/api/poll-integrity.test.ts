// Poll integrity — burst/bot votes quarantined with ledger rollback,
// watch-level pace alerts only, degraded honestly without timestamps.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockAudit } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockAudit: vi.fn(async () => {}),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: mockAudit,
}));

import { checkPollIntegrity } from "../../api/_poll-integrity.js";

const NOW = new Date("2026-09-20T12:00:00.000Z").getTime();
const secAgo = (s: number) => new Date(NOW - s * 1000).toISOString();
let settingsStore: Record<string, unknown> = {};
let deletedIds: unknown[] = [];

function vote(id: string, poll: string, author: string, sec: number) {
	return { id, poll_id: poll, author_id: author, choices: [0], created_at: secAgo(sec) };
}

function wire(votes: unknown[], alerts: unknown[] = []) {
	settingsStore = {
		workforce_alerts: { alerts },
	};
	mockFrom.mockImplementation((table: string) => {
		if (table === "poll_votes") {
			const q: Record<string, unknown> = {};
			for (const m of ["select", "gte", "limit"]) {
				q[m] = vi.fn(() => q);
			}
			(q.then as unknown) = (resolve: (v: unknown) => void) =>
				Promise.resolve({ data: votes, error: null }).then(resolve);
			(q.delete as unknown) = vi.fn(() => ({
				in: vi.fn(async (_col: string, ids: unknown[]) => {
					deletedIds.push(...(ids as unknown[]));
					return { error: null };
				}),
			}));
			return q;
		}
		const q: Record<string, unknown> = {};
		for (const m of ["select", "eq", "upsert"]) {
			q[m] = vi.fn(() => q);
		}
		(q.maybeSingle as unknown) = vi.fn(async () => ({ data: null }));
		(q.upsert as unknown) = vi.fn(async (row: { key: string; value: unknown }) => {
			settingsStore[row.key] = row.value;
			return { error: null };
		});
		return q;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	deletedIds = [];
	settingsStore = { workforce_alerts: { alerts: [] } };
});

describe("checkPollIntegrity", () => {
	it("reports degraded (not clean) when timestamps are missing", async () => {
		// hasTimestamps probe fails -> degraded path
		mockFrom.mockImplementation((table: string) => {
			if (table === "poll_votes") {
				const q: Record<string, unknown> = {};
				for (const m of ["select", "limit"]) {
					q[m] = vi.fn(() => q);
				}
				(q.then as unknown) = (resolve: (v: unknown) => void) =>
					Promise.resolve({ data: null, error: { message: "column does not exist" } }).then(resolve);
				return q;
			}
			return thenableEmpty();
		});
		function thenableEmpty() {
			const q: Record<string, unknown> = {};
			for (const m of ["select", "eq"]) {
				q[m] = vi.fn(() => q);
			}
			(q.maybeSingle as unknown) = vi.fn(async () => ({ data: null }));
			return q;
		}
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkPollIntegrity(client, NOW);
		expect(r.ok).toBe(false);
		expect(r.degraded).toBe(true);
		expect(r.quarantined).toBe(0);
	});

	it("quarantines a 60-second burst with ledger + alert + audit", async () => {
		const votes = Array.from({ length: 16 }, (_, i) =>
			vote(`v${i}`, "p1", `anon_${i}`, 20 + i),
		);
		wire(votes, []);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkPollIntegrity(client, NOW);
		expect(r.ok).toBe(true);
		expect(r.quarantined).toBe(16);
		expect(deletedIds).toHaveLength(16);
		// ledger preserves every row for rollback
		const ledger = settingsStore["poll_fraud"] as { entries: Array<{ votes: unknown[] }> };
		expect(ledger.entries[0].votes).toHaveLength(16);
		const alerts = (settingsStore["workforce_alerts"] as { alerts: Array<{ key: string }> }).alerts;
		expect(alerts.some((a) => a.key === "poll-fraud:p1")).toBe(true);
		expect(mockAudit).toHaveBeenCalledTimes(1);
	});

	it("watch-alerts sub-threshold pace without deleting", async () => {
		const votes = Array.from({ length: 9 }, (_, i) =>
			vote(`w${i}`, "p2", `anon_${i}`, 20 + i * 5),
		);
		wire(votes, []);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkPollIntegrity(client, NOW);
		expect(r.quarantined).toBe(0);
		expect(r.watchAlerts).toBe(1);
		expect(deletedIds).toHaveLength(0);
	});

	it("ignores organic voting", async () => {
		const votes = [
			vote("o1", "p3", "anon_a", 300),
			vote("o2", "p3", "anon_b", 900),
			vote("o3", "p3", "anon_c", 2400),
		];
		wire(votes, []);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkPollIntegrity(client, NOW);
		expect(r.quarantined).toBe(0);
		expect(r.watchAlerts).toBe(0);
	});
});
