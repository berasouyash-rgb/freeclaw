// ═══════════════════════════════════════════════════════════════
// Improvement Scan Agents — the always-on audit workforce.
// ═══════════════════════════════════════════════════════════════
// Five hidden scanners run from the daily agent cron (and can be triggered
// manually from the admin desk). Each performs BOUNDED read-only queries,
// reasons about thresholds, and queues SUGGESTIONS via queueImprovement().
// They never mutate content and never act without admin approval.
// ═══════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";
import { queueImprovement } from "./_improvements.js";

/** Content-health agent: moderation backlog & unanswered posts. */
async function scanContentHealth() {
	const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
	const { count: stuck } = await supabase
		.from("posts")
		.select("id", { count: "exact", head: true })
		.eq("pending_review", true)
		.lt("created_at", since);
	if ((stuck || 0) >= 3)
		await queueImprovement({
			title: `${stuck} posts waiting for review for over 48 hours`,
			detail:
				"The pre-publish review queue is backing up. Review pending posts to keep publishing fast.",
			category: "content",
			priority: stuck >= 10 ? "high" : "medium",
			source: "content-health-agent",
		});

	const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
	const { data: quiet } = await supabase
		.from("posts")
		.select("id,title")
		.in("status", ["reported", "verified"])
		.eq("deleted", false)
		.lt("created_at", weekAgo)
		.order("created_at", { ascending: false })
		.limit(50);
	if ((quiet || []).length >= 10)
		await queueImprovement({
			title: `${quiet.length} recent open posts have no admin response yet`,
			detail:
				"Consider triaging oldest open reports so users see movement on their submissions.",
			category: "community",
			priority: "medium",
			source: "content-health-agent",
		});
}

/** Security-posture agent: long-lived admin sessions & stale tokens. */
async function scanSecurityPosture() {
	const { data: cfg } = await supabase
		.from("settings")
		.select("value")
		.eq("key", "admin_sessions")
		.maybeSingle();
	const tokens = Array.isArray(cfg?.value?.tokens) ? cfg.value.tokens : [];
	if (tokens.length >= 5)
		await queueImprovement({
			title: `${tokens.length} active admin sessions`,
			detail:
				"Many concurrent admin sessions are active. Log out unused devices from Admin → Security.",
			category: "security",
			priority: tokens.length >= 8 ? "high" : "medium",
			source: "security-agent",
		});
}

/** Database-hygiene agent: expired polls left unarchived. */
async function scanDatabaseHygiene() {
	const now = new Date().toISOString();
	const { count: stalePolls } = await supabase
		.from("polls")
		.select("id", { count: "exact", head: true })
		.eq("archived", false)
		.eq("deleted", false)
		.not("expires_at", "is", null)
		.lt("expires_at", now);
	if ((stalePolls || 0) >= 3)
		await queueImprovement({
			title: `${stalePolls} expired polls not archived yet`,
			detail:
				"Archiving ended polls keeps the active poll list clean for voters.",
			category: "database",
			priority: "low",
			source: "db-hygiene-agent",
		});
}

/** Performance agent: soft-deleted content eligible for hard purge. */
async function scanPerformance() {
	const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
	const { count: deletable } = await supabase
		.from("posts")
		.select("id", { count: "exact", head: true })
		.eq("deleted", true)
		.lt("updated_at", cutoff);
	if ((deletable || 0) >= 25)
		await queueImprovement({
			title: `${deletable} soft-deleted posts older than 30 days`,
			detail:
				"A periodic hard-purge of old deleted rows keeps feeds and backups lean.",
			category: "performance",
			priority: "low",
			source: "performance-agent",
		});
}

/** Community/UX agent: unresolved abuse reports. */
async function scanCommunityUX() {
	const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
	const { count: openReports } = await supabase
		.from("reports")
		.select("id", { count: "exact", head: true })
		.eq("status", "open")
		.lt("created_at", weekAgo)
		.then(
			(r) => r,
			() => ({ count: 0 }),
		);
	if ((openReports || 0) >= 2)
		await queueImprovement({
			title: `${openReports} user reports unresolved for over a week`,
			detail:
				"Trust drops when reports sit unanswered. Clear the moderation queue.",
			category: "community",
			priority: "high",
			source: "ux-agent",
		});
}

/** Run every scanner; one failing agent never blocks the others. */
export async function runImprovementScans() {
	const agents = [
		scanContentHealth,
		scanSecurityPosture,
		scanDatabaseHygiene,
		scanPerformance,
		scanCommunityUX,
	];
	let ok = 0;
	for (const fn of agents) {
		try {
			await fn();
			ok++;
		} catch (err) {
			console.warn(`[improve-scan] ${fn.name} failed:`, err?.message);
		}
	}
	return { agents: agents.length, succeeded: ok };
}
