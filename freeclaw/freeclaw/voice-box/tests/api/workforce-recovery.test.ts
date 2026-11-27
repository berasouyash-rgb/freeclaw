// ═══════════════════════════════════════════════════════════════════
// Workforce stale-recovery — heartbeat-aware + independently verified
// ═══════════════════════════════════════════════════════════════════
// Locks the two invariants that make recovery honest:
//
//   1. LIVENESS IS NOT AGE. A long-running but ALIVE execution/task (fresh
//      heartbeat) is never failed or requeued, even when started_at is hours
//      old. The old findStaleRunningExecutions() filtered on started_at alone
//      and therefore declared every live long-running execution stale —
//      marking it failed while it was still working.
//
//   2. A RECOVERY ONLY COUNTS WHEN IT PERSISTED. Every transition is
//      independently verified by reading the execution/task back from the
//      live store. updateTask()'s own return value is NOT trusted: in the
//      settings store it returns the patched object even when the underlying
//      write silently failed.
//
// The same assertions double as the DISABLE test: remove the heartbeat /
// the read-back and the expected behaviour inverts (a live row gets killed,
// or a lost write gets reported as a success).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => {
	const state = {
		settings: new Map<string, unknown>(),
		executions: [] as Row[],
		// Schema/loss simulations — each one is a disable test lever.
		noHeartbeatColumn: false,
		failExecutionUpdate: false,
		lieOnExecutionVerify: false,
		failSettingsWrite: false,
	};

	function applyFilters(rows: Row[], filters: Array<[string, string, unknown]>) {
		return rows.filter((r) =>
			filters.every(([op, col, val]) => {
				if (op === "eq") return r[col] === val;
				if (op === "lt") return r[col] != null && String(r[col]) < String(val);
				if (op === "in") return (val as unknown[]).includes(r[col]);
				return true;
			}),
		);
	}

	const q: {
		table: string;
		op: string;
		filters: Array<[string, string, unknown]>;
		orders: Array<[string, boolean]>;
		limit: number | null;
		selectCols: string | null;
		patch: unknown;
	} = {
		table: "",
		op: "select",
		filters: [],
		orders: [],
		limit: null,
		selectCols: null,
		patch: null,
	};

	function exec(query: typeof q): QueryResult {
		if (query.table === "agent_tasks") {
			// No modern table → the workforce must fall back to the settings store.
			return { data: null, error: { message: 'relation "agent_tasks" does not exist' } };
		}
		if (query.table === "settings") {
			if (query.op === "select") {
				const key = query.filters.find((f) => f[1] === "key")?.[2];
				const value = state.settings.get(String(key));
				return { data: value === undefined ? null : { value }, error: null };
			}
			if (query.op === "upsert") {
				if (state.failSettingsWrite)
					return { data: null, error: { message: "settings write failed" } };
				const row = query.patch as { key: string; value: unknown };
				state.settings.set(row.key, row.value);
				return { data: null, error: null };
			}
			return { data: null, error: null };
		}
		if (query.table === "agent_executions") {
			if (query.op === "select") {
				if (
					state.noHeartbeatColumn &&
					String(query.selectCols).includes("heartbeat_at")
				)
					return {
						data: null,
						error: { message: 'column "heartbeat_at" does not exist' },
					};
				let rows = applyFilters(state.executions, query.filters).map((r) => ({
					...r,
				}));
				if (query.orders.length) {
					const [col, ascending] = query.orders[0];
					rows = rows.sort((a, b) =>
						String(a[col]).localeCompare(String(b[col])) * (ascending ? 1 : -1),
					);
				}
				if (query.limit != null) rows = rows.slice(0, query.limit);
				return { data: rows, error: null };
			}
			if (query.op === "update") {
				if (state.failExecutionUpdate)
					return { data: null, error: { message: "update failed" } };
				for (const r of applyFilters(state.executions, query.filters))
					Object.assign(r, query.patch);
				return { data: null, error: null };
			}
		}
		return { data: null, error: null };
	}

	return { state, exec, q, applyFilters };
});

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			const q = {
				table,
				op: "select",
				filters: [] as Array<[string, string, unknown]>,
				orders: [] as Array<[string, boolean]>,
				limit: null as number | null,
				selectCols: null as string | null,
				patch: null as unknown,
			};
			const api: Record<string, unknown> = {
				select(cols?: string) {
					q.selectCols = cols ?? "*";
					if (!["update", "insert", "upsert"].includes(q.op)) q.op = "select";
					return api;
				},
				eq(col: string, val: unknown) {
					q.filters.push(["eq", col, val]);
					return api;
				},
				lt(col: string, val: unknown) {
					q.filters.push(["lt", col, val]);
					return api;
				},
				in(col: string, vals: unknown) {
					q.filters.push(["in", col, vals]);
					return api;
				},
				gte(col: string, val: unknown) {
					q.filters.push(["gte", col, val]);
					return api;
				},
				or() {
					return api;
				},
				order(col: string, opts?: { ascending?: boolean }) {
					q.orders.push([col, opts?.ascending !== false]);
					return api;
				},
				limit(n: number) {
					q.limit = n;
					return api;
				},
				update(p: unknown) {
					q.op = "update";
					q.patch = p;
					return api;
				},
				insert(p: unknown) {
					q.op = "insert";
					q.patch = p;
					return api;
				},
				upsert(p: unknown) {
					q.op = "upsert";
					q.patch = p;
					return api;
				},
				maybeSingle() {
					if (
						table === "agent_executions" &&
						h.state.lieOnExecutionVerify &&
						q.selectCols === "status"
					)
						// Simulates a row that still reads 'running' after the update:
						// the update "succeeded" but the persisted state disagrees.
						return Promise.resolve({ data: { status: "running" }, error: null });
					const res = h.exec(q);
					if (res.error) return Promise.resolve(res);
					const d = res.data;
					const one = Array.isArray(d) ? d[0] ?? null : d ?? null;
					return Promise.resolve({ data: one, error: null });
				},
				single() {
					return (api as { maybeSingle: () => Promise<QueryResult> }).maybeSingle();
				},
				then(
					onFulfilled?: (v: QueryResult) => unknown,
					onRejected?: (e: unknown) => unknown,
				) {
					return Promise.resolve(h.exec(q)).then(onFulfilled, onRejected);
				},
			};
			return api;
		},
	},
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
vi.mock("../../api/_artifact-filter.js", () => ({
	isTestArtifact: () => false,
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
vi.mock("../../api/_providers.js", () => ({
	hasUsableLLM: vi.fn(async () => true),
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

import { recoverStale } from "../../api/_workforce.js";

const TASK_KEY = "agent_tasks_store";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString();

function seedExecution(overrides: Row = {}): Row {
	const row: Row = {
		id: `exec_${h.state.executions.length + 1}`,
		agent_id: "agent-1",
		agent_name: "Agent One",
		status: "running",
		started_at: minutesAgo(0.2),
		heartbeat_at: null,
		error: null,
		completed_at: null,
		...overrides,
	};
	h.state.executions.push(row);
	return row;
}

function findExecution(id: string): Row | undefined {
	return h.state.executions.find((e) => e.id === id);
}

function storedTasks(): Row[] {
	const row = h.state.settings.get(TASK_KEY) as { tasks?: Row[] } | undefined;
	return row?.tasks ?? [];
}

function seedTask(overrides: Row = {}): Row {
	const tasks = storedTasks();
	const task: Row = {
		id: `task_${tasks.length + 1}`,
		title: "Task",
		description: null,
		source: "test",
		source_ref: null,
		priority: "medium",
		status: "working",
		assigned_agent: "agent-1",
		required_capability: null,
		risk_level: "low",
		input: null,
		output: null,
		outcomes: null,
		error: null,
		verification_status: "none",
		attempts: 0,
		max_attempts: 3,
		created_by: "test",
		created_at: minutesAgo(120),
		claimed_at: minutesAgo(62),
		started_at: minutesAgo(61),
		heartbeat_at: minutesAgo(61),
		completed_at: null,
		...overrides,
	};
	tasks.push(task);
	h.state.settings.set(TASK_KEY, { tasks, updated_at: new Date().toISOString() });
	return task;
}

function taskById(id: string): Row | undefined {
	return storedTasks().find((t) => t.id === id);
}

beforeEach(() => {
	h.state.settings.clear();
	h.state.executions.length = 0;
	h.state.noHeartbeatColumn = false;
	h.state.failExecutionUpdate = false;
	h.state.lieOnExecutionVerify = false;
	h.state.failSettingsWrite = false;
});

describe("execution recovery — liveness is not age", () => {
	it("does NOT recover a long-running execution that is still heartbeating", async () => {
		// Started two hours ago, heartbeat 30s ago → alive, must be left alone.
		seedExecution({ id: "live", started_at: minutesAgo(120), heartbeat_at: minutesAgo(0.5) });
		const r = await recoverStale();
		expect(r.executions).toBe(0);
		expect(r.executions_unverified).toBe(0);
		expect(findExecution("live")?.status).toBe("running");
	});

	it("recovers a genuinely stale execution (heartbeat expired) and verifies it", async () => {
		seedExecution({ id: "dead", started_at: minutesAgo(120), heartbeat_at: minutesAgo(120) });
		const r = await recoverStale();
		expect(r.executions).toBe(1);
		expect(r.executions_unverified).toBe(0);
		expect(findExecution("dead")?.status).toBe("failed");
		expect(
			(r.evidence as Array<{ kind: string }>).some((e) => e.kind === "execution"),
		).toBe(true);
	});

	it("separates live from dead executions in a single pass", async () => {
		seedExecution({ id: "live", started_at: minutesAgo(120), heartbeat_at: minutesAgo(0.2) });
		seedExecution({ id: "dead", started_at: minutesAgo(120), heartbeat_at: minutesAgo(120) });
		const r = await recoverStale();
		expect(r.executions).toBe(1);
		expect(findExecution("live")?.status).toBe("running");
		expect(findExecution("dead")?.status).toBe("failed");
	});

	it("falls back to started_at when the schema has no heartbeat_at column", async () => {
		h.state.noHeartbeatColumn = true;
		seedExecution({ id: "legacy", started_at: minutesAgo(120), heartbeat_at: null });
		const r = await recoverStale();
		expect(r.executions).toBe(1);
		expect(findExecution("legacy")?.status).toBe("failed");
	});

	it("never declares an execution stale without a usable timestamp", async () => {
		seedExecution({ id: "unknown", started_at: null, heartbeat_at: null });
		const r = await recoverStale();
		expect(r.executions).toBe(0);
		expect(findExecution("unknown")?.status).toBe("running");
	});

	it("does not count an execution whose update failed", async () => {
		h.state.failExecutionUpdate = true;
		seedExecution({ id: "dead", started_at: minutesAgo(120), heartbeat_at: minutesAgo(120) });
		const r = await recoverStale();
		expect(r.executions).toBe(0);
		expect(r.executions_unverified).toBe(1);
		expect(findExecution("dead")?.status).toBe("running");
	});

	it("does not count an execution the read-back still reports as running", async () => {
		h.state.lieOnExecutionVerify = true;
		seedExecution({ id: "dead", started_at: minutesAgo(120), heartbeat_at: minutesAgo(120) });
		const r = await recoverStale();
		expect(r.executions).toBe(0);
		expect(r.executions_unverified).toBe(1);
	});

	it("caps recovery evidence at 10 entries", async () => {
		for (let i = 0; i < 12; i++)
			seedExecution({
				id: `e${i}`,
				started_at: minutesAgo(120),
				heartbeat_at: minutesAgo(120),
			});
		const r = await recoverStale();
		expect(r.executions).toBe(12);
		expect((r.evidence as unknown[]).length).toBeLessThanOrEqual(10);
	});
});

describe("task recovery — verified requeue", () => {
	it("requeues a stale working task and verifies the persisted state", async () => {
		seedTask({ id: "t1", status: "working", attempts: 0 });
		const r = await recoverStale();
		expect(r.tasks).toBe(1);
		expect(r.tasks_unverified).toBe(0);
		const t = taskById("t1");
		expect(t?.status).toBe("queued");
		expect(t?.assigned_agent).toBeNull();
		expect(t?.attempts).toBe(1);
		expect(t?.heartbeat_at).toBeNull();
	});

	it("does NOT requeue a task whose started_at is old but heartbeat is fresh", async () => {
		seedTask({ id: "t1", status: "working", started_at: minutesAgo(300), heartbeat_at: minutesAgo(0.2) });
		const r = await recoverStale();
		expect(r.tasks).toBe(0);
		expect(taskById("t1")?.status).toBe("working");
	});

	it("requeues a stale claimed task too", async () => {
		seedTask({ id: "t1", status: "claimed", heartbeat_at: minutesAgo(30) });
		const r = await recoverStale();
		expect(r.tasks).toBe(1);
		expect(taskById("t1")?.status).toBe("queued");
	});

	it("fails (not requeues) a stale task at max attempts", async () => {
		seedTask({ id: "t1", status: "working", attempts: 3, max_attempts: 3, heartbeat_at: minutesAgo(30) });
		const r = await recoverStale();
		expect(r.tasks).toBe(1);
		const t = taskById("t1");
		expect(t?.status).toBe("failed");
		expect(t?.verification_status).toBe("failed");
	});

	it("does not count a requeue whose settings write silently failed", async () => {
		// updateTask() returns the patched object even when saveTasks() swallowed the
		// failure — so trusting its return value would report a fake recovery. The
		// independent read-back catches it.
		h.state.failSettingsWrite = true;
		seedTask({ id: "t1", status: "working", heartbeat_at: minutesAgo(60) });
		const r = await recoverStale();
		expect(r.tasks).toBe(0);
		expect(r.tasks_unverified).toBe(1);
		expect(taskById("t1")?.status).toBe("working");
	});

	it("leaves fresh queued/working tasks untouched when nothing is stale", async () => {
		seedTask({ id: "t1", status: "working", heartbeat_at: minutesAgo(0.1) });
		seedTask({ id: "t2", status: "queued", heartbeat_at: null, assigned_agent: null });
		const r = await recoverStale();
		expect(r.tasks).toBe(0);
		expect(r.executions).toBe(0);
		expect(taskById("t1")?.status).toBe("working");
		expect(taskById("t2")?.status).toBe("queued");
	});
});
