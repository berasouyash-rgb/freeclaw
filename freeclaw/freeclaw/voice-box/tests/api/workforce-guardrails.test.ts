// ═══════════════════════════════════════════════════════════════════
// Workforce Guardrails — approval-eviction + orphan-alert reconciliation
// ═══════════════════════════════════════════════════════════════════
// Locks two invariants that keep the Approval Center honest:
//   1. capTasks() never evicts a non-terminal task (blocked / queued /
//      working / verifying) when the store hits MAX_STORED — an awaiting-
//      approval decision must ALWAYS remain reachable, or the admin sees
//      "Approval required" alerts whose Approve button returns
//      "Task not found" (the exact "approval buttons do nothing" bug).
//   2. pending-approvals / alerts reconcile orphaned `approval:` alerts —
//      an alert whose blocked task no longer exists is auto-resolved so
//      the Center only ever lists decisions that can actually be acted on.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mocks.from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => {}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(async () => {}),
	emitEventAndBridge: vi.fn(async () => {}),
	EVENT_TYPES: {},
}));
vi.mock("../../api/_agent-team.js", () => ({
	ALL_AGENTS: [],
	processAgentTask: vi.fn(),
	classifyTask: vi.fn(),
	setAgentState: vi.fn(),
	getAgentState: vi.fn(() => ({ state: "idle", task: null })),
}));
vi.mock("../../api/agents/_runner.js", () => ({
	runAgent: vi.fn(),
	logActivity: vi.fn(async () => {}),
	recordMetric: vi.fn(async () => {}),
	getRecentActivity: vi.fn(async () => []),
}));
const { hasUsableLLM: mockHasUsableLLM } = vi.hoisted(() => ({
	hasUsableLLM: vi.fn(async () => true),
}));
vi.mock("../../api/_providers.js", () => ({
	hasUsableLLM: mockHasUsableLLM,
	invalidateLLMStatus: vi.fn(),
	buildChain: vi.fn(async () => []),
	callLLMChain: vi.fn(async () => null),
	callProviderStream: vi.fn(async () => ({
		ok: false,
		text: "",
		provider: null,
		model: null,
	})),
	getProviderConfig: vi.fn(async () => null),
}));

import workforceHandler from "../../api/_workforce.js";

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

function req(body: unknown) {
	return {
		method: "POST",
		headers: { "x-admin-token": "test" },
		body,
		query: {},
		socket: { remoteAddress: "127.0.0.1" },
	};
}

function settingsStore(initial: unknown) {
	let value = initial;
	return {
		read: async () => ({
			data: value === undefined ? null : { value },
			error: null,
		}),
		write: async (v: unknown) => {
			value = v;
			return { error: null };
		},
		get: () => value,
	};
}

function task(id: string, status: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		title: `Task ${id}`,
		description: null,
		source: "test",
		source_ref: `src:${id}`,
		priority: "medium",
		status,
		assigned_agent: null,
		parent_task_id: null,
		required_capability: null,
		risk_level: status === "blocked" ? "high" : "low",
		input: null,
		output: null,
		outcomes: null,
		error: null,
		verification_status: status === "blocked" ? "awaiting_approval" : "none",
		attempts: 0,
		max_attempts: 3,
		created_by: "system",
		created_at: new Date().toISOString(),
		claimed_at: null,
		started_at: null,
		heartbeat_at: null,
		completed_at: null,
		...overrides,
	};
}

let tasksStore: ReturnType<typeof settingsStore>;
let otherSettings: Record<string, unknown>;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.from.mockReset();
	tasksStore = settingsStore({ tasks: [] });
	otherSettings = {};
});

/** Settings-fallback mock: tasks live under agent_tasks_store; alerts under
 *  workforce_alerts; the rest in their own per-key store. */
function mockSettingsFallback() {
	mocks.from.mockImplementation((table: string) => {
		const settingsRead = async (key: string) => {
			if (key === "agent_tasks_store") return tasksStore.read();
			if (key === "workforce_alerts") {
				const v = otherSettings["workforce_alerts"];
				return { data: v === undefined ? null : { value: v }, error: null };
			}
			return {
				data: otherSettings[key] === undefined ? null : { value: otherSettings[key] },
				error: null,
			};
		};
		const settingsWrite = async (key: string, value: unknown) => {
			if (key === "agent_tasks_store") await tasksStore.write(value);
			else otherSettings[key] = value;
			return { error: null };
		};
		if (table === "agent_tasks") {
			// Legacy schema probe → error ⇒ settings fallback is used
			return {
				select: () => ({
					limit: async () => ({ data: null, error: { message: "no such column" } }),
				}),
			};
		}
		if (table === "settings") {
			return {
				select: vi.fn(() => ({
					eq: vi.fn((_col: string, key: string) => ({
						maybeSingle: () => settingsRead(key),
					})),
					limit: async () => ({ data: [] }),
				})),
				upsert: vi.fn(async (row: { key: string; value: unknown }) =>
					settingsWrite(row.key, row.value),
				),
				insert: vi.fn(async (row: { key: string; value: unknown }) =>
					settingsWrite(row.key, row.value),
				),
			};
		}
		// Any other table (posts, reports, users_meta …) → empty success
		return { select: () => ({ limit: async () => ({ data: [] }) }) };
	});
}

describe("capTasks — approval tasks are never evicted", () => {
	it("keeps a blocked task even when the store is over MAX_STORED with completed tasks", async () => {
		mockSettingsFallback();
		const blocked = task("blocked-1", "blocked");
		const completed = Array.from({ length: 400 }, (_, i) =>
			task(`done-${i}`, "completed"),
		);
		tasksStore.write({ tasks: [...completed, blocked] });

		// Any write path (create-task pushes then caps) must not drop the blocked task
		const res = response();
		await workforceHandler(
			req({ action: "pending-approvals" }),
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { approvals: unknown[] }).approvals.length).toBe(1);
		const stored = tasksStore.get() as { tasks: typeof completed };
		expect(stored.tasks.some((t) => t.id === "blocked-1")).toBe(true);
	});

	it("evicts only terminal tasks when over the cap — via a real creation path", async () => {
		mockSettingsFallback();
		// 300 completed tasks + a blocked task → escalating a real post (the
		// genuine task-creation path) must evict old completed tasks but never
		// the blocked one — and the store must stay under MAX_STORED.
		const blocked = task("keep-me", "blocked");
		tasksStore.write({
			tasks: [
				blocked,
				...Array.from({ length: 310 }, (_, i) => task(`c-${i}`, "completed")),
			],
		});
		otherSettings["workforce_approval_history"] = { history: [] };
		otherSettings["workforce_findings"] = { findings: [] };
		otherSettings["workforce_config"] = {};
		// escalate-post reads the post row from the DB. Extend the existing
		// settings fallback with a posts table (must NOT replace it — the
		// handler still reads/writes the task store through settings).
		const base = mocks.from.getMockImplementation();
		mocks.from.mockImplementation((table: string) => {
			if (table === "posts") {
				return {
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							maybeSingle: async () => ({
								data: {
									id: "post-e2e",
									title: "Flagged post",
									status: "reported",
									hidden: false,
								deleted: false,
							},
							error: null,
						}),
					})),
				})),
			};
			}
			return base?.(table) ?? {
				select: vi.fn(() => ({ limit: async () => ({ data: [] }) })),
				update: vi.fn(async () => ({ error: null })),
				upsert: vi.fn(async () => ({ error: null })),
				insert: vi.fn(async () => ({ error: null })),
			};
		});

		const res = response();
		await workforceHandler(req({ action: "escalate-post", id: "post-e2e" }), res);
		expect(res.statusCode).toBe(200);
		const stored = tasksStore.get() as { tasks: unknown[] };
		// blocked survives
		expect(stored.tasks.some((t: { id: string }) => t.id === "keep-me")).toBe(true);
		// store capped at MAX_STORED (300) — only completed were trimmed
		expect(stored.tasks.length).toBeLessThanOrEqual(300);
		// the newly escalated blocked task exists
		expect(
			stored.tasks.some(
				(t: { status: string; source_ref: string }) =>
					t.status === "blocked" && t.source_ref === "moderate:post-e2e",
			),
		).toBe(true);
	});
});

describe("reconcileApprovalAlerts — orphaned alerts self-resolve", () => {
	it("resolves an approval alert whose blocked task no longer exists", async () => {
		mockSettingsFallback();
		// An alert exists for approval decision X, but NO blocked task does
		// (e.g. the task was evicted from a legacy store or externally cleared)
		otherSettings["workforce_alerts"] = {
			alerts: [
				{
					id: "al-orphan",
					key: "approval:ghost-task",
					severity: "high",
					title: "Approval required: hide reported post",
					body: null,
					agent: null,
					evidence: null,
					occurrences: 1,
					acknowledged_at: null,
					acknowledged_by: null,
					resolved_at: null,
					resolved_by: null,
					created_at: new Date().toISOString(),
					last_at: new Date().toISOString(),
				},
				{
					id: "al-live",
					key: "approval:live-task",
					severity: "high",
					title: "Approval required: real pending decision",
					body: null,
					agent: null,
					evidence: null,
					occurrences: 1,
					acknowledged_at: null,
					acknowledged_by: null,
					resolved_at: null,
					resolved_by: null,
					created_at: new Date().toISOString(),
					last_at: new Date().toISOString(),
				},
			],
		};
		tasksStore.write({
			// source_ref must produce key `approval:live-task` (reconcile matches
			// `approval:${source_ref || title || task}`)
			tasks: [task("live-task", "blocked", { source_ref: "live-task" })],
		});

		const res = response();
		await workforceHandler(req({ action: "pending-approvals" }), res);
		expect(res.statusCode).toBe(200);
		expect((res.body as { approvals: unknown[] }).approvals).toHaveLength(1);

		const alerts = (otherSettings["workforce_alerts"] as { alerts: unknown[] }).alerts;
		const orphan = alerts.find((a: { id: string }) => a.id === "al-orphan") as {
			resolved_at: string | null;
			resolved_by: string;
		};
		expect(orphan.resolved_at).not.toBeNull();
		expect(orphan.resolved_by).toBe("system");
		const live = alerts.find((a: { id: string }) => a.id === "al-live") as {
			resolved_at: string | null;
		};
		expect(live.resolved_at).toBeNull(); // real decision stays visible
	});

	it("alerts list also reconciles orphans (Ops Center never shows a dead decision)", async () => {
		mockSettingsFallback();
		otherSettings["workforce_alerts"] = {
			alerts: [
				{
					id: "al-dead",
					key: "approval:nothing-here",
					severity: "high",
					title: "Approval required: nothing here",
					body: null,
					agent: null,
					evidence: null,
					occurrences: 1,
					acknowledged_at: null,
					acknowledged_by: null,
					resolved_at: null,
					resolved_by: null,
					created_at: new Date().toISOString(),
					last_at: new Date().toISOString(),
				},
			],
		};
		tasksStore.write({ tasks: [] });

		const res = response();
		await workforceHandler(req({ action: "alerts" }), res);
		const alerts = (otherSettings["workforce_alerts"] as { alerts: unknown[] }).alerts;
		const dead = alerts.find((a: { id: string }) => a.id === "al-dead") as {
			resolved_at: string | null;
		};
		expect(dead.resolved_at).not.toBeNull();
	});

	it("keeps an approval alert OPEN when its blocked task exists", async () => {
		mockSettingsFallback();
		otherSettings["workforce_alerts"] = {
			alerts: [
				{
					id: "al-real",
					key: "approval:src:live-1",
					severity: "high",
					title: "Approval required: hide reported post",
					body: null,
					agent: null,
					evidence: null,
					occurrences: 1,
					acknowledged_at: null,
					acknowledged_by: null,
					resolved_at: null,
					resolved_by: null,
					created_at: new Date().toISOString(),
					last_at: new Date().toISOString(),
				},
			],
		};
		tasksStore.write({ tasks: [task("live-1", "blocked")] });

		const res = response();
		await workforceHandler(req({ action: "pending-approvals" }), res);
		const alerts = (otherSettings["workforce_alerts"] as { alerts: unknown[] }).alerts;
		const real = alerts.find((a: { id: string }) => a.id === "al-real") as {
			resolved_at: string | null;
		};
		expect(real.resolved_at).toBeNull();
	});
});

describe("real-work patrols — storage hygiene + inactive-user sweep", () => {
	/** Full-table mock: settings fallback + the tables the new patrols touch
	 *  (system_metrics for pruning, users_meta + posts for the sweep). */
	function mockHygieneTables(overrides: {
		staleMetricIds?: string[];
		inactiveUsers?: Record<string, unknown>[];
		postAuthorIds?: string[];
	} = {}) {
		const deletedIds: string[] = [];
		mockSettingsFallback();
		const base = mocks.from.getMockImplementation();
		mocks.from.mockImplementation((table: string) => {
			if (table === "system_metrics") {
				return {
					select: vi.fn(() => ({
						lt: vi.fn(() => ({
							limit: async () => ({
								data: (overrides.staleMetricIds || []).map((id) => ({ id })),
								error: null,
							}),
						})),
					})),
					delete: vi.fn(() => ({
						in: vi.fn((_col: string, ids: string[]) => {
							deletedIds.push(...ids);
							return Promise.resolve({ error: null });
						}),
					})),
				};
			}
			if (table === "users_meta") {
				return {
					select: vi.fn(() => ({
						limit: async () => ({
							data: overrides.inactiveUsers || [],
							error: null,
						}),
					})),
				};
			}
			if (table === "posts") {
				return {
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							limit: async () => ({
								data: (overrides.postAuthorIds || []).map((author_id) => ({
									author_id,
								})),
								error: null,
							}),
						})),
					})),
				};
			}
			return base?.(table) ?? {
				select: vi.fn(() => ({ limit: async () => ({ data: [] }) })),
				update: vi.fn(async () => ({ error: null })),
				upsert: vi.fn(async () => ({ error: null })),
				insert: vi.fn(async () => ({ error: null })),
			};
		});
		return { deletedIds };
	}

	it("patrol prunes stale system_metrics older than the retention window", async () => {
		const { deletedIds } = mockHygieneTables({
			staleMetricIds: ["m-1", "m-2", "m-3"],
		});

		const res = response();
		await workforceHandler(req({ action: "patrol", limit: 0 }), res);
		expect(res.statusCode).toBe(200);
		const body = res.body as {
			hygiene: { metrics_pruned: number; error: string | null };
		};
		// The delete ran against the 3 stale ids → REAL storage savings
		expect(deletedIds.sort()).toEqual(["m-1", "m-2", "m-3"]);
		expect(body.hygiene.metrics_pruned).toBe(3);
	});

	it("patrol reports zero prune + no error when no stale metrics exist", async () => {
		mockHygieneTables({ staleMetricIds: [] });
		const res = response();
		await workforceHandler(req({ action: "patrol", limit: 0 }), res);
		const body = res.body as { hygiene: { metrics_pruned: number; error: string | null } };
		expect(body.hygiene.metrics_pruned).toBe(0);
		expect(body.hygiene.error).toBeNull();
	});

	it("hygiene table errors degrade gracefully — patrol still completes", async () => {
		mockSettingsFallback();
		const base = mocks.from.getMockImplementation();
		mocks.from.mockImplementation((table: string) => {
			if (table === "system_metrics") {
				// Simulate a missing/legacy table — select throws or errors
				return {
					select: vi.fn(() => ({
						lt: vi.fn(() => ({
							limit: async () => ({
								data: null,
								error: { message: "no such column: recorded_at" },
							}),
						})),
					})),
				};
			}
			return base?.(table) ?? {
				select: vi.fn(() => ({ limit: async () => ({ data: [] }) })),
				update: vi.fn(async () => ({ error: null })),
				upsert: vi.fn(async () => ({ error: null })),
				insert: vi.fn(async () => ({ error: null })),
			};
		});

		const res = response();
		await workforceHandler(req({ action: "patrol", limit: 0 }), res);
		expect(res.statusCode).toBe(200);
		const body = res.body as { hygiene: { metrics_pruned: number; error: string | null } };
		// The select error is discarded (data=null → no ids to prune) — the
		// patrol completes and reports an honest 0 with no throw.
		expect(body.hygiene.metrics_pruned).toBe(0);
		expect(body.hygiene.error).toBeNull();
		expect(body.ok).toBe(true);
	});

	it("inactive-user sweep pushes an audit task for a user with no content + stale last_seen", async () => {
		const stale = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
		mockHygieneTables({
			staleMetricIds: [],
			postAuthorIds: ["author-who-posts"], // the stale user has NO posts
			inactiveUsers: [
				{
					anon_id: "dormant-user-1",
					last_seen: stale,
					created_at: stale,
					banned: false,
					warnings: [],
					strikes: 0,
				},
			],
		});
		otherSettings["workforce_approval_history"] = { history: [] };
		otherSettings["workforce_findings"] = { findings: [] };
		otherSettings["workforce_config"] = {};

		const res = response();
		await workforceHandler(req({ action: "patrol", limit: 0 }), res);
		expect(res.statusCode).toBe(200);
		const stored = tasksStore.get() as { tasks: { source: string; title: string; required_capability: string }[] };
		const audit = stored.tasks.find((t) => t.source === "hygiene");
		expect(audit).toBeDefined();
		expect(audit?.title).toContain("Audit inactive user");
		expect(audit?.required_capability).toBe("storage_optimization");
	});

	it("inactive-user sweep skips users with active content or discipline records", async () => {
		const stale = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
		mockHygieneTables({
			staleMetricIds: [],
			postAuthorIds: ["has-posts", "has-warnings"],
			inactiveUsers: [
				{ anon_id: "has-posts", last_seen: stale, created_at: stale, banned: false, warnings: [], strikes: 0 },
				{ anon_id: "has-warnings", last_seen: stale, created_at: stale, banned: false, warnings: ["w1"], strikes: 0 },
				{ anon_id: "active-now", last_seen: new Date().toISOString(), created_at: stale, banned: false, warnings: [], strikes: 0 },
			],
		});

		const res = response();
		await workforceHandler(req({ action: "patrol", limit: 0 }), res);
		expect(res.statusCode).toBe(200);
		const stored = tasksStore.get() as { tasks: { source: string }[] };
		const audits = stored.tasks.filter((t) => t.source === "hygiene");
		// None of the three users qualifies → no audit tasks created
		expect(audits).toHaveLength(0);
	});
});
