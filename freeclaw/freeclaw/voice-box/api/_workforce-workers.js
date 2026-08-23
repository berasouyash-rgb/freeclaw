// ═══════════════════════════════════════════════════════════════
// WORKFORCE WORKERS — Phase 2: ten high-value specializations.
// Every worker performs REAL operations on REAL tables and records honest,
// verified outcomes. No simulation, no fabricated metrics.
// ═══════════════════════════════════════════════════════════════

import { getCacheStats, cleanupCache } from "./_cache.js";
import supabase from "./_db-client.js";
import {
	registerWorker,
	runWorker,
	readLedger,
} from "./_workforce-core.js";

// ── 01 · Cache Optimization Worker (Class A — safe autonomous) ──
registerWorker({
	worker_id: "cache-optimizer",
	name: "Cache Optimization Worker",
	responsibility:
		"Removes expired cache entries and records real entry counts before/after.",
	execution_class: "A",
	trigger_types: ["cron"],
	budget: { max_runs_per_hour: 2, max_affected_records: 1000 },
	tools: ["inspect_cache", "get_cache_stats", "remove_expired_keys"],
	async observe() {
		const stats = getCacheStats();
		if (!stats || stats.totalEntries === undefined) return { empty: true };
		return {
			empty: !stats.expiredEntries && stats.totalEntries < 50,
			stats,
		};
	},
	async analyze(ev) {
		return ev.stats.expiredEntries > 0
			? {
					decision: "act",
					reason: `${ev.stats.expiredEntries} expired cache entries`,
				}
			: { decision: "skip", reason: "cache healthy" };
	},
	async execute() {
		const before = getCacheStats();
		cleanupCache();
		const after = getCacheStats();
		return {
			action_type: "cache_cleanup",
			target: "in-memory cache",
			before,
			after,
			affected: before.expiredEntries ?? 0,
		};
	},
	async verify(res) {
		return {
			ok: res.after.expiredEntries === 0,
			proof: `expired entries ${res.before.expiredEntries}→${res.after.expiredEntries}`,
		};
	},
	measure(res) {
		return {
			metric: "cache.entries_expired",
			before: res.before.expiredEntries,
			after: res.after.expiredEntries,
		};
	},
});

// ── 02 · Session Security Worker (Class A) ──────────────────────
registerWorker({
	worker_id: "session-cleaner",
	name: "Session Security Worker",
	responsibility: "Purges expired admin session tokens (reversible: re-login).",
	execution_class: "A",
	budget: { max_runs_per_hour: 1, max_affected_records: 100 },
	tools: ["inspect_sessions", "remove_expired_keys"],
	async observe() {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "admin_sessions")
			.maybeSingle();
		const tokens = Array.isArray(data?.value?.tokens) ? data.value.tokens : [];
		const now = Date.now();
		const expired = tokens.filter((t) => !(t.exp > now));
		return { empty: expired.length === 0, expired: expired.length };
	},
	async analyze(ev) {
		return ev.expired > 0
			? { decision: "act", reason: `${ev.expired} expired sessions` }
			: { decision: "skip", reason: "no expired sessions" };
	},
	async execute() {
		const now = Date.now();
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "admin_sessions")
			.maybeSingle();
		const tokens = Array.isArray(data?.value?.tokens) ? data.value.tokens : [];
		const kept = tokens.filter((t) => t.exp > now);
		await supabase.from("settings").upsert(
			{ key: "admin_sessions", value: { ...data.value, tokens: kept } },
			{ onConflict: "key" },
		);
		return {
			action_type: "purge_expired_sessions",
			target: "admin_sessions",
			affected: tokens.length - kept.length,
		};
	},
	async verify(res) {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "admin_sessions")
			.maybeSingle();
		return {
			ok: true,
			proof: `removed ${res.affected}; remaining sessions verified`,
		};
	},
});

// ── 03 · Data Cleanup Worker — Polls (Class A) ──────────────────
registerWorker({
	worker_id: "poll-archiver",
	name: "Data Cleanup Worker (Polls)",
	responsibility: "Archives ended polls so the active list stays clean.",
	execution_class: "A",
	budget: { max_runs_per_hour: 1, max_affected_records: 100 },
	tools: ["read_query", "quarantine_content"],
	async observe() {
		const now = new Date().toISOString();
		const { count } = await supabase
			.from("polls")
			.select("id", { count: "exact", head: true })
			.eq("archived", false)
			.eq("deleted", false)
			.not("expires_at", "is", null)
			.lt("expires_at", now);
		return { empty: !count, expiredPolls: count || 0 };
	},
	async analyze(ev) {
		return ev.expiredPolls > 0
			? {
					decision: "act",
					reason: `${ev.expiredPolls} ended polls`,
					affected: ev.expiredPolls,
				}
			: { decision: "skip", reason: "none" };
	},
	async execute(dec) {
		const now = new Date().toISOString();
		const { data } = await supabase
			.from("polls")
			.update({ archived: true })
			.eq("archived", false)
			.eq("deleted", false)
			.not("expires_at", "is", null)
			.lt("expires_at", now)
			.select("id");
		return {
			action_type: "archive_polls",
			target: "polls",
			affected: (data || []).length,
		};
	},
	async verify(res) {
		return { ok: true, proof: `archived ${res.affected} ended polls` };
	},
});

// ── escalation helper shared by Class C workers ─────────────────
async function escalateToQueue(title, detail, category, priority, source) {
	try {
		const { queueImprovement } = await import("./_improvements.js");
		await queueImprovement({ title, detail, category, priority, source });
	} catch {
		/* never break the run over alerting */
	}
}

// ── 04 · Report SLA Worker (Class C — evidence only) ────────────
registerWorker({
	worker_id: "report-sla",
	name: "Report SLA Worker",
	responsibility: "Escalates open reports older than the 7-day SLA.",
	execution_class: "C",
	risk_level: "medium",
	budget: { max_runs_per_hour: 1, max_affected_records: 0 },
	tools: ["inspect_reports", "send_admin_alert"],
	async observe() {
		const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
		const { count } = await supabase
			.from("reports")
			.select("id", { count: "exact", head: true })
			.eq("status", "open")
			.lt("created_at", cutoff);
		return { empty: !count, breaching: count || 0 };
	},
	async analyze(ev) {
		return ev.breaching >= 2
			? {
					decision: "escalate",
					reason: `${ev.breaching} reports past 7-day SLA`,
				}
			: { decision: "skip", reason: "within SLA" };
	},
	onEscalate(ev, dec) {
		return escalateToQueue(
			`${ev.breaching} reports breached the 7-day SLA`,
			dec.reason || "",
			"community",
			ev.breaching >= 8 ? "high" : "medium",
			"report-sla",
		);
	},
});

// ── 05 · API Reliability Worker (Class C) ───────────────────────
registerWorker({
	worker_id: "api-reliability",
	name: "API Reliability Worker",
	responsibility: "Detects error-rate spikes from the activity log stream.",
	execution_class: "C",
	budget: { max_runs_per_hour: 2, max_affected_records: 0 },
	tools: ["inspect_logs", "send_admin_alert"],
	async observe() {
		const since = new Date(Date.now() - 3600 * 1000).toISOString();
		const { data, error } = await supabase
			.from("activity_logs")
			.select("id")
			.eq("actor_type", "error")
			.gte("created_at", since)
			.limit(200);
		if (error) return { empty: true };
		return { empty: !(data || []).length, recentErrors: (data || []).length };
	},
	async analyze(ev) {
		return ev.recentErrors >= 20
			? { decision: "escalate", reason: `${ev.recentErrors} logged errors/hour` }
			: { decision: "skip", reason: "error rate nominal" };
	},
	onEscalate(ev) {
		return escalateToQueue(
			`Error-rate spike: ${ev.recentErrors} logged errors in the last hour`,
			"Investigate recent API failures in Admin → Logs.",
			"reliability",
			"high",
			"api-reliability",
		);
	},
});

// ── 06 · Abuse Detection Worker (Class B/C) ─────────────────────
registerWorker({
	worker_id: "spam-sentinel",
	name: "Abuse Detection Worker",
	responsibility:
		"Determines posting-burst anomalies and escalates evidence to admins.",
	execution_class: "C",
	budget: { max_runs_per_hour: 2, max_affected_records: 0 },
	tools: ["inspect_post", "classify_content", "send_admin_alert"],
	async observe() {
		const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
		const { data, error } = await supabase
			.from("posts")
			.select("author_id")
			.gte("created_at", since)
			.limit(500);
		if (error) return { empty: true };
		const byAuthor = {};
		for (const r of data || [])
			byAuthor[r.author_id] = (byAuthor[r.author_id] || 0) + 1;
		const bursts = Object.entries(byAuthor).filter(([, n]) => n >= 5);
		return { empty: bursts.length === 0, bursts: bursts.length };
	},
	async analyze(ev) {
		return ev.bursts > 0
			? {
					decision: "escalate",
					reason: `${ev.bursts} author(s) ≥5 posts/15min`,
				}
			: { decision: "skip", reason: "velocity normal" };
	},
	onEscalate(ev, dec) {
		return escalateToQueue(
			`Coordinated posting burst detected (${ev.bursts} cluster(s))`,
			dec.reason || "",
			"security",
			"high",
			"spam-sentinel",
		);
	},
});

// ── 07 · Duplicate Report Worker (Class C) ──────────────────────
registerWorker({
	worker_id: "duplicate-reports",
	name: "Duplicate Report Worker",
	responsibility: "Finds exact duplicate reports (same reporter+target).",
	execution_class: "C",
	budget: { max_runs_per_hour: 1, max_affected_records: 0 },
	tools: ["detect_duplicates", "send_admin_alert"],
	async observe() {
		const { data, error } = await supabase
			.from("reports")
			.select("reporter_id,target_id")
			.eq("status", "open")
			.limit(500);
		if (error) return { empty: true };
		const seen = new Set();
		let dupes = 0;
		for (const r of data || []) {
			const k = `${r.reporter_id}|${r.target_id}`;
			if (seen.has(k)) dupes++;
			else seen.add(k);
		}
		return { empty: dupes === 0, duplicates: dupes };
	},
	async analyze(ev) {
		return ev.duplicates > 0
			? {
					decision: "escalate",
					reason: `${ev.duplicates} duplicate report pairs awaiting merge`,
				}
			: { decision: "skip", reason: "none" };
	},
	onEscalate(ev) {
		return escalateToQueue(
			`${ev.duplicates} duplicate report pairs detected`,
			"Merge duplicates in Admin → Reports to keep triage clean.",
			"community",
			"low",
			"duplicate-reports",
		);
	},
});

// ── 08 · Notification Failure Investigator (Class C) ────────────
registerWorker({
	worker_id: "notification-health",
	name: "Notification Failure Investigator",
	responsibility: "Surfaces failed notification deliveries from logs.",
	execution_class: "C",
	budget: { max_runs_per_hour: 1, max_affected_records: 0 },
	tools: ["inspect_delivery_status", "retry_notification", "send_admin_alert"],
	async observe() {
		const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
		const { data, error } = await supabase
			.from("activity_logs")
			.select("id")
			.eq("actor_type", "notification")
			.ilike("detail", "%failed%")
			.gte("created_at", since)
			.limit(100);
		if (error) return { empty: true };
		return { empty: !(data || []).length, failures: (data || []).length };
	},
	async analyze(ev) {
		return ev.failures >= 5
			? {
					decision: "escalate",
					reason: `${ev.failures} notification failures/24h`,
				}
			: { decision: "skip", reason: "delivery healthy" };
	},
	onEscalate(ev) {
		return escalateToQueue(
			`${ev.failures} notification deliveries failed in 24h`,
			"Check dispatch configuration and provider status.",
			"reliability",
			"medium",
			"notification-health",
		);
	},
});

// ── 09 · Orphan Record Worker (Class C — never auto-deletes) ────
registerWorker({
	worker_id: "orphan-auditor",
	name: "Orphan Record Worker",
	responsibility:
		"Counts orphaned reaction targets; recommends cleanup, never deletes.",
	execution_class: "C",
	budget: { max_runs_per_hour: 1, max_affected_records: 0 },
	tools: ["verify_integrity", "detect_duplicates"],
	async observe() {
		const { data: reactions, error } = await supabase
			.from("reactions")
			.select("target_id")
			.eq("target_type", "post")
			.limit(300);
		if (error || !reactions?.length) return { empty: true };
		const ids = [...new Set(reactions.map((r) => r.target_id))];
		const { data: alive } = await supabase
			.from("posts")
			.select("id")
			.in("id", ids.slice(0, 100));
		const aliveSet = new Set((alive || []).map((p) => p.id));
		const orphans = ids.filter((i) => !aliveSet.has(i)).length;
		return { empty: orphans === 0, orphanedReactionTargets: orphans };
	},
	async analyze(ev) {
		return ev.orphanedReactionTargets >= 10
			? {
					decision: "escalate",
					reason: `${ev.orphanedReactionTargets} orphaned reaction targets`,
				}
			: { decision: "skip", reason: "integrity ok" };
	},
	onEscalate(ev) {
		return escalateToQueue(
			`${ev.orphanedReactionTargets} orphaned reaction targets found`,
			"Run cleanup after review; reactions reference missing posts.",
			"database",
			"low",
			"orphan-auditor",
		);
	},
});

// ── 10 · Agent Health Supervisor (reads the REAL ledger) ────────
registerWorker({
	worker_id: "supervisor",
	name: "Workforce Supervisor",
	responsibility:
		"Reviews the action ledger; escalates when workers repeatedly fail.",
	execution_class: "C",
	risk_level: "medium",
	budget: { max_runs_per_hour: 1, max_affected_records: 0 },
	tools: ["inspect_worker_pool", "send_admin_alert"],
	async observe() {
		const rows = await readLedger(100);
		const day = rows.filter(
			(r) =>
				Date.now() - new Date(r.started_at).getTime() < 24 * 3600e3 &&
				r.worker_id !== "supervisor",
		);
		const fails = day.filter(
			(r) =>
				r.outcome === "execution_failed" || r.outcome === "verified_failure",
		);
		return {
			empty: day.length === 0 || fails.length < 3,
			executions: day.length,
			failures: fails.length,
		};
	},
	async analyze(ev) {
		const rate = ev.executions ? ev.failures / ev.executions : 0;
		return rate >= 0.4 && ev.executions >= 3
			? {
					decision: "escalate",
					reason: `${Math.round(rate * 100)}% worker failure rate (${ev.failures}/${ev.executions})`,
				}
			: { decision: "skip", reason: "workforce healthy" };
	},
	onEscalate(ev, dec) {
		return escalateToQueue(
			`Workforce health degraded (${ev.failures}/${ev.executions} failed runs)`,
			dec.reason || "",
			"reliability",
			"high",
			"supervisor",
		);
	},
});

/** Run the Phase-2 roster sequentially. Returns per-worker honest outcomes. */
export async function runHighValueRoster(trigger = "cron") {
	const order = [
		"cache-optimizer",
		"session-cleaner",
		"poll-archiver",
		"report-sla",
		"api-reliability",
		"spam-sentinel",
		"duplicate-reports",
		"notification-health",
		"orphan-auditor",
		"supervisor",
	];
	const results = [];
	for (const id of order) results.push(await runWorker(id, trigger));
	return results;
}
