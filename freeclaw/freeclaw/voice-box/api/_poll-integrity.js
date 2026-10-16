// Poll integrity worker — suspicious voting patterns get quarantined,
// tallies recalc automatically (attachResults counts live rows only).
//
// Two deterministic signals (no LLM — velocity is arithmetic):
// - BURST: >=15 votes on one poll within 60s from >=8 distinct authors.
// - BOT AUTHOR: one author voting on >=12 distinct polls within 5 min.
// Below those floors: alert-only at >=8 votes/60s (>=4 authors).
//
// Action (high tier only): suspect vote rows move to the poll_fraud ledger
// in settings (full rows preserved → admin-restrorable rollback), then
// delete from poll_votes. One admin alert per poll (keyed, deduped while
// unresolved) + audit row. Results recalc on next read by construction.
//
// Requires migration 015 (poll_votes.created_at). Without it the worker
// reports degraded:true (UNKNOWN — never a fake clean bill) and changes
// nothing.
import supabase from "./_db-client.js";
import { auditLog } from "./_auth.js";

export const BURST_VOTES = 15;
export const BURST_WINDOW_MS = 60 * 1000;
export const BURST_AUTHORS = 8;
export const WATCH_VOTES = 8;
export const WATCH_AUTHORS = 4;
export const BOT_POLLS = 12;
export const BOT_WINDOW_MS = 5 * 60 * 1000;
const SCAN_LIMIT = 500;
const ALERT_KEY = "workforce_alerts";
const ALERT_MAX = 100;
const FRAUD_KEY = "poll_fraud";

async function hasTimestamps(client) {
	try {
		const { error } = await client
			.from("poll_votes")
			.select("id,created_at")
			.limit(1);
		return !error;
	} catch {
		return false;
	}
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

async function appendFraudLedger(client, pollId, rows, reason) {
	let ledger = [];
	try {
		const { data } = await client
			.from("settings")
			.select("value")
			.eq("key", FRAUD_KEY)
			.maybeSingle();
		if (Array.isArray(data?.value?.entries)) ledger = data.value.entries;
	} catch {
		/* start fresh */
	}
	ledger.unshift({
		poll_id: pollId,
		reason,
		quarantined_at: new Date().toISOString(),
		votes: rows,
	});
	await client.from("settings").upsert(
		{ key: FRAUD_KEY, value: { entries: ledger.slice(0, 50) } },
		{ onConflict: "key" },
	);
}

export async function checkPollIntegrity(client = supabase, nowMs = Date.now()) {
	const result = {
		checked: 0,
		quarantined: 0,
		watchAlerts: 0,
		polls: [],
		errors: [],
	};
	if (!(await hasTimestamps(client))) {
		return {
			...result,
			ok: false,
			degraded: true,
			reason:
				"poll_votes.created_at missing — apply migration 015 before velocity detection can run. Nothing checked, nothing changed.",
		};
	}
	let votes = [];
	try {
		const { data, error } = await client
			.from("poll_votes")
			.select("id,poll_id,author_id,choices,created_at")
			.gte("created_at", new Date(nowMs - BOT_WINDOW_MS).toISOString())
			.limit(SCAN_LIMIT);
		if (error) throw error;
		votes = (data || []).filter((v) => v.created_at);
	} catch (err) {
		return { ...result, ok: false, error: err.message };
	}
	result.checked = votes.length;

	// Aggregate per poll (60s burst window) and per author (5min bot window).
	const byPoll = new Map();
	for (const v of votes) {
		const age = nowMs - new Date(v.created_at).getTime();
		if (age < 0 || age > BOT_WINDOW_MS) continue;
		if (!byPoll.has(v.poll_id)) byPoll.set(v.poll_id, []);
		byPoll.get(v.poll_id).push(v);
	}
	const byAuthor = new Map();
	for (const v of votes) {
		if (!byAuthor.has(v.author_id)) byAuthor.set(v.author_id, new Set());
		byAuthor.get(v.author_id).add(v.poll_id);
	}
	const botAuthors = new Set(
		[...byAuthor.entries()]
			.filter(([, polls]) => polls.size >= BOT_POLLS)
			.map(([a]) => a),
	);

	const alerts = await readAlerts(client);
	let dirty = false;
	for (const [pollId, rows] of byPoll) {
		try {
			const recent = rows.filter(
				(v) => nowMs - new Date(v.created_at).getTime() <= BURST_WINDOW_MS,
			);
			const authors = new Set(recent.map((v) => v.author_id));
			const botRows = recent.filter((v) => botAuthors.has(v.author_id));
			const key = `poll-fraud:${pollId}`;
			const open = alerts.some((a) => a.key === key && !a.resolved_at);
			if (
				(recent.length >= BURST_VOTES && authors.size >= BURST_AUTHORS) ||
				botRows.length > 0
			) {
				// High confidence: quarantine (ledger first = rollback), delete,
				// alert once, audit. Tallies recalc live on next read.
				const suspect = botRows.length > 0 ? botRows : recent;
				const reason =
					botRows.length > 0
						? `bot authors voted on ${BOT_POLLS}+ polls in 5min`
						: `${recent.length} votes from ${authors.size} authors in 60s`;
				await appendFraudLedger(client, pollId, suspect, reason);
				const { error: delErr } = await client
					.from("poll_votes")
					.delete()
					.in(
						"id",
						suspect.map((v) => v.id),
					);
				if (delErr) throw delErr;
				if (!open) {
					alerts.unshift({
						key,
						severity: "high",
						title: `Vote fraud quarantined on poll ${String(pollId).slice(0, 24)} (${suspect.length} votes)`,
						body: reason,
						agent: "poll-integrity-worker",
						created_at: new Date(nowMs).toISOString(),
						occurrences: 1,
					});
					dirty = true;
				}
				try {
					await auditLog(
						"poll-integrity-worker",
						"votes_quarantined",
						`${pollId}: ${suspect.length} votes (${reason})`,
					);
				} catch {
					/* audit is best-effort */
				}
				result.quarantined += suspect.length;
				result.polls.push({ poll_id: pollId, action: "quarantined", votes: suspect.length, reason });
			} else if (
				!open &&
				recent.length >= WATCH_VOTES &&
				authors.size >= WATCH_AUTHORS
			) {
				alerts.unshift({
					key,
					severity: "medium",
					title: `Unusual voting pace on poll ${String(pollId).slice(0, 24)} (${recent.length}/min)`,
					body: "Below quarantine thresholds — human review decides.",
					agent: "poll-integrity-worker",
					created_at: new Date(nowMs).toISOString(),
					occurrences: 1,
				});
				dirty = true;
				result.watchAlerts += 1;
				result.polls.push({ poll_id: pollId, action: "watch", votes: recent.length });
			}
		} catch (err) {
			result.errors.push({ poll_id: pollId, error: err.message });
		}
	}
	if (dirty) await writeAlerts(client, alerts);
	return { ok: true, ...result };
}
