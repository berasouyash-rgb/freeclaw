// ─── Search Quality Tracker ────────────────────────────────────
// GET  /api/search-quality?action=report  — Search quality report
// POST /api/search-quality                 — Record search event
// GET  /api/search-quality?action=metrics  — Search performance metrics
//
// Tracks:
//   - Zero-result queries
//   - Search latency
//   - Repeated searches (user searched same term)
//   - Clicked results (post-search interaction)
//   - Search volume by time period
//   - Category distribution

import { cors, isAdmin } from "./_auth.js";
import { logger } from "./_observability.js";
import supabase from "./_db-client.js";

// ─── In-memory search telemetry (windowed) ───────────────────
const SEARCH_WINDOW_MS = 3600_000; // 1 hour window
const MAX_EVENTS = 5000;
const SEARCH_DURABLE_KEY = "search_events:durable";
const DURABLE_FLUSH_MS = 60_000; // flush at most once per minute

const _searchEvents = []; // { query, results, latency_ms, timestamp, user_id, clicked }
const _queryCounts = new Map(); // query → count (for repeat detection)
const _zeroResultQueries = new Map(); // query → { count, first_seen, last_seen }

// ── Durable telemetry layer (survives cold starts) ─────────────
// Every search event merges into an in-memory delta; the delta flushes to
// the canonical settings KV at most once per minute (a cold start loses at
// most 60s of evidence instead of the whole window). The durable store is
// CUMULATIVE — it never replaces the per-window percentiles, which are a
// property of the serving instance by definition.
let _durableTotal = 0;
let _durableZero = 0;
let _durableZeroMap = {}; // query → count (durable delta)
let _lastFlush = 0;

async function flushDurable() {
	if (_durableTotal === 0 && _durableZero === 0) return;
	const now = Date.now();
	if (now - _lastFlush < DURABLE_FLUSH_MS) return;
	_lastFlush = now;
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", SEARCH_DURABLE_KEY)
			.maybeSingle();
		const stored = data?.value || {};
		const zeroMap = { ...(stored.zero_result_map || {}) };
		for (const [q, n] of Object.entries(_durableZeroMap)) {
			zeroMap[q] = (zeroMap[q] || 0) + n;
		}
		await supabase.from("settings").upsert(
			{
				key: SEARCH_DURABLE_KEY,
				value: {
					total_searches: (stored.total_searches || 0) + _durableTotal,
					zero_result_count: (stored.zero_result_count || 0) + _durableZero,
					zero_result_map: zeroMap,
					updated_at: new Date(now).toISOString(),
				},
			},
			{ onConflict: "key" },
		);
		_durableTotal = 0;
		_durableZero = 0;
		_durableZeroMap = {};
	} catch {
		/* best-effort; the deltas retry on the next event */
	}
}

/** Read the durable cumulative search telemetry (verified by the caller). */
export async function readDurableSearch() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", SEARCH_DURABLE_KEY)
			.maybeSingle();
		const v = data?.value || {};
		return {
			ok: true,
			total_searches: Number(v.total_searches) || 0,
			zero_result_count: Number(v.zero_result_count) || 0,
			zero_result_map: v.zero_result_map || {},
		};
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}

/**
 * Record a search event. Called from the search API handler.
 */
export function recordSearchEvent({ query, results = 0, latency_ms = 0, user_id }) {
	const now = Date.now();

	_searchEvents.push({
		query: (query || "").trim().toLowerCase(),
		results,
		latency_ms,
		timestamp: now,
		user_id: user_id || "anonymous",
		clicked: false,
	});

	// Track repeat queries
	const q = (query || "").trim().toLowerCase();
	if (q) {
		_queryCounts.set(q, (_queryCounts.get(q) || 0) + 1);

		// Track zero-result queries
		if (results === 0) {
			const existing = _zeroResultQueries.get(q);
			if (existing) {
				existing.count++;
				existing.last_seen = now;
			} else {
				_zeroResultQueries.set(q, { count: 1, first_seen: now, last_seen: now });
			}
		}
	}

	// Durable merge: the delta flushes to the KV at most once per minute.
	_durableTotal += 1;
	if (results === 0 && q) {
		_durableZero += 1;
		_durableZeroMap[q] = (_durableZeroMap[q] || 0) + 1;
	}
	flushDurable().catch(() => {});

	// Enforce window size
	if (_searchEvents.length > MAX_EVENTS) {
		_searchEvents.splice(0, _searchEvents.length - MAX_EVENTS);
	}
}

/**
 * Record a search result click.
 */
export function recordSearchClick(query) {
	const q = (query || "").trim().toLowerCase();
	// Find the most recent matching search event
	for (let i = _searchEvents.length - 1; i >= 0; i--) {
		if (_searchEvents[i].query === q && !_searchEvents[i].clicked) {
			_searchEvents[i].clicked = true;
			break;
		}
	}
}

// ─── Cleanup old events ──────────────────────────────────────
function cleanupOldEvents() {
	const cutoff = Date.now() - SEARCH_WINDOW_MS;
	while (_searchEvents.length > 0 && _searchEvents[0].timestamp < cutoff) {
		_searchEvents.shift();
	}
}

// Periodic cleanup
setInterval(cleanupOldEvents, 300_000).unref();

// ─── Metrics calculation ─────────────────────────────────────
export function calculateMetrics() {
	const now = Date.now();
	const last5m = _searchEvents.filter((e) => now - e.timestamp < 300_000);
	const last1h = _searchEvents.filter((e) => now - e.timestamp < 3_600_000);

	const totalSearches = last1h.length;
	const zeroResults = last1h.filter((e) => e.results === 0).length;
	const latencies = last1h.map((e) => e.latency_ms).filter((l) => l > 0);
	const clickedSearches = last1h.filter((e) => e.clicked).length;

	const sortedLatencies = [...latencies].sort((a, b) => a - b);
	const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0;
	const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
	const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0;

	// Repeat queries
	const repeatQueries = [..._queryCounts.entries()]
		.filter(([_, count]) => count > 1)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 20);

	// Top zero-result queries
	const topZeroResults = [..._zeroResultQueries.entries()]
		.sort((a, b) => b[1].count - a[1].count)
		.slice(0, 20)
		.map(([query, data]) => ({ query, ...data }));

	return {
		period: "last_1h",
		total_searches: totalSearches,
		zero_result_rate: totalSearches > 0 ? ((zeroResults / totalSearches) * 100).toFixed(1) + "%" : "0%",
		zero_result_count: zeroResults,
		click_rate: totalSearches > 0 ? ((clickedSearches / totalSearches) * 100).toFixed(1) + "%" : "0%",
		latency: {
			p50: Math.round(p50),
			p95: Math.round(p95),
			p99: Math.round(p99),
			avg: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
		},
		repeat_queries: repeatQueries.map(([query, count]) => ({ query, count })),
		top_zero_result_queries: topZeroResults,
		recent_5m: {
			total: last5m.length,
			zero_results: last5m.filter((e) => e.results === 0).length,
		},
	};
}

// ─── Search Intelligence run (roster #16) ────────────────────
// Measures the real search-quality metrics of the serving instance AND the
// durable cumulative telemetry (which survives cold starts), logs an
// advisory report when the zero-result rate or latency degrades past this
// module's own thresholds, and persists a verified snapshot
// (search_intel:latest). Zero-arg (the cron loop calls the registry run
// with no arguments).
export async function runSearchIntel() {
	const m = calculateMetrics();
	const durable = await readDurableSearch();

	// Degradation check: the live window first; when the window is empty the
	// durable cumulative rate still measures real usage across cold starts.
	const durableTotal = durable.ok ? durable.total_searches : 0;
	const durableZeroRate =
		durable.ok && durableTotal > 0
			? Math.round((durable.zero_result_count / durableTotal) * 1000) / 10
			: 0;
	const zeroRate = parseFloat(m.zero_result_rate) || 0;
	const measured = m.total_searches > 0 || durableTotal > 0;
	const degraded =
		measured && (zeroRate > 10 || durableZeroRate > 10 || m.latency.avg > 500);

	let logged = 0;
	if (degraded) {
		try {
			const { data } = await supabase
				.from("activity_logs")
				.insert({
					actor: "worker:search-intel",
					action: "search_quality_report",
					detail: JSON.stringify({
						zero_result_rate: m.zero_result_rate,
						durable_zero_result_rate: `${durableZeroRate}%`,
						avg_latency_ms: m.latency.avg,
						p95_ms: m.latency.p95,
						total_searches: m.total_searches,
						durable_total: durableTotal,
					}).slice(0, 500),
				})
				.select("id");
			logged = (data || []).length;
		} catch {
			/* advisory; a failed log must not fabricate a report */
		}
	}

	const snapshot = {
		generated_at: new Date().toISOString(),
		total_searches: m.total_searches,
		zero_result_rate: m.zero_result_rate,
		avg_latency_ms: m.latency.avg,
		p95_ms: m.latency.p95,
		click_rate: m.click_rate,
		durable: durable.ok
			? {
					total_searches: durableTotal,
					zero_result_count: durable.zero_result_count,
					zero_result_rate: `${durableZeroRate}%`,
					top_zero_result_queries: Object.entries(durable.zero_result_map)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 5)
						.map(([query, count]) => ({ query, count })),
				}
			: null,
		degraded,
	};
	try {
		await supabase.from("settings").upsert(
			{ key: "search_intel:latest", value: snapshot },
			{ onConflict: "key" },
		);
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "search_intel:latest")
			.maybeSingle();
		const persisted = data?.value?.generated_at === snapshot.generated_at;
		return { ok: true, verified: persisted, ...snapshot, logged };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}

// ─── Zero-result gap recovery (roster: search-gap-recovery) ───
// Tracking alone never helped a user find anything: queries that repeatedly
// return zero results are filed as actionable knowledge gaps (durable,
// deduplicated) so curators/admins can add synonyms, content, or aliases.
// TRIGGER: cron tick. OBSERVE: in-memory zero-result tallies. ACT: file a
// gap per qualifying query. VERIFY: re-read the filed set.
const SEARCH_GAPS_KEY = "search_gaps_filed";
const GAP_THRESHOLD = 3;
const GAP_REFILE_MS = 7 * 24 * 3600_000;

async function readFiledGaps() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", SEARCH_GAPS_KEY)
			.maybeSingle();
		return data?.value?.gaps || {};
	} catch {
		return {};
	}
}

export async function recoverSearchGaps() {
	const result = {
		checked: 0,
		gaps_filed: [],
		skipped_filed: 0,
		verified: false,
		errors: [],
	};
	let filed = await readFiledGaps();
	const now = Date.now();
	const qualifying = [..._zeroResultQueries.entries()].filter(
		([_, d]) => d.count >= GAP_THRESHOLD,
	);
	result.checked = qualifying.length;
	if (!qualifying.length) {
		result.verified = true;
		return { ok: true, ...result };
	}
	const { queueImprovement } = await import("./_improvements.js");
	for (const [query, d] of qualifying) {
		try {
			const prev = filed[query];
			if (prev && now - new Date(prev).getTime() < GAP_REFILE_MS) {
				result.skipped_filed += 1;
				continue;
			}
			const first = new Date(d.first_seen).toISOString();
			const last = new Date(d.last_seen).toISOString();
			await queueImprovement({
				title: `Search gap: "${query}" returned nothing ${d.count}×`,
				detail: `Users searched "${query}" ${d.count} times (first ${first}, last ${last}) with zero results. Add a synonym, alias, or content so this finds something.`,
				category: "search",
				priority: d.count >= 10 ? "high" : "medium",
				source: "search-gap-recovery",
			});
			filed[query] = new Date(now).toISOString();
			result.gaps_filed.push(query);
		} catch (err) {
			result.errors.push({ query, error: err?.message || String(err) });
		}
	}
	try {
		await supabase.from("settings").upsert(
			{ key: SEARCH_GAPS_KEY, value: { gaps: filed, updated_at: new Date(now).toISOString() } },
			{ onConflict: "key" },
		);
	} catch (err) {
		result.errors.push({ query: "*", error: err?.message || String(err) });
		return { ok: false, ...result };
	}
	// VERIFY: re-read the filed set; every filed gap must be present.
	const reread = await readFiledGaps();
	const missing = result.gaps_filed.filter((q) => !reread[q]);
	if (missing.length) {
		result.errors.push({ query: "*", error: `filed gaps missing on re-read: ${missing.join(", ")}` });
		return { ok: false, ...result };
	}
	result.verified = true;
	return { ok: true, ...result };
}

// ─── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	// POST — record a search event (called from search API)
	if (req.method === "POST") {
		const { query, results, latency_ms, user_id, clicked } = req.body || {};

		if (clicked) {
			recordSearchClick(query);
		} else {
			recordSearchEvent({ query, results, latency_ms, user_id });
		}

		return res.status(200).json({ ok: true });
	}

	// GET — requires admin
	const authed = await isAdmin(req);
	if (!authed) {
		return res.status(401).json({ error: "Admin access required" });
	}

	const action = req.query.action || "metrics";

	if (action === "metrics") {
		return res.status(200).json(calculateMetrics());
	}

	if (action === "report") {
		const metrics = calculateMetrics();

		// Add recommendations
		const recommendations = [];
		const zeroRate = parseFloat(metrics.zero_result_rate);
		const avgLatency = metrics.latency.avg;

		if (zeroRate > 10) {
			recommendations.push({
				severity: "high",
				message: `Zero-result rate is ${metrics.zero_result_rate} — consider improving search indexing or synonyms`,
			});
		} else if (zeroRate > 5) {
			recommendations.push({
				severity: "medium",
				message: `Zero-result rate is ${metrics.zero_result_rate} — monitor for trends`,
			});
		}

		if (avgLatency > 500) {
			recommendations.push({
				severity: "high",
				message: `Average search latency is ${avgLatency}ms — investigate search performance`,
			});
		} else if (avgLatency > 200) {
			recommendations.push({
				severity: "medium",
				message: `Average search latency is ${avgLatency}ms — may benefit from indexing`,
			});
		}

		if (metrics.repeat_queries.length > 5) {
			recommendations.push({
				severity: "low",
				message: `${metrics.repeat_queries.length} queries are being repeated — consider improving result quality`,
			});
		}

		if (recommendations.length === 0) {
			recommendations.push({
				severity: "info",
				message: "Search quality looks healthy",
			});
		}

		return res.status(200).json({
			metrics,
			recommendations,
			reported_at: new Date().toISOString(),
		});
	}

	return res.status(400).json({ error: "Unknown action" });
}
