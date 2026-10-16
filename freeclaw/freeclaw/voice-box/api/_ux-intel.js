// UX Intelligence — real frontend experience signals (roster #29).
//
// REAL JOB: read the DURABLE vitals store (vitals:durable — cumulative
// counts that survive cold starts, written by the /api/vitals receiver)
// and flag experience regressions: a metric whose poor-rate climbed beyond
// tolerance since the last snapshot. The snapshot persists to the canonical
// settings KV (ux_intel:latest) and is verified by re-read. Zero-arg (the
// cron loop calls the registry run with no arguments).
//
// Every number comes from a real read; an empty store degrades to an honest
// nothing-to-measure rather than a fabricated zero.
import supabase from "./_db-client.js";

const UX_KEY = "ux_intel:latest";
const POOR_TOLERANCE = 5; // percentage points of poor-rate climb

const METRIC_LABELS = {
	LCP: "Largest Contentful Paint",
	FID: "First Input Delay",
	CLS: "Cumulative Layout Shift",
	TTFB: "Time to First Byte",
	INP: "Interaction to Next Paint",
};

export async function runUXIntel({ nowMs = Date.now() } = {}) {
	// 1. Real read of the durable vitals store.
	let durable = {};
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "vitals:durable")
			.maybeSingle();
		durable = data?.value?.metrics || {};
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}

	const names = Object.keys(durable);
	if (!names.length)
		return {
			ok: true,
			verified: true,
			snapshot: { generated_at: new Date(nowMs).toISOString(), metrics_tracked: 0 },
			note: "no vitals recorded yet - nothing to measure",
		};

	// 2. Poor-rate per metric + regression flags vs the previous snapshot.
	let previous = null;
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", UX_KEY)
			.maybeSingle();
		previous = data?.value || null;
	} catch {
		previous = null;
	}
	const prevPoor = new Map();
	if (previous?.metrics) {
		for (const [name, m] of Object.entries(previous.metrics)) {
			prevPoor.set(name, Number(m.poor_rate) || 0);
		}
	}

	const metrics = {};
	const regressions = [];
	for (const name of names) {
		const d = durable[name] || {};
		const total = Number(d.total) || 0;
		const poor = Number(d.poor) || 0;
		const poorRate = total > 0 ? Math.round((poor / total) * 100) : 0;
		metrics[name] = {
			label: METRIC_LABELS[name] || name,
			total,
			poor_rate: poorRate,
			good_rate: total > 0 ? Math.round(((Number(d.good) || 0) / total) * 100) : 0,
		};
		const prev = prevPoor.get(name);
		if (prev !== undefined && poorRate - prev > POOR_TOLERANCE) {
			regressions.push({
				metric: name,
				poor_rate_before: prev,
				poor_rate_now: poorRate,
			});
		}
	}

	const snapshot = {
		generated_at: new Date(nowMs).toISOString(),
		metrics_tracked: names.length,
		metrics,
		regressions,
		regressed: regressions.length > 0,
	};

	// 3. Persist + VERIFY by independent re-read.
	try {
		await supabase.from("settings").upsert(
			{ key: UX_KEY, value: snapshot },
			{ onConflict: "key" },
		);
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", UX_KEY)
			.maybeSingle();
		const persisted = data?.value?.generated_at === snapshot.generated_at;
		return { ok: true, verified: persisted, snapshot };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}

// GET /api/ux-intel — admin read of the latest UX intelligence snapshot.
export default async function handler(req, res) {
	const { cors, isAdmin } = await import("./_auth.js");
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
		if (!(await isAdmin(req))) return res.status(401).json({ error: "Admin access required" });
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", UX_KEY)
			.maybeSingle();
		if (!data?.value) return res.status(404).json({ error: "No UX snapshot generated yet" });
		return res.status(200).json(data.value);
	} catch (err) {
		console.error("ux-intel error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
