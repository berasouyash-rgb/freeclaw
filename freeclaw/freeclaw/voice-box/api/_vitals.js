// ─── Web Vitals Receiver ─────────────────────────────────────────
// Receives real Core Web Vitals (LCP, FID, CLS, TTFB, INP) from the
// frontend via POST /api/vitals and aggregates them for the admin
// dashboard.  Every number on the admin page comes from real browser
// telemetry — nothing is simulated.
import { securityCheck } from "./_security.js";
import supabase from "./_db-client.js";

// In-memory aggregation (resets on cold start — acceptable for Vercel
// serverless; in a persistent process this would live in Redis/DB).
const _buckets = new Map(); // name → { good, needsImprovement, poor, total, sum, p50[], recent[] }

const MAX_RECENT = 200; // keep last N per metric for percentile calc
const VITALS_KEY = "vitals:durable";

// ── Durable aggregation (survives cold starts) ─────────────────
// Cumulative counts only (good/poor/total/sum) — the recent[] ring stays
// in-memory because percentiles are per-window by definition. Every POST
// merges into the durable KV so the UX Intelligence worker measures real
// accumulated telemetry, not a single warm instance's window.
async function readDurable() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", VITALS_KEY)
			.maybeSingle();
		return data?.value?.metrics || {};
	} catch {
		return {};
	}
}

async function writeDurable(metrics) {
	try {
		await supabase.from("settings").upsert(
			{ key: VITALS_KEY, value: { metrics, updated_at: new Date().toISOString() } },
			{ onConflict: "key" },
		);
	} catch {
		/* best-effort; the in-memory aggregation still answers */
	}
}

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
	// securityCheck returns { ok, status, error, retryAfter } — enforce it
	// properly instead of comparing the whole object to null (which never
	// matched, so abusive traffic was never actually limited).
	const sec = securityCheck(req);
	if (!sec.ok) {
		if (sec.retryAfter) res.setHeader("Retry-After", String(sec.retryAfter));
		return res.status(sec.status || 429).json({ error: sec.error || "rate limited" });
	}

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

		// Durable merge: cumulative counts survive cold starts.
		try {
			const durable = await readDurable();
			const merged = { ...durable };
			for (const m of metrics) {
				if (!m.name || typeof m.value !== "number") continue;
				const d = merged[m.name] || { good: 0, needsImprovement: 0, poor: 0, total: 0, sum: 0 };
				d.total += 1;
				d.sum += m.value;
				if (m.rating === "good") d.good += 1;
				else if (m.rating === "needs-improvement") d.needsImprovement += 1;
				else if (m.rating === "poor") d.poor += 1;
				merged[m.name] = d;
			}
			await writeDurable(merged);
		} catch {
			/* the in-memory aggregation already received the metrics */
		}

		return res.status(200).json({ ok: true, received: metrics.length });
	}

	// ── GET /api/vitals — admin dashboard reads aggregated data ──
	if (req.method === "GET") {
		const durable = await readDurable();
		const result = {};
		const names = new Set([..._buckets.keys(), ...Object.keys(durable)]);
		for (const name of names) {
			const b = _buckets.get(name);
			const d = durable[name] || {};
			const total = (b?.total || 0) + (d.total || 0);
			const good = (b?.good || 0) + (d.good || 0);
			const sum = (b?.sum || 0) + (d.sum || 0);
			result[name] = {
				total,
				good,
				needsImprovement: (b?.needsImprovement || 0) + (d.needsImprovement || 0),
				poor: (b?.poor || 0) + (d.poor || 0),
				goodRate: total > 0 ? Math.round((good / total) * 100) : 0,
				avg: total > 0 ? Math.round(sum / total) : 0,
				// Percentiles are per-window: they come from the in-memory
				// ring only — never fabricated from cumulative counts.
				p50: percentile(b?.recent || [], 50),
				p75: percentile(b?.recent || [], 75),
				p95: percentile(b?.recent || [], 95),
				p99: percentile(b?.recent || [], 99),
			};
		}

		return res.status(200).json({ ok: true, vitals: result });
	}

	res.setHeader("Allow", "GET, POST");
	res.status(405).json({ error: "method not allowed" });
}
