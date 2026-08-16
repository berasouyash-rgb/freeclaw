// ═══════════════════════════════════════════════════════════════════
// Workforce — Impact Center + Approval Center
// ═══════════════════════════════════════════════════════════════════
// Locks the POST /api/workforce contract:
//   1. impact — aggregates ONLY DB-verified outcomes into real platform
//      impact (posts hidden, reports resolved, etc.) with evidence rows.
//      Unverified outcomes never count. Failed verifications are tracked.
//   2. approve-task — unblocks a high-risk (BLOCKED) task → queued.
//   3. reject-task — cancels a blocked task with a recorded reason.
//      Only blocked tasks are eligible; others are rejected with 4xx.

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
// Deterministic provider gate: the real hasUsableLLM reads env keys at
// MODULE LOAD time (NIM chain captures keys once), which is environment-
// dependent. Mocking the gate lets us assert the WIRING: when the provider
// layer reports degraded, the overview must say so (Phase 43).
const { hasUsableLLM: mockHasUsableLLM } = vi.hoisted(() => ({
	hasUsableLLM: vi.fn(async () => false),
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

/** A settings-row store where the workforce falls back to the settings
 *  table when the modern agent_tasks schema is missing. */
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

function req(method: string, body: unknown) {
	return {
		method,
		headers: { "x-admin-token": "test" },
		body: method === "POST" ? body : undefined,
		query: method === "GET" ? body : {},
		socket: { remoteAddress: "127.0.0.1" },
	};
}

let tasksStore: ReturnType<typeof settingsStore>;

// Key-aware settings mock: the tasks live under 'agent_tasks_store'; other
// settings keys (workforce_config, approval ledger, sessions, ...) are kept
// in their own store so writes never corrupt the tasks array.
let otherSettings: Record<string, unknown>;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.from.mockReset();
	tasksStore = settingsStore({ tasks: [] });
	otherSettings = {};
});

function mockStoreTables() {
	// hasTasksTable(): probe select('title').limit(1) → error ⇒ settings fallback
	mocks.from.mockImplementation((table: string) => {
		if (table === "agent_tasks") {
			return {
				select: vi.fn(() => ({
					limit: vi.fn(() =>
						Promise.resolve({ data: null, error: new Error("no table") }),
					),
				})),
			};
		}
		if (table === "settings") {
			return {
				select: vi.fn(() => ({
					eq: vi.fn((_col: string, key: string) => ({
						maybeSingle: vi.fn(async () => ({
							data:
								key === "agent_tasks_store"
									? { value: tasksStore.get() }
									: otherSettings[key] === undefined
										? null
										: { value: otherSettings[key] },
							error: null,
						})),
					})),
				})),
				upsert: vi.fn((row: { key: string; value: unknown }) => {
					if (row.key === "agent_tasks_store") tasksStore.write(row.value);
					else otherSettings[row.key] = row.value;
					return Promise.resolve({ error: null });
				}),
			};
		}
		if (table === "agent_executions") {
			return {
				select: vi.fn(() => ({
					limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
				})),
				update: vi.fn(),
			};
		}
		return {
			select: vi.fn(() => ({
				limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
			})),
			update: vi.fn(),
			insert: vi.fn(),
			upsert: vi.fn(),
		};
	});
}

/** A completed task with real verified outcomes (simulating runtime output). */
function completedTask(_overrides: Record<string, unknown> = {}) {
	return {
		id: "task-1",
		title: "Moderate reported post",
		source: "report",
		priority: "high",
		status: "completed",
		assigned_agent: "content-moderator",
		parent_task_id: null,
		risk_level: "low",
		attempts: 1,
		verification_status: "passed",
		error: null,
		outcomes: [
			{
				type: "hide_post",
				target_id: "post_1",
				count: null,
				status: null,
				verified: true,
				evidence: "posts.hidden=true (post_1)",
				at: "2026-08-09T10:00:00Z",
			},
			{
				type: "resolve_reports",
				target_id: null,
				count: 3,
				status: "auto_resolved",
				verified: true,
				evidence: "3/3 reports → auto_resolved",
				at: "2026-08-09T10:00:01Z",
			},
			{
				type: "set_priority",
				target_id: "post_2",
				count: null,
				status: null,
				verified: true,
				evidence: "posts.priority=high (post_2)",
				at: "2026-08-09T10:00:02Z",
			},
			{
				type: "hide_post",
				target_id: "post_9",
				count: null,
				status: null,
				verified: false,
				evidence: "posts.hidden≠true (post_9)",
				at: "2026-08-09T10:00:03Z",
			}, // unverified — never counts
		],
		timeline: [],
		impact: {
			measurable: true,
			summary: "1 post(s) hidden, 3 report(s) resolved",
			stats: {},
			verified_actions: 3,
		},
		created_at: "2026-08-09T09:59:00Z",
		completed_at: "2026-08-09T10:00:03Z",
	};
}

describe("workforce impact center", () => {
	it("aggregates ONLY verified outcomes into real impact with evidence", async () => {
		tasksStore.write({ tasks: [completedTask()] });
		mockStoreTables();
		const res = response();
		await workforceHandler(req("POST", { action: "impact" }), res);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			impact: {
				posts_hidden: number;
				reports_resolved: number;
				posts_escalated: number;
				verified_actions: number;
				failed_verifications: number;
			};
			evidence: { type: string; target_id: string | null; evidence: string }[];
		};
		expect(body.impact.posts_hidden).toBe(1); // post_1 verified; post_9 unverified NOT counted
		expect(body.impact.reports_resolved).toBe(3); // count honored
		expect(body.impact.posts_escalated).toBe(1);
		expect(body.impact.verified_actions).toBe(3); // 3 verified of 4 claimed
		expect(body.impact.failed_verifications).toBe(0);
		expect(body.evidence.length).toBe(3);
		expect(body.evidence.every((e) => e.evidence.length > 0)).toBe(true);
	});

	it("computes verification rate from tasks that reached verification (never >100)", async () => {
		tasksStore.write({
			tasks: [
				completedTask(), // verified: passed
				{
					...completedTask(),
					id: "task-2",
					verification_status: "failed",
					outcomes: [
						{
							type: "hide_post",
							target_id: "post_5",
							count: null,
							status: null,
							verified: false,
							evidence: "posts.hidden≠true (post_5)",
							at: "2026-08-09T11:00:00Z",
						},
					],
				},
				{
					...completedTask(),
					id: "task-3",
					verification_status: "none",
					outcomes: [],
				},
			],
		});
		mockStoreTables();
		const res = response();
		await workforceHandler(req("POST", { action: "impact" }), res);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			verification_rate: number | null;
			tasks_reached_verification: number;
			tasks_verified: number;
		};
		expect(body.tasks_reached_verification).toBe(2); // passed + failed reach verification; 'none' does not
		expect(body.tasks_verified).toBe(1);
		expect(body.verification_rate).toBe(50); // 1/2 — clamped, meaningful
	});

	it("overview success_rate counts only DB-verified tasks (unverified done ≠ success)", async () => {
		tasksStore.write({
			tasks: [
				{ ...completedTask(), id: "t-verified", verification_status: "passed" }, // verified → success
				{
					...completedTask(),
					id: "t-done-no-verify",
					verification_status: "none",
				}, // completed but NEVER verified → NOT success
				{
					...completedTask(),
					id: "t-failed-verify",
					verification_status: "failed",
				}, // reached verification, failed
			],
		});
		mockStoreTables();
		const res = response();
		await workforceHandler(req("GET", { action: "overview" }), res);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			metrics: { success_rate: number | null; verified_outcomes: number };
			task_queue: { total: number };
		};
		expect(body.task_queue.total).toBe(3);
		expect(body.metrics.verified_outcomes).toBe(9); // 3 DB-verified outcomes × 3 tasks (outcome truth is per-outcome)
		expect(body.metrics.success_rate).toBe(50); // 1 verified ÷ 2 reached verification — 'none' does not reach
	});

	it("overview surfaces the honest ai_provider status (degraded when no key)", async () => {
		tasksStore.write({ tasks: [] });
		mockStoreTables();
		// Provider gate reports degraded (deterministic mock, see top of file).
		mockHasUsableLLM.mockResolvedValue(false);
		const res = response();
		await workforceHandler(req("GET", { action: "overview" }), res);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			ai_provider?: { ok: boolean; status: string; note: string };
		};
		expect(body.ai_provider).toBeDefined();
		expect(body.ai_provider!.ok).toBe(false);
		expect(body.ai_provider!.status).toBe("degraded");
		expect(body.ai_provider!.note).toContain("AI PROVIDER DEGRADED");
	});

	it("overview success_rate ignores blocked/rejected tasks (never ran verification)", async () => {
		tasksStore.write({
			tasks: [
				{ ...completedTask(), id: "t-verified", verification_status: "passed" }, // success
				{
					...completedTask(),
					id: "t-blocked",
					verification_status: "awaiting_approval",
				}, // blocked — never verified
				{
					...completedTask(),
					id: "t-rejected",
					verification_status: "rejected",
				}, // admin rejected — never verified
			],
		});
		mockStoreTables();
		const res = response();
		await workforceHandler(req("GET", { action: "overview" }), res);

		expect(res.statusCode).toBe(200);
		const body = res.body as { metrics: { success_rate: number | null } };
		// Only t-verified reached verification → 1/1 = 100%. Blocked + rejected
		// must NOT deflate the rate to 33%.
		expect(body.metrics.success_rate).toBe(100);
	});

	it("reports zero impact truthfully when no verified outcomes exist", async () => {
		tasksStore.write({
			tasks: [
				{
					...completedTask(),
					id: "task-empty",
					outcomes: [
						{
							type: "hide_post",
							target_id: "post_x",
							count: null,
							status: null,
							verified: false,
							evidence: "posts.hidden≠true (post_x)",
							at: "2026-08-09T10:00:00Z",
						},
					],
					verification_status: "failed",
				},
			],
		});
		mockStoreTables();
		const res = response();
		await workforceHandler(req("POST", { action: "impact" }), res);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			impact: { verified_actions: number; failed_verifications: number };
			executions: { total: number };
		};
		expect(body.impact.verified_actions).toBe(0); // nothing verified → zero impact, never invented
		expect(body.impact.failed_verifications).toBe(1);
	});
});

describe("workforce approval center", () => {
	it("pending-approvals lists blocked tasks with the WHY (description/input), never truncated", async () => {
		tasksStore.write({
			tasks: [
				{
					id: "task-blocked",
					title: "Ban abusive user",
					description: "User posted spam across 40 posts. Ban per policy P-12.",
					source: "security",
					priority: "critical",
					status: "blocked",
					assigned_agent: null,
					parent_task_id: null,
					risk_level: "high",
					attempts: 0,
					verification_status: "awaiting_approval",
					error: null,
					outcomes: null,
					timeline: null,
					impact: null,
					input: { anon_id: "anon_abuse" },
					created_by: "security-monitor",
					created_at: "2026-08-09T09:00:00Z",
					completed_at: null,
				},
			],
		});
		mockStoreTables();
		const res = response();
		await workforceHandler(req("POST", { action: "pending-approvals" }), res);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			approvals: {
				id: string;
				description: string | null;
				input: unknown;
				risk_level: string;
			}[];
		};
		expect(body.approvals.length).toBe(1);
		expect(body.approvals[0].id).toBe("task-blocked");
		expect(body.approvals[0].description).toContain("policy P-12"); // the WHY is available to the admin
		expect(body.approvals[0].input).toEqual({ anon_id: "anon_abuse" });
		expect(body.approvals[0].risk_level).toBe("high");
	});

	it("approve-task queues a blocked high-risk task for execution", async () => {
		tasksStore.write({
			tasks: [
				{
					id: "task-blocked",
					title: "Ban abusive user",
					source: "security",
					priority: "critical",
					status: "blocked",
					assigned_agent: null,
					parent_task_id: null,
					risk_level: "high",
					attempts: 0,
					verification_status: "awaiting_approval",
					error: null,
					outcomes: null,
					timeline: null,
					impact: null,
					created_at: "2026-08-09T09:00:00Z",
					completed_at: null,
				},
			],
		});
		mockStoreTables();
		const res = response();
		await workforceHandler(
			req("POST", { action: "approve-task", id: "task-blocked" }),
			res,
		);

		expect(res.statusCode).toBe(200);
		expect((res.body as { ok: boolean }).ok).toBe(true);
		const stored = tasksStore.get() as {
			tasks: { id: string; status: string }[];
		};
		expect(stored.tasks[0].status).toBe("queued"); // approved → queued for real execution
	});

	it("reject-task cancels a blocked task with a recorded reason", async () => {
		tasksStore.write({
			tasks: [
				{
					id: "task-blocked",
					title: "Mass restrict users",
					source: "security",
					priority: "high",
					status: "blocked",
					assigned_agent: null,
					parent_task_id: null,
					risk_level: "critical",
					attempts: 0,
					verification_status: "awaiting_approval",
					error: null,
					outcomes: null,
					timeline: null,
					impact: null,
					created_at: "2026-08-09T09:00:00Z",
					completed_at: null,
				},
			],
		});
		mockStoreTables();
		const res = response();
		await workforceHandler(
			req("POST", {
				action: "reject-task",
				id: "task-blocked",
				reason: "Too broad — manual review needed",
			}),
			res,
		);

		expect(res.statusCode).toBe(200);
		expect((res.body as { ok: boolean }).ok).toBe(true);
		const stored = tasksStore.get() as {
			tasks: {
				id: string;
				status: string;
				error: string;
				verification_status: string;
			}[];
		};
		expect(stored.tasks[0].status).toBe("cancelled");
		expect(stored.tasks[0].verification_status).toBe("rejected");
		expect(stored.tasks[0].error).toContain("manual review");
	});

	it("activity returns the real runtime activity log (single source of truth)", async () => {
		// Seed a non-empty log so the mapping is actually exercised
		const activityRows = [
			{
				agent_id: "security-monitor",
				action: "task_completed",
				severity: "info",
				details: { task_id: "t1" },
				created_at: "2026-08-09T10:00:00Z",
			},
			{
				agent_id: "report-handler",
				action: "task_failed",
				severity: "error",
				details: null,
				created_at: "2026-08-09T10:00:01Z",
			},
			// Legacy row missing severity — must fall back to 'info'
			{
				agent_id: "content-moderator",
				action: "task_claimed",
				details: { title: "Moderate post" },
				created_at: "2026-08-09T10:00:02Z",
			},
		];
		const { getRecentActivity } = await import("../../api/agents/_runner.js");
		vi.mocked(getRecentActivity).mockResolvedValue(activityRows as never);

		mocks.from.mockImplementation((table: string) => {
			if (table === "agent_tasks") {
				return {
					select: vi.fn(() => ({
						limit: vi.fn(() =>
							Promise.resolve({ data: null, error: new Error("no table") }),
						),
					})),
				};
			}
			return {
				select: vi.fn(() => ({
					limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
				})),
				update: vi.fn(),
				insert: vi.fn(),
				upsert: vi.fn(),
			};
		});
		const res = response();
		await workforceHandler(req("POST", { action: "activity" }), res);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			ok: boolean;
			activity: {
				agent_id: string;
				action: string;
				severity: string;
				details: unknown;
				created_at: string;
			}[];
		};
		expect(body.ok).toBe(true);
		expect(body.activity).toHaveLength(3);
		expect(body.activity[0]).toMatchObject({
			agent_id: "security-monitor",
			action: "task_completed",
			severity: "info",
		});
		expect(body.activity[1].severity).toBe("error");
		// Legacy row without severity → 'info' fallback
		expect(body.activity[2]).toMatchObject({
			agent_id: "content-moderator",
			action: "task_claimed",
			severity: "info",
			details: { title: "Moderate post" },
		});
	});

	it("approve-task records the decision in the approval ledger", async () => {
		tasksStore.write({
			tasks: [
				{
					id: "task-blocked",
					title: "Ban abusive user",
					source: "security",
					priority: "critical",
					status: "blocked",
					assigned_agent: null,
					parent_task_id: null,
					risk_level: "high",
					attempts: 0,
					verification_status: "awaiting_approval",
					error: null,
					outcomes: null,
					timeline: null,
					impact: null,
					created_at: "2026-08-09T09:00:00Z",
					completed_at: null,
				},
			],
		});
		mockStoreTables();
		const res = response();
		await workforceHandler(
			req("POST", { action: "approve-task", id: "task-blocked" }),
			res,
		);
		expect((res.body as { ok: boolean }).ok).toBe(true);

		const histRes = response();
		await workforceHandler(
			req("POST", { action: "approval-history" }),
			histRes,
		);
		const history = (
			histRes.body as {
				history: { task_id: string; decision: string; risk_level: string }[];
			}
		).history;
		expect(history.length).toBe(1);
		expect(history[0]).toMatchObject({
			task_id: "task-blocked",
			decision: "approved",
			risk_level: "high",
		});
	});

	it("refuses to approve a task that is not blocked", async () => {
		tasksStore.write({
			tasks: [{ ...completedTask(), id: "task-running", status: "working" }],
		});
		mockStoreTables();
		const res = response();
		await workforceHandler(
			req("POST", { action: "approve-task", id: "task-running" }),
			res,
		);

		expect(res.statusCode).toBe(200); // command returns ok:false, not an HTTP error
		expect((res.body as { ok: boolean; error: string }).ok).toBe(false);
		expect((res.body as { error: string }).error).toMatch(/Only blocked/);
	});
});

describe("workforce admin alerts (severity + grouping + acknowledge)", () => {
	it("raise-alert creates an alert; repeated identical raises group into ONE alert and escalate severity", async () => {
		tasksStore.write({ tasks: [] });
		mockStoreTables();
		// Two identical signals → one grouped alert, occurrences=2, medium→high
		for (let i = 0; i < 2; i++) {
			const res = response();
			await workforceHandler(
				req("POST", {
					action: "raise-alert",
					severity: "medium",
					title: "Repeated login failures",
					key: "login-failures",
					agent: "security-monitor",
					evidence: "7 failed attempts",
				}),
				res,
			);
			expect((res.body as { ok: boolean }).ok).toBe(true);
		}
		const res = response();
		await workforceHandler(req("GET", { action: "alerts" }), res);
		const body = res.body as {
			open: number;
			alerts: {
				title: string;
				occurrences: number;
				severity: string;
				agent: string;
			}[];
		};
		expect(body.open).toBe(1); // grouped — never 40 alerts for 40 signals
		expect(body.alerts[0].occurrences).toBe(2);
		expect(body.alerts[0].severity).toBe("high"); // repeated occurrence escalated
		expect(body.alerts[0].agent).toBe("security-monitor");
	});

	it("acknowledge-alert removes it from the open set and records the acknowledgment", async () => {
		tasksStore.write({ tasks: [] });
		mockStoreTables();
		const raise = response();
		await workforceHandler(
			req("POST", {
				action: "raise-alert",
				severity: "critical",
				title: "Critical security event",
				key: "sec-1",
			}),
			raise,
		);
		const id = (raise.body as { alert: { id: string } }).alert.id;

		const ack = response();
		await workforceHandler(
			req("POST", { action: "acknowledge-alert", id }),
			ack,
		);
		expect((ack.body as { ok: boolean }).ok).toBe(true);

		const res = response();
		await workforceHandler(req("GET", { action: "alerts" }), res);
		const body = res.body as {
			open: number;
			acknowledged_open: number;
			resolved: number;
			alerts: { acknowledged_at: string | null; resolved_at: string | null }[];
		};
		expect(body.open).toBe(0);
		expect(body.acknowledged_open).toBe(1); // seen but NOT fixed
		expect(body.resolved).toBe(0);
		expect(body.alerts[0].acknowledged_at).toBeTruthy();
		expect(body.alerts[0].resolved_at).toBeNull(); // acknowledged ≠ resolved
	});

	it("an acknowledged-but-still-open alert keeps grouping on recurrence (seen ≠ handled)", async () => {
		tasksStore.write({ tasks: [] });
		mockStoreTables();
		const raise = response();
		await workforceHandler(
			req("POST", {
				action: "raise-alert",
				severity: "high",
				title: "API latency spike",
				key: "latency-1",
			}),
			raise,
		);
		const id = (raise.body as { alert: { id: string } }).alert.id;

		await workforceHandler(
			req("POST", { action: "acknowledge-alert", id }),
			response(),
		);

		// The issue recurs while the alert is only acknowledged → still ONE alert,
		// occurrence bumps — not a flood of new alerts.
		await workforceHandler(
			req("POST", {
				action: "raise-alert",
				severity: "high",
				title: "API latency spike",
				key: "latency-1",
			}),
			response(),
		);

		const res = response();
		await workforceHandler(req("GET", { action: "alerts" }), res);
		const body = res.body as {
			open: number;
			acknowledged_open: number;
			alerts: { occurrences: number; acknowledged_at: string | null }[];
		};
		expect(body.open).toBe(0);
		expect(body.acknowledged_open).toBe(1);
		expect(body.alerts.length).toBe(1);
		expect(body.alerts[0].occurrences).toBe(2); // grouped, still acknowledged
	});

	it("approve-task auto-resolves the matching approval alert (resolved_at + resolved_by, no ack needed)", async () => {
		tasksStore.write({
			tasks: [
				{
					id: "task-blocked",
					title: "Ban abusive user",
					source: "security",
					priority: "critical",
					status: "blocked",
					assigned_agent: null,
					parent_task_id: null,
					risk_level: "high",
					attempts: 0,
					verification_status: "awaiting_approval",
					error: null,
					outcomes: null,
					timeline: null,
					impact: null,
					created_at: "2026-08-09T09:00:00Z",
					completed_at: null,
				},
			],
		});
		mockStoreTables();
		// Raise an alert with the key the approve hook resolves ('approval:<title>')
		const raise = response();
		await workforceHandler(
			req("POST", {
				action: "raise-alert",
				severity: "high",
				title: "Approval required: Ban abusive user",
				key: "approval:Ban abusive user",
			}),
			raise,
		);
		expect((raise.body as { ok: boolean }).ok).toBe(true);

		// Approve the task — this should auto-resolve the matching alert
		const approve = response();
		await workforceHandler(
			req("POST", { action: "approve-task", id: "task-blocked" }),
			approve,
		);
		expect((approve.body as { ok: boolean }).ok).toBe(true);

		// Verify the alert is RESOLVED (issue fixed) — not merely acknowledged
		const alerts = response();
		await workforceHandler(req("GET", { action: "alerts" }), alerts);
		const body = alerts.body as {
			open: number;
			acknowledged_open: number;
			resolved: number;
			alerts: {
				acknowledged_at: string | null;
				resolved_at: string | null;
				resolved_by: string | null;
			}[];
		};
		expect(body.open).toBe(0);
		expect(body.resolved).toBe(1);
		expect(body.alerts[0].resolved_at).toBeTruthy();
		expect(body.alerts[0].resolved_by).toBe("system");
		// Resolution must NOT imply the admin ever looked at it
		expect(body.alerts[0].acknowledged_at).toBeNull();
	});

	it("a RESOLVED alert starts fresh on recurrence (new alert, occurrences reset)", async () => {
		tasksStore.write({
			tasks: [
				{
					id: "task-blocked",
					title: "Ban abusive user",
					source: "security",
					priority: "critical",
					status: "blocked",
					assigned_agent: null,
					parent_task_id: null,
					risk_level: "high",
					attempts: 0,
					verification_status: "awaiting_approval",
					error: null,
					outcomes: null,
					timeline: null,
					impact: null,
					created_at: "2026-08-09T09:00:00Z",
					completed_at: null,
				},
			],
		});
		mockStoreTables();

		// First occurrence → alert raised, then the approval resolves it
		const r1 = response();
		await workforceHandler(
			req("POST", {
				action: "raise-alert",
				severity: "high",
				title: "Approval required: Ban abusive user",
				key: "approval:Ban abusive user",
			}),
			r1,
		);
		await workforceHandler(
			req("POST", { action: "approve-task", id: "task-blocked" }),
			response(),
		);

		// The issue recurs AFTER resolution → a FRESH alert, not a bump of the old one
		const r2 = response();
		await workforceHandler(
			req("POST", {
				action: "raise-alert",
				severity: "high",
				title: "Approval required: Ban abusive user",
				key: "approval:Ban abusive user",
			}),
			r2,
		);
		const first = (r1.body as { alert: { id: string } }).alert.id;
		const second = (r2.body as { alert: { id: string } }).alert.id;
		expect(second).not.toBe(first);

		const res = response();
		await workforceHandler(req("GET", { action: "alerts" }), res);
		const body = res.body as {
			open: number;
			resolved: number;
			alerts: { id: string; occurrences: number; resolved_at: string | null }[];
		};
		expect(body.open).toBe(1); // the fresh recurrence
		expect(body.resolved).toBe(1); // the previously-fixed one stays resolved
		const fresh = body.alerts.find((a) => a.id === second);
		expect(fresh).toBeTruthy();
		expect(fresh!.occurrences).toBe(1);
		expect(fresh!.resolved_at).toBeNull();
	});
});

describe("approved decision execution (approve → real hide → DB-verified impact)", () => {
	/** Full chain mock: blocked task with decision:'hide' + posts/reports
	 *  tables that reflect a REAL hide when update runs, so verification
	 *  genuinely re-reads changed state (the acceptance-test contract). */
	function mockApprovedExecution() {
		const posts: Record<string, { hidden: boolean; deleted: boolean }> = {
			post_99: { hidden: false, deleted: false },
		};
		const reports: Record<string, { status: string | null }> = {
			r1: { status: "pending" },
			r2: { status: null },
		};
		mocks.from.mockImplementation((table: string) => {
			if (table === "agent_tasks") {
				return {
					select: vi.fn(() => ({
						limit: vi.fn(() =>
							Promise.resolve({ data: null, error: new Error("no table") }),
						),
					})),
				};
			}
			if (table === "settings") {
				return {
					select: vi.fn(() => ({
						eq: vi.fn((_col: string, key: string) => ({
							maybeSingle: vi.fn(async () => ({
								data:
									key === "agent_tasks_store"
										? { value: tasksStore.get() }
										: otherSettings[key] === undefined
											? null
											: { value: otherSettings[key] },
								error: null,
							})),
						})),
					})),
					upsert: vi.fn((row: { key: string; value: unknown }) => {
						if (row.key === "agent_tasks_store") tasksStore.write(row.value);
						else otherSettings[row.key] = row.value;
						return Promise.resolve({ error: null });
					}),
				};
			}
			if (table === "posts") {
				return {
					select: vi.fn(() => ({
						eq: vi.fn((col: string, v: string) => {
							if (col === "id")
								return {
									maybeSingle: async () => ({ data: posts[v], error: null }),
								};
							return {
								limit: async () => ({
									data: Object.values(posts),
									error: null,
								}),
							};
						}),
					})),
					update: vi.fn((patch: { hidden: boolean }) => ({
						eq: vi.fn((_c: string, id: string) => {
							if (posts[id]) posts[id].hidden = patch.hidden;
							return Promise.resolve({ data: null, error: null });
						}),
					})),
				};
			}
			if (table === "reports") {
				const rows = () =>
					Object.entries(reports).map(([id, s]) => ({ id, status: s.status }));
				return {
					// applyApprovedDecision awaits .in() directly; the resolve verifier
					// chains .in().limit() — support both.
					select: vi.fn(() => ({
						in: vi.fn(() =>
							Object.assign(Promise.resolve({ data: rows(), error: null }), {
								limit: async () => ({ data: rows(), error: null }),
							}),
						),
					})),
					update: vi.fn((patch: { status: string }) => ({
						in: vi.fn((_c: string, ids: string[]) => {
							ids.forEach((id) => {
								if (reports[id]) reports[id].status = patch.status;
							});
							return Promise.resolve({ data: null, error: null });
						}),
					})),
				};
			}
			if (table === "agent_executions") {
				return {
					select: vi.fn(() => ({
						limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
					})),
					update: vi.fn(),
				};
			}
			return {
				select: vi.fn(() => ({
					limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
				})),
				update: vi.fn(),
				insert: vi.fn(),
				upsert: vi.fn(),
			};
		});
		return { posts, reports };
	}

	it("approving a decision task executes the real hide + report resolution, verified + impacted", async () => {
		tasksStore.write({
			tasks: [
				{
					id: "task-hide-99",
					title: "Approval required: hide reported post post_99",
					description:
						"2 users reported this post. High-risk moderation decision.",
					source: "report",
					source_ref: "coordinated:post_99",
					priority: "critical",
					status: "blocked",
					assigned_agent: null,
					parent_task_id: null,
					risk_level: "high",
					attempts: 0,
					verification_status: "awaiting_approval",
					error: null,
					outcomes: null,
					timeline: null,
					impact: null,
					input: {
						decision: "hide",
						target_type: "post",
						target_id: "post_99",
						report_ids: ["r1", "r2"],
						escalated_by: "discovery",
					},
					created_by: "discovery",
					created_at: "2026-08-09T09:00:00Z",
					completed_at: null,
				},
			],
		});
		const { posts, reports } = mockApprovedExecution();

		// 1. Approve → queued
		const res = response();
		await workforceHandler(
			req("POST", { action: "approve-task", id: "task-hide-99" }),
			res,
		);
		expect((res.body as { ok: boolean }).ok).toBe(true);

		// 2. Directly invoke the sanctioned execution (what runClaimed calls on
		//    the next patrol after the agent's investigation) and verify it
		//    mutates the DB + resolves reports.
		const wf = await import("../../api/_workforce.js");
		const task = (
			tasksStore.get() as { tasks: Record<string, unknown>[] }
		).tasks.find((t) => t.id === "task-hide-99") as {
			input: { decision: string; target_id: string; report_ids: string[] };
			risk_level: string;
		};
		const actions = await (
			wf as unknown as {
				applyApprovedDecision: (t: unknown) => Promise<unknown[]>;
			}
		).applyApprovedDecision(task);
		expect(actions.length).toBe(2); // hide_post + resolve_reports

		// 3. Independent verification re-reads the DB — hidden + reports resolved
		const outcomes = await (
			wf as unknown as { verifyOutcomes: (a: unknown[]) => Promise<unknown[]> }
		).verifyOutcomes(actions);
		const verified = outcomes.filter(
			(o) => (o as { verified: boolean }).verified,
		);
		expect(verified.length).toBe(2); // both claims confirmed against real state
		expect(posts.post_99.hidden).toBe(true); // REAL change happened
		expect(reports.r1.status).toBe("resolved");
		expect(reports.r2.status).toBe("resolved");

		// 4. Impact measures ONLY the verified changes
		const impact = await (
			wf as unknown as {
				measureImpact: (o: unknown[]) => {
					measurable: boolean;
					summary: string;
				};
			}
		).measureImpact(outcomes);
		expect(impact.measurable).toBe(true);
		expect(impact.summary).toContain("post(s) hidden");
		expect(impact.summary).toContain("report(s) resolved");
	});
});

describe("workforce report/post escalation (Reports → Approval bridge)", () => {
	/** Escalation reads real rows from the reports/posts tables, then creates
	 *  a HIGH-risk task that lands BLOCKED in the Approval Center. */
	function mockEscalationTables(reportRow: unknown, postRow: unknown) {
		mocks.from.mockImplementation((table: string) => {
			if (table === "agent_tasks") {
				return {
					select: vi.fn(() => ({
						limit: vi.fn(() =>
							Promise.resolve({ data: null, error: new Error("no table") }),
						),
					})),
				};
			}
			if (table === "settings") {
				return {
					select: vi.fn(() => ({
						eq: vi.fn(() => ({ maybeSingle: tasksStore.read })),
					})),
					upsert: vi.fn((row: { value: unknown }) => {
						tasksStore.write(row.value);
						return Promise.resolve({ error: null });
					}),
				};
			}
			if (table === "reports") {
				return {
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							maybeSingle: vi.fn(async () => ({
								data: reportRow,
								error: null,
							})),
						})),
					})),
				};
			}
			if (table === "posts") {
				return {
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							maybeSingle: vi.fn(async () => ({ data: postRow, error: null })),
						})),
					})),
				};
			}
			return {
				select: vi.fn(() => ({
					limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
				})),
				update: vi.fn(),
				insert: vi.fn(),
				upsert: vi.fn(),
			};
		});
	}

	it("escalate-report creates a BLOCKED high-risk approval task with the report WHY", async () => {
		tasksStore.write({ tasks: [] });
		mockEscalationTables(
			{
				id: 42,
				target_id: "post_42",
				target_type: "post",
				reason: "Coordinated harassment",
			},
			{ id: "post_42", title: "Offending post title" },
		);
		const res = response();
		await workforceHandler(
			req("POST", { action: "escalate-report", id: "42" }),
			res,
		);

		expect(res.statusCode).toBe(200);
		const body = res.body as { ok: boolean; task_id: string; title: string };
		expect(body.ok).toBe(true);
		expect(body.task_id).toBeTruthy();
		expect(body.title).toContain("Offending post title");

		const stored = tasksStore.get() as { tasks: Record<string, unknown>[] };
		expect(stored.tasks.length).toBe(1);
		const task = stored.tasks[0] as {
			status: string;
			risk_level: string;
			verification_status: string;
			input: {
				report_id: number;
				escalated_by: string;
				decision: string;
				report_ids: unknown[];
			};
		};
		expect(task.status).toBe("blocked"); // NEVER auto-executes
		expect(task.risk_level).toBe("high");
		expect(task.verification_status).toBe("awaiting_approval");
		expect(String(task.input.report_id)).toBe("42"); // body.id arrives as a string
		expect(task.input.escalated_by).toBe("admin");
		// The sanctioned action is encoded — approving this task really hides
		// the reported post and resolves the report (applyApprovedDecision).
		expect(task.input.decision).toBe("hide");
		expect(task.input.report_ids).toEqual(["42"]);
	});

	it("escalate-report refuses a second escalation of the same report (dedupe)", async () => {
		tasksStore.write({
			tasks: [
				{
					id: "task-existing",
					title: "Approval required: report on Offending",
					source: "report",
					source_ref: "escalated:42",
					priority: "high",
					status: "blocked",
					assigned_agent: null,
					parent_task_id: null,
					risk_level: "high",
					attempts: 0,
					verification_status: "awaiting_approval",
					error: null,
					outcomes: null,
					timeline: null,
					impact: null,
					created_at: "2026-08-09T09:00:00Z",
					completed_at: null,
				},
			],
		});
		mockEscalationTables(
			{
				id: 42,
				target_id: "post_42",
				target_type: "post",
				reason: "Harassment",
			},
			{ id: "post_42", title: "Offending post title" },
		);
		const res = response();
		await workforceHandler(
			req("POST", { action: "escalate-report", id: "42" }),
			res,
		);

		const body = res.body as { ok: boolean; error?: string };
		expect(body.ok).toBe(false);
		expect(body.error).toMatch(/Already escalated/);
		const stored = tasksStore.get() as { tasks: unknown[] };
		expect(stored.tasks.length).toBe(1); // no duplicate approval task
	});

	it("escalate-post creates a BLOCKED moderation approval task for a flagged post", async () => {
		tasksStore.write({ tasks: [] });
		mockEscalationTables(null, {
			id: "post_y",
			title: "Flagged title",
			status: "flagged",
			hidden: false,
		});
		const res = response();
		await workforceHandler(
			req("POST", { action: "escalate-post", id: "post_y" }),
			res,
		);

		expect(res.statusCode).toBe(200);
		const body = res.body as { ok: boolean; task_id: string };
		expect(body.ok).toBe(true);

		const stored = tasksStore.get() as { tasks: Record<string, unknown>[] };
		const task = stored.tasks[0] as {
			status: string;
			risk_level: string;
			source: string;
			input: {
				post_id: string;
				status: string;
				decision: string;
				target_id: string;
			};
		};
		expect(task.status).toBe("blocked");
		expect(task.risk_level).toBe("high");
		expect(task.source).toBe("moderation");
		expect(task.input.post_id).toBe("post_y");
		expect(task.input.status).toBe("flagged");
		// Sanctioned action encoded — approving hides post_y for real.
		expect(task.input.decision).toBe("hide");
		expect(task.input.target_id).toBe("post_y");
	});

	it("coordinated report discovery (2+ reports on one target) creates a BLOCKED approval task", async () => {
		tasksStore.write({ tasks: [] });
		// Key-aware settings store: patrol also writes workforce_config; only
		// the agent_tasks_store key may touch the tasks array.
		const config: Record<string, unknown> = {};
		const settingsRead = async (key: string) => ({
			data:
				key === "agent_tasks_store"
					? { value: tasksStore.get() }
					: config[key] === undefined
						? null
						: { value: config[key] },
			error: null,
		});
		mocks.from.mockImplementation((table: string) => {
			if (table === "agent_tasks") {
				return {
					select: vi.fn(() => ({
						limit: vi.fn(() =>
							Promise.resolve({ data: null, error: new Error("no table") }),
						),
					})),
				};
			}
			if (table === "settings") {
				return {
					select: vi.fn(() => ({
						eq: vi.fn((_col: string, key: string) => ({
							maybeSingle: vi.fn(() => settingsRead(key)),
						})),
					})),
					upsert: vi.fn((row: { key: string; value: unknown }) => {
						if (row.key === "agent_tasks_store") tasksStore.write(row.value);
						else config[row.key] = row.value;
						return Promise.resolve({ error: null });
					}),
				};
			}
			if (table === "reports") {
				const chain = {
					or: vi.fn(() => ({
						limit: vi.fn(async () => ({
							data: [
								{
									id: 1,
									reason: "Spam",
									target_type: "post",
									target_id: "post_dup",
									created_at: "2026-08-09T09:00:00Z",
								},
								{
									id: 2,
									reason: "Harassment",
									target_type: "post",
									target_id: "post_dup",
									created_at: "2026-08-09T09:05:00Z",
								},
							],
							error: null,
						})),
					})),
				};
				return { select: vi.fn(() => chain) };
			}
			return {
				select: vi.fn(() => ({
					limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
				})),
				update: vi.fn(),
				insert: vi.fn(),
				upsert: vi.fn(),
			};
		});

		const res = response();
		await workforceHandler(req("POST", { action: "patrol", limit: 0 }), res);

		// patrol runs discovery first → the coordinated pair must land BLOCKED
		const stored = tasksStore.get() as { tasks: Record<string, unknown>[] };
		const approval = stored.tasks.find((t) =>
			String((t as { title: string }).title).startsWith("Approval required"),
		);
		expect(approval).toBeTruthy();
		expect((approval as { status: string }).status).toBe("blocked");
		expect((approval as { risk_level: string }).risk_level).toBe("high");
		// Coordinated-abuse approval task carries the sanctioned hide action.
		expect((approval as { input: { decision: string } }).input.decision).toBe(
			"hide",
		);
		// The two single-report triage tasks also exist
		expect(
			stored.tasks.filter((t) =>
				String((t as { title: string }).title).startsWith("Triage report"),
			).length,
		).toBe(0);
	});
});

describe("ops-summary cache invalidation", () => {
	it("recomputes after approve-task instead of serving the stale cached summary", async () => {
		// One BLOCKED approval task whose approval alert is still OPEN
		tasksStore.write({
			tasks: [
				{
					id: "task-blocked",
					title: "Approval required: hide reported post",
					source: "report",
					source_ref: "task-blocked",
					priority: "high",
					status: "blocked",
					assigned_agent: null,
					parent_task_id: null,
					risk_level: "high",
					verification_status: "none",
					error: null,
					outcomes: [],
					timeline: [],
					created_at: new Date().toISOString(),
					completed_at: null,
				},
			],
		});
		otherSettings["workforce_alerts"] = {
			alerts: [
				{
					id: "al-1",
					key: "approval:task-blocked",
					severity: "high",
					title: "Approval required",
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

		// Mutable DB state: pending-reports count changes behind the cache
		let pendingCount = 5;
		// A universally chainable query mock: every method (eq/order/limit/in/or/
		// gte/lt/maybeSingle/...) returns the same awaitable chain that resolves
		// to `finalValue`. This covers every query shape the workforce runtime
		// issues (head counts, row lists, pulse queries, verifier lookups).
		const makeChain = (finalValue: unknown) => {
			const chain = Promise.resolve(finalValue) as Promise<unknown> & {
				eq: unknown;
				order: unknown;
				limit: unknown;
				in: unknown;
				or: unknown;
				gte: unknown;
				lt: unknown;
				maybeSingle: unknown;
				single: unknown;
			};
			const self = () => chain;
			chain.eq = vi.fn(self);
			chain.order = vi.fn(self);
			chain.limit = vi.fn(self);
			chain.in = vi.fn(self);
			chain.or = vi.fn(self);
			chain.gte = vi.fn(self);
			chain.lt = vi.fn(self);
			chain.maybeSingle = vi.fn(self);
			chain.single = vi.fn(self);
			return chain;
		};
		mocks.from.mockImplementation((table: string) => {
			if (table === "agent_tasks") {
				return {
					select: vi.fn(() => ({
						limit: vi.fn(() =>
							Promise.resolve({ data: null, error: new Error("no table") }),
						),
					})),
				};
			}
			if (table === "settings") {
				return {
					select: vi.fn(() => ({
						eq: vi.fn((_col: string, key: string) => ({
							maybeSingle: vi.fn(async () => ({
								data:
									key === "agent_tasks_store"
										? { value: tasksStore.get() }
										: otherSettings[key] === undefined
											? null
											: { value: otherSettings[key] },
								error: null,
							})),
						})),
					})),
					upsert: vi.fn((row: { key: string; value: unknown }) => {
						if (row.key === "agent_tasks_store") tasksStore.write(row.value);
						else otherSettings[row.key] = row.value;
						return Promise.resolve({ error: null });
					}),
				};
			}
			if (
				table === "agent_executions" ||
				table === "agent_memory" ||
				table === "polls"
			) {
				// Row-list tables — any chain shape resolves to an empty list.
				return {
					select: vi.fn(() => makeChain({ data: [], error: null })),
				};
			}
			if (table === "posts" || table === "reports") {
				// Head counts resolve with the mutable count; row queries with [].
				// Head-count selects pass the options object as the SECOND arg:
				// select('id', { count: 'exact', head: true }).eq(...).
				return {
					select: vi.fn((_cols?: unknown, opts?: unknown) =>
						opts && typeof opts === "object"
							? makeChain({ count: pendingCount, data: null, error: null })
							: makeChain({ data: [], error: null }),
					),
				};
			}
			if (
				table === "users_meta" ||
				table === "comments" ||
				table === "reactions"
			) {
				// Head counts resolve with the mutable count; row queries with [].
				return {
					select: vi.fn((_cols?: unknown, opts?: unknown) =>
						opts && typeof opts === "object"
							? makeChain({ count: pendingCount, data: null, error: null })
							: makeChain({ data: [], error: null }),
					),
				};
			}
			return makeChain({ data: [], error: null });
		});

		// 1st read — computes + populates the cache
		const res1 = response();
		await workforceHandler(req("POST", { action: "ops-summary" }), res1);
		const body1 = res1.body as {
			platform: { pending_reports: number };
			alerts: { open: number };
		};
		expect(body1.platform.pending_reports).toBe(5);
		expect(body1.alerts.open).toBe(1);

		// DB state changes, then an admin approves the blocked task (invalidate)
		pendingCount = 2;
		const res2 = response();
		await workforceHandler(
			req("POST", { action: "approve-task", id: "task-blocked" }),
			res2,
		);
		expect((res2.body as { ok: boolean }).ok).toBe(true);

		// 2nd read MUST recompute — 2, not the stale 5; alert now resolved (open 0)
		const res3 = response();
		await workforceHandler(req("POST", { action: "ops-summary" }), res3);
		const body3 = res3.body as {
			platform: { pending_reports: number };
			alerts: { open: number };
		};
		expect(body3.platform.pending_reports).toBe(2); // stale cache would still say 5
		expect(body3.alerts.open).toBe(0); // approval alert auto-resolved
	});
});
