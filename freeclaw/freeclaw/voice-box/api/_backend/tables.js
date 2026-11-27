// ─── VoiceFlow data-plane scope ─────────────────────────────────
// The Supabase project hosting VoiceFlow is SHARED with 42 unrelated
// tables (cricket stats, diet/fitness logs, an employee-monitoring suite).
// Replication, backup, and failover must never touch those. This file is
// the single authoritative allowlist.
//
// Every column below was read from the LIVE PostgREST OpenAPI document on
// 2026-11-07 (probe: D:\Temp\opencode\schema-columns.mjs →
// voiceflow-recovery/columns.json). It is not inferred from migrations:
// the migration directory declares 38 tables while the live DB has 76, and
// 012_workforce_ledger.sql was never applied.
//
// Notable live facts that migration text gets wrong:
//   - There is NO `version` column on any content table. Only
//     `agent_config.version` (integer revision) exists.
//   - Soft delete is `deleted boolean` on posts/comments/polls.
//     There is no `deleted_at` anywhere.
//   - `chat_threads` is keyed by `thread_id`, not `id`.
//   - `settings` is keyed by `key` (its `id uuid` is a physical surrogate).
//   - `audit_logs` uses `timestamp`; `agent_executions` uses `started_at`.
//   - `users_meta` is keyed by `anon_id`.
//
// Watermark vs fullScan:
//   `watermark` drives incremental replication. It is only sufficient when
//   the column advances on EVERY mutation. Tables that are mutable but have
//   no `updated_at` would silently lose edits under an incremental cursor,
//   so they are marked `fullScan: true` and reconciled by full key-range
//   pagination each cycle instead. This is the honest trade: correct, a bit
//   more expensive, never silently stale.

/**
 * @typedef {"append_only"|"versioned"|"kv"|"unique_key"} ConflictStrategy
 */

/**
 * @typedef {object} TableMeta
 * @property {string} pk            Primary key column used as the document id.
 * @property {ConflictStrategy} strategy
 * @property {string|null} watermark  Monotonic column for incremental replication.
 * @property {string|null} versionColumn Optimistic-concurrency column, if native.
 * @property {string|null} softDelete  Boolean soft-delete column, if any.
 * @property {boolean} fullScan      True when incremental watermarking is unsafe.
 * @property {string[]} [uniqueOn]   Natural key for `unique_key` tables.
 */

/** @type {Readonly<Record<string, TableMeta>>} */
export const TABLE_META = Object.freeze({
	// ── User-generated content ────────────────────────────────────
	// Never universal last-write-wins. `posts` and `polls` carry a native
	// `updated_at`, so that column IS the version token.
	posts: {
		pk: "id",
		strategy: "versioned",
		watermark: "updated_at",
		versionColumn: "updated_at",
		softDelete: "deleted",
		fullScan: false,
	},
	comments: {
		pk: "id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: null, // no updated_at live → control-plane version
		softDelete: "deleted",
		fullScan: true, // edited/hidden/deleted mutate without a time column
	},
	polls: {
		pk: "id",
		strategy: "versioned",
		watermark: "updated_at",
		versionColumn: "updated_at",
		softDelete: "deleted",
		fullScan: false,
	},
	poll_votes: {
		pk: "id",
		strategy: "unique_key",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
		uniqueOn: ["poll_id", "author_id"],
	},
	reactions: {
		pk: "id",
		strategy: "unique_key",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
		uniqueOn: ["target_id", "target_type", "author_id", "kind"],
	},
	reports: {
		pk: "id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: null, // status is mutated by admins
		softDelete: null,
		fullScan: true,
	},
	notifications: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},

	// ── Conversation surfaces ─────────────────────────────────────
	conversations: {
		pk: "id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: true, // status / last_message_at mutate
	},
	messages: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	chat_threads: {
		pk: "thread_id", // NOT `id`
		strategy: "versioned",
		watermark: "updated_at",
		versionColumn: "updated_at",
		softDelete: null,
		fullScan: false,
	},
	chat_messages: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},

	// ── Identity / profile ────────────────────────────────────────
	users_meta: {
		pk: "anon_id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: true, // banned / strikes / spam_score mutate
	},
	admin_feedback: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	admin_tabs: {
		pk: "id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: true, // position mutates
	},

	// ── Key/value configuration ───────────────────────────────────
	// `settings` is keyed by `key`. Writes go through CAS on the control
	// plane so two concurrent writers cannot both "win" silently.
	settings: {
		pk: "key",
		strategy: "kv",
		watermark: "updated_at",
		versionColumn: "updated_at",
		softDelete: null,
		fullScan: false,
	},

	// ── Audit / telemetry: append-only, never merged ──────────────
	activity_logs: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	audit_logs: {
		pk: "id",
		strategy: "append_only",
		watermark: "timestamp", // NOT created_at
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	system_metrics: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	agent_activity_log: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	agent_executions: {
		pk: "id",
		strategy: "append_only",
		watermark: "started_at", // NOT created_at
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	tool_calls: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	tool_evidence: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},

	// ── Agent state ───────────────────────────────────────────────
	agent_config: {
		pk: "id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: "version", // genuine integer revision
		softDelete: null,
		fullScan: true,
	},
	agent_conversations: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	agent_goals: {
		pk: "id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: true,
	},
	agent_insights: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	agent_knowledge: {
		pk: "id",
		strategy: "versioned",
		watermark: "updated_at",
		versionColumn: "updated_at",
		softDelete: null,
		fullScan: false,
	},
	agent_learning: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	agent_memory: {
		pk: "id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: true, // access_count mutates
	},
	agent_reports: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	agent_suggestions: {
		pk: "id",
		strategy: "append_only",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: false,
	},
	agent_tasks: {
		pk: "id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: true,
	},
	approvals: {
		pk: "id",
		strategy: "versioned",
		watermark: "created_at",
		versionColumn: null,
		softDelete: null,
		fullScan: true,
	},
	knowledge_base: {
		pk: "id",
		strategy: "versioned",
		watermark: "updated_at",
		versionColumn: "updated_at",
		softDelete: null,
		fullScan: false,
	},
});

/** The 34 VoiceFlow tables. */
export const VOICEFLOW_TABLES = Object.freeze(Object.keys(TABLE_META));

/** Tables whose anon SELECT is intentionally allowed (realtime allowlist). */
export const ANON_READABLE_TABLES = Object.freeze(["posts", "comments", "polls"]);

/** Supabase Storage buckets owned by VoiceFlow. */
export const STORAGE_BUCKETS = Object.freeze(["chat-media", "voicebox-media"]);

/** Returns metadata for a table, throwing if it is outside the allowlist. */
export function tableMeta(table) {
	const meta = TABLE_META[table];
	if (!meta) throw new Error(`Table "${table}" is outside the VoiceFlow replication scope`);
	return meta;
}

/** True when the table may be replicated by this system. */
export function inScope(table) {
	return Object.prototype.hasOwnProperty.call(TABLE_META, table);
}

/** Tables that must be reconciled by full scan rather than a watermark. */
export function fullScanTables() {
	return VOICEFLOW_TABLES.filter((t) => TABLE_META[t].fullScan);
}

/** Tables safely replicable by watermark cursor. */
export function watermarkTables() {
	return VOICEFLOW_TABLES.filter((t) => !TABLE_META[t].fullScan && TABLE_META[t].watermark);
}
