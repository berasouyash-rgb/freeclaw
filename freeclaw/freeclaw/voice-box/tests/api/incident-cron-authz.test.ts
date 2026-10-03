// ═══════════════════════════════════════════════════════════════════
// Cron authorization contract — /api/incident-cron
// ═══════════════════════════════════════════════════════════════════
// REGRESSION: this route had NO auth at all. `?action=run` triggered a
// heavy multi-query incident-detection job on demand (any anonymous
// caller → resource exhaustion), and `?action=metrics` / `?action=health`
// served internal system metrics and thresholds to anyone.
//
// Locks:
//   1. Anonymous → 401, and the detection job never runs.
//   2. Admin session → allowed (Vercel crons pass CRON_SECRET, admins
//      pass x-admin-token; both go through the shared isCronAuthorized).
//   3. A header being PRESENT is not authentication — a wrong secret is
//      rejected.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ admin: false, cronSecret: "" }));

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => state.admin),
	isCronAuthorized: vi.fn(async (req: { headers?: Record<string, unknown> }) => {
		const h = req?.headers ?? {};
		const auth = String(h["authorization"] || "");
		const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
		const presented =
			h["x-vercel-cron-secret"] || h["x-cron-secret"] || bearer;
		if (presented && state.cronSecret && presented === state.cronSecret)
			return true;
		return state.admin;
	}),
	CRON_UNAUTHORIZED_BODY: {
		error:
			"Unauthorized - requires valid Authorization: Bearer CRON_SECRET, x-vercel-cron-secret, or x-admin-token",
	},
}));
vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: () => {
			const q: Record<string, unknown> = {};
			const h: ProxyHandler<Record<string, unknown>> = {
				get(_t, p) {
					if (p === "then")
						return (res: (v: unknown) => unknown) => {
							void res({ data: null, error: null });
						};
					return () => new Proxy(q, h);
				},
			};
			return new Proxy(q, h);
		},
	},
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	trackError: vi.fn(),
}));
vi.mock("../../api/_incidents.js", () => ({
	detectIncidents: vi.fn(async () => []),
	loadIncidents: vi.fn(async () => []),
	saveIncidents: vi.fn(async () => {}),
	addTimeline: vi.fn(),
}));
vi.mock("../../api/_ops-events.js", () => ({
	buildEvent: vi.fn(() => ({})),
	appendEvent: vi.fn(async () => {}),
	listEvents: vi.fn(async () => []),
}));
vi.mock("../../api/_incident-triage.js", () => ({
	enqueueTriageJobs: vi.fn(async () => {}),
	runTriageWorker: vi.fn(async () => ({})),
	TRIAGE_WORKER: "triage",
}));

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return res;
		},
		end: vi.fn(() => res),
	});
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	state.admin = false;
	state.cronSecret = "";
	process.env.CRON_SECRET = "";
	delete process.env.CRON_SECRET;
});

afterEach(() => {
	delete process.env.CRON_SECRET;
});

describe("GET /api/incident-cron — authorization", () => {
	it("refuses an anonymous caller and never runs detection", async () => {
		const { default: handler } = await import("../../api/_incident-cron.js");
		const { detectIncidents } = await import("../../api/_incidents.js");
		const res = response();
		await handler(
			{ method: "GET", query: { action: "run" }, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(401);
		expect((res.body as { error: string }).error).toMatch(/Unauthorized/);
		// Negative space: the expensive job must not have been invoked.
		expect(detectIncidents).not.toHaveBeenCalled();
	});

	it("refuses internal metrics for an anonymous caller", async () => {
		const { default: handler } = await import("../../api/_incident-cron.js");
		const res = response();
		await handler(
			{ method: "GET", query: { action: "metrics" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(401);
		expect(res.body).not.toHaveProperty("system_metrics");
	});

	it("allows a correct CRON_SECRET (how Vercel invokes it)", async () => {
		state.cronSecret = "s3cret";
		const { default: handler } = await import("../../api/_incident-cron.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { action: "health" },
				headers: { authorization: "Bearer s3cret" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
	});

	it("rejects a wrong secret even when the header is present", async () => {
		state.cronSecret = "s3cret";
		const { default: handler } = await import("../../api/_incident-cron.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { action: "run" },
				headers: { "x-vercel-cron-secret": "not-the-secret" },
			},
			res,
		);
		expect(res.statusCode).toBe(401);
	});
});
