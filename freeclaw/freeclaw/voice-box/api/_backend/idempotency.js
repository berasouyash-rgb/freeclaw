// ─── Idempotency ────────────────────────────────────────────────
// A write must never be applied twice because a client retried, a proxy
// replayed, or a failover happened mid-request. Every mutating call therefore
// carries a deterministic idempotency key.
//
// The key is derived from *what the operation means*, not from a random UUID
// generated at send time: a retry of the same user action on the same entity
// produces the same key, so the second attempt is recognised as a replay.
//
// Records live on the control plane (not in Supabase), because the point of an
// idempotency record is to survive the data plane it is protecting.
//
// States:
//   in_flight  — first attempt holds the key; a concurrent retry must wait or
//                be rejected, never applied in parallel
//   done       — the stored result is returned verbatim to replays
//   failed     — retryable; the key may be re-acquired after `retryAfterMs`

import crypto from "node:crypto";
import { getControlPlane } from "./control-plane.js";

const PREFIX = "idem:";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_IN_FLIGHT_TTL_MS = 60 * 1000; // a stuck attempt expires in 1 min
const DEFAULT_FAILED_TTL_MS = 5 * 60 * 1000;

/**
 * Deterministic idempotency key.
 *
 * @param {{ scope?: string, actorId?: string, entity?: string, id?: string,
 *           op?: string, clientKey?: string, payload?: unknown }} parts
 */
export function deriveIdempotencyKey(parts = {}) {
	if (parts.clientKey) {
		// A client-supplied key is already an idempotency token. Namespace it
		// by actor so one user cannot replay another user's key.
		return hash(`${parts.scope || "vf"}|${parts.actorId || "anon"}|${parts.clientKey}`);
	}
	const material = JSON.stringify({
		scope: parts.scope || "vf",
		actor: parts.actorId || "anon",
		entity: parts.entity || "",
		id: parts.id || "",
		op: parts.op || "",
		payload: parts.payload === undefined ? null : parts.payload,
	});
	return hash(material);
}

function hash(input) {
	return crypto.createHash("sha256").update(String(input)).digest("hex");
}

/** Stable id helper: same inputs → same id, so a retry cannot fork a row. */
export function stableId(...parts) {
	return hash(parts.join("|")).slice(0, 32);
}

export class IdempotencyStore {
	/**
	 * @param {{ controlPlane?: object, now?: () => number, ttlMs?: number }} [opts]
	 */
	constructor(opts = {}) {
		this.cp = opts.controlPlane || getControlPlane();
		this.now = opts.now || Date.now;
		this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
	}

	_key(key) {
		return `${PREFIX}${key}`;
	}

	/** Pure read. */
	async get(key) {
		const rec = await this.cp.get(this._key(key));
		return rec ? rec.value : null;
	}

	/**
	 * Attempts to take ownership of a key.
	 * @returns {Promise<{ acquired: boolean, state: string, result?: unknown, record?: object }>}
	 */
	async begin(key, meta = {}) {
		const storageKey = this._key(key);
		const existing = await this.cp.get(storageKey);

		if (existing?.value) {
			const rec = existing.value;
			const age = this.now() - Number(rec.at || 0);
			if (rec.state === "done") {
				return { acquired: false, state: "done", result: rec.result, record: rec };
			}
			if (rec.state === "in_flight" && age < (rec.inFlightTtlMs || DEFAULT_IN_FLIGHT_TTL_MS)) {
				return { acquired: false, state: "in_flight", record: rec };
			}
			// Failed, or an abandoned in-flight attempt: take it over with CAS.
			const cas = await this.cp.compareAndSet(
				storageKey,
				existing.version,
				{
					state: "in_flight",
					at: this.now(),
					meta,
					inFlightTtlMs: DEFAULT_IN_FLIGHT_TTL_MS,
				},
				{ ttlMs: this.ttlMs },
			);
			if (!cas.ok) return { acquired: false, state: "contended" };
			return { acquired: true, state: "in_flight" };
		}

		const cas = await this.cp.compareAndSet(
			storageKey,
			null,
			{
				state: "in_flight",
				at: this.now(),
				meta,
				inFlightTtlMs: DEFAULT_IN_FLIGHT_TTL_MS,
			},
			{ ttlMs: this.ttlMs },
		);
		if (!cas.ok) return { acquired: false, state: "contended" };
		return { acquired: true, state: "in_flight" };
	}

	/** Records a durable result. Replays receive `result` unchanged. */
	async complete(key, result, meta = {}) {
		const storageKey = this._key(key);
		const existing = await this.cp.get(storageKey);
		const expected = existing ? existing.version : null;
		return this.cp.compareAndSet(
			storageKey,
			expected,
			{ state: "done", at: this.now(), result, meta },
			{ ttlMs: this.ttlMs },
		);
	}

	/** Marks the attempt failed so a retry may re-acquire it. */
	async fail(key, error, meta = {}) {
		const storageKey = this._key(key);
		const existing = await this.cp.get(storageKey);
		const expected = existing ? existing.version : null;
		return this.cp.compareAndSet(
			storageKey,
			expected,
			{
				state: "failed",
				at: this.now(),
				error: String(error?.message || error || "failed").slice(0, 500),
				meta,
			},
			{ ttlMs: DEFAULT_FAILED_TTL_MS },
		);
	}

	async release(key) {
		return this.cp.delete(this._key(key));
	}
}

/**
 * Runs `fn` at most once per idempotency key.
 *
 * Concurrent callers with the same key do NOT run in parallel: the loser gets
 * `{ replayed: false, inFlight: true }` and should retry shortly. That is the
 * honest answer — silently serialising would hide a real double-submit.
 */
export async function runIdempotent(store, key, fn, meta = {}) {
	const begin = await store.begin(key, meta);
	if (!begin.acquired) {
		if (begin.state === "done") {
			return { replayed: true, inFlight: false, result: begin.result };
		}
		return { replayed: false, inFlight: true, state: begin.state };
	}
	try {
		const result = await fn();
		await store.complete(key, result, meta);
		return { replayed: false, inFlight: false, result };
	} catch (err) {
		await store.fail(key, err, meta);
		throw err;
	}
}
