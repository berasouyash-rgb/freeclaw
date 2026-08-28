// ─── Web Vitals Receiver ─────────────────────────────────────────
// Receives real Core Web Vitals (LCP, FID, CLS, TTFB, INP) from the
// frontend via POST /api/vitals and aggregates them for the admin
// dashboard.  Every number on the admin page comes from real browser
// telemetry — nothing is simulated.
import { securityCheck } from "./_security.js";

// In-memory aggregation (resets on cold start — acceptable for Vercel
// serverless; in a persistent process this would live in Redis/DB).
const _buckets = new Map(); // name → { good, needsImprovement, poor, total, sum, p50[], recent[] }

const MAX_RECENT = 200; // keep last N per metric for percentile calc

function ensure(name) {
	if (!_buckets.has(name)) {
		_buckets.set(name, {
			good: 0,
			needsImprovement: 0,
			poor: 0,
			total: 0,
			sum: 0,
			recent: [], // ring buffer of recent values
		});
	}
	return _buckets.get(name);
}

function percentile(arr, p) {
	if (!arr.length) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, idx)];
}

export default async function handler(req, res) {
	const identity = securityCheck(req);
	if (identity === null) return res.status(429).json({ error: "rate limited" });

	// ── POST /api/vitals — receive vitals from frontend ──────────
	if (req.method === "POST") {
		const { metrics } = req.body || {};
		if (!Array.isArray(metrics) || metrics.length === 0) {
			return res.status(400).json({ error: "metrics array required" });
		}

		for (const m of metrics) {
			if (!m.name || typeof m.value !== "number") continue;
			const b = ensure(m.name);
			b.total++;
			b.sum += m.value;
			b.recent.push(m.value);
			if (b.recent.length > MAX_RECENT) b.recent.shift();

			if (m.rating === "good") b.good++;
			else if (m.rating === "needs-improvement") b.needsImprovement++;
			else if (m.rating === "poor") b.poor++;
		}

		return res.status(200).json({ ok: true, received: metrics.length });
	}

	// ── GET /api/vitals — admin dashboard reads aggregated data ──
	if (req.method === "GET") {
		const result = {};
		for (const [name, b] of _buckets) {
			const recent = b.recent;
			result[name] = {
				total: b.total,
				good: b.good,
				needsImprovement: b.needsImprovement,
				poor: b.poor,
				goodRate: b.total > 0 ? Math.round((b.good / b.total) * 100) : 0,
				avg: b.total > 0 ? Math.round(b.sum / b.total) : 0,
				p50: percentile(recent, 50),
				p75: percentile(recent, 75),
				p95: percentile(recent, 95),
				p99: percentile(recent, 99),
			};
		}

		return res.status(200).json({ ok: true, vitals: result });
	}

	res.setHeader("Allow", "GET, POST");
	res.status(405).json({ error: "method not allowed" });
}
