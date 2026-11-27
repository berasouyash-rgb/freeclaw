// ─── In-memory adapter ──────────────────────────────────────────
// A real, complete adapter used for tests and for offline drills. It is not
// a mock: it implements the same contract, including versioned writes, so
// conflict and idempotency tests exercise production logic rather than stubs.
//
// It can be made to fail on demand (`failNext`, `down`) to simulate an
// outage without touching any live system.

import { BaseAdapter, applySelectOptions } from "./base.js";
import { AdapterUnavailableError, StaleWriteError } from "../errors.js";
import { tableMeta, inScope } from "../tables.js";

function clone(value) {
	return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class MemoryAdapter extends BaseAdapter {
	/**
	 * @param {{ name?: string, now?: () => number }} [opts]
	 */
	constructor(opts = {}) {
		super(opts.name || "memory");
		this.now = opts.now || Date.now;
		/** @type {Map<string, Map<string, Record<string, unknown>>>} */
		this._data = new Map();
		this.down = false;
		this.failNext = 0;
		this.calls = [];
	}

	_table(table) {
		if (!inScope(table)) throw new Error(`Table "${table}" is outside the VoiceFlow scope`);
		if (!this._data.has(table)) this._data.set(table, new Map());
		return this._data.get(table);
	}

	_guard(op, table) {
		this.calls.push({ op, table, at: this.now() });
		if (this.down) throw new AdapterUnavailableError(this.name, "simulated outage");
		if (this.failNext > 0) {
			this.failNext -= 1;
			throw new AdapterUnavailableError(this.name, "simulated transient failure");
		}
	}

	async health() {
		const started = this.now();
		if (this.down) {
			return { ok: false, latencyMs: this.now() - started, detail: "simulated outage" };
		}
		return { ok: true, latencyMs: this.now() - started };
	}

	async select(table, opts = {}) {
		this._guard("select", table);
		const rows = [...this._table(table).values()].map(clone);
		return applySelectOptions(rows, opts);
	}

	async get(table, id) {
		this._guard("get", table);
		const pk = tableMeta(table).pk;
		const row = this._table(table).get(String(id));
		if (!row) return null;
		// Guard against a caller passing a non-pk id.
		if (row[pk] !== undefined && String(row[pk]) !== String(id)) return null;
		return clone(row);
	}

	async insert(table, row) {
		this._guard("insert", table);
		const { pk } = tableMeta(table);
		const id = String(row[pk]);
		const store = this._table(table);
		if (store.has(id)) throw new Error(`${table}/${id} already exists`);
		const stored = clone(row);
		store.set(id, stored);
		return clone(stored);
	}

	async update(table, id, patch, opts = {}) {
		this._guard("update", table);
		const store = this._table(table);
		const current = store.get(String(id));
		if (!current) return null;
		if (
			typeof opts.expectedVersion === "number" &&
			typeof current.version === "number" &&
			current.version !== opts.expectedVersion
		) {
			throw new StaleWriteError(table, id, opts.expectedVersion, current.version);
		}
		const next = {
			...current,
			...clone(patch),
			version:
				typeof current.version === "number" ? current.version + 1 : current.version,
		};
		store.set(String(id), next);
		return clone(next);
	}

	async upsert(table, rows, opts = {}) {
		this._guard("upsert", table);
		const { pk } = tableMeta(table);
		const store = this._table(table);
		const list = Array.isArray(rows) ? rows : [rows];
		let written = 0;
		for (const row of list) {
			const id = String(row[pk]);
			const current = store.get(id);
			if (
				current &&
				typeof opts.expectedVersion === "number" &&
				typeof current.version === "number" &&
				current.version !== opts.expectedVersion
			) {
				throw new StaleWriteError(table, id, opts.expectedVersion, current.version);
			}
			store.set(id, clone(row));
			written += 1;
		}
		return written;
	}

	async remove(table, id) {
		this._guard("remove", table);
		return this._table(table).delete(String(id));
	}

	// ── Test helpers ──────────────────────────────────────────────
	seed(table, rows) {
		const { pk } = tableMeta(table);
		const store = this._table(table);
		for (const row of rows) store.set(String(row[pk]), clone(row));
		return this;
	}

	count(table) {
		return this._table(table).size;
	}

	snapshot(table) {
		return [...this._table(table).values()].map(clone);
	}

	reset() {
		this._data.clear();
		this.down = false;
		this.failNext = 0;
		this.calls = [];
	}
}
