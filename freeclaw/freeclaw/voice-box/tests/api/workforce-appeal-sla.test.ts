// Appeal SLA worker — open appeals past the 7-day SLA escalate; fresh
// queues stay quiet (disable test: without this worker stale recourse
// requests rot with no backstop).
import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
const alerts = vi.hoisted(() => ({ queued: [] as Array<Record<string, unknown>> }));

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			if (table !== "settings") throw new Error("unexpected table " + table);
			return {
				select: () => ({
					eq: (_c: string, key: string) => ({
						maybeSingle: async () => ({
							data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
							error: null,
						}),
					}),
					like: (_c: string, prefix: string) => {
						const stem = prefix.replace(/%$/, "");
						const rows = [...kv.store.entries()]
							.filter(([k]) => k.startsWith(stem))
							.map(([key, value]) => ({ key, value }));
						const chain: Record<string, unknown> = {
							limit: async () => ({ data: rows, error: null }),
						};
						return chain;
					},
				}),
				upsert: async (row: { key: string; value: unknown }) => {
					kv.store.set(row.key, row.value);
					return { error: null };
				},
			};
		},
	},
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn(async () => {}),
}));

vi.mock("../../api/_improvements.js", () => ({
	queueImprovement: vi.fn(async (item: Record<string, unknown>) => {
		alerts.queued.push(item);
		return true;
	}),
}));

import { runWorker } from "../../api/_workforce-core.js";
import "../../api/_workforce-workers.js";
import { resetSupervisorState } from "../../api/_worker-supervisor.js";

const OLD = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
const FRESH = new Date().toISOString();

beforeEach(() => {
	kv.store.clear();
	alerts.queued.length = 0;
	vi.clearAllMocks();
	resetSupervisorState();
});

describe("appeal-sla", () => {
	it("escalates a stale open appeal to the improvement queue", async () => {
		kv.store.set("appeal:apl_old", {
			id: "apl_old",
			surface: "post",
			author_id: "anon-9",
			status: "open",
			created_at: OLD,
		});
		const r = await runWorker("appeal-sla", "test");
		expect(r.outcome).toBe("escalated");
		expect(alerts.queued).toHaveLength(1);
		expect(alerts.queued[0]).toMatchObject({ source: "appeal-sla" });
		expect(String(alerts.queued[0].title)).toContain("1 appeals");
	});

	it("stays quiet when every open appeal is fresh (disable test)", async () => {
		kv.store.set("appeal:apl_fresh", {
			id: "apl_fresh",
			surface: "comment",
			author_id: "anon-9",
			status: "open",
			created_at: FRESH,
		});
		const r = await runWorker("appeal-sla", "test");
		expect(r.outcome).toBe("skipped");
		expect(alerts.queued).toHaveLength(0);
	});

	it("ignores decided appeals no matter their age", async () => {
		kv.store.set("appeal:apl_done", {
			id: "apl_done",
			surface: "poll",
			author_id: "anon-9",
			status: "upheld",
			created_at: OLD,
		});
		const r = await runWorker("appeal-sla", "test");
		expect(r.outcome).toBe("skipped");
		expect(alerts.queued).toHaveLength(0);
	});
});
