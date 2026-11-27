// ═══════════════════════════════════════════════════════════════════
// Ops Event Log — typed event ingest + durable event log (SPEC §4)
// ═══════════════════════════════════════════════════════════════════
// The evidence spine of the autonomous operations system: every
// important system occurrence becomes a typed, deduplicated, durable
// event that independent readers (admin UI, incident detection,
// verification workers) can re-read later.
//
// Persistence: settings KV row `ops_event_log` (read-modify-write,
// same pattern as _events.js / _incidents.js). This is intentionally
// separate from the legacy `event_log` wake-signal bus — that one is
// ephemeral signalling, this one is append-only evidence.
//
// Guarantees:
//   - buildEvent REJECTS unknown types, missing envelope fields,
//     unknown priorities, and payloads over 16KB (fail loudly).
//   - appendEvent dedupes by deduplicationKey → {stored:false, reason}
//     so at-least-once producers stay idempotent (SPEC §4, R14/V5).
//   - appendEvent checks the write error explicitly and THROWS on
//     failure — a failed write never looks like success.
//   - Log is capped at MAX_EVENTS (500); oldest entries are trimmed.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

// ─── Event type catalog — SPEC §4 (canonical, extend only with spec) ─
export const OPS_EVENT_TYPES = Object.freeze([
	"NEW_POST",
	"NEW_COMMENT",
	"NEW_REPLY",
	"NEW_MESSAGE",
	"NEW_UPLOAD",
	"NEW_REPORT",
	"NEW_POLL",
	"NEW_VOTE",
	"NEW_REACTION",
	"NEW_ACCOUNT",
	"ACCOUNT_BEHAVIOR_CHANGE",
	"CONTENT_EDITED",
	"CONTENT_RESTORED",
	"CONTENT_REPORTED",
	"CONTENT_APPEALED",
	"CASE_CREATED",
	"CASE_UPDATED",
	"CASE_OVERDUE",
	"CASE_RESOLVED",
	"CASE_REOPENED",
	"SEARCH_ZERO_RESULT",
	"SEARCH_LOW_CONFIDENCE",
	"SEARCH_REGRESSION",
	"QUEUE_BACKLOG",
	"QUEUE_FAILURE",
	"JOB_TIMEOUT",
	"DATABASE_ANOMALY",
	"SLOW_QUERY",
	"LOCK_CONTENTION",
	"CONNECTION_PRESSURE",
	"STORAGE_ANOMALY",
	"CACHE_FAILURE",
	"LATENCY_REGRESSION",
	"ERROR_SPIKE",
	"REALTIME_FAILURE",
	"API_FAILURE",
	"NOTIFICATION_FAILURE",
	"EMAIL_FAILURE",
	"SMS_FAILURE",
	"PUSH_FAILURE",
	"SECURITY_EVENT",
	"AUTHORIZATION_FAILURE",
	"SUSPICIOUS_ACTIVITY",
	"ABUSE_SPIKE",
	"MODEL_FAILURE",
	"MODEL_DRIFT",
	"AI_REGRESSION",
	"TOOL_FAILURE",
	"DEPLOYMENT",
	"RELEASE",
	"CONFIG_CHANGE",
	"SCHEDULED_MAINTENANCE",
	"PERIODIC_HEALTH_CHECK",
]);

// Priority values are MODULE-OWNED: SPEC §4 requires a `priority` field
// on every event but does not enumerate values. This ladder is the
// local contract; changing it is a breaking change to stored events.
export const OPS_EVENT_PRIORITIES = Object.freeze([
	"critical",
	"high",
	"normal",
	"low",
]);

const SETTINGS_KEY = "ops_event_log";
const MAX_EVENTS = 500;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const ENVELOPE_FIELDS = [
	"id",
	"type",
	"timestamp",
	"source",
	"resource",
	"actor",
	"correlationId",
	"priority",
	"payload",
	"deduplicationKey",
	"traceId",
];

/**
 * Build a validated SPEC §4 event envelope.
 *
 * Fills id/timestamp/traceId/correlationId when not supplied. Throws on
 * unknown type, missing source/resource/actor/payload, unknown
 * priority, or a payload over 16KB (unbounded payloads would let a
 * single producer bloat the durable log).
 *
 * deduplicationKey defaults to `${type}:${source}:${id}` — unique per
 * event unless the producer passes an explicit work-unit key (e.g. a
 * cron time bucket) to make retries idempotent.
 *
 * @param {object} input
 * @returns {object} the 11-field SPEC §4 envelope
 */
export function buildEvent(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("buildEvent: input object required");
	}

	const { type, source, resource, actor, payload } = input;

	if (typeof type !== "string" || !OPS_EVENT_TYPES.includes(type)) {
		throw new Error(`buildEvent: unknown event type: ${String(type)}`);
	}

	for (const field of ["source", "resource", "actor"]) {
		const value = input[field];
		if (typeof value !== "string" || !value.trim()) {
			throw new Error(`buildEvent: ${field} is required`);
		}
	}

	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error("buildEvent: payload object is required");
	}

	let serialized;
	try {
		serialized = JSON.stringify(payload);
	} catch (err) {
		throw new Error(`buildEvent: payload is not serializable: ${err.message}`);
	}
	if (serialized.length > MAX_PAYLOAD_BYTES) {
		throw new Error(
			`buildEvent: payload exceeds ${MAX_PAYLOAD_BYTES} bytes (got ${serialized.length})`,
		);
	}

	const priority = input.priority ?? "normal";
	if (!OPS_EVENT_PRIORITIES.includes(priority)) {
		throw new Error(`buildEvent: unknown priority: ${String(priority)}`);
	}

	const id =
		typeof input.id === "string" && input.id.trim() ? input.id : crypto.randomUUID();
	const timestamp = input.timestamp ?? new Date().toISOString();

	return {
		id,
		type,
		timestamp,
		source,
		resource,
		actor,
		correlationId:
			typeof input.correlationId === "string" && input.correlationId
				? input.correlationId
				: id,
		priority,
		payload,
		deduplicationKey:
			typeof input.deduplicationKey === "string" && input.deduplicationKey
				? input.deduplicationKey
				: `${type}:${source}:${id}`,
		traceId:
			typeof input.traceId === "string" && input.traceId
				? input.traceId
				: crypto.randomUUID(),
	};
}

async function readLog() {
	const { data, error } = await supabase
		.from("settings")
		.select("value")
		.eq("key", SETTINGS_KEY)
		.maybeSingle();
	if (error) {
		throw new Error(`ops_event_log read failed: ${error.message ?? String(error)}`);
	}
	const events = Array.isArray(data?.value?.events) ? data.value.events : [];
	return { rowExists: Boolean(data), events };
}

/**
 * Append a validated event to the durable log.
 *
 * @param {object} event — envelope from buildEvent
 * @returns {Promise<{stored: boolean, reason?: string, event: object, count?: number}>}
 *   stored:false + reason:"duplicate" when deduplicationKey already exists
 * @throws on envelope validation failure or write error (never silent)
 */
export async function appendEvent(event) {
	if (!event || typeof event !== "object" || Array.isArray(event)) {
		throw new Error("appendEvent: event object required");
	}
	for (const field of ENVELOPE_FIELDS) {
		if (event[field] === undefined || event[field] === null || event[field] === "") {
			throw new Error(`appendEvent: missing envelope field: ${field}`);
		}
	}
	if (!OPS_EVENT_TYPES.includes(event.type)) {
		throw new Error(`appendEvent: unknown event type: ${String(event.type)}`);
	}

	const { rowExists, events } = await readLog();

	const existing = events.find(
		(e) => e && e.deduplicationKey === event.deduplicationKey,
	);
	if (existing) {
		return { stored: false, reason: "duplicate", event: existing };
	}

	// Build a NEW array instead of mutating readLog's result: if the write
	// then fails and throws, the already-stored log must stay untouched
	// (failure never leaves a half-written event visible to readers).
	const nextEvents = [...events, event];
	const trimmed =
		nextEvents.length > MAX_EVENTS
			? nextEvents.slice(nextEvents.length - MAX_EVENTS)
			: nextEvents;
	const value = {
		events: trimmed,
		updated_at: new Date().toISOString(),
	};

	const result = rowExists
		? await supabase.from("settings").update({ value }).eq("key", SETTINGS_KEY)
		: await supabase.from("settings").insert({ key: SETTINGS_KEY, value });
	if (result?.error) {
		throw new Error(
			`ops_event_log write failed: ${result.error.message ?? String(result.error)}`,
		);
	}

	return { stored: true, event, count: trimmed.length };
}

/**
 * Independent read-back of the durable log (SPEC §4 evidence path).
 *
 * @param {object} [filters]
 * @param {string} [filters.type]  exact event type
 * @param {string} [filters.since] ISO timestamp — keep events at/after it
 * @param {number} [filters.limit] keep only the most recent N
 * @returns {Promise<object[]>} matching envelopes, chronological order
 */
export async function listEvents({ type, since, limit } = {}) {
	const { events } = await readLog();

	let result = events;
	if (typeof type === "string" && type) {
		result = result.filter((e) => e && e.type === type);
	}
	if (typeof since === "string" && since) {
		result = result.filter((e) => e && typeof e.timestamp === "string" && e.timestamp >= since);
	}
	const lim = Number(limit);
	if (Number.isFinite(lim)) {
		if (lim <= 0) return [];
		if (result.length > lim) result = result.slice(result.length - lim);
	}
	return result;
}
