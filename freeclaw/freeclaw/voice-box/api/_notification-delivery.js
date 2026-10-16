// Notification delivery ledger + verified retry.
//
// WHY THIS EXISTS
// The only notification "delivery" surface this product actually has is the
// in-app store: a `settings` row keyed `notifications:<anonId>` (the same row
// _notifications.js reads and _auth.notifyUser writes). There is no push/email/
// SMS provider, so this module deliberately does NOT invent one. What it adds is
// the piece that was missing: when `notifyUser()` fails BOTH of its immediate
// write attempts, the delivery was silently lost. Now it is recorded in a
// bounded dead-letter ledger and retried later.
//
// A retry only counts as DELIVERED once it has been INDEPENDENTLY verified: the
// notification id is read back out of the user's store. A retry whose write
// reports success but whose read-back does not contain the id is classified as
// failed, never as delivered. Attempts are capped (MAX_DELIVERY_ATTEMPTS) so a
// genuinely undeliverable notification becomes a dead letter for a human instead
// of an infinite retry loop.
//
// TRIGGER  → notifyUser exhausts its retries and calls recordPendingDelivery().
// ACTION   → retryPendingDeliveries() re-runs the real read+append write.
// VERIFY   → read-back of `notifications:<anonId>` confirms the returned id.
// EVIDENCE → returned report + one `activity_logs` row per delivered/dead item.
// DISABLE  → without recordPendingDelivery the delivery is lost forever; without
//            retryPendingDeliveries the dead-letter ledger never drains.

import supabase from "./_db-client.js";

export const MAX_DELIVERY_ATTEMPTS = 3;
export const LEDGER_KEY = "notification_dead_letters";
export const LEDGER_CAP = 200;
export const NOTIFICATION_CAP = 100;
export const USER_KEY_PREFIX = "notifications:";
const EVIDENCE_ACTOR = "notification-delivery";

/** Canonical settings key for a user's notification store. Lowercased like
 *  _auth.notifyUser / _notifications.notificationKey so both agree. */
export function notificationUserKey(anonId) {
	return `${USER_KEY_PREFIX}${String(anonId || "").toLowerCase()}`;
}

async function logDelivery(action, detail) {
	try {
		await supabase.from("activity_logs").insert({
			actor: EVIDENCE_ACTOR,
			action,
			detail: String(detail || "").slice(0, 500),
		});
	} catch {
		/* evidence is best-effort; never break delivery on a log failure */
	}
}

/** Strict read: `null` means "could not read" (error), `[]` means "empty".
 *  The distinction matters — treating an error as empty would let a write
 *  blind-overwrite real history. */
async function readStoreStrict(anonId) {
	try {
		const { data, error } = await supabase
			.from("settings")
			.select("value")
			.eq("key", notificationUserKey(anonId))
			.maybeSingle();
		if (error) return null;
		const list = data?.value?.notifications;
		return Array.isArray(list) ? list : [];
	} catch {
		return null;
	}
}

/** Best-effort read of a user's real notification store. Always an array. */
export async function readNotificationStore(anonId) {
	const list = await readStoreStrict(anonId);
	return list || [];
}

/** Independent verification: is this notification id in the store right now?
 *  A read error returns false — we never claim delivery without proof. */
export async function verifyNotificationStored(anonId, notificationId) {
	if (!notificationId) return false;
	const list = await readStoreStrict(anonId);
	if (list === null) return false;
	return list.some((n) => n && n.id === notificationId);
}

/** Real write: read current history, prepend the entry, cap, upsert. Mirrors
 *  _auth.notifyUser's storeOnce so the two can never disagree on shape. Returns
 *  false (never a throw) when the store could not be read or the upsert failed. */
export async function appendNotification(anonId, entry) {
	if (!entry || !entry.id) return false;
	const current = await readStoreStrict(anonId);
	if (current === null) return false; // read failed → refuse to overwrite history
	const next = [entry, ...current.filter((n) => n && n.id !== entry.id)].slice(
		0,
		NOTIFICATION_CAP,
	);
	try {
		const { error } = await supabase.from("settings").upsert(
			{
				key: notificationUserKey(anonId),
				value: { notifications: next, updated_at: new Date().toISOString() },
			},
			{ onConflict: "key" },
		);
		return !error;
	} catch {
		return false;
	}
}

/** Read the dead-letter ledger. `null` means the read failed — callers must bail
 *  rather than overwrite a ledger they could not read. */
async function readLedger() {
	try {
		const { data, error } = await supabase
			.from("settings")
			.select("value")
			.eq("key", LEDGER_KEY)
			.maybeSingle();
		if (error) return null;
		const entries = data?.value?.entries;
		return Array.isArray(entries) ? entries : [];
	} catch {
		return null;
	}
}

async function writeLedger(entries) {
	try {
		const { error } = await supabase.from("settings").upsert(
			{
				key: LEDGER_KEY,
				value: {
					entries: entries.slice(0, LEDGER_CAP),
					updated_at: new Date().toISOString(),
				},
			},
			{ onConflict: "key" },
		);
		return !error;
	} catch {
		return false;
	}
}

/** Record a delivery that failed all immediate attempts. Idempotent on the
 *  notification id, so a double failure cannot duplicate a ledger entry. */
export async function recordPendingDelivery(anonId, entry, reason = "write_failed") {
	if (!anonId || !entry?.id) return false;
	const ledger = await readLedger();
	if (ledger === null) return false;
	if (ledger.some((e) => e?.entry?.id === entry.id)) return true;
	ledger.unshift({
		id: `dl_${entry.id}`,
		anon_id: String(anonId).toLowerCase(),
		entry,
		reason: String(reason || "write_failed").slice(0, 200),
		attempts: 0,
		status: "pending",
		first_failed_at: new Date().toISOString(),
		last_attempt_at: null,
	});
	const ok = await writeLedger(ledger);
	if (ok)
		await logDelivery(
			"notification_dead_lettered",
			`${entry.id} → ${anonId} (${reason})`,
		);
	return ok;
}

/** Bounded retry pass with independent read-back verification.
 *  Returns the report that is the evidence surface for the caller. */
export async function retryPendingDeliveries({ limit = 25 } = {}) {
	const report = {
		retried: 0,
		delivered: 0,
		failed: 0,
		dead: 0,
		delivered_ids: [],
		dead_ids: [],
		pending_after: 0,
		ledger_ok: true,
	};
	const ledger = await readLedger();
	if (ledger === null) {
		report.ledger_ok = false;
		return report;
	}

	const now = new Date().toISOString();
	let changed = false;
	for (const rec of ledger) {
		if (rec?.status !== "pending" || !rec?.entry?.id) continue;
		if (report.retried >= limit) break;
		report.retried += 1;
		rec.attempts = (Number(rec.attempts) || 0) + 1;
		rec.last_attempt_at = now;
		changed = true;

		await appendNotification(rec.anon_id, rec.entry);
		// Independent verification — the write's own success is not trusted.
		const verified = await verifyNotificationStored(rec.anon_id, rec.entry.id);
		if (verified) {
			rec.status = "delivered";
			rec.verified_at = now;
			report.delivered += 1;
			report.delivered_ids.push(rec.entry.id);
			await logDelivery(
				"notification_delivery_verified",
				`${rec.entry.id} → ${rec.anon_id} after ${rec.attempts} attempt(s), read-back verified`,
			);
		} else if (rec.attempts >= MAX_DELIVERY_ATTEMPTS) {
			rec.status = "dead";
			rec.dead_at = now;
			report.dead += 1;
			report.dead_ids.push(rec.entry.id);
			await logDelivery(
				"notification_delivery_dead",
				`${rec.entry.id} → ${rec.anon_id} undeliverable after ${rec.attempts} attempt(s); read-back missing`,
			);
		} else {
			report.failed += 1;
		}
	}

	// Proven-delivered entries are pruned from the ledger (they now live in the
	// user's store). Pending + dead are kept: pending still needs retries, dead
	// needs a human. Capped so the ledger can never grow without bound.
	const kept = ledger.filter((r) => r?.status !== "delivered");
	if (kept.length !== ledger.length) changed = true;
	if (changed) report.ledger_ok = await writeLedger(kept);
	report.pending_after = kept.filter((r) => r?.status === "pending").length;
	return report;
}

/** The notification-dispatcher agent's REAL work: measure the notification
 *  store, drain the dead-letter ledger with independent verification, and return
 *  the result + evidence the cron surface records. Lives here (not inline in the
 *  agent registry) so the whole behaviour is unit-testable without booting the
 *  24/7 agent runtime. */
export async function dispatchNotifications({ scanLimit = 200, retryLimit = 25 } = {}) {
	const scan = await summarizeNotificationStore(scanLimit);
	const retry = await retryPendingDeliveries({ limit: retryLimit });
	const deliveredNote = retry.delivered
		? ` ${retry.delivered} retried notification(s) delivered + read-back verified.`
		: "";
	const deadNote = retry.dead ? ` ${retry.dead} marked dead (needs a human).` : "";
	return {
		summary: `Notification dispatcher: ${scan.unread_total} unread across ${scan.users_with_unread}/${scan.stores_scanned} store(s).${deliveredNote}${deadNote}`,
		unread_count: scan.unread_total,
		stores_scanned: scan.stores_scanned,
		users_with_unread: scan.users_with_unread,
		status: "active",
		evidence: {
			store: "settings:notifications:*",
			store_read_error: scan.read_error,
			retry_attempted: retry.retried,
			retry_delivered: retry.delivered,
			retry_delivered_ids: retry.delivered_ids.slice(0, 10),
			retry_failed: retry.failed,
			retry_dead: retry.dead,
			retry_dead_ids: retry.dead_ids.slice(0, 10),
			retry_pending_after: retry.pending_after,
			ledger_ok: retry.ledger_ok,
		},
	};
}

/** Read the REAL notification store (not a phantom `notifications` table) and
 *  summarise it. Used by the notification-dispatcher cron agent so its reported
 *  unread count is a measurement of actual state, not a hard-coded zero. */
export async function summarizeNotificationStore(limit = 200) {
	try {
		const { data, error } = await supabase
			.from("settings")
			.select("key, value")
			.like("key", `${USER_KEY_PREFIX}%`)
			.order("updated_at", { ascending: false })
			.limit(limit);
		if (error)
			return {
				stores_scanned: 0,
				unread_total: 0,
				users_with_unread: 0,
				read_error: String(error.message || error),
			};
		const rows = data || [];
		let unread = 0;
		let users = 0;
		for (const row of rows) {
			const list = row?.value?.notifications;
			if (!Array.isArray(list)) continue;
			const u = list.filter((n) => n && n.read === false).length;
			if (u > 0) {
				users += 1;
				unread += u;
			}
		}
		return {
			stores_scanned: rows.length,
			unread_total: unread,
			users_with_unread: users,
			read_error: null,
		};
	} catch (e) {
		return {
			stores_scanned: 0,
			unread_total: 0,
			users_with_unread: 0,
			read_error: String(e?.message || e),
		};
	}
}

// ── Notification Intelligence Worker (roster #34) ──────────────
// The registry's Class-B intel pass over the REAL notification surface:
// measure the stores, drain the dead-letter ledger with the verified
// retry (independent read-back), flag silent failures, and persist the
// snapshot to the canonical settings KV (notification_intel:latest),
// verified by re-read. Zero-arg (the cron loop calls the registry run
// with no arguments). Reuses this module's own verified retry — it never
// shadows or reinvents the delivery mechanics.
export const NOTIFICATION_INTEL_KEY = "notification_intel:latest";
const INTEL_ACTOR = "worker:notification-intel";

export async function runNotificationIntel({ nowMs = Date.now() } = {}) {
	// 1. Real read: the notification stores + the dead-letter ledger.
	const scan = await summarizeNotificationStore(200);
	const unreadTotal = scan.unread_total || 0;
	const storeReadError = scan.read_error || null;

	// 2. Real action: the bounded verified retry (read-back proof).
	let retry = null;
	try {
		retry = await retryPendingDeliveries({ limit: 25 });
	} catch (err) {
		return {
			ok: false,
			error: `dead-letter retry failed: ${String(err?.message || err).slice(0, 150)}`,
		};
	}
	const delivered = retry?.delivered || 0;
	const dead = retry?.dead || 0;
	const failed = retry?.failed || 0;

	// 3. Honest no-op when the platform has no notification surface at all —
	//    no fabricated zero report, no KV write.
	if (scan.stores_scanned === 0 && !storeReadError && retry.retried === 0 && retry.ledger_ok) {
		return {
			ok: true,
			verified: true,
			snapshot: {
				generated_at: new Date(nowMs).toISOString(),
				stores_scanned: 0,
				unread_total: 0,
				retry_delivered: 0,
				retry_dead: 0,
			},
			note: "no notification stores or dead letters yet - nothing to repair",
		};
	}

	// 4. Advisory row when delivery was repaired or silent failures remain
	//    (best-effort, evidenced).
	if (delivered > 0 || dead > 0 || failed > 0) {
		try {
			await supabase.from("activity_logs").insert({
				actor: INTEL_ACTOR,
				action: "notification_intel_report",
				detail: JSON.stringify({
					stores_scanned: scan.stores_scanned,
					unread_total: unreadTotal,
					retry_delivered: delivered,
					retry_failed: failed,
					retry_dead: dead,
				}).slice(0, 500),
			});
		} catch {
			/* advisory; a failed log must not fabricate a report */
		}
	}

	// 5. Persist + VERIFY by independent re-read.
	const snapshot = {
		generated_at: new Date(nowMs).toISOString(),
		stores_scanned: scan.stores_scanned || 0,
		unread_total: unreadTotal,
		users_with_unread: scan.users_with_unread || 0,
		store_read_error: storeReadError,
		retry_attempted: retry.retried || 0,
		retry_delivered: delivered,
		retry_failed: failed,
		retry_dead: dead,
		retry_pending_after: retry.pending_after ?? null,
		ledger_ok: retry.ledger_ok ?? null,
	};
	try {
		await supabase
			.from("settings")
			.upsert(
				{ key: NOTIFICATION_INTEL_KEY, value: snapshot },
				{ onConflict: "key" },
			);
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", NOTIFICATION_INTEL_KEY)
			.maybeSingle();
		const persisted = data?.value?.generated_at === snapshot.generated_at;
		return {
			ok: true,
			verified: persisted,
			snapshot,
			delivered,
			dead,
			failed,
			stores_scanned: scan.stores_scanned || 0,
		};
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}
