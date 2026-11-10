// ─── Backend router ─────────────────────────────────────────────
// The router decides which data plane serves a request, but it no longer owns
// the decision. Mode, lease and fencing token live in exactly one place:
// FailoverController (./failover.js). This module is a thin request-path
// composition over it.
//
// That split matters. An earlier draft kept a second state key
// (`backend:router:state`) beside the failover state. Two keys means two
// writers, two leases and two epochs — the classic split-brain. Anything that
// wants to know "which plane is active" now asks the controller.
//
// Safety rules enforced here:
//   - Reads may fall back to the standby when the primary fails with an
//     infrastructure error. Application/auth errors never trigger failover.
//   - Writes never silently fall back. A write reaches the standby only when
//     the controller has granted failover AND the caller supplies a durable
//     fallback recorder; otherwise it fails closed. Reporting "Saved" with no
//     path back to the primary is a lie the user pays for later.
//   - Only one instance can win the failover transition (atomic CAS + epoch).

import { AdapterUnavailableError, BackendError, ReadOnlyError } from "./errors.js";
import { getControlPlane } from "./control-plane.js";
import { HealthMonitor } from "./health.js";
import { FailoverController, MODES } from "./failover.js";

/** Operator-facing labels derived from the controller's modes. */
export const ROUTER_STATES = Object.freeze({
	PRIMARY_ACTIVE: "PRIMARY_ACTIVE",
	PRIMARY_DEGRADED: "PRIMARY_DEGRADED",
	FIREBASE_ACTIVE: "FIREBASE_ACTIVE",
	RECONCILING: "RECONCILING",
	PRIMARY_RESTORED: "PRIMARY_RESTORED",
	MANUAL_INTERVENTION_REQUIRED: "MANUAL_INTERVENTION_REQUIRED",
});

const WRITE_OPS = new Set(["insert", "update", "upsert", "remove"]);

/** Infrastructure failures that justify touching the standby. */
export function isFailoverEligible(err) {
	if (!(err instanceof BackendError) && !err?.code) return false;
	return (
		err.code === "ADAPTER_UNAVAILABLE" ||
		err.code === "ADAPTER_TIMEOUT" ||
		err.retryable === true
	);
}

export class BackendRouter {
	/**
	 * @param {{
	 *   primary: import("./adapters/base.js").BaseAdapter,
	 *   secondary: import("./adapters/base.js").BaseAdapter,
	 *   failover?: FailoverController,
	 *   controlPlane?: object,
	 *   health?: HealthMonitor,
	 *   owner?: string,
	 *   now?: () => number,
	 * }} opts
	 */
	constructor(opts = {}) {
		if (!opts?.primary?.name) throw new Error("BackendRouter requires a primary adapter");
		if (!opts?.secondary?.name) throw new Error("BackendRouter requires a secondary adapter");
		if (opts.primary.name === opts.secondary.name) {
			throw new Error("Primary and secondary adapters must differ");
		}
		this.primary = opts.primary;
		this.secondary = opts.secondary;
		this.controlPlane = opts.controlPlane || getControlPlane();
		this.now = opts.now || Date.now;

		if (opts.failover) {
			this.failover = opts.failover;
		} else {
			this.health =
				opts.health ||
				new HealthMonitor({
					now: this.now,
					failureThreshold: 3,
					recoveryThreshold: 5,
				});
			if (!opts.health) {
				this.health.register(this.primary.name, () => this.primary.health());
				this.health.register(this.secondary.name, () => this.secondary.health());
			}
			this.failover = new FailoverController({
				primary: this.primary,
				standby: this.secondary,
				controlPlane: this.controlPlane,
				health: this.health,
				owner: opts.owner,
				now: this.now,
			});
		}
	}

	/**
	 * Routing view derived from the single controller state.
	 * @returns {Promise<{active: "primary"|"secondary", mode: string, epoch: number, since: string|null, reason: string|null}>}
	 */
	async routeState() {
		const current = await this.failover.currentMode();
		return {
			active: current.mode === MODES.FAILOVER ? "secondary" : "primary",
			mode: current.mode,
			epoch: current.epoch,
			since: current.since,
			reason: current.reason,
		};
	}

	/** Move to the standby. Cooldown and fencing are enforced by the controller. */
	async acquireFailover(reason = "router: primary unavailable") {
		const result = await this.failover.transition(MODES.FAILOVER, reason);
		return result.ok === true;
	}

	/**
	 * Move back to the primary after verification.
	 *
	 * Forced on purpose: the controller's cooldown damps AUTOMATIC oscillation,
	 * and the automatic failback path is `evaluate()`, which already requires
	 * `recoveryThreshold` consecutive healthy probes. This method is an explicit
	 * "recovery is verified, go back" decision — subjecting it to the same
	 * cooldown refused a restore for a full minute after every failover, which
	 * is the opposite of what an operator asking to restore wants. The switch is
	 * still fenced by the epoch CAS, so it cannot race a second writer.
	 */
	async restorePrimary(reason = "router: primary restored") {
		const result = await this.failover.transition(MODES.PRIMARY, reason, { force: true });
		return result.ok === true;
	}

	/** Probe both backends through the health monitor. */
	async evaluateBackends() {
		return this.failover.evaluate({ force: true });
	}

	/**
	 * Read with standby fallback for infrastructure failures only.
	 * @returns {Promise<{data: unknown, backend: string, failed_over: boolean}>}
	 */
	async read(table, opts = {}) {
		const state = await this.routeState();
		const order =
			state.active === "secondary"
				? [this.secondary, this.primary]
				: [this.primary, this.secondary];
		let lastError = null;
		for (let i = 0; i < order.length; i++) {
			const adapter = order[i];
			try {
				const data = await adapter.select(table, opts);
				return { data, backend: adapter.name, failed_over: i > 0 };
			} catch (err) {
				lastError = err;
				if (!isFailoverEligible(err)) throw err;
			}
		}
		throw lastError;
	}

	/**
	 * Write. Fallback is allowed ONLY when the controller has granted failover
	 * and a durable recorder is supplied; otherwise this fails closed.
	 *
	 * @param {string} table
	 * @param {"insert"|"update"|"upsert"|"remove"} op
	 * @param {unknown[]} args
	 * @param {{onFallbackWrite?: (event: object) => Promise<unknown>,
	 *          hasRecorder?: boolean}} [hooks]
	 */
	async write(table, op, args = [], hooks = {}) {
		if (!WRITE_OPS.has(op)) {
			throw new Error(`Unsupported write operation "${op}"`);
		}
		const hasRecorder = Boolean(hooks.onFallbackWrite || hooks.hasRecorder);
		const gate = await this.failover.assertWritable({ hasRecorder });

		if (gate.mode === MODES.FAILOVER) {
			const data = await this.secondary[op](table, ...args);
			await this._recordFallback(hooks, table, op, gate.epoch);
			return { data, backend: this.secondary.name, pending_sync: true };
		}

		try {
			const data = await this.primary[op](table, ...args);
			return { data, backend: this.primary.name, pending_sync: false };
		} catch (err) {
			if (!isFailoverEligible(err)) throw err;
			if (!hasRecorder) {
				// Honest failure: never report success without a reconciliation path.
				throw new AdapterUnavailableError(
					this.primary.name,
					`write failed (${err.code || err.message}) and no fallback recorder is configured`,
				);
			}
			const acquired = await this.acquireFailover(
				`router: write failed on ${this.primary.name} (${err.code || err.message})`,
			);
			if (!acquired) throw err;
			const data = await this.secondary[op](table, ...args);
			const state = await this.routeState();
			await this._recordFallback(hooks, table, op, state.epoch);
			return { data, backend: this.secondary.name, pending_sync: true };
		}
	}

	async _recordFallback(hooks, table, op, epoch) {
		if (!hooks.onFallbackWrite) return;
		await hooks.onFallbackWrite({
			table,
			op,
			epoch,
			backend: this.secondary.name,
			at: new Date(this.now()).toISOString(),
		});
	}

	/** Operator-facing snapshot for the reliability dashboard. */
	async status() {
		const state = await this.routeState();
		const failover = await this.failover.status();
		let label = ROUTER_STATES.PRIMARY_ACTIVE;
		if (state.mode === MODES.FAILOVER) label = ROUTER_STATES.FIREBASE_ACTIVE;
		else if (state.mode === MODES.READ_ONLY) label = ROUTER_STATES.MANUAL_INTERVENTION_REQUIRED;
		else if (failover.health && failover.health.primary === "degraded") {
			label = ROUTER_STATES.PRIMARY_DEGRADED;
		}
		return {
			state: label,
			active: state.active,
			mode: state.mode,
			epoch: state.epoch,
			since: state.since,
			reason: state.reason,
			control_plane: failover.control_plane,
			// Health is also surfaced at the top level: a dashboard should not have
			// to know the nested shape to answer "is the primary up?", and hiding
			// it made the operator view report nothing about the actual probes.
			health: failover.health || null,
			failover,
		};
	}
}

export { ReadOnlyError };
