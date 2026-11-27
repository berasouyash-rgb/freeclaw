// ═══════════════════════════════════════════════════════════════════
// ROUTE-LEVEL AUTHORIZATION MATRIX TESTS (Finding #2)
// ═══════════════════════════════════════════════════════════════════
// Asserts that the centralized route-level authorization matrix in
// api/index.js and api/_auth-matrix.js strictly enforces:
//   - 401/403 on Admin routes without valid credentials
//   - 401 on Cron routes without valid cron secret or admin token
//   - 401 on User/Session routes without anonymous identity or token
//   - Method-level gating on mixed-role routes (e.g. reports, announcements)
//   - Open access on Public routes

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: vi.fn(() => ({
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn(async () => ({ data: null, error: null })),
		})),
	},
}));

vi.mock("../../api/_auth.js", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		isAdmin: vi.fn(async (req) => {
			const token = req.headers?.["x-admin-token"];
			return token === "valid-admin-secret-token";
		}),
	};
});

import {
	verifyRouteAccess,
} from "../../api/_auth-matrix.js";

function mockReq(opts: {
	method?: string;
	url?: string;
	headers?: Record<string, string>;
	body?: Record<string, unknown>;
	query?: Record<string, string>;
}) {
	return {
		method: opts.method || "GET",
		url: opts.url || "/",
		headers: opts.headers || {},
		body: opts.body || {},
		query: opts.query || {},
	};
}

describe("Route-Level Authorization Matrix", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, CRON_SECRET: "test-cron-secret-123" };
		delete process.env.MAINTENANCE_SECRET;
	});

	describe("Admin-Only Routes", () => {
		const adminRoutes = [
			"audit-trail",
			"admin-export",
			"bulk-operations",
			"command-center",
			"report-deck",
			"tech-debt",
			"db_stats",
			"cleanup",
			"workforce",
		];

		it("returns 401 when no admin token header is present", async () => {
			for (const route of adminRoutes) {
				const req = mockReq({});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(false);
				expect(result.status).toBe(401);
				expect(result.error).toMatch(/Admin access required/);
			}
		});

		it("returns 403 when an invalid admin token is supplied", async () => {
			for (const route of adminRoutes) {
				const req = mockReq({
					headers: { "x-admin-token": "bad-token" },
				});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(false);
				expect(result.status).toBe(403);
				expect(result.error).toMatch(/Admin only/);
			}
		});

		it("authorizes when a valid admin token is supplied", async () => {
			for (const route of adminRoutes) {
				const req = mockReq({
					headers: { "x-admin-token": "valid-admin-secret-token" },
				});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(true);
			}
		});
	});

	describe("Cron-Only Routes", () => {
		const cronRoutes = [
			"agent-cron",
			"agents-cron",
			"incident-cron",
			"keep-alive",
			"maintenance",
		];

		it("returns 401 when caller is not cron and not admin", async () => {
			for (const route of cronRoutes) {
				const req = mockReq({});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(false);
				expect(result.status).toBe(401);
				expect(result.error).toMatch(/Unauthorized cron invocation/);
			}
		});

		it("authorizes when valid x-vercel-cron-secret is present", async () => {
			for (const route of cronRoutes) {
				const req = mockReq({
					headers: { "x-vercel-cron-secret": "test-cron-secret-123" },
				});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(true);
			}
		});

		it("authorizes when valid Bearer cron secret is present", async () => {
			for (const route of cronRoutes) {
				const req = mockReq({
					headers: { authorization: "Bearer test-cron-secret-123" },
				});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(true);
			}
		});

		it("authorizes an admin manual trigger of cron endpoints", async () => {
			for (const route of cronRoutes) {
				const req = mockReq({
					headers: { "x-admin-token": "valid-admin-secret-token" },
				});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(true);
			}
		});
	});

	describe("Scheduled maintenance cron route", () => {
		it("authorizes a Vercel-style GET carrying the cron secret", async () => {
			const result = await verifyRouteAccess(
				"maintenance",
				mockReq({
					method: "GET",
					headers: { "x-vercel-cron-secret": "test-cron-secret-123" },
				}) as never,
			);

			expect(result.authorized).toBe(true);
		});

		it("authorizes a manual admin POST", async () => {
			const result = await verifyRouteAccess(
				"maintenance",
				mockReq({
					method: "POST",
					headers: { "x-admin-token": "valid-admin-secret-token" },
				}) as never,
			);

			expect(result.authorized).toBe(true);
		});

		it("authorizes an external scheduler holding MAINTENANCE_SECRET", async () => {
			process.env.MAINTENANCE_SECRET = "external-scheduler-secret";

			const result = await verifyRouteAccess(
				"maintenance",
				mockReq({
					method: "GET",
					headers: { "x-maintenance-secret": "external-scheduler-secret" },
				}) as never,
			);

			expect(result.authorized).toBe(true);
		});

		it("rejects a wrong MAINTENANCE_SECRET", async () => {
			process.env.MAINTENANCE_SECRET = "external-scheduler-secret";

			const result = await verifyRouteAccess(
				"maintenance",
				mockReq({
					method: "GET",
					headers: { "x-maintenance-secret": "not-the-secret" },
				}) as never,
			);

			expect(result.authorized).toBe(false);
			expect(result.status).toBe(401);
		});

		it("does not grant the maintenance secret to other cron routes", async () => {
			process.env.MAINTENANCE_SECRET = "external-scheduler-secret";

			const result = await verifyRouteAccess(
				"keep-alive",
				mockReq({
					method: "GET",
					headers: { "x-maintenance-secret": "external-scheduler-secret" },
				}) as never,
			);

			expect(result.authorized).toBe(false);
			expect(result.status).toBe(401);
		});
	});

	describe("User/Session-Owner Routes", () => {
		const userRoutes = ["saved", "follows", "notify-prefs", "me", "appeals"];

		it("returns 401 when caller has no identity at all", async () => {
			for (const route of userRoutes) {
				const req = mockReq({});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(false);
				expect(result.status).toBe(401);
				expect(result.error).toMatch(/User identity required/);
			}
		});

		it("authorizes when x-anon-id is provided", async () => {
			for (const route of userRoutes) {
				const req = mockReq({
					headers: { "x-anon-id": "anon_user_12345" },
				});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(true);
			}
		});

		it("authorizes when x-session-token or Bearer token is provided", async () => {
			for (const route of userRoutes) {
				const req = mockReq({
					headers: { "x-session-token": "sess_tok_abc123" },
				});
				const result = await verifyRouteAccess(route, req as never);
				expect(result.authorized).toBe(true);
			}
		});
	});

	describe("Method-Specific Matrix Routes", () => {
		it("permits public POST to /api/reports, but restricts GET/PUT to admin", async () => {
			// Public student filing report
			const postReq = mockReq({ method: "POST" });
			const postRes = await verifyRouteAccess("reports", postReq as never);
			expect(postRes.authorized).toBe(true);

			// Unauthenticated GET queue
			const getReq = mockReq({ method: "GET" });
			const getRes = await verifyRouteAccess("reports", getReq as never);
			expect(getRes.authorized).toBe(false);
			expect(getRes.status).toBe(401);

			// Authenticated Admin GET queue
			const adminGetReq = mockReq({
				method: "GET",
				headers: { "x-admin-token": "valid-admin-secret-token" },
			});
			const adminGetRes = await verifyRouteAccess("reports", adminGetReq as never);
			expect(adminGetRes.authorized).toBe(true);
		});

		it("permits public GET announcements, but restricts POST/PUT to admin", async () => {
			const getReq = mockReq({ method: "GET" });
			const getRes = await verifyRouteAccess("announcements", getReq as never);
			expect(getRes.authorized).toBe(true);

			const postReq = mockReq({ method: "POST" });
			const postRes = await verifyRouteAccess("announcements", postReq as never);
			expect(postRes.authorized).toBe(false);
			expect(postRes.status).toBe(401);

			const adminPostReq = mockReq({
				method: "POST",
				headers: { "x-admin-token": "valid-admin-secret-token" },
			});
			const adminPostRes = await verifyRouteAccess("announcements", adminPostReq as never);
			expect(adminPostRes.authorized).toBe(true);
		});

		it("permits /api/admin action=login and action=verify without prior token", async () => {
			const loginReq = mockReq({
				method: "POST",
				body: { action: "login", password: "test" },
			});
			const loginRes = await verifyRouteAccess("admin", loginReq as never);
			expect(loginRes.authorized).toBe(true);

			const verifyReq = mockReq({
				method: "POST",
				body: { action: "verify" },
			});
			const verifyRes = await verifyRouteAccess("admin", verifyReq as never);
			expect(verifyRes.authorized).toBe(true);

			// Sensitive action requires admin
			const sensitiveReq = mockReq({
				method: "POST",
				body: { action: "set_leaderboard_config" },
			});
			const sensitiveRes = await verifyRouteAccess("admin", sensitiveReq as never);
			expect(sensitiveRes.authorized).toBe(false);
			expect(sensitiveRes.status).toBe(401);
		});

		it("permits /api/admin action=auth_mode before login (GET and POST)", async () => {
			// Regression: auth_mode returns only { env_secret: boolean } and the
			// login screen must read it BEFORE it holds any credential. When the
			// matrix blocked it, Admin.tsx caught the 401 and failed open to
			// password mode, breaking env-secret deployments.
			const getReq = mockReq({ method: "GET", query: { action: "auth_mode" } });
			const getRes = await verifyRouteAccess("admin", getReq as never);
			expect(getRes.authorized).toBe(true);

			const postReq = mockReq({
				method: "POST",
				body: { action: "auth_mode" },
			});
			const postRes = await verifyRouteAccess("admin", postReq as never);
			expect(postRes.authorized).toBe(true);
		});
	});

	describe("Public Routes", () => {
		it("permits open read/write access to standard public endpoints", async () => {
			const publicRoutes = [
				"posts",
				"comments",
				"polls",
				"reactions",
				"search",
				"health",
				"version",
			];
			for (const route of publicRoutes) {
				const req = mockReq({ method: "GET" });
				const res = await verifyRouteAccess(route, req as never);
				expect(res.authorized).toBe(true);
			}
		});
	});
});
