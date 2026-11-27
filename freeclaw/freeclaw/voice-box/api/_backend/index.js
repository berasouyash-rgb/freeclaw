// ─── Reliability composition root ───────────────────────────────
// This is the only place that knows how the pieces fit together:
//
//   adapters      Supabase (primary) + Firebase (standby)
//   control plane CAS state, leases, idempotency, dead letters
//   health        lazy hysteretic probes
//   failover      ONE authority for mode/epoch (never per-client)
//   router        request-path reads/writes over the controller
//   replicator    primary → standby convergence, watermark + full scan
//
// Design constraints that shaped it:
//
//   1. Both feature flags default OFF. Turning this on is an explicit,
//      reversible operator action, not something a deploy does silently.
//   2. A missing standby is NOT an error. The system runs primary-only and
//      reports `standby_configured:false`; it never pretends to be redundant.
//   3. A write is only reported as saved when there is a durable path back to
//      the primary. During failover that means a durable control plane (Redis
//      REST) plus a dead-letter record. The process-local memory control plane
//      cannot provide that, so the write fails closed instead of lying.
//   4. Reads may fall back for infrastructure errors only. Application and
//      auth errors never move traffic.
//   5. The facade never fabricates rows. If no adapter is usable it throws an
//      AdapterUnavailableError, which the route layer renders as an honest
//      "temporarily unavailable", never as an empty list.

import { AdapterUnavailableError, BackendError, ReadOnlyError } from "./errors.js";
import { getControlPlane } from "./control-plane.js";
import { HealthMonitor } from "./health.js";
import { FailoverController, MODES } from "./failover.js";
import { BackendRouter } from "./router.js";
import { ConflictResolver } from "./conflict.js";
import {
	IdempotencyStore,
	deriveIdempotencyKey,
	runIdempotent,
} from "./idempotency.js";
import { DeadLetterQueue } from "./dlq.js";
import { Replicator } from "./replication.js";
import { createSupabaseAdapter } from "./adapters/supabase-adapter.js";
import { createFirebaseAdapterFromEnv } from "./adapters/firebase-adapter.js";
import { VOICEFLOW_TABLES, inScope, tableMeta } from "./tables.js";
// The write-side mirror is a separate, always-on path: it copies committed
// Supabase rows to Firestore from `_db-client.js`, independent of the
// failover flags. Reporting it here means one dashboard answers "is the
// standby actually current?" instead of two surfaces disagreeing.
import { mirrorStats, flushMirrorQueue } from "../_mirror.js";
// Durable writes: rows the primary refused are recorded in Firestore and
// replayed later. Reported here so "is anything stuck?" has one answer.
import { outboxStats } from "../_outbox.js";

export const FLAGS = Object.freeze({
	FAILOVER: "RELIABILITY_FAILOVER_ENABLED",
	REPLICATION: "RELIABILITY_REPLICATION_ENABLED",
});

const PAYLOAD_LIMIT = 4_000;

/** Truthy env flag: "1", "true", "yes", "on" (case-insensitive). */
export function flagEnabled(env, name) {
	const raw = String(env?.[name] ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function readFlags(env = process.env) {
	return {
		failover: flagEnabled(env, FLAGS.FAILOVER),
		replication: flagEnabled(env, FLAGS.REPLICATION),
	};
}

function safePayload(args) {
	try {
		const json = JSON.stringify(args);
		if (typeof json !== "string") return null;
		return json.length > PAYLOAD_LIMIT ? `${json.slice(0, PAYLOAD_LIMIT)}…` : json;
	} catch {
		return null;
	}
}

function shortError(err) {
	return String(err?.message || err || "unknown error").slice(0, 300);
}

async function buildPrimaryFromEnv(env) {
	const url =
		env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
	if (!url) {
		throw new AdapterUnavailableError("supabase", "missing Supabase URL");
	}
	// Imported lazily so unit tests never need Supabase credentials and a
	// missing config surfaces as an adapter problem, not an import crash.
	const mod = await import("../_db-client.js");
	return createSupabaseAdapter(mod.default);
}

function buildStandbyFromEnv(env) {
	try {
		return createFirebaseAdapterFromEnv(env);
	} catch (err) {
		if (err instanceof AdapterUnavailableError) return null;
		throw err;
	}
}

/**
 * The backend facade. One instance per process; construction is injectable so
 * tests use MemoryAdapter + MemoryControlPlane and never touch a live system.
 */
export class Backend {
	/**
	 * @param {{
	 *   env?: NodeJS.ProcessEnv,
	 *   primary?: object|null,
	 *   standby?: object|null,
	 *   primaryError?: Error|null,
	 *   controlPlane?: object,
	 *   health?: HealthMonitor,
	 *   failover?: FailoverController,
	 *   router?: BackendRouter|null,
	 *   replicator?: Replicator|null,
	 *   dlq?: DeadLetterQueue,
	 *   idempotency?: IdempotencyStore,
	 *   conflict?: ConflictResolver,
	 *   now?: () => number,
	 *   logger?: object,
	 * }} [cfg]
	 */
	constructor(cfg = {}) {
		this.env = cfg.env || process.env;
		this.now = cfg.now || Date.now;
		this.logger = cfg.logger || console;
		this.flags = cfg.flags || readFlags(this.env);

		this.primary = cfg.primary || null;
		this.standby = cfg.standby || null;
		this.primaryError = cfg.primaryError || null;

		this.controlPlane = cfg.controlPlane || getControlPlane(this.env);
		this.dlq = cfg.dlq || new DeadLetterQueue({ controlPlane: this.controlPlane, now: this.now });
		this.idempotency =
			cfg.idempotency ||
			new IdempotencyStore({ controlPlane: this.controlPlane, now: this.now });
		this.conflict =
			cfg.conflict ||
			new ConflictResolver({ controlPlane: this.controlPlane, now: this.now });

		this.health =
			cfg.health ||
			new HealthMonitor({
				now: this.now,
				failureThreshold: 3,
				recoveryThreshold: 5,
				probeTimeoutMs: 2_500,
				intervalMs: 5_000,
			});

		if (this.primary) this.health.register(this.primary.name, () => this.primary.health());
		if (this.standby) this.health.register(this.standby.name, () => this.standby.health());

		this.failover =
			cfg.failover ||
			new FailoverController({
				primary: this.primary,
				standby: this.standby,
				controlPlane: this.controlPlane,
				health: this.health,
				now: this.now,
				allowStandbyWrites: false,
			});

		// A router is only meaningful with two distinct adapters and the flag on.
		this.router =
			cfg.router !== undefined
				? cfg.router
				: this.flags.failover && this.primary && this.standby
					? new BackendRouter({
							primary: this.primary,
							secondary: this.standby,
							failover: this.failover,
							controlPlane: this.controlPlane,
							now: this.now,
						})
					: null;

		this.replicator =
			cfg.replicator !== undefined
				? cfg.replicator
				: this.flags.replication && this.primary && this.standby
					? new Replicator({
							source: this.primary,
							target: this.standby,
							controlPlane: this.controlPlane,
							dlq: this.dlq,
							now: this.now,
						})
					: null;
	}

	/** True when at least one data plane can serve traffic. */
	get available() {
		return Boolean(this.primary || this.standby);
	}

	/** True when a standby write can be durably recorded for reconciliation. */
	get recorderDurable() {
		return this.controlPlane?.durable === true;
	}

	async currentMode() {
		return this.failover.currentMode();
	}

	/**
	 * Raw read envelope: `{data, backend, failed_over}`.
	 * @param {string} table
	 * @param {object} [opts]
	 */
	async read(table, opts = {}) {
		if (!inScope(table)) throw new BackendError(`Table "${table}" is outside the VoiceFlow scope`, { code: "OUT_OF_SCOPE" });
		if (!this.primary && !this.standby) {
			throw new AdapterUnavailableError("backend", shortError(this.primaryError || "no data plane configured"));
		}
		if (this.router) return this.router.read(table, opts);
		const adapter = this.primary || this.standby;
		const data = await adapter.select(table, opts);
		return { data, backend: adapter.name, failed_over: false };
	}

	/** Rows only — the shape most callers want. */
	async list(table, opts = {}) {
		const result = await this.read(table, opts);
		return Array.isArray(result.data) ? result.data : [];
	}

	/** Single row by primary key. Returns null when absent. */
	async get(table, id, opts = {}) {
		const meta = tableMeta(table);
		const rows = await this.list(table, {
			...opts,
			where: { ...(opts.where || {}), [meta.pk]: id },
			limit: 1,
		});
		return rows[0] || null;
	}

	/**
	 * Conflict-checked, idempotent write.
	 *
	 * @param {string} table
	 * @param {"insert"|"update"|"upsert"|"remove"} op
	 * @param {unknown[]} args
	 * @param {{ expectedVersion?: unknown, force?: boolean, actorId?: string,
	 *           idempotencyKey?: string, clientKey?: string, enforceConflict?: boolean }} [ctx]
	 */
	async write(table, op, args = [], ctx = {}) {
		if (!inScope(table)) {
			throw new BackendError(`Table "${table}" is outside the VoiceFlow scope`, { code: "OUT_OF_SCOPE" });
		}
		if (!["insert", "update", "upsert", "remove"].includes(op)) {
			throw new BackendError(`Unsupported write operation "${op}"`, { code: "BAD_OPERATION" });
		}
		if (!this.primary && !this.standby) {
			throw new AdapterUnavailableError("backend", shortError(this.primaryError || "no data plane configured"));
		}

		const run = async () => {
			const prepared = await this._prepareWrite(table, op, args, ctx);
			const result = await this._executeWrite(table, op, args, ctx);
			if (prepared) {
				await this.conflict.commitWrite(table, prepared.id, prepared.prepared);
			}
			return result;
		};

		const key = this._idempotencyKey(table, op, args, ctx);
		if (!key) return run();

		const outcome = await runIdempotent(this.idempotency, key, run, {
			table,
			op,
			actor: ctx.actorId || "anon",
		});
		if (outcome.inFlight) {
			throw new BackendError(
				"A matching save is already in progress — retry in a moment.",
				{ code: "WRITE_IN_FLIGHT", retryable: true },
			);
		}
		return outcome.replayed ? { ...outcome.result, replayed: true } : outcome.result;
	}

	_idempotencyKey(table, op, args, ctx) {
		const clientKey = ctx.clientKey || ctx.idempotencyKey;
		if (!clientKey) return null;
		return deriveIdempotencyKey({
			scope: "write",
			actorId: ctx.actorId,
			entity: table,
			id: op === "update" || op === "remove" ? String(args[0]) : undefined,
			op,
			clientKey,
		});
	}

	async _prepareWrite(table, op, args, ctx) {
		if (op === "insert" || op === "upsert") return null;
		if (ctx.enforceConflict === false) return null;

		const meta = tableMeta(table);
		const id = args[0];
		if (id === undefined || id === null) {
			throw new BackendError(`${op} requires a ${meta.pk}`, { code: "MISSING_ID" });
		}

		// Deletes are intentional; only verify a version when the caller
		// supplied one. Updates on versioned tables are always checked.
		if (op === "remove" && ctx.expectedVersion == null) return null;

		const current = await this.get(table, id);
		if (!current) {
			throw new BackendError(`${table}/${id} was not found`, { code: "NOT_FOUND" });
		}
		const prepared = await this.conflict.prepareWrite({
			table,
			id,
			current,
			expectedVersion: ctx.expectedVersion,
			force: ctx.force === true,
			actorId: ctx.actorId,
		});
		return { id, prepared };
	}

	async _executeWrite(table, op, args, ctx) {
		const hooks = this._writeHooks(table, op, args);

		// Flag off: behave like today's system — primary only, no fallback.
		if (!this.flags.failover || !this.router) {
			const adapter = this.primary || this.standby;
			if (!adapter) {
				throw new AdapterUnavailableError("backend", "no data plane configured");
			}
			const data = await adapter[op](table, ...args);
			return { data, backend: adapter.name, pending_sync: false };
		}

		return this.router.write(table, op, args, hooks);
	}

	_writeHooks(table, op, args) {
		const durable = this.recorderDurable;
		if (!durable) return { hasRecorder: false };
		return {
			hasRecorder: true,
			onFallbackWrite: async (event) => {
				// The standby accepted the write; record it so it can be replayed
				// onto the primary after recovery. This is the difference between
				// "pending sync" and a lost edit.
				await this.dlq.push({
					table,
					op,
					source: "failover-write",
					error: "standby write awaiting reconciliation",
					payload: { args: safePayload(args), epoch: event?.epoch ?? null },
					meta: { backend: event?.backend || null, at: event?.at || null },
				});
			},
		};
	}

	/** Drives health evaluation; cheap when inside the throttle window. */
	async evaluate(opts = {}) {
		if (!this.flags.failover) {
			return { mode: MODES.PRIMARY, changed: false, reason: "failover-disabled" };
		}
		return this.failover.evaluate(opts);
	}

	/** Operator snapshot for the reliability dashboard. Never mutates state. */
	async status() {
		const [failover, replication, dlqSize] = await Promise.all([
			this.failover.status(),
			this.replicator ? this.replicator.status() : Promise.resolve(null),
			this.dlq.size().catch(() => null),
		]);

		// Mirror counters are process-local. In a serverless deployment each warm
		// instance has its own, so these describe THIS instance, not the fleet —
		// `pending > 0` is the signal that matters, and it is never faked.
		const mirror = mirrorStats();
		const outbox = outboxStats();

		return {
			available: this.available,
			enabled: { ...this.flags },
			mode: failover.mode,
			active: failover.mode === MODES.FAILOVER ? "standby" : "primary",
			epoch: failover.epoch,
			since: failover.since,
			reason: failover.reason,
			stale: failover.stale,
			standby_configured: failover.standby_configured,
			control_plane: failover.control_plane,
			recorder_durable: this.recorderDurable,
			write_path: {
				idempotency: true,
				conflict_rules: true,
				standby_writes: failover.allow_standby_writes === true,
				recorder_durable: this.recorderDurable,
			},
			adapters: {
				primary: this.primary ? { name: this.primary.name, capabilities: this.primary.capabilities } : null,
				standby: this.standby ? { name: this.standby.name, capabilities: this.standby.capabilities } : null,
				primary_error: this.primaryError ? shortError(this.primaryError) : null,
			},
			health: failover.health,
			replication,
			// Primary is always Supabase; the standby copy is written on the write
			// path itself. `lagging` is derived, never assumed.
			standby_copy: {
				primary: "supabase",
				standby: "firebase",
				transport: mirror.transport,
				configured: mirror.configured,
				lagging: mirror.pending > 0 || mirror.failed > 0,
				...mirror,
			},
			write_outbox: outbox,
			// A silent gap is the dangerous state: redundancy that looks present
			// and is empty. These are raised from observed facts only, never from
			// an assumption that configuration implies health.
			warnings: this.warnings(mirror, outbox),
			dlq_size: dlqSize,
			scope: { tables: VOICEFLOW_TABLES.length },
		};
	}

	/**
	 * Reliability warnings for the standby copy and the write outbox.
	 *
	 * Severity `critical` means a Supabase outage is NOT covered right now.
	 * Each one names the exact remedy so the gap can be closed before it matters
	 * — that is the whole point: never discover it during the outage.
	 */
	warnings(mirror, outbox) {
		const warnings = [];

		if (!mirror.configured) {
			warnings.push({
				code: "STANDBY_NOT_CONFIGURED",
				severity: "critical",
				message:
					"The Firebase standby copy is not configured: no rows are being copied, so a Supabase outage will surface to users as an error.",
				remedy:
					"Set FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY) in the deployment environment.",
			});
			warnings.push({
				code: "WRITE_OUTBOX_UNAVAILABLE",
				severity: "critical",
				message:
					"Writes refused while Supabase is unavailable cannot be recorded for replay (the outbox lives in Firestore), so those edits still fail closed.",
				remedy:
					"Same credential as the standby copy; the `__outbox` collection is written with the same service account.",
			});
		} else if (outbox.failed > 0) {
			warnings.push({
				code: "WRITE_OUTBOX_UNAVAILABLE",
				severity: "warning",
				message: `Recording a refused write for replay failed ${outbox.failed} time(s) (last: ${outbox.lastError || "unknown"}).`,
				remedy: "Check the Firestore credential and IAM on the `__outbox` collection.",
			});
		}

		if (mirror.configured && mirror.pending > 0) {
			warnings.push({
				code: "STANDBY_LAGGING",
				severity: "warning",
				message: `${mirror.pending} standby copy operation(s) are queued for retry; the standby is behind the primary.`,
				remedy:
					"Run the reliability action `flush-standby-copy`, or wait for the scheduled tick to drain the queue.",
			});
		}
		if (mirror.configured && mirror.failed > 0) {
			warnings.push({
				code: "STANDBY_FAILING",
				severity: "warning",
				message: `The standby copy has failed ${mirror.failed} delivery attempt(s) (last: ${mirror.lastError || "unknown"}).`,
				remedy:
					"Verify the service account still has Firestore write access and that the project id matches the standby.",
			});
		}

		if (outbox.pending > 0) {
			warnings.push({
				code: "WRITES_AWAITING_REPLAY",
				severity: "warning",
				message: `${outbox.pending} write(s) were accepted during a primary outage and are waiting to be replayed onto Supabase.`,
				remedy:
					"Run the reliability action `outbox-replay` once Supabase is healthy; replay stops at the first failure by design.",
			});
		}

		return warnings;
	}

	/**
	 * Drains the standby copy's retry queue. Safe to call repeatedly; returns
	 * zeros when nothing is queued or credentials are absent.
	 */
	async flushStandbyCopy(opts = {}) {
		return flushMirrorQueue(opts);
	}

	/**
	 * Operator drill. Failover/recovery refuses in production unless
	 * `allowProduction` is passed; replication/verify are read-only on the
	 * primary side and therefore safe.
	 *
	 * @param {{ action: "failover"|"recover"|"replicate"|"verify",
	 *           reason?: string, allowProduction?: boolean,
	 *           tables?: string[], reset?: boolean }} req
	 */
	async drill(req = {}) {
		const action = req.action;
		const reason = req.reason || "operator drill";

		if (action === "failover") {
			if (!this.standby) {
				throw new BackendError("No standby is configured — nothing to fail over to.", {
					code: "NO_STANDBY",
				});
			}
			return this.failover.forceFailover(reason, {
				allowProduction: req.allowProduction === true,
			});
		}

		if (action === "recover") {
			return this.failover.forceRecover(reason);
		}

		if (action === "replicate") {
			return this.replicate({ tables: req.tables, reset: req.reset === true });
		}

		if (action === "verify") {
			return this.verify({ tables: req.tables });
		}

		throw new BackendError(`Unknown drill action "${action}"`, { code: "BAD_ACTION" });
	}

	/** Primary → standby convergence. Refuses outside primary mode. */
	async replicate(opts = {}) {
		if (!this.flags.replication) {
			return { skipped: true, reason: `${FLAGS.REPLICATION} is off` };
		}
		if (!this.replicator) {
			return { skipped: true, reason: "standby is not configured" };
		}
		const { mode } = await this.failover.currentMode();
		return this.replicator.runCycle({ ...opts, mode });
	}

	/** Row-level comparison against the standby. */
	async verify(opts = {}) {
		if (!this.replicator) {
			return { skipped: true, reason: "standby is not configured" };
		}
		const tables = opts.tables || VOICEFLOW_TABLES;
		const results = [];
		for (const table of tables) {
			try {
				results.push({ table, ...(await this.replicator.verifyTable(table, opts)) });
			} catch (err) {
				results.push({ table, ok: false, error: shortError(err), code: err?.code || null });
			}
		}
		return {
			ok: results.every((r) => r.ok !== false),
			tables: results.length,
			results,
		};
	}
}

/** Builds a backend from environment, tolerating a missing standby. */
export async function createBackend(opts = {}) {
	const env = opts.env || process.env;
	const flags = opts.flags || readFlags(env);

	let primary = opts.primary || null;
	let primaryError = null;
	if (!primary && opts.primary !== null) {
		try {
			primary = await buildPrimaryFromEnv(env);
		} catch (err) {
			primaryError = err;
			if (!(err instanceof AdapterUnavailableError)) {
				// A real construction bug should be visible, but it must not take
				// the whole reliability surface down: the route reports it.
				console.error("[backend] primary adapter construction failed", shortError(err));
			}
		}
	}

	const standby = opts.standby !== undefined ? opts.standby : buildStandbyFromEnv(env);

	return new Backend({
		env,
		flags,
		primary,
		standby,
		primaryError,
		controlPlane: opts.controlPlane,
		health: opts.health,
		failover: opts.failover,
		router: opts.router,
		replicator: opts.replicator,
		dlq: opts.dlq,
		idempotency: opts.idempotency,
		conflict: opts.conflict,
		now: opts.now,
		logger: opts.logger,
	});
}

let _backend = null;
let _building = null;

/**
 * Process-wide singleton. The first caller wins; concurrent callers share the
 * same promise so two adapters are never built for one warm instance.
 */
export async function getBackend(opts = {}) {
	if (_backend) return _backend;
	if (!_building) {
		_building = createBackend(opts)
			.then((backend) => {
				_backend = backend;
				return backend;
			})
			.finally(() => {
				_building = null;
			});
	}
	return _building;
}

/** Test seam: drop the singleton so a fresh backend can be injected. */
export function resetBackend() {
	_backend = null;
	_building = null;
}

export { MODES, ReadOnlyError };
