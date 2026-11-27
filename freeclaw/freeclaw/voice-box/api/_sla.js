// SLA worker — deterministic deadline tracking for open posts.
// No LLM: deadlines are arithmetic (created_at + priority window).
//
// - Warning: an open post within 1h BEFORE its deadline gets one admin
//   alert (keyed, never duplicated while unresolved).
// - Breach: past deadline with no unresolved breach alert → priority bumps
//   one level (low→medium→high→critical), one alert, one audit row.
// - Resolved posts clear the pressure: fixing/closing a post makes its
//   alert key stale, so a future breach raises fresh (grouping rule shared
//   with the workforce alert center).
// - Skipped always: solved, archived, pending_review, deleted, hidden.
//
// Windows: critical 24h, high 72h, medium 7d, low/unknown 14d.
import supabase from "./_db-client.js";
import { auditLog } from "./_auth.js";

export const SLA_WINDOW_MS = {
	critical: 24 * 3600 * 1000,
	high: 72 * 3600 * 1000,
	medium: 7 * 24 * 3600 * 1000,
	low: 14 * 24 * 3600 * 1000,
};
export const SLA_WARN_BEFORE_MS = 3600 * 1000;

export const OPEN_STATUSES = ["reported", "verified", "in_progress", "waiting"];
export const PRIORITY_ORDER = ["low", "medium", "high", "critical"];
const ALERT_KEY = "workforce_alerts";
const ALERT_MAX = 100;
const SWEEP_LIMIT = 100;

function deadlineMs(post, now) {
	const w = SLA_WINDOW_MS[post.priority] ?? SLA_WINDOW_MS.low;
	const created = new Date(post.created_at).getTime();
	if (Number.isNaN(created)) return null;
	return created + w - now; // >0 remaining, <0 overdue
}

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

function unresolved(alerts, key) {
	return alerts.some((a) => a.key === key && !a.resolved_at);
}

async function raiseOnce(client, alerts, { key, severity, title, body }) {
	if (unresolved(alerts, key)) return false;
	alerts.unshift({
		key,
		severity,
		title: String(title).slice(0, 160),
		body: body ? String(body).slice(0, 500) : null,
		agent: "sla-worker",
		created_at: new Date().toISOString(),
		occurrences: 1,
	});
	await writeAlerts(client, alerts);
	return true;
}

export async function checkSLA(client = supabase, nowMs = Date.now()) {
	const result = { checked: 0, warned: 0, escalated: 0, errors: [] };
	let posts = [];
	try {
		const { data, error } = await client
			.from("posts")
			.select("id,title,priority,status,created_at,hidden,deleted")
			.eq("deleted", false)
			.eq("hidden", false)
			.limit(SWEEP_LIMIT);
		if (error) throw error;
		posts = (data || []).filter((p) => OPEN_STATUSES.includes(p.status));
	} catch (err) {
		return { ...result, ok: false, error: err.message };
	}
	result.checked = posts.length;
	if (!posts.length) return { ok: true, ...result };

	const alerts = await readAlerts(client);
	for (const post of posts) {
		try {
			const remaining = deadlineMs(post, nowMs);
			if (remaining === null) continue;
			if (remaining >= 0 && remaining <= SLA_WARN_BEFORE_MS) {
				const raised = await raiseOnce(client, alerts, {
					key: `sla-warning:${post.id}`,
					severity: "medium",
					title: `SLA warning: "${(post.title || "untitled").slice(0, 60)}" due within the hour`,
					body: `Priority ${post.priority || "low"} · created ${post.created_at}`,
				});
				if (raised) result.warned += 1;
			} else if (remaining < 0) {
				const key = `sla-breach:${post.id}`;
				if (unresolved(alerts, key)) continue;
				const idx = PRIORITY_ORDER.indexOf(post.priority);
				const bumped =
					idx >= 0 && idx < PRIORITY_ORDER.length - 1
						? PRIORITY_ORDER[idx + 1]
						: post.priority || "medium";
				await client.from("posts").update({ priority: bumped }).eq("id", post.id);
				await raiseOnce(client, alerts, {
					key,
					severity: "high",
					title: `SLA breached: "${(post.title || "untitled").slice(0, 60)}" escalated to ${bumped}`,
					body: `Was ${post.priority || "low"} · open since ${post.created_at}`,
				});
				try {
					await auditLog(
						"sla-worker",
						"sla_escalation",
						`${post.id}: ${post.priority || "low"} → ${bumped}`,
					);
				} catch {
					/* audit is best-effort */
				}
				result.escalated += 1;
			}
		} catch (err) {
			result.errors.push({ post_id: post.id, error: err.message });
		}
	}
	return { ok: true, ...result };
}
