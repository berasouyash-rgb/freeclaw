// Trend watch — spikes alert once, flat volumes stay silent.
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

import { checkTrends } from "../../api/_trend-watch.js";

const NOW = new Date("2026-09-20T12:00:00.000Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();
let writtenAlerts: unknown[] = [];

function wire(rows: unknown[], alerts: unknown[] = []) {
	writtenAlerts = alerts;
	mockFrom.mockImplementation((table: string) => {
		if (table === "posts") {
			const q: Record<string, unknown> = {};
			for (const m of ["select", "eq", "gte", "limit"]) {
				q[m] = vi.fn(() => q);
			}
			(q.then as unknown) = (resolve: (v: unknown) => void) =>
				Promise.resolve({ data: rows, error: null }).then(resolve);
			return q;
		}
		const q: Record<string, unknown> = {};
		for (const m of ["select", "eq", "upsert"]) {
			q[m] = vi.fn(() => q);
		}
		(q.maybeSingle as unknown) = vi.fn(async () => ({
			data: { value: { alerts: writtenAlerts } },
		}));
		(q.upsert as unknown) = vi.fn(async (row: { value: { alerts: unknown[] } }) => {
			writtenAlerts = row.value.alerts;
			return { error: null };
		});
		return q;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("checkTrends", () => {
	it("alerts a real spike and audits it", async () => {
		const rows = [
			...Array.from({ length: 9 }, (_, i) => ({
				category: "Food",
				created_at: hoursAgo(2 + i),
			})),
			{ category: "Food", created_at: hoursAgo(100) },
			...Array.from({ length: 4 }, (_, i) => ({
				category: "Transport",
				created_at: hoursAgo(5 + i * 3),
			})),
		];
		wire(rows, []);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkTrends(client, NOW);
		expect(r.ok).toBe(true);
		expect(r.checked).toBe(14);
		expect(r.spikes).toHaveLength(1);
		expect(r.spikes[0].category).toBe("Food");
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(writtenAlerts.some((a) => (a as { key: string }).key === "trend:Food")).toBe(true);
	});

	it("stays silent on flat volume and dedups open alerts", async () => {
		const rows = Array.from({ length: 6 }, (_, i) => ({
			category: "Food",
			created_at: hoursAgo(30 + i * 20),
		}));
		wire(rows, [{ key: "trend:Food" }]);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkTrends(client, NOW);
		expect(r.spikes).toHaveLength(0);
		expect(mockAudit).not.toHaveBeenCalled();
	});
});
