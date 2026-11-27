// Workforce Batch 6 (roster #31-36: platform reliability) — tests.
//
// Each worker proves a REAL action against mocked DB state and verifies
// by independent re-read: #31 performance-intel (real latencies + error
// rate + durable vitals → regression flags), #32 db-intel (read-only
// table stats → issue flags), #33 queue-recovery (stale claims / due
// backoff / dependency promotion → state changes), #34 notification-intel
// (dead-letter drain with read-back verified delivery), #35
// incident-recovery (metric-recovered incidents → RESOLVED), #36
// security-ops (real security audit events → unresolved flags).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => {}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn(),
}));

import { runPerformanceIntel } from "../../api/_performance.js";
import { runDbIntel } from "../../api/_db-stats.js";
import { runQueueRecovery } from "../../api/_work-queue.js";
import { runNotificationIntel } from "../../api/_notification-delivery.js";
import { runIncidentRecovery } from "../../api/_incidents.js";
import { runSecurityOps } from "../../api/_security-events.js";

// ── tiny table router + stateful KV ───────────────────────────────
type Table = Record<string, any>;

const PASSTHROUGH = [
	"select", "eq", "neq", "in", "like", "ilike", "gte", "lte", "gt", "lt",
	"order", "limit", "range", "or", "not", "is", "filter", "match",
	"insert", "delete",
];

function makeTable(cfg: { data?: unknown; error?: unknown; count?: number } = {}): Table {
	const q: Table = {};
	for (const m of PASSTHROUGH) q[m] = vi.fn(() => q);
	q.then = (resolve: (v: unknown) => void) =>
		Promise.resolve({
			data: cfg.data ?? [],
			error: cfg.error ?? null,
			...(cfg.count !== undefined ? { count: cfg.count } : {}),
		}).then(resolve);
	return q;
}

// Stateful settings KV: persists upserts AND the read-modify-write
// update path (_work-queue saveQueue / _incidents saveIncidents), and
// serves maybeSingle plus like-prefix scans (notification store reads).
function makeSettingsKV(state: {
	kv: Map<string, any>;
	failWrites?: boolean;
}): Table {
	const q: Table = {};
	let eqKey: unknown = null;
	let likePrefix: string | null = null;
	let mode: "select" | "upsert" | "update" = "select";
	let last: Table | null = null;
	let pendingUpdate: Table | null = null;
	for (const m of PASSTHROUGH) {
		q[m] = vi.fn((...args: unknown[]) => {
			if (m === "eq" && args[0] === "key") eqKey = args[1];
			if (m === "like" && args[0] === "key")
				likePrefix = String(args[1] ?? "").replace(/%/g, "");
			return q;
		});
	}
	q.upsert = vi.fn((rec: Table) => {
		if (state.failWrites) throw new Error("kv write failed");
		state.kv.set(String(rec.key), rec.value);
		last = rec;
		mode = "upsert";
		return q;
	});
	// update is called BEFORE eq in a read-modify-write chain, so the
	// persist happens at then-time when eqKey is known.
	q.update = vi.fn((rec: Table) => {
		if (state.failWrites) throw new Error("kv write failed");
		pendingUpdate = rec;
		mode = "update";
		return q;
	});
	q.then = (resolve: (v: unknown) => void) => {
		if (mode === "upsert") {
			const written = last;
			mode = "select";
			return Promise.resolve({ data: written ? [written] : [], error: null }).then(resolve);
		}
		if (mode === "update") {
			const rec = pendingUpdate;
			pendingUpdate = null;
			mode = "select";
			const ok = Boolean(rec && eqKey != null);
			if (ok) state.kv.set(String(eqKey), rec.value);
			return Promise.resolve({
				data: ok ? [{ key: eqKey, value: rec.value }] : [],
				error: null,
			}).then(resolve);
		}
		let data: unknown[] = [];
		if (eqKey != null) {
			data = state.kv.has(String(eqKey))
				? [{ key: eqKey, value: state.kv.get(String(eqKey)) }]
				: [];
		} else if (likePrefix != null) {
			data = [...state.kv.entries()]
				.filter(([k]) => k.startsWith(likePrefix as string))
				.map(([key, value]) => ({ key, value }));
		}
		return Promise.resolve({ data, error: null }).then(resolve);
	};
	q.maybeSingle = vi.fn(async () => ({
		data:
			eqKey != null && state.kv.has(String(eqKey))
				? { key: eqKey, value: state.kv.get(String(eqKey)) }
				: null,
		error: null,
	}));
	q.single = q.maybeSingle;
	return q;
}

function router(tables: Record<string, () => Table>) {
	return (table: string) => (tables[table] ? tables[table]() : makeTable({}));
}

beforeEach(() => {
	mockFrom.mockImplementation(router({}));
});

// ── #31 Performance Intelligence ──────────────────────────────────
describe("#31 performance-intel", () => {
	it("measures real latencies and flags error-rate/vitals regressions", async () => {
		const kv = new Map<string, any>();
		kv.set("vitals:durable", {
			metrics: { LCP: { good: 90, poor: 10, total: 100 } },
		});
		let errorCount = 0;
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
				activity_logs: () => makeTable({ count: errorCount }),
			}),
		);

		const first = await runPerformanceIntel({});

		expect(first.ok).toBe(true);
		expect(first.verified).toBe(true);
		// Real reads: 5 measured probes (4 hot-path tables + db latency).
		expect(first.snapshot.tables_measured).toBe(5);
		expect(first.snapshot.error_rate_per_hour).toBe(0);
		expect(first.snapshot.vitals.LCP).toBe(10);
		// First snapshot: nothing to compare against yet — no false positive.
		expect(first.snapshot.regressed).toBe(false);
		expect(kv.get("performance_intel:latest")?.tables_measured).toBe(5);

		// The error rate climbs 0 → 20 (past the 5 tolerance) and the LCP
		// poor-rate climbs 10 → 30 (past the 5-point tolerance).
		errorCount = 20;
		kv.set("vitals:durable", {
			metrics: { LCP: { good: 70, poor: 30, total: 100 } },
		});
		const second = await runPerformanceIntel({});

		expect(second.ok).toBe(true);
		expect(second.verified).toBe(true);
		expect(second.snapshot.regressed).toBe(true);
		const kinds: string[] = second.snapshot.regressions.map((r: any) => r.kind);
		expect(kinds).toContain("error_rate");
		expect(kinds).toContain("vitals_poor_rate");
		const errReg = second.snapshot.regressions.find(
			(r: any) => r.kind === "error_rate",
		);
		expect(errReg.before).toBe(0);
		expect(errReg.now).toBe(20);
	});

	it("failed reads are honest nulls, never fabricated regressions (disable test)", async () => {
		const kv = new Map<string, any>();
		// A previous baseline exists (error rate 50), but the error read
		// fails now — a null read must not flag a regression or a zero.
		kv.set("performance_intel:latest", {
			generated_at: new Date(Date.now() - 60000).toISOString(),
			tables_measured: 5,
			table_latencies: { posts_ms: 5, comments_ms: 5, reports_ms: 5, logs_ms: 5 },
			db_latency_ms: 5,
			error_rate_per_hour: 50,
			api_p95_ms: 0,
			vitals: { LCP: 10 },
		});
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
				activity_logs: () => makeTable({ error: "db down" }),
			}),
		);

		const r = await runPerformanceIntel({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.snapshot.error_rate_per_hour).toBeNull();
		expect(r.snapshot.regressions).toEqual([]);
		// The fresh snapshot was persisted and re-read (verified above).
		expect(kv.get("performance_intel:latest")?.error_rate_per_hour).toBeNull();
	});
});

// ── #32 Database Intelligence ─────────────────────────────────────
describe("#32 db-intel", () => {
	it("measures real table stats read-only and flags an issue table", async () => {
		const kv = new Map<string, any>();
		let down = false;
		mockFrom.mockImplementation((table: string) => {
			if (table === "settings") return makeSettingsKV({ kv });
			// One table erroring → a real issue flag; others healthy counts.
			if (table === "reports")
				return down ? makeTable({ error: "relation missing" }) : makeTable({ count: 3 });
			return makeTable({ count: 7 });
		});

		const r = await runDbIntel({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.snapshot.tables_measured).toBe(14);
		expect(r.snapshot.health_score).toBe(100);
		expect(r.snapshot.status).toBe("healthy");
		expect(r.snapshot.read_only).toBe(true);
		expect(r.snapshot.issues).toEqual([]);
		expect(kv.get("db_intel:latest")?.health_score).toBe(100);

		down = true;
		const bad = await runDbIntel({});

		expect(bad.ok).toBe(true);
		expect(bad.verified).toBe(true);
		expect(bad.snapshot.issues).toHaveLength(1);
		expect(bad.snapshot.issues[0].table).toBe("reports");
		expect(bad.snapshot.issues[0].status).toBe("error");
		expect(bad.snapshot.health_score).toBe(90);
	});

	it("a failed persistence is reported, never faked as verified (disable test)", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv, failWrites: true }),
				activity_logs: () => makeTable({ error: "db down" }),
			}),
		);

		const r = await runDbIntel({});

		// Unavailable stays FAILED — never converted into a fake pass.
		expect(r.ok).toBe(false);
		expect(typeof r.error).toBe("string");
		expect(r.error.length).toBeGreaterThan(0);
	});
});

// ── #33 Queue Recovery ────────────────────────────────────────────
describe("#33 queue-recovery", () => {
	it("recovers stale claims, releases due backoff, promotes ready deps", async () => {
		const kv = new Map<string, any>();
		const now = Date.now();
		kv.set("work_queue", {
			jobs: [
				{
					id: "j-stale",
					type: "incident.triage",
					state: "CLAIMED",
					priority: "high",
					attempts: 0,
					maxAttempts: 3,
					timeout: 300000,
					createdAt: new Date(now - 600000).toISOString(),
					claimedAt: new Date(now - 600000).toISOString(),
					heartbeatAt: new Date(now - 600000).toISOString(),
					dependencies: [],
				},
				{
					id: "j-due",
					type: "incident.triage",
					state: "RETRYING",
					priority: "medium",
					attempts: 1,
					maxAttempts: 3,
					timeout: 300000,
					createdAt: new Date(now - 600000).toISOString(),
					nextRetryAt: new Date(now - 60000).toISOString(),
					dependencies: [],
				},
				{
					id: "j-waiting",
					type: "report.enrich",
					state: "WAITING",
					priority: "low",
					attempts: 0,
					maxAttempts: 3,
					timeout: 300000,
					createdAt: new Date(now - 600000).toISOString(),
					dependencies: ["j-done"],
				},
				{
					id: "j-done",
					type: "report.enrich",
					state: "COMPLETED",
					priority: "low",
					attempts: 1,
					maxAttempts: 3,
					timeout: 300000,
					createdAt: new Date(now - 700000).toISOString(),
					dependencies: [],
				},
			],
		});
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
				activity_logs: () => makeTable({ data: [] }),
			}),
		);

		const r = await runQueueRecovery({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.recovered).toBe(1); // stale CLAIMED → RETRYING
		expect(r.released).toBe(1); // due RETRYING → PENDING
		expect(r.promoted).toBe(1); // WAITING (deps done) → PENDING
		expect(r.blocked).toBe(0);

		// Independent re-read: the state changes are visible in the store.
		const jobs = kv.get("work_queue").jobs;
		const byId = Object.fromEntries(jobs.map((j: any) => [j.id, j]));
		expect(byId["j-stale"].state).toBe("RETRYING"); // recovered, attempt burned
		expect(byId["j-stale"].attempts).toBe(1);
		expect(byId["j-due"].state).toBe("PENDING");
		expect(byId["j-waiting"].state).toBe("PENDING");
	});

	it("an empty queue is an honest no-op (disable/stand-down test)", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
				activity_logs: () => makeTable({ data: [] }),
			}),
		);

		const r = await runQueueRecovery({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.released).toBe(0);
		expect(r.recovered).toBe(0);
		expect(r.promoted).toBe(0);
		// No queue write happened (the KV stays absent — cheap no-op).
		expect(kv.get("work_queue")).toBeUndefined();
	});
});

// ── #34 Notification Intelligence ─────────────────────────────────
describe("#34 notification-intel", () => {
	it("drains a dead-letter entry with read-back verified delivery", async () => {
		const kv = new Map<string, any>();
		const entry = {
			id: "notif_test1234_ab12",
			type: "warning",
			title: "Strike notice",
			body: "You received a strike",
			read: false,
			created_at: new Date().toISOString(),
		};
		kv.set("notification_dead_letters", {
			entries: [
				{
					id: "dl_notif_test1234_ab12",
					anon_id: "anon_user1234567",
					entry,
					reason: "write_failed",
					attempts: 0,
					status: "pending",
					first_failed_at: new Date().toISOString(),
					last_attempt_at: null,
				},
			],
		});
		// The user's store accepts the append (read-back will verify).
		kv.set("notifications:anon_user1234567", {
			notifications: [],
			updated_at: new Date().toISOString(),
		});
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
				activity_logs: () => makeTable({ data: [] }),
			}),
		);

		const r = await runNotificationIntel({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.delivered).toBe(1);
		expect(r.dead).toBe(0);
		// Independent verification: the notification is REALLY in the store.
		const store = kv.get("notifications:anon_user1234567").notifications;
		expect(store.some((n: any) => n.id === "notif_test1234_ab12")).toBe(true);
		// The ledger pruned the delivered entry.
		const ledger = kv.get("notification_dead_letters").entries;
		expect(ledger.some((e: any) => e.status === "delivered")).toBe(false);
		expect(ledger.some((e: any) => e.status === "pending")).toBe(false);
		// The snapshot persisted with the verified retry.
		expect(kv.get("notification_intel:latest")?.retry_delivered).toBe(1);
	});

	it("no notification surface is an honest no-op (disable/stand-down test)", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({ settings: () => makeSettingsKV({ kv }) }),
		);

		const r = await runNotificationIntel({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.snapshot.stores_scanned).toBe(0);
		// No KV write happened — no fabricated zero report.
		expect(kv.get("notification_intel:latest")).toBeUndefined();
	});
});

// ── #35 Incident Recovery ─────────────────────────────────────────
describe("#35 incident-recovery", () => {
	it("auto-resolves recovered incidents and leaves non-recovered open", async () => {
		const kv = new Map<string, any>();
		// error_rate is healthy again; cache_hit_rate has NOT recovered.
		kv.set("system_metrics", {
			error_rate: 0.01,
			api_p95_ms: 100,
			cache_hit_rate: 0.4,
			worker_fail_rate: 0.1,
			collected_at: new Date().toISOString(),
		});
		kv.set("platform_incidents", {
			incidents: [
				{
					id: "INC-api1",
					status: "DETECTED",
					severity: "medium",
					title: "API error rate elevated at 8.0%",
					affected_service: "api",
					detected_at: new Date(Date.now() - 3600000).toISOString(),
					resolved_at: null,
					worker_assignments: [],
					timeline: [],
				},
				{
					id: "INC-cache1",
					status: "ASSIGNED",
					severity: "high",
					title: "Cache hit rate dropped to 40%",
					affected_service: "cache",
					detected_at: new Date(Date.now() - 3600000).toISOString(),
					resolved_at: null,
					worker_assignments: [],
					timeline: [],
				},
			],
		});
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
				activity_logs: () => makeTable({ data: [] }),
			}),
		);

		const r = await runIncidentRecovery({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.checked).toBe(2);
		expect(r.recovered).toEqual(["INC-api1"]);
		// Independent re-read: RESOLVED with timeline + resolved_at.
		const incidents = kv.get("platform_incidents").incidents;
		const byId = Object.fromEntries(incidents.map((i: any) => [i.id, i]));
		expect(byId["INC-api1"].status).toBe("RESOLVED");
		expect(byId["INC-api1"].resolved_at).toBeTruthy();
		expect(
			byId["INC-api1"].timeline.some((t: any) => t.event === "auto_resolved"),
		).toBe(true);
		expect(byId["INC-cache1"].status).toBe("ASSIGNED"); // stays open
	});

	it("no incidents is an honest no-op (disable/stand-down test)", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({ settings: () => makeSettingsKV({ kv }) }),
		);

		const r = await runIncidentRecovery({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.checked).toBe(0);
		expect(r.recovered).toEqual([]);
		// No incident write happened.
		expect(kv.get("platform_incidents")).toBeUndefined();
	});
});

// ── #36 Security Operations ───────────────────────────────────────
describe("#36 security-ops", () => {
	it("flags unresolved high-severity events and persists a verified snapshot", async () => {
		const kv = new Map<string, any>();
		const rows = [
			{
				id: "a1",
				action: "security.injection_detected",
				actor_type: "system",
				resource_type: "security",
				details: {
					severity: "critical",
					identity: "anon_evil1",
					ip: "9.9.9.9",
					patterns_matched: 3,
				},
				timestamp: new Date(Date.now() - 60000).toISOString(),
			},
			{
				id: "a2",
				action: "security.rate_limit_abuse",
				actor_type: "system",
				resource_type: "security",
				details: {
					level: "WARN",
					ip: "8.8.8.8",
					requests_per_minute: 150,
					action_taken: "rate limited",
				},
				timestamp: new Date(Date.now() - 120000).toISOString(),
			},
		];
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
				audit_logs: () => makeTable({ data: rows }),
			}),
		);

		const r = await runSecurityOps({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.events_scanned).toBe(2);
		// The unresolved critical injection is flagged; the rate-limit event
		// records its action_taken → not flagged.
		expect(r.flagged).toBe(1);
		expect(r.snapshot.flagged[0].type).toBe("injection.detected");
		expect(r.snapshot.flagged[0].severity).toBe("critical");
		expect(kv.get("security_ops:latest")?.events_scanned).toBe(2);
	});

	it("no security events is an honest no-op (disable/stand-down test)", async () => {
		const kv = new Map<string, any>();
		mockFrom.mockImplementation(
			router({
				settings: () => makeSettingsKV({ kv }),
				audit_logs: () => makeTable({ data: [] }),
			}),
		);

		const r = await runSecurityOps({});

		expect(r.ok).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.events_scanned).toBe(0);
		// No KV write happened — no fabricated "clean" snapshot.
		expect(kv.get("security_ops:latest")).toBeUndefined();
	});
});
