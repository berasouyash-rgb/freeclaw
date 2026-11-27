// ─── Feature Health Metrics ────────────────────────────────────
// GET  /api/feature-health                — All feature health summary
// GET  /api/feature-health?feature=X      — Single feature detail
// POST /api/feature-health                — Record a feature event
//
// Tracks for each feature:
//   - Total invocations
//   - Success rate
//   - Error rate
//   - Average latency
//   - Error breakdown by type
//   - Time-series (last 1h bucketed by 5m)
//
// Features: feed, posts, comments, polls, search, notifications,
//           complaints, suggestions, inbox, profile, settings, admin

import { cors, isAdmin } from "./_auth.js";
import { logger } from "./_observability.js";

// ─── Feature definitions ─────────────────────────────────────
const FEATURE_DEFINITIONS = {
	feed: { label: "Feed", category: "user" },
	posts: { label: "Posts", category: "user" },
	comments: { label: "Comments", category: "user" },
	polls: { label: "Polls", category: "user" },
	search: { label: "Search", category: "user" },
	notifications: { label: "Notifications", category: "user" },
	complaints: { label: "Complaints", category: "user" },
	suggestions: { label: "Suggestions", category: "user" },
	inbox: { label: "Inbox", category: "user" },
	profile: { label: "Profile", category: "user" },
	settings: { label: "Settings", category: "user" },
	admin_reports: { label: "Admin Reports", category: "admin" },
	admin_feed: { label: "Admin Feed", category: "admin" },
	admin_users: { label: "Admin Users", category: "admin" },
	admin_workforce: { label: "Admin Workforce", category: "admin" },
	admin_analytics: { label: "Admin Analytics", category: "admin" },
	admin_settings: { label: "Admin Settings", category: "admin" },
};

// ─── In-memory event store (windowed) ────────────────────────
const WINDOW_MS = 3600_000; // 1 hour
const BUCKET_MS = 300_000; // 5 minutes
const MAX_EVENTS = 10000;

const _events = []; // { feature, success, latency_ms, error_type, timestamp }
const _featureEvents = new Map(); // feature → { total, success, errors, latencies[] }

/**
 * Record a feature event. Called from frontend or API handlers.
 */
export function recordFeatureEvent({ feature, success = true, latency_ms = 0, error_type }) {
	if (!FEATURE_DEFINITIONS[feature]) return;

	const now = Date.now();
	_events.push({
		feature,
		success,
		latency_ms: Math.round(latency_ms),
		error_type: error_type || null,
		timestamp: now,
	});

	// Update per-feature counters
	let counters = _featureEvents.get(feature);
	if (!counters) {
		counters = { total: 0, success: 0, errors: 0, errorTypes: new Map() };
		_featureEvents.set(feature, counters);
	}
	counters.total++;
	if (success) counters.success++;
	else {
		counters.errors++;
		if (error_type) {
			counters.errorTypes.set(error_type, (counters.errorTypes.get(error_type) || 0) + 1);
		}
	}

	// Enforce window
	if (_events.length > MAX_EVENTS) {
		_events.splice(0, _events.length - MAX_EVENTS);
	}
}

// ─── Cleanup ─────────────────────────────────────────────────
function cleanupOldEvents() {
	const cutoff = Date.now() - WINDOW_MS;
	while (_events.length > 0 && _events[0].timestamp < cutoff) {
		_events.shift();
	}
}
setInterval(cleanupOldEvents, 300_000).unref();

// ─── Metric calculation ──────────────────────────────────────
function calculateFeatureMetrics(feature) {
	const now = Date.now();
	const featureEvents = _events.filter((e) => e.feature === feature);
	const recentEvents = featureEvents.filter((e) => now - e.timestamp < WINDOW_MS);

	const total = recentEvents.length;
	const successes = recentEvents.filter((e) => e.success).length;
	const errors = total - successes;
	const latencies = recentEvents.map((e) => e.latency_ms).filter((l) => l > 0);
	const sortedLatencies = [...latencies].sort((a, b) => a - b);

	// Error breakdown
	const errorBreakdown = {};
	for (const e of recentEvents) {
		if (!e.success && e.error_type) {
			errorBreakdown[e.error_type] = (errorBreakdown[e.error_type] || 0) + 1;
		}
	}

	// Time-series (5m buckets)
	const buckets = [];
	for (let i = 0; i < 12; i++) {
		const bucketStart = now - (i + 1) * BUCKET_MS;
		const bucketEnd = now - i * BUCKET_MS;
		const bucketEvents = recentEvents.filter(
			(e) => e.timestamp >= bucketStart && e.timestamp < bucketEnd,
		);
		buckets.unshift({
			time: new Date(bucketStart).toISOString(),
			total: bucketEvents.length,
			success: bucketEvents.filter((e) => e.success).length,
			errors: bucketEvents.filter((e) => !e.success).length,
			avg_latency:
				bucketEvents.length > 0
					? Math.round(
							bucketEvents.reduce((sum, e) => sum + e.latency_ms, 0) / bucketEvents.length,
					  )
					: 0,
		});
	}

	return {
		feature,
		label: FEATURE_DEFINITIONS[feature]?.label || feature,
		category: FEATURE_DEFINITIONS[feature]?.category || "unknown",
		total,
		success_rate: total > 0 ? ((successes / total) * 100).toFixed(1) + "%" : "N/A",
		error_rate: total > 0 ? ((errors / total) * 100).toFixed(1) + "%" : "N/A",
		successes,
		errors,
		latency: {
			p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0,
			p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0,
			avg: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
		},
		error_breakdown: errorBreakdown,
		time_series: buckets,
	};
}

function calculateAllMetrics() {
	const now = Date.now();
	const recentEvents = _events.filter((e) => now - e.timestamp < WINDOW_MS);

	const summary = {};
	for (const [feature, def] of Object.entries(FEATURE_DEFINITIONS)) {
		const featureEvents = recentEvents.filter((e) => e.feature === feature);
		const total = featureEvents.length;
		const successes = featureEvents.filter((e) => e.success).length;
		const errors = total - successes;
		const latencies = featureEvents.map((e) => e.latency_ms).filter((l) => l > 0);

		// Health assessment
		const errorRate = total > 0 ? errors / total : 0;
		const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
		let health = "healthy";
		if (errorRate > 0.1) health = "critical";
		else if (errorRate > 0.05) health = "degraded";
		else if (avgLatency > 2000) health = "warning";

		summary[feature] = {
			label: def.label,
			category: def.category,
			total,
			success_rate: total > 0 ? ((successes / total) * 100).toFixed(1) + "%" : "N/A",
			error_rate: total > 0 ? ((errors / total) * 100).toFixed(1) + "%" : "N/A",
			avg_latency: Math.round(avgLatency),
			health,
		};
	}

	return summary;
}

// ─── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	// POST — record a feature event
	if (req.method === "POST") {
		const { feature, success, latency_ms, error_type } = req.body || {};
		recordFeatureEvent({ feature, success, latency_ms, error_type });
		return res.status(200).json({ ok: true });
	}

	// GET — requires admin
	const authed = await isAdmin(req);
	if (!authed) {
		return res.status(401).json({ error: "Admin access required" });
	}

	const feature = req.query.feature;

	if (feature) {
		if (!FEATURE_DEFINITIONS[feature]) {
			return res.status(400).json({
				error: "Unknown feature",
				available: Object.keys(FEATURE_DEFINITIONS),
			});
		}
		return res.status(200).json(calculateFeatureMetrics(feature));
	}

	// All features summary
	const summary = calculateAllMetrics();
	const totalEvents = _events.filter((e) => Date.now() - e.timestamp < WINDOW_MS).length;
	const totalErrors = _events.filter(
		(e) => Date.now() - e.timestamp < WINDOW_MS && !e.success,
	).length;

	return res.status(200).json({
		features: summary,
		overview: {
			total_events: totalEvents,
			total_errors: totalErrors,
			overall_error_rate:
				totalEvents > 0 ? ((totalErrors / totalEvents) * 100).toFixed(1) + "%" : "0%",
			tracked_features: Object.keys(FEATURE_DEFINITIONS).length,
			window: "1h",
		},
		reported_at: new Date().toISOString(),
	});
}
