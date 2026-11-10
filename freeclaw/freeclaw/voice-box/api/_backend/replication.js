// ─── Replication worker ─────────────────────────────────────────
// Drains a durable outbox and applies each event to the standby adapter.
// Delivery is at-least-once; application is idempotent:
//   - a duplicate insert (row already exists) is treated as success
//   - a delete of a missing row is success
//   - a stale/version conflict is a real failure and goes back to the queue
//
// The outbox store is injected. Its contract:
//   claim(limit)        -> events[] (and marks them in-flight)
//   ack(ids)            -> void
//   fail(id, error)     -> void (increments retry / dead-letters)
//
// Event: { id, table, op: insert|update|upsert|remove, payload, attempts? }

import { BackendError } from "./errors.js";
import { getControlPlane } from "./control-plane.js";
import { DeadLetterQueue } from "./dlq.js";
import { VOICEFLOW_TABLES, fullScanTables, tableMeta, watermarkTables } from "./tables.js";

const OPS = new Set(["insert", "update", "upsert", "remove"]);

export async function applyEvent(adapter, event) {
	if (!event || typeof event !== "object") throw new Error("invalid replication event");
	if (!OPS.has(event.op)) throw new Error(`unsupported replication op "${event.op}"`);
	const { table, op, payload } = event;
	const meta = tableMeta(table);
	switch (op) {
		case "insert":
			return adapter.insert(table, payload);
		case "upsert":
			return adapter.upsert(table, payload, {});
		case "update": {
			const id = payload?.[meta.pk] ?? event.entity_id;
			if (id === undefined || id === null) throw new Error("update event missing entity id");
			const patch = { ...payload };
			delete patch[meta.pk];
			return adapter.update(table, id, patch, {});
		}
		case "remove": {
			const id = event.entity_id ?? payload?.[meta.pk] ?? payload;
			return adapter.remove(table, id);
		}
		default:
			throw new Error(`unsupported replication op "${op}"`);
	}
}

export class ReplicationWorker {
	/**
	 * @param {{ outbox: {claim:Function, ack:Function, fail:Function},
	 *           target: import("./adapters/base.js").BaseAdapter,
	 *           batchSize?: number, onApplied?: Function, onFailed?: Function }} opts
	 */
	constructor(opts = {}) {
		if (!opts.outbox) throw new Error("ReplicationWorker requires an outbox");
		if (!opts.target?.name) throw new Error("ReplicationWorker requires a target adapter");
		this.outbox = opts.outbox;
		this.target = opts.target;
		this.batchSize = opts.batchSize ?? 50;
		this.onApplied = opts.onApplied;
		this.onFailed = opts.onFailed;
	}

	/** Apply one batch. Never throws for per-event failures (they are queued). */
	async drain() {
		const events = (await this.outbox.claim(this.batchSize)) || [];
		const failedIds = new Set();
		let failed = 0;
		for (const event of events) {
			try {
				await applyEvent(this.target, event);
				if (this.onApplied) await this.onApplied(event, { duplicate: false });
			} catch (err) {
				// At-least-once idempotency: a row that already exists means the
				// event was applied before the ack was lost.
				if (err instanceof BackendError && err.code === "DUPLICATE") {
					if (this.onApplied) await this.onApplied(event, { duplicate: true });
					continue;
				}
				failedIds.add(event.id);
				failed += 1;
				await this.outbox.fail(
					event.id,
					String(err?.message || err).slice(0, 300),
				);
				if (this.onFailed) await this.onFailed(event, err);
			}
		}
		const toAck = events.map((e) => e.id).filter((id) => !failedIds.has(id));
		if (toAck.length) await this.outbox.ack(toAck);
		return { claimed: events.length, applied: toAck.length, failed };
	}
}

/**
 * Minimal in-memory outbox that follows the contract. Production uses a
 * Postgres table + transaction (migration proposed separately); this class is
 * used by tests and offline drills.
 */
export class MemoryOutbox {
	constructor(events = [], opts = {}) {
		this.events = events.map((e) => ({ attempts: 0, ...e }));
		this.maxAttempts = opts.maxAttempts ?? 5;
		this.acked = [];
		this.dead = [];
		this.lastError = {};
		this.inflight = new Set();
	}
	async claim(limit) {
		const batch = this.events
			.filter(
				(e) =>
					!this.acked.includes(e.id) &&
					!this.dead.includes(e.id) &&
					e.attempts < this.maxAttempts &&
					!this.inflight.has(e.id),
			)
			.slice(0, limit);
		for (const e of batch) this.inflight.add(e.id);
		return batch;
	}
	async ack(ids) {
		for (const id of ids) {
			if (!this.acked.includes(id)) this.acked.push(id);
			this.inflight.delete(id);
		}
	}
	async fail(id, error) {
		this.inflight.delete(id);
		const event = this.events.find((e) => e.id === id);
		if (!event) return;
		event.attempts += 1;
		event.last_error = error;
		this.lastError[id] = error;
		if (event.attempts >= this.maxAttempts && !this.dead.includes(id)) {
			this.dead.push(id);
		}
	}
}

// ─── Continuous replication (no outbox required) ─────────────────
// The worker above needs a transactional outbox, which requires DDL we cannot
// run on the live shared project. This replicator is the fallback that works
// against the schema as it actually exists: it pulls from the primary and
// idempotently upserts into the standby.
//
// Two modes, chosen per table from tables.js:
//
//   watermark   Incremental. Page with a strict `>` on the table's monotonic
//               column, ordered by that column, until a short page. After the
//               final page we re-read every row that shares the boundary value,
//               because rows written during the page read carry the same
//               timestamp and `>` would skip them forever.
//
//   full scan   Keyset pagination by primary key. Used for tables that mutate
//               without a time column (comments edited, reports triaged), where
//               an incremental cursor would silently lose the edit. Correct,
//               more expensive, never silently stale.
//
// Deletions are reconciled by pruning the standby against a COMPLETE primary
// key set. Two guards make pruning conservative on purpose:
//   - primary returned zero rows  → do not prune. An empty read is far more
//     likely to be an outage or a permissions change than a truly empty table,
//     and a wrong prune is unrecoverable while a stale row is not.
//   - primary scan hit the row cap → do not prune. The key set is incomplete,
//     so "absent from primary" cannot be trusted.
//
// Direction matters: this only runs primary → standby, and only while the
// controller reports `primary`. Running it during failover would replicate
// standby writes back over the primary. The composition layer enforces that;
// `runCycle({ mode })` refuses anything but `primary` when a mode is supplied.

const CURSOR_PREFIX = "repl:cursor:";
const STATUS_KEY = "repl:status";
const STATUS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function iso(now) {
	return new Date(now).toISOString();
}

function shortError(err) {
	return String(err?.message || err || "unknown error").slice(0, 300);
}

export class Replicator {
	/**
	 * @param {{
	 *   source: import("./adapters/base.js").BaseAdapter,
	 *   target: import("./adapters/base.js").BaseAdapter,
	 *   controlPlane?: object,
	 *   dlq?: DeadLetterQueue,
	 *   now?: () => number,
	 *   batchSize?: number,
	 *   maxBatches?: number,
	 *   maxScanRows?: number,
	 *   logger?: object,
	 * }} opts
	 */
	constructor(opts = {}) {
		if (!opts?.source?.name) throw new Error("Replicator requires a source adapter");
		if (!opts?.target?.name) throw new Error("Replicator requires a target adapter");
		if (opts.source.name === opts.target.name) {
			throw new Error("Replicator source and target adapters must differ");
		}
		this.source = opts.source;
		this.target = opts.target;
		this.cp = opts.controlPlane || getControlPlane();
		this.dlq = opts.dlq || new DeadLetterQueue({ controlPlane: this.cp, now: opts.now });
		this.now = opts.now || Date.now;
		this.batchSize = opts.batchSize ?? 100;
		this.maxBatches = opts.maxBatches ?? 20;
		this.maxScanRows = opts.maxScanRows ?? 50_000;
		this.logger = opts.logger || console;
	}

	/** Replicates one table using the strategy declared in tables.js. */
	async replicateTable(table, opts = {}) {
		const meta = tableMeta(table); // throws outside the allowlist
		const started = this.now();
		let result;
		if (meta.fullScan || !meta.watermark) {
			result = await this._fullScan(table, meta, opts);
		} else {
			result = await this._watermark(table, meta, opts);
		}
		return { ...result, table, ms: this.now() - started };
	}

	async _watermark(table, meta, opts = {}) {
		const cursorKey = `${CURSOR_PREFIX}${table}`;
		const cursorRec = opts.reset ? null : await this.cp.get(cursorKey);
		let last = cursorRec?.value?.watermark ?? null;
		let rows = 0;
		let batches = 0;

		while (batches < this.maxBatches) {
			const pageOpts = {
				orderBy: meta.watermark,
				ascending: true,
				limit: this.batchSize,
			};
			if (last != null) pageOpts.since = { column: meta.watermark, value: last };
			const page = await this.source.select(table, pageOpts);
			batches += 1;
			if (!page.length) break;

			// A row with a null watermark can never satisfy `> last` again. Rather
			// than drop it silently, fall back to a full scan for this table.
			if (page.some((row) => row?.[meta.watermark] == null)) {
				this.logger?.warn?.(
					`[replication] ${table}: null ${meta.watermark} found — using full scan this cycle`,
				);
				const fallback = await this._fullScan(table, meta, opts);
				return { ...fallback, mode: "watermark→full", reason: "null-watermark" };
			}

			await this.target.upsert(table, page, {});
			rows += page.length;
			last = page[page.length - 1][meta.watermark];
			if (page.length < this.batchSize) break;
		}

		// Boundary reconciliation: rows sharing the final timestamp were written
		// after the page was read, so `>` excludes them. Re-read the whole
		// boundary group by primary key until it is exhausted.
		let boundaryRows = 0;
		let boundaryTruncated = false;
		if (rows > 0 && last != null) {
			let boundaryPk = null;
			let boundaryBatches = 0;
			while (boundaryBatches < this.maxBatches) {
				const boundaryOpts = {
					where: { [meta.watermark]: last },
					orderBy: meta.pk,
					ascending: true,
					limit: this.batchSize,
				};
				if (boundaryPk != null) {
					boundaryOpts.since = { column: meta.pk, value: boundaryPk };
				}
				const page = await this.source.select(table, boundaryOpts);
				boundaryBatches += 1;
				if (!page.length) break;
				await this.target.upsert(table, page, {});
				boundaryRows += page.length;
				boundaryPk = page[page.length - 1][meta.pk];
				if (page.length < this.batchSize) break;
				if (boundaryBatches >= this.maxBatches) boundaryTruncated = true;
			}
		}

		// Advance the cursor only when the cycle completed. Upserts are
		// idempotent, so a retried cycle costs time, never correctness.
		if (!boundaryTruncated) {
			await this.cp.set(
				cursorKey,
				{ watermark: last, rows, at: iso(this.now()) },
				{ ttlMs: 0 },
			);
		}

		return {
			mode: "watermark",
			rows,
			batches,
			watermark: last,
			boundary_rows: boundaryRows,
			truncated: boundaryTruncated,
			cursor_advanced: !boundaryTruncated,
		};
	}

	async _fullScan(table, meta, opts = {}) {
		const pk = meta.pk;
		const seen = new Set();
		let rows = 0;
		let batches = 0;
		let lastPk = null;
		let truncated = false;

		while (batches < this.maxBatches) {
			const pageOpts = { orderBy: pk, ascending: true, limit: this.batchSize };
			if (lastPk != null) pageOpts.since = { column: pk, value: lastPk };
			const page = await this.source.select(table, pageOpts);
			batches += 1;
			if (!page.length) break;
			await this.target.upsert(table, page, {});
			rows += page.length;
			for (const row of page) {
				if (row?.[pk] != null) seen.add(String(row[pk]));
			}
			lastPk = page[page.length - 1][pk];
			if (page.length < this.batchSize) break;
			if (batches >= this.maxBatches) truncated = true;
		}

		let pruned = 0;
		let pruneSkipped = null;
		let pruneComplete = true;

		if (rows === 0) {
			pruneSkipped = "source-empty";
		} else if (truncated) {
			pruneSkipped = "primary-scan-truncated";
		} else {
			let tgtPk = null;
			let tgtBatches = 0;
			while (tgtBatches < this.maxBatches) {
				const pageOpts = { orderBy: pk, ascending: true, limit: this.batchSize };
				if (tgtPk != null) pageOpts.since = { column: pk, value: tgtPk };
				const page = await this.target.select(table, pageOpts);
				tgtBatches += 1;
				if (!page.length) break;
				for (const row of page) {
					const id = row?.[pk];
					if (id == null) continue;
					if (!seen.has(String(id))) {
						await this.target.remove(table, id);
						pruned += 1;
					}
				}
				tgtPk = page[page.length - 1][pk];
				if (page.length < this.batchSize) break;
				if (tgtBatches >= this.maxBatches) pruneComplete = false;
			}
		}

		await this.cp.set(
			`${CURSOR_PREFIX}${table}`,
			{ mode: "full", rows, at: iso(this.now()) },
			{ ttlMs: 0 },
		);

		return {
			mode: "full",
			rows,
			batches,
			pruned,
			prune_skipped: pruneSkipped,
			prune_complete: pruneComplete,
			truncated,
		};
	}

	/**
	 * Compares primary and standby key sets. Reports counts and the first few
	 * mismatches. `truncated` means the comparison hit a cap and the numbers are
	 * a lower bound — never present a truncated verify as a clean one.
	 */
	async verifyTable(table, opts = {}) {
		const meta = tableMeta(table);
		const pk = meta.pk;
		const cap = opts.maxRows ?? this.maxScanRows;
		const read = async (adapter) => {
			const ids = new Set();
			let last = null;
			let batches = 0;
			let truncated = false;
			while (batches < this.maxBatches * 4) {
				const pageOpts = { orderBy: pk, ascending: true, limit: this.batchSize };
				if (last != null) pageOpts.since = { column: pk, value: last };
				const page = await adapter.select(table, pageOpts);
				batches += 1;
				if (!page.length) break;
				for (const row of page) {
					if (row?.[pk] != null) ids.add(String(row[pk]));
				}
				last = page[page.length - 1][pk];
				if (ids.size >= cap) {
					truncated = true;
					break;
				}
				if (page.length < this.batchSize) break;
			}
			return { ids, truncated };
		};

		const primary = await read(this.source);
		const standby = await read(this.target);
		const missing = [...primary.ids].filter((id) => !standby.ids.has(id));
		const extra = [...standby.ids].filter((id) => !primary.ids.has(id));
		return {
			table,
			source: primary.ids.size,
			target: standby.ids.size,
			missing: missing.length,
			extra: extra.length,
			missing_ids: missing.slice(0, 20),
			extra_ids: extra.slice(0, 20),
			truncated: primary.truncated || standby.truncated,
		};
	}

	/**
	 * One pass over every in-scope table. Per-table failures are dead-lettered
	 * and do not abort the cycle — one broken table must not stop the rest from
	 * converging.
	 */
	async runCycle(opts = {}) {
		if (opts.mode && opts.mode !== "primary") {
			return {
				skipped: true,
				reason: `replication only runs in primary mode (mode=${opts.mode})`,
				at: iso(this.now()),
			};
		}
		const tables = opts.tables || VOICEFLOW_TABLES;
		const started = this.now();
		const results = [];
		let ok = 0;
		let failed = 0;
		let rows = 0;
		let pruned = 0;

		for (const table of tables) {
			try {
				const r = await this.replicateTable(table, opts);
				results.push({
					table,
					ok: true,
					mode: r.mode,
					rows: r.rows,
					pruned: r.pruned || 0,
					truncated: r.truncated === true,
				});
				ok += 1;
				rows += r.rows || 0;
				pruned += r.pruned || 0;
			} catch (err) {
				failed += 1;
				const record = await this.dlq.push({
					table,
					op: "replicate",
					error: err,
					source: "replicator",
				});
				results.push({
					table,
					ok: false,
					error: shortError(err),
					code: err?.code || null,
					dlq: record?.id || null,
				});
			}
		}

		const summary = {
			at: iso(this.now()),
			started_at: iso(started),
			ms: this.now() - started,
			tables: tables.length,
			ok,
			failed,
			rows,
			pruned,
			results,
		};
		// Persist a compact summary: the control plane is not a log sink.
		await this.cp.set(
			STATUS_KEY,
			{
				at: summary.at,
				ms: summary.ms,
				tables: summary.tables,
				ok: summary.ok,
				failed: summary.failed,
				rows: summary.rows,
				pruned: summary.pruned,
				results: results.map((r) => ({
					table: r.table,
					ok: r.ok,
					rows: r.rows || 0,
					mode: r.mode || null,
					error: r.error || null,
				})),
			},
			{ ttlMs: STATUS_TTL_MS },
		);
		return summary;
	}

	/** Operator-facing snapshot: last cycle plus per-table cursors. */
	async status() {
		const last = await this.cp.get(STATUS_KEY);
		const cursors = {};
		for (const table of watermarkTables()) {
			const rec = await this.cp.get(`${CURSOR_PREFIX}${table}`);
			cursors[table] = rec?.value || null;
		}
		return {
			last_cycle: last?.value || null,
			cursors,
			scope: {
				tables: VOICEFLOW_TABLES.length,
				watermark: watermarkTables().length,
				full_scan: fullScanTables().length,
			},
		};
	}
}
