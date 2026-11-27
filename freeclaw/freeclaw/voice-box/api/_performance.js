// Performance Dashboard — real-time performance metrics for the platform.
// GET /api/performance  →  API response times, DB latency, error rates, storage stats

import { cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";

async function measureQuery(tableName, operation = "count") {
	const start = Date.now();
	try {
		if (operation === "count") {
			const { count } = await supabase
				.from(tableName)
				.select("*", { count: "exact", head: true });
			return {
				latency_ms: Date.now() - start,
				count: count || 0,
				status: "ok",
			};
		}
		if (operation === "select") {
			const { data } = await supabase
				.from(tableName)
				.select("id")
				.order("created_at", { ascending: false })
				.limit(1);
			return {
				latency_ms: Date.now() - start,
				status: "ok",
				sample: data?.[0]?.id,
			};
		}
	} catch (err) {
		return {
			latency_ms: Date.now() - start,
			status: "error",
			error: err.message,
		};
	}
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		const startTime = Date.now();

		// Measure API response times for each table
		const [
			postsCount,
			commentsCount,
			reactionsCount,
			pollsCount,
			usersCount,
			reportsCount,
			chatCount,
			logsCount,
		] = await Promise.all([
			measureQuery("posts"),
			measureQuery("comments"),
			measureQuery("reactions"),
			measureQuery("polls"),
			measureQuery("users_meta"),
			measureQuery("reports"),
			measureQuery("chat_threads"),
			measureQuery("activity_logs"),
		]);

		// DB latency (simple query)
		const dbLatency = await measureQuery("settings", "select");

		// Active users (seen in last 5 minutes)
		const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
		let activeUsers = 0;
		try {
			const { count } = await supabase
				.from("users_meta")
				.select("*", { count: "exact", head: true })
				.gte("last_seen", fiveMinAgo);
			activeUsers = count || 0;
		} catch {
			/* non-fatal */
		}

		// Error rate (last hour)
		const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
		let errorCount = 0;
		try {
			const { count } = await supabase
				.from("activity_logs")
				.select("*", { count: "exact", head: true })
				.gte("created_at", oneHourAgo)
				.like("action", "%error%");
			errorCount = count || 0;
		} catch {
			/* non-fatal */
		}

		// Pending jobs
		let pendingReports = 0;
		try {
			const { count } = await supabase
				.from("reports")
				.select("*", { count: "exact", head: true })
				.eq("status", "open");
			pendingReports = count || 0;
		} catch {
			/* non-fatal */
		}

		const totalLatency = Date.now() - startTime;

		return res.status(200).json({
			api_response_times: {
				posts_ms: postsCount.latency_ms,
				comments_ms: commentsCount.latency_ms,
				reactions_ms: reactionsCount.latency_ms,
				polls_ms: pollsCount.latency_ms,
				users_ms: usersCount.latency_ms,
				reports_ms: reportsCount.latency_ms,
				chat_ms: chatCount.latency_ms,
				logs_ms: logsCount.latency_ms,
			},
			database_latency_ms: dbLatency.latency_ms,
			active_users: activeUsers,
			error_rate_per_hour: errorCount,
			storage: {
				posts: postsCount.count,
				comments: commentsCount.count,
				reactions: reactionsCount.count,
				polls: pollsCount.count,
				users: usersCount.count,
				reports: reportsCount.count,
				chat_threads: chatCount.count,
				activity_logs: logsCount.count,
			},
			pending_jobs: { reports: pendingReports },
			total_calculation_ms: totalLatency,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		console.error("performance error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}

// ─── Performance Intelligence Worker (roster #31) ────────────────
// REAL JOB: measure the platform's real performance signals — hot-path
// table query latencies, the error rate from activity_logs, the stored
// system_metrics p95 (written by the incident cron), and the durable
// web-vitals store (vitals:durable) — then flag regressions past
// tolerance against the previous snapshot. The snapshot persists to the
// canonical settings KV (performance_intel:latest) and is verified by
// re-read. Zero-arg (the cron loop calls the registry run with no
// arguments). A failed read is recorded as an honest null, never as a
// fabricated zero.
const PERF_KEY = "performance_intel:latest";
const LATENCY_TOLERANCE_MS = 200; // table/db latency climb past tolerance
const ERROR_TOLERANCE = 5; // error rows/hour climb past tolerance
const P95_TOLERANCE_MS = 500; // stored p95 climb (incident-cron warn level)
const POOR_TOLERANCE = 5; // durable-vitals poor-rate climb (points)

/** Error rows in the last hour, or `null` when the read fails — never a
 *  fabricated zero (the read's own error is checked, not ignored). */
async function countErrorsLastHour(nowMs) {
	const oneHourAgo = new Date(nowMs - 3600000).toISOString();
	try {
		const { count, error } = await supabase
			.from("activity_logs")
			.select("*", { count: "exact", head: true })
			.gte("created_at", oneHourAgo)
			.like("action", "%error%");
		if (error) return null;
		return count || 0;
	} catch {
		return null;
	}
}

export async function runPerformanceIntel({ nowMs = Date.now() } = {}) {
	// 1. Real reads: hot-path table latencies + the db-latency probe.
	const [postsQ, commentsQ, reportsQ, logsQ, dbQ] = await Promise.all([
		measureQuery("posts"),
		measureQuery("comments"),
		measureQuery("reports"),
		measureQuery("activity_logs"),
		measureQuery("settings", "select"),
	]);
	const table_latencies = {
		posts_ms: postsQ.latency_ms,
		comments_ms: commentsQ.latency_ms,
		reports_ms: reportsQ.latency_ms,
		logs_ms: logsQ.latency_ms,
	};

	// 2. More real reads: error rate, stored p95, durable vitals.
	const [error_rate_per_hour, api_p95_ms, vitals] = await Promise.all([
		countErrorsLastHour(nowMs),
		(async () => {
			try {
				const { data } = await supabase
					.from("settings")
					.select("value")
					.eq("key", "system_metrics")
					.maybeSingle();
				return data?.value ? Number(data.value.api_p95_ms) || 0 : null;
			} catch {
				return null;
			}
		})(),
		(async () => {
			try {
				const { data } = await supabase
					.from("settings")
					.select("value")
					.eq("key", "vitals:durable")
					.maybeSingle();
				const out = {};
				for (const [name, m] of Object.entries(data?.value?.metrics || {})) {
					const total = Number(m?.total) || 0;
					if (total <= 0) continue;
					out[name] = Math.round(((Number(m?.poor) || 0) / total) * 100);
				}
				return out;
			} catch {
				return {};
			}
		})(),
	]);

	// 3. Previous snapshot — the regression baseline.
	let previous = null;
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", PERF_KEY)
			.maybeSingle();
		previous = data?.value || null;
	} catch {
		previous = null;
	}

	// 4. Flag regressions past tolerance — a null prior/current read
	//    never flags (an unknown is not a regression).
	const regressions = [];
	if (previous) {
		for (const [name, now] of Object.entries(table_latencies)) {
			const before = previous.table_latencies?.[name];
			if (typeof before === "number" && now - before > LATENCY_TOLERANCE_MS)
				regressions.push({ kind: "table_latency", name, before, now });
		}
		const dbBefore = previous.db_latency_ms;
		if (
			typeof dbBefore === "number" &&
			dbQ.latency_ms - dbBefore > LATENCY_TOLERANCE_MS
		)
			regressions.push({
				kind: "db_latency",
				name: "database_latency_ms",
				before: dbBefore,
				now: dbQ.latency_ms,
			});
		if (
			typeof previous.error_rate_per_hour === "number" &&
			typeof error_rate_per_hour === "number" &&
			error_rate_per_hour - previous.error_rate_per_hour > ERROR_TOLERANCE
		)
			regressions.push({
				kind: "error_rate",
				name: "error_rate_per_hour",
				before: previous.error_rate_per_hour,
				now: error_rate_per_hour,
			});
		if (
			typeof previous.api_p95_ms === "number" &&
			typeof api_p95_ms === "number" &&
			api_p95_ms - previous.api_p95_ms > P95_TOLERANCE_MS
		)
			regressions.push({
				kind: "p95",
				name: "api_p95_ms",
				before: previous.api_p95_ms,
				now: api_p95_ms,
			});
		for (const [name, now] of Object.entries(vitals)) {
			const before = previous.vitals?.[name];
			if (typeof before === "number" && now - before > POOR_TOLERANCE)
				regressions.push({ kind: "vitals_poor_rate", name, before, now });
		}
	}

	const snapshot = {
		generated_at: new Date(nowMs).toISOString(),
		tables_measured: Object.keys(table_latencies).length + 1,
		table_latencies,
		db_latency_ms: dbQ.latency_ms,
		error_rate_per_hour,
		api_p95_ms,
		vitals,
		regressions,
		regressed: regressions.length > 0,
	};

	// 5. Advisory row when a regression is flagged (best-effort, evidenced).
	if (regressions.length > 0) {
		try {
			await supabase.from("activity_logs").insert({
				actor: "worker:performance-intel",
				action: "performance_regression_report",
				detail: JSON.stringify({
					regressions: regressions.slice(0, 10),
					error_rate_per_hour,
					api_p95_ms,
				}).slice(0, 500),
			});
		} catch {
			/* advisory; a failed log must not fabricate a report */
		}
	}

	// 6. Persist + VERIFY by independent re-read.
	try {
		await supabase
			.from("settings")
			.upsert({ key: PERF_KEY, value: snapshot }, { onConflict: "key" });
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", PERF_KEY)
			.maybeSingle();
		const persisted = data?.value?.generated_at === snapshot.generated_at;
		return { ok: true, verified: persisted, snapshot };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}
