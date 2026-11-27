// ─── Failover controller ────────────────────────────────────────
// This is the single authority for "which data plane is active". It is the
// only module allowed to change the mode, and it changes it only through an
// atomic compare-and-set on the independent control plane. Two serverless
// instances evaluating the same outage therefore cannot both "win" a failover
// and split writes across two databases.
//
// Modes:
//   primary    read + write Supabase. The normal state.
//   failover   read + write Firebase. Entered only when the primary is
//              confirmed down AND the standby is confirmed healthy. Writes are
//              allowed only when the caller supplies a durable reconciliation
//              path (see assertWritable()).
//   read_only  neither plane is trustworthy. Reads may still be attempted;
//              writes are refused with a retryable, user-safe error.
//
// The lease carries a monotonic FENCING TOKEN (the state record version). Any
// write accepted under a stale token can be rejected during reconciliation,
// which is what stops a paused instance from writing after it has been
// replaced by a newer owner.
//
// Expiry does NOT silently revert the mode. A lease that lapses marks the
// state `stale` and the next evaluate() re-acquires it; a timer-driven revert
// would be a second writer with no fencing.

import { ReadOnlyError } from "./errors.js";
import { getControlPlane } from "./control-plane.js";

export const MODES = Object.freeze({
	PRIMARY: "primary",
	FAILOVER: "failover",
	READ_ONLY: "read_only",
});

const STATE_KEY = "failover:state";
const LEASE_KEY = "failover:lease";
const CAS_ATTEMPTS = 5;

function nowIso(now) {
	return new Date(now).toISOString();
}

export class FailoverController {
	/**
	 * @param {{
	 *   primary?: { name: string },
	 *   standby?: { name: string } | null,
	 *   controlPlane?: object,
	 *   health?: import("./health.js").HealthMonitor,
	 *   owner?: string,
	 *   now?: () => number,
	 *   cooldownMs?: number,
	 *   leaseTtlMs?: number,
	 *   allowStandbyWrites?: boolean,
	 *   logger?: object,
	 * }} [opts]
	 */
	constructor(opts = {}) {
		this.primary = opts.primary || null;
		this.standby = opts.standby || null;
		this.cp = opts.controlPlane || getControlPlane();
		this.health = opts.health || null;
		this.now = opts.now || Date.now;
		this.owner = opts.owner || `vf-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
		this.cooldownMs = opts.cooldownMs ?? 60_000;
		this.leaseTtlMs = opts.leaseTtlMs ?? 60_000;
		this.allowStandbyWrites = opts.allowStandbyWrites === true;
		this.logger = opts.logger || console;
	}

	get standbyConfigured() {
		return Boolean(this.standby);
	}

	/** Pure read of the current state. Never writes, never probes. */
	async currentMode() {
		const rec = await this.cp.get(STATE_KEY);
		const state = rec?.value || {
			mode: MODES.PRIMARY,
			epoch: 0,
			since: nowIso(this.now()),
			reason: "initial",
		};
		const lease = (await this.cp.get(LEASE_KEY))?.value || null;
		const leaseExpired = lease ? Number(lease.expiresAt || 0) <= this.now() : false;
		return {
			mode: state.mode || MODES.PRIMARY,
			epoch: Number(state.epoch || 0),
			since: state.since || null,
			reason: state.reason || null,
			owner: state.owner || null,
			stale: state.mode !== MODES.PRIMARY && leaseExpired,
			lease_expires_at: lease ? nowIso(Number(lease.expiresAt)) : null,
		};
	}

	/**
	 * Atomically transitions the mode. Returns the new epoch (fencing token).
	 * A losing writer receives `{ok:false}` and must NOT act on the transition.
	 */
	async transition(mode, reason, { force = false } = {}) {
		if (!Object.values(MODES).includes(mode)) {
			throw new Error(`unknown failover mode "${mode}"`);
		}
		const current = await this.currentMode();
		// `ok` means "THIS caller won the transition" — it is what grants a single
		// writer the resulting epoch. If the mode already is the requested one,
		// nothing was won. Returning `ok:true` here let two routers both believe
		// they had acquired failover and both write to the standby, each under its
		// own epoch, which is the split-brain this controller exists to prevent.
		if (current.mode === mode) {
			return { ok: false, reason: "already", mode: current.mode, epoch: current.epoch };
		}
		// `epoch === 0` means no transition has ever been recorded: `since` is a
		// synthesized process-start timestamp ("initial"), not a real transition.
		// Applying the anti-flap cooldown to it refuses the FIRST failover for a
		// full cooldown window — precisely when the primary has just died. The
		// cooldown exists to stop A↔B flapping, and there is no previous
		// transition to flap against yet.
		if (!force && current.mode !== mode && current.since && current.epoch > 0) {
			const elapsed = this.now() - new Date(current.since).getTime();
			if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < this.cooldownMs) {
				return { ok: false, reason: "cooldown", mode: current.mode, epoch: current.epoch };
			}
		}

		for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
			const rec = await this.cp.get(STATE_KEY);
			const prev = rec?.value || {};
			const epoch = Number(rec?.version || 0) + 1;
			const next = {
				mode,
				epoch,
				since: nowIso(this.now()),
				reason: String(reason || "").slice(0, 300),
				owner: this.owner,
			};
			const cas = await this.cp.compareAndSet(STATE_KEY, rec ? rec.version : null, next, {
				ttlMs: 0,
			});
			if (!cas.ok) continue;

			// Lease is written after the state so a reader never sees a new mode
			// with no owner. If it fails, the mode is still fenced by `epoch`.
			try {
				const leaseRec = await this.cp.get(LEASE_KEY);
				await this.cp.compareAndSet(
					LEASE_KEY,
					leaseRec ? leaseRec.version : null,
					{ owner: this.owner, epoch, expiresAt: this.now() + this.leaseTtlMs },
					{ ttlMs: this.leaseTtlMs },
				);
			} catch (err) {
				this.logger?.warn?.("[failover] lease write failed", err?.message || err);
			}

			if (mode !== prev.mode) {
				this.logger?.warn?.(
					`[failover] ${prev.mode || "primary"} → ${mode} (epoch ${epoch}) — ${next.reason}`,
				);
			}
			return { ok: true, mode, epoch, previous: prev.mode || MODES.PRIMARY };
		}

		return { ok: false, reason: "contended", mode: current.mode, epoch: current.epoch };
	}

	/** Renews the lease for the current mode without changing it. */
	async renew() {
		const current = await this.currentMode();
		const leaseRec = await this.cp.get(LEASE_KEY);
		return this.cp.compareAndSet(
			LEASE_KEY,
			leaseRec ? leaseRec.version : null,
			{ owner: this.owner, epoch: current.epoch, expiresAt: this.now() + this.leaseTtlMs },
			{ ttlMs: this.leaseTtlMs },
		);
	}

	/**
	 * Derives the correct mode from health and applies it if it differs.
	 * Health is hysteretic, so a single blip cannot flip the mode.
	 *
	 * @param {{ force?: boolean, probe?: boolean }} [opts]
	 */
	async evaluate(opts = {}) {
		const current = await this.currentMode();

		if (!this.standbyConfigured) {
			if (current.mode !== MODES.PRIMARY) {
				await this.transition(MODES.PRIMARY, "standby is not configured", { force: true });
			}
			return {
				mode: MODES.PRIMARY,
				epoch: current.epoch,
				changed: current.mode !== MODES.PRIMARY,
				standby_configured: false,
				reason: "standby-unconfigured",
			};
		}

		if (!this.health) {
			return {
				mode: current.mode,
				epoch: current.epoch,
				changed: false,
				standby_configured: true,
				reason: "no-health-monitor",
			};
		}

		const snapshot = await this.health.evaluate({ force: opts.force === true });
		const primaryDown = this.health.isDown(this.primary?.name);
		const standbyHealthy = this.health.isHealthy(this.standby?.name);
		const standbyDown = this.health.isDown(this.standby?.name);

		let desired = current.mode;
		let reason = "steady";

		if (primaryDown && standbyHealthy) {
			desired = MODES.FAILOVER;
			reason = `primary ${this.primary?.name} down; standby healthy`;
		} else if (primaryDown && standbyDown) {
			desired = MODES.READ_ONLY;
			reason = "primary and standby both down";
		} else if (!primaryDown && this.health.isHealthy(this.primary?.name)) {
			// Failback only after recoveryThreshold consecutive successes —
			// isHealthy() already encodes that.
			if (current.mode !== MODES.PRIMARY) {
				desired = MODES.PRIMARY;
				reason = `primary ${this.primary?.name} recovered`;
			}
		} else if (this.health.statusOf(this.primary?.name) === "degraded") {
			// Degraded is not down. Hold the current mode so a slow query
			// cannot cause a failover/failback loop.
			reason = "primary degraded — holding";
		}

		if (desired === current.mode) {
			await this.renew();
			return {
				mode: current.mode,
				epoch: current.epoch,
				changed: false,
				standby_configured: true,
				reason,
				health: snapshot,
			};
		}

		const result = await this.transition(desired, reason, { force: opts.force === true });
		return {
			mode: result.ok ? result.mode : current.mode,
			epoch: result.ok ? result.epoch : current.epoch,
			changed: result.ok,
			standby_configured: true,
			reason: result.ok ? reason : result.reason,
			health: snapshot,
		};
	}

	/** Adapter that should serve reads right now. */
	async targetForRead() {
		const { mode } = await this.currentMode();
		if (mode === MODES.FAILOVER && this.standby) return this.standby;
		return this.primary;
	}

	/**
	 * Gate for writes.
	 *
	 * @param {{ hasRecorder?: boolean }} [opts] `hasRecorder` is true when the
	 *   caller can durably record a standby write for later reconciliation.
	 * @returns {Promise<{ mode: string, epoch: number, target: object }>}
	 */
	async assertWritable(opts = {}) {
		const current = await this.currentMode();
		if (current.mode === MODES.READ_ONLY) {
			throw new ReadOnlyError(
				"Saving is paused while we recover — your draft is safe and you can retry shortly.",
			);
		}
		if (current.mode === MODES.FAILOVER) {
			const recorder = opts.hasRecorder ?? this.allowStandbyWrites;
			if (!recorder) {
				// Fail closed. Reporting "Saved" with no path back to the primary
				// would be a lie the user pays for later.
				throw new ReadOnlyError(
					"Backup storage is active but sync is not configured — saving is paused.",
				);
			}
			return { mode: current.mode, epoch: current.epoch, target: this.standby };
		}
		return { mode: current.mode, epoch: current.epoch, target: this.primary };
	}

	/**
	 * Operator drill. Refuses in production unless explicitly overridden, so a
	 * dashboard click can never move live traffic to an unreconciled standby.
	 */
	async forceFailover(reason, { allowProduction = false } = {}) {
		const env = process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
		if (env === "production" && !allowProduction) {
			throw new ReadOnlyError(
				"Manual failover is disabled in production; use the health-driven path or a staging drill.",
			);
		}
		return this.transition(MODES.FAILOVER, `manual: ${reason}`, { force: true });
	}

	async forceRecover(reason) {
		return this.transition(MODES.PRIMARY, `manual: ${reason}`, { force: true });
	}

	/** Operator-facing snapshot. Pure reads. */
	async status() {
		const current = await this.currentMode();
		return {
			mode: current.mode,
			epoch: current.epoch,
			since: current.since,
			reason: current.reason,
			stale: current.stale,
			lease_expires_at: current.lease_expires_at,
			owner: this.owner,
			standby_configured: this.standbyConfigured,
			allow_standby_writes: this.allowStandbyWrites,
			cooldown_ms: this.cooldownMs,
			control_plane: {
				backend: this.cp.backend,
				durable: this.cp.durable === true,
			},
			health: this.health?.snapshot?.() || null,
		};
	}
}
