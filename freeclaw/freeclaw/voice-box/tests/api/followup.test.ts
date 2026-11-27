// Follow-up worker — stalled assigned cases ping once per stale period,
// fresh and unassigned cases untouched.
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

import { checkFollowups } from "../../api/_followup.js";

const NOW = new Date("2026-09-20T12:00:00.000Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 3600 * 1000).toISOString();
const stale = {
	id: "s1",
	title: "Broken pump",
	priority: "high",
	status: "in_progress",
	assigned_to: "admin_amit",
	created_at: daysAgo(10),
	updated_at: daysAgo(5),
};
const fresh = { ...stale, id: "s2", updated_at: daysAgo(1) };
const unassigned = { ...stale, id: "s3", assigned_to: null };

function thenable(payload: unknown) {
	const q: Record<string, unknown> = {};
	for (const m of ["select", "eq", "not", "lt", "gte", "in", "limit", "order"]) {
		q[m] = vi.fn(() => q);
	}
	(q as Record<string, unknown>).then = (resolve: (v: unknown) => void) =>
		Promise.resolve(payload).then(resolve);
	return q;
}

let alertRows: unknown[] = [];

function wire(posts: unknown[], alerts: unknown[] = []) {
	alertRows = alerts;
	mockFrom.mockImplementation((table: string) => {
		if (table === "posts") return thenable({ data: posts, error: null });
		const q = thenable({ data: null, error: null });
		(q.maybeSingle as unknown) = vi.fn(async () => ({
			data: { value: { alerts: alertRows } },
		}));
		(q.upsert as unknown) = vi.fn(
			async (row: { value: { alerts: unknown[] } }) => {
				alertRows = row.value.alerts;
				return { error: null };
			},
		);
		return q;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("checkFollowups", () => {
	it("pings a stalled assigned case with evidence", async () => {
		wire([stale, fresh, unassigned], []);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkFollowups(client, NOW);
		expect(r.ok).toBe(true);
		expect(r.checked).toBe(2);
		expect(r.pinged).toBe(1);
		expect(r.verified).toBe(true);
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(
			alertRows.some(
				(a) =>
					(a as { key: string }).key === "followup:s1" &&
					!(a as { resolved_at: string }).resolved_at,
			),
		).toBe(true);
	});

	it("does not ping twice within the repeat window", async () => {
		wire([stale], [
			{ key: "followup:s1", created_at: daysAgo(2), occurrences: 1 },
		]);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkFollowups(client, NOW);
		expect(r.pinged).toBe(0);
		expect(r.skipped).toBe(1);
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("re-pings after the repeat window, superseding the old alert", async () => {
		wire([stale], [
			{ key: "followup:s1", created_at: daysAgo(9), occurrences: 1 },
		]);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkFollowups(client, NOW);
		expect(r.pinged).toBe(1);
		const open = (alertRows as Array<{ key: string; resolved_at?: string }>).filter(
			(a) => a.key === "followup:s1" && !a.resolved_at,
		);
		expect(open).toHaveLength(1);
	});
});
