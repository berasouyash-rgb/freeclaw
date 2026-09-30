// ═══════════════════════════════════════════════════════════════════
// Workforce pause / resume / resume-worker — kill-switch contract
// ═══════════════════════════════════════════════════════════════════
// Locks: POST {action:"pause"} and {action:"resume"} toggle the global
// workforce flag; POST {action:"resume-worker", agent_id} unpauses a
// supervisor-paused worker (the resume path the AI Failures page needs —
// it previously did not exist, so a paused worker could never be resumed
// from the UI). Uses synthetic worker ids so no production state is
// touched. Real supervisor module (pause state is in-memory).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
const auditCalls = vi.hoisted(() => ({ calls: [] as unknown[] }));

function tableChain() {
	const q = {
		then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
			return Promise.resolve({ data: null, error: null }).then(res, rej);
		},
	};
	return new Proxy(q, {
		get(t, p) {
			if (p === "then") return (t as { then: unknown }).then;
			if (p === "maybeSingle" || p === "single")
				return async () => ({ data: null, error: null });
			if (p === "upsert" || p === "insert" || p === "update" || p === "delete")
				return async () => ({ data: null, error: null });
			if (typeof p === "string") return () => tableChain();
			return undefined;
		},
	});
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) =>
			table === "settings"
				? {
						select: () => ({
							eq: (_c: string, key: string) => ({
								maybeSingle: async () => ({
									data: kv.store.has(key)
										? { value: kv.store.get(key) }
										: null,
									error: null,
								}),
							}),
						}),
						upsert: async (row: { key: string; value: unknown }) => {
							kv.store.set(row.key, row.value);
							return { error: null };
						},
					}
				: tableChain(),
	},
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async (...args: unknown[]) => {
		auditCalls.calls.push(args);
	}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn(),
	checkUser: vi.fn(async () => ({ ok: true })),
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
	isTestArtifact: vi.fn(() => false),
}));
vi.mock("../../api/_continuous-learning.js", () => ({
	getLearningStatus: vi.fn(async () => ({})),
	runContinuousEvaluation: vi.fn(async () => ({})),
}));
vi.mock("../../api/_evaluation-engine.js", () => ({
	getEvaluationHistory: vi.fn(async () => []),
	registerEvaluation: vi.fn(async () => ({})),
}));
vi.mock("../../api/_redteam-cases.js", () => ({
	getRedteamStatus: vi.fn(async () => ({})),
	runRedTeam: vi.fn(async () => ({})),
}));
vi.mock("../../api/_training-lab.js", () => ({
	TRAINING_SCENARIOS: [],
}));
vi.mock("../../api/agents/_runner.js", () => ({
	runAgent: vi.fn(),
	logActivity: vi.fn(async () => {}),
	recordMetric: vi.fn(async () => {}),
	getRecentActivity: vi.fn(async () => []),
}));
vi.mock("../../api/_workforce-core.js", () => ({
	workforceHealth: vi.fn(async () => ({})),
}));

import workforceHandler from "../../api/_workforce.js";
import {
	getPausedWorkers,
	recordFailure,
	resetSupervisorState,
} from "../../api/_worker-supervisor.js";

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

function post(body: unknown) {
	return {
		method: "POST",
		headers: { "x-admin-token": "test" },
		body,
		query: {},
		socket: { remoteAddress: "127.0.0.1" },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	kv.store.clear();
	auditCalls.calls.length = 0;
	resetSupervisorState({ persist: false });
});

describe("workforce kill switch", () => {
	it("POST pause sets the global paused flag and audits", async () => {
		const res = response();
		await workforceHandler(post({ action: "pause" }), res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true, paused: true });
		expect(auditCalls.calls).toContainEqual(
			expect.arrayContaining(["admin", "workforce_pause"]),
		);
	});

	it("POST resume clears the flag and audits", async () => {
		const paused = response();
		await workforceHandler(post({ action: "pause" }), paused as never);
		expect(paused.body).toMatchObject({ ok: true, paused: true });

		const res = response();
		await workforceHandler(post({ action: "resume" }), res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true, paused: false });
		expect(auditCalls.calls).toContainEqual(
			expect.arrayContaining(["admin", "workforce_resume"]),
		);
	});

	it("POST resume-worker without an id is rejected loudly, not silently", async () => {
		const res = response();
		await workforceHandler(post({ action: "resume-worker" }), res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: false });
		expect(String((res.body as { error?: string }).error || "")).toMatch(
			/agent_id required/,
		);
	});

	it("POST resume-worker unpauses a supervisor-paused worker", async () => {
		const wid = "probe-resume-w";
		for (let i = 0; i < 25; i++) recordFailure(wid);
		expect(getPausedWorkers()).toContain(wid);

		const res = response();
		await workforceHandler(
			post({ action: "resume-worker", agent_id: wid }),
			res as never,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true, unpaused: true });
		expect(getPausedWorkers()).not.toContain(wid);
		expect(auditCalls.calls).toContainEqual(
			expect.arrayContaining(["admin", "workforce_resume_worker"]),
		);
	});
});
