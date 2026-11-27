// ─── Health monitor ─────────────────────────────────────────────
// Serverless reality: Vercel freezes functions between requests, so a
// setInterval() health loop does not run. The monitor is therefore LAZY —
// it evaluates on demand and self-throttles to `intervalMs`. A cron route
// (or the reliability endpoint) drives it; request-path callers reuse the
// cached snapshot instead of paying for a probe.
//
// Transitions are hysteretic: it takes `failureThreshold` consecutive
// failures to declare a backend down, and `recoveryThreshold` consecutive
// successes to declare it healthy again. A single blip can never trigger a
// failover, and a flapping backend cannot trigger a failover/failback loop.

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_THRESHOLD = 5;
const DEFAULT_PROBE_TIMEOUT_MS = 2_500;

function withDeadline(promise, ms, label) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} probe timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @typedef {{ ok: boolean, latencyMs?: number, detail?: unknown }} ProbeResult
 * @typedef {(ctx: { now: number }) => Promise<ProbeResult>} Probe
 */

export class HealthMonitor {
	constructor(options = {}) {
		this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
		this.recoveryThreshold = options.recoveryThreshold ?? DEFAULT_RECOVERY_THRESHOLD;
		this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
		this.now = options.now ?? Date.now;

		/** @type {Map<string, {probe: Probe, status: string, consecutiveFailures: number, consecutiveSuccesses: number, lastCheckAt: number|null, lastLatencyMs: number|null, lastError: string|null}>} */
		this._probes = new Map();
		this._lastRunAt = 0;
	}

	register(name, probe) {
		if (typeof probe !== "function") throw new Error(`probe for "${name}" must be a function`);
		this._probes.set(name, {
			probe,
			status: "unknown",
			consecutiveFailures: 0,
			consecutiveSuccesses: 0,
			lastCheckAt: null,
			lastLatencyMs: null,
			lastError: null,
		});
		return this;
	}

	unregister(name) {
		this._probes.delete(name);
		return this;
	}

	_names() {
		return [...this._probes.keys()];
	}

	/** Applies one probe outcome to its state machine. */
	_apply(name, outcome) {
		const state = this._probes.get(name);
		if (!state) return;
		state.lastCheckAt = this.now();
		if (outcome.ok) {
			state.consecutiveFailures = 0;
			state.consecutiveSuccesses += 1;
			state.lastLatencyMs = outcome.latencyMs ?? null;
			state.lastError = null;
			if (state.status === "down") {
				if (state.consecutiveSuccesses >= this.recoveryThreshold) state.status = "healthy";
			} else {
				state.status = "healthy";
			}
		} else {
			state.consecutiveSuccesses = 0;
			state.consecutiveFailures += 1;
			state.lastError = outcome.error || "probe failed";
			state.status =
				state.consecutiveFailures >= this.failureThreshold ? "down" : "degraded";
		}
	}

	async _runProbe(name) {
		const state = this._probes.get(name);
		if (!state) return;
		const started = this.now();
		try {
			const result = await withDeadline(
				Promise.resolve().then(() => state.probe({ now: started })),
				this.probeTimeoutMs,
				name,
			);
			const latencyMs =
				typeof result?.latencyMs === "number" ? result.latencyMs : this.now() - started;
			this._apply(name, { ok: result?.ok === true, latencyMs, detail: result?.detail });
		} catch (err) {
			this._apply(name, { ok: false, error: String(err?.message || err).slice(0, 300) });
		}
	}

	/**
	 * Evaluates every probe unless the throttle window has not elapsed.
	 * @param {{ force?: boolean }} [opts]
	 */
	async evaluate(opts = {}) {
		const now = this.now();
		if (!opts.force && now - this._lastRunAt < this.intervalMs) {
			return this.snapshot();
		}
		this._lastRunAt = now;
		await Promise.allSettled(this._names().map((name) => this._runProbe(name)));
		return this.snapshot();
	}

	/** Pure read — never triggers a probe. */
	snapshot() {
		const backends = {};
		for (const [name, state] of this._probes) {
			backends[name] = {
				status: state.status,
				consecutive_failures: state.consecutiveFailures,
				consecutive_successes: state.consecutiveSuccesses,
				last_check_at: state.lastCheckAt ? new Date(state.lastCheckAt).toISOString() : null,
				last_latency_ms: state.lastLatencyMs,
				last_error: state.lastError,
			};
		}
		return {
			evaluated_at: this._lastRunAt ? new Date(this._lastRunAt).toISOString() : null,
			interval_ms: this.intervalMs,
			failure_threshold: this.failureThreshold,
			recovery_threshold: this.recoveryThreshold,
			backends,
		};
	}

	statusOf(name) {
		return this._probes.get(name)?.status || "unknown";
	}

	isHealthy(name) {
		return this.statusOf(name) === "healthy";
	}

	isDown(name) {
		return this.statusOf(name) === "down";
	}

	reset() {
		for (const state of this._probes.values()) {
			state.status = "unknown";
			state.consecutiveFailures = 0;
			state.consecutiveSuccesses = 0;
			state.lastCheckAt = null;
			state.lastLatencyMs = null;
			state.lastError = null;
		}
		this._lastRunAt = 0;
	}
}
