// SLA worker — warn before deadline, escalate once on breach, never twice.
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

import { checkSLA } from "../../api/_sla.js";

const NOW = new Date("2026-09-20T12:00:00.000Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();

function postsBuilder(posts: unknown[]) {
	const q: Record<string, unknown> = { _posts: posts };
	for (const m of ["select", "eq", "not", "lt", "limit"]) {
		q[m] = vi.fn(() => q);
	}
	(q as Record<string, unknown>).then = (
		resolve: (v: unknown) => void,
	) => Promise.resolve({ data: posts, error: null }).then(resolve);
	return q;
}

function settingsRow(alerts: unknown[]) {
	const q: Record<string, unknown> = {};
	for (const m of ["select", "eq", "upsert"]) {
		q[m] = vi.fn(() => q);
	}
	(q.maybeSingle as unknown) = vi.fn(async () => ({
		data: { value: { alerts } },
	}));
	return q;
}

let writtenAlerts: unknown[] = [];

function wire(posts: unknown[], alerts: unknown[] = []) {
	writtenAlerts = alerts;
	mockFrom.mockImplementation((table: string) => {
		if (table === "posts") {
			const q = postsBuilder(posts);
			(q as Record<string, unknown>).update = vi.fn((_patch: unknown) => ({
				eq: vi.fn(async () => ({ error: null })),
			}));
			return q;
		}
		const q = settingsRow(writtenAlerts);
		(q.upsert as ReturnType<typeof vi.fn>).mockImplementation(
			async (row: { value: { alerts: unknown[] } }) => {
				writtenAlerts = row.value.alerts;
				return { error: null };
			},
		);
		return q;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("checkSLA", () => {
	it("escalates a breached post once: bump + alert + audit", async () => {
		wire(
			[
				{
					id: "p1",
					title: "Leak",
					priority: "medium",
					status: "reported",
					created_at: hoursAgo(24 * 8),
					hidden: false,
					deleted: false,
				},
			],
			[],
		);
		const r = await checkSLA(
			(await import("../../api/_db-client.js")).default,
			NOW,
		);
		expect(r.ok).toBe(true);
		expect(r.escalated).toBe(1);
		expect(r.warned).toBe(0);
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(
			writtenAlerts.some(
				(a) =>
					(a as { key: string }).key === "sla-breach:p1" &&
					!(a as { resolved_at: string }).resolved_at,
			),
		).toBe(true);
	});

	it("never escalates twice while the breach alert is unresolved", async () => {
		const post = {
			id: "p1",
			title: "Leak",
			priority: "high",
			status: "reported",
			created_at: hoursAgo(24 * 4),
			hidden: false,
			deleted: false,
		};
		wire([post], [
			{ key: "sla-breach:p1", severity: "high", occurrences: 1 },
		]);
		const client = (await import("../../api/_db-client.js")).default;
		const r1 = await checkSLA(client, NOW);
		expect(r1.escalated).toBe(0);
	});

	it("warns within the hour before deadline without touching priority", async () => {
		const seen: unknown[][] = [];
		// simpler: rebuild with the post present and capture updates
		const post = {
			id: "p2",
			title: "Noise",
			priority: "critical",
			status: "in_progress",
			created_at: hoursAgo(23.5),
			hidden: false,
			deleted: false,
		};
		mockFrom.mockImplementation((table: string) => {
			if (table === "posts") {
				const q = postsBuilder([post]);
				(q as Record<string, unknown>).update = vi.fn((patch: unknown) => {
					seen.push([patch]);
					return { eq: vi.fn(async () => ({ error: null })) };
				});
				return q;
			}
			const q = settingsRow(writtenAlerts);
			(q.upsert as ReturnType<typeof vi.fn>).mockImplementation(
				async (row: { value: { alerts: unknown[] } }) => {
					writtenAlerts = row.value.alerts;
					return { error: null };
				},
			);
			return q;
		});
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkSLA(client, NOW);
		expect(r.warned).toBe(1);
		expect(r.escalated).toBe(0);
		expect(seen).toHaveLength(0);
		expect(
			writtenAlerts.some(
				(a) => (a as { key: string }).key === "sla-warning:p2",
			),
		).toBe(true);
	});

	it("ignores solved posts and bad dates", async () => {
		wire(
			[
				{
					id: "p3",
					title: "Done",
					priority: "low",
					status: "solved",
					created_at: hoursAgo(24 * 60),
					hidden: false,
					deleted: false,
				},
				{
					id: "p4",
					title: "Dateless",
					priority: "low",
					status: "reported",
					created_at: "not-a-date",
					hidden: false,
					deleted: false,
				},
			],
			[],
		);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkSLA(client, NOW);
		expect(r.checked).toBe(1);
		expect(r.warned).toBe(0);
		expect(r.escalated).toBe(0);
	});
});
