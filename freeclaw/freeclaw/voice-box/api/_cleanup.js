// Auto-Cleanup Middleware
// User-deleted posts auto-purge 5h after deletion (updated_at marks delete time), comments after 30d, activity logs after 30d.
// Runs on API cold start (once per function instance) and via POST /api/cleanup (admin only).
// NEVER auto-unbans — bans are admin-only decisions.
// Designed for limited-memory Supabase instances — deletes in small batches to avoid timeouts.

import { auditLog, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

const USER_DELETE_RETENTION_HOURS = 5; // user-deleted posts (updated_at = deletion time)
const COMMENT_RETENTION_DAYS = 30; // comments
const LOG_RETENTION_DAYS = 30; // activity logs, chat messages
const BATCH_SIZE = 50;
// Per-class janitor toggles (Step 4). Each age-based pass checks its flag;
// orphans/duplicates/sessions/notifications stay always-on (integrity, not
// age). The admin UI mirrors these keys + labels — rename in both places.
export const JANITOR_CLASSES = [
	{ key: "comments", label: "Old comments", desc: "Comments older than 30 days" },
	{ key: "reactions", label: "Old reactions", desc: "Reactions older than 30 days" },
	{ key: "chat_messages", label: "Old chat messages", desc: "Chat messages older than 30 days" },
	{ key: "activity_logs", label: "Old activity logs", desc: "Activity logs older than 30 days" },
	{ key: "agent_conversations", label: "Old agent conversations", desc: "Agent conversations older than 30 days" },
	{ key: "archived_polls", label: "Archived polls", desc: "Archived polls older than 30 days" },
	{ key: "agent_history", label: "Agent runtime history", desc: "Executions + insights older than 90 days" },
];
const JANITOR_CLASS_KEYS = new Set(JANITOR_CLASSES.map((c) => c.key));

/** Shared janitor config: retention hours + master toggle + per-class flags.
 *  Unknown keys are dropped, non-booleans fall back to true (fail-open for
 *  cleanup would silently keep garbage; fail-closed would silently break the
 *  5h contract — enabled-by-default preserves existing behavior). */
export async function getJanitorConfig() {
	let retentionHours = USER_DELETE_RETENTION_HOURS;
	let autoDelete = true;
	const classes = {};
	for (const c of JANITOR_CLASSES) classes[c.key] = true;
	try {
		const { data: rs } = await supabase.from("settings").select("value").eq("key", "retention_config").maybeSingle();
		const n = Number(rs?.value?.user_delete_hours);
		if (Number.isInteger(n) && n >= 1 && n <= 168) retentionHours = n;
		if (rs?.value?.auto_delete_enabled === false) autoDelete = false;
		const raw = rs?.value?.classes;
		if (raw && typeof raw === "object") {
			for (const c of JANITOR_CLASSES) {
				if (raw[c.key] === false) classes[c.key] = false;
			}
		}
	} catch {
		/* defaults stand */
	}
	return { retentionHours, autoDelete, classes };
}
const AGENT_HISTORY_DAYS = 90; // agent runtime rows (insert-only tables)

let lastRunAtMem = 0;
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between auto-runs (was 1 hour)
// FIX #38: Persist last run in Supabase so cleanup survives cold starts / scales across instances

function daysAgo(days) {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString();
}

async function deleteBatch(
	table,
	filter,
	filterCol = "created_at",
	retentionDays = 30,
) {
	const cutoff = daysAgo(retentionDays);
	const { count, error: countError } = await supabase
		.from(table)
		.select("*", { count: "exact", head: true })
		.lte(filterCol, cutoff)
		.match(filter);
	if (countError) throw countError;

	if (!count || count === 0) return 0;

	let deleted = 0;
	while (deleted < count) {
		const { data: batch, error: fetchErr } = await supabase
			.from(table)
			.select("id")
			.lte(filterCol, cutoff)
			.match(filter)
			.limit(BATCH_SIZE);

		if (fetchErr || !batch || batch.length === 0) {
			if (fetchErr)
				console.error(
					`[cleanup] fetch batch error on ${table}:`,
					fetchErr.message,
				);
			break;
		}

		const ids = batch.map((r) => r.id);
		const { error: delErr } = await supabase.from(table).delete().in("id", ids);

		if (delErr) {
			console.error(
				`[cleanup] delete batch error on ${table}:`,
				delErr.message,
			);
			break;
		}
		deleted += batch.length;

		if (batch.length < BATCH_SIZE) break;
	}

	return deleted;
}

async function deleteRows(table, column, ids) {
	if (!ids.length) return 0;
	const { error } = await supabase.from(table).delete().in(column, ids);
	if (error) throw error;
	return ids.length;
}

export async function runCleanup() {
	const now = Date.now();
	if (now - lastRunAtMem < COOLDOWN_MS) return null;
	const results = {};
	// FIX #38: Check persisted timestamp so cooldown survives cold starts
	try {
		const { data: state } = await supabase.from("settings").select("value").eq("key", "cleanup_state").maybeSingle();
		const lastAt = state?.value?.last_run_at ? new Date(state.value.last_run_at).getTime() : 0;
		if (now - lastAt < COOLDOWN_MS) { lastRunAtMem = lastAt; return null; }
	} catch (err) { console.error("[cleanup] cooldown read failed, continuing", { error: err?.message || String(err) }); results.cooldownReadFailed = true; }
	lastRunAtMem = now;
	try { await supabase.from("settings").upsert({ key: "cleanup_state", value: { last_run_at: new Date().toISOString() } }, { onConflict: "key" }); } catch (err) { console.error("[cleanup] cooldown persist failed", { error: err?.message || String(err) }); results.cooldownPersistFailed = true; }

	// 1. User-deleted posts older than 5 hours (hard delete)
	// janitorClasses is function-scoped: every age-based pass below reads it.
	let janitorClasses = {};
	for (const c of JANITOR_CLASSES) janitorClasses[c.key] = true;
	try {
		const { retentionHours, autoDelete, classes } = await getJanitorConfig();
		janitorClasses = classes;
		if (!autoDelete) { results.auto_delete_skipped = true; }
		else {
		const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
		const { count } = await supabase
			.from("posts")
			.select("*", { count: "exact", head: true })
			.eq("deleted", true)
			.lte("updated_at", cutoff);

		if (count && count > 0) {
			let deleted = 0;
			while (deleted < count) {
				const { data: batch } = await supabase
					.from("posts")
					.select("id")
					.eq("deleted", true)
					.lte("updated_at", cutoff)
					.limit(BATCH_SIZE);
				if (!batch || batch.length === 0) break;
				const { error: deleteError } = await supabase
					.from("posts")
					.delete()
					.in(
						"id",
						batch.map((r) => r.id),
					);
				if (deleteError) throw deleteError;
				deleted += batch.length;
				if (batch.length < BATCH_SIZE) break;
			}
			results.deleted_posts = deleted;
		}
		}
	} catch (e) {
		console.error("[cleanup] posts sweep failed:", e.message);
	}

	// 2. Comments older than 30 days
	try {
		if (janitorClasses.comments === false) { results.comments_skipped = true; } else {
		const cutoff = daysAgo(COMMENT_RETENTION_DAYS);
		const { data: oldComments } = await supabase
			.from("comments")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (oldComments && oldComments.length > 0) {
			const { error: deleteError } = await supabase
				.from("comments")
				.delete()
				.in(
					"id",
					oldComments.map((c) => c.id),
				);
			if (deleteError) throw deleteError;
			results.deleted_comments = oldComments.length;
		}
		}
	} catch (e) {
		console.error("[cleanup] comments sweep failed:", e.message);
	}

	// 3. Reactions older than 30 days
	try {
		if (janitorClasses.reactions === false) { results.reactions_skipped = true; } else {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldReactions } = await supabase
			.from("reactions")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (oldReactions && oldReactions.length > 0) {
			results.deleted_reactions = await deleteRows(
				"reactions",
				"id",
				oldReactions.map((r) => r.id),
			);
		}
		}
	} catch (e) {
		console.error("[cleanup] reactions sweep failed:", e.message);
	}

	// 4. Chat messages older than 30 days
	try {
		if (janitorClasses.chat_messages === false) { results.chat_messages_skipped = true; } else {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldMessages } = await supabase
			.from("chat_messages")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (oldMessages && oldMessages.length > 0) {
			results.deleted_messages = await deleteRows(
				"chat_messages",
				"id",
				oldMessages.map((m) => m.id),
			);
		}
		}
	} catch (e) {
		console.error("[cleanup] chat_messages sweep failed:", e.message);
	}

	// 5. Activity logs older than 30 days
	try {
		if (janitorClasses.activity_logs === false) { results.activity_logs_skipped = true; } else {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldLogs } = await supabase
			.from("activity_logs")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (oldLogs && oldLogs.length > 0) {
			results.deleted_logs = await deleteRows(
				"activity_logs",
				"id",
				oldLogs.map((l) => l.id),
			);
		}
		}
	} catch (e) {
		console.error("[cleanup] activity_logs sweep failed:", e.message);
	}

	// 6. Agent conversation history older than 30 days (safe: table may not exist)
	try {
		if (janitorClasses.agent_conversations === false) { results.agent_conversations_skipped = true; } else {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldConvos, error: convoErr } = await supabase
			.from("agent_conversations")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (convoErr) {
			// Table may not exist yet — skip silently
		} else if (oldConvos && oldConvos.length > 0) {
			results.deleted_conversations = await deleteRows(
				"agent_conversations",
				"id",
				oldConvos.map((c) => c.id),
			);
		}
		}
	} catch (e) {
		console.error("[cleanup] agent_conversations sweep:", e.message);
	}

	// 7. Archived polls older than 30 days
	try {
		if (janitorClasses.archived_polls === false) { results.archived_polls_skipped = true; } else {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldPolls } = await supabase
			.from("polls")
			.select("id")
			.eq("archived", true)
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE);

		if (oldPolls && oldPolls.length > 0) {
			const { error: deleteError } = await supabase
				.from("polls")
				.delete()
				.in(
					"id",
					oldPolls.map((p) => p.id),
				);
			if (deleteError) throw deleteError;
			results.deleted_polls = oldPolls.length;
		}
		}
	} catch (e) {
		console.error("[cleanup] polls archive sweep failed:", e.message);
	}

	// 8. Orphaned poll_votes (polls deleted but votes remain)
	try {
		const { data: allVotes } = await supabase
			.from("poll_votes")
			.select("id,poll_id")
			.limit(500);
		if (allVotes && allVotes.length > 0) {
			const pollIds = [...new Set(allVotes.map((v) => v.poll_id))];
			const { data: existingPolls } = await supabase
				.from("polls")
				.select("id")
				.in("id", pollIds);
			const existingSet = new Set((existingPolls || []).map((p) => p.id));
			const orphanIds = allVotes
				.filter((v) => !existingSet.has(v.poll_id))
				.map((v) => v.id);
			if (orphanIds.length > 0) {
				const batch = orphanIds.slice(0, BATCH_SIZE);
				const { error: deleteError } = await supabase
					.from("poll_votes")
					.delete()
					.in("id", batch);
				if (deleteError) throw deleteError;
				results.deleted_orphan_votes = batch.length;
			}
		}
	} catch (e) {
		console.error("[cleanup] orphan poll_votes sweep failed:", e.message);
	}

	// 9. Expired admin session tokens from settings
	try {
		const { data: settings } = await supabase
			.from("settings")
			.select("key,value")
			.like("key", "admin_sessions:%");
		if (settings && settings.length > 0) {
			const now = Date.now();
			let cleared = 0;
			for (const s of settings) {
				const tokens = s.value?.tokens || [];
				const valid = tokens.filter(
					(t) => t.exp && t.exp * 1000 > now,
				);
				if (valid.length < tokens.length) {
					await supabase
						.from("settings")
						.upsert(
							{ key: s.key, value: { ...s.value, tokens: valid } },
							{ onConflict: "key" },
						);
					cleared += tokens.length - valid.length;
				}
			}
			if (cleared > 0) results.cleared_session_tokens = cleared;
		}
	} catch (e) {
		console.error("[cleanup] session token sweep failed:", e.message);
	}

	// 10. Stale user notification arrays (keep max 100 per user)
	try {
		const { data: notifSettings } = await supabase
			.from("settings")
			.select("key,value")
			.like("key", "notifications:%");
		if (notifSettings && notifSettings.length > 0) {
			let trimmed = 0;
			for (const s of notifSettings) {
				const notifs = s.value?.notifications || [];
				if (notifs.length > 100) {
					const pruned = notifs.slice(0, 100);
					await supabase
						.from("settings")
						.upsert(
							{ key: s.key, value: { ...s.value, notifications: pruned } },
							{ onConflict: "key" },
						);
					trimmed += notifs.length - 100;
				}
			}
			if (trimmed > 0) results.trimmed_notifications = trimmed;
		}
	} catch (e) {
		console.error("[cleanup] notification trim failed:", e.message);
	}

	// 11. Orphaned reactions (target post/comment deleted)
	try {
		const { data: allReactions } = await supabase
			.from("reactions")
			.select("id,target_id,target_type")
			.limit(500);
		if (allReactions && allReactions.length > 0) {
			const postIds = allReactions
				.filter((r) => r.target_type === "post")
				.map((r) => r.target_id);
			if (postIds.length > 0) {
				const { data: existingPosts } = await supabase
					.from("posts")
					.select("id")
					.in("id", postIds);
				const existingSet = new Set(
					(existingPosts || []).map((p) => p.id),
				);
				const orphanIds = allReactions
					.filter(
						(r) =>
							r.target_type === "post" &&
							!existingSet.has(r.target_id),
					)
					.map((r) => r.id);
				if (orphanIds.length > 0) {
					const batch = orphanIds.slice(0, BATCH_SIZE);
					const { error: deleteError } = await supabase
						.from("reactions")
						.delete()
						.in("id", batch);
					if (deleteError) throw deleteError;
					results.deleted_orphan_reactions = batch.length;
				}
			}
		}
	} catch (e) {
		console.error("[cleanup] orphan reactions sweep failed:", e.message);
	}

	// 12. Duplicate reports (same target_id + author_id + status)
	//
	// DESTRUCTIVE, so it must never destroy moderation evidence. Two rules
	// this block previously broke:
	//   1. It deduped on target+author only, ignoring `status` — so a user
	//      who reported a post, saw it resolved, then reported it AGAIN had
	//      their live PENDING report deleted (an active moderation item
	//      vanished) or had the resolved row deleted (audit trail gone).
	//   2. It reported `toDelete.length` while deleting only one batch, so
	//      the report over-stated what was removed (fake success).
	// Now: keep the OLDEST row per (target, author, status) — one row per
	// distinct moderation state — and report what was actually deleted.
	try {
		const { data: dupes } = await supabase
			.from("reports")
			.select("id,target_id,author_id,status,created_at")
			.order("created_at", { ascending: true })
			.limit(500);
		if (dupes && dupes.length > 1) {
			const seen = new Set();
			const toDelete = [];
			for (const r of dupes) {
				// Status is part of the key: a new report of the same target
				// after resolution is a DIFFERENT record, not a duplicate.
				const key = `${r.target_id}:${r.author_id}:${r.status || "pending"}`;
				if (seen.has(key)) toDelete.push(r.id);
				else seen.add(key);
			}
			if (toDelete.length > 0) {
				const batch = toDelete.slice(0, BATCH_SIZE);
				const { error: delErr } = await supabase
					.from("reports")
					.delete()
					.in("id", batch);
				if (delErr) throw delErr;
				// Honest count: rows actually removed, not rows considered.
				results.deleted_duplicate_reports = batch.length;
			}
		}
	} catch (e) {
		console.error("[cleanup] duplicate reports sweep failed:", e.message);
	}

	// 13. Agent runtime history older than 90 days. agent_executions /
	// agent_insights are insert-only — nothing else prunes them, so they
	// grow unbounded. The AI activity surfaces read the last 30 days; 90
	// keeps 3x headroom. Batched like every other pass; a failed delete
	// leaves rows for the next run and records no key (proven-counts).
	try {
		if (janitorClasses.agent_history === false) { results.agent_history_skipped = true; } else {
		const cutoff = daysAgo(AGENT_HISTORY_DAYS);
		for (const [table, col, key] of [
			["agent_executions", "started_at", "pruned_executions"],
			["agent_insights", "created_at", "pruned_insights"],
		]) {
			const { data: old } = await supabase
				.from(table)
				.select("id")
				.lte(col, cutoff)
				.limit(BATCH_SIZE * 3);
			if (old && old.length > 0) {
				const n = await deleteRows(
					table,
					"id",
					old.map((r) => r.id),
				);
				if (n > 0) results[key] = (results[key] || 0) + n;
			}
		}
		}
	} catch (e) {
		console.error("[cleanup] agent history sweep failed:", e.message);
	}

	// NOTE: Bans are NEVER auto-removed. Only admins can unban users.

	const total = Object.values(results).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
	// Persist measured run stats so the admin settings UI renders the last
	// real optimization run (time, duration, rows) instead of an estimate.
	try {
		await supabase.from("settings").upsert({ key: "cleanup_state", value: { last_run_at: new Date().toISOString(), duration_ms: Date.now() - now, results } }, { onConflict: "key" });
	} catch (err) { console.error("[cleanup] stats persist failed", { error: err?.message || String(err) }); }
	return {
		cleaned: total,
		details: results,
		retention: {
			user_deleted_posts_hours: USER_DELETE_RETENTION_HOURS,
			comments: COMMENT_RETENTION_DAYS,
			logs: LOG_RETENTION_DAYS,
		},
	};
}

// Auto-run on cold start (non-blocking)
let cleanupStarted = false;
function triggerAutoCleanup() {
	if (cleanupStarted) return;
	cleanupStarted = true;
	runCleanup()
		.catch((err) =>
			console.error("[cleanup] Auto-cleanup failed:", err.message),
		)
		.finally(() => {
			cleanupStarted = false;
		});
}

// HTTP handler for manual trigger
export async function cleanupHandler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		const result = await runCleanup();
		if (!result) {
			return res
				.status(200)
				.json({
					message: "Cleanup ran recently — skipping",
					cooldown_ms: COOLDOWN_MS,
				});
		}
		await auditLog("admin", "cleanup", `Cleaned ${result.cleaned} records`);
		return res.status(200).json({ success: true, ...result });
	} catch (err) {
		return sanitizeError(res, err, "cleanup");
	}
}

export { triggerAutoCleanup };
