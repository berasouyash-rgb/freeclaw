// ─── Durable write outbox: record, don't lose, replay ──────────────
// The mirror copies writes that Supabase ALREADY committed. This module covers
// the other half: writes Supabase could not accept at all (internal error,
// egress limit, rate limit, transport reset).
//
// Before this, such a write failed closed — the user's edit was simply gone.
// Now it is recorded in Firestore (`__outbox`) and reported to the user as
// accepted, then replayed onto the primary when Supabase answers again.
//
// THE RULES THAT KEEP THIS HONEST
//   1. Nothing is recorded unless the standby credential exists. Without it
//      there is no durable store, so the write must still fail closed — and
//      `outboxStats().configured === false` is what tells the reliability
//      dashboard to raise WRITE_OUTBOX_UNAVAILABLE instead of pretending.
//   2. Only infrastructure failures are queueable. 400/401/403/404/409/422 is
//      the app saying the request was wrong; replaying that would apply an
//      invalid write later, when nobody is watching. Those still fail.
//   3. Every queued row gets a DETERMINISTIC id derived from its content, so a
//      client retry of the same save collapses onto the same outbox document
//      instead of queueing a duplicate. (Generated ids are real UUIDs, so they
//      satisfy a `uuid` primary-key column.)
//   4. A row whose primary key cannot be determined is NOT queued. Guessing
//      would risk applying an edit to the wrong record — worse than an honest
//      error at the moment the user pressed save.
//   5. Replay stops at the first failure: if the primary is still unhealthy,
//      hammering it makes recovery slower and reorders writes.
import { createHash } from "node:crypto";

import {
	firestoreBase,
	fromFields,
	isMirroredTable,
	mirroredTables,
	opFromMethod,
	standbyAuthHeaders,
	standbyConfigured,
	standbyProject,
	tableFromUrl,
	toFields,
} from "./_mirror.js";
import { tableMeta } from "./_backend/tables.js";

/** Firestore collection holding writes that have not reached the primary. */
export const OUTBOX_COLLECTION = "__outbox";

const MAX_ROWS_PER_EVENT = 200;
const MAX_PENDING = 200;
const MAX_REPLAY_ATTEMPTS = 8;

const stats = {
	recorded: 0,
	replayed: 0,
	conflicts: 0,
	failed: 0,
	refused: 0,
	lastError: null,
	lastRecordedAt: 0,
	lastReplayAt: 0,
	// Observed from the last listPending()/replayOutbox() run, not invented.
	// `null` means "not observed yet", which the dashboard renders as unknown
	// rather than as zero.
	pending: null,
	pendingObservedAt: 0,
};

export function __resetOutboxForTests() {
	stats.recorded = 0;
	stats.replayed = 0;
	stats.conflicts = 0;
	stats.failed = 0;
	stats.refused = 0;
	stats.lastError = null;
	stats.lastRecordedAt = 0;
	stats.lastReplayAt = 0;
	stats.pending = null;
	stats.pendingObservedAt = 0;
}

/**
 * Outbox counters for the reliability dashboard.
 *
 * `durable` is about where the record lives (Firestore), `configured` is about
 * whether that store is reachable at all. They are reported separately because
 * conflating them is exactly the "silently broken redundancy" failure mode.
 */
export function outboxStats() {
	const configured = standbyConfigured();
	return {
		...stats,
		collection: OUTBOX_COLLECTION,
		configured,
		durable: configured,
		tables: [...mirroredTables()],
	};
}

// ── what may be queued ──────────────────────────────────────────────

/**
 * Should this failed primary write be recorded for replay?
 *
 * `status` 0/undefined means the transport itself failed (timeout, reset, DNS).
 */
export function shouldQueueWrite(method, table, status) {
	const op = opFromMethod(method);
	if (!op) return false;
	if (!isMirroredTable(table)) return false;
	const code = Number(status) || 0;
	if (code === 0) return true; // transport failure
	// 402 quota, 408 timeout, 429 rate limit, 5xx: the primary cannot accept
	// the write right now. Anything else is a correct rejection — keep it.
	if (code === 402 || code === 408 || code === 429) return true;
	return code >= 500;
}

// ── row preparation ─────────────────────────────────────────────────

/** Primary key for a mirrored table, falling back to `id`. */
export function primaryKey(table) {
	try {
		const meta = tableMeta(table);
		if (meta?.pk) return meta.pk;
	} catch {
		/* out-of-scope table: use the conventional pk */
	}
	if (table === "settings") return "key";
	if (table === "users_meta") return "anon_id";
	if (table === "chat_threads") return "thread_id";
	return "id";
}

function stableStringify(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const keys = Object.keys(value).sort();
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
		.join(",")}}`;
}

/**
 * Deterministic UUIDv4-shaped id from a content seed.
 *
 * Shaped like a v4 UUID (so a `uuid` column accepts it) but derived from the
 * content, so replay and retry are idempotent instead of duplicating rows.
 */
export function deterministicId(seed) {
	const hash = createHash("sha256").update(String(seed)).digest();
	hash[6] = (hash[6] & 0x0f) | 0x40;
	hash[8] = (hash[8] & 0x3f) | 0x80;
	const hex = hash.subarray(0, 16).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
		16,
		20,
	)}-${hex.slice(20, 32)}`;
}

/**
 * Normalise a write body into replayable rows.
 *
 * Returns `{ ok, rows }` or `{ ok: false, reason }`. A row without a usable
 * primary key is refused rather than guessed at.
 */
export function prepareWriteRows(table, op, body) {
	const list = (Array.isArray(body) ? body : [body]).filter(
		(row) => row && typeof row === "object" && !Array.isArray(row),
	);
	if (!list.length) return { ok: false, reason: "empty_body" };
	if (list.length > MAX_ROWS_PER_EVENT) return { ok: false, reason: "too_many_rows" };

	const pk = primaryKey(table);
	const rows = [];
	for (let index = 0; index < list.length; index += 1) {
		const row = { ...list[index] };
		const present = row[pk];
		if (present === undefined || present === null || present === "") {
			// Only an `id` primary key may be minted here: for `settings` (key)
			// or `users_meta` (anon_id) a generated value would point at a
			// record that does not exist, so refuse instead of inventing one.
			if (pk !== "id" || op === "delete" || op === "update") {
				return { ok: false, reason: "missing_primary_key" };
			}
			row.id = deterministicId(`${table}|${op}|${stableStringify(row)}|${index}`);
		}
		rows.push(row);
	}
	return { ok: true, rows, pk };
}

// ── Firestore transport ─────────────────────────────────────────────

function docUrl(id) {
	return `${firestoreBase()}/v1/projects/${standbyProject()}/databases/(default)/documents/${OUTBOX_COLLECTION}/${id}`;
}

function queryUrl() {
	return `${firestoreBase()}/v1/projects/${standbyProject()}/databases/(default)/documents:runQuery`;
}

function eventDocId(table, op, reason, rows) {
	return deterministicId(`outbox|${table}|${op}|${reason}|${stableStringify(rows)}`);
}

/**
 * Record one failed write for replay.
 *
 * Never throws. Returns `{ ok: true, id }` only when Firestore acknowledged
 * the write; every other outcome is `{ ok: false, reason }` so a caller can
 * fall back to failing closed instead of silently dropping the edit.
 */
export async function enqueueWrite(
	{ table, op, rows, reason = "primary_unavailable", now = Date.now() },
	fetchImpl = globalThis.fetch,
) {
	if (!standbyConfigured()) return { ok: false, reason: "not_configured" };
	if (!isMirroredTable(table)) return { ok: false, reason: "not_mirrored" };

	const prepared = prepareWriteRows(table, op, rows);
	if (!prepared.ok) {
		stats.refused += 1;
		return { ok: false, reason: prepared.reason };
	}

	const id = eventDocId(table, op, reason, prepared.rows);
	const body = {
		fields: toFields({
			table,
			op,
			pk: prepared.pk,
			reason,
			recorded_at: new Date(now).toISOString(),
			replayed: false,
			attempts: 0,
			payload: prepared.rows,
		}),
	};

	try {
		const headers = await standbyAuthHeaders();
		const res = await fetchImpl(docUrl(id), {
			method: "PATCH",
			headers,
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			stats.failed += 1;
			stats.lastError = `http_${res.status}`;
			return { ok: false, reason: `http_${res.status}`, detail: String(detail).slice(0, 200) };
		}
		stats.recorded += 1;
		stats.lastRecordedAt = now;
		return { ok: true, id, rows: prepared.rows, table, op, pk: prepared.pk };
	} catch (err) {
		stats.failed += 1;
		stats.lastError = "transport_error";
		return { ok: false, reason: "transport_error", detail: String(err?.message || err) };
	}
}

/**
 * Turn a failed PostgREST request into a queued outbox event.
 *
 * The single entry point used by `_db-client.js`, so there is one definition of
 * "what counts as a queueable write".
 */
export async function queueWriteForReplay(url, options, status, fetchImpl) {
	const method = options?.method;
	const table = tableFromUrl(url);
	const op = opFromMethod(method);
	if (!table || !op || !shouldQueueWrite(method, table, status)) {
		return { recorded: false, reason: "not_queueable" };
	}
	const raw = typeof options?.body === "string" ? options.body : null;
	if (!raw) return { recorded: false, reason: "empty_body" };
	let body;
	try {
		body = JSON.parse(raw);
	} catch {
		return { recorded: false, reason: "unparseable_body" };
	}
	const reason = Number(status) ? `http_${Number(status)}` : "transport_error";
	const result = await enqueueWrite({ table, op, rows: body, reason }, fetchImpl);
	return { ...result, recorded: result.ok === true, table, op, reason };
}

/**
 * Response handed back to the caller for a durably recorded write.
 *
 * It is a success because the write WILL be applied — but it is marked, so an
 * operator can see in a log, a trace or the client that this row is not in the
 * primary yet. Never present it as a normal primary commit.
 */
export function acceptedResponse({ rows, op, table, id }) {
	const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
	const headers = {
		"Content-Type": "application/json",
		"X-Write-Durability": "firebase-outbox",
		"X-Outbox-Id": String(id || ""),
		"X-Outbox-Table": String(table || ""),
	};
	const status = op === "delete" ? 204 : op === "insert" ? 201 : 200;
	const payload = op === "delete" ? "" : JSON.stringify(list);
	if (typeof Response === "function") {
		return new Response(op === "delete" ? null : payload, { status, headers });
	}
	return {
		ok: true,
		status,
		headers: { get: (key) => headers[key] ?? null },
		text: async () => payload,
		json: async () => (payload ? JSON.parse(payload) : null),
		clone() {
			return this;
		},
	};
}

// ── pending listing ─────────────────────────────────────────────────

/**
 * Reads unreplayed events in recording order.
 *
 * `pending` is capped by `limit`. `capped: true` says more may exist, so a
 * caller never reports "0 pending" from a truncated read.
 */
export async function listPending({ limit = 50, fetchImpl = globalThis.fetch } = {}) {
	if (!standbyConfigured()) {
		return { ok: false, reason: "not_configured", events: [], pending: null, capped: false };
	}
	const take = Math.min(Math.max(Number(limit) || 1, 1), MAX_PENDING);
	const structuredQuery = {
		from: [{ collectionId: OUTBOX_COLLECTION }],
		where: {
			fieldFilter: {
				field: { fieldPath: "replayed" },
				op: "EQUAL",
				value: { booleanValue: false },
			},
		},
		orderBy: [{ field: { fieldPath: "recorded_at" }, direction: "ASCENDING" }],
		limit: take,
	};
	try {
		const headers = await standbyAuthHeaders();
		const res = await fetchImpl(queryUrl(), {
			method: "POST",
			headers,
			body: JSON.stringify({ structuredQuery }),
		});
		if (!res.ok) return { ok: false, reason: `http_${res.status}`, events: [], pending: null, capped: false };
		const json = await res.json();
		const events = (Array.isArray(json) ? json : [])
			.filter((entry) => entry?.document?.fields)
			.map((entry) => {
				const doc = entry.document;
				const data = fromFields(doc.fields);
				const name = String(doc.name || "");
				return {
					id: name.slice(name.lastIndexOf("/") + 1),
					table: data.table,
					op: data.op,
					pk: data.pk || primaryKey(data.table),
					reason: data.reason,
					recorded_at: data.recorded_at,
					attempts: Number(data.attempts) || 0,
					rows: data.payload,
				};
			});
		stats.pending = events.length;
		stats.pendingObservedAt = Date.now();
		return { ok: true, events, pending: events.length, capped: events.length >= take };
	} catch (err) {
		return {
			ok: false,
			reason: "transport_error",
			detail: String(err?.message || err),
			events: [],
			pending: null,
			capped: false,
		};
	}
}

/** Mark one event applied. Field-masked so the payload is not rewritten. */
export async function markReplayed(id, { now = Date.now(), attempts = 1, fetchImpl = globalThis.fetch } = {}) {
	if (!id) return { ok: false, reason: "missing_id" };
	if (!standbyConfigured()) return { ok: false, reason: "not_configured" };
	const url = `${docUrl(id)}?updateMask.fieldPaths=replayed&updateMask.fieldPaths=replayed_at&updateMask.fieldPaths=attempts`;
	const body = {
		fields: toFields({
			replayed: true,
			replayed_at: new Date(now).toISOString(),
			attempts,
		}),
	};
	try {
		const headers = await standbyAuthHeaders();
		const res = await fetchImpl(url, {
			method: "PATCH",
			headers,
			body: JSON.stringify(body),
		});
		if (!res.ok) return { ok: false, reason: `http_${res.status}` };
		return { ok: true };
	} catch (err) {
		return { ok: false, reason: "transport_error", detail: String(err?.message || err) };
	}
}

// ── replay ──────────────────────────────────────────────────────────

/**
 * Apply one queued event to the primary.
 *
 * Goes through `_db-client.js`, so a replayed write takes the same path as a
 * live one — including the mirror, which is what closes the copy gap for rows
 * written while the primary was down.
 */
export async function applyToPrimary(event) {
	const mod = await import("./_db-client.js");
	const supabase = mod.default;
	const table = event.table;
	const pk = event.pk || primaryKey(table);
	const rows = Array.isArray(event.rows) ? event.rows : [event.rows];

	if (event.op === "insert" || event.op === "upsert") {
		const { error } = await supabase.from(table).upsert(rows, { onConflict: pk });
		if (!error) return { ok: true };
		// A 409 means the row is already there — the write landed, so the
		// event is done, not failed.
		if (/duplicate|conflict/i.test(String(error.message || ""))) return { ok: true, conflict: true };
		return { ok: false, reason: error.code || "write_error", detail: error.message };
	}

	if (event.op === "update") {
		for (const row of rows) {
			const { [pk]: key, ...patch } = row;
			if (key === undefined || key === null) return { ok: false, reason: "missing_primary_key" };
			const { error } = await supabase.from(table).update(patch).eq(pk, key);
			if (error) return { ok: false, reason: error.code || "write_error", detail: error.message };
		}
		return { ok: true };
	}

	if (event.op === "delete") {
		for (const row of rows) {
			const key = row?.[pk];
			if (key === undefined || key === null) return { ok: false, reason: "missing_primary_key" };
			const { error } = await supabase.from(table).delete().eq(pk, key);
			if (error) return { ok: false, reason: error.code || "write_error", detail: error.message };
		}
		return { ok: true };
	}

	return { ok: false, reason: "bad_operation" };
}

/**
 * Replay pending writes onto the primary.
 *
 * Stops at the first failure and reports it: continuing would reorder writes
 * against a primary that is still unhealthy. `apply` is injectable so tests
 * (and a dry run) never need a live Supabase.
 */
export async function replayOutbox({
	limit = 25,
	apply = applyToPrimary,
	now = () => Date.now(),
	fetchImpl = globalThis.fetch,
} = {}) {
	const pending = await listPending({ limit, fetchImpl });
	if (!pending.ok) {
		return {
			ok: false,
			reason: pending.reason,
			detail: pending.detail || null,
			replayed: 0,
			failed: 0,
			remaining: null,
		};
	}
	if (!pending.events.length) {
		return { ok: true, replayed: 0, failed: 0, conflicts: 0, remaining: 0, capped: false };
	}

	let replayed = 0;
	let failed = 0;
	let conflicts = 0;
	let stoppedOn = null;
	for (const event of pending.events) {
		if (event.attempts >= MAX_REPLAY_ATTEMPTS) {
			// Give up on a permanently poisoned event rather than retrying it
			// forever; it stays in the collection for an operator to inspect.
			failed += 1;
			stats.failed += 1;
			stats.lastError = "too_many_attempts";
			stoppedOn = "too_many_attempts";
			break;
		}
		let result;
		try {
			result = await apply(event);
		} catch (err) {
			result = { ok: false, reason: "transport_error", detail: String(err?.message || err) };
		}
		if (result?.ok) {
			await markReplayed(event.id, {
				now: now(),
				attempts: event.attempts + 1,
				fetchImpl,
			}).catch(() => ({ ok: false }));
			replayed += 1;
			stats.replayed += 1;
			if (result.conflict) {
				conflicts += 1;
				stats.conflicts += 1;
			}
			continue;
		}
		failed += 1;
		stats.failed += 1;
		stats.lastError = result?.reason || "unknown";
		stoppedOn = result?.reason || "unknown";
		break;
	}

	stats.lastReplayAt = now();
	stats.pending = Math.max(0, pending.events.length - replayed);
	stats.pendingObservedAt = stats.lastReplayAt;

	return {
		ok: failed === 0,
		replayed,
		failed,
		conflicts,
		stopped_on: stoppedOn,
		remaining: stats.pending,
		capped: pending.capped === true,
	};
}

/**
 * Operator-facing outbox summary: one call that answers "is anything stuck?".
 */
export async function outboxReport({ limit = 20, fetchImpl = globalThis.fetch } = {}) {
	const pending = await listPending({ limit, fetchImpl });
	return {
		stats: outboxStats(),
		pending: {
			ok: pending.ok,
			count: pending.ok ? pending.events.length : null,
			capped: pending.capped === true,
			reason: pending.reason || null,
			events: pending.ok
				? pending.events.map((event) => ({
						id: event.id,
						table: event.table,
						op: event.op,
						reason: event.reason,
						recorded_at: event.recorded_at,
						attempts: event.attempts,
					}))
				: [],
		},
	};
}
