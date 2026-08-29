// Auto-Cleanup Middleware
// Soft-deleted posts after 14d, comments after 30d, activity logs after 30d.
// Runs on API cold start (once per function instance) and via POST /api/cleanup (admin only).
// NEVER auto-unbans — bans are admin-only decisions.
// Designed for limited-memory Supabase instances — deletes in small batches to avoid timeouts.

import { auditLog, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

const SOFT_DELETE_RETENTION_DAYS = 14; // soft-deleted posts
const COMMENT_RETENTION_DAYS = 30; // comments
const LOG_RETENTION_DAYS = 30; // activity logs, chat messages
const BATCH_SIZE = 50;

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
	retentionDays = SOFT_DELETE_RETENTION_DAYS,
) {
	const cutoff = daysAgo(retentionDays);
	const { count } = await supabase
		.from(table)
		.select("*", { count: "exact", head: true })
		.lte(filterCol, cutoff)
		.match(filter);

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

async function runCleanup() {
	const now = Date.now();
	if (now - lastRunAtMem < COOLDOWN_MS) return null;
	// FIX #38: Check persisted timestamp so cooldown survives cold starts
	try {
		const { data: state } = await supabase.from("settings").select("value").eq("key", "cleanup_state").maybeSingle();
		const lastAt = state?.value?.last_run_at ? new Date(state.value.last_run_at).getTime() : 0;
		if (now - lastAt < COOLDOWN_MS) { lastRunAtMem = lastAt; return null; }
	} catch { /* fall through */ }
	lastRunAtMem = now;
	try { await supabase.from("settings").upsert({ key: "cleanup_state", value: { last_run_at: new Date().toISOString() } }, { onConflict: "key" }); } catch {}

	const results = {};

	// 1. Soft-deleted posts older than 14 days (hard delete)
	try {
		const cutoff = daysAgo(SOFT_DELETE_RETENTION_DAYS);
		const { count } = await supabase
			.from("posts")
			.select("*", { count: "exact", head: true })
			.eq("deleted", true)
			.lte("created_at", cutoff);

		if (count && count > 0) {
			let deleted = 0;
			while (deleted < count) {
				const { data: batch } = await supabase
					.from("posts")
					.select("id")
					.eq("deleted", true)
					.lte("created_at", cutoff)
					.limit(BATCH_SIZE);
				if (!batch || batch.length === 0) break;
				await supabase
					.from("posts")
					.delete()
					.in(
						"id",
						batch.map((r) => r.id),
					);
				deleted += batch.length;
				if (batch.length < BATCH_SIZE) break;
			}
			results.deleted_posts = deleted;
		}
	} catch (e) {
		console.error("[cleanup] posts sweep failed:", e.message);
	}

	// 2. Comments older than 30 days
	try {
		const cutoff = daysAgo(COMMENT_RETENTION_DAYS);
		const { data: oldComments } = await supabase
			.from("comments")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (oldComments && oldComments.length > 0) {
			await supabase
				.from("comments")
				.delete()
				.in(
					"id",
					oldComments.map((c) => c.id),
				);
			results.deleted_comments = oldComments.length;
		}
	} catch (e) {
		console.error("[cleanup] comments sweep failed:", e.message);
	}

	// 3. Reactions older than 30 days
	try {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldReactions } = await supabase
			.from("reactions")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (oldReactions && oldReactions.length > 0) {
			await supabase
				.from("reactions")
				.delete()
				.in(
					"id",
					oldReactions.map((r) => r.id),
				);
			results.deleted_reactions = oldReactions.length;
		}
	} catch (e) {
		console.error("[cleanup] reactions sweep failed:", e.message);
	}

	// 4. Chat messages older than 30 days
	try {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldMessages } = await supabase
			.from("chat_messages")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (oldMessages && oldMessages.length > 0) {
			await supabase
				.from("chat_messages")
				.delete()
				.in(
					"id",
					oldMessages.map((m) => m.id),
				);
			results.deleted_messages = oldMessages.length;
		}
	} catch (e) {
		console.error("[cleanup] chat_messages sweep failed:", e.message);
	}

	// 5. Activity logs older than 30 days
	try {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldLogs } = await supabase
			.from("activity_logs")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (oldLogs && oldLogs.length > 0) {
			await supabase
				.from("activity_logs")
				.delete()
				.in(
					"id",
					oldLogs.map((l) => l.id),
				);
			results.deleted_logs = oldLogs.length;
		}
	} catch (e) {
		console.error("[cleanup] activity_logs sweep failed:", e.message);
	}

	// 6. Agent conversation history older than 30 days (safe: table may not exist)
	try {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldConvos, error: convoErr } = await supabase
			.from("agent_conversations")
			.select("id")
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE * 3);

		if (convoErr) {
			// Table may not exist yet — skip silently
		} else if (oldConvos && oldConvos.length > 0) {
			await supabase
				.from("agent_conversations")
				.delete()
				.in(
					"id",
					oldConvos.map((c) => c.id),
				);
			results.deleted_conversations = oldConvos.length;
		}
	} catch (e) {
		console.error("[cleanup] agent_conversations sweep:", e.message);
	}

	// 7. Archived polls older than 30 days
	try {
		const cutoff = daysAgo(LOG_RETENTION_DAYS);
		const { data: oldPolls } = await supabase
			.from("polls")
			.select("id")
			.eq("archived", true)
			.lte("created_at", cutoff)
			.limit(BATCH_SIZE);

		if (oldPolls && oldPolls.length > 0) {
			await supabase
				.from("polls")
				.delete()
				.in(
					"id",
					oldPolls.map((p) => p.id),
				);
			results.deleted_polls = oldPolls.length;
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
				await supabase
					.from("poll_votes")
					.delete()
					.in("id", orphanIds.slice(0, BATCH_SIZE));
				results.deleted_orphan_votes = orphanIds.length;
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
					await supabase
						.from("reactions")
						.delete()
						.in("id", orphanIds.slice(0, BATCH_SIZE));
					results.deleted_orphan_reactions = orphanIds.length;
				}
			}
		}
	} catch (e) {
		console.error("[cleanup] orphan reactions sweep failed:", e.message);
	}

	// 12. Duplicate reports (same target_id + author_id)
	try {
		const { data: dupes } = await supabase
			.from("reports")
			.select("id,target_id,author_id")
			.limit(500);
		if (dupes && dupes.length > 1) {
			const seen = new Map();
			const toDelete = [];
			for (const r of dupes) {
				const key = `${r.target_id}:${r.author_id}`;
				if (seen.has(key)) toDelete.push(r.id);
				else seen.set(key, r.id);
			}
			if (toDelete.length > 0) {
				await supabase
					.from("reports")
					.delete()
					.in("id", toDelete.slice(0, BATCH_SIZE));
				results.deleted_duplicate_reports = toDelete.length;
			}
		}
	} catch (e) {
		console.error("[cleanup] duplicate reports sweep failed:", e.message);
	}

	// NOTE: Bans are NEVER auto-removed. Only admins can unban users.

	const total = Object.values(results).reduce((a, b) => a + b, 0);
	return {
		cleaned: total,
		details: results,
		retention: {
			soft_deleted_posts: SOFT_DELETE_RETENTION_DAYS,
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
