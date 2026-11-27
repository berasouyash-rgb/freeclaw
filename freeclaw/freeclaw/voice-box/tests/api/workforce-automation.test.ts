// Workforce automation actions — status lists every deterministic worker
// with its last run; run executes the real check on demand.
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
	sanitizeError: vi.fn((err: Error) => err.message),
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

function req(body: unknown) {
	return { method: "POST", body, headers: {}, query: {} };
}

function table(result: unknown) {
	const q: Record<string, unknown> = {};
	for (const m of ["select", "eq", "gte", "limit", "upsert"]) {
		q[m] = vi.fn(() => q);
	}
	(q.maybeSingle as unknown) = vi.fn(async () => ({ data: result }));
	(q.upsert as unknown) = vi.fn(async () => ({ error: null }));
	(q.then as unknown) = (resolve: (v: unknown) => void) =>
		Promise.resolve({ data: result, error: null }).then(resolve);
	return q;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.from.mockImplementation(() => table(null));
});

describe("automation-status", () => {
	it("lists every registered worker with last-run slot", async () => {
		const res = response();
		await workforceHandler(req({ action: "automation-status" }), res);
		const body = res.body as {
			ok: boolean;
			workers: Array<{ id: string; name: string; last: unknown }>;
		};
		expect(body.ok).toBe(true);
		expect(body.workers.length).toBeGreaterThanOrEqual(8);
		for (const w of body.workers) {
			expect(w.id).toBeTruthy();
			expect(w.name).toBeTruthy();
			expect("last" in w).toBe(true);
		}
	});
});

describe("automation-run", () => {
	it("rejects unknown workers without touching anything", async () => {
		const res = response();
		await workforceHandler(req({ action: "automation-run", worker: "nope" }), res);
		const body = res.body as { ok: boolean; error: string };
		expect(body.ok).toBe(false);
		expect(body.error).toContain("Unknown worker");
	});

	it("runs the real trends check on demand", async () => {
		const res = response();
		await workforceHandler(req({ action: "automation-run", worker: "trends" }), res);
		const body = res.body as {
			ok: boolean;
			worker: string;
			result: { checked: number };
			last: { summary: string };
			duration_ms: number;
		};
		expect(body.ok).toBe(true);
		expect(body.worker).toBe("trends");
		expect(typeof body.result.checked).toBe("number");
		expect(typeof body.last.summary).toBe("string");
		expect(typeof body.duration_ms).toBe("number");
	});

	it("never returns a bare 'unknown error' — failures name worker + step", async () => {
		// formatRunError is the single funnel for every automation failure
		// shape: thrown non-Errors, empty Errors, and {ok:false} results
		// with no error string. Each case must yield a non-empty message
		// that names the worker — this is what OpsCenter displays.
		const { formatRunError } = await import(
			"../../api/_automation-registry.js"
		);
		const cases: Array<[string, unknown, unknown, unknown]> = [
			["bare ok:false", "run", { ok: false }, undefined],
			["ok:false with error", "run", { ok: false, error: "db down" }, undefined],
			[
				"degraded without error string",
				"run",
				{ ok: false, degraded: true, reason: "015 missing" },
				undefined,
			],
			["thrown string", "threw", null, "boom"],
			["thrown undefined", "threw", null, undefined],
			["thrown empty Error", "threw", null, new Error("")],
			["thrown real Error", "load", null, new Error("no such module")],
			["missing export", "load", null, "missing export checkPolls"],
		];
		for (const [label, step, result, thrown] of cases) {
			const out = formatRunError(
				"sla",
				step as string,
				result as Record<string, unknown> | null,
				thrown,
			);
			expect(typeof out.error, label).toBe("string");
			expect(out.error.length, label).toBeGreaterThan(0);
			expect(out.error, label).not.toBe("unknown error");
			expect(out.error, label).toContain('"sla"');
			expect(out.step, label).toBe(step);
		}
		// Spot-checks: the real reason survives, not just the wrapper.
		expect(
			formatRunError("sla", "run", { ok: false, error: "db down" }, undefined)
				.error,
		).toContain("db down");
		expect(
			formatRunError("sla", "threw", null, "boom").error,
		).toContain("boom");
	});
});

describe("summarize — cron-path failure rows stay honest", () => {
	it("prefers reason/summary over a bare unknown error", async () => {
		const { summarize } = await import("../../api/_automation-registry.js");
		expect(summarize("sla", { ok: false, reason: "015 missing" })).toContain(
			"015 missing",
		);
		expect(summarize("sla", { ok: false })).not.toContain("unknown error");
		expect(summarize("sla", { ok: false })).toContain("no details recorded");
		expect(summarize("sla", { ok: true, warned: 1, escalated: 0 })).toContain(
			"1 warned",
		);
	});
});

describe("summarize — scan-first summaries prove the work", () => {
	it("leads with what was examined, never bare zeros", async () => {
		const { summarize } = await import("../../api/_automation-registry.js");
		expect(
			summarize("comment-watch", { ok: true, checked: 47, hidden: 0, verified: 0 }),
		).toBe("47 comments scanned · 0 hidden · 0 verified");
		expect(
			summarize("sla", { ok: true, checked: 12, warned: 0, escalated: 0 }),
		).toBe("12 open cases scanned · 0 warned · 0 escalated");
		expect(
			summarize("poll-sweep", { ok: true, checked: 5, notified: 1, skipped: 2 }),
		).toBe("5 polls scanned · 1 authors notified · 2 already notified");
		expect(
			summarize("reopen", { ok: true, checked: 9, reopened: [{ id: "x" }] }),
		).toBe("9 fresh comments scanned · 1 cases reopened");
		expect(
			summarize("followup", { ok: true, checked: 4, pinged: 0 }),
		).toBe("4 assigned cases scanned · 0 stalled cases pinged");
		expect(
			summarize("poll-integrity", {
				ok: true,
				checked: 30,
				quarantined: 0,
				watchAlerts: 1,
			}),
		).toBe("30 votes scanned · 0 votes quarantined · 1 watched");
	});
});
