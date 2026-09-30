// Database Statistics & Maintenance — admin-only endpoint.
// GET  /api/db-stats  →  table sizes, row counts, index health, storage estimates
// POST /api/db-stats  →  trigger manual vacuum / maintenance

import { auditLog, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { getJanitorConfig } from "./_cleanup.js";
import { sanitizeError } from "./_error.js";

const CRITICAL_TABLES = [
	"posts", "comments", "reactions", "polls", "poll_votes",
	"reports", "users_meta", "settings", "activity_logs",
	"chat_messages", "chat_threads", "agent_conversations",
	"agent_executions", "agent_insights",
];

async function getTableStats(table) {
	const start = Date.now();
	try {
		const { count, error } = await supabase
			.from(table)
			.select("*", { count: "exact", head: true });
		if (error) throw error;
		return {
			table,
			rows: count || 0,
			latency_ms: Date.now() - start,
			status: "ok",
		};
	} catch (err) {
		return {
			table,
			rows: -1,
			latency_ms: Date.now() - start,
			status: "error",
			error: String(err.message).slice(0, 100),
		};
	}
}

async function getStaleData() {
	const now = Date.now();
	const DAY = 86400000;
	const stale = {};

	// Soft-deleted posts older than 14 days
	try {
		const cutoff = new Date(now - 14 * DAY).toISOString();
		const { count } = await supabase
			.from("posts")
			.select("*", { count: "exact", head: true })
			.eq("deleted", true)
			.lte("created_at", cutoff);
		stale.soft_deleted_posts = count || 0;
	} catch { stale.soft_deleted_posts = -1; }

	// Comments older than 30 days
	try {
		const cutoff = new Date(now - 30 * DAY).toISOString();
		const { count } = await supabase
			.from("comments")
			.select("*", { count: "exact", head: true })
			.lte("created_at", cutoff);
		stale.old_comments = count || 0;
	} catch { stale.old_comments = -1; }

	// Activity logs older than 30 days
	try {
		const cutoff = new Date(now - 30 * DAY).toISOString();
		const { count } = await supabase
			.from("activity_logs")
			.select("*", { count: "exact", head: true })
			.lte("created_at", cutoff);
		stale.old_activity_logs = count || 0;
	} catch { stale.old_activity_logs = -1; }

	// Archived polls older than 30 days
	try {
		const cutoff = new Date(now - 30 * DAY).toISOString();
		const { count } = await supabase
			.from("polls")
			.select("*", { count: "exact", head: true })
			.eq("archived", true)
			.lte("created_at", cutoff);
		stale.old_archived_polls = count || 0;
	} catch { stale.old_archived_polls = -1; }

	// Duplicate reports (same target + author)
	try {
		const { data } = await supabase
			.from("reports")
			.select("target_id,author_id");
		if (data && data.length > 1) {
			const seen = new Set();
			let dupes = 0;
			for (const r of data) {
				const key = `${r.target_id}:${r.author_id}`;
				if (seen.has(key)) dupes++;
				else seen.add(key);
			}
			stale.duplicate_reports = dupes;
		} else {
			stale.duplicate_reports = 0;
		}
	} catch { stale.duplicate_reports = -1; }

	return stale;
}

// ─── Dry run: what the janitor would delete ─────────────────────
// Mirrors api/_cleanup.js predicate-for-predicate (user-deleted posts by
// updated_at + retention_config hours with the enable toggle; 30-day age
// outs for comments/reactions/chat_messages/activity_logs/
// agent_conversations; archived polls). If _cleanup.js changes a predicate,
// this block must change with it — the two are tested side by side.
const DAY_MS = 86400000;

async function countWhere(table, apply) {
	try {
		let q = supabase.from(table).select("*", { count: "exact", head: true });
		q = apply(q);
		const { count, error } = await q;
		if (error) throw error;
		return count || 0;
	} catch {
		return -1;
	}
}

// Class-gated counter: a disabled janitor class estimates 0, exactly
// what the next janitor pass would delete (its pass is skipped too).
async function countIf(classes, key, table, apply) {
	if (classes[key] === false) return 0;
	return countWhere(table, apply);
}

async function getDryRun(now = Date.now()) {
	const { retentionHours: hours, autoDelete, classes } = await getJanitorConfig();
	const postCutoff = new Date(now - hours * 3600 * 1000).toISOString();
	const day30 = new Date(now - 30 * DAY_MS).toISOString();
	const dry = {};
	dry.retention_hours = hours;
	dry.auto_delete_skipped = !autoDelete;
	dry.skipped_classes = Object.keys(classes).filter((k) => classes[k] === false);
	dry.user_deleted_posts = autoDelete
		? await countWhere("posts", (q) =>
				q.eq("deleted", true).lte("updated_at", postCutoff),
			)
		: 0;
	dry.old_comments = await countIf(classes, "comments", "comments", (q) =>
		q.lte("created_at", day30),
	);
	dry.old_reactions = await countIf(classes, "reactions", "reactions", (q) =>
		q.lte("created_at", day30),
	);
	dry.old_chat_messages = await countIf(classes, "chat_messages", "chat_messages", (q) =>
		q.lte("created_at", day30),
	);
	dry.old_activity_logs = await countIf(classes, "activity_logs", "activity_logs", (q) =>
		q.lte("created_at", day30),
	);
	dry.old_agent_conversations = await countIf(classes, "agent_conversations", "agent_conversations", (q) =>
		q.lte("created_at", day30),
	);
	dry.old_archived_polls = await countIf(classes, "archived_polls", "polls", (q) =>
		q.eq("archived", true).lte("created_at", day30),
	);
	// Pass 13 mirror: agent runtime rows older than 90 days (started_at on
	// executions — that table has no created_at; created_at on insights).
	const day90cutoff = new Date(now - 90 * DAY_MS).toISOString();
	dry.old_agent_executions = await countIf(classes, "agent_history", "agent_executions", (q) =>
		q.lte("started_at", day90cutoff),
	);
	dry.old_agent_insights = await countIf(classes, "agent_history", "agent_insights", (q) =>
		q.lte("created_at", day90cutoff),
	);
	dry.total_would_delete = Object.entries(dry)
		.filter(([k, v]) => k !== "retention_hours" && typeof v === "number" && v > 0)
		.reduce((a, [, v]) => a + v, 0);
	// Widget-friendly projection: counts only (the bars widget renders one
	// bar per key; flags and totals would render as phantom bars).
	dry.counts = {
		user_deleted_posts: dry.user_deleted_posts,
		old_comments: dry.old_comments,
		old_reactions: dry.old_reactions,
		old_chat_messages: dry.old_chat_messages,
		old_activity_logs: dry.old_activity_logs,
		old_agent_conversations: dry.old_agent_conversations,
		old_archived_polls: dry.old_archived_polls,
		old_agent_executions: dry.old_agent_executions,
		old_agent_insights: dry.old_agent_insights,
	};
	return dry;
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		const start = Date.now();

		if (req.method === "POST") {
			// Manual trigger: run cleanup and return results
			const { runCleanup } = await import("./_cleanup.js");
			const result = await runCleanup();
			await auditLog("admin", "db_stats_maintenance", "Manual maintenance triggered");
			return res.status(200).json({
				success: true,
				message: result
					? `Cleaned ${result.cleaned} records`
					: "Cleanup ran recently — skipped",
				details: result?.details || {},
			});
		}

		// GET: full database statistics
		const [tableStats, staleData, dryRun] = await Promise.all([
			Promise.all(CRITICAL_TABLES.map(getTableStats)),
			getStaleData(),
			getDryRun(),
		]);

		const totalRows = tableStats
			.filter((t) => t.rows >= 0)
			.reduce((a, b) => a + b.rows, 0);

		const tablesWithIssues = tableStats.filter(
			(t) => t.status === "error" || t.latency_ms > 500,
		);

		const healthScore = tablesWithIssues.length === 0 ? 100
			: Math.max(0, 100 - tablesWithIssues.length * 10);

		return res.status(200).json({
			status: healthScore >= 80 ? "healthy" : healthScore >= 50 ? "degraded" : "unhealthy",
			health_score: healthScore,
			total_rows: totalRows,
			tables: tableStats,
			stale_data: staleData,
			dry_run: dryRun,
			dry_run_counts: dryRun.counts,
			total_stale: Object.values(staleData).filter((v) => v > 0).reduce((a, b) => a + b, 0),
			response_time_ms: Date.now() - start,
		});
	} catch (err) {
		return sanitizeError(res, err, "db-stats");
	}
}

// ─── Database Intelligence Worker (roster #32) ──────────────────
// READ-ONLY measurement: real table stats and latency over the critical
// tables, a health score, and issue flags — persisted to the canonical
// settings KV (db_intel:latest) and verified by re-read. HARD RULE: this
// worker never mutates indexes or schema — no change without a
// benchmarked before/after comparison. An advisory row is written only
// when a real issue exists. Zero-arg (the cron loop calls the registry
// run with no arguments).
const DB_INTEL_KEY = "db_intel:latest";
const SLOW_TABLE_MS = 500; // the same slow-table line the GET path flags

export async function runDbIntel({ nowMs = Date.now() } = {}) {
	// 1. Real read: per-table row counts + latency (the GET path's own logic).
	const tableStats = await Promise.all(CRITICAL_TABLES.map(getTableStats));
	const totalRows = tableStats
		.filter((t) => t.rows >= 0)
		.reduce((a, b) => a + b.rows, 0);
	const issues = tableStats.filter(
		(t) => t.status === "error" || t.latency_ms > SLOW_TABLE_MS,
	);
	const healthScore =
		issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 10);

	const snapshot = {
		generated_at: new Date(nowMs).toISOString(),
		health_score: healthScore,
		status:
			healthScore >= 80
				? "healthy"
				: healthScore >= 50
					? "degraded"
					: "unhealthy",
		total_rows: totalRows,
		tables_measured: tableStats.length,
		issues: issues.map((t) => ({
			table: t.table,
			rows: t.rows,
			latency_ms: t.latency_ms,
			status: t.status,
			error: t.error,
		})),
		read_only: true,
	};

	// 2. Advisory row only when a real issue exists (best-effort, evidenced).
	if (issues.length > 0) {
		try {
			await supabase.from("activity_logs").insert({
				actor: "worker:db-intel",
				action: "db_health_report",
				detail: JSON.stringify({
					health_score: healthScore,
					issues: snapshot.issues.slice(0, 10),
				}).slice(0, 500),
			});
		} catch {
			/* advisory; a failed log must not fabricate a report */
		}
	}

	// 3. Persist + VERIFY by independent re-read.
	try {
		await supabase
			.from("settings")
			.upsert({ key: DB_INTEL_KEY, value: snapshot }, { onConflict: "key" });
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", DB_INTEL_KEY)
			.maybeSingle();
		const persisted = data?.value?.generated_at === snapshot.generated_at;
		return { ok: true, verified: persisted, snapshot };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}
