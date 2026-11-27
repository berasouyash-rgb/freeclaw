// Trend watch — spike detection over post volume per category.
// No LLM: counts and rates are arithmetic. A spike means something changed
// in the real world (water outage, food incident) and deserves human eyes.
//
// - Recent window 24h vs baseline prior 7d (per-day rates).
// - Spike: recent >= 5 posts AND recent_rate >= 3x baseline (baseline floor
//   0.5/day; zero baseline + 8+ posts also spikes).
// - One admin alert per category (key trend:<category>, deduped while
//   unresolved) + one audit row per spike. No post mutation, ever.
// - Bounded (2000 rows/tick), per-category try/catch.
import supabase from "./_db-client.js";
import { auditLog } from "./_auth.js";

export const RECENT_MS = 24 * 3600 * 1000;
export const BASELINE_MS = 7 * 24 * 3600 * 1000;
export const MIN_RECENT = 5;
export const SPIKE_RATIO = 3;
export const BASELINE_FLOOR = 0.5;
export const ZERO_BASELINE_MIN = 8;
const ROW_LIMIT = 2000;
const ALERT_KEY = "workforce_alerts";
const ALERT_MAX = 100;

async function readAlerts(client) {
	try {
		const { data } = await client
			.from("settings")
			.select("value")
			.eq("key", ALERT_KEY)
			.maybeSingle();
		return Array.isArray(data?.value?.alerts) ? data.value.alerts : [];
	} catch {
		return [];
	}
}

export async function checkTrends(client = supabase, nowMs = Date.now()) {
	const result = { checked: 0, spikes: [], errors: [] };
	let rows = [];
	try {
		const { data, error } = await client
			.from("posts")
			.select("category,created_at")
			.eq("deleted", false)
			.gte("created_at", new Date(nowMs - BASELINE_MS).toISOString())
			.limit(ROW_LIMIT);
		if (error) throw error;
		rows = data || [];
	} catch (err) {
		return { ...result, ok: false, error: err.message };
	}
	result.checked = rows.length;

	const perCat = new Map();
	for (const r of rows) {
		const age = nowMs - new Date(r.created_at).getTime();
		if (Number.isNaN(age) || age < 0) continue;
		const cat = r.category || "Other";
		if (!perCat.has(cat)) perCat.set(cat, { recent: 0, baseline: 0 });
		const e = perCat.get(cat);
		if (age <= RECENT_MS) e.recent += 1;
		else e.baseline += 1;
	}

	const alerts = await readAlerts(client);
	let dirty = false;
	for (const [cat, e] of perCat) {
		try {
			const baseRate = Math.max(e.baseline / 7, BASELINE_FLOOR);
			const recentRate = e.recent;
			const isSpike =
				e.recent >= MIN_RECENT &&
				(recentRate >= SPIKE_RATIO * baseRate ||
					(e.baseline === 0 && e.recent >= ZERO_BASELINE_MIN));
			if (!isSpike) continue;
			const key = `trend:${cat}`;
			if (alerts.some((a) => a.key === key && !a.resolved_at)) continue;
			alerts.unshift({
				key,
				severity: "medium",
				title: `Spike: ${e.recent} "${cat}" reports in 24h (baseline ${baseRate.toFixed(1)}/day)`,
				body: `Volume signal — possible real-world incident in ${cat}.`,
				agent: "trend-watch",
				created_at: new Date(nowMs).toISOString(),
				occurrences: 1,
			});
			dirty = true;
			result.spikes.push({ category: cat, recent_24h: e.recent, baseline_per_day: Math.round(baseRate * 10) / 10 });
			try {
				await auditLog("trend-watch", "spike_detected", `${cat}: ${e.recent}/24h vs ${baseRate.toFixed(1)}/day`);
			} catch {
				/* audit is best-effort */
			}
		} catch (err) {
			result.errors.push({ category: cat, error: err.message });
		}
	}
	if (dirty) {
		await client.from("settings").upsert(
			{
				key: ALERT_KEY,
				value: { alerts: alerts.slice(0, ALERT_MAX), updated_at: new Date(nowMs).toISOString() },
			},
			{ onConflict: "key" },
		);
	}
	return { ok: true, ...result };
}
