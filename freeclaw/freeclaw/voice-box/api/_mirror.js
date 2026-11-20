// ─── Supabase → Firebase standby mirror ─────────────────────────────
// Supabase stays the PRIMARY. Every important write that Supabase commits is
// also written to Firebase (project `voicelflow`) so a standby copy exists
// BEFORE anything breaks — not copied during an outage, when the data is
// already unreachable.
//
// HOW IT PLUGS IN
// `_db-client.js` already routes every Supabase call through one custom
// fetch. This module inspects that same point: if the request is a write to
// a mirrored table and the response was successful, the committed rows are
// mirrored. One choke point means a new endpoint cannot forget to mirror, and
// there is no second transcription of "what counts as a write".
//
// WHAT IT GUARANTEES, HONESTLY
//   • A mirror failure NEVER fails the user's primary write. The write is
//     already committed in Supabase; turning that into an error would corrupt
//     the product to protect a copy.
//   • A mirror is only counted as delivered when the transport says so. When
//     Firebase credentials are absent the event is recorded as PENDING with
//     reason `not_configured` — never as success. `mirrorStats()` reports the
//     difference, which is what the reliability dashboard reads.
//   • Delivery is at-least-once with a stable idempotency key per (table, op,
//     row id, payload hash), so a retry of the same content is skipped rather
//     than duplicating a document.
//
// WHAT IT DOES NOT DO (no pretending): it does not replicate Storage objects,
// does not copy auth users/password hashes, and does not fail traffic over.
// Those need decisions and credentials that are not in this process — see
// FIREBASE_STANDBY.md.
import { createHash, randomUUID, sign } from "node:crypto";

// Tables whose rows are user-visible application data. Ordered from the
// hot/central ones outwards; `settings` is included because a standby that
// loses moderation config would answer differently from the primary.
const DEFAULT_MIRRORED = [
	"posts",
	"comments",
	"reactions",
	"polls",
	"poll_votes",
	"reports",
	"notifications",
	"users_meta",
	"settings",
	"audit_logs",
	"activity_logs",
];

export function mirroredTables() {
	const raw = String(process.env.MIRROR_TABLES || "").trim();
	if (!raw) return new Set(DEFAULT_MIRRORED);
	return new Set(
		raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
}

export function isMirroredTable(table) {
	return Boolean(table) && mirroredTables().has(String(table));
}

// ── statistics (read by /api/backend-status and the admin dashboard) ──
const stats = {
	attempted: 0,
	delivered: 0,
	failed: 0,
	skipped: 0,
	pending: 0,
	// Reads actually served by the standby while the primary was failing.
	// Non-zero proves a failover happened; zero during an outage means the
	// standby could not answer and the caller correctly saw the real error.
	standbyReads: 0,
	lastError: null,
	lastDeliveredAt: 0,
	lastFailureAt: 0,
};

export function mirrorStats() {
	return {
		...stats,
		transport: transportKind(),
		configured: transportKind() !== "none",
		tables: [...mirroredTables()],
	};
}

export function __resetMirrorForTests() {
	stats.attempted = 0;
	stats.delivered = 0;
	stats.failed = 0;
	stats.skipped = 0;
	stats.pending = 0;
	stats.standbyReads = 0;
	stats.lastError = null;
	stats.lastDeliveredAt = 0;
	stats.lastFailureAt = 0;
	seen.clear();
	pendingQueue.length = 0;
	tokenCache.token = null;
	tokenCache.expiresAt = 0;
}

// ── idempotency ─────────────────────────────────────────────────────
// Bounded: a warm instance serving 10k writes must not grow a Map forever.
const seen = new Map();
const SEEN_MAX = 5000;

function rememberSeen(key) {
	if (seen.has(key)) return false;
	seen.set(key, Date.now());
	if (seen.size > SEEN_MAX) {
		const oldest = seen.keys().next();
		if (!oldest.done) seen.delete(oldest.value);
	}
	return true;
}

function payloadHash(payload) {
	return createHash("sha256")
		.update(JSON.stringify(payload ?? {}))
		.digest("hex")
		.slice(0, 16);
}

/**
 * Canonical mirror event. `entity_id` and `tenant_id` are what make the
 * standby copy usable: a post without its author/school cannot be served or
 * authorised during failover.
 */
export function buildEvent({ table, op, row, now = Date.now() }) {
	const r = row && typeof row === "object" ? row : {};
	const entityId = String(r.id ?? r.post_id ?? r.comment_id ?? "");
	const tenant =
		r.school_id ?? r.schoolId ?? r.tenant_id ?? r.school ?? r.org_id ?? null;
	const version =
		Number(r.updated_at ? Date.parse(r.updated_at) : 0) || Number(r.version ?? 0) || 0;
	const hash = payloadHash(r);
	return {
		event_id: randomUUID(),
		entity: String(table),
		entity_id: entityId || `hash:${hash}`,
		operation: op,
		schema_version: 1,
		entity_version: version,
		tenant_id: tenant === null || tenant === undefined ? null : String(tenant),
		created_at: new Date(now).toISOString(),
		source_backend: "supabase",
		idempotency_key: `${table}:${op}:${entityId || hash}:${hash}`,
		payload: r,
	};
}

// ── transport: Firebase / Firestore REST ────────────────────────────
const tokenCache = { token: null, expiresAt: 0 };

export function transportKind() {
	if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return "service-account";
	if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
		return "service-account";
	if (process.env.FIREBASE_ID_TOKEN) return "id-token";
	return "none";
}

function serviceAccount() {
	const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed?.client_email && parsed?.private_key) return parsed;
		} catch {
			/* fall through to the split env form */
		}
	}
	const email = process.env.FIREBASE_CLIENT_EMAIL;
	const key = process.env.FIREBASE_PRIVATE_KEY;
	if (email && key) {
		return {
			client_email: email,
			private_key: key.includes("\\n") ? key.replace(/\\n/g, "\n") : key,
			project_id: process.env.FIREBASE_PROJECT_ID || "voicelflow",
		};
	}
	return null;
}

function b64url(input) {
	return Buffer.from(input)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * OAuth2 JWT-bearer flow for a service account. This is what the Firebase
 * Admin SDK does internally; doing it here keeps the serverless bundle small
 * and avoids shipping an assumption that admin credentials are absent.
 */
async function accessToken(now = Date.now()) {
	if (tokenCache.token && tokenCache.expiresAt > now + 30_000) {
		return tokenCache.token;
	}
	const sa = serviceAccount();
	if (!sa) return null;
	const iat = Math.floor(now / 1000);
	const claims = {
		iss: sa.client_email,
		scope: "https://www.googleapis.com/auth/datastore",
		aud: "https://oauth2.googleapis.com/token",
		iat,
		exp: iat + 3600,
	};
	const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
		JSON.stringify(claims),
	)}`;
	const signature = sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key);
	const assertion = `${unsigned}.${signature.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(
			assertion,
		)}`,
	});
	if (!res.ok) {
		throw new Error(`firebase_token_http_${res.status}`);
	}
	const json = await res.json();
	tokenCache.token = json.access_token;
	tokenCache.expiresAt = now + (Number(json.expires_in) || 3600) * 1000;
	return tokenCache.token;
}

/** True when a standby credential exists. One predicate, used everywhere. */
export function standbyConfigured() {
	return transportKind() !== "none";
}

/** Firestore project for the standby. Shared by mirror, reads and outbox. */
export function standbyProject() {
	return serviceAccount()?.project_id || process.env.FIREBASE_PROJECT_ID || "voicelflow";
}

/**
 * Auth headers for a Firestore REST call.
 *
 * Resolved in one place so the write mirror, the read switch and the replay
 * outbox cannot disagree about which credential is in play — or, worse, one of
 * them silently falling back to an unauthenticated call.
 */
export async function standbyAuthHeaders() {
	const headers = { "Content-Type": "application/json" };
	const auth =
		transportKind() === "service-account"
			? await accessToken()
			: process.env.FIREBASE_ID_TOKEN || null;
	if (auth) headers.Authorization = `Bearer ${auth}`;
	else headers["X-Goog-Api-Key"] = String(process.env.FIREBASE_API_KEY || "");
	return headers;
}

/**
 * Firestore REST base URL.
 *
 * Overridable so the mirror, the read switch and the outbox can all be pointed
 * at an emulator or a test double and proven end-to-end without production
 * credentials. One getter, so the three paths can never disagree about which
 * endpoint they are talking to.
 */
export function firestoreBase() {
	return String(process.env.FIREBASE_FIRESTORE_BASE_URL || "https://firestore.googleapis.com")
		.replace(/\/+$/, "");
}

/** Encode one JS value into the Firestore REST typed-value shape. */
export function toFirestoreValue(value) {
	if (value === null || value === undefined) return { nullValue: null };
	if (typeof value === "string") return { stringValue: value };
	if (typeof value === "boolean") return { booleanValue: value };
	if (typeof value === "number") {
		return Number.isInteger(value)
			? { integerValue: String(value) }
			: { doubleValue: value };
	}
	if (Array.isArray(value)) {
		return { arrayValue: { values: value.map(toFirestoreValue) } };
	}
	if (typeof value === "object") {
		return { mapValue: { fields: toFields(value) } };
	}
	return { stringValue: String(value) };
}

export function toFields(row) {
	const fields = {};
	for (const [k, v] of Object.entries(row || {})) {
		fields[k] = toFirestoreValue(v);
	}
	return fields;
}

function docId(event) {
	// Deterministic per entity so a later update overwrites the same document
	// instead of appending a second copy of the same row.
	const safe = String(event.entity_id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
	return safe || `h_${payloadHash(event.payload)}`;
}

/**
 * Write one event to Firestore. Returns { ok, reason } and never throws —
 * callers are on the user's request path and must not fail because a copy
 * could not be made.
 */
export async function deliver(event, fetchImpl = globalThis.fetch) {
	const kind = transportKind();
	if (kind === "none") return { ok: false, reason: "not_configured" };
	const project = standbyProject();
	const collection = event.entity;
	const url = `${firestoreBase()}/v1/projects/${project}/databases/(default)/documents/${collection}/${docId(
		event,
	)}`;
	const body = {
		fields: toFields({
			...event.payload,
			__mirror: {
				event_id: event.event_id,
				entity: event.entity,
				entity_id: event.entity_id,
				operation: event.operation,
				tenant_id: event.tenant_id,
				source_backend: event.source_backend,
				entity_version: event.entity_version,
				synced_at: new Date().toISOString(),
			},
		}),
	};
	try {
		const headers = await standbyAuthHeaders();
		const res = await fetchImpl(url, {
			method: "PATCH",
			headers,
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			return { ok: false, reason: `http_${res.status}`, detail: text.slice(0, 300) };
		}
		return { ok: true };
	} catch (e) {
		return { ok: false, reason: "transport_error", detail: String(e?.message || e) };
	}
}

// Bounded retry queue. Not a substitute for the Supabase-side outbox: it only
// survives as long as the instance, which is why the stats expose `pending`.
const pendingQueue = [];
const PENDING_MAX = 200;

/**
 * Mirror one committed primary write. Fire-and-forget by contract: the
 * promise always resolves, so `await` on it can never fail a request.
 */
export async function mirrorWrite({ table, op, rows, now = Date.now() }) {
	if (!isMirroredTable(table)) return { ok: false, reason: "not_mirrored" };
	const list = Array.isArray(rows) ? rows : [rows];
	let delivered = 0;
	let skipped = 0;
	const failures = [];
	for (const row of list) {
		if (!row || typeof row !== "object") continue;
		const event = buildEvent({ table, op, row, now });
		if (!rememberSeen(event.idempotency_key)) {
			skipped += 1;
			continue;
		}
		stats.attempted += 1;
		const result = await deliver(event);
		if (result.ok) {
			delivered += 1;
			stats.delivered += 1;
			stats.lastDeliveredAt = now;
		} else {
			failures.push(result.reason);
			stats.failed += 1;
			stats.lastError = result.reason;
			stats.lastFailureAt = now;
			if (pendingQueue.length < PENDING_MAX) {
				pendingQueue.push({ event, attempts: 1, lastAttemptAt: now });
				stats.pending = pendingQueue.length;
			}
		}
	}
	stats.skipped += skipped;
	return {
		ok: failures.length === 0,
		delivered,
		skipped,
		failures,
	};
}

/**
 * Retry queued events (called from scheduled maintenance, never from a user
 * request). Gives up after 5 attempts so one poisoned row cannot spin forever.
 */
export async function flushMirrorQueue({ max = 25, now = Date.now() } = {}) {
	const retry = [];
	let sent = 0;
	let dropped = 0;
	while (pendingQueue.length && retry.length < max) {
		const item = pendingQueue.shift();
		if (!item) break;
		if (item.attempts >= 5) {
			dropped += 1;
			continue;
		}
		const result = await deliver(item.event);
		if (result.ok) {
			sent += 1;
			stats.delivered += 1;
			stats.pending = pendingQueue.length + retry.length;
		} else {
			item.attempts += 1;
			item.lastAttemptAt = now;
			item.lastError = result.reason;
			retry.push(item);
		}
	}
	pendingQueue.push(...retry);
	stats.pending = pendingQueue.length;
	return { sent, retried: retry.length, dropped, pending: pendingQueue.length };
}

/** Table name out of a PostgREST URL: /rest/v1/posts?select=... → posts */
export function tableFromUrl(url) {
	try {
		const path = new URL(String(url)).pathname;
		const m = path.match(/\/rest\/v1\/([A-Za-z0-9_]+)/);
		return m ? m[1] : null;
	} catch {
		return null;
	}
}

export function opFromMethod(method) {
	switch (String(method || "").toUpperCase()) {
		case "POST":
			return "insert";
		case "PATCH":
			return "update";
		case "PUT":
			return "upsert";
		case "DELETE":
			return "delete";
		default:
			return null;
	}
}

/**
 * Observe a completed Supabase request and mirror it when it was a successful
 * write to a mirrored table.
 *
 * Called from `_db-client.js`'s custom fetch. Reads the request body (the
 * exact committed payload) and, when PostgREST returned a representation, the
 * response body instead — that copy carries database defaults (ids,
 * timestamps) the request did not contain.
 */
export function observePrimaryWrite(url, options, res) {
	try {
		if (!res || !res.ok) return;
		const method = String(options?.method || "GET").toUpperCase();
		const op = opFromMethod(method);
		if (!op) return;
		const table = tableFromUrl(url);
		if (!table || !isMirroredTable(table)) return;
		const bodyText = typeof options?.body === "string" ? options.body : null;
		if (!bodyText) return;
		let payload;
		try {
			payload = JSON.parse(bodyText);
		} catch {
			return;
		}
		if (!payload) return;
		// Prefer the server's representation when present: it includes ids and
		// defaults. Never block the caller on it — the write already returned.
		const finish = (rows) => {
			void mirrorWrite({ table, op, rows }).catch(() => {});
		};
		let sent = false;
		if (typeof res.clone === "function") {
			res.clone()
				.text()
				.then((text) => {
					let rows = null;
					if (text) {
						try {
							const parsed = JSON.parse(text);
							if (Array.isArray(parsed) && parsed.length) rows = parsed;
						} catch {
							/* representation was not JSON — fall back to the request rows */
						}
					}
					if (!sent) {
						sent = true;
						finish(rows || payload);
					}
				})
				.catch(() => {
					if (!sent) {
						sent = true;
						finish(payload);
					}
				});
		}
		if (!sent && typeof res.clone !== "function") finish(payload);
	} catch {
		/* mirroring must never affect the request it observes */
	}
}

// ── standby reads ───────────────────────────────────────────────────
// The other half of "there is a copy". Without this, a Supabase outage leaves
// a perfectly good standby that nothing ever reads from, and the user sees an
// error while their data sits one network hop away.
//
// Deliberate limits: only EQUAL filters are translated, because a half-correct
// query returning the WRONG rows is worse than an honest error. Callers that
// need `gt`/`in`/full-text during an outage get the real failure instead of a
// silently different result set.

function fromFirestoreValue(value) {
	if (!value || typeof value !== "object") return null;
	if ("nullValue" in value) return null;
	if ("stringValue" in value) return value.stringValue;
	if ("booleanValue" in value) return value.booleanValue;
	if ("integerValue" in value) return Number(value.integerValue);
	if ("doubleValue" in value) return Number(value.doubleValue);
	if ("timestampValue" in value) return value.timestampValue;
	if ("arrayValue" in value) return (value.arrayValue?.values || []).map(fromFirestoreValue);
	if ("mapValue" in value) return fromFields(value.mapValue?.fields || {});
	return null;
}

/** Inverse of toFields, for rows read back from the standby. */
export function fromFields(fields) {
	const out = {};
	for (const [key, value] of Object.entries(fields || {})) {
		out[key] = fromFirestoreValue(value);
	}
	return out;
}

/**
 * Read rows from the standby copy.
 *
 * Returns `{ ok: true, rows }` or `{ ok: false, reason }`. It never throws and
 * never returns rows it did not receive, so a caller cannot mistake an
 * unconfigured standby for an empty result set.
 */
export async function readStandby(
	table,
	{ filters = [], limit = null, orderBy = null } = {},
	fetchImpl = globalThis.fetch,
) {
	if (!table) return { ok: false, reason: "no_table" };
	if (transportKind() === "none") return { ok: false, reason: "not_configured" };
	const project = standbyProject();
	const url = `${firestoreBase()}/v1/projects/${project}/databases/(default)/documents:runQuery`;
	const structuredQuery = { from: [{ collectionId: String(table) }] };
	if (filters.length) {
		structuredQuery.where = {
			compositeFilter: {
				op: "AND",
				filters: filters.map((f) => ({
					fieldFilter: {
						field: { fieldPath: String(f.field) },
						op: "EQUAL",
						value: toFirestoreValue(f.value),
					},
				})),
			},
		};
	}
	if (orderBy?.field) {
		structuredQuery.orderBy = [
			{
				field: { fieldPath: String(orderBy.field) },
				direction: orderBy.direction === "DESCENDING" ? "DESCENDING" : "ASCENDING",
			},
		];
	}
	if (limit) structuredQuery.limit = Math.min(Math.max(Number(limit) || 0, 1), 500);

	try {
		const headers = await standbyAuthHeaders();
		const res = await fetchImpl(url, {
			method: "POST",
			headers,
			body: JSON.stringify({ structuredQuery }),
		});
		if (!res.ok) return { ok: false, reason: `http_${res.status}` };
		const json = await res.json();
		const rows = (Array.isArray(json) ? json : [])
			.filter((entry) => entry?.document?.fields)
			.map((entry) => {
				const row = fromFields(entry.document.fields);
				// Bookkeeping added on write is not part of the user's row.
				delete row.__mirror;
				return row;
			});
		stats.standbyReads += 1;
		return { ok: true, rows };
	} catch (err) {
		return { ok: false, reason: "transport_error", detail: String(err?.message || err) };
	}
}
