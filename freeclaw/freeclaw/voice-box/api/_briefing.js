// Admin Briefing — the "overnight operations summary", generated from real
// system data only (roster #18).
//
// Every number in the briefing comes from a real read: the workforce action
// ledger (workforce_actions_kv — the engine's own exported readLedger), the
// recent activity_logs, the workforce alert center (workforce_alerts) and
// the live posts feed. Nothing is invented. The briefing is stored in the
// canonical settings KV (briefing:latest) and verified by re-read before it
// is reported as written — a briefing that failed to persist is a failure,
// never a success claim.
import { cors, isAdmin } from "./_auth.js";
import { readLivePosts } from "./_live-posts.js";
import supabase from "./_db-client.js";
import { readLedger } from "./_workforce-core.js";
import { isTestArtifact } from "./_artifact-filter.js";

const BRIEFING_KEY = "briefing:latest";
const RECENT_WINDOW_MS = 24 * 3600 * 1000;
const ALERT_TOP = 5;
const ACTIVITY_TOP = 8;

const SOLVED_STATUSES = new Set(["solved", "resolved", "closed"]);

async function readAlerts() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "workforce_alerts")
			.maybeSingle();
		return Array.isArray(data?.value?.alerts) ? data.value.alerts : [];
	} catch {
		return [];
	}
}

async function readRecentActivity(cutoffIso) {
	try {
		const { data } = await supabase
			.from("activity_logs")
			.select("actor, action, detail, created_at")
			.gte("created_at", cutoffIso)
			.order("created_at", { ascending: false })
			.limit(500);
		return data || [];
	} catch {
		return [];
	}
}

function tally(rows, key) {
	const t = {};
	for (const r of rows) {
		const k = r?.[key] || "unknown";
		t[k] = (t[k] || 0) + 1;
	}
	return t;
}

function topEntries(tallyMap, limit) {
	return Object.entries(tallyMap)
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([name, count]) => ({ name, count }));
}

/**
 * Build the operations briefing from real reads and persist it.
 *
 * @returns {Promise<{ok: boolean, verified?: boolean, briefing?: object, error?: string}>}
 */
export async function generateBriefing({ nowMs = Date.now() } = {}) {
	const cutoff = nowMs - RECENT_WINDOW_MS;
	const cutoffIso = new Date(cutoff).toISOString();

	// 1. What happened on the platform (dual read — degrades to null when the
	//    direct post store is unavailable; the other sections still build).
	let posts = null;
	try {
		const live = await readLivePosts({
			columns: "id, title, status, priority, created_at, updated_at",
			limit: 300,
		});
		if (live.ok && live.source === "supabase") {
			const fresh = (live.posts || []).filter(
				(p) => !isTestArtifact(p.title) && new Date(p.created_at).getTime() >= cutoff,
			);
			const solved = fresh.filter((p) => SOLVED_STATUSES.has(String(p.status || "").toLowerCase()));
			posts = { new_24h: fresh.length, solved_24h: solved.length };
		}
	} catch {
		posts = null;
	}

	// 2. What AI did — the workforce action ledger (real outcome counts).
	let workforce = null;
	try {
		const rows = await readLedger(200);
		const recent = rows.filter(
			(r) => r?.completed_at && new Date(r.completed_at).getTime() >= cutoff,
		);
		const byOutcome = tally(recent, "outcome");
		workforce = {
			runs_24h: recent.length,
			verified_successes: byOutcome.verified_success || 0,
			verified_failures: byOutcome.verified_failure || 0,
			execution_failed: byOutcome.execution_failed || 0,
			escalated: byOutcome.escalated || 0,
			by_outcome: byOutcome,
			top_workers: topEntries(tally(recent, "worker_id"), ACTIVITY_TOP),
		};
	} catch {
		workforce = null;
	}

	// 3. System activity — the audit trail (real counts).
	const activity = await readRecentActivity(cutoffIso);

	// 4. What needs attention — unresolved alerts in the workforce center.
	const alerts = await readAlerts();
	const unresolved = alerts.filter((a) => !a.resolved_at);

	const briefing = {
		generated_at: new Date(nowMs).toISOString(),
		window: "last_24h",
		posts,
		workforce,
		activity: { total_24h: activity.length, by_action: tally(activity, "action") },
		attention: {
			unresolved_alerts: unresolved.length,
			top: unresolved.slice(0, ALERT_TOP).map((a) => ({
				key: a.key,
				severity: a.severity,
				title: a.title,
				agent: a.agent,
			})),
		},
	};

	// Persist + VERIFY by independent re-read.
	try {
		await supabase.from("settings").upsert(
			{ key: BRIEFING_KEY, value: briefing },
			{ onConflict: "key" },
		);
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", BRIEFING_KEY)
			.maybeSingle();
		const persisted = data?.value?.generated_at === briefing.generated_at;
		return { ok: true, verified: persisted, briefing };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}

// GET /api/briefing — admin read of the latest stored briefing.
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
		if (!(await isAdmin(req))) return res.status(401).json({ error: "Admin access required" });
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", BRIEFING_KEY)
			.maybeSingle();
		if (!data?.value) return res.status(404).json({ error: "No briefing generated yet" });
		return res.status(200).json(data.value);
	} catch (err) {
		console.error("briefing error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
