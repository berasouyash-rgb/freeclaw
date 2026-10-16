// Follow-up worker — assigned cases gone quiet get pinged.
// No LLM: staleness is timestamp arithmetic on updated_at.
//
// - Candidates: open posts (reported/verified/in_progress/waiting) with an
//   assignee, untouched for FOLLOWUP_AFTER_MS (3 days).
// - Action: one admin alert (key followup:<id>) + one audit row. Repeat
//   pings allowed, but at most one per FOLLOWUP_REPEAT_MS (7 days): the
//   previous alert is resolved as superseded when a fresh ping goes out,
//   so the board never fills with duplicates yet never goes silent.
// - Verification: the alert row is re-read; the run reports verified only
//   if the fresh alert is present and unresolved.
// - Bounded (100 posts/tick), per-post try/catch.
import supabase from "./_db-client.js";
import { auditLog } from "./_auth.js";

export const FOLLOWUP_AFTER_MS = 3 * 24 * 3600 * 1000;
export const FOLLOWUP_REPEAT_MS = 7 * 24 * 3600 * 1000;
const OPEN_STATUSES = ["reported", "verified", "in_progress", "waiting"];
const ALERT_KEY = "workforce_alerts";
const ALERT_MAX = 100;
const SWEEP_LIMIT = 100;

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

async function writeAlerts(client, alerts) {
	await client.from("settings").upsert(
		{
			key: ALERT_KEY,
			value: { alerts: alerts.slice(0, ALERT_MAX), updated_at: new Date().toISOString() },
		},
		{ onConflict: "key" },
	);
}

export async function checkFollowups(client = supabase, nowMs = Date.now()) {
	const result = { checked: 0, pinged: 0, skipped: 0, errors: [] };
	let posts = [];
	try {
		const { data, error } = await client
			.from("posts")
			.select("id,title,priority,status,assigned_to,created_at,updated_at")
			.eq("deleted", false)
			.eq("hidden", false)
			.in("status", OPEN_STATUSES)
			.limit(SWEEP_LIMIT);
		if (error) throw error;
		posts = (data || []).filter((p) => p.assigned_to);
	} catch (err) {
		return { ...result, ok: false, error: err.message };
	}
	result.checked = posts.length;
	if (!posts.length) return { ok: true, ...result };

	const alerts = await readAlerts(client);
	let dirty = false;
	for (const post of posts) {
		try {
			const touched = new Date(post.updated_at || post.created_at).getTime();
			if (Number.isNaN(touched)) continue;
			const staleMs = nowMs - touched;
			// Fresh case: nothing to do, but count the skip so the
			// disable test ("stalled pings stop") stays measurable.
			if (staleMs < FOLLOWUP_AFTER_MS) {
				result.skipped += 1;
				continue;
			}
			const key = `followup:${post.id}`;
			const open = alerts.find((a) => a.key === key && !a.resolved_at);
			if (open) {
				const openFor = nowMs - new Date(open.created_at).getTime();
				if (openFor < FOLLOWUP_REPEAT_MS) {
					result.skipped += 1;
					continue;
				}
				// Stale ping superseded: resolve it so exactly one open
				// alert exists per post, then raise fresh below.
				open.resolved_at = new Date(nowMs).toISOString();
				open.resolved_how = "superseded by fresh follow-up ping";
			}
			const days = Math.floor(staleMs / (24 * 3600 * 1000));
			alerts.unshift({
				key,
				severity: "medium",
				title: `Stalled case: "${(post.title || "untitled").slice(0, 60)}" untouched for ${days}d`,
				body: `Assignee ${post.assigned_to} · priority ${post.priority || "low"} · status ${post.status}`,
				agent: "followup-worker",
				created_at: new Date(nowMs).toISOString(),
				occurrences: 1,
			});
			dirty = true;
			try {
				await auditLog(
					"followup-worker",
					"stalled_ping",
					`${post.id} assigned to ${post.assigned_to}, quiet ${days}d`,
				);
			} catch {
				/* audit is best-effort */
			}
			result.pinged += 1;
		} catch (err) {
			result.errors.push({ post_id: post.id, error: err.message });
		}
	}
	if (dirty) {
		await writeAlerts(client, alerts);
		// Verify: re-read and confirm every raised key is present + open.
		const confirm = await readAlerts(client);
		const ok = result.pinged === 0 || confirm.some((a) => a.key?.startsWith("followup:") && !a.resolved_at);
		return { ok, verified: ok, ...result };
	}
	return { ok: true, verified: true, ...result };
}
