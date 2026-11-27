// ─── Supabase adapter ───────────────────────────────────────────
// Wraps the existing service-role Supabase client behind the adapter
// contract the router understands. No credentials live here: the caller
// injects a client (api/_db-client.js in production, a fake in tests).
//
// Error mapping matters for failover: only infrastructure failures may be
// retryable. A unique-constraint violation or a stale version must never be
// mistaken for an outage.

import { BaseAdapter } from "./base.js";
import {
	AdapterUnavailableError,
	BackendError,
	StaleWriteError,
} from "../errors.js";
import { inScope, tableMeta } from "../tables.js";

function toBackendError(error, adapter) {
	const status = Number(error?.status || error?.statusCode || 0);
	const message = String(error?.message || error || "supabase error");
	const code = String(error?.code || "");
	const retryable = status >= 500 || status === 429 || /fetch failed|timeout|ECONN|ETIMEDOUT/i.test(message);
	return new BackendError(message.slice(0, 300), {
		code: code || (retryable ? "SUPABASE_UNAVAILABLE" : "SUPABASE_ERROR"),
		retryable,
		adapter,
	});
}

function isUniqueViolation(error) {
	return String(error?.code || "") === "23505";
}

export class SupabaseAdapter extends BaseAdapter {
	/**
	 * @param {{ from: Function }} client service-role Supabase client
	 * @param {{ name?: string }} [opts]
	 */
	constructor(client, opts = {}) {
		super(opts.name || "supabase");
		if (!client || typeof client.from !== "function") {
			throw new AdapterUnavailableError(this.name, "no Supabase client provided");
		}
		this.client = client;
	}

	_guard(table) {
		if (!inScope(table)) throw new Error(`Table "${table}" is outside the VoiceFlow scope`);
		return tableMeta(table);
	}

	async health() {
		const started = Date.now();
		try {
			const { error } = await this.client.from("settings").select("key").limit(1);
			if (error) return { ok: false, latencyMs: Date.now() - started, detail: error.message };
			return { ok: true, latencyMs: Date.now() - started };
		} catch (err) {
			return {
				ok: false,
				latencyMs: Date.now() - started,
				detail: String(err?.message || err).slice(0, 200),
			};
		}
	}

	async select(table, opts = {}) {
		this._guard(table);
		let query = this.client.from(table).select("*");
		if (opts.where && typeof opts.where === "object") {
			for (const [column, value] of Object.entries(opts.where)) {
				query = query.eq(column, value);
			}
		}
		if (opts.since?.column && opts.since.value != null) {
			query = query.gt(opts.since.column, opts.since.value);
		}
		if (opts.orderBy) {
			query = query.order(opts.orderBy, { ascending: opts.ascending !== false });
		}
		if (typeof opts.limit === "number") query = query.limit(opts.limit);
		const { data, error } = await query;
		if (error) throw toBackendError(error, this.name);
		// Postgres already applied where/since/order/limit; do NOT re-filter
		// server rows in memory (that would drop rows whose columns are null).
		return Array.isArray(data) ? data : [];
	}

	async get(table, id) {
		const meta = this._guard(table);
		const { data, error } = await this.client
			.from(table)
			.select("*")
			.eq(meta.pk, id)
			.maybeSingle();
		if (error) throw toBackendError(error, this.name);
		return data || null;
	}

	async insert(table, row) {
		this._guard(table);
		const { data, error } = await this.client.from(table).insert(row).select().single();
		if (error) {
			if (isUniqueViolation(error)) {
				throw new BackendError(`Duplicate row in ${table}`, {
					code: "DUPLICATE",
					retryable: false,
					adapter: this.name,
				});
			}
			throw toBackendError(error, this.name);
		}
		return data;
	}

	async update(table, id, patch, opts = {}) {
		const meta = this._guard(table);
		let query = this.client.from(table).update(patch).eq(meta.pk, id);
		if (typeof opts.expectedVersion === "number") {
			query = query.eq("version", opts.expectedVersion);
		}
		const { data, error } = await query.select();
		if (error) throw toBackendError(error, this.name);
		const rows = Array.isArray(data) ? data : [];
		if (rows.length === 0) {
			throw new StaleWriteError(table, id, opts.expectedVersion, undefined);
		}
		return rows[0];
	}

	async upsert(table, rows, opts = {}) {
		const meta = this._guard(table);
		const { data, error } = await this.client
			.from(table)
			.upsert(rows, { onConflict: opts.onConflict || meta.pk })
			.select();
		if (error) throw toBackendError(error, this.name);
		return Array.isArray(data) ? data.length : 0;
	}

	async remove(table, id) {
		const meta = this._guard(table);
		const { data, error } = await this.client
			.from(table)
			.delete()
			.eq(meta.pk, id)
			.select(meta.pk);
		if (error) throw toBackendError(error, this.name);
		return Array.isArray(data) ? data.length > 0 : true;
	}
}

/** Factory used by the production composition root. */
export function createSupabaseAdapter(client, opts) {
	return new SupabaseAdapter(client, opts);
}
