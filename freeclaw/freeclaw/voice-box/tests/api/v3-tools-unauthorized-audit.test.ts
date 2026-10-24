// ═══════════════════════════════════════════════════════════════════
// §45 TEST 8 — Unauthorized action → tool rejects → audit event
// ═══════════════════════════════════════════════════════════════════
// Locks the full TEST 8 chain on POST /api/v3/tools:
//   - execute: a student calling an admin-only tool is rejected (400)
//     AND a security.permission_denied audit event is written for that
//     attempt (target, role, reason, request id/ip) — rejection without
//     evidence is not enough
//   - batch: each denied item records its own event; allowed items none
//   - read-back: _security-events serves the recorded row as a
//     permission.denied event at the severity the UI expects
//   - honest negatives: authorized executions and ordinary tool
//     failures (validation, unknown tool) create NO security event —
//     the audit trail records unauthorized attempts, not routine work
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
const logSecurity = vi.fn(async () => ({}));
const queryAuditLogs = vi.fn(async () => [] as unknown[]);
vi.mock("../../api/_audit.js", () => ({
	log: { security: logSecurity },
	auditLog: vi.fn(async () => ({})),
	queryAuditLogs,
}));

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

const DENIED = "Tool 'ban_user' requires admin permissions";

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(false);
	registry.getToolSchemasForRole.mockReturnValue([]);
	registry.getTool.mockReturnValue(undefined);
	registry.validateParams.mockReturnValue([]);
	registry.executeTool.mockResolvedValue({ ok: true, output: "done" });
	registry.executeTools.mockResolvedValue([{ ok: true }]);
	queryAuditLogs.mockResolvedValue([]);
});

async function postExecute(name: string) {
	const { default: handler } = await import("../../api/v3/_tools.js");
	const res = response();
	await handler(
		{
			method: "POST",
			body: { action: "execute", name, params: {} },
			query: {},
			headers: { "x-request-id": "req-8", "x-forwarded-for": "10.0.0.9" },
		},
		res,
	);
	return res;
}

describe("TEST 8: unauthorized action → rejection → audit event", () => {
	it("rejects a student calling an admin tool AND records the denial", async () => {
		registry.executeTool.mockResolvedValue({ error: DENIED, latency_ms: 0 });

		const res = await postExecute("ban_user");

		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain(
			"requires admin permissions",
		);
		expect(logSecurity).toHaveBeenCalledTimes(1);
		expect(logSecurity).toHaveBeenCalledWith(
			"permission_denied",
			expect.objectContaining({
				target: "ban_user",
				role: "student",
				reason: DENIED,
				requestId: "req-8",
				ip: "10.0.0.9",
				source: "v3-tools",
				action_taken: "blocked",
			}),
		);
	});

	it("creates no security event for an authorized execution", async () => {
		const res = await postExecute("get_posts");

		expect(res.statusCode).toBe(200);
		expect(logSecurity).not.toHaveBeenCalled();
	});

	it("creates no security event for ordinary tool failures", async () => {
		registry.executeTool.mockResolvedValue({ error: "invalid city" });
		const first = await postExecute("get_posts");
		expect(first.statusCode).toBe(400);
		expect(logSecurity).not.toHaveBeenCalled();

		registry.executeTool.mockResolvedValue({ error: "Unknown tool: nope" });
		const second = await postExecute("nope");
		expect(second.statusCode).toBe(400);
		expect(logSecurity).not.toHaveBeenCalled();
	});

	it("batch: audits each denied item and only denied items", async () => {
		registry.executeTools.mockResolvedValue([
			{ name: "ban_user", error: DENIED },
			{ name: "get_posts", ok: true },
		]);
		const { default: handler } = await import("../../api/v3/_tools.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { action: "batch", tools: [{ name: "ban_user" }, { name: "get_posts" }] },
				query: {},
				headers: {},
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(logSecurity).toHaveBeenCalledTimes(1);
		expect(logSecurity).toHaveBeenCalledWith(
			"permission_denied",
			expect.objectContaining({ target: "ban_user", role: "student" }),
		);
	});

	it("read-back: _security-events serves the denial as permission.denied", async () => {
		queryAuditLogs.mockResolvedValue([
			{
				id: "evt-1",
				action: "security.permission_denied",
				resource_type: "security",
				actor_type: "system",
				timestamp: "2026-09-23T10:00:00.000Z",
				details: {
					level: "WARN",
					reason: DENIED,
					target: "ban_user",
					action_taken: "blocked",
				},
			},
		]);
		// Admin session required: the audit log is read through the
		// service-role client, so the endpoint itself must gate on isAdmin.
		authMocks.isAdmin.mockResolvedValue(true);
		const { default: handler } = await import("../../api/_security-events.js");
		const res = response();
		await handler({ method: "GET", query: { action: "events" }, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			ok: boolean;
			count: number;
			events: Array<{ type: string; severity: string; description: string }>;
		};
		expect(body.ok).toBe(true);
		expect(body.count).toBe(1);
		expect(body.events[0]).toMatchObject({
			type: "permission.denied",
			severity: "medium",
		});
		expect(body.events[0].description).toContain("requires admin permissions");
		expect(queryAuditLogs).toHaveBeenCalledWith(
			expect.objectContaining({ resourceType: "security" }),
		);
	});

	// REGRESSION (authorization): the audit log is read through the
	// service-role client, so RLS does not protect it. An anonymous caller
	// used to receive up to 500 security rows — client IPs, request/error
	// rates, the identities being flagged, injection/PII detection details.
	// The endpoint must refuse before it ever touches the audit store.
	it("refuses anonymous callers and never reads the audit log", async () => {
		authMocks.isAdmin.mockResolvedValue(false);
		queryAuditLogs.mockClear();
		const { default: handler } = await import("../../api/_security-events.js");
		const res = response();
		await handler(
			{ method: "GET", query: { action: "events" }, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(403);
		expect((res.body as { events?: unknown[] }).events).toBeUndefined();
		// Negative space: the protected store is not even queried.
		expect(queryAuditLogs).not.toHaveBeenCalled();
	});
});
