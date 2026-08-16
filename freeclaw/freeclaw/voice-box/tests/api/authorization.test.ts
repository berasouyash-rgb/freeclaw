import { beforeEach, describe, expect, it, vi } from "vitest";

const isAdmin = vi.fn();
const getToolSchemasForRole = vi.fn();
vi.mock("../../api/_auth.js", () => ({ cors: vi.fn(), isAdmin }));
vi.mock("../../api/_error.js", () => ({ sanitizeError: vi.fn() }));
vi.mock("../../api/_tool-registry.js", () => ({
	getToolSchemasForRole,
	executeTool: vi.fn(),
	executeTools: vi.fn(),
	validateParams: vi.fn(() => []),
	getTool: vi.fn(),
}));

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

describe("v3 tools authorization", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		isAdmin.mockResolvedValue(false);
		getToolSchemasForRole.mockReturnValue([]);
	});
	it("does not grant admin tools when asynchronous authentication rejects the request", async () => {
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.body).toMatchObject({ role: "student" });
		expect(getToolSchemasForRole).toHaveBeenCalledWith("student");
	});
});
