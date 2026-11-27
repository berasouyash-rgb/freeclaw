// ─── Dead-letter queue ──────────────────────────────────────────
// A replication or failover failure must not vanish into a log line. Each
// failed unit of work is written here with enough context to replay it later
// and to show an operator what is not converging.
//
// The queue lives on the CONTROL PLANE, not on either data plane:
//   - if it lived in Supabase, a Supabase outage would destroy the record of
//     what failed during that outage;
//   - if it lived in Firestore, the same is true in the other direction.
//
// Layout:
//   dlq:entry:<id>   the record (7-day TTL, so the queue self-heals)
//   dlq:index        CAS-maintained ordered list of ids (newest last)
//
// The index is a convenience for listing, not the source of truth. If two
// instances contend on the index, the entry is still written and `indexed` is
// false — losing a list entry is recoverable; losing the failure is not.

import crypto from "node:crypto";
import { getControlPlane } from "./control-plane.js";

const ENTRY_PREFIX = "dlq:entry:";
const INDEX_KEY = "dlq:index";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_INDEX = 500;
const CAS_ATTEMPTS = 4;

export class DeadLetterQueue {
	/**
	 * @param {{ controlPlane?: object, now?: () => number,
	 *           ttlMs?: number, maxIndex?: number, logger?: object }} [opts]
	 */
	constructor(opts = {}) {
		this.cp = opts.controlPlane || getControlPlane();
		this.now = opts.now || Date.now;
		this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
		this.maxIndex = opts.maxIndex ?? MAX_INDEX;
		this.logger = opts.logger || console;
	}

	/**
	 * Records a failure. Never throws for a control-plane write failure: the
	 * caller is already handling an error and must not be masked by a second
	 * one.
	 *
	 * @param {{ table?: string, op?: string, error?: unknown, payload?: unknown,
	 *           attempts?: number, source?: string, meta?: object }} entry
	 * @returns {Promise<{ id: string, indexed: boolean }>}
	 */
	async push(entry = {}) {
		const id = `${this.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
		const record = {
			id,
			at: new Date(this.now()).toISOString(),
			table: entry.table || null,
			op: entry.op || null,
			source: entry.source || "backend",
			attempts: Number(entry.attempts || 1),
			error: String(entry.error?.message || entry.error || "unknown error").slice(0, 500),
			code: entry.error?.code || null,
			payload: entry.payload === undefined ? null : entry.payload,
			meta: entry.meta || null,
		};

		let stored = false;
		try {
			await this.cp.set(`${ENTRY_PREFIX}${id}`, record, { ttlMs: this.ttlMs });
			stored = true;
		} catch (err) {
			this.logger?.error?.("[dlq] failed to persist entry", err?.message || err);
		}

		const indexed = stored ? await this._appendIndex(id) : false;
		return { id, indexed };
	}

	async _appendIndex(id) {
		for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
			const rec = await this.cp.get(INDEX_KEY);
			const current = Array.isArray(rec?.value) ? rec.value : [];
			const next = [...current, id].slice(-this.maxIndex);
			const cas = await this.cp.compareAndSet(
				INDEX_KEY,
				rec ? rec.version : null,
				next,
				{ ttlMs: this.ttlMs },
			);
			if (cas.ok) return true;
		}
		// Contention is expected under a replication storm; the entry is still
		// durable and reachable by id.
		return false;
	}

	/** Newest first. Missing entries (expired) are skipped, not fabricated. */
	async list({ limit = 50 } = {}) {
		const rec = await this.cp.get(INDEX_KEY);
		const ids = Array.isArray(rec?.value) ? rec.value.slice(-limit).reverse() : [];
		const entries = await Promise.all(ids.map((id) => this.get(id)));
		return entries.filter(Boolean);
	}

	async get(id) {
		const rec = await this.cp.get(`${ENTRY_PREFIX}${id}`);
		return rec?.value || null;
	}

	/**
	 * Drops an entry. The entry is deleted even when the index CAS loses, so a
	 * stuck index can never resurrect a handled failure.
	 */
	async drop(id) {
		await this.cp.delete(`${ENTRY_PREFIX}${id}`);
		for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
			const rec = await this.cp.get(INDEX_KEY);
			const current = Array.isArray(rec?.value) ? rec.value : [];
			if (!current.includes(id)) return { dropped: true, indexUpdated: true };
			const next = current.filter((x) => x !== id);
			const cas = await this.cp.compareAndSet(
				INDEX_KEY,
				rec ? rec.version : null,
				next,
				{ ttlMs: this.ttlMs },
			);
			if (cas.ok) return { dropped: true, indexUpdated: true };
		}
		return { dropped: true, indexUpdated: false };
	}

	/** Number of ids currently listed (not a database COUNT). */
	async size() {
		const rec = await this.cp.get(INDEX_KEY);
		return Array.isArray(rec?.value) ? rec.value.length : 0;
	}

	/** Test seam: clears both the entries and the index. */
	async clear() {
		const rec = await this.cp.get(INDEX_KEY);
		const ids = Array.isArray(rec?.value) ? rec.value : [];
		await Promise.all(ids.map((id) => this.cp.delete(`${ENTRY_PREFIX}${id}`)));
		await this.cp.delete(INDEX_KEY);
	}
}
