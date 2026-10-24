// ═══════════════════════════════════════════════════════════════════
// agent-cron registry pass — every deterministic worker runs each tick
// ═══════════════════════════════════════════════════════════════════
// Locks the backend-automation contract: one tick invokes every registry
// WORKERS entry through the same module+run path the manual Run button
// uses, records each non-deferred result via recordLastRun (the OpsCenter
// Automations feed), and reports the full per-worker map in `phases` —
// newest workers included, nothing runs invisibly. 401 without auth.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

function settingsTable() {
	return {
		select: () => ({
			eq: (_c: string, key: string) => ({
				maybeSingle: async () => ({
					data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
					error: null,
				}),
				single: async () => ({
					data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
					error: null,
				}),
			}),
			limit: async () => ({ data: [], error: null }),
		}),
		upsert: async (row: { key: string; value: unknown }) => {
			kv.store.set(row.key, row.value);
			return { error: null };
		},
	};
}

function emptyTable() {
	const q: Record<string, unknown> = {};
	return new Proxy(q, {
		get(_t, p) {
			if (p === "then")
				return (res: (v: unknown) => unknown) =>
					Promise.resolve({ data: [], error: null }).then(res);
			if (p === "maybeSingle" || p === "single")
				return async () => ({ data: null, error: null });
			return (..._a: unknown[]) => emptyTable();
		},
	});
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => (table === "settings" ? settingsTable() : emptyTable()),
	},
}));

const authMocks = vi.hoisted(() => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
}));
vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));

vi.mock("../../api/_agent-team.js", () => ({
	ALL_AGENTS: [
		{ id: "cron-probe", name: "Probe", division: "sys", description: "scan", status: "active" },
	],
	classifyAgent: vi.fn(() => ({ status: "active", behaviour_id: "probe", impact: "observe" })),
	auditRoster: vi.fn(() => ({
		agents_total: 0,
		agents_reaching_a_behaviour: 0,
		agents_retired: 0,
		behaviours_available: 0,
		behaviours_state_changing: 0,
	})),
	runSupervisorScan: vi.fn(async () => ({ ok: true })),
	saveAgentReport: vi.fn(async () => {}),
	setAgentState: vi.fn(),
	processAgentTask: vi.fn(),
	classifyTask: vi.fn(() => "scan"),
}));
vi.mock("../../api/_improve-scan.js", () => ({
	runImprovementScans: vi.fn(async () => ({ ok: true, scanned: 0 })),
}));
vi.mock("../../api/_workforce.js", () => ({
	patrol: vi.fn(async () => ({ ok: true, executed: 0 })),
}));
// NOTE: _workforce-workers.js is deliberately NOT mocked: the registry
// adapters and the high-value roster run for real against the mocked DB,
// so this test proves the tick executes production code paths.

import agentCron from "../../api/agent-cron.js";
import { WORKERS, readLastRuns } from "../../api/_automation-registry.js";

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

function tick(query: Record<string, string> = {}) {
	return {
		method: "GET",
		headers: {},
		query,
		body: {},
	} as never;
}

beforeEach(() => {
	kv.store.clear();
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(true);
});

describe("agent-cron registry pass", () => {
	it("runs every registry worker and reports the full phase map", async () => {
		const res = response();
		await agentCron(tick(), res as never);
		expect(res.statusCode).toBe(200);
		const body = res.body as {
			ok: boolean;
			phases: Record<string, { ok?: boolean; deferred?: boolean; error?: string }>;
		};
		expect(body.ok).toBe(true);
		// Same universe the manual Run button drives — no worker runs invisibly.
		expect(Object.keys(body.phases).sort()).toEqual(
			WORKERS.map((w) => w.id).sort(),
		);
		for (const [id, r] of Object.entries(body.phases)) {
			expect(
				typeof r === "object" && r !== null,
				`${id} has a structured result`,
			).toBe(true);
		}
		// Non-deferred results persisted for the Automations feed.
		const lastRuns = await readLastRuns(
			(await import("../../api/_db-client.js")).default,
		);
		for (const w of WORKERS) {
			if (!(body.phases[w.id] as { deferred?: boolean }).deferred) {
				expect(lastRuns[w.id], `${w.id} last-run recorded`).toBeTruthy();
				expect(typeof lastRuns[w.id].summary).toBe("string");
			}
		}
	});

	it("keeps the named handles for existing readers", async () => {
		const res = response();
		await agentCron(tick(), res as never);
		const body = res.body as Record<string, unknown>;
		for (const k of [
			"poll_sweep",
			"sla",
			"reopen",
			"followup",
			"poll_integrity",
			"storage",
			"trends",
			"anonymity",
			"comment_watch",
			"workforce_roster",
		]) {
			expect(k in body, `${k} still present`).toBe(true);
		}
	});

	it("401s without cron secret or admin session", async () => {
		authMocks.isAdmin.mockResolvedValueOnce(false);
		const res = response();
		await agentCron(tick(), res as never);
		expect(res.statusCode).toBe(401);
	});
});
