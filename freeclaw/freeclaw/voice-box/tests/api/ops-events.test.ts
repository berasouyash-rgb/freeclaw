// ═══════════════════════════════════════════════════════════════════
// Ops Event Log — SPEC §4 typed ingest + durable, dedup, read-back
// ═══════════════════════════════════════════════════════════════════
// Locks the event contract end to end: buildEvent fills and validates
// the 11-field envelope (rejects unknown types/missing fields/oversize
// payloads), appendEvent persists to the settings KV log with
// deduplicationKey idempotence and an explicit write-error throw,
// listEvents re-reads independently, and the incident-cron producer
// emits exactly one PERIODIC_HEALTH_CHECK per 5-minute bucket from
// real measured metrics — twice in the same bucket stores ONE event.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

// Authorization of the cron route is covered in incident-cron-authz.test.ts;
// these suites cover the producer/read-back business logic.
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isCronAuthorized: vi.fn(async () => true),
	CRON_UNAUTHORIZED_BODY: { error: "Unauthorized" },
}));

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../api/_incidents.js", () => ({
	detectIncidents: vi.fn(async () => []),
	loadIncidents: vi.fn(async () => []),
	saveIncidents: vi.fn(async () => undefined),
	addTimeline: vi.fn(),
	assignIncident: vi.fn(async () => ({ error: "not stubbed" })),
}));

// ─── in-memory settings KV + query state ────────────────────────
const settings: Record<string, unknown> = {};
const state = {
	postsCount: 0,
	reportsCount: 0,
	executions: [] as Array<{ status: string }>,
	settingsWriteFail: false,
};

/** Chainable supabase double covering every query the cron makes. */
function chainFor(table: string) {
	const chain = {
		op: "select",
		col: undefined as unknown,
		filters: {} as Record<string, unknown>,
		patch: undefined as Record<string, unknown> | undefined,
		newRow: undefined as Record<string, unknown> | undefined,
		countMode: false,
		select(col?: unknown, opts?: unknown) {
			this.col = col;
			if (opts && typeof opts === "object" && (opts as { count?: string }).count) {
				this.countMode = true;
			}
			return this;
		},
		eq(field: string, value: unknown) {
			this.filters[field] = value;
			return this;
		},
		in(field: string, value: unknown) {
			this.filters[field] = value;
			return this;
		},
		gte(field: string, value: unknown) {
			this.filters[field] = value;
			return this;
		},
		order() {
			return this;
		},
		limit() {
			return this;
		},
		maybeSingle() {
			this.op = "maybeSingle";
			return this;
		},
		single() {
			this.op = "single";
			return this;
		},
		update(patch: Record<string, unknown>) {
			this.op = "update";
			this.patch = patch;
			return this;
		},
		insert(row: Record<string, unknown>) {
			this.op = "insert";
			this.newRow = row;
			return this;
		},
		upsert(row: Record<string, unknown>) {
			this.op = "upsert";
			this.newRow = row;
			return this;
		},
		then(fn: (v: unknown) => void) {
			if (table === "settings") {
				const key = this.filters.key as string | undefined;
				if (this.op === "update") {
					if (state.settingsWriteFail) {
						fn({ data: null, error: { message: "simulated write failure" } });
						return;
					}
					if (key !== undefined && this.patch && "value" in this.patch) {
						settings[key] = this.patch.value;
					}
					fn({ data: null, error: null });
					return;
				}
				if (this.op === "insert") {
					if (state.settingsWriteFail) {
						fn({ data: null, error: { message: "simulated write failure" } });
						return;
					}
					const row = this.newRow as Record<string, unknown>;
					settings[row.key as string] = row.value;
					fn({ data: row, error: null });
					return;
				}
				if (this.op === "maybeSingle" || this.op === "single") {
					fn({
						data: key !== undefined && key in settings ? { value: settings[key] } : null,
						error: null,
					});
					return;
				}
				// plain select (latency probe)
				fn({ data: [], error: null });
				return;
			}
			if (table === "posts" && this.countMode) {
				fn({ data: null, count: state.postsCount, error: null });
				return;
			}
			if (table === "reports" && this.countMode) {
				fn({ data: null, count: state.reportsCount, error: null });
				return;
			}
			if (table === "agent_executions") {
				fn({ data: state.executions, error: null });
				return;
			}
			fn({ data: [], count: 0, error: null });
		},
	};
	return chain;
}

type Handler = (req: Record<string, unknown>, res: unknown) => Promise<unknown>;

let handler: Handler;
let buildEvent: (input: Record<string, unknown>) => Record<string, any>;
let appendEvent: (event: Record<string, unknown>) => Promise<any>;
let listEvents: (filters?: Record<string, unknown>) => Promise<any[]>;
let OPS_EVENT_TYPES: string[];

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

/** Build a valid event with a caller-chosen dedup key. */
function makeEvent(overrides: Record<string, unknown> = {}) {
	return buildEvent({
		type: "NEW_POST",
		source: "test",
		resource: "post",
		actor: "tester",
		payload: {},
		...overrides,
	});
}

beforeEach(async () => {
	vi.clearAllMocks();
	for (const k of Object.keys(settings)) delete settings[k];
	state.postsCount = 7;
	state.reportsCount = 2;
	state.settingsWriteFail = false;
	state.executions = [
		{ status: "completed" },
		{ status: "completed" },
		{ status: "completed" },
		{ status: "failed" },
	];
	// real seeded metrics the producer must carry through
	settings.system_metrics = {
		error_rate: 0.01,
		api_p95_ms: 120,
		cache_hit_rate: 0.95,
		search_zero_rate: 0.02,
		db_query_ms: 55,
	};
	settings.event_log = { events: [{ id: "e1" }, { id: "e2" }, { id: "e3" }] };
	from.mockImplementation((table: string) => chainFor(table));

	({ default: handler } = await import("../../api/_incident-cron.js"));
	({ buildEvent, appendEvent, listEvents, OPS_EVENT_TYPES } = await import(
		"../../api/_ops-events.js"
	));

	// freeze Date only — keeps both cron runs in the same 5-min bucket
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-23T10:00:00.000Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("buildEvent — SPEC §4 envelope", () => {
	it("fills all 11 required fields with defaults", () => {
		const e = makeEvent({ payload: { ok: 1 } });
		expect(Object.keys(e).sort()).toEqual(
			[
				"actor",
				"correlationId",
				"deduplicationKey",
				"id",
				"payload",
				"priority",
				"resource",
				"source",
				"timestamp",
				"traceId",
				"type",
			].sort(),
		);
		expect(e.priority).toBe("normal");
		expect(e.correlationId).toBe(e.id);
		expect(typeof e.traceId).toBe("string");
		expect(e.traceId.length).toBeGreaterThan(0);
		expect(typeof e.timestamp).toBe("string");
		expect(e.deduplicationKey).toBe(`NEW_POST:test:${e.id}`);
	});

	it("ships the full SPEC §4 type catalog (held-out count)", () => {
		expect(OPS_EVENT_TYPES).toHaveLength(53);
		for (const t of [
			"NEW_POST",
			"CASE_REOPENED",
			"ERROR_SPIKE",
			"PERIODIC_HEALTH_CHECK",
			"QUEUE_FAILURE",
			"MODEL_DRIFT",
			"SECURITY_EVENT",
		]) {
			expect(OPS_EVENT_TYPES).toContain(t);
		}
		expect(OPS_EVENT_TYPES).not.toContain("NOT_A_REAL_EVENT");
	});

	it("rejects unknown types, missing fields, bad priority, oversize payload", () => {
		expect(() => makeEvent({ type: "BOGUS_EVENT" })).toThrow(/unknown event type/);
		expect(() =>
			buildEvent({ type: "NEW_POST", resource: "r", actor: "a", payload: {} }),
		).toThrow("source is required");
		expect(() =>
			buildEvent({ type: "NEW_POST", source: "s", resource: "r", actor: "a" }),
		).toThrow("payload object is required");
		expect(() =>
			makeEvent({ priority: "urgent" }),
		).toThrow(/unknown priority/);
		expect(() =>
			makeEvent({ payload: { blob: "x".repeat(16 * 1024) } }),
		).toThrow(/exceeds 16384 bytes/);
	});
});

describe("appendEvent — durable log, dedupe, caps, errors", () => {
	it("rejects an incomplete envelope", async () => {
		await expect(appendEvent({ id: "x" })).rejects.toThrow(
			"missing envelope field: type",
		);
	});

	it("dedupes by deduplicationKey into a single record", async () => {
		const e = makeEvent({ deduplicationKey: "bucket-1" });
		const r1 = await appendEvent(e);
		const r2 = await appendEvent(e);
		expect(r1.stored).toBe(true);
		expect(r2.stored).toBe(false);
		expect(r2.reason).toBe("duplicate");
		expect((settings.ops_event_log as { events: unknown[] }).events).toHaveLength(1);
	});

	it("caps the log at 500 entries, trimming oldest", async () => {
		for (let i = 0; i < 505; i++) {
			await appendEvent(makeEvent({ deduplicationKey: `cap-${i}`, payload: { i } }));
		}
		const log = settings.ops_event_log as { events: Array<{ payload: { i: number } }> };
		expect(log.events).toHaveLength(500);
		expect(log.events[0].payload.i).toBe(5);
		expect(log.events[499].payload.i).toBe(504);
	});

	it("throws on a failed write — failure never looks like success", async () => {
		await appendEvent(makeEvent({ deduplicationKey: "wf-1" }));
		state.settingsWriteFail = true;
		await expect(appendEvent(makeEvent({ deduplicationKey: "wf-2" }))).rejects.toThrow(
			"ops_event_log write failed",
		);
		expect((settings.ops_event_log as { events: unknown[] }).events).toHaveLength(1);
	});
});

describe("listEvents — independent re-read", () => {
	it("filters by type, since, and limit", async () => {
		await appendEvent(
			makeEvent({
				deduplicationKey: "k1",
				type: "NEW_POST",
				timestamp: "2026-01-01T00:00:00.000Z",
			}),
		);
		await appendEvent(
			makeEvent({
				deduplicationKey: "k2",
				type: "ERROR_SPIKE",
				timestamp: "2026-01-02T00:00:00.000Z",
			}),
		);
		await appendEvent(
			makeEvent({
				deduplicationKey: "k3",
				type: "NEW_POST",
				timestamp: "2026-01-03T00:00:00.000Z",
			}),
		);

		expect(await listEvents({ type: "NEW_POST" })).toHaveLength(2);
		expect(await listEvents({ since: "2026-01-02T00:00:00.000Z" })).toHaveLength(2);
		expect(await listEvents({ limit: 1 })).toHaveLength(1);
		expect(await listEvents()).toHaveLength(3);
	});
});

describe("GET /api/incident-cron — producer + read-back", () => {
	it("stores exactly one PERIODIC_HEALTH_CHECK for two runs in the same bucket, with measured metrics", async () => {
		const res1 = response();
		await handler({ method: "GET", query: { action: "run" } }, res1);
		expect(res1.statusCode).toBe(200);
		expect((res1.body as any).event.stored).toBe(true);

		const res2 = response();
		await handler({ method: "GET", query: { action: "run" } }, res2);
		expect((res2.body as any).event.stored).toBe(false);
		expect((res2.body as any).event.reason).toBe("duplicate");

		const log = settings.ops_event_log as { events: any[] };
		expect(log.events).toHaveLength(1);
		const ev = log.events[0];
		expect(ev.type).toBe("PERIODIC_HEALTH_CHECK");
		expect(ev.source).toBe("incident-cron");
		expect(ev.actor).toBe("system:incident-cron");
		expect(ev.priority).toBe("normal");
		const bucket = Math.floor(Date.now() / 300000) * 300000;
		expect(ev.deduplicationKey).toBe(`PERIODIC_HEALTH_CHECK:incident-cron:${bucket}`);
		expect(ev.payload).toMatchObject({
			error_rate: 0.01,
			api_p95_ms: 120,
			cache_hit_rate: 0.95,
			search_zero_rate: 0.02,
			post_count: 7,
			open_reports: 2,
			event_count: 3,
			worker_fail_rate: 0.25,
			worker_executions_1h: 4,
			incidents_created: 0,
			incidents_auto_resolved: 0,
		});
		expect(typeof ev.payload.db_query_ms).toBe("number");
	});

	it("never reports a failed event emit as success", async () => {
		state.settingsWriteFail = true;
		const res = response();
		await handler({ method: "GET", query: { action: "run" } }, res);
		const body = res.body as any;
		expect(body.event.stored).toBe(false);
		expect(body.event.reason).toBe("error");
		expect(
			body.errors.some((e: string) => e.includes("event emit failed")),
		).toBe(true);
		expect(body.incidents_created).toBe(0);
	});

	it("serves action=events as an independent read-back", async () => {
		const run = response();
		await handler({ method: "GET", query: { action: "run" } }, run);

		const res = response();
		await handler(
			{ method: "GET", query: { action: "events", type: "PERIODIC_HEALTH_CHECK" } },
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as any;
		expect(body.count).toBe(1);
		expect(body.events[0].type).toBe("PERIODIC_HEALTH_CHECK");

		const direct = await listEvents({ type: "PERIODIC_HEALTH_CHECK" });
		expect(direct.map((e) => e.id)).toEqual(body.events.map((e: any) => e.id));

		const none = response();
		await handler({ method: "GET", query: { action: "events", type: "ERROR_SPIKE" } }, none);
		expect((none.body as any).count).toBe(0);

		const capped = response();
		await handler({ method: "GET", query: { action: "events", limit: "0" } }, capped);
		expect((capped.body as any).count).toBe(0);
	});

	it("keeps the 400 message accurate for unknown actions", async () => {
		const res = response();
		await handler({ method: "GET", query: { action: "bogus" } }, res);
		expect(res.statusCode).toBe(400);
		const msg = String((res.body as any).error);
		expect(msg).toContain("run|metrics|health|events");
	});
});
