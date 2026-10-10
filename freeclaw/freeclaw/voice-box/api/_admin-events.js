// Admin live wake-ups — /api/admin-events (SSE, text/event-stream).
//
// POST → issue a short-lived stream ticket (x-admin-token required).
// GET ?ticket= → open the stream.
//
// EventSource cannot send the x-admin-token header, so the browser gets
// a bearer ticket over the normal authed fetch path and presents it in
// the query string. Containment, all deliberate:
//   * tickets live 5 minutes, are bound to the issuing admin session,
//     and die with it (logout/expiry kills every stream on next
//     connect; an in-flight stream is NOT reaped mid-hold — 45s max);
//   * the ticket hash (never the ticket) is stored server-side;
//   * issuance is throttled per admin token (ticket farming);
//   * failures are uniform 403s — no oracle distinguishing bad ticket,
//     stale ticket, or dead admin session.
//
// The stream is a WAKE-UP, not a data carrier: any change on the admin
// workload tables emits `update` with kinds, and the console pages raise
// their "updates available" pill (same UX as their realtime signal).
// Subscribed tables are limited to members of the shared
// supabase_realtime publication — agent_tasks / agent_executions /
// settings are NOT published, so bindings there could never fire (the
// same lesson as the user stream's settings leg). Service role reads
// them all; per-row filtering is unnecessary (admins see everything).
import { createHash, randomBytes } from "node:crypto";
import { cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { createSSEWriter, startHeartbeat } from "./_streaming.js";

export const HOLD_MS = 45_000;
export const HEARTBEAT_MS = 15_000;
export const RETRY_MS = 15_000;
export const COALESCE_MS = 1_000;
export const SUBSCRIBE_TIMEOUT_MS = 8_000;
// Ticket lifetime: comfortably covers a 45s hold + reconnect skew,
// short enough that a leaked URL dies on its own.
export const TICKET_TTL_MS = 5 * 60 * 1000;
// Ticket farming throttle: issues per admin token per minute.
export const TICKET_ISSUE_LIMIT = 10;
const TICKET_ISSUE_WINDOW_MS = 60_000;

// Published tables the admin workload actually changes. Anything else
// (agent_tasks, agent_executions, settings) is not in the shared
// publication — subscribing would be a dead channel that reads as
// "realtime is broken".
const BINDINGS = [
	{ table: "reports", kind: "report" },
	{ table: "comments", kind: "comment" },
	{ table: "polls", kind: "poll" },
	{ table: "poll_votes", kind: "vote" },
	{ table: "posts", kind: "post" },
	{ table: "chat_messages", kind: "chat" },
	{ table: "chat_threads", kind: "thread" },
];

function sha256Hex(value) {
	return createHash("sha256").update(String(value)).digest("hex");
}

function ticketKey(ticketHash) {
	return `adminticket:${ticketHash}`;
}

const issueHits = new Map();
function issueThrottled(adminHash) {
	const now = Date.now();
	const entry = issueHits.get(adminHash);
	if (!entry || now - entry.start > TICKET_ISSUE_WINDOW_MS) {
		issueHits.set(adminHash, { start: now, count: 1 });
		return false;
	}
	entry.count += 1;
	return entry.count > TICKET_ISSUE_LIMIT;
}

async function loadAdminSessions() {
	const { data, error } = await supabase
		.from("settings")
		.select("value")
		.eq("key", "admin_sessions")
		.maybeSingle();
	if (error) throw new Error(error.message || "admin session lookup failed");
	return data?.value?.tokens || [];
}

/** The ticket is valid only while the admin session that minted it lives. */
async function ticketAdminOk(row) {
	if (!row || typeof row !== "object") return false;
	if (!row.created_at || Date.now() - Date.parse(row.created_at) > TICKET_TTL_MS)
		return false;
	if (!row.admin_th) return false;
	let tokens = [];
	try {
		tokens = await loadAdminSessions();
	} catch {
		return false;
	}
	const now = Date.now();
	return tokens.some(
		(s) => s && sha256Hex(s.t) === row.admin_th && s.exp > now,
	);
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	// ── Ticket issuance (normal authed fetch, NOT EventSource) ──
	if (req.method === "POST") {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });
		const presented = String(req.headers?.["x-admin-token"] || "");
		if (!presented)
			return res.status(403).json({ error: "Admin only" });
		if (issueThrottled(sha256Hex(presented))) {
			res.setHeader("Retry-After", "60");
			return res
				.status(429)
				.json({ error: "Too many ticket requests — retry shortly." });
		}
		const ticket = randomBytes(32).toString("hex");
		try {
			const { error } = await supabase.from("settings").upsert(
				{
					key: ticketKey(sha256Hex(ticket)),
					value: {
						admin_th: sha256Hex(presented),
						created_at: new Date().toISOString(),
					},
				},
				{ onConflict: "key" },
			);
			if (error) throw new Error(error.message || "ticket store failed");
		} catch (err) {
			console.error("[admin-events] ticket issue failed:", err?.message || err);
			return res.status(503).json({ error: "Ticket service unavailable" });
		}
		return res
			.status(200)
			.json({ ticket, expires_in: Math.floor(TICKET_TTL_MS / 1000) });
	}

	if (req.method !== "GET")
		return res.status(405).json({ error: "Method not allowed" });

	// ── Stream open (EventSource: ticket in query, no headers possible) ──
	const ticket = String(req.query?.ticket || "").trim();
	if (!/^[0-9a-f]{64}$/i.test(ticket))
		return res.status(403).json({ error: "Admin only" });
	let row = null;
	try {
		const { data, error } = await supabase
			.from("settings")
			.select("value")
			.eq("key", ticketKey(sha256Hex(ticket.toLowerCase())))
			.maybeSingle();
		if (!error) row = data?.value || null;
	} catch {
		row = null;
	}
	if (!(await ticketAdminOk(row)))
		return res.status(403).json({ error: "Admin only" });

	// Auth passed. From here on failures are SSE `error` events, never JSON.
	const writer = createSSEWriter(res, req);
	cors(res, req);
	try {
		res.write(`retry: ${RETRY_MS}\n\n`);
	} catch {
		/* client already gone */
	}
	writer.write("hello", { t: Date.now(), hold_ms: HOLD_MS, scope: "admin" });
	const stopHeartbeat = startHeartbeat(res, HEARTBEAT_MS);

	let settled = false;
	let channel = null;
	let holdTimer = null;
	let subscribeTimer = null;
	let coalesceTimer = null;
	let resolveDone = () => {};
	const pendingKinds = new Set();

	function cleanup() {
		if (settled) return;
		settled = true;
		if (holdTimer) clearTimeout(holdTimer);
		if (subscribeTimer) clearTimeout(subscribeTimer);
		if (coalesceTimer) clearTimeout(coalesceTimer);
		stopHeartbeat();
		if (channel) {
			try {
				supabase.removeChannel(channel);
			} catch {
				/* already torn down */
			}
			channel = null;
		}
		try {
			res.end();
		} catch {
			/* socket already closed */
		}
		resolveDone();
	}

	function flushKinds() {
		coalesceTimer = null;
		if (settled || pendingKinds.size === 0) return;
		writer.write("update", {
			kinds: [...pendingKinds].sort(),
			at: new Date().toISOString(),
		});
		pendingKinds.clear();
	}

	function wake(kind) {
		if (settled) return;
		pendingKinds.add(kind);
		if (!coalesceTimer) coalesceTimer = setTimeout(flushKinds, COALESCE_MS);
	}

	const done = new Promise((resolve) => {
		resolveDone = resolve;
		const finish = () => {
			cleanup();
		};
		try {
			req.on("close", finish);
		} catch {
			/* non-standard req shim — hold timer still ends us */
		}
		holdTimer = setTimeout(() => {
			writer.close();
			finish();
		}, HOLD_MS);
	});

	try {
		channel = supabase.channel(`admin-events:${Date.now().toString(36)}`);
		for (const { table, kind } of BINDINGS) {
			channel.on(
				"postgres_changes",
				{ event: "*", schema: "public", table },
				() => wake(kind),
			);
		}
		channel.subscribe((status) => {
			if (settled) return;
			if (status === "SUBSCRIBED") {
				if (subscribeTimer) clearTimeout(subscribeTimer);
				subscribeTimer = null;
				return;
			}
			if (
				status === "CHANNEL_ERROR" ||
				status === "TIMED_OUT" ||
				status === "CLOSED"
			) {
				writer.error("realtime unavailable — reconnecting", "RT_DOWN");
				cleanup();
			}
		});
		subscribeTimer = setTimeout(() => {
			if (!settled) {
				writer.error("realtime unavailable — reconnecting", "RT_DOWN");
				cleanup();
			}
		}, SUBSCRIBE_TIMEOUT_MS);
	} catch (err) {
		writer.error("stream setup failed", "STREAM_SETUP");
		cleanup();
	}

	await done;
}
