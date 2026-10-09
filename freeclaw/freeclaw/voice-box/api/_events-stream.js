// Live inbox wake-ups — GET /api/events?user_id=anon_x (SSE, text/event-stream).
//
// The browser EventSource API cannot set request headers, so unlike every
// other authed route this one takes the claimed id from the QUERY string.
// Security property is UNCHANGED: the query value is only the CLAIM —
// proof of possession is still the vb_session HttpOnly cookie, verified by
// verifyCallerIdentity() BEFORE any stream headers are sent. A wrong or
// missing cookie gets a plain JSON denial (never a stream).
//
// The stream is a WAKE-UP, not a data carrier: when anything the
// notification engine diffs changes (my posts, my chat thread, my server
// notification feed), the server emits `update` and the client runs its
// normal check() diff. False positives only cost one diff run — they can
// never fabricate a notification, because check() diffs against the local
// snapshot exactly as the 120s fallback loop does.
//
// Delivery mechanism: one Supabase Realtime channel on the shared
// service-role client, with three postgres_changes bindings filtered to
// this user's rows only (service role bypasses RLS; the filters are what
// keep user A from waking user B). Poll endings stay on the 120s loop:
// votes land in poll_votes (a different table) and polls-row updates are
// too broad to filter per-voter — waking every connected client on every
// vote would be a thundering herd for zero benefit.
//
// Serverless reality: Vercel kills an idle function at ~60s, so the server
// holds the stream at most HOLD_MS, then closes it; EventSource
// auto-reconnects. Heartbeats keep NAT/proxies from closing it early.
// If the realtime subscription never confirms, the stream closes early
// instead of faking liveness — the client reconnects and the 120s loop
// covers the gap.
import { cors, verifyCallerIdentity } from "./_auth.js";
import supabase from "./_db-client.js";
import { createSSEWriter, startHeartbeat } from "./_streaming.js";

// Under Vercel's ~60s function kill. Closes itself; client reconnects.
export const HOLD_MS = 45_000;
// Heartbeat faster than most proxy idle timeouts (30-60s).
export const HEARTBEAT_MS = 15_000;
// Reconnect hint: terminal failures must not spin a hot reconnect loop.
export const RETRY_MS = 15_000;
// Coalesce a burst of db events into one wake-up write.
export const COALESCE_MS = 1_000;
// Give up faking liveness if the channel never confirms.
export const SUBSCRIBE_TIMEOUT_MS = 8_000;

// Same shape rule as _notifications.js: anon_ prefix + lowercase
// alphanumeric, 5..40 chars. Rejects settings-key suffix injection.
function validAnonId(id) {
	return (
		typeof id === "string" &&
		id.length >= 5 &&
		id.length <= 40 &&
		/^anon_[a-z0-9]+$/.test(id)
	);
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET")
		return res.status(405).json({ error: "Method not allowed" });

	const userId = String(req.query?.user_id || "")
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
		.trim()
		.toLowerCase()
		.slice(0, 40);
	if (!validAnonId(userId))
		return res.status(400).json({ error: "Invalid user_id" });

	// EventSource cannot send x-anon-id. The query value takes its place as
	// the CLAIMED id; verifyCallerIdentity still demands the session cookie
	// as PROOF before anything streams.
	req.headers = req.headers || {};
	req.headers["x-anon-id"] = userId;
	const caller = await verifyCallerIdentity(req, res, userId);
	if (!caller.ok)
		return res
			.status(caller.status || 403)
			.json({ error: caller.error, code: caller.code });

	// Auth passed (this may have set/refreshed the session cookie above).
	// From here on failures are SSE `error` events, never JSON — headers
	// are about to become a stream.
	const writer = createSSEWriter(res, req);
	// createSSEWriter's origin allowlist does not know the native shells
	// (file:// null origin, Capacitor schemes); cors() does — re-apply so
	// the EXE/APK stream passes the browser check like fetch() does.
	cors(res, req);
	try {
		res.write(`retry: ${RETRY_MS}\n\n`);
	} catch {
		/* client already gone */
	}
	writer.write("hello", { t: Date.now(), hold_ms: HOLD_MS });
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
		// Release the function: every exit path (client disconnect, hold
		// expiry, realtime failure) must settle the awaited promise or the
		// invocation hangs until the platform kills it.
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

	// The function must stay alive while the stream is open: resolve only
	// when the stream ends (client disconnect, hold expiry, or failure).
	const done = new Promise((resolve) => {
		resolveDone = resolve;
		const finish = () => {
			cleanup();
		};
		try {
			req.on("close", finish);
		} catch {
			/* non-standard req shim without .on — hold timer still ends us */
		}
		holdTimer = setTimeout(() => {
			writer.close(); // emits `done`; EventSource reconnects on its own
			finish();
		}, HOLD_MS);
	});

	try {
		channel = supabase.channel(`events:${userId}:${Date.now().toString(36)}`);
		channel.on(
			"postgres_changes",
			{
				event: "*",
				schema: "public",
				table: "posts",
				filter: `author_id=eq.${userId}`,
			},
			() => wake("post"),
		);
		channel.on(
			"postgres_changes",
			{
				event: "*",
				schema: "public",
				table: "chat_messages",
				filter: `thread_id=eq.${userId}`,
			},
			() => wake("chat"),
		);
		channel.on(
			"postgres_changes",
			{
				event: "*",
				schema: "public",
				table: "settings",
				filter: `key=eq.notifications:${userId}`,
			},
			() => wake("notif"),
		);
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
				// Never fake liveness: close so the client reconnects instead
				// of sitting on a dead stream believing it is live.
				writer.error("realtime unavailable — reconnecting", "RT_DOWN");
				cleanup();
			}
		});
		subscribeTimer = setTimeout(() => {
			// Subscription never confirmed: same as an error, close early.
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
