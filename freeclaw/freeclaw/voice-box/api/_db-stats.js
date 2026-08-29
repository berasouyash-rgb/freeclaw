// Database Statistics & Maintenance — admin-only endpoint.
// GET  /api/db-stats  →  table sizes, row counts, index health, storage estimates
// POST /api/db-stats  →  trigger manual vacuum / maintenance

import { auditLog, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

const CRITICAL_TABLES = [
	"posts", "comments", "reactions", "polls", "poll_votes",
	"reports", "users_meta", "settings", "activity_logs",
	"chat_messages", "agent_conversations",
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
		const [tableStats, staleData] = await Promise.all([
			Promise.all(CRITICAL_TABLES.map(getTableStats)),
			getStaleData(),
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
			total_stale: Object.values(staleData).filter((v) => v > 0).reduce((a, b) => a + b, 0),
			response_time_ms: Date.now() - start,
		});
	} catch (err) {
		return sanitizeError(res, err, "db-stats");
	}
}
