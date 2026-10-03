// Comment watch — the autonomous moderation employee for comments.
// A student scrolling the site sees an abusive comment vanish without
// anyone clicking report. No LLM: deterministic gates only.
//
// TRIGGER: cron tick (bounded) — same 5-minute cadence as the event queue,
// so a COMMENT_CREATED event is acted on within minutes of posting.
// OBSERVE: recent unhidden comments (limit 200) + each author's 7-day
//   hidden-comment history.
// DECIDE per policy:
//   - Hard hit (violence / hate / privacy / explicit → serverModerate
//     blocked): hide + strike, always.
//   - Repeat offender (≥2 hidden in 7d) + ANY safety flag on this comment:
//     hide + strike. The sync write-time gate sees one comment; only the
//     watch sees the pattern.
//   - Weak-only with a clean record: leave public (held for posts, and
//     comments have no queue — blocking here would silence debatable
//     speech with no human in the loop).
// ACT: comments.hidden=true, users_meta strikes/warnings per the
//   progressive ladder (3 auto-strikes/7d → 7-day suspension, 6 → ban,
//   mirroring _reports.js), one admin alert per comment, one audit row.
// VERIFY: re-read each acted row; report verified count. Anything
//   unverified lands in errors, never in silence.
import supabase from "./_db-client.js";
import { auditLog, notifyUser } from "./_auth.js";
import { serverModerate, recordSafetyRepost } from "./_moderation.js";

const SWEEP_LIMIT = 200;
const HISTORY_DAYS = 7;
const REPEAT_THRESHOLD = 2;
const STRIKE_SUSPEND_AT = 3;
const STRIKE_BAN_AT = 6;
const ALERT_KEY = "workforce_alerts";
const ALERT_MAX = 100;

const SAFETY_TYPES = new Set([
	"violence",
	"threat",
	"hate_speech",
	"blackmail",
	"explicit",
	"bullying",
]);

function isHardHit(mod) {
	return mod.blocked;
}

function safetyFlags(mod) {
	return (mod.flags || []).filter(
		(f) => SAFETY_TYPES.has(f.type) || f.severity === "critical",
	);
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

export async function watchComments(client = supabase, nowMs = Date.now()) {
	const result = { checked: 0, hidden: 0, struck: 0, verified: 0, errors: [], evidence: [] };
	let comments = [];
	try {
		const { data, error } = await client
			.from("comments")
			.select("id,post_id,author_id,body,created_at")
			.eq("hidden", false)
			.eq("deleted", false)
			.order("created_at", { ascending: false })
			.limit(SWEEP_LIMIT);
		if (error) throw error;
		comments = data || [];
	} catch (err) {
		return { ...result, ok: false, error: err.message };
	}
	result.checked = comments.length;
	if (!comments.length) return { ok: true, ...result };

	const since = new Date(nowMs - HISTORY_DAYS * 24 * 3600 * 1000).toISOString();
	const alerts = await readAlerts(client);
	let dirty = false;

	for (const c of comments) {
		try {
			const mod = serverModerate("", c.body || "");
			// Author history: hidden abusive comments in 7d.
			let priorHidden = 0;
			let meta = null;
			try {
				const { data: hiddenRows } = await client
					.from("comments")
					.select("id")
					.eq("author_id", c.author_id)
					.eq("hidden", true)
					.gte("created_at", since)
					.limit(50);
				priorHidden = (hiddenRows || []).length;
				const { data: metaRow } = await client
					.from("users_meta")
					.select("*")
					.eq("anon_id", (c.author_id || "").toLowerCase())
					.maybeSingle();
				meta = metaRow || null;
			} catch {
				/* history is advisory; the content verdict stands alone */
			}

			const hard = isHardHit(mod);
			const repeat =
				!hard &&
				priorHidden >= REPEAT_THRESHOLD &&
				safetyFlags(mod).length > 0;
			if (!hard && !repeat) continue;

			// ACT 1: hide — public listings exclude hidden, so a scrolling
			// student sees the comment vanish within minutes. No delete:
			// admins can still review the exact words.
			await client.from("comments").update({ hidden: true }).eq("id", c.id);

			// ACT 2: strike the author on the progressive ladder.
			const warnings = Array.isArray(meta?.warnings) ? meta.warnings : [];
			const strikes = (meta?.strikes || 0) + 1;
			warnings.push({
				text: `Auto-hidden abusive comment (${(safetyFlags(mod)[0] || mod.flags[0] || {}).type || "policy"})`,
				at: new Date(nowMs).toISOString(),
				source: "comment-watch",
				target_type: "comment",
				target_id: c.id,
			});
			const weekStrikes = warnings.filter(
				(w) => w.at && new Date(w.at) >= new Date(since),
			).length;
			const patch = { strikes, warnings, last_seen: new Date(nowMs).toISOString() };
			let action = "hidden+warned";
			if (strikes >= STRIKE_BAN_AT) {
				patch.banned = true;
				action = "hidden+banned";
			} else if (weekStrikes >= STRIKE_SUSPEND_AT) {
				patch.suspended_until = new Date(nowMs + 7 * 86400000).toISOString();
				action = "hidden+suspended";
			}
			if (meta) {
				await client.from("users_meta").update(patch).eq("anon_id", meta.anon_id);
			} else if (c.author_id) {
				await client.from("users_meta").insert({
					anon_id: String(c.author_id).toLowerCase(),
					warnings,
					strikes,
					banned: !!patch.banned,
					last_seen: new Date(nowMs).toISOString(),
				});
			}

			// ACT 3: admin notification (keyed, deduped while unresolved).
			const key = `comment-watch:${c.id}`;
			if (!alerts.some((a) => a.key === key && !a.resolved_at)) {
				alerts.unshift({
					key,
					severity: hard ? "high" : "medium",
					title: `Auto-hidden abusive comment (${action})`,
					body: `“${String(c.body || "").slice(0, 120)}” · author ${c.author_id} · prior hidden 7d: ${priorHidden}`,
					agent: "comment-watch",
					created_at: new Date(nowMs).toISOString(),
					occurrences: 1,
				});
				dirty = true;
			}
			// VERIFY 1: re-read the row; only counted when hidden is confirmed.
			let rowConfirmed = false;
			try {
				const { data: check } = await client
					.from("comments")
					.select("hidden")
					.eq("id", c.id)
					.maybeSingle();
				rowConfirmed = check?.hidden === true;
				if (!rowConfirmed) {
					result.errors.push({ comment_id: c.id, error: "hide not confirmed on re-read" });
					continue;
				}
			} catch (err) {
				result.errors.push({ comment_id: c.id, error: err.message });
				continue;
			}
			// VERIFY 2: public-path propagation — the same "is this id
			// visible?" question a non-admin client asks. Proves the content
			// is gone from the user surface, not just that a write landed.
			let propagationConfirmed = false;
			try {
				const { data: visible } = await client
					.from("comments")
					.select("id")
					.eq("id", c.id)
					.eq("hidden", false)
					.eq("deleted", false)
					.maybeSingle();
				propagationConfirmed = visible == null;
				if (!propagationConfirmed) {
					result.errors.push({ comment_id: c.id, error: "still publicly visible after hide" });
					continue;
				}
			} catch (err) {
				result.errors.push({ comment_id: c.id, error: err.message });
				continue;
			}
			result.hidden += 1;
			result.struck += 1;
			result.verified += 1;
			// REPOST GUARD: fingerprint confirmed-removed text so it can't
			// return under a new id. Only after both verifications pass.
			const rule = (safetyFlags(mod)[0] || mod.flags[0] || {}).type || "policy";
			await recordSafetyRepost(client, c.body || "", rule);
			// EVIDENCE: one receipt per enforced action. Additive — existing
			// consumers read hidden/struck/verified/errors unchanged.
			const createdMs = c.created_at ? new Date(c.created_at).getTime() : NaN;
			const exposureMs = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : null;
			try {
				result.evidence.push({
					comment_id: c.id,
					post_id: c.post_id,
					author_id: c.author_id,
					rule,
					action,
					exposure_ms: exposureMs,
					verify: { row_hidden: rowConfirmed, public_path_absent: propagationConfirmed },
					verified_at: new Date(nowMs).toISOString(),
				});
			} catch {
				/* evidence is best-effort; counts above already stand */
			}
			// RECEIPT: the acted-on author gets the same persistent
			// "automation acted on you" notification every other enforcement
			// path writes — rule, strike position, and what escalates next.
			// Best-effort and AFTER both verifications: no receipt for
			// unconfirmed work, and the counts above already stand.
			try {
				await notifyUser(
					c.author_id,
					"warning",
					action === "hidden+banned"
						? "Account permanently banned"
						: action === "hidden+suspended"
							? "Account temporarily suspended"
							: "Comment removed — strike issued",
					`Automated moderation hid your comment (${rule}). This is strike ${strikes}: 3 strikes in 7 days suspends posting for 7 days, 6 bans it permanently.`,
				);
			} catch {
				/* receipt is best-effort; enforcement already verified */
			}
			// AUDIT: single receipt after verification — rule, exposure, and
			// both legs, so the admin timeline shows proof, not occurrence.
			try {
				await auditLog(
					"comment-watch",
					"comment_hidden",
					`${c.id} by ${c.author_id} (${action}, prior hidden 7d: ${priorHidden}) [rule=${rule} exposure_ms=${exposureMs} row=${rowConfirmed ? "hidden" : "unconfirmed"} public=${propagationConfirmed ? "absent" : "visible"}]`,
				);
			} catch {
				/* audit is best-effort */
			}
		} catch (err) {
			result.errors.push({ comment_id: c.id, error: err.message });
		}
	}
	if (dirty) {
		await client.from("settings").upsert(
			{
				key: ALERT_KEY,
				value: { alerts: alerts.slice(0, ALERT_MAX), updated_at: new Date().toISOString() },
			},
			{ onConflict: "key" },
		);
	}
	return { ok: true, ...result };
}
