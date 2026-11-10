import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
	cors: vi.fn(),
	isAdmin: vi.fn(),
	isCronAuthorized: vi.fn(),
	hasMaintenanceSecret: vi.fn(),
	auditLog: vi.fn(),
}));

const maintenanceMocks = vi.hoisted(() => ({
	runCleanup: vi.fn(),
	purgeExpired: vi.fn(),
}));

vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_cleanup.js", () => ({
	runCleanup: maintenanceMocks.runCleanup,
}));
vi.mock("../../api/_posts.js", () => ({
	purgeExpired: maintenanceMocks.purgeExpired,
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (
		res: { status: (code: number) => { json: (body: unknown) => unknown } },
		error: unknown,
	) => {
		const message = error instanceof Error ? error.message : "Maintenance failed";
		return res.status(500).json({ error: message });
	},
}));

function response() {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
		setHeader() {
			return res;
		},
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(body: unknown) {
			res.body = body;
			return res;
		},
		end() {
			return res;
		},
	};
	return res;
}

async function call(
	req: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown }> {
	const handler = (await import("../../api/_maintenance.js")).default;
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			body: {},
			headers: {},
			...req,
		},
		res,
	);
	return { statusCode: res.statusCode, body: res.body };
}

beforeEach(() => {
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(true);
	authMocks.isCronAuthorized.mockResolvedValue(false);
	authMocks.hasMaintenanceSecret.mockReturnValue(false);
	maintenanceMocks.runCleanup.mockResolvedValue({
		cleaned: 0,
		details: {},
	});
	maintenanceMocks.purgeExpired.mockResolvedValue({
		purged: 0,
		skipped: false,
	});
	delete process.env.MAINTENANCE_SECRET;
});

describe("scheduled maintenance boundary", () => {
	describe("GET — cron / external scheduler", () => {
		it("runs the sweep for a cron-authorized GET", async () => {
			authMocks.isCronAuthorized.mockResolvedValue(true);

			const result = await call({ method: "GET" });

			expect(result.statusCode).toBe(200);
			expect(result.body).toMatchObject({ success: true });
			expect(maintenanceMocks.runCleanup).toHaveBeenCalledTimes(1);
			expect(maintenanceMocks.purgeExpired).toHaveBeenCalledTimes(1);
			expect(authMocks.auditLog).toHaveBeenCalledWith(
				"cron",
				"maintenance",
				expect.any(String),
			);
		});

		it("accepts a shared maintenance secret on GET", async () => {
			authMocks.hasMaintenanceSecret.mockReturnValue(true);

			const result = await call({
				method: "GET",
				headers: { "x-maintenance-secret": "test-maintenance-secret" },
			});

			expect(result.statusCode).toBe(200);
			expect(maintenanceMocks.runCleanup).toHaveBeenCalledTimes(1);
		});

		it("rejects an unauthorized GET with 401 and runs no work", async () => {
			const result = await call({ method: "GET" });

			expect(result.statusCode).toBe(401);
			expect(maintenanceMocks.runCleanup).not.toHaveBeenCalled();
			expect(maintenanceMocks.purgeExpired).not.toHaveBeenCalled();
			expect(authMocks.auditLog).not.toHaveBeenCalled();
		});
	});

	describe("POST — manual admin run", () => {
		it("runs the sweep for an authenticated admin", async () => {
			const result = await call({ method: "POST" });

			expect(result.statusCode).toBe(200);
			expect(result.body).toMatchObject({ success: true });
			expect(maintenanceMocks.runCleanup).toHaveBeenCalledTimes(1);
			expect(authMocks.auditLog).toHaveBeenCalledWith(
				"admin",
				"maintenance",
				expect.any(String),
			);
		});

		it("rejects an unauthenticated POST with 403 and runs no work", async () => {
			authMocks.isAdmin.mockResolvedValue(false);

			const result = await call({ method: "POST" });

			expect(result.statusCode).toBe(403);
			expect(maintenanceMocks.runCleanup).not.toHaveBeenCalled();
			expect(maintenanceMocks.purgeExpired).not.toHaveBeenCalled();
		});

		it("accepts the configured maintenance secret without an admin session", async () => {
			authMocks.isAdmin.mockResolvedValue(false);
			authMocks.hasMaintenanceSecret.mockReturnValue(true);

			const result = await call({
				method: "POST",
				headers: { "x-maintenance-secret": "test-maintenance-secret" },
			});

			expect(result.statusCode).toBe(200);
			expect(result.body).toMatchObject({ success: true });
		});

		it("returns explicit proven-work results for an authenticated run", async () => {
			maintenanceMocks.runCleanup.mockResolvedValue({
				cleaned: 2,
				details: { deleted_comments: 2 },
			});
			maintenanceMocks.purgeExpired.mockResolvedValue({
				purged: 1,
				skipped: false,
			});

			const result = await call({ method: "POST" });

			expect(result.statusCode).toBe(200);
			expect(result.body).toMatchObject({
				success: true,
				skipped: false,
				cleanup: { cleaned: 2, details: { deleted_comments: 2 } },
				post_purge: { purged: 1, skipped: false },
			});
		});

		it("reports a cooldown as skipped rather than a successful empty run", async () => {
			maintenanceMocks.runCleanup.mockResolvedValue(null);
			maintenanceMocks.purgeExpired.mockResolvedValue({
				purged: 0,
				skipped: true,
			});

			const result = await call({ method: "POST" });

			expect(result.statusCode).toBe(200);
			expect(result.body).toMatchObject({ success: true, skipped: true });
		});

		it("does not return success when a maintenance write fails", async () => {
			maintenanceMocks.purgeExpired.mockRejectedValue(new Error("purge failed"));

			const result = await call({ method: "POST" });

			expect(result.statusCode).toBe(500);
			expect(result.body).not.toMatchObject({ success: true });
		});
	});

	describe("method guard", () => {
		it.each(["PUT", "DELETE", "PATCH"])(
			"rejects %s with 405 and runs no work",
			async (method) => {
				authMocks.isAdmin.mockResolvedValue(true);
				authMocks.isCronAuthorized.mockResolvedValue(true);

				const result = await call({ method });

				expect(result.statusCode).toBe(405);
				expect(result.body).toMatchObject({ allow: "GET, POST" });
				expect(maintenanceMocks.runCleanup).not.toHaveBeenCalled();
				expect(maintenanceMocks.purgeExpired).not.toHaveBeenCalled();
			},
		);

		it("answers CORS preflight without doing work", async () => {
			const result = await call({ method: "OPTIONS" });

			expect(result.statusCode).toBe(204);
			expect(maintenanceMocks.runCleanup).not.toHaveBeenCalled();
		});
	});
});
