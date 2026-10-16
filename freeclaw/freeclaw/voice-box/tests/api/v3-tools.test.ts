// ═══════════════════════════════════════════════════════════════════
// V3 Tools API — action routing + schema/permission contract
// ═══════════════════════════════════════════════════════════════════
// Locks POST/GET /api/v3/tools:
//   - list   → role-scoped tool schemas (student vs admin), count included
//   - get    → single tool detail or 404
//   - validate → parameter validation result (valid + errors)
//   - execute → single tool execution, role + request context; 400 on
//     tool error, 200 on success
//   - batch  → multi-tool execution with a 10-tool cap
//   - invalid action → 400; OPTIONS → 204
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = {
	cors: vi.fn(),
	clientIp: (req: {
		headers?: Record<string, string | undefined>;
		socket?: { remoteAddress?: string };
	}) =>
		String(
			req?.headers?.["x-forwarded-for"] ||
				req?.socket?.remoteAddress ||
				"unknown",
		),
	isAdmin: vi.fn().mockResolvedValue(false),
};
vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((_res: unknown, err: unknown) => {
		throw err;
	}),
}));
const registry = {
	getToolsForRole: vi.fn(),
	getToolSchemasForRole: vi.fn(),
	executeTool: vi.fn(),
	executeTools: vi.fn(),
	validateParams: vi.fn(),
	getTool: vi.fn(),
};
vi.mock("../../api/_agent-tool-registry.js", () => registry);

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

function fakeTool(over: Record<string, unknown> = {}) {
	return {
		name: "fetch_weather",
		description: "Get the weather",
		parameters: { city: "string" },
		permissions: ["read"],
		category: "data",
		requiresApproval: false,
		...over,
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(false);
	registry.getToolSchemasForRole.mockReturnValue([
		fakeTool(),
		fakeTool({ name: "notify_team" }),
	]);
	registry.getTool.mockReturnValue(fakeTool());
	registry.validateParams.mockReturnValue([]);
	registry.executeTool.mockResolvedValue({ ok: true, output: "done" });
	registry.executeTools.mockResolvedValue([{ ok: true }, { ok: true }]);
});

describe("list", () => {
	it("POST list returns student tools when not an admin", async () => {
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "list" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ role: "student", count: 2 });
		expect((res.body as { tools: unknown[] }).tools).toHaveLength(2);
		expect(registry.getToolSchemasForRole).toHaveBeenCalledWith("student");
	});

	it("POST list returns admin tools for admins", async () => {
		authMocks.isAdmin.mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "list" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { role: string }).role).toBe("admin");
		expect(registry.getToolSchemasForRole).toHaveBeenCalledWith("admin");
	});

	it("GET with no action defaults to list", async () => {
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect((res.body as { role: string }).role).toBe("student");
	});
});

describe("get", () => {
	it("returns tool details for an existing tool", async () => {
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "get", name: "fetch_weather" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			name: "fetch_weather",
			description: "Get the weather",
			parameters: { city: "string" },
			permissions: ["read"],
			category: "data",
			requiresApproval: false,
		});
	});

	it("404s for an unknown tool", async () => {
		registry.getTool.mockReturnValueOnce(undefined);
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "get", name: "nope" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});
});

describe("validate", () => {
	it("reports valid params", async () => {
		registry.validateParams.mockReturnValueOnce([]);
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "validate",
					name: "fetch_weather",
					params: { city: "London" },
				},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ valid: true, errors: [] });
		expect(registry.validateParams).toHaveBeenCalledWith(fakeTool(), {
			city: "London",
		});
	});

	it("reports invalid params with the error list", async () => {
		registry.validateParams.mockReturnValueOnce(["city is required"]);
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "validate", name: "fetch_weather", params: {} },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ valid: false, errors: ["city is required"] });
	});

	it("404s for an unknown tool", async () => {
		registry.getTool.mockReturnValueOnce(undefined);
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "validate", name: "nope" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});
});

describe("execute", () => {
	it("executes a tool as a student with request context", async () => {
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "execute",
					name: "fetch_weather",
					params: { city: "London" },
				},
				headers: { "x-request-id": "req-1", "x-forwarded-for": "10.0.0.1" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ ok: true, output: "done" });
		expect(registry.executeTool).toHaveBeenCalledWith(
			"fetch_weather",
			{ city: "London" },
			{
				role: "student",
				requestId: "req-1",
				ip: "10.0.0.1",
			},
		);
	});

	it("executes a tool as admin when authorized", async () => {
		authMocks.isAdmin.mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "execute", name: "fetch_weather", params: {} },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(registry.executeTool).toHaveBeenCalledWith(
			"fetch_weather",
			{},
			expect.objectContaining({ role: "admin" }),
		);
	});

	it("returns 400 when the tool reports an error", async () => {
		registry.executeTool.mockResolvedValueOnce({ error: "invalid city" });
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "execute", name: "fetch_weather", params: {} },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect(res.body).toEqual({ error: "invalid city" });
	});
});

describe("batch", () => {
	it("executes a batch of tools and returns the results", async () => {
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "batch", tools: [{ name: "a" }, { name: "b" }] },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ results: [{ ok: true }, { ok: true }] });
		expect(registry.executeTools).toHaveBeenCalledWith(
			[{ name: "a" }, { name: "b" }],
			{ role: "student" },
		);
	});

	it("rejects batches larger than 10 tools", async () => {
		const tools = Array.from({ length: 11 }, (_, i) => ({ name: `t${i}` }));
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "batch", tools },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("10");
		expect(registry.executeTools).not.toHaveBeenCalled();
	});
});

describe("routing", () => {
	it("400s on an invalid action", async () => {
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "explode" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("Invalid action");
	});

	it("answers OPTIONS with 204", async () => {
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler({ method: "OPTIONS", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(204);
	});
});
