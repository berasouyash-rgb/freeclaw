import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
	cors: vi.fn(),
	isAdmin: vi.fn(),
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

describe("authenticated maintenance boundary", () => {
	it("rejects an unauthenticated invocation before running work", async () => {
		authMocks.isAdmin.mockResolvedValue(false);

		const result = await call({ method: "POST" });

		expect(result.statusCode).toBe(403);
		expect(maintenanceMocks.runCleanup).not.toHaveBeenCalled();
		expect(maintenanceMocks.purgeExpired).not.toHaveBeenCalled();
	});

	it("accepts the configured maintenance secret without an admin session", async () => {
		process.env.MAINTENANCE_SECRET = "test-maintenance-secret";
		authMocks.isAdmin.mockResolvedValue(false);

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

	it("rejects non-POST methods", async () => {
		const result = await call({ method: "GET" });

		expect(result.statusCode).toBe(405);
		expect(maintenanceMocks.runCleanup).not.toHaveBeenCalled();
	});
});
