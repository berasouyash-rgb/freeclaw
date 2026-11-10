// ─── Per-entity conflict rules ──────────────────────────────────
// There is deliberately no universal "last write wins". LWW is only correct
// when the two writes are genuinely the same field of the same entity and the
// later clock is trustworthy — neither holds across two data planes whose
// clocks and replication lag differ.
//
// Each table declares a strategy in tables.js, and this module enforces it:
//
//   append_only  (audit/telemetry/logs)  inserts only; an update is a bug.
//   versioned    (posts/comments/polls…) the writer must present the version
//                it read. Native `updated_at`/`version` where the column
//                exists; otherwise a control-plane CAS key.
//   kv           (settings)              CAS on the key, never blind overwrite.
//   unique_key   (poll_votes/reactions)  natural-key upsert; duplicate is a
//                                        no-op, not a conflict.
//
// Two entry points:
//   prepareWrite()          author-side, before touching an adapter
//   resolveReplicationConflict()  standby-side, when primary and replica differ

import { tableMeta } from "./tables.js";
import { getControlPlane } from "./control-plane.js";
import { BackendError, StaleWriteError } from "./errors.js";

/** Raised when a write violates the table's declared strategy. */
export class ConflictError extends BackendError {
	constructor(message, opts = {}) {
		super(message, { code: opts.code || "CONFLICT", retryable: false, ...opts });
		this.name = "ConflictError";
		this.table = opts.table || null;
		this.id = opts.id || null;
	}
}

function versionKey(table, id) {
	return `entity_version:${table}:${id}`;
}

function isBlank(v) {
	return v === undefined || v === null || v === "";
}

export class ConflictResolver {
	/**
	 * @param {{ controlPlane?: object, now?: () => number }} [opts]
	 */
	constructor(opts = {}) {
		this.cp = opts.controlPlane || getControlPlane();
		this.now = opts.now || Date.now;
	}

	/**
	 * Validates a write against the entity's current state.
	 *
	 * @param {{ table: string, id: string|number, current?: object|null,
	 *           incoming?: object, expectedVersion?: number|string|null,
	 *           force?: boolean, actorId?: string }} req
	 * @returns {Promise<{ action: "insert"|"update"|"upsert", expectedVersion?: unknown,
	 *                     onConflict?: string, versionKey?: string, currentVersion?: unknown }>}
	 */
	async prepareWrite(req) {
		const { table, id } = req;
		const meta = tableMeta(table);
		const current = req.current || null;

		if (meta.strategy === "append_only") {
			if (current && !req.force) {
				throw new ConflictError(`${table} is append-only; ${meta.pk}=${id} already exists`, {
					code: "APPEND_ONLY",
					table,
					id,
				});
			}
			return { action: "insert" };
		}

		if (meta.strategy === "unique_key") {
			const onConflict = meta.uniqueOn?.join(",") || meta.pk;
			return { action: "upsert", onConflict };
		}

		if (meta.strategy === "kv") {
			// Settings: CAS on the control plane keyed by the logical key.
			const key = versionKey(table, id);
			const rec = await this.cp.get(key);
			const currentVersion = rec ? rec.version : 0;
			if (!req.force && req.expectedVersion !== undefined && req.expectedVersion !== null) {
				if (Number(req.expectedVersion) !== currentVersion) {
					throw new StaleWriteError(table, id, req.expectedVersion, currentVersion);
				}
			}
			return {
				action: current ? "update" : "insert",
				expectedVersion: currentVersion,
				versionKey: key,
				currentVersion,
			};
		}

		// versioned
		if (meta.versionColumn) {
			const currentVersion = current ? current[meta.versionColumn] : null;
			if (current && !req.force) {
				if (req.expectedVersion === undefined || req.expectedVersion === null) {
					throw new ConflictError(
						`${table}/${id} requires the ${meta.versionColumn} value that was read before writing`,
						{ code: "MISSING_VERSION", table, id },
					);
				}
				if (String(req.expectedVersion) !== String(currentVersion)) {
					throw new StaleWriteError(table, id, req.expectedVersion, currentVersion);
				}
			}
			return {
				action: current ? "update" : "insert",
				expectedVersion: currentVersion,
				currentVersion,
			};
		}

		// versioned without a native column → control-plane CAS.
		const key = versionKey(table, id);
		const rec = await this.cp.get(key);
		const currentVersion = rec ? rec.version : 0;
		if (current && !req.force) {
			if (req.expectedVersion === undefined || req.expectedVersion === null) {
				throw new ConflictError(
					`${table}/${id} has no native version column; pass the control-plane version that was read`,
					{ code: "MISSING_VERSION", table, id },
				);
			}
			if (Number(req.expectedVersion) !== currentVersion) {
				throw new StaleWriteError(table, id, req.expectedVersion, currentVersion);
			}
		}
		return {
			action: current ? "update" : "insert",
			expectedVersion: currentVersion,
			versionKey: key,
			currentVersion,
		};
	}

	/**
	 * Commits the control-plane version bump after a successful write.
	 * Native-version tables are bumped by the database column itself, so this
	 * is a no-op for them.
	 */
	async commitWrite(table, id, prepared) {
		if (!prepared?.versionKey) return null;
		const expected = prepared.expectedVersion ?? 0;
		const cas = await this.cp.compareAndSet(
			prepared.versionKey,
			expected,
			{ at: this.now(), table, id: String(id) },
			{ ttlMs: 0 },
		);
		if (!cas.ok) {
			// Another writer advanced the version between our read and commit.
			// The data write already happened under a validated read, so this is
			// reported rather than rolled back; the caller can retry the read.
			throw new StaleWriteError(table, id, expected, cas.version);
		}
		return cas.version;
	}

	/**
	 * Standby merge rule. Returns the document that should win and why.
	 *
	 * `local`  — what the standby currently holds (may be null)
	 * `remote` — the freshly read primary revision (may be null)
	 * `source` — "supabase" | "firebase"
	 *
	 * @returns {{ winner: object|null, loser: object|null, reason: string, conflict: boolean }}
	 */
	resolveReplicationConflict(table, local, remote, source = "supabase") {
		const meta = tableMeta(table);
		if (!local) return { winner: remote, loser: null, reason: "no-local", conflict: false };
		if (!remote) return { winner: local, loser: null, reason: "no-remote", conflict: false };

		if (meta.strategy === "append_only") {
			// Append-only rows are immutable once written; the primary is
			// authoritative for the row body but the row must never disappear.
			return {
				winner: remote,
				loser: local,
				reason: "append-only-primary-authoritative",
				conflict: JSON.stringify(local) !== JSON.stringify(remote),
			};
		}

		if (meta.strategy === "unique_key") {
			// The earliest row wins so a vote/reaction cannot be double counted
			// by a late replica write.
			const lc = local.created_at || "";
			const rc = remote.created_at || "";
			const winner = lc && rc ? (lc <= rc ? local : remote) : remote;
			return {
				winner,
				loser: winner === local ? remote : local,
				reason: "unique-key-earliest",
				conflict: JSON.stringify(local) !== JSON.stringify(remote),
			};
		}

		if (meta.strategy === "kv") {
			const lv = local[meta.versionColumn || "updated_at"];
			const rv = remote[meta.versionColumn || "updated_at"];
			const winner = String(rv || "") >= String(lv || "") ? remote : local;
			return {
				winner,
				loser: winner === remote ? local : remote,
				reason: "kv-newest-updated_at",
				conflict: JSON.stringify(local) !== JSON.stringify(remote),
			};
		}

		// versioned
		const col = meta.versionColumn;
		if (col) {
			const lv = local[col];
			const rv = remote[col];
			const winner = String(rv ?? "") >= String(lv ?? "") ? remote : local;
			return {
				winner,
				loser: winner === remote ? local : remote,
				reason: `versioned-${col}`,
				conflict: JSON.stringify(local) !== JSON.stringify(remote),
			};
		}

		// No native version: compare the standby's recorded source revision.
		const lv = local?.__meta?.version ?? 0;
		const rv = remote?.__meta?.version ?? 0;
		const winner = rv >= lv ? remote : local;
		return {
			winner,
			loser: winner === remote ? local : remote,
			reason: "versioned-control-plane",
			conflict: JSON.stringify(local) !== JSON.stringify(remote),
		};
	}

	/** Reads the control-plane version for an entity (0 when unseen). */
	async readVersion(table, id) {
		const meta = tableMeta(table);
		if (meta.versionColumn) return null; // caller should read the row
		const rec = await this.cp.get(versionKey(table, id));
		return rec ? rec.version : 0;
	}
}
