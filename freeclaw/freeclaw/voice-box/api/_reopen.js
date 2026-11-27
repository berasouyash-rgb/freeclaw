// Reopening worker — a closed case that sees a new matching report
// reopens automatically. Deterministic: token-overlap similarity
// (title-weighted, same weighting as duplicate detection), threshold 60,
// best single match per new post. Idempotent: a verified reopen leaves
// solved/archived state (no longer a candidate), and every evaluated new post
// is marked seen so it never re-triggers — except a matched-but-unverified
// attempt, which stays unmarked so a bounded next tick can retry it.
//
// - Candidates: open posts from the last 24h (reported/verified/
//   in_progress/waiting), not deleted/hidden/archived/pending_review.
// - Targets: solved/archived posts.
// - Action: target → in_progress + status_history note + audit row +
//   one admin alert (keyed reopen:<target>, deduped while unresolved).
// - Verified: after the write we re-read the target and confirm the status
//   change landed before counting it; the write's return value is not
//   evidence. Unverified attempts are reported (never counted as success) and
//   are left unmarked so a bounded next tick can retry them.
// - Bounded (30 new posts/tick), per-pair try/catch.
import supabase from "./_db-client.js";
import { auditLog } from "./_auth.js";

export const REOPEN_THRESHOLD = 60;
export const REOPEN_LOOKBACK_MS = 24 * 3600 * 1000;
const SWEEP_LIMIT = 30;
const ALERT_KEY = "workforce_alerts";
const ALERT_MAX = 100;

function tokenize(text) {
	return String(text || "")
		.toLowerCase()
		.split(/\W+/)
		.filter((w) => w.length >= 3);
}

function jaccard(a, b) {
	const setA = new Set(a);
	const setB = new Set(b);
	const inter = [...setA].filter((w) => setB.has(w)).length;
	const union = new Set([...setA, ...setB]).size;
	return union === 0 ? 0 : inter / union;
}

export function postSimilarity(a, b) {
	const titleSim = jaccard(tokenize(a.title), tokenize(b.title));
	const descSim = jaccard(
		tokenize(`${a.title} ${a.description || ""}`),
		tokenize(`${b.title} ${b.description || ""}`),
	);
	const categoryMatch =
		a.category && b.category && a.category === b.category ? 0.15 : 0;
	return Math.round((titleSim * 0.5 + descSim * 0.35 + categoryMatch) * 100);
}

async function readSetting(client, key) {
	try {
		const { data } = await client
			.from("settings")
			.select("value")
			.eq("key", key)
			.maybeSingle();
		return data?.value ?? null;
	} catch {
		return null;
	}
}

async function writeSetting(client, key, value) {
	await client.from("settings").upsert({ key, value }, { onConflict: "key" });
}

// Independent read-back of a reopen: re-read the target and confirm it is
// in_progress AND its status_history carries the reopen note for THIS new
// report. Never trust the write's return value — a swallowed write still
// returns the patched object.
export async function verifyReopen(client, postId, newPostId) {
	try {
		const { data } = await client
			.from("posts")
			.select("id,status,status_history")
			.eq("id", postId)
			.maybeSingle();
		if (!data || data.status !== "in_progress") return false;
		const history = Array.isArray(data.status_history)
			? data.status_history
			: [];
		return history.some(
			(h) =>
				h &&
				h.status === "in_progress" &&
				String(h.note || "").includes(String(newPostId)),
		);
	} catch {
		return false;
	}
}

async function raiseOnce(client, alerts, { key, severity, title, body }) {
	if (alerts.some((a) => a.key === key && !a.resolved_at)) return false;
	alerts.unshift({
		key,
		severity,
		title: String(title).slice(0, 160),
		body: body ? String(body).slice(0, 500) : null,
		agent: "reopen-worker",
		created_at: new Date().toISOString(),
		occurrences: 1,
	});
	await writeSetting(client, ALERT_KEY, {
		alerts: alerts.slice(0, ALERT_MAX),
		updated_at: new Date().toISOString(),
	});
	return true;
}

export async function checkReopen(client = supabase, nowMs = Date.now()) {
	const result = { checked: 0, reopened: [], unverified: [], errors: [] };
	let fresh = [];
	let closed = [];
	try {
		const since = new Date(nowMs - REOPEN_LOOKBACK_MS).toISOString();
		const { data: f, error: e1 } = await client
			.from("posts")
			.select("id,title,description,category,status,created_at")
			.eq("deleted", false)
			.eq("hidden", false)
			.in("status", ["reported", "verified", "in_progress", "waiting"])
			.gte("created_at", since)
			.limit(SWEEP_LIMIT);
		if (e1) throw e1;
		const { data: c, error: e2 } = await client
			.from("posts")
			.select("id,title,description,category,status,created_at,status_history")
			.eq("deleted", false)
			.in("status", ["solved", "archived"])
			.limit(200);
		if (e2) throw e2;
		fresh = f || [];
		closed = c || [];
	} catch (err) {
		return { ...result, ok: false, error: err.message };
	}
	result.checked = fresh.length;
	if (!fresh.length || !closed.length) return { ok: true, ...result };

	const alertsRow = await readSetting(client, ALERT_KEY);
	const alerts = Array.isArray(alertsRow?.alerts) ? alertsRow.alerts : [];
	const at = new Date(nowMs).toISOString();

	for (const post of fresh) {
		try {
			const seenKey = `reopen_seen:${post.id}`;
			if (await readSetting(client, seenKey)) continue;
			let best = null;
			let bestSim = 0;
			for (const target of closed) {
				if (target.id === post.id) continue;
				const sim = postSimilarity(post, target);
				if (sim >= REOPEN_THRESHOLD && sim > bestSim) {
					best = target;
					bestSim = sim;
				}
			}
			// No match: record the evaluation so this post is never re-scanned.
			// There is nothing to retry.
			if (!best) {
				await writeSetting(client, seenKey, {
					at,
					matched: null,
					similarity: bestSim,
				});
				continue;
			}
			const history = Array.isArray(best.status_history)
				? best.status_history
				: [];
			const note = `Auto-reopened: matching new report ${post.id} (${bestSim}% similar)`;
			const { error: writeErr } = await client
				.from("posts")
				.update({
					status: "in_progress",
					status_history: [...history, { status: "in_progress", at, note }],
				})
				.eq("id", best.id);
			// Independent read-back — the write's return value is not evidence.
			const verified = await verifyReopen(client, best.id, post.id);
			if (!verified) {
				// Never count an unconfirmed reopen as success, and leave the
				// seen marker unset so a bounded next tick can retry it.
				result.unverified.push({
					new_id: post.id,
					reopened_id: best.id,
					similarity: bestSim,
					reason: writeErr
						? String(writeErr.message || writeErr).slice(0, 200)
						: "read-back did not confirm reopen",
				});
				continue;
			}
			// Verified: report the fact first, then best-effort bookkeeping.
			result.reopened.push({
				new_id: post.id,
				reopened_id: best.id,
				similarity: bestSim,
			});
			try {
				await writeSetting(client, seenKey, {
					at,
					matched: best.id,
					similarity: bestSim,
				});
			} catch {
				/* seen marker best-effort; retry remains bounded per tick */
			}
			try {
				await raiseOnce(client, alerts, {
					key: `reopen:${best.id}`,
					severity: "medium",
					title: `Reopened "${(best.title || "untitled").slice(0, 60)}" — matching new report`,
					body: `New report ${post.id} matches at ${bestSim}%. Previously ${best.status}.`,
				});
			} catch {
				/* alert is best-effort */
			}
			try {
				await auditLog(
					"reopen-worker",
					"case_reopened",
					`${best.id} reopened by ${post.id} (${bestSim}%)`,
				);
			} catch {
				/* audit is best-effort */
			}
		} catch (err) {
			result.errors.push({ post_id: post.id, error: err.message });
		}
	}
	return { ok: true, ...result };
}
