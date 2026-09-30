// ═══════════════════════════════════════════════════════════════════
// Workforce proof API — admin authorization gate
// ═══════════════════════════════════════════════════════════════════
// Locks the contract that /api/workforce-proof is admin-only.
//
// REGRESSION GUARD: this endpoint shipped with NO auth check at all, even
// though it exposes worker memory contents, learning evidence and proof runs,
// and `memory-cleanup` mutates state. A live unauthenticated request returned
// 200 with internal evidence, while /api/workforce-api correctly returned 401.
//
// These tests fail if the gate is removed or short-circuited again.
// ═══════════════════════════════════════════════════════════════════

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
vi.mock("../../api/_workforce-proof.js", () => ({
	runWorkforceProof: vi.fn(async () => []),
	getProofResults: vi.fn(() => []),
	getProofSummary: vi.fn(() => ({})),
}));
vi.mock("../../api/_worker-memory.js", () => ({
	getMemoryStats: vi.fn(async () => ({ total: 0 })),
	queryMemory: vi.fn(async () => []),
	discardStaleMemories: vi.fn(async () => ({ discarded: 0 })),
}));
vi.mock("../../api/_continuous-learning.js", () => ({
	getLearningStatus: vi.fn(async () => ({})),
	collectProductionEvidence: vi.fn(async () => ({})),
	getAllCanaries: vi.fn(async () => ({})),
	getVersionHistory: vi.fn(async () => []),
}));
vi.mock("../../api/_workforce-core.js", () => ({
	getRegistry: vi.fn(() => []),
}));

import handler from "../../api/_workforce-proof-api.js";

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

describe("workforce-proof admin gate", () => {
	it("rejects an unauthenticated learning read with 401", async () => {
		mocks.isAdmin.mockResolvedValue(false);
		const res = response();
		await handler(req("GET", { action: "learning" }), res);

		expect(res.statusCode).toBe(401);
		expect((res.body as { error: string }).error).toMatch(/Admin required/);
		const { getLearningStatus } = await import(
			"../../api/_continuous-learning.js"
		);
		expect(getLearningStatus).not.toHaveBeenCalled();
	});

	it("rejects an unauthenticated memory query with 401 and returns no memories", async () => {
		mocks.isAdmin.mockResolvedValue(false);
		const res = response();
		await handler(req("GET", { action: "memory-query", worker_id: "w1" }), res);

		expect(res.statusCode).toBe(401);
		const { queryMemory } = await import("../../api/_worker-memory.js");
		expect(queryMemory).not.toHaveBeenCalled();
	});

	it("rejects unauthenticated memory-cleanup with 401 and does NOT delete anything", async () => {
		mocks.isAdmin.mockResolvedValue(false);
		const res = response();
		await handler(req("GET", { action: "memory-cleanup" }), res);

		expect(res.statusCode).toBe(401);
		const { discardStaleMemories } = await import(
			"../../api/_worker-memory.js"
		);
		expect(discardStaleMemories).not.toHaveBeenCalled();
	});

	it("allows an authenticated admin through to the action", async () => {
		mocks.isAdmin.mockResolvedValue(true);
		const res = response();
		await handler(req("GET", { action: "learning" }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ ok: true, status: {} });
	});
});
