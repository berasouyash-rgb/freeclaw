// ═══════════════════════════════════════════════════════════════════
// Workforce — AI Quality actions (quality, quality-evaluate)
// ═══════════════════════════════════════════════════════════════════
// Tests the GET ?action=quality and POST {action:"quality-evaluate"} wiring.
// The real source is the continuous-learning engine (production ledger).
// We mock _continuous-learning.js and _evaluation-engine.js to assert wiring.

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
	// Real signature is (res, err, context) and it SENDS the response itself —
	// mirror that so the test exercises production behaviour, not a 1-arg
	// helper that production never calls.
	sanitizeError: vi.fn(
		(
			res: { status: (c: number) => { json: (b: unknown) => unknown } },
			_err: unknown,
		) => res.status(500).json({ error: "Internal server error" }),
	),
}));
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(async () => {}),
	emitEventAndBridge: vi.fn(async () => {}),
	EVENT_TYPES: {},
}));
vi.mock("../../api/_agent-team.js", () => ({
	ALL_AGENTS: [],
	classifyTask: vi.fn(),
	processAgentTask: vi.fn(),
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
	hasUsableLLM: vi.fn(async () => false),
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

// Mock the continuous-learning engine
const mockLearning = vi.hoisted(() => ({
	getLearningStatus: vi.fn(),
	runContinuousEvaluation: vi.fn(),
}));
vi.mock("../../api/_continuous-learning.js", () => ({
	getLearningStatus: mockLearning.getLearningStatus,
	runContinuousEvaluation: mockLearning.runContinuousEvaluation,
}));

// Mock the evaluation engine
const mockEval = vi.hoisted(() => ({
	getEvaluationHistory: vi.fn(),
	registerEvaluation: vi.fn(),
}));
vi.mock("../../api/_evaluation-engine.js", () => ({
	getEvaluationHistory: mockEval.getEvaluationHistory,
	registerEvaluation: mockEval.registerEvaluation,
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

function req(method: string, body: unknown) {
	return {
		method,
		headers: { "x-admin-token": "test" },
		body: method === "POST" ? body : undefined,
		query: method === "GET" ? body : {},
		socket: { remoteAddress: "127.0.0.1" },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.from.mockReset();
});

describe("workforce quality actions", () => {
	it("GET ?action=quality returns aggregated scorecards + evidence from learning engine", async () => {
		mockLearning.getLearningStatus.mockResolvedValue({
			evaluation: {
				results: [
					{
						worker_id: "moderation-worker",
						scorecard: {
							worker_id: "moderation-worker",
							task_success_rate: 0.92,
							tool_accuracy: 0.88,
							verification_rate: 0.95,
							rollback_rate: 0.02,
							false_positive_rate: 0.03,
							false_negative_rate: 0.04,
							average_latency_ms: 245,
							average_cost: 0.0031,
							safety_score: 0.98,
							measured_impact: 12,
							source: "production_ledger",
							overall_health: 91,
							updated_at: new Date().toISOString(),
						},
					},
					{
						worker_id: "database-worker",
						scorecard: {
							worker_id: "database-worker",
							task_success_rate: 0.85,
							tool_accuracy: 0.91,
							verification_rate: 0.9,
							rollback_rate: 0.05,
							false_positive_rate: 0.02,
							false_negative_rate: 0.06,
							average_latency_ms: 410,
							average_cost: 0.0052,
							safety_score: 0.95,
							measured_impact: 8,
							source: "production_ledger",
							overall_health: 87,
							updated_at: new Date().toISOString(),
						},
					},
					{
						worker_id: "unmeasured-worker",
						scorecard: null,
					},
				],
				workers_without_evidence: 1,
				scorecard_source: "production_ledger",
			},
			evidence: {
				period: "24h",
				total_executions: 156,
				successes: 142,
				failures: 14,
				escalations: 2,
				failures_by_worker: { "moderation-worker": 3, "database-worker": 11 },
				memory_stats: { total_entries: 42, total_size_bytes: 128450 },
				supervisor_summary: { paused: 0, quarantined: 0, loop_detected: 0 },
				generated_at: new Date().toISOString(),
			},
			memory: { entries: 42, size_bytes: 128450 },
			versions: { "moderation-worker": 3, "database-worker": 2 },
		});

		mockEval.getEvaluationHistory.mockResolvedValue([
			{
				worker_id: "moderation-worker",
				summary: {
					total_cases: 20,
					passed: 19,
					success_rate: 95,
					average_score: 0.92,
					safety_violations: 0,
				},
				evaluated_at: new Date().toISOString(),
			},
			{
				worker_id: "database-worker",
				summary: {
					total_cases: 15,
					passed: 13,
					success_rate: 87,
					average_score: 0.88,
					safety_violations: 0,
				},
				evaluated_at: new Date().toISOString(),
			},
		]);

		const res = response();
		await workforceHandler(req("GET", { action: "quality" }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.scorecards).toHaveLength(2);
		expect(res.body.workers).toHaveLength(3);
		expect(res.body.recent_evaluations).toHaveLength(2);
		expect(res.body.evidence).toBeTruthy();
		expect(res.body.memory).toBeTruthy();
		expect(res.body.versions).toBeTruthy();
		expect(res.body.summary).toMatchObject({
			workers_tracked: 3,
			workers_measured: 2,
			workers_without_evidence: 1,
			average_health: 89, // (91 + 87) / 2 = 89
			evaluations_run: 2,
			total_cases: 35,
			pass_rate: 91, // (19+13)/35 ≈ 91%
			safety_violations: 0,
			drift: null, // only 2 evals, needs 4 for drift
		});
		expect(res.body.training).toMatchObject({
			available_scenarios: expect.any(Number),
			scenario_categories: expect.arrayContaining(["NORMAL", "FAILURE", "EDGE_CASE", "SECURITY", "REGRESSION"]),
		});
		expect(res.body.scorecard_source).toBe("production_ledger");
		expect(res.body.updated_at).toBeTruthy();
	});

	it("GET ?action=quality handles empty learning status gracefully", async () => {
		mockLearning.getLearningStatus.mockResolvedValue({
			evaluation: { results: [], workers_without_evidence: 0, scorecard_source: "production_ledger" },
			evidence: null,
			memory: null,
			versions: {},
		});
		mockEval.getEvaluationHistory.mockResolvedValue([]);

		const res = response();
		await workforceHandler(req("GET", { action: "quality" }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.scorecards).toHaveLength(0);
		expect(res.body.workers).toHaveLength(0);
		expect(res.body.recent_evaluations).toHaveLength(0);
		expect(res.body.summary).toMatchObject({
			workers_tracked: 0,
			workers_measured: 0,
			workers_without_evidence: 0,
			average_health: null,
			evaluations_run: 0,
			total_cases: 0,
			pass_rate: null,
			safety_violations: 0,
			drift: null,
		});
	});

	it("POST {action:'quality-evaluate'} calls runContinuousEvaluation and returns fresh quality view", async () => {
		mockLearning.runContinuousEvaluation.mockResolvedValue({
			scorecards_written: 2,
			workers_evaluated: 2,
			duration_ms: 1847,
		});

		mockLearning.getLearningStatus.mockResolvedValue({
			evaluation: {
				results: [
					{
						worker_id: "moderation-worker",
						scorecard: {
							worker_id: "moderation-worker",
							task_success_rate: 0.94,
							tool_accuracy: 0.9,
							verification_rate: 0.96,
							rollback_rate: 0.01,
							false_positive_rate: 0.02,
							false_negative_rate: 0.03,
							average_latency_ms: 210,
							average_cost: 0.0028,
							safety_score: 0.99,
							measured_impact: 14,
							source: "production_ledger",
							overall_health: 93,
							updated_at: new Date().toISOString(),
						},
					},
				],
				workers_without_evidence: 0,
				scorecard_source: "production_ledger",
			},
			evidence: { period: "24h", total_executions: 89, successes: 85, failures: 4, escalations: 0 },
			memory: { entries: 28, size_bytes: 98120 },
			versions: { "moderation-worker": 4 },
		});
		mockEval.getEvaluationHistory.mockResolvedValue([
			{
				worker_id: "moderation-worker",
				summary: { total_cases: 25, passed: 24, success_rate: 96, average_score: 0.94, safety_violations: 0 },
				evaluated_at: new Date().toISOString(),
			},
		]);

		const res = response();
		await workforceHandler(req("POST", { action: "quality-evaluate" }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.run).toMatchObject({
			scorecards_written: 2,
			workers_evaluated: 2,
			duration_ms: 1847,
		});
		expect(mockLearning.runContinuousEvaluation).toHaveBeenCalledTimes(1);
		expect(res.body.summary.workers_measured).toBe(1);
		expect(res.body.summary.average_health).toBe(93);
	});

	it("quality-evaluate fails gracefully when runContinuousEvaluation throws", async () => {
		mockLearning.runContinuousEvaluation.mockRejectedValue(new Error("Evaluation timeout"));
		mockLearning.getLearningStatus.mockResolvedValue({
			evaluation: { results: [], workers_without_evidence: 0, scorecard_source: "production_ledger" },
			evidence: null,
			memory: null,
			versions: {},
		});
		mockEval.getEvaluationHistory.mockResolvedValue([]);

		const res = response();
		await workforceHandler(req("POST", { action: "quality-evaluate" }), res);

		expect(res.statusCode).toBe(500);
		expect(res.body.ok).toBeUndefined(); // handler returns { error: "..." } on catch
		// sanitizeError must NOT leak the raw provider/internal message.
		expect(res.body.error).toBe("Internal server error");
	});

	it("fabric-run without a configured backend returns setup guidance, never a localhost probe", async () => {
		const savedBase = process.env.WORKFORCE_BASE_URL;
		const savedAlt = process.env.WORKFORCE_URL;
		delete process.env.WORKFORCE_BASE_URL;
		delete process.env.WORKFORCE_URL;
		try {
			const res = response();
			await workforceHandler(
				req("POST", { action: "fabric-run", input: "hello" }),
				res,
			);
			expect(res.statusCode).toBe(200);
			expect(res.body.ok).toBe(false);
			expect(res.body.configured).toBe(false);
			expect(res.body.backend).toBeNull();
			expect(res.body.error).toContain("WORKFORCE_BASE_URL");
			expect(JSON.stringify(res.body)).not.toContain("localhost");
		} finally {
			if (savedBase !== undefined) process.env.WORKFORCE_BASE_URL = savedBase;
			if (savedAlt !== undefined) process.env.WORKFORCE_URL = savedAlt;
		}
	});

	it("fabric-status without a configured backend reports disabled, not unreachable", async () => {
		const savedBase = process.env.WORKFORCE_BASE_URL;
		const savedAlt = process.env.WORKFORCE_URL;
		delete process.env.WORKFORCE_BASE_URL;
		delete process.env.WORKFORCE_URL;
		try {
			const res = response();
			await workforceHandler(req("GET", { action: "fabric-status" }), res);
			expect(res.statusCode).toBe(200);
			expect(res.body.ok).toBe(false);
			expect(res.body.configured).toBe(false);
			expect(res.body.disabled).toBe(true);
		} finally {
			if (savedBase !== undefined) process.env.WORKFORCE_BASE_URL = savedBase;
			if (savedAlt !== undefined) process.env.WORKFORCE_URL = savedAlt;
		}
	});

	it("quality-redteam executes adversarial cases against the live engine", async () => {
		mockLearning.getLearningStatus.mockResolvedValue({
			evaluation: { results: [], workers_without_evidence: 0, scorecard_source: "production_ledger" },
			evidence: null,
			memory: null,
			versions: {},
		});
		mockEval.getEvaluationHistory.mockResolvedValue([]);

		const res = response();
		await workforceHandler(req("POST", { action: "quality-redteam" }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.ok).toBe(true);
		const run = res.body.redteam_run;
		expect(run.total).toBeGreaterThan(10);
		expect(Array.isArray(run.cases)).toBe(true);
		expect(run.passed).toBe(run.cases.filter((c) => c.pass).length);
		// every case carries input/expected/actual — a real verdict, not a claim
		for (const c of run.cases) {
			expect(typeof c.input).toBe("string");
			expect(["block", "hold", "publish"]).toContain(c.expected);
			expect(["block", "hold", "publish"]).toContain(c.actual);
		}
		// quality payload still ships with the redteam status block
		expect(res.body.redteam.total_cases).toBe(run.total);
	});
});