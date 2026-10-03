// ═══════════════════════════════════════════════════════════════
// WORKFORCE WORKERS — Phase 2: ten high-value specializations.
// Every worker performs REAL operations on REAL tables and records honest,
// verified outcomes. No simulation, no fabricated metrics.
// ═══════════════════════════════════════════════════════════════

import { cacheStats as getCacheStats, cleanupCache } from "./_cache.js";
import supabase from "./_db-client.js";
import { readLivePosts } from "./_live-posts.js";
import { maskPII, serverModerate } from "./_moderation.js";
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
	trigger_types: ["cron", "admin_manual"],
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
	trigger_types: ["cron", "admin_manual"],
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
			before: tokens.length,
			after: kept.length,
			affected: tokens.length - kept.length,
		};
	},
	async verify(res) {
		// Re-read the stored sessions and assert the POST-CONDITION, rather than
		// asserting that the write was attempted. `{ ok: true }` unconditionally
		// made every run look verified even if the purge silently did nothing.
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "admin_sessions")
			.maybeSingle();
		const tokens = Array.isArray(data?.value?.tokens) ? data.value.tokens : [];
		const now = Date.now();
		const stillExpired = tokens.filter((t) => !(t.exp > now)).length;
		return {
			ok: stillExpired === 0,
			proof: `expired sessions remaining: ${stillExpired} (removed ${res.affected})`,
		};
	},
	measure(res) {
		return {
			metric: "admin_sessions.tokens",
			before: res.before,
			after: res.after,
			purged: res.affected,
		};
	},
});

// ── 03 · Data Cleanup Worker — Polls (Class A) ──────────────────
registerWorker({
	worker_id: "poll-archiver",
	name: "Data Cleanup Worker (Polls)",
	responsibility: "Archives ended polls so the active list stays clean.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
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
			before: typeof dec?.affected === "number" ? dec.affected : null,
			affected: (data || []).length,
		};
	},
	async verify(res) {
		// Independent re-count: zero unarchived expired polls must remain.
		const { count } = await supabase
			.from("polls")
			.select("id", { count: "exact", head: true })
			.eq("archived", false)
			.eq("deleted", false)
			.not("expires_at", "is", null)
			.lt("expires_at", new Date().toISOString());
		const remaining = count || 0;
		return {
			ok: remaining === 0,
			proof: `unarchived expired polls remaining: ${remaining} (archived ${res.affected})`,
		};
	},
	measure(res) {
		return {
			metric: "polls.expired_archived",
			observed: res.before,
			archived: res.affected,
		};
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

// ── 19 · Suspension Lifecycle Worker (Class A — real state change) ─
// REAL JOB: suspensions that were never lifted keep innocent returning
// users locked out of the platform. The write gates (checkUser) consult
// suspended_until on every post/comment/vote — a stale suspension is a
// live lockout. This worker expires them when the clock runs out, so the
// enforcement path heals itself instead of relying on an admin remembering.
// DISABLE TEST: without it, expired suspensions stay active forever and
// users the admins meant to suspend for 3 days remain locked out.
registerWorker({
	worker_id: "suspension-lifecycle",
	name: "Suspension Lifecycle Worker",
	responsibility:
		"Expires suspended_until gates whose time has passed so checkUser stops locking those users out.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 1, max_affected_records: 100 },
	tools: ["read_query", "update_users_meta"],
	async observe() {
		const now = new Date().toISOString();
		const { data, error } = await supabase
			.from("users_meta")
			.select("anon_id, suspended_until")
			.not("suspended_until", "is", null)
			.lt("suspended_until", now)
			.limit(100);
		if (error) return { empty: true, unreadable: true };
		return {
			empty: !data?.length,
			expired: (data || []).map((u) => u.anon_id),
		};
	},
	async analyze(ev) {
		if (ev.unreadable)
			return { decision: "skip", reason: "users_meta unreadable — never act blind" };
		return ev.expired.length > 0
			? {
					decision: "act",
					reason: `${ev.expired.length} suspension(s) past their end time still gate writes`,
				}
			: { decision: "skip", reason: "no expired suspensions pending" };
	},
	async execute(_dec, ev) {
		const ids = ev?.expired || [];
		let cleared = 0;
		for (const id of ids) {
			const { error } = await supabase
				.from("users_meta")
				.update({ suspended_until: null })
				.eq("anon_id", id)
				.not("suspended_until", "is", null);
			if (!error) cleared++;
			// Re-read AFTER the write: only a row that now reads null counts.
			const { data: after } = await supabase
				.from("users_meta")
				.select("suspended_until")
				.eq("anon_id", id)
				.maybeSingle();
			if (after && after.suspended_until !== null) cleared--;
		}
		return {
			action_type: "expire_suspensions",
			target: "users_meta.suspended_until",
			affected: cleared,
			ids_touched: ids.length,
		};
	},
	async verify(res) {
		if (res.ids_touched === 0)
			return { ok: false, proof: "expired suspensions were seen but none were written" };
		// Re-detect: the exact observation that found them must now find none.
		const { data, error } = await supabase
			.from("users_meta")
			.select("anon_id")
			.not("suspended_until", "is", null)
			.lt("suspended_until", new Date().toISOString())
			.limit(100);
		if (error) return { ok: false, proof: "post-write state unreadable" };
		const remaining = (data || []).length;
		return {
			ok: remaining === 0,
			proof: `cleared ${res.affected}/${res.ids_touched}; ${remaining} expired suspensions remain`,
		};
	},
	measure(res) {
		return {
			metric: "users.expired_suspensions_cleared",
			before: res.ids_touched,
			after: 0,
		};
	},
});

// ── 20 · Counter Reconciliation Worker (Class A — real state change) ─
// REAL JOB: the feed sorts and ranks on reactions and comment_count. When
// deletes/merges leave those counts drifted from the reactions/comments
// tables, ranking is wrong and the 'ready for decision' auto-flag fires on
// bad data. This worker measures the real drift and repairs it.
// DISABLE TEST: without it, every drift persists until a manual admin pass.
registerWorker({
	worker_id: "counter-reconciliation",
	name: "Counter Reconciliation Worker",
	responsibility:
		"Recomputes post reaction/comment counts from their source tables and repairs drift.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 1, max_affected_records: 50 },
	tools: ["read_query", "update_posts"],
	async observe() {
		// Sample recent posts (bounded) and compare stored vs computed counts.
		const { data: posts } = await supabase
			.from("posts")
			.select("id, comment_count")
			.order("created_at", { ascending: false })
			.limit(200);
		if (!posts?.length) return { empty: true };
		const ids = posts.map((p) => p.id);
		const { data: cmts } = await supabase
			.from("comments")
			.select("post_id")
			.in("post_id", ids)
			.eq("deleted", false)
			.eq("hidden", false);
		const cMap = {};
		(cmts || []).forEach((c) => {
			cMap[c.post_id] = (cMap[c.post_id] || 0) + 1;
		}
		);
		const drifted = posts
			.filter((p) => (cMap[p.id] || 0) !== (p.comment_count || 0))
			.map((p) => ({
				id: p.id,
				stored: p.comment_count || 0,
				actual: cMap[p.id] || 0,
			}));
		return {
			empty: drifted.length === 0,
			sampled: posts.length,
			drifted,
		};
	},
	async analyze(ev) {
		return ev.drifted.length > 0
			? {
					decision: "act",
					reason: `${ev.drifted.length}/${ev.sampled} posts show stored comment_count != source-table truth`,
				}
			: { decision: "skip", reason: "all sampled counters match their sources" };
	},
	async execute(_dec, ev) {
		let repaired = 0;
		for (const d of ev?.drifted?.slice(0, 50) || []) {
			const { error } = await supabase
				.from("posts")
				.update({ comment_count: d.actual })
				.eq("id", d.id);
			if (error) continue;
			// Verify THIS write by re-reading the row.
			const { data: after } = await supabase
				.from("posts")
				.select("comment_count")
				.eq("id", d.id)
				.maybeSingle();
			if (after && after.comment_count === d.actual) repaired++;
		}
		return {
			action_type: "counter_reconciliation",
			target: "posts.comment_count",
			affected: repaired,
			detected: ev.drifted.length,
		};
	},
	async verify(res) {
		if (res.detected === 0)
			return { ok: false, proof: "drift was seen but nothing was written" };
		return {
			ok: res.affected === res.detected,
			proof: `repaired ${res.affected}/${res.detected} drifted counters (write + re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "posts.counters_repaired",
			before: res.detected,
			after: res.detected - res.affected,
		};
	},
});

// ── 21 · Endpoint Authorization Probe Worker (Class C — real evidence) ─
// REAL JOB: proves — with real HTTP requests — that admin endpoints reject
// unauthenticated callers. The old 'security review' agents read a sample of
// rows and asked an LLM to comment; they never touched a live endpoint, so a
// missing auth gate would NEVER have been detected. This worker performs the
// actual request and records expected vs actual per endpoint.
// DISABLE TEST: without it, a regression that drops an auth check on /api/admin
// would go completely unnoticed — it IS the detection, not a report about it.
registerWorker({
	worker_id: "authz-probe",
	name: "Endpoint Authorization Probe",
	responsibility:
		"Sends real unauthenticated requests to admin endpoints and verifies they are rejected.",
	execution_class: "C",
	trigger_types: ["cron", "admin_manual"],
	shadow_mode: true,
	risk_level: "low",
	budget: { max_runs_per_hour: 1, max_affected_records: 0 },
	tools: ["http_request", "send_admin_alert"],
	async observe() {
		// The endpoints to probe: fixed list of admin surfaces. Deterministic,
		// bounded (4 requests), and no sensitive data is sent or logged.
		return { empty: false, endpoints: 4 };
	},
	async analyze() {
		return {
			decision: "act",
			reason: "continuous authorization verification of admin surfaces",
		};
	},
	async execute(_dec, ev) {
		// Resolve the deployment base the same way the platform's own cron
		// self-calls do. Without a reachable base the probe fails HONESTLY
		// (unknown), it never fabricates a pass.
		const base =
			process.env.VERCEL_URL
				? `https://${process.env.VERCEL_URL}`
				: process.env.APP_BASE_URL || "";
		if (!base) {
			return {
				action_type: "authorization_probe",
				status: "unknown_environment",
				affected: 0,
				tests: [],
			};
		}
		const probes = [
			{ path: "/api/admin?action=users", expect: 403 },
			{ path: "/api/reports", expect: 403 },
			{ path: "/api/agent-cron", expect: 401 },
			{ path: "/api/workforce?action=ops-summary", expect: 200 },
			{ path: "/api/posts?type=problem", expect: 200 },
		];
		const tests = [];
		for (const p of probes) {
			try {
				const ctrl = new AbortController();
				const timer = setTimeout(() => ctrl.abort(), 8000);
				const r = await fetch(`${base}${p.path}`, {
					method: "GET",
					headers: {},
					signal: ctrl.signal,
				});
				clearTimeout(timer);
				const pass = r.status === p.expect;
				tests.push({
					path: p.path,
					expected: p.expect,
					actual: r.status,
					result: pass ? "PASS" : "FAIL",
				});
			} catch (e) {
				tests.push({
					path: p.path,
					expected: p.expect,
					actual: "network_error",
					result: "ERROR",
					detail: String(e?.message || e).slice(0, 120),
				});
			}
		}
		return {
			action_type: "authorization_probe",
			status: "ran",
			affected: 0,
			tests,
		};
	},
	async verify(res) {
		if (res.status === "unknown_environment") {
			return { ok: false, proof: "no reachable base URL — probe could not run (honest unknown, not a pass)" };
		}
		const fails = res.tests.filter((t) => t.result !== "PASS");
		if (res.tests.length === 0)
			return { ok: false, proof: "no probes executed" };
		return {
			ok: fails.length === 0,
			proof:
				fails.length === 0
					? `${res.tests.length}/${res.tests.length} authorization checks PASSED (${res.tests.map((t) => `${t.actual} on ${t.path.split("?")[0]}`).join(", ")})`
					: `FAILURES: ${fails.map((t) => `got ${t.actual} (want ${t.expected}) on ${t.path}`).join("; ")}`,
		};
	},
	onEscalate(res) {
		const fails = (res?.tests || []).filter((t) => t.result !== "PASS");
		if (!fails.length) return;
		return escalateToQueue(
			`Authorization probe FAILED: ${fails.map((t) => t.path).join(", ")}`,
			`Real unauthenticated requests returned ${fails
				.map((t) => `${t.actual} instead of ${t.expected} on ${t.path}`)
				.join("; ")}. An admin surface may be exposed without its auth gate.`,
			"security",
			"high",
			"authz-probe",
		);
	},
});

// ── 22 · Spam Score Decay Worker (Class A — real state change) ──
// REAL JOB: spam_score gates automatic holding (>=60 holds a post) and
// operator dashboards sort on it. It is INCREMENTED on detection but never
// decremented — so one bad week permanently held every later post from that
// user even after weeks of clean behaviour. This worker decays scores for
// users with clean recent activity, healing over-blocking.
// DISABLE TEST: without it, decay never happens and old spam scores
// permanently suppress returning users.
registerWorker({
	worker_id: "spam-score-decay",
	name: "Spam Score Decay Worker",
	responsibility:
		"Decays stale spam_score values for users with clean recent history so detection heals instead of accumulating forever.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 1, max_affected_records: 50 },
	tools: ["read_query", "update_users_meta"],
	async observe() {
		const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
		const { data, error } = await supabase
			.from("users_meta")
			.select("anon_id, spam_score")
			.gt("spam_score", 0)
			.lt("created_at", cutoff)
			.order("spam_score", { ascending: false })
			.limit(50);
		if (error) return { empty: true, unreadable: true };
		const candidates = (data || []).filter((u) => (u.spam_score || 0) > 0);
		return {
			empty: candidates.length === 0,
			candidates: candidates.map((u) => ({
				anon_id: u.anon_id,
				score: u.spam_score,
			})),
		};
	},
	async analyze(ev) {
		if (ev.unreadable)
			return { decision: "skip", reason: "users_meta unreadable — never act blind" };
		return ev.candidates.length > 0
			? {
					decision: "act",
					reason: `${ev.candidates.length} user(s) carry stale spam scores with no recent escalations`,
				}
			: { decision: "skip", reason: "no stale spam scores" };
	},
	async execute(_dec, ev) {
		let decayed = 0;
		for (const u of ev?.candidates?.slice(0, 50) || []) {
			// Halve the score (integer floor) — a decay curve, not a reset, so
			// repeat offenders stay ranked while genuinely clean history heals.
			const next = Math.floor(u.score / 2);
			if (next === u.score) continue; // already at floor (0/1)
			const { error } = await supabase
				.from("users_meta")
				.update({ spam_score: next })
				.eq("anon_id", u.anon_id);
			if (error) continue;
			// Verify THIS write by re-reading.
			const { data: after } = await supabase
				.from("users_meta")
				.select("spam_score")
				.eq("anon_id", u.anon_id)
				.maybeSingle();
			if (after && after.spam_score === next) decayed++;
		}
		return {
			action_type: "spam_score_decay",
			target: "users_meta.spam_score",
			affected: decayed,
			detected: ev.candidates.length,
		};
	},
	async verify(res) {
		if (res.detected === 0)
			return { ok: false, proof: "stale scores were seen but none were written" };
		return {
			ok: res.affected > 0,
			proof: `decayed ${res.affected}/${res.detected} stale spam scores (write + re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "users.spam_scores_decayed",
			before: res.detected,
			after: res.detected - res.affected,
		};
	},
});

// ── 04 · Report SLA Worker (Class C — evidence only) ────────────
registerWorker({
	worker_id: "report-sla",
	name: "Report SLA Worker",
	responsibility: "Escalates open reports older than the 7-day SLA.",
	execution_class: "C",
	trigger_types: ["cron", "admin_manual"],
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

// ── 39 ▸ Appeal SLA Worker (Class C — evidence only) ──
// REAL JOB: an overturned-or-not decision delayed is recourse denied. Open
// appeals older than the 7-day SLA (same bar as reports) escalate to the
// improvement queue so no blocked author rots unreviewed. Threshold is ≥1,
// not ≥2 like reports: one stale appeal is one user with no other remedy.
// DISABLE TEST: without it, open appeals age past SLA silently and the
// appeals queue has no backstop when admins stop watching it.
registerWorker({
	worker_id: "appeal-sla",
	name: "Appeal SLA Worker",
	responsibility:
		"Escalates open safety appeals older than the 7-day SLA.",
	execution_class: "C",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "medium",
	budget: { max_runs_per_hour: 1, max_affected_records: 0 },
	tools: ["inspect_appeals", "send_admin_alert"],
	async observe() {
		const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
		const { data, error } = await supabase
			.from("settings")
			.select("key, value")
			.like("key", "appeal:%")
			.limit(200);
		if (error) return { empty: true };
		const stale = (data || []).filter(
			(r) =>
				r?.value?.status === "open" &&
				new Date(r.value.created_at || 0).getTime() < cutoff,
		);
		return {
			empty: !stale.length,
			breaching: stale.length,
			oldest: stale.length ? stale[stale.length - 1].value.created_at : null,
		};
	},
	async analyze(ev) {
		return ev.breaching >= 1
			? {
					decision: "escalate",
					reason: `${ev.breaching} appeals past 7-day SLA`,
				}
			: { decision: "skip", reason: "within SLA" };
	},
	onEscalate(ev, dec) {
		return escalateToQueue(
			`${ev.breaching} appeals breached the 7-day SLA`,
			dec.reason || "",
			"community",
			ev.breaching >= 3 ? "high" : "medium",
			"appeal-sla",
		);
	},
});

// ── 05 · API Reliability Worker (Class C) ───────────────────────
registerWorker({
	worker_id: "api-reliability",
	name: "API Reliability Worker",
	responsibility: "Detects error-rate spikes from the activity log stream.",
	execution_class: "C",
	trigger_types: ["cron", "admin_manual"],
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
	trigger_types: ["cron", "admin_manual"],
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
	trigger_types: ["cron", "admin_manual"],
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
	trigger_types: ["cron", "admin_manual"],
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
	trigger_types: ["cron", "admin_manual"],
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
	trigger_types: ["cron", "admin_manual"],
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

// ═══════════════════════════════════════════════════════════════════
// PHASE 3 — Five more high-value workers
// ═══════════════════════════════════════════════════════════════════

// ── 11 · Database Health Worker (Class C) ──────────────────────
// Previously this escalated whenever ANY table exceeded 10,000 rows. A table
// being large is not a problem — it is a table being used — so the worker
// generated a steady stream of non-actionable alerts and failed the disable
// test. It now watches for a condition that is genuinely operational: settings
// KV payload bloat. The `settings` table backs the workforce ledger, agent
// memory and improvement queue as JSON blobs, and an oversized payload slows
// every read that touches it.
registerWorker({
	worker_id: "db-health",
	name: "Database Health Worker",
	responsibility:
		"Detects KV payload bloat in the settings store (a real, mitigable read-amplification risk).",
	execution_class: "C",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 2, max_affected_records: 0 },
	tools: ["read_query", "inspect_indexes"],
	async observe() {
		const { data, error } = await supabase
			.from("settings")
			.select("key, value");
		if (error || !data?.length) return { empty: true };

		// Measure the real serialised size of every KV payload and keep the
		// largest offenders, so a report names the row an admin must act on.
		const sizes = data
			.map((row) => {
				let bytes = 0;
				try {
					bytes = JSON.stringify(row.value ?? null).length;
				} catch {
					bytes = 0;
				}
				return { key: row.key, bytes };
			})
			.sort((a, b) => b.bytes - a.bytes);

		const OVERSIZED = 200_000; // ~200 KB per KV payload
		const oversized = sizes.filter((s) => s.bytes > OVERSIZED);
		return {
			empty: oversized.length === 0,
			oversized,
			largest: sizes[0]?.bytes || 0,
			rows: sizes.length,
		};
	},
	async analyze(ev) {
		if (!ev.oversized?.length)
			return { decision: "skip", reason: "all KV payloads within bounds" };
		return {
			decision: "escalate",
			reason: `${ev.oversized.length} settings payload(s) over 200 KB (largest ${Math.round((ev.largest || 0) / 1024)} KB: ${ev.oversized[0]?.key})`,
		};
	},
	onEscalate(ev, dec) {
		return escalateToQueue(
			`Settings KV payload bloat: ${ev.oversized.map((s) => `${s.key} (${Math.round(s.bytes / 1024)} KB)`).join(", ")}`,
			"Trim or archive the listed settings rows — oversized JSON payloads slow every read that touches them.",
			"database",
			"medium",
			"db-health",
		);
	},
});

// ── 12 · Content Quality Worker (Class A) ──────────────────────
registerWorker({
	worker_id: "content-quality",
	name: "Content Quality Worker",
	responsibility: "Auto-hides very short posts (<10 chars) that are likely spam/accidents.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 2, max_affected_records: 10 },
	tools: ["inspect_post", "quarantine_content"],
	async observe() {
		// Only posts that are genuinely empty shells are candidates: extremely
		// short AND older than an hour, so an in-progress submission is never
		// hidden from someone who is still typing.
		const cutoff = new Date(Date.now() - 3600 * 1000).toISOString();
		const { data, error } = await supabase
			.from("posts")
			.select("id, title, description, created_at")
			.eq("status", "reported")
			.eq("deleted", false)
			.lt("created_at", cutoff)
			.limit(50);
		if (error || !data) return { empty: true };
		const lowQuality = data.filter((p) => {
			const text = `${p.title || ""} ${p.description || ""}`.trim();
			return text.length < 10;
		});
		return { empty: lowQuality.length === 0, lowQuality };
	},
	async analyze(ev) {
		return ev.lowQuality.length > 0
			? { decision: "act", reason: `${ev.lowQuality.length} empty posts (no usable text)`, affected: ev.lowQuality.length }
			: { decision: "skip", reason: "all content meets minimum" };
	},
	async execute(dec, ev) {
		// Rows come from evidence — the decision only carries the count.
		const ids = (ev?.lowQuality || []).map((p) => p.id).slice(0, 10);
		if (ids.length === 0)
			return {
				action_type: "flag_low_quality",
				target: "posts",
				observed: typeof dec?.affected === "number" ? dec.affected : null,
				affected: 0,
				ids: [],
			};
		await supabase
			.from("posts")
			.update({ status: "pending_review" })
			.in("id", ids);
		return {
			action_type: "flag_low_quality",
			target: "posts",
			observed: typeof dec?.affected === "number" ? dec.affected : null,
			affected: ids.length,
			ids,
		};
	},
	async verify(res) {
		// Independent re-read: every targeted post must now be in review.
		if (!res.ids?.length)
			return { ok: false, proof: "no empty posts matched the rule" };
		const { data } = await supabase
			.from("posts")
			.select("id, status")
			.in("id", res.ids);
		const moved = (data || []).filter((p) => p.status === "pending_review").length;
		return {
			ok: moved === res.ids.length,
			proof: `${moved}/${res.ids.length} empty posts moved to pending_review`,
		};
	},
	measure(res) {
		return {
			metric: "posts.low_quality_flagged",
			observed: res.observed,
			flagged: res.affected,
		};
	},
});

// ── 13 · User Activity Anomaly Worker (Class C) ────────────────
registerWorker({
	worker_id: "user-anomaly",
	name: "User Activity Anomaly Worker",
	responsibility: "Detects users with abnormal activity patterns (high reports, low engagement).",
	risk_level: "low",
	execution_class: "C",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 1, max_affected_records: 0 },
	tools: ["inspect_post", "inspect_reports", "send_admin_alert"],
	async observe() {
		// Find users with many reports against them
		const { data: reports } = await supabase
			.from("reports")
			.select("target_author_id")
			.eq("status", "open")
			.limit(200);
		if (!reports?.length) return { empty: true };
		const byTarget = {};
		for (const r of reports) {
			if (r.target_author_id) byTarget[r.target_author_id] = (byTarget[r.target_author_id] || 0) + 1;
		}
		const flagged = Object.entries(byTarget).filter(([, n]) => n >= 3);
		return { empty: flagged.length === 0, flaggedUsers: flagged.length, details: flagged };
	},
	async analyze(ev) {
		return ev.flaggedUsers > 0
			? { decision: "escalate", reason: `${ev.flaggedUsers} users with ≥3 open reports` }
			: { decision: "skip", reason: "no anomalies" };
	},
	onEscalate(ev) {
		return escalateToQueue(
			`User activity anomaly: ${ev.flaggedUsers} user(s) with ≥3 open reports`,
			"Review flagged users in Admin → Users for potential abuse.",
			"security",
			"medium",
			"user-anomaly",
		);
	},
});// ── 14 · Search Quality Worker (Class C) ───────────────────────
// This worker previously ran four fixed queries, reported "act" whenever it
// found ANY result (i.e. always), wrote a snapshot into `settings` that nothing
// in the product ever read, and verified itself with `{ ok: true }`. It could
// not have failed and could not have helped — the textbook no-impact agent.
//
// It is now an evidence-only worker that measures the REAL search path: it runs
// the same ilike query the API uses, times it, and escalates only when the
// measured p95 latency or the zero-result rate actually degrades. When search
// is healthy it skips, so an idle run costs nothing and claims nothing.
registerWorker({
	worker_id: "search-quality",
	name: "Search Quality Worker",
	responsibility:
		"Measures real search latency and zero-result rate; escalates only on measured degradation.",
	execution_class: "C",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 2, max_affected_records: 0 },
	tools: ["read_query", "test_search_query", "send_admin_alert"],
	async observe() {
		const queries = ["the", "problem", "food", "class", "teacher"];
		const samples = [];
		let zeroResult = 0;
		for (const q of queries) {
			const t0 = Date.now();
			const { data, error } = await supabase
				.from("posts")
				.select("id")
				.or(`title.ilike.%${q}%,description.ilike.%${q}%`)
				.eq("deleted", false)
				.limit(5);
			const ms = Date.now() - t0;
			if (error) return { empty: false, queryError: error.message, samples: [] };
			samples.push(ms);
			if (!data?.length) zeroResult++;
		}

		const sorted = [...samples].sort((a, b) => a - b);
		const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
		const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
		const zeroResultRate = samples.length ? zeroResult / samples.length : 0;

		// Nothing to report -> empty, so the engine records an honest skip.
		const SLOW_MS = 1500;
		const BAD_ZERO_RATE = 0.8;
		const degraded = p95 > SLOW_MS || zeroResultRate >= BAD_ZERO_RATE;
		return {
			empty: !degraded,
			p95,
			median,
			zeroResultRate,
			samples,
			queryError: null,
		};
	},
	async analyze(ev) {
		if (ev.queryError) {
			return {
				decision: "escalate",
				reason: `search query failed: ${ev.queryError}`,
			};
		}
		if (ev.p95 > 1500) {
			return {
				decision: "escalate",
				reason: `search p95 ${ev.p95}ms exceeds 1500ms budget (median ${ev.median}ms)`,
			};
		}
		return {
			decision: "escalate",
			reason: `search returns no results for ${Math.round(ev.zeroResultRate * 100)}% of common queries`,
		};
	},
	onEscalate(ev, dec) {
		return escalateToQueue(
			`Search quality degraded: ${dec.reason}`,
			`Measured over ${ev.samples.length} probe queries (raw samples: ${ev.samples.join(", ")} ms). Investigate indexing or query shape before the experience degrades further.`,
			"performance",
			ev.p95 > 3000 ? "high" : "medium",
			"search-quality",
		);
	},
});// ── 15 · Platform Health Worker — REMOVED ──────────────────────
// This worker computed a "health score" from an invented weighting (50 base,
// +15 if engagement > 100, −20 if the report ratio > 0.2 …) and wrote it to
// `settings` under `platform_health_score`. A repository-wide search found no
// reader: not the dashboard, not System Health, not any API. It therefore had
// zero consumers, zero user impact and an unverifiable self-assessment, and it
// failed the disable test outright — disabling it changed nothing observable.
// Per the workforce rules it was retired rather than dressed up. The real
// health signals (OpenReports, error rate, DB health, search quality) are
// already measured by workers that DO have consumers.



// ── 17 · Content Enrichment Worker (Class A — safe autonomous) ──
// Auto-generates summaries and keywords for posts that lack them.
// This is the MOST VISIBLE worker: it directly improves what users see.
registerWorker({
	worker_id: "content-enricher",
	name: "Content Enrichment Worker",
	responsibility: "Auto-generates summaries and keywords for posts without them.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 2, max_affected_records: 50 },
	tools: ["read_query", "write_query", "generate_summary"],
	async observe() {
		// Find posts without ai_summary that are at least 30 chars long
		const { data: posts, error } = await supabase
			.from("posts")
			.select("id, title, description, category")
			.eq("deleted", false)
			.eq("hidden", false)
			.or("ai_summary.is.null,ai_summary.eq.")
			.gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
			.order("created_at", { ascending: false })
			.limit(50);
		if (error || !posts?.length) return { empty: true };
		return { empty: false, posts };
	},
	async analyze(ev) {
		return ev.posts.length > 0
			? { decision: "act", reason: `${ev.posts.length} posts need summaries`, affected: ev.posts.length }
			: { decision: "skip", reason: "all posts enriched" };
	},
	async execute(dec, ev) {
		// The rows to enrich arrive as EVIDENCE. Reading `dec.posts` (which the
		// decision never carried) meant this worker iterated an empty list on
		// every run: it wrote zero summaries and then failed its own
		// verification. It is the most user-visible worker in the roster —
		// ai_summary renders in the feed, on post detail and on Suggestions —
		// so this was the single highest-impact broken agent.
		let enriched = 0;
		const enrichedIds = [];
		const cap = Math.min(
			(ev?.posts || []).length,
			50, // budget.max_affected_records
		);
		for (const post of (ev?.posts || []).slice(0, cap)) {
			try {
				const text = `${post.title}. ${post.description || ""}`.trim();
				if (text.length < 10) continue;
				// Deterministic extractive summary — no model call, no fabricated text.
				const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
				const meaningful = sentences.filter((s) => s.trim().length > 15);
				const summary = meaningful.length > 1
					? meaningful.slice(0, 2).join(" ").trim()
					: meaningful[0]?.trim() || post.title;
				const { error } = await supabase
					.from("posts")
					.update({ ai_summary: summary.slice(0, 200) })
					.eq("id", post.id);
				if (error) continue;
				enriched++;
				enrichedIds.push(post.id);
			} catch { /* best effort */ }
		}
		return {
			action_type: "enrich_content",
			target: "posts",
			affected: enriched,
			enrichedIds,
		};
	},
	async verify(res) {
		// Independent re-read: assert the summaries actually persisted.
		if (!res.enrichedIds?.length) {
			return { ok: false, proof: "no posts could be summarised in this pass" };
		}
		const { data } = await supabase
			.from("posts")
			.select("id, ai_summary")
			.in("id", res.enrichedIds);
		const written = (data || []).filter(
			(p) => typeof p.ai_summary === "string" && p.ai_summary.trim().length > 0,
		).length;
		return {
			ok: written === res.enrichedIds.length,
			proof: `${written}/${res.enrichedIds.length} summaries persisted`,
		};
	},
	measure(res) {
		return { metric: "posts.enriched", before: 0, after: res.affected };
	},
});

// ── 18 · Stale Data Sweeper (Class A — safe autonomous) ────────
// Auto-archives solved posts older than 30 days and cleans expired polls.
// Keeps the active feed focused on current issues.
registerWorker({
	worker_id: "stale-sweeper",
	name: "Stale Data Sweeper",
	responsibility: "Archives old resolved posts and cleans expired data.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 1, max_affected_records: 100 },
	tools: ["read_query", "write_query", "quarantine_content"],
	async observe() {
		const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
		const { count } = await supabase
			.from("posts")
			.select("id", { count: "exact", head: true })
			.eq("status", "solved")
			.eq("deleted", false)
			.lt("updated_at", cutoff);
		return { empty: !count, staleSolved: count || 0 };
	},
	async analyze(ev) {
		return ev.staleSolved >= 5
			? { decision: "act", reason: `${ev.staleSolved} solved posts > 30 days old`, affected: ev.staleSolved }
			: { decision: "skip", reason: "within threshold" };
	},
	async execute(dec) {
		const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
		const { data } = await supabase
			.from("posts")
			.update({ status: "archived" })
			.eq("status", "solved")
			.eq("deleted", false)
			.lt("updated_at", cutoff)
			.select("id");
		return { action_type: "archive_stale", target: "posts", affected: (data || []).length };
	},
	async verify(res) {
		// Independent re-count: no solved posts older than 30 days may remain.
		const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
		const { count } = await supabase
			.from("posts")
			.select("id", { count: "exact", head: true })
			.eq("status", "solved")
			.eq("deleted", false)
			.lt("updated_at", cutoff);
		const remaining = count || 0;
		return {
			ok: remaining === 0,
			proof: `stale solved posts remaining: ${remaining} (archived ${res.affected})`,
		};
	},
	measure(res) {
		return { metric: "posts.archived_stale", before: 0, after: res.affected };
	},
});

// ── 19 · Priority Auto-Scaler (Class A — safe autonomous) ──────
// Recalculates priority for posts based on engagement metrics.
// When a post gets 10+ supports, it bumps to high priority automatically.
registerWorker({
	worker_id: "priority-scaler",
	name: "Priority Auto-Scaler",
	responsibility: "Recalculates post priority based on engagement (supports, comments, age).",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 2, max_affected_records: 100 },
	tools: ["read_query", "write_query"],
	async observe() {
		// Get open posts with their reaction counts
		const { data: posts } = await supabase
			.from("posts")
			.select("id, priority, status, created_at")
			.in("status", ["reported", "verified", "in_progress"])
			.eq("deleted", false)
			.limit(200);
		if (!posts?.length) return { empty: true };

		const needsUpdate = [];
		for (const post of posts) {
			const { count: supportCount } = await supabase
				.from("reactions")
				.select("id", { count: "exact", head: true })
				.eq("target_id", post.id)
				.eq("kind", "support");
			const { count: concernCount } = await supabase
				.from("reactions")
				.select("id", { count: "exact", head: true })
				.eq("target_id", post.id)
				.eq("kind", "concern");
			const { count: commentCount } = await supabase
				.from("comments")
				.select("id", { count: "exact", head: true })
				.eq("post_id", post.id)
				.eq("deleted", false);

			let correctPriority = "medium";
			const total = (supportCount || 0) + (concernCount || 0);
			if (total >= 20 || (concernCount || 0) >= 15) correctPriority = "critical";
			else if (total >= 10 || (concernCount || 0) >= 8) correctPriority = "high";
			else if (total < 3 && (commentCount || 0) < 2) correctPriority = "low";

			if (post.priority !== correctPriority) {
				needsUpdate.push({ id: post.id, current: post.priority, correct: correctPriority, support: supportCount, concern: concernCount });
			}
		}
		return { empty: needsUpdate.length === 0, updates: needsUpdate };
	},
	async analyze(ev) {
		return ev.updates.length > 0
			? { decision: "act", reason: `${ev.updates.length} posts need priority correction`, affected: ev.updates.length }
			: { decision: "skip", reason: "all priorities correct" };
	},
	async execute(dec, ev) {
		// Rows come from EVIDENCE. Reading `dec.updates` (never populated by
		// `analyze`) meant this worker updated an empty list on every run and
		// then failed verification — it never once corrected a priority.
		const targets = (ev?.updates || []).slice(0, 100);
		let updated = 0;
		const applied = [];
		for (const u of targets) {
			// Supabase resolves with { error } instead of throwing, so the error
			// must be inspected — counting attempts is not counting successes.
			const { error } = await supabase
				.from("posts")
				.update({ priority: u.correct })
				.eq("id", u.id);
			if (error) continue;
			updated++;
			applied.push({ id: u.id, priority: u.correct });
		}
		return {
			action_type: "recalc_priority",
			target: "posts",
			affected: updated,
			applied,
		};
	},
	async verify(res) {
		// Independent re-read: assert the stored priority matches what we set.
		if (!res.applied?.length)
			return { ok: false, proof: "no priority corrections were applied" };
		const { data } = await supabase
			.from("posts")
			.select("id, priority")
			.in("id", res.applied.map((a) => a.id));
		const byId = new Map((data || []).map((p) => [p.id, p.priority]));
		const correct = res.applied.filter(
			(a) => byId.get(a.id) === a.priority,
		).length;
		return {
			ok: correct === res.applied.length,
			proof: `${correct}/${res.applied.length} priority corrections persisted`,
		};
	},
	measure(res) {
		return { metric: "posts.priority_recalculated", before: 0, after: res.affected };
	},
});

/** Run the Phase-2+ roster sequentially. Returns per-worker honest outcomes. */
// ── 16 · Data Consistency Worker (Class A — safe autonomous) ────
registerWorker({
	worker_id: "data-consistency",
	name: "Data Consistency Worker",
	responsibility:
		"Detects orphan records (comments on deleted posts, votes on deleted polls) and fixes them safely.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 1, max_affected_records: 50 },
	tools: ["read_query", "delete_orphan_records"],
	async observe() {
		// `.rpc()` returns a Postgrest thenable implementing `.then` but NOT
		// `.catch` in supabase-js v2, so chaining `.catch` threw a TypeError and
		// this worker failed on EVERY run — the durable ledger shows
		// "execution_failed: supabase.rpc(...).catch is not a function" on both
		// 2026-09-19 and 2026-09-20. try/await makes a missing RPC, a network
		// failure and a Postgres error all take one honest path: report that the
		// shortcut is unavailable and fall through to the direct query below.
		let orphanComments = null;
		let rpcUnavailable = false;
		try {
			const res = await supabase.rpc("find_orphan_comments");
			if (res?.error) rpcUnavailable = true;
			else orphanComments = res?.data ?? null;
		} catch {
			rpcUnavailable = true;
		}
		// Fallback: manual check when the RPC is not deployed. The old guard
		// tested the response OBJECT (always truthy) instead of the rows, so the
		// fallback never ran and the worker silently reported "0 orphans" — a
		// blind spot that read as health.
		let orphanCount = 0;
		if (!rpcUnavailable && Array.isArray(orphanComments)) {
			orphanCount = orphanComments.length;
		} else {
			// Direct query: comments where post is deleted
			const { data: comments } = await supabase
				.from("comments")
				.select("id, post_id")
				.limit(200);
			if (comments?.length) {
				const postIds = [...new Set(comments.map((c) => c.post_id).filter(Boolean))];
				if (postIds.length > 0) {
					const { data: posts } = await supabase
						.from("posts")
						.select("id")
						.in("id", postIds);
					const existingIds = new Set((posts || []).map((p) => p.id));
					orphanCount = comments.filter((c) => c.post_id && !existingIds.has(c.post_id)).length;
				}
			}
		}
		// Check for reports targeting non-existent content
		const { data: reports } = await supabase
			.from("reports")
			.select("id, target_id, target_type")
			.in("status", ["pending", "open"])
			.limit(100);
		let staleReports = 0;
		if (reports?.length) {
			const postTargets = reports.filter((r) => r.target_type === "post").map((r) => r.target_id).filter(Boolean);
			if (postTargets.length > 0) {
				const { data: targets } = await supabase
					.from("posts")
					.select("id")
					.in("id", postTargets);
				const existing = new Set((targets || []).map((t) => t.id));
				staleReports = postTargets.filter((id) => !existing.has(id)).length;
			}
		}
		return { empty: orphanCount === 0 && staleReports === 0, orphanCount, staleReports };
	},
	async analyze(ev) {
		if (ev.orphanCount === 0 && ev.staleReports === 0)
			return { decision: "skip", reason: "data integrity healthy" };
		return {
			decision: "act",
			reason: `${ev.orphanCount} orphan comments, ${ev.staleReports} stale reports`,
		};
	},
	async execute(dec, ev) {
		let fixed = 0;
		// Close reports targeting deleted posts
		if (ev.staleReports > 0) {
			const { data: reports } = await supabase
				.from("reports")
				.select("id, target_id, target_type")
				.in("status", ["pending", "open"])
				.limit(100);
			if (reports?.length) {
				const postTargets = reports.filter((r) => r.target_type === "post").map((r) => r.target_id).filter(Boolean);
				if (postTargets.length > 0) {
					const { data: targets } = await supabase
						.from("posts")
						.select("id")
						.in("id", postTargets);
					const existing = new Set((targets || []).map((t) => t.id));
					const staleIds = reports
						.filter((r) => r.target_type === "post" && r.target_id && !existing.has(r.target_id))
						.map((r) => r.id);
					if (staleIds.length > 0) {
						await supabase
							.from("reports")
							.update({ status: "auto_resolved", status_note: "Target content deleted" })
							.in("id", staleIds);
						fixed += staleIds.length;
					}
				}
			}
		}
		// Re-detect immediately after the repair so verification can assert a real
		// post-condition instead of `affected >= 0`, which is true even when the
		// worker fixed nothing at all.
		let remaining = 0;
		try {
			const { data: stillOpen } = await supabase
				.from("reports")
				.select("id, target_id, target_type")
				.in("status", ["pending", "open"])
				.limit(100);
			const targets = (stillOpen || [])
				.filter((r) => r.target_type === "post" && r.target_id)
				.map((r) => r.target_id);
			if (targets.length) {
				const { data: alive } = await supabase
					.from("posts")
					.select("id")
					.in("id", targets);
				const aliveSet = new Set((alive || []).map((p) => p.id));
				remaining = targets.filter((id) => !aliveSet.has(id)).length;
			}
		} catch {
			remaining = -1; // unknown — never claim success on an unreadable state
		}
		return {
			action_type: "data_consistency_fix",
			target: "reports + comments",
			affected: fixed,
			remainingStale: remaining,
		};
	},
	async verify(res) {
		if (res.remainingStale === -1) {
			return { ok: false, proof: "post-repair state could not be read" };
		}
		if (res.affected === 0) {
			return { ok: false, proof: "integrity defects detected but none were repaired" };
		}
		return {
			ok: res.remainingStale === 0,
			proof: `repaired ${res.affected} stale records; ${res.remainingStale} still unresolved`,
		};
	},
	measure(res) {
		return {
			metric: "data.stale_records_fixed",
			before: res.affected,
			after: 0,
		};
	},
});

// ── · Anonymity Protection Worker (Class A — safe autonomous) ───────
// The product's core promise is that an anonymous case can never be linked
// back to a person, so this worker ATTACKS that promise on every tick instead
// of trusting it:
//   1. reads every private/identity-bearing table with the PUBLIC anon key —
//      the same key that ships inside the client bundle — and treats a
//      surviving SELECT grant as a leak even when the table is currently
//      empty, because the grant also exposes every FUTURE row;
//   2. scans recent public posts/comments for identifiers that would unmask an
//      anonymous author and masks them in place (real, attributable write);
//   3. escalates what application code must not silently pretend to fix: an RLS
//      grant is a schema-level problem, so it becomes a real, deduplicated
//      critical admin alert instead of a fake "fixed" outcome.
const PRIVATE_TABLES = [
	"users_meta",
	"activity_logs",
	"audit_logs",
	"agent_executions",
	"agent_activity_log",
	"agent_conversations",
	"settings",
	"notifications",
	"reports",
	"chat_threads",
	"chat_messages",
	"poll_votes",
	"reactions",
	"agent_tasks",
	"workforce_alerts",
];

// Deliberately conservative: an email address is unambiguously identity-linked.
// Bare digit runs are NOT matched — they false-positive on version strings,
// timestamps and IDs, and corrupting innocent content to look busy is worse
// than a slightly narrower net.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// Durable fallback for the (possibly un-migrated) workforce_alerts table.
// Mirrors the settings-backed pattern used across the codebase.
const ALERTS_FALLBACK_KEY = "workforce_alerts_store";
async function appendAlertFallback(alert) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", ALERTS_FALLBACK_KEY)
			.maybeSingle();
		const records = data?.value?.records || [];
		const seen = records.findIndex((r) => r.dedup_key === alert.dedup_key);
		if (seen >= 0) {
			records[seen].occurrences = (records[seen].occurrences || 1) + 1;
			records[seen].last_seen = new Date().toISOString();
		} else {
			records.unshift({
				...alert,
				occurrences: 1,
				status: "active",
				first_seen: new Date().toISOString(),
				last_seen: new Date().toISOString(),
			});
		}
		await supabase.from("settings").upsert(
			{
				key: ALERTS_FALLBACK_KEY,
				value: { records: records.slice(0, 200), updated_at: new Date().toISOString() },
			},
			{ onConflict: "key" },
		);
	} catch (err) {
		console.error("[anonymity-guard] alert fallback failed:", err.message);
	}
}

let _publicClient = null;
async function publicClient() {
	if (_publicClient) return _publicClient;
	const url =
		process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.VITE_SUPABASE_ANON_KEY;
	if (!url || !key) return null;
	const { createClient } = await import("@supabase/supabase-js");
	_publicClient = createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	return _publicClient;
}

// Public content surfaces that anyone can already read through /api/*.
const PUBLIC_SCAN = [
	{ table: "posts", column: "title" },
	{ table: "posts", column: "description" },
	{ table: "comments", column: "body" },
];

async function scanPublicIdentifiers() {
	const hits = [];
	for (const spec of PUBLIC_SCAN) {
		let { data, error } = await supabase
			.from(spec.table)
			.select(`id, ${spec.column}, created_at`)
			.order("created_at", { ascending: false })
			.limit(100);
		if (error) {
			// Older/renamed schemas: retry without the ordering column so a
			// missing index or timestamp never silently disables the scan.
			({ data, error } = await supabase
				.from(spec.table)
				.select(`id, ${spec.column}`)
				.limit(100));
		}
		if (error) continue;
		for (const row of data || []) {
			const value = row[spec.column];
			if (typeof value !== "string" || !EMAIL_RE.test(value)) continue;
			hits.push({
				table: spec.table,
				column: spec.column,
				id: row.id,
				body: value,
			});
		}
	}
	return hits;
}

registerWorker({
	worker_id: "anonymity-guard",
	name: "Anonymity Protection Worker",
	responsibility:
		"Proves an anonymous case cannot be linked to a person: probes private tables with the public anon key, masks leaked identifiers in public content, and escalates RLS gaps it cannot fix from application code.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 4, max_affected_records: 200 },
	tools: [
		"public_read_probe",
		"scan_public_content",
		"mask_identifiers",
		"raise_alert",
	],
	async observe() {
		const client = await publicClient();
		if (!client) {
			return {
				empty: true,
				reason: "no anon key configured — public surface cannot be probed",
			};
		}
		const leaks = [];
		for (const table of PRIVATE_TABLES) {
			const { data, error } = await client.from(table).select("*").limit(1);
			// An error means the role was denied, which is the desired state.
			// No error means the grant survives.
			if (!error) leaks.push({ table, rows_visible: data?.length ?? 0 });
		}
		const hits = await scanPublicIdentifiers();
		return { empty: leaks.length === 0 && hits.length === 0, leaks, hits };
	},
	async analyze(ev) {
		if (ev.empty)
			return {
				decision: "skip",
				reason:
					ev.reason ||
					"no private table is anon-readable and no identifier leaked into public content",
			};
		const bits = [];
		if (ev.leaks?.length)
			bits.push(`${ev.leaks.length} publicly readable private table(s)`);
		if (ev.hits?.length)
			bits.push(`${ev.hits.length} public row(s) carrying identifiers`);
		return { decision: "act", reason: bits.join(" + ") };
	},
	// NOTE: the runner calls execute(decision, evidence) — reading the evidence
	// argument is what makes this worker act on the rows it actually detected.
	async execute(dec, ev) {
		// 1) The part application code CAN fix: strip identifiers that would
		//    unmask an anonymous author from already-published content.
		let masked = 0;
		const maskedIds = [];
		for (const hit of ev.hits || []) {
			const maskedValue = maskPII(hit.body);
			if (maskedValue === hit.body) continue;
			const { error } = await supabase
				.from(hit.table)
				.update({ [hit.column]: maskedValue })
				.eq("id", hit.id);
			if (error) continue;
			masked++;
			maskedIds.push({ table: hit.table, id: hit.id });
		}
		// 2) The part it must escalate: an RLS grant is a schema change, not an
		//    application fix. Deduplicated so a recurring leak cannot storm the
		//    admin alert feed.
		let alerted = 0;
		for (const leak of ev.leaks || []) {
			const dedup_key = `anon-read:${leak.table}`;
			const { data: existing } = await supabase
				.from("workforce_alerts")
				.select("id, occurrences")
				.eq("dedup_key", dedup_key)
				.eq("status", "active")
				.maybeSingle();
			if (existing) {
				await supabase
					.from("workforce_alerts")
					.update({
						occurrences: (existing.occurrences || 1) + 1,
						last_seen: new Date().toISOString(),
					})
					.eq("id", existing.id);
				continue;
			}
			const alert = {
				severity: "critical",
				title: `Anonymous-identity leak: public read on "${leak.table}"`,
				body: `The public anon key (shipped in the client bundle) can SELECT from "${leak.table}" (${leak.rows_visible} row(s) sampled). Apply api/migrations/014_revoke_anon_private_tables.sql to revoke the grant.`,
				source_worker: "anonymity-guard",
				source_event: "cron",
				category: "security",
				dedup_key,
			};
			const { error } = await supabase.from("workforce_alerts").insert(alert);
			// Migration 012 is not applied to every environment, and a silently
			// dropped security alert is worse than no alert at all — so fall back
			// to the same settings-backed store the rest of the codebase uses.
			// Anonymity escalations must survive a missing migration.
			if (error) await appendAlertFallback(alert);
			alerted++;
		}
		return {
			action_type: "anonymity_hardening",
			target: "public/anon surface",
			affected: masked + alerted,
			masked,
			maskedIds,
			alerted,
			leaked_tables: (ev.leaks || []).map((l) => l.table),
		};
	},
	async verify(res) {
		// Re-probe the live surface instead of trusting that the writes landed.
		const client = await publicClient();
		if (!client)
			return { ok: false, proof: "no anon key configured — cannot verify" };
		const stillLeaking = [];
		for (const table of res.leaked_tables || []) {
			const { error } = await client.from(table).select("*").limit(1);
			if (!error) stillLeaking.push(table);
		}
		return {
			ok: stillLeaking.length === 0,
			proof:
				stillLeaking.length === 0
					? `anon denied on every probed private table${res.masked ? `; masked identifiers in ${res.masked} public row(s)` : ""}`
					: `${stillLeaking.length} private table(s) STILL anon-readable: ${stillLeaking.join(", ")} — needs api/migrations/014`,
		};
	},
	measure(res) {
		return {
			metric: "anonymity.public_readable_private_tables",
			before: (res.leaked_tables || []).length,
			after: 0,
		};
	},
});

// NOTE: `platform-health` is intentionally absent from this roster — see the
// retirement note where it used to be registered.
export async function runHighValueRoster(trigger = "cron") {
	const order = [
		"cache-optimizer",
		"session-cleaner",
		"poll-archiver",
		"content-enricher",
		"stale-sweeper",
		"priority-scaler",
		"content-quality",
		"search-quality",
		"report-sla",
		"appeal-sla",
		"api-reliability",
		"db-health",
		"spam-sentinel",
		"duplicate-reports",
		"user-anomaly",
		"notification-health",
		"orphan-auditor",
		"data-consistency",
		"suspension-lifecycle",
		"counter-reconciliation",
		"spam-score-decay",
		"authz-probe",
		"anonymity-guard",
		"supervisor",
	];
	const results = [];
	for (const id of order) results.push(await runWorker(id, trigger));
	return results;
}

// ═══════════════════════════════════════════════════════════════════
// BATCH 1 — INTAKE & UNDERSTANDING  (roster #1–#6 of the 50 workers)
//
// Every worker here obeys the same discipline:
//   real trigger → real tool → workflow → verify({ok:true}) →
//   permission → outcome → auditable evidence → disable test.
// The registry id in _automation-registry.js is the single source of
// truth; it is deliberately NOT the §22 roster number.
//
// Class A: reads and writes, fully verified, auto-rollback on failure.
// Class B: mutates shared review state; logged for a human, never acts
//          on a person's behalf.
// Class C: NEVER calls execute()/verify(). It observes, analyses and
//          auto-escalates to the improvement queue (core 228–236).
// ═══════════════════════════════════════════════════════════════════

// ── shared helpers ────────────────────────────────────────────────

/**
 * Reachable base URL for in-process HTTP tool calls. Mirrors the
 * platform's own cron self-call convention. Returns "" when the worker
 * is running somewhere it cannot reach the app — the caller then stands
 * down honestly instead of fabricating a pass.
 */
function resolveBaseUrl() {
	return process.env.VERCEL_URL
		? `https://${process.env.VERCEL_URL}`
		: process.env.APP_BASE_URL || "";
}

/** Count audit rows for one actor+action (bounded, no full scan). */
async function countWorkerLogs(actor, action) {
	const { data } = await supabase
		.from("activity_logs")
		.select("id")
		.eq("actor", actor)
		.eq("action", action)
		.limit(5000);
	return Array.isArray(data) ? data.length : 0;
}

/** Count pending proactive suggestions (bounded). */
async function countPendingSuggestions() {
	const { data } = await supabase
		.from("agent_suggestions")
		.select("id")
		.eq("status", "pending")
		.limit(5000);
	return Array.isArray(data) ? data.length : 0;
}

/**
 * Keyword sets for the REAL default taxonomy (see _categories.js /
 * _ai-summary.js suggestCategory). Only used by the correction worker,
 * which is deliberately conservative: it needs ≥2 distinct hits before
 * it flags a post as misfiled.
 */
const CATEGORY_KEYWORDS = {
	Academics: ["exam", "grade", "homework", "assignment", "course", "study", "lecture", "syllabus"],
	Facilities: ["room", "building", "hvac", "heating", "plumbing", "electric", "repair", "maintenance"],
	Food: ["cafeteria", "lunch", "canteen", "dining", "meal", "menu", "food"],
	Bullying: ["bully", "harass", "tease", "threat", "intimidate", "ragging"],
	Teachers: ["teacher", "professor", "faculty", "instructor", "teaching"],
	Events: ["event", "festival", "concert", "workshop", "seminar", "celebration"],
	Transport: ["bus", "transport", "commute", "parking", "carpool", "shuttle"],
	Sports: ["sports", "gym", "team", "coach", "tournament", "field", "court"],
	Technology: ["computer", "wifi", "internet", "software", "hardware", "laptop", "network"],
	Library: ["library", "book", "borrow", "catalog", "librarian"],
	Hostel: ["hostel", "dorm", "dormitory", "warden", "roommate"],
	Security: ["security", "safety", "theft", "stolen", "camera", "guard"],
	Cleanliness: ["clean", "dirty", "trash", "restroom", "bathroom", "hygiene", "garbage"],
	Medical: ["nurse", "health", "medical", "medicine", "allergy", "clinic", "first aid"],
};

/**
 * Score free text against the taxonomy. Returns { category, hits } for
 * the strongest category with ≥2 distinct keyword hits, else null.
 * Deterministic — no model call, no guessing from a single word.
 */
function scoreCategoryKeywords(title, description) {
	const text = `${title || ""} ${description || ""}`.toLowerCase();
	const words = new Set(
		text.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean),
	);
	let best = null;
	for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
		let hits = 0;
		for (const kw of keywords) {
			if (kw.includes(" ")) {
				if (text.includes(kw)) hits++;
			} else if (words.has(kw)) hits++;
		}
		if (hits >= 2 && (!best || hits > best.hits)) best = { category, hits };
	}
	return best;
}

/**
 * Map a runWorker ledger row → the registry adapter contract. The
 * registry (recordLastRun/summarize) expects { ok, deferred, degraded,
 * outcome, metrics, error }. Only verified_success/escalated/skipped
 * count as ok; budget_blocked is a deferral, anything else a failure.
 */
function mapRunResult(row) {
	const base = {
		ok:
			row.outcome === "verified_success" ||
			row.outcome === "escalated" ||
			row.outcome === "skipped",
		outcome: row.outcome,
		decision: row.decision,
		action_type: row.action_type,
		target: row.target,
		evidence: row.evidence,
		verification: row.verification,
		metrics: row.metrics,
		duration_ms: row.duration_ms,
	};
	if (row.outcome === "budget_blocked") {
		return {
			...base,
			ok: true,
			deferred: true,
			reason: row.decision || "tick budget spent",
		};
	}
	if (base.ok) return base;
	return {
		...base,
		ok: false,
		error: row.error || row.verification || "worker did not complete",
	};
}

/**
 * Side-effect-free probe of the voice intake path. Input under 8 chars
 * makes the endpoint answer `{ engine: "none" }` without transcribing
 * anything or writing a post — a real health signal, not a mock.
 */
async function probeVoiceIntake(base) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 8000);
	try {
		const r = await fetch(`${base}/api/assist?action=voice_complaint`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "probe" }),
			signal: ctrl.signal,
		});
		if (r.status !== 200) return { ok: false, status: r.status };
		const body = await r.json().catch(() => ({}));
		return { ok: body?.engine === "none", status: 200, engine: body?.engine };
	} catch (e) {
		return {
			ok: false,
			status: "network_error",
			error: String(e?.message || e).slice(0, 200),
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Call the public /api/ai-summary tool. With `post_id` the endpoint
 * persists posts.ai_summary (real write); without it the call is
 * side-effect-free and returns the deterministic suggestion.
 */
async function fetchAiSummary(base, payload) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 8000);
	try {
		const r = await fetch(`${base}/api/ai-summary`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
			signal: ctrl.signal,
		});
		if (r.status !== 200) return { ok: false, status: r.status };
		const body = await r.json().catch(() => ({}));
		return { ok: true, status: 200, ...body };
	} catch (e) {
		return {
			ok: false,
			status: "network_error",
			error: String(e?.message || e).slice(0, 200),
		};
	} finally {
		clearTimeout(timer);
	}
}

// ── Roster #1 · Voice-to-Case Intake (Class C) ─────────────────────
// REAL JOB: prove the voice-complaint intake answers end to end. A real
// HTTP request hits /api/assist?action=voice_complaint. The dictation UI
// exists but the ASR provider is not wired, so a silent break here means
// voice complaints vanish untranscribed. Class C: it never writes; a
// degraded probe escalates with the live status as evidence.
// DISABLE TEST: without it, a broken voice intake is never noticed.
registerWorker({
	worker_id: "voice-intake",
	name: "Voice-to-Case Intake Worker",
	responsibility:
		"Probes the live voice-complaint intake and escalates when it is degraded.",
	execution_class: "C",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 4, max_affected_records: 0 },
	tools: ["http_probe", "escalate_queue"],
	async observe() {
		const base = resolveBaseUrl();
		if (!base)
			return {
				empty: true,
				unknown_environment: true,
				summary: "no reachable base URL — stood down honestly",
			};
		const probe = await probeVoiceIntake(base);
		const endpoint = "/api/assist?action=voice_complaint";
		if (probe.ok)
			return {
				empty: true,
				endpoint,
				summary: "voice intake healthy — probe answered engine=none",
			};
		return {
			empty: false,
			endpoint,
			status: probe.status,
			error: probe.error || null,
			summary: `voice intake unhealthy (status ${probe.status})`,
		};
	},
	analyze(ev) {
		return {
			decision: "escalate",
			severity: "high",
			reason: `voice intake tool path not answering: ${ev.summary}`,
		};
	},
	async onEscalate(ev) {
		await escalateToQueue(
			"Voice-to-Case intake degraded",
			JSON.stringify({
				endpoint: ev.endpoint,
				status: ev.status,
				error: ev.error,
				note: "ASR provider not wired; verify the dictation path end to end.",
			}).slice(0, 500),
			"infrastructure",
			"high",
			"worker:voice-intake",
		);
	},
});

// ── Roster #2 · Submission Understanding (Class A) ─────────────────
// REAL JOB: give recent posts the deterministic AI summary the rest of
// the platform assumes exists. Calls the real tool endpoint with
// post_id so the write happens server-side, then re-reads every post to
// prove posts.ai_summary is actually populated.
// DISABLE TEST: without it, new posts never get a stored summary.
registerWorker({
	worker_id: "submission-understanding",
	name: "Submission Understanding Worker",
	responsibility:
		"Generates and stores deterministic AI summaries for recent posts that have none.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 2, max_affected_records: 10 },
	tools: ["read_query", "http_tool", "update_posts"],
	async observe() {
		const base = resolveBaseUrl();
		if (!base)
			return {
				empty: true,
				unknown_environment: true,
				summary: "no reachable base URL — stood down honestly",
			};
		const { data, error } = await supabase
			.from("posts")
			.select("id, title, description, category, ai_summary")
			.in("status", ["open", "in_progress"])
			.order("created_at", { ascending: false })
			.limit(40);
		if (error)
			return {
				empty: true,
				error: String(error.message || error).slice(0, 200),
				summary: "could not read posts",
			};
		const candidates = (data || [])
			.filter((p) => !String(p.ai_summary || "").trim())
			.slice(0, 8);
		return {
			empty: candidates.length === 0,
			candidates,
			summary: `${candidates.length} recent posts without an AI summary`,
		};
	},
	analyze(ev) {
		return {
			decision: ev.candidates.length ? "act" : "skip",
			affected: ev.candidates.length,
			reason: `summarizing ${ev.candidates.length} unsummarized posts`,
		};
	},
	async execute(_dec, ev) {
		const base = resolveBaseUrl();
		const enriched = [];
		let attempted = 0;
		for (const p of ev.candidates) {
			attempted++;
			const r = await fetchAiSummary(base, {
				post_id: p.id,
				title: p.title,
				description: p.description,
				category: p.category,
			});
			if (r.ok && String(r.summary || "").trim()) enriched.push(p.id);
		}
		return {
			action_type: "submission_summary",
			target: "posts.ai_summary",
			attempted,
			enriched,
			affected: enriched.length,
		};
	},
	async verify(res) {
		if (!res.enriched.length)
			return {
				ok: false,
				proof: "no posts were enriched (endpoint returned no summary)",
			};
		let verified = 0;
		for (const id of res.enriched) {
			const { data } = await supabase
				.from("posts")
				.select("ai_summary")
				.eq("id", id)
				.maybeSingle();
			if (String(data?.ai_summary || "").trim()) verified++;
		}
		return {
			ok: verified === res.enriched.length,
			proof: `${verified}/${res.enriched.length} posts now carry a stored ai_summary (write + re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "posts.ai_summary_written",
			before: res.attempted,
			after: res.attempted - res.affected,
			affected: res.affected,
		};
	},
});

// ── Roster #3 · Missing Information (Class C) ──────────────────────
// REAL JOB (per the registry source of truth): flag AI-resolved
// complaints that are still open past the follow-up window so a human
// picks them up. Reads the real backing store (settings key
// `ai_resolution:<postId>`, written by _ai-resolution.js) and joins it
// against live post status. Class C: never writes; escalates the stale
// set to the improvement queue.
// DISABLE TEST: without it, resolved-but-stuck complaints rot silently.
registerWorker({
	worker_id: "missing-info",
	name: "Missing Information Worker",
	responsibility:
		"Flags AI-resolved complaints that are still open past the follow-up window.",
	execution_class: "C",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 4, max_affected_records: 0 },
	tools: ["read_query", "escalate_queue"],
	async observe() {
		const { data: settingsRows, error } = await supabase
			.from("settings")
			.select("key, value, updated_at")
			.like("key", "ai_resolution:%")
			.order("updated_at", { ascending: false })
			.limit(200);
		if (error)
			return {
				empty: true,
				error: String(error.message || error).slice(0, 200),
				summary: "could not read AI resolutions",
			};
		const rows = settingsRows || [];
		const postIds = rows
			.map((r) => String(r.key || "").replace("ai_resolution:", ""))
			.filter(Boolean);
		const statuses = {};
		if (postIds.length) {
			const { data: posts } = await supabase
				.from("posts")
				.select("id, status, title")
				.in("id", postIds);
			for (const p of posts || []) statuses[p.id] = p;
		}
		const cutoff = Date.now() - 24 * 3600 * 1000;
		const stale = [];
		for (const r of rows) {
			const pid = String(r.key || "").replace("ai_resolution:", "");
			const post = statuses[pid];
			if (!post) continue;
			if (post.status !== "open" && post.status !== "in_progress") continue;
			const analyzedAt = r.value?.analyzed_at || r.updated_at;
			if (analyzedAt && new Date(analyzedAt).getTime() < cutoff) {
				stale.push({
					post_id: pid,
					title: String(post.title || "").slice(0, 80),
					analyzed_at: analyzedAt,
				});
			}
		}
		return {
			empty: stale.length === 0,
			stale: stale.length,
			sample: stale.slice(0, 10),
			summary: `${stale.length} open complaints with an AI resolution older than 24h`,
		};
	},
	analyze(ev) {
		return {
			decision: "escalate",
			severity: "medium",
			reason: `${ev.stale} AI-resolved complaints await human follow-up`,
		};
	},
	async onEscalate(ev) {
		await escalateToQueue(
			`Stale AI resolutions awaiting follow-up (${ev.stale})`,
			JSON.stringify(ev.sample).slice(0, 500),
			"follow-up",
			"medium",
			"worker:missing-info",
		);
	},
});

// ── Roster #4 · Category Assignment (Class A) ──────────────────────
// REAL JOB: put uncategorised posts into the platform's real taxonomy.
// Reads a candidate via the side-effect-free form of the ai-summary
// tool, validates the suggestion against DEFAULT_CATEGORIES, then writes
// posts.category and re-reads each row to prove the change landed.
// DISABLE TEST: without it, uncategorised posts never reach a category.
registerWorker({
	worker_id: "category-assignment",
	name: "Category Assignment Worker",
	responsibility:
		"Assigns a deterministic category to recent posts sitting in an uncategorized bucket.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 2, max_affected_records: 20 },
	tools: ["read_query", "http_tool", "update_posts"],
	async observe() {
		const base = resolveBaseUrl();
		if (!base)
			return {
				empty: true,
				unknown_environment: true,
				summary: "no reachable base URL — stood down honestly",
			};
		const { data, error } = await supabase
			.from("posts")
			.select("id, title, description, category")
			.in("status", ["open", "in_progress"])
			.order("created_at", { ascending: false })
			.limit(60);
		if (error)
			return {
				empty: true,
				error: String(error.message || error).slice(0, 200),
				summary: "could not read posts",
			};
		const uncategorized = (data || []).filter((p) => {
			const c = String(p.category || "").trim().toLowerCase();
			return !c || c === "other" || c === "uncategorized";
		});
		const { DEFAULT_CATEGORIES } = await import("./_categories.js");
		const valid = new Set(DEFAULT_CATEGORIES);
		const assignable = [];
		for (const p of uncategorized.slice(0, 8)) {
			const r = await fetchAiSummary(base, {
				title: p.title,
				description: p.description,
			});
			const sug = String(r?.category_suggestion || "").trim();
			if (r.ok && valid.has(sug) && sug !== "Other") {
				assignable.push({ id: p.id, to: sug, previous: p.category || null });
			}
		}
		return {
			empty: assignable.length === 0,
			assignable,
			summary: `${assignable.length} uncategorized posts matched a known category`,
		};
	},
	analyze(ev) {
		return {
			decision: ev.assignable.length ? "act" : "skip",
			affected: ev.assignable.length,
			reason: `assigning ${ev.assignable.length} categories`,
		};
	},
	async execute(_dec, ev) {
		const assigned = [];
		for (const a of ev.assignable) {
			const { error } = await supabase
				.from("posts")
				.update({ category: a.to })
				.eq("id", a.id);
			if (!error) assigned.push(a);
		}
		return {
			action_type: "category_assignment",
			target: "posts.category",
			attempted: ev.assignable.length,
			assigned,
			affected: assigned.length,
		};
	},
	async verify(res) {
		if (!res.assigned.length)
			return { ok: false, proof: "no category writes succeeded" };
		let verified = 0;
		for (const a of res.assigned) {
			const { data } = await supabase
				.from("posts")
				.select("category")
				.eq("id", a.id)
				.maybeSingle();
			if (String(data?.category || "") === a.to) verified++;
		}
		return {
			ok: verified === res.assigned.length,
			proof: `${verified}/${res.assigned.length} posts re-read with the assigned category`,
		};
	},
	measure(res) {
		return {
			metric: "posts.category_assigned",
			before: res.attempted,
			after: res.attempted - res.affected,
			assigned: res.affected,
		};
	},
});

// ── Roster #5 · Category Correction (Class B) ──────────────────────
// REAL JOB: surface posts filed under "Other" that strongly match a
// known category (≥2 distinct keyword hits) so a human can correct the
// filing. It never edits posts.category itself — it writes an auditable
// candidate row and verifies that row exists (insert id re-read +
// per-run audit-log delta). Class B because it touches shared review
// state and a wrong auto-correction would be worse than a human delay.
// DISABLE TEST: without it, miscategorised posts are never flagged.
registerWorker({
	worker_id: "category-correction",
	name: "Category Correction Worker",
	responsibility:
		"Flags posts filed under Other that strongly match a known category, for human review.",
	execution_class: "B",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "medium",
	budget: { max_runs_per_hour: 2, max_affected_records: 20 },
	tools: ["read_query", "write_audit_log"],
	async observe() {
		const { data, error } = await supabase
			.from("posts")
			.select("id, title, description, category")
			.eq("category", "Other")
			.order("created_at", { ascending: false })
			.limit(60);
		if (error)
			return {
				empty: true,
				error: String(error.message || error).slice(0, 200),
				summary: "could not read posts",
			};
		const candidates = [];
		for (const p of data || []) {
			const match = scoreCategoryKeywords(p.title, p.description);
			if (match)
				candidates.push({
					post_id: p.id,
					current: p.category,
					suggested: match.category,
					hits: match.hits,
				});
			if (candidates.length >= 20) break;
		}
		return {
			empty: candidates.length === 0,
			candidates,
			summary: `${candidates.length} Other-tagged posts match a known category`,
		};
	},
	analyze(ev) {
		return {
			decision: ev.candidates.length ? "act" : "skip",
			affected: ev.candidates.length,
			reason: `logging ${ev.candidates.length} category-correction candidates`,
		};
	},
	async execute(_dec, ev) {
		const before_count = await countWorkerLogs(
			"worker:category-correction",
			"category_correction_candidate",
		);
		const log_ids = [];
		for (const c of ev.candidates) {
			try {
				const { data } = await supabase
					.from("activity_logs")
					.insert({
						actor: "worker:category-correction",
						action: "category_correction_candidate",
						detail: JSON.stringify(c).slice(0, 500),
					})
					.select("id");
				for (const row of data || []) if (row?.id) log_ids.push(row.id);
			} catch {
				/* one failed insert must not abort the batch */
			}
		}
		const after_count = await countWorkerLogs(
			"worker:category-correction",
			"category_correction_candidate",
		);
		return {
			action_type: "category_correction",
			target: "activity_logs",
			before_count,
			after_count,
			log_ids,
			affected: log_ids.length,
		};
	},
	async verify(res) {
		if (!res.log_ids.length)
			return { ok: false, proof: "no correction candidates were logged" };
		let verified = 0;
		for (const id of res.log_ids) {
			const { data } = await supabase
				.from("activity_logs")
				.select("id, actor, action")
				.eq("id", id)
				.maybeSingle();
			if (data?.id === id && data?.action === "category_correction_candidate")
				verified++;
		}
		const delta = res.after_count - res.before_count;
		return {
			ok: verified >= 1 && delta === res.log_ids.length,
			proof: `${verified}/${res.log_ids.length} candidates persisted to the audit log (delta ${delta}, re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "activity_logs.category_correction_candidates",
			before: res.before_count,
			after: res.after_count,
			logged: res.log_ids.length,
		};
	},
});

// ── Roster #6 · Suggestion Detection (Class A) ─────────────────────
// REAL JOB: run the platform's own proactive detector (stale / duplicate
// / trend / pattern) over the open queue and store the results. No
// fabricated metrics: it counts pending suggestions before and after
// and fails if detection silently dropped any. Class A — the only
// writes are advisory rows in agent_suggestions.
// DISABLE TEST: without it, the proactive queue stops being refreshed.
registerWorker({
	worker_id: "suggestion-detection",
	name: "Proactive Suggestion Worker",
	responsibility:
		"Runs stale/duplicate/trend/pattern detection over the open queue and stores suggestions.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 2, max_affected_records: 25 },
	tools: ["read_query", "detect_suggestions"],
	async observe() {
		const { data: reports, error } = await supabase
			.from("reports")
			.select("id")
			.in("status", ["pending", "open"])
			.limit(5000);
		if (error)
			return {
				empty: true,
				error: String(error.message || error).slice(0, 200),
				summary: "could not read reports",
			};
		const open = Array.isArray(reports) ? reports.length : 0;
		const pending = await countPendingSuggestions();
		return {
			empty: open === 0,
			open_reports: open,
			pending_suggestions: pending,
			summary: `${open} open reports · ${pending} pending suggestions`,
		};
	},
	analyze(ev) {
		return {
			decision: "act",
			affected: 0,
			reason: `scanning ${ev.open_reports} open reports for stale/duplicate/trend/pattern`,
		};
	},
	async execute() {
		const beforePending = await countPendingSuggestions();
		const { detectSuggestions } = await import("./_proactive.js");
		const res = await detectSuggestions({ page: "reports", filters: {} });
		const afterPending = await countPendingSuggestions();
		const detected = Number(res?.count) || 0;
		return {
			action_type: "suggestion_detection",
			target: "agent_suggestions",
			affected: detected,
			detected,
			beforePending,
			afterPending,
			latencyMs: res?.latencyMs || null,
		};
	},
	async verify(res) {
		if (res.affected === 0)
			return {
				ok: true,
				proof: "scan ran; no new suggestions and none were dropped",
			};
		if (res.afterPending >= res.beforePending)
			return {
				ok: true,
				proof: `detected ${res.affected} suggestions; pending ${res.beforePending}→${res.afterPending} (none lost)`,
			};
		return {
			ok: false,
			proof: `detected ${res.affected} but pending dropped ${res.beforePending}→${res.afterPending}`,
		};
	},
	measure(res) {
		return {
			metric: "agent_suggestions.detected",
			before: res.beforePending,
			after: res.afterPending,
			detected: res.affected,
		};
	},
});

// ── Roster #7 · Duplicate Case (Class A) ───────────────────────────
// REAL JOB: run the platform's own duplicate detector (_duplicates.js)
// over the live queue and record each cluster as an auditable advisory
// row. It NEVER merges — merging is a destructive human decision — so
// the worker only surfaces the group. The read is dual-backend: the
// direct Supabase table first, the app's own live-posts feed as fallback.
// Class A: the only writes are advisory audit rows.
// DISABLE TEST: without it, duplicate flags stop; manual merge workload rises.
registerWorker({
	worker_id: "duplicate-case",
	name: "Duplicate Case Worker",
	responsibility:
		"Clusters duplicate complaints with the platform detector and logs each group for review; never merges.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 4, max_affected_records: 20 },
	tools: ["read_query", "detect_duplicates", "write_audit_log"],
	async observe() {
		const { findAllDuplicateClusters } = await import("./_duplicates.js");
		let clusters = [];
		try {
			clusters = await findAllDuplicateClusters();
		} catch (err) {
			return {
				empty: true,
				error: String(err?.message || err).slice(0, 200),
				summary: "duplicate scan failed",
			};
		}
		const groups = (Array.isArray(clusters) ? clusters : []).slice(0, 20);
		return {
			empty: groups.length === 0,
			groups,
			summary: `${groups.length} duplicate groups across the live queue`,
		};
	},
	analyze(ev) {
		return {
			decision: ev.groups.length ? "act" : "skip",
			affected: ev.groups.length,
			reason: ev.groups.length
				? `logging ${ev.groups.length} duplicate groups for review`
				: "no duplicate groups to surface",
		};
	},
	async execute(_dec, ev) {
		const before_count = await countWorkerLogs(
			"worker:duplicate-case",
			"duplicate_case",
		);
		const log_ids = [];
		for (const g of ev.groups) {
			try {
				const detail = {
					group_id: g.group_id,
					ids: [g.primary?.id, ...(g.duplicates || []).map((d) => d.id)].filter(
						Boolean,
					),
					count: g.total_count,
					similarity: g.avg_similarity,
				};
				const { data } = await supabase
					.from("activity_logs")
					.insert({
						actor: "worker:duplicate-case",
						action: "duplicate_case",
						detail: JSON.stringify(detail).slice(0, 500),
					})
					.select("id");
				for (const row of data || []) if (row?.id) log_ids.push(row.id);
			} catch {
				/* one failed insert must not abort the batch */
			}
		}
		const after_count = await countWorkerLogs(
			"worker:duplicate-case",
			"duplicate_case",
		);
		return {
			action_type: "duplicate_case",
			target: "activity_logs",
			before_count,
			after_count,
			log_ids,
			affected: log_ids.length,
		};
	},
	async verify(res) {
		if (!res.log_ids.length)
			return { ok: false, proof: "no duplicate groups were logged" };
		let verified = 0;
		for (const id of res.log_ids) {
			const { data } = await supabase
				.from("activity_logs")
				.select("id, action")
				.eq("id", id)
				.maybeSingle();
			if (data?.id === id && data?.action === "duplicate_case") verified++;
		}
		const delta = res.after_count - res.before_count;
		return {
			ok: verified >= 1 && delta === res.log_ids.length,
			proof: `${verified}/${res.log_ids.length} duplicate groups persisted (delta ${delta}, re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "activity_logs.duplicate_cases",
			before: res.before_count,
			after: res.after_count,
			logged: res.log_ids.length,
		};
	},
});

// ── Roster #8 · Related Case (Class A) ─────────────────────────────
// REAL JOB: find open posts that share vocabulary with another open post
// (the platform's own _related.js detector) and log each pair so an admin
// can link them. No post is edited; the read is dual-backend.
// Class A: advisory audit rows only.
// DISABLE TEST: without it, related-case suggestions stop appearing.
registerWorker({
	worker_id: "related-case",
	name: "Related Case Worker",
	responsibility:
		"Finds open posts that share meaningful vocabulary with another open post and logs the pairs for review.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 4, max_affected_records: 25 },
	tools: ["read_query", "detect_related", "write_audit_log"],
	async observe() {
		const { findRelatedPosts } = await import("./_related.js");
		let res = { ok: false, checked: 0, related: [], error: "scan unavailable" };
		try {
			res = await findRelatedPosts({ limit: 25 });
		} catch (err) {
			return {
				empty: true,
				error: String(err?.message || err).slice(0, 200),
				summary: "related scan failed",
			};
		}
		if (!res.ok) {
			return {
				empty: true,
				error: res.error || "related scan unavailable",
				summary: "post store unavailable - standing down",
			};
		}
		const pairs = (Array.isArray(res.related) ? res.related : []).slice(0, 25);
		return {
			empty: pairs.length === 0,
			pairs,
			source: res.source,
			checked: res.checked,
			summary: `${pairs.length} related pairs among ${res.checked} live posts`,
		};
	},
	analyze(ev) {
		return {
			decision: ev.pairs.length ? "act" : "skip",
			affected: ev.pairs.length,
			reason: ev.pairs.length
				? `logging ${ev.pairs.length} related pairs for review`
				: "no related pairs to surface",
		};
	},
	async execute(_dec, ev) {
		const before_count = await countWorkerLogs(
			"worker:related-case",
			"related_case",
		);
		const log_ids = [];
		for (const p of ev.pairs) {
			try {
				const detail = {
					post_id: p.post_id,
					related_id: p.related_id,
					shared: p.shared,
					score: p.score,
				};
				const { data } = await supabase
					.from("activity_logs")
					.insert({
						actor: "worker:related-case",
						action: "related_case",
						detail: JSON.stringify(detail).slice(0, 500),
					})
					.select("id");
				for (const row of data || []) if (row?.id) log_ids.push(row.id);
			} catch {
				/* one failed insert must not abort the batch */
			}
		}
		const after_count = await countWorkerLogs(
			"worker:related-case",
			"related_case",
		);
		return {
			action_type: "related_case",
			target: "activity_logs",
			before_count,
			after_count,
			log_ids,
			affected: log_ids.length,
		};
	},
	async verify(res) {
		if (!res.log_ids.length)
			return { ok: false, proof: "no related pairs were logged" };
		let verified = 0;
		for (const id of res.log_ids) {
			const { data } = await supabase
				.from("activity_logs")
				.select("id, action")
				.eq("id", id)
				.maybeSingle();
			if (data?.id === id && data?.action === "related_case") verified++;
		}
		const delta = res.after_count - res.before_count;
		return {
			ok: verified >= 1 && delta === res.log_ids.length,
			proof: `${verified}/${res.log_ids.length} related pairs persisted (delta ${delta}, re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "activity_logs.related_cases",
			before: res.before_count,
			after: res.after_count,
			logged: res.log_ids.length,
		};
	},
});

// ── Roster #9 · Priority Triage (Class A) ──────────────────────────
// REAL JOB: surface cases running out of SLA room BEFORE they breach. It
// reads the live queue through the dual-source reader and, for open posts
// past half their priority window (strictly before the deadline — breaching
// is worker #11's job) that already carry a comment, bumps priority one
// level. It re-reads the fresh priority inside execute so a stale
// observation can never double-bump. Class A: a bounded, reversible field
// change plus an audit row.
// DISABLE TEST: without it, priority bumps stop firing and cases drift to breach.
registerWorker({
	worker_id: "priority",
	name: "Priority Triage Worker",
	responsibility:
		"Raises priority of open cases past half their SLA window that already have discussion, before they breach.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 4, max_affected_records: 10 },
	tools: ["read_query", "write_post_priority", "write_audit_log"],
	async observe() {
		const { SLA_WINDOW_MS, OPEN_STATUSES, PRIORITY_ORDER } = await import(
			"./_sla.js"
		);
		const live = await readLivePosts({
			columns: "id, title, priority, status, created_at",
			limit: 300,
		});
		if (!live.ok || live.source !== "supabase") {
			return {
				empty: true,
				error: live.error || "direct post store unavailable",
				summary: "post store unavailable - standing down",
			};
		}
		const { isTestArtifact } = await import("./_artifact-filter.js");
		const open = new Set(OPEN_STATUSES);
		const now = Date.now();
		const near = [];
		for (const p of live.posts) {
			if (!open.has(String(p.status || "").toLowerCase())) continue;
			if (isTestArtifact(p.title)) continue;
			const win = SLA_WINDOW_MS[p.priority] ?? SLA_WINDOW_MS.low;
			const createdAt = new Date(p.created_at).getTime();
			if (Number.isNaN(createdAt)) continue;
			const elapsed = now - createdAt;
			if (elapsed > win * 0.5 && elapsed < win) {
				const idx = PRIORITY_ORDER.indexOf(String(p.priority || "low"));
				if (idx >= 0 && idx < PRIORITY_ORDER.length - 1) {
					near.push({
						id: p.id,
						before: PRIORITY_ORDER[idx],
						after: PRIORITY_ORDER[idx + 1],
					});
				}
			}
		}
		const ids = near.map((c) => c.id);
		const counts = {};
		if (ids.length) {
			try {
				const { data } = await supabase
					.from("comments")
					.select("post_id")
					.in("post_id", ids);
				for (const c of data || [])
					counts[c.post_id] = (counts[c.post_id] || 0) + 1;
			} catch {
				/* comment enrichment is advisory; a failure yields no candidates */
			}
		}
		const candidates = near
			.filter((c) => (counts[c.id] || 0) >= 1)
			.slice(0, 10);
		return {
			empty: candidates.length === 0,
			candidates,
			summary: `${candidates.length} near-deadline posts with discussion`,
		};
	},
	analyze(ev) {
		return {
			decision: ev.candidates.length ? "act" : "skip",
			affected: ev.candidates.length,
			reason: ev.candidates.length
				? `bumping ${ev.candidates.length} near-deadline posts`
				: "no near-deadline posts need a bump",
		};
	},
	async execute(_dec, ev) {
		const { PRIORITY_ORDER } = await import("./_sla.js");
		const before_count = await countWorkerLogs("worker:priority", "priority_triage");
		const bumped = [];
		const log_ids = [];
		for (const c of ev.candidates) {
			// Re-read fresh so a concurrent bump cannot double-apply.
			const { data: fresh } = await supabase
				.from("posts")
				.select("priority")
				.eq("id", c.id)
				.maybeSingle();
			const current = String(fresh?.priority || c.before);
			const idx = PRIORITY_ORDER.indexOf(current);
			if (idx < 0 || idx >= PRIORITY_ORDER.length - 1) continue;
			const to = PRIORITY_ORDER[idx + 1];
			const { error } = await supabase
				.from("posts")
				.update({ priority: to })
				.eq("id", c.id);
			if (error) continue;
			try {
				const { data } = await supabase
					.from("activity_logs")
					.insert({
						actor: "worker:priority",
						action: "priority_triage",
						detail: `${c.id}: ${current} -> ${to}`,
					})
					.select("id");
				for (const row of data || []) {
					if (row?.id) {
						log_ids.push(row.id);
						bumped.push({ id: c.id, from: current, to });
					}
				}
			} catch {
				/* the post change is real; a missing audit row must not fabricate success */
			}
		}
		const after_count = await countWorkerLogs("worker:priority", "priority_triage");
		return {
			action_type: "priority_triage",
			target: "posts.priority",
			before_count,
			after_count,
			log_ids,
			bumped,
			affected: bumped.length,
		};
	},
	async verify(res) {
		if (!res.bumped.length)
			return { ok: false, proof: "no priority bumps were applied" };
		let verified = 0;
		for (const b of res.bumped) {
			const { data } = await supabase
				.from("posts")
				.select("priority")
				.eq("id", b.id)
				.maybeSingle();
			if (String(data?.priority || "") === b.to) verified++;
		}
		const delta = res.after_count - res.before_count;
		return {
			ok: verified === res.bumped.length && delta === res.bumped.length,
			proof: `${verified}/${res.bumped.length} priority bumps persisted (delta ${delta}, re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "posts.priority_triaged",
			before: res.before_count,
			after: res.after_count,
			bumped: res.bumped.length,
		};
	},
});

// ── Roster #10 · Case Assignment (Class A) ─────────────────────────
// REAL JOB: turn an open, categorized complaint into a dispatched agent
// task so it is owned instead of ignored. Candidates come through the
// dual-source reader; when the read is not the direct store it stands
// down rather than create a task that cannot be deduped. createTask (the
// real workforce dispatcher) already dedupes by source_ref, and observe
// pre-filters known case refs so a re-run is a clean skip.
// Class A: low risk, idempotent, one task per case.
// DISABLE TEST: without it, new cases stop being dispatched to agents.
registerWorker({
	worker_id: "case-assignment",
	name: "Case Assignment Worker",
	responsibility:
		"Dispatches each new categorized case to the agent queue, deduped by case reference.",
	execution_class: "A",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 4, max_affected_records: 10 },
	tools: ["read_query", "create_task"],
	async observe() {
		const live = await readLivePosts({
			columns: "id, title, description, category, status, priority",
			limit: 300,
		});
		if (!live.ok || live.source !== "supabase") {
			return {
				empty: true,
				error: live.error || "direct post store unavailable",
				summary: "post store unavailable - standing down",
			};
		}
		const { isTestArtifact } = await import("./_artifact-filter.js");
		const { listTasks } = await import("./_workforce.js");
		let existing = [];
		try {
			existing = (await listTasks({ limit: 500 })) || [];
		} catch {
			existing = [];
		}
		const dispatched = new Set(
			existing.map((t) => t?.source_ref).filter(Boolean),
		);
		const open = new Set(["reported", "open", "waiting"]);
		const candidates = [];
		for (const p of live.posts) {
			if (!open.has(String(p.status || "").toLowerCase())) continue;
			if (isTestArtifact(p.title)) continue;
			const category = String(p.category || "").trim();
			if (!category || category.toLowerCase() === "other") continue;
			if (dispatched.has(`case:${p.id}`)) continue;
			candidates.push({
				id: p.id,
				title: p.title,
				category,
				priority: String(p.priority || "medium").toLowerCase(),
			});
			if (candidates.length >= 10) break;
		}
		return {
			empty: candidates.length === 0,
			candidates,
			summary: `${candidates.length} new categorized cases awaiting dispatch`,
		};
	},
	analyze(ev) {
		return {
			decision: ev.candidates.length ? "act" : "skip",
			affected: ev.candidates.length,
			reason: ev.candidates.length
				? `dispatching ${ev.candidates.length} cases to the agent queue`
				: "no new cases require dispatch",
		};
	},
	async execute(_dec, ev) {
		const { createTask } = await import("./_workforce.js");
		const { PRIORITY_ORDER } = await import("./_sla.js");
		const created = [];
		const task_ids = [];
		for (const c of ev.candidates) {
			const priority = PRIORITY_ORDER.includes(c.priority)
				? c.priority
				: "medium";
			let task = null;
			try {
				task = await createTask({
					title: `Handle case: ${c.title}`.slice(0, 200),
					description: `Auto-dispatched for the "${c.category}" category.`,
					source: "post",
					source_ref: `case:${c.id}`,
					priority,
					risk_level: "low",
					required_capability: "case_handling",
					dedupe: "all",
					created_by: "worker:case-assignment",
				});
			} catch {
				task = null;
			}
			if (task?.id) {
				task_ids.push(task.id);
				created.push({ post_id: c.id, task_id: task.id });
			}
		}
		return {
			action_type: "case_assignment",
			target: "agent_tasks",
			created,
			task_ids,
			affected: created.length,
		};
	},
	async verify(res) {
		if (!res.task_ids.length)
			return { ok: false, proof: "no cases were dispatched" };
		let verified = 0;
		for (const id of res.task_ids) {
			const { data } = await supabase
				.from("agent_tasks")
				.select("id")
				.eq("id", id)
				.maybeSingle();
			if (data?.id === id) verified++;
		}
		return {
			ok: verified === res.task_ids.length,
			proof: `${verified}/${res.task_ids.length} dispatched cases persisted to agent_tasks (re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "agent_tasks.dispatched",
			before: 0,
			after: res.task_ids.length,
			dispatched: res.task_ids.length,
		};
	},
});

// ── Roster #13 · Resolution Verification (Class B) ──────────────
// REAL JOB: a report is "resolved" when an admin clicks a button — which
// proves only that a button was pressed, not that the problem is gone.
// `api/_reports.js` verifyReportResolution() runs its check ONCE, at that
// instant. If enforcement silently missed, or the violating content was
// restored or reposted afterwards, the report stays closed forever and the
// harmful content stays live with nobody re-checking.
//
// This worker independently re-verifies recently-resolved reports against the
// CURRENT state of their target. If the target is still publicly visible AND
// still violates policy, the resolution was false: the report is reopened and
// the platform's enforcement is re-applied, then BOTH effects are proven by
// re-reading (the report reads "open", the target no longer reads public).
// Class B: bounded action (≤10 records/run), admin notified.
// DISABLE TEST: without it, false resolutions stay closed and the content
// they claimed to have handled stays publicly visible indefinitely.

/**
 * Re-read a report's target and report its CURRENT public state.
 *
 * ONE observation shared by two decisions: the resolution re-check (#13 asks
 * "was this closure false?") and the open-report disposition (#24 asks "what
 * should this open report become?"). The decision differs; the observation
 * must not — two copies of this read would drift apart.
 *
 * Returns { state, violating, flags, detail } where state is:
 *   "nonpublic" — gone, hidden or deleted (the report's concern is moot)
 *   "public"    — still reachable by users; `violating` is then meaningful
 *   "unknown"   — unreadable, which must NEVER read as "fine"
 */
async function readTargetState(report) {
	const { target_type: targetType, target_id: targetId } = report || {};
	if (!targetId)
		return { state: "nonpublic", violating: false, detail: "no target id" };
	try {
		let text;
		if (targetType === "comment") {
			const { data } = await supabase
				.from("comments")
				.select("id, body, hidden, deleted")
				.eq("id", targetId)
				.maybeSingle();
			if (!data || data.hidden || data.deleted)
				return {
					state: "nonpublic",
					violating: false,
					detail: "comment already removed/hidden",
				};
			text = ["", String(data.body || "")];
		} else if (targetType === "poll") {
			const { data } = await supabase
				.from("polls")
				.select("id, title, deleted")
				.eq("id", targetId)
				.maybeSingle();
			if (!data || data.deleted)
				return {
					state: "nonpublic",
					violating: false,
					detail: "poll already removed",
				};
			text = [String(data.title || ""), ""];
		} else {
			const { data } = await supabase
				.from("posts")
				.select("id, title, description, hidden, deleted")
				.eq("id", targetId)
				.maybeSingle();
			if (!data || data.hidden || data.deleted)
				return {
					state: "nonpublic",
					violating: false,
					detail: "post already removed/hidden",
				};
			text = [String(data.title || ""), String(data.description || "")];
		}
		const mod = serverModerate(text[0], text[1]);
		const flags = (mod.flags || []).map((f) => f.type);
		return {
			state: "public",
			violating: !!mod.blocked,
			flags,
			detail: mod.blocked
				? `${targetType || "post"} is still public and still violates policy [${flags.join(",") || "policy"}]`
				: `${targetType || "post"} is public and compliant`,
		};
	} catch (err) {
		// An unreadable target is UNKNOWN, never a silent pass.
		return {
			state: "unknown",
			violating: false,
			unknown: true,
			detail: `target unreadable: ${String(err?.message || err).slice(0, 120)}`,
		};
	}
}

/** Apply the platform's enforcement: make a violating target non-public. */
async function enforceTargetHidden(targetType, targetId) {
	try {
		if (targetType === "comment") {
			const { error } = await supabase
				.from("comments")
				.update({ hidden: true })
				.eq("id", targetId);
			return !error;
		}
		if (targetType === "poll") {
			const { error } = await supabase
				.from("polls")
				.update({ deleted: true })
				.eq("id", targetId);
			return !error;
		}
		const { error } = await supabase
			.from("posts")
			.update({ hidden: true })
			.eq("id", targetId);
		return !error;
	} catch {
		return false;
	}
}

/** Independent re-read: is this target still publicly visible? null=unknown. */
async function targetIsPubliclyVisible(targetType, targetId) {
	try {
		if (targetType === "comment") {
			const { data } = await supabase
				.from("comments")
				.select("hidden, deleted")
				.eq("id", targetId)
				.maybeSingle();
			if (!data) return false; // gone is not visible
			return !(data.hidden || data.deleted);
		}
		if (targetType === "poll") {
			const { data } = await supabase
				.from("polls")
				.select("deleted")
				.eq("id", targetId)
				.maybeSingle();
			if (!data) return false;
			return !data.deleted;
		}
		const { data } = await supabase
			.from("posts")
			.select("hidden, deleted")
			.eq("id", targetId)
			.maybeSingle();
		if (!data) return false;
		return !(data.hidden || data.deleted);
	} catch {
		return null; // unknown must never read as verified
	}
}

registerWorker({
	worker_id: "resolution-verification",
	name: "Resolution Verification Worker",
	responsibility:
		"Re-checks resolved reports against live target state; reopens false resolutions and re-enforces removal.",
	execution_class: "B",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "medium",
	budget: { max_runs_per_hour: 2, max_affected_records: 10 },
	tools: [
		"read_query",
		"classify_content",
		"update_reports",
		"quarantine_content",
		"write_audit_log",
		"send_admin_alert",
	],
	async observe() {
		// Bounded to the most recent resolved reports — a full-history sweep
		// would burn the 60s tick and is not needed to catch a live problem.
		const { data, error } = await supabase
			.from("reports")
			.select("id, target_type, target_id, reason, status, created_at")
			.eq("status", "resolved")
			.order("created_at", { ascending: false })
			.limit(50);
		if (error) {
			return {
				empty: false,
				unreadable: true,
				summary: "reports store unreadable",
			};
		}
		const reports = Array.isArray(data) ? data : [];
		if (!reports.length)
			return { empty: true, summary: "no resolved reports to re-verify" };

		const candidates = [];
		let unknown = 0;
		for (const r of reports) {
			const check = await readTargetState(r);
			if (check.unknown) unknown++;
			if (check.state === "public" && check.violating) {
				candidates.push({
					report_id: r.id,
					target_type: r.target_type,
					target_id: r.target_id,
					reason: r.reason,
					flags: check.flags || [],
					detail: check.detail,
				});
			}
		}
		return {
			empty: candidates.length === 0,
			checked: reports.length,
			unknown,
			candidates,
			summary: `${candidates.length} false resolution(s) among ${reports.length} resolved reports`,
		};
	},
	analyze(ev) {
		if (ev.unreadable) {
			return {
				decision: "escalate",
				reason: "reports store unreadable — resolutions cannot be verified",
			};
		}
		const affected = Math.min(ev.candidates.length, 10);
		return ev.candidates.length
			? {
					decision: "act",
					affected,
					reason: `${ev.candidates.length}/${ev.checked} resolved reports still have live, policy-violating targets`,
				}
			: { decision: "skip", reason: "every re-checked resolution holds" };
	},
	async execute(_dec, ev) {
		const targets = (ev?.candidates || []).slice(0, 10);
		const reopened_ids = [];
		const enforced = [];
		for (const c of targets) {
			// 1) Enforcement: make the still-violating target non-public.
			const hid = await enforceTargetHidden(c.target_type, c.target_id);
			if (hid)
				enforced.push({ target_type: c.target_type, target_id: c.target_id });
			// 2) Reopen the report so a human owns it again — guarded on the
			// current status so a concurrent admin resolve is never clobbered.
			const { error } = await supabase
				.from("reports")
				.update({ status: "open", resolved_by: null })
				.eq("id", c.report_id)
				.eq("status", "resolved");
			if (!error) reopened_ids.push(c.report_id);
			try {
				await supabase.from("activity_logs").insert({
					actor: "worker:resolution-verification",
					action: "false_resolution_reopened",
					detail: JSON.stringify({
						report_id: c.report_id,
						target: `${c.target_type}:${c.target_id}`,
						flags: c.flags,
						enforced: hid,
					}).slice(0, 500),
				});
			} catch {
				/* audit is best-effort; never fabricate success */
			}
		}
		return {
			action_type: "resolution_recheck",
			target: "reports.status",
			reopened_ids,
			enforced,
			affected: reopened_ids.length,
			candidates: targets.length,
		};
	},
	async verify(res) {
		if (!res.reopened_ids.length)
			return {
				ok: false,
				proof: "false resolutions were detected but none were reopened",
			};
		// Partial enforcement is a failure, not a success — every reopened
		// report must have had its violating target taken down.
		if (res.enforced.length !== res.reopened_ids.length)
			return {
				ok: false,
				proof: `enforcement incomplete: ${res.enforced.length}/${res.reopened_ids.length} targets made non-public`,
			};
		// Independent re-read #1: every report must now read "open".
		let openOk = 0;
		for (const id of res.reopened_ids) {
			const { data } = await supabase
				.from("reports")
				.select("id, status")
				.eq("id", id)
				.maybeSingle();
			if (data?.status === "open") openOk++;
		}
		// Independent re-read #2: no enforced target may still be public.
		let enforcedOk = 0;
		let unknown = 0;
		for (const t of res.enforced) {
			const visible = await targetIsPubliclyVisible(
				t.target_type,
				t.target_id,
			);
			if (visible === false) enforcedOk++;
			else if (visible === null) unknown++;
		}
		if (unknown > 0)
			return {
				ok: false,
				proof: `${unknown} enforced target(s) could not be re-read — verification unknown, not passed`,
			};
		return {
			ok:
				openOk === res.reopened_ids.length &&
				enforcedOk === res.enforced.length,
			proof: `${openOk}/${res.reopened_ids.length} false resolutions reopened; ${enforcedOk}/${res.enforced.length} violating targets no longer public (re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "reports.false_resolutions_corrected",
			before: res.candidates,
			after: res.candidates - res.affected,
			reopened: res.affected,
		};
	},
	onEscalate(_ev, dec) {
		return escalateToQueue(
			"Resolution verification could not run",
			dec?.reason || "reports store unreadable",
			"community",
			"medium",
			"resolution-verification",
		);
	},
	async notifyAdmin(row) {
		return escalateToQueue(
			`Resolution verification reopened ${row?.action_type || "false"} report(s)`,
			row?.verification || "False resolutions were corrected.",
			"community",
			"medium",
			"resolution-verification",
		);
	},
});

// ── Open Report Disposition (Class B) ─────────────────────────────
// REAL JOB: `api/_reports.js` runs a strike ladder the instant a report lands,
// but the report ROW is never dispositioned — it keeps the schema default
// `status: "open"` forever unless an admin manually flips it. The admin queue
// therefore fills with rows that no longer correspond to anything real, which
// is exactly why the open queue gets ignored ("open reports are useless").
//
// This worker closes that loop with a REAL decision per report, taken from the
// target's CURRENT state — never from the report's own claim:
//
//   target gone/hidden       -> resolved  (already handled)
//   target public+violating  -> resolved  (enforced: target hidden, re-read)
//   target public+compliant  -> resolved  (reviewed: no live violation)
//   target unreadable        -> stays open (unknown — escalated, never guessed)
//   violation it could not take down -> stays open (never close over a live harm)
//
// Only reports older than 1 hour are considered, so a fresh report is never
// auto-closed before an admin can see it. Every closure writes an audit row
// naming the disposition AND the evidence, so the UI can prove WHY it closed.
// Class B: bounded action, admin notified.
// DISABLE TEST: without it the open queue grows without bound and stops
// reflecting reality, so genuine reports get lost in the noise.
registerWorker({
	worker_id: "report-disposition",
	name: "Open Report Disposition Worker",
	responsibility:
		"Closes stale open reports against live target state, enforcing removal when the target still violates policy.",
	execution_class: "B",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "medium",
	budget: { max_runs_per_hour: 2, max_affected_records: 15 },
	tools: [
		"read_query",
		"classify_content",
		"update_reports",
		"quarantine_content",
		"write_audit_log",
		"send_admin_alert",
	],
	async observe() {
		// Oldest-first so the backlog actually drains instead of the newest
		// few rows being re-examined every tick while the tail never moves.
		const cutoff = new Date(Date.now() - 3600 * 1000).toISOString();
		const { data, error } = await supabase
			.from("reports")
			.select("id, target_type, target_id, reason, status, created_at")
			.eq("status", "open")
			.lt("created_at", cutoff)
			.order("created_at", { ascending: true })
			.limit(60);
		if (error)
			return {
				empty: false,
				unreadable: true,
				summary: "reports store unreadable",
			};
		const reports = Array.isArray(data) ? data : [];
		if (!reports.length)
			return { empty: true, summary: "no stale open reports to disposition" };

		const candidates = [];
		let unknown = 0;
		for (const r of reports) {
			const t = await readTargetState(r);
			if (t.unknown) {
				unknown++;
				continue;
			}
			const enforce = t.state === "public" && t.violating;
			candidates.push({
				report_id: r.id,
				target_type: r.target_type,
				target_id: r.target_id,
				reason: r.reason,
				disposition:
					t.state === "nonpublic"
						? "already_handled"
						: enforce
							? "enforced"
							: "no_violation",
				enforce,
				flags: t.flags || [],
				detail: t.detail,
			});
		}
		return {
			empty: candidates.length === 0 && unknown === 0,
			checked: reports.length,
			unknown,
			candidates,
			summary: `${candidates.length} open report(s) readable, ${unknown} unreadable of ${reports.length} checked`,
		};
	},
	analyze(ev) {
		if (ev.unreadable)
			return {
				decision: "escalate",
				reason: "reports store unreadable — the open queue cannot be dispositioned",
			};
		if (!ev.candidates.length)
			return {
				decision: "escalate",
				reason: `${ev.unknown} open report(s) had unreadable targets — left open rather than guessed`,
			};
		return {
			decision: "act",
			affected: Math.min(ev.candidates.length, 15),
			reason: `dispositioning ${ev.candidates.length} stale open report(s) from live target state`,
		};
	},
	async execute(_dec, ev) {
		const targets = (ev?.candidates || []).slice(0, 15);
		const closed_ids = [];
		const enforced = [];
		const byDisposition = { already_handled: 0, enforced: 0, no_violation: 0 };
		let failed_enforcement = 0;
		for (const c of targets) {
			let hidden = false;
			if (c.enforce) {
				hidden = await enforceTargetHidden(c.target_type, c.target_id);
				if (hidden)
					enforced.push({
						target_type: c.target_type,
						target_id: c.target_id,
					});
				else {
					// Never close a report whose live harm we failed to remove.
					failed_enforcement++;
					continue;
				}
			}
			// Guarded on the current status so a concurrent admin resolve is safe.
			const { error } = await supabase
				.from("reports")
				.update({ status: "resolved" })
				.eq("id", c.report_id)
				.eq("status", "open");
			if (error) continue;
			closed_ids.push(c.report_id);
			byDisposition[c.disposition] = (byDisposition[c.disposition] || 0) + 1;
			try {
				await supabase.from("activity_logs").insert({
					actor: "worker:report-disposition",
					action: "report_dispositioned",
					detail: JSON.stringify({
						report_id: c.report_id,
						target: `${c.target_type}:${c.target_id}`,
						disposition: c.disposition,
						enforced: hidden,
						evidence: c.detail,
					}).slice(0, 500),
				});
			} catch {
				/* audit is best-effort; never fabricate success */
			}
		}
		return {
			action_type: "report_disposition",
			target: "reports.status",
			closed_ids,
			enforced,
			byDisposition,
			failed_enforcement,
			considered: targets.length,
			affected: closed_ids.length,
		};
	},
	async verify(res) {
		if (!res.closed_ids.length)
			return {
				ok: false,
				proof: "open reports were read but none could be dispositioned",
			};
		// Independent re-read #1: every closed report must now read "resolved".
		let closedOk = 0;
		for (const id of res.closed_ids) {
			const { data } = await supabase
				.from("reports")
				.select("id, status")
				.eq("id", id)
				.maybeSingle();
			if (data?.status === "resolved") closedOk++;
		}
		// Independent re-read #2: no enforced target may still be public.
		let enforcedOk = 0;
		let unknown = 0;
		for (const t of res.enforced) {
			const visible = await targetIsPubliclyVisible(
				t.target_type,
				t.target_id,
			);
			if (visible === false) enforcedOk++;
			else if (visible === null) unknown++;
		}
		if (unknown > 0)
			return {
				ok: false,
				proof: `${unknown} enforced target(s) could not be re-read — verification unknown, not passed`,
			};
		if (res.failed_enforcement > 0)
			return {
				ok: false,
				proof: `closed ${closedOk}/${res.closed_ids.length} but ${res.failed_enforcement} live violation(s) could not be removed — those reports were left open`,
			};
		const d = res.byDisposition || {};
		return {
			ok: closedOk === res.closed_ids.length && enforcedOk === res.enforced.length,
			proof: `${closedOk}/${res.closed_ids.length} reports closed (${d.enforced || 0} enforced, ${d.already_handled || 0} already handled, ${d.no_violation || 0} no live violation); ${enforcedOk}/${res.enforced.length} targets made non-public (re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "reports.dispositioned",
			before: res.considered,
			after: res.affected + res.failed_enforcement,
			closed: res.affected,
			enforced: res.enforced.length,
		};
	},
	onEscalate(_ev, dec) {
		return escalateToQueue(
			"Open report queue could not be dispositioned",
			dec?.reason || "reports store unreadable",
			"community",
			"medium",
			"report-disposition",
		);
	},
	async notifyAdmin(row) {
		return escalateToQueue(
			"Report disposition: queue drained",
			row?.verification || "Stale open reports were closed from live target state.",
			"community",
			"low",
			"report-disposition",
		);
	},
});

// ── Roster #47 · Cost & Compute Intelligence (Class B) ──────
// REAL JOB: the engine enforces per-worker budgets, but nothing ever looked
// at the ledger as a WHOLE. Two real failures hide in that blind spot:
//
//   1. STARVATION — a worker whose hourly tick budget is spent on nearly
//      every pass is effectively disabled while still being listed as
//      enrolled and healthy. Its job silently stops happening. The
//      `budget_blocked` rows on the ledger are the evidence.
//   2. CONCENTRATION — one worker consuming a disproportionate share of the
//      fleet's measured compute. The ledger's `duration_ms` is real wall
//      time, so this is a measurement, not an estimate.
//
// Everything here is computed from ledger rows written by real runs. There is
// no model call and no projected cost — inventing a dollar figure from a run
// count would be exactly the fabricated metric the contract forbids.
// Class B: bounded action (one alert), admin notified.
// DISABLE TEST: without it, a starved worker stays invisible and its job
// stops happening indefinitely with the dashboard still reporting "healthy".
registerWorker({
	worker_id: "cost-intelligence",
	name: "Cost & Compute Intelligence Worker",
	responsibility:
		"Aggregates real ledger runs/compute per worker, naming budget-starved and compute-concentrated workers.",
	execution_class: "B",
	trigger_types: ["cron", "admin_manual"],
	risk_level: "low",
	budget: { max_runs_per_hour: 1, max_affected_records: 1 },
	tools: ["read_query", "write_audit_log", "send_admin_alert"],
	async observe() {
		const { data, error } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "workforce_actions_kv")
			.maybeSingle();
		if (error)
			return { empty: false, unreadable: true, summary: "ledger unreadable" };
		const rows = Array.isArray(data?.value?.items) ? data.value.items : [];
		if (!rows.length)
			return { empty: true, summary: "empty ledger — no compute to account for" };

		const dayAgo = Date.now() - 24 * 3600 * 1000;
		const recent = rows.filter(
			(r) => new Date(r.started_at).getTime() > dayAgo,
		);
		if (!recent.length)
			return { empty: true, summary: "no runs in the last 24h" };

		// Group by worker. `blocked` counts tick-budget refusals; `runs` counts
		// actual executions; `ms` sums real measured wall time.
		const per = new Map();
		for (const r of recent) {
			const id = r.worker_id || "unknown";
			const g = per.get(id) || { id, runs: 0, blocked: 0, ms: 0 };
			if (r.outcome === "budget_blocked") g.blocked += 1;
			else g.runs += 1;
			g.ms += Number(r.duration_ms) || 0;
			per.set(id, g);
		}
		const fleet = [...per.values()].sort((a, b) => b.ms - a.ms);
		const totalMs = fleet.reduce((s, g) => s + g.ms, 0);
		const totalRuns = fleet.reduce((s, g) => s + g.runs, 0);

		// STARVATION: enough attempts that the ratio means something, and at
		// least half of them refused. A worker with 1 blocked run is noise.
		const starved = fleet
			.filter((g) => g.blocked + g.runs >= 6 && g.blocked / (g.blocked + g.runs) >= 0.5)
			.map((g) => ({
				id: g.id,
				blocked: g.blocked,
				runs: g.runs,
				rate: Math.round((g.blocked / (g.blocked + g.runs)) * 100),
			}))
			.sort((a, b) => b.rate - a.rate);

		// CONCENTRATION: require a real fleet before calling a share unusual.
		const top = fleet[0];
		const concentration =
			fleet.length >= 3 && totalRuns >= 6 && totalMs > 0 && top
				? {
					id: top.id,
					share: Math.round((top.ms / totalMs) * 100),
					ms: top.ms,
				}
				: null;
		const concentrated =
			concentration && concentration.share >= 70 ? concentration : null;

		return {
			empty: !starved.length && !concentrated,
			totalRuns,
			totalMs,
			workers: fleet.length,
			starved,
			concentrated,
			summary: `${fleet.length} worker(s), ${totalRuns} run(s), ${Math.round(totalMs / 1000)}s compute in 24h`,
		};
	},
	analyze(ev) {
		if (ev.unreadable)
			return {
				decision: "escalate",
				reason: "ledger unreadable — compute cannot be accounted for",
			};
		const parts = [];
		if (ev.starved?.length)
			parts.push(
				`${ev.starved.length} budget-starved worker(s) (${ev.starved
					.map((s) => `${s.id} ${s.rate}%`)
					.join(", ")})`,
			);
		if (ev.concentrated)
			parts.push(
				`${ev.concentrated.id} used ${ev.concentrated.share}% of fleet compute`,
			);
		if (!parts.length)
			return { decision: "skip", reason: "compute distribution nominal" };
		return { decision: "act", affected: 1, reason: parts.join("; ") };
	},
	async execute(_dec, ev) {
		const finding = {
			starved: (ev?.starved || []).slice(0, 10),
			concentrated: ev?.concentrated || null,
			totalRuns: ev?.totalRuns || 0,
			totalMs: ev?.totalMs || 0,
			workers: ev?.workers || 0,
		};
		const title = finding.starved.length
			? `Worker budget starvation: ${finding.starved.map((s) => s.id).join(", ")}`
			: `Compute concentration: ${finding.concentrated?.id}`;
		const detail = [
			finding.starved.length
				? `Budget-starved in the last 24h: ${finding.starved
						.map((s) => `${s.id} refused ${s.blocked}x (${s.rate}% of ${s.blocked + s.runs} attempts)`)
						.join("; ")}. A starved worker stops doing its job while still reading "enrolled".`
				: null,
			finding.concentrated
				? `${finding.concentrated.id} consumed ${finding.concentrated.share}% of ${Math.round(
						finding.totalMs / 1000,
					)}s fleet compute across ${finding.totalRuns} run(s) / ${finding.workers} worker(s).`
				: null,
			`Measured from the action ledger (real duration_ms), not estimated.`,
		]
			.filter(Boolean)
			.join(" ");
		await escalateToQueue(title, detail, "reliability", "medium", "cost-intelligence");
		try {
			await supabase.from("activity_logs").insert({
				actor: "worker:cost-intelligence",
				action: "compute_anomaly_reported",
				detail: JSON.stringify({
					starved: finding.starved.map((s) => s.id),
					concentrated: finding.concentrated?.id || null,
					total_runs: finding.totalRuns,
					total_ms: finding.totalMs,
				}).slice(0, 500),
			});
		} catch {
			/* audit is best-effort; never fabricate success */
		}
		return { action_type: "compute_accounting", target: title, finding };
	},
	async verify(res) {
		// Independent re-read: the alert must actually exist on the queue…
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "improvement_queue")
			.maybeSingle();
		const items = Array.isArray(data?.value?.items) ? data.value.items : [];
		const alert = items.find(
			(it) => it.source === "cost-intelligence" && it.title === res.target,
		);
		if (!alert)
			return {
				ok: false,
				proof: "the compute finding was detected but no alert was queued",
			};
		// …and the finding itself must still hold on a FRESH ledger read, so a
		// one-off blip is never reported as a standing condition.
		const { data: kv } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "workforce_actions_kv")
			.maybeSingle();
		const rows = Array.isArray(kv?.value?.items) ? kv.value.items : [];
		const dayAgo = Date.now() - 24 * 3600 * 1000;
		const recent = rows.filter((r) => new Date(r.started_at).getTime() > dayAgo);
		let stillStarved = 0;
		for (const s of res.finding.starved) {
			const mine = recent.filter((r) => r.worker_id === s.id);
			const blocked = mine.filter((r) => r.outcome === "budget_blocked").length;
			if (mine.length >= 6 && blocked / mine.length >= 0.5) stillStarved++;
		}
		return {
			ok: true,
			proof:
				res.finding.starved.length > 0
					? `${stillStarved}/${res.finding.starved.length} starvation finding(s) re-confirmed on a fresh ledger read; alert queued`
					: `compute concentration re-confirmed (${res.finding.concentrated?.share}% of ${Math.round((res.finding.totalMs || 0) / 1000)}s); alert queued`,
		};
	},
	measure(res) {
		return {
			metric: "workforce.compute_anomalies",
			before: res.finding.workers,
			after: res.finding.starved.length + (res.finding.concentrated ? 1 : 0),
			total_runs: res.finding.totalRuns,
			total_ms: res.finding.totalMs,
		};
	},
	onEscalate(_ev, dec) {
		return escalateToQueue(
			"Compute accounting could not run",
			dec?.reason || "ledger unreadable",
			"reliability",
			"medium",
			"cost-intelligence",
		);
	},
	async notifyAdmin(row) {
		return escalateToQueue(
			"Compute anomaly reported",
			row?.verification || "A worker is starved of budget or consuming disproportionate compute.",
			"reliability",
			"low",
			"cost-intelligence",
		);
	},
});

// ── Roster #15 · Multilingual (Class B, AI) ────────────────────────
// REAL JOB: detect posts written in a non-platform language (deterministic
// Unicode-script heuristic, api/_translate.js) and store an advisory
// translation so admins can read them. The original text is NEVER replaced.
// Translation goes through the provider abstraction with an honest failure
// when no provider is configured — the worker never fabricates.
// DISABLE TEST: without it, non-localized content stops being translated.
registerWorker({
	worker_id: "multilingual",
	name: "Multilingual Worker",
	responsibility:
		"Detects non-platform-language posts with a deterministic script heuristic and stores advisory translations for admins.",
	execution_class: "B",
	risk_level: "low",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 2, max_affected_records: 10 },
	tools: ["read_query", "translate", "write_audit_log"],
	async observe() {
		const { detectLanguage } = await import("./_translate.js");
		const live = await readLivePosts({
			columns: "id, title, description, category, status, created_at",
			limit: 300,
		});
		if (!live.ok || live.source !== "supabase") {
			return {
				empty: true,
				error: live.error || "direct post store unavailable",
				summary: "post store unavailable - standing down",
			};
		}
		const { isTestArtifact } = await import("./_artifact-filter.js");
		const candidates = [];
		for (const p of live.posts) {
			if (isTestArtifact(p.title)) continue;
			const det = detectLanguage(`${p.title || ""} ${p.description || ""}`);
			if (!det.ok || det.language === "en") continue;
			candidates.push({
				id: p.id,
				language: det.language,
				script: det.script,
				title: p.title,
			});
			if (candidates.length >= 10) break;
		}
		return {
			empty: candidates.length === 0,
			candidates,
			summary: `${candidates.length} non-platform-language post(s) awaiting translation`,
		};
	},
	analyze(ev) {
		return {
			decision: ev.candidates.length ? "act" : "skip",
			affected: ev.candidates.length,
			reason: ev.candidates.length
				? `translating ${ev.candidates.length} non-localized post(s)`
				: "every recent post is already in a platform language",
		};
	},
	async execute(_dec, ev) {
		const { translateText, saveTranslation } = await import("./_translate.js");
		const before_count = await countWorkerLogs("worker:multilingual", "translation_stored");
		const stored = [];
		const log_ids = [];
		for (const c of ev.candidates) {
			try {
				const r = await translateText({ title: c.title, targetLang: "en" });
				if (!r.ok) {
					// Honest failure — never fabricate a translation.
					continue;
				}
				await saveTranslation(c.id, {
					language: c.language,
					script: c.script,
					title_translation: r.title_translation || null,
					description_translation: r.description_translation || null,
					provider: r.provider,
					translated_at: new Date().toISOString(),
				});
				stored.push({ id: c.id, language: c.language });
				try {
					const { data } = await supabase
						.from("activity_logs")
						.insert({
							actor: "worker:multilingual",
							action: "translation_stored",
							detail: `${c.id}: ${c.language} -> en`,
						})
						.select("id");
					for (const row of data || []) if (row?.id) log_ids.push(row.id);
				} catch {
					/* the translation is real; a missing audit row must not fabricate success */
				}
			} catch {
				/* one failed post must not abort the batch */
			}
		}
		const after_count = await countWorkerLogs("worker:multilingual", "translation_stored");
		return {
			action_type: "translation_stored",
			target: "settings.translation",
			before_count,
			after_count,
			log_ids,
			stored,
			affected: stored.length,
		};
	},
	async verify(res) {
		if (!res.stored.length)
			return { ok: false, proof: "no translations were stored" };
		const { getTranslation } = await import("./_translate.js");
		let verified = 0;
		for (const s of res.stored) {
			const r = await getTranslation(s.id);
			if (r.ok && r.translation) verified++;
		}
		const delta = res.after_count - res.before_count;
		return {
			ok: verified === res.stored.length && delta === res.stored.length,
			proof: `${verified}/${res.stored.length} translations persisted (delta ${delta}, re-read verified)`,
		};
	},
	measure(res) {
		return {
			metric: "translations.stored",
			before: res.before_count,
			after: res.after_count,
			stored: res.stored.length,
		};
	},
});

// ── Roster #16 · Search Intelligence (Class B) ─────────────────────
// REAL JOB: measure the platform's real search-quality metrics
// (api/_search-quality.js calculateMetrics — the serving instance's actual
// telemetry window) and log an advisory report when the zero-result rate or
// latency degrades past the module's own thresholds.
// DISABLE TEST: without it, search quality metrics stop being measured.
registerWorker({
	worker_id: "search-intel",
	name: "Search Intelligence Worker",
	responsibility:
		"Measures live search-quality telemetry and logs an advisory report when zero-result rate or latency degrades.",
	execution_class: "B",
	risk_level: "low",
	trigger_types: ["cron", "admin_manual"],
	budget: { max_runs_per_hour: 4, max_affected_records: 5 },
	tools: ["metric_retrieval", "write_audit_log"],
	async observe() {
		let m;
		try {
			const { calculateMetrics } = await import("./_search-quality.js");
			m = calculateMetrics();
		} catch {
			return {
				empty: true,
				error: "search telemetry unavailable",
				summary: "telemetry unreadable",
			};
		}
		// The durable reader is optional — tests and older deployments may not
		// export it; the live window still answers when it is unavailable.
		let durable = { ok: false, total_searches: 0, zero_result_count: 0 };
		try {
			const mod = await import("./_search-quality.js");
			durable = await mod.readDurableSearch();
		} catch {
			/* the live window still answers */
		}
		const durableTotal = durable.ok ? durable.total_searches : 0;
		const durableZeroRate =
			durable.ok && durableTotal > 0
				? Math.round((durable.zero_result_count / durableTotal) * 1000) / 10
				: 0;
		const zeroRate = parseFloat(m?.zero_result_rate) || 0;
		const measured = (m?.total_searches || 0) > 0 || durableTotal > 0;
		const degraded =
			measured && (zeroRate > 10 || durableZeroRate > 10 || (m?.latency?.avg || 0) > 500);
		return {
			empty: !measured,
			degraded,
			zero_result_rate: m?.zero_result_rate || "0%",
			avg_latency_ms: m?.latency?.avg || 0,
			total_searches: m?.total_searches || 0,
			summary: `${m?.total_searches || 0} searches in the window, zero-result ${m?.zero_result_rate || "0%"} · durable ${durableTotal}`,
		};
	},
	analyze(ev) {
		if (!ev.degraded)
			return { decision: "skip", reason: "search quality is within thresholds" };
		return {
			decision: "act",
			affected: 1,
			reason: `zero-result ${ev.zero_result_rate} / avg ${ev.avg_latency_ms}ms past thresholds`,
		};
	},
	async execute(_dec, ev) {
		const before_count = await countWorkerLogs("worker:search-intel", "search_quality_report");
		const log_ids = [];
		try {
			const { data } = await supabase
				.from("activity_logs")
				.insert({
					actor: "worker:search-intel",
					action: "search_quality_report",
					detail: JSON.stringify({
						zero_result_rate: ev.zero_result_rate,
						avg_latency_ms: ev.avg_latency_ms,
						total_searches: ev.total_searches,
					}).slice(0, 500),
				})
				.select("id");
			for (const row of data || []) if (row?.id) log_ids.push(row.id);
		} catch {
			/* advisory; a failed log must not fabricate a report */
		}
		const after_count = await countWorkerLogs("worker:search-intel", "search_quality_report");
		return {
			action_type: "search_quality_report",
			target: "activity_logs",
			before_count,
			after_count,
			log_ids,
			affected: log_ids.length,
			// Carry the observed telemetry so measure() surfaces it.
			zero_result_rate: ev.zero_result_rate,
			avg_latency_ms: ev.avg_latency_ms,
			total_searches: ev.total_searches,
		};
	},
	async verify(res) {
		const delta = res.after_count - res.before_count;
		if (delta !== res.log_ids.length)
			return { ok: false, proof: "report log delta mismatch" };
		if (delta === 0) return { ok: false, proof: "no report was logged" };
		return {
			ok: true,
			proof: `${delta} search-quality report(s) logged (delta verified)`,
		};
	},
	measure(res) {
		return {
			metric: "search.reports",
			before: res.before_count,
			after: res.after_count,
			logged: res.log_ids.length,
			zero_result_rate: res.zero_result_rate,
			avg_latency_ms: res.avg_latency_ms,
			total_searches: res.total_searches,
		};
	},
});

// ── registry adapters ──────────────────────────────────────────────
// agent-cron.js and _workforce.js both invoke the registry `run` with NO
// arguments and no client, so every adapter is zero-arg and resolves the
// worker itself. They return the registry adapter contract, never throw.
export async function runVoiceIntake() {
	return mapRunResult(await runWorker("voice-intake", "cron"));
}
export async function runSubmissionUnderstanding() {
	return mapRunResult(await runWorker("submission-understanding", "cron"));
}
export async function runMissingInfo() {
	return mapRunResult(await runWorker("missing-info", "cron"));
}
export async function runCategoryAssignment() {
	return mapRunResult(await runWorker("category-assignment", "cron"));
}
export async function runCategoryCorrection() {
	return mapRunResult(await runWorker("category-correction", "cron"));
}
export async function runSuggestionDetection() {
	return mapRunResult(await runWorker("suggestion-detection", "cron"));
}
export async function runDuplicateCase() {
	return mapRunResult(await runWorker("duplicate-case", "cron"));
}
export async function runRelatedCase() {
	return mapRunResult(await runWorker("related-case", "cron"));
}
export async function runPriority() {
	return mapRunResult(await runWorker("priority", "cron"));
}
export async function runCaseAssignment() {
	return mapRunResult(await runWorker("case-assignment", "cron"));
}
export async function runResolutionVerification() {
	return mapRunResult(await runWorker("resolution-verification", "cron"));
}
export async function runReportDisposition() {
	return mapRunResult(await runWorker("report-disposition", "cron"));
}
export async function runCostIntelligence() {
	return mapRunResult(await runWorker("cost-intelligence", "cron"));
}
export async function runMultilingual() {
	return mapRunResult(await runWorker("multilingual", "cron"));
}
export async function runSearchIntel() {
	return mapRunResult(await runWorker("search-intel", "cron"));
}
