// ═══════════════════════════════════════════════════════════════════
// Workforce API — admin authorization gate
// ═══════════════════════════════════════════════════════════════════
// Locks the contract that /api/workforce-api is admin-only.
//
// REGRESSION GUARD: the handler called `isAdmin(req)` WITHOUT `await`.
// `isAdmin` is async, so it returns a Promise — always truthy — making
// `!isAdmin(req)` permanently false. The gate never blocked anything:
// an unauthenticated caller could execute tools, roll back worker
// actions, unpause workers, and read the audit trail.
//
// These tests fail unless the gate actually awaits the async verdict.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), isAdmin: vi.fn() }));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mocks.from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: mocks.isAdmin,
}));
vi.mock("../../api/_security.js", () => ({
	setSecurityHeaders: vi.fn(),
}));
vi.mock("../../api/_workforce-integration.js", () => ({
	getWorkforceStatus: vi.fn(async () => ({ ok: true })),
	getAuditLog: vi.fn(() => []),
	getImpactLog: vi.fn(async () => []),
	getImpactSummary: vi.fn(async () => ({})),
	getSupervisorSummary: vi.fn(() => ({})),
	executeTool: vi.fn(async () => ({ ok: true, executed: true })),
	preExecutionCheck: vi.fn(() => ({ allowed: true })),
	unpauseWorker: vi.fn(() => ({ ok: true })),
	executeRollback: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../api/_workforce-tool-gateway.js", () => ({
	getAllTools: vi.fn(() => []),
	dryRunTool: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../api/_training-lab.js", () => ({
	getTrainingStatus: vi.fn(async () => ({})),
}));

import handler from "../../api/_workforce-api.js";

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

function req(method: string, body: unknown = {}) {
	return {
		method,
		headers: {},
		body: method === "POST" ? body : undefined,
		query: method === "GET" ? body : {},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("workforce-api admin gate", () => {
	it("rejects an unauthenticated read with 401", async () => {
		mocks.isAdmin.mockResolvedValue(false);
		const res = response();
		await handler(req("GET", { action: "status" }), res);

		expect(res.statusCode).toBe(401);
		expect((res.body as { error: string }).error).toMatch(/Admin required/);
	});

	it("rejects an unauthenticated execute-tool with 401 and does NOT execute", async () => {
		mocks.isAdmin.mockResolvedValue(false);
		const res = response();
		await handler(
			req("POST", { action: "execute-tool", worker_id: "w1", tool_id: "t1" }),
			res,
		);

		expect(res.statusCode).toBe(401);
		const { executeTool } = await import(
			"../../api/_workforce-integration.js"
		);
		expect(executeTool).not.toHaveBeenCalled();
	});

	it("rejects an unauthenticated rollback with 401", async () => {
		mocks.isAdmin.mockResolvedValue(false);
		const res = response();
		await handler(req("POST", { action: "rollback", worker_id: "w1" }), res);

		expect(res.statusCode).toBe(401);
		const { executeRollback } = await import(
			"../../api/_workforce-integration.js"
		);
		expect(executeRollback).not.toHaveBeenCalled();
	});

	it("allows an authenticated admin through to the action", async () => {
		mocks.isAdmin.mockResolvedValue(true);
		const res = response();
		await handler(req("GET", { action: "status" }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ ok: true });
	});
});