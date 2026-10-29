// Slang-escalation ladder — the author-level consequence for repeated slang.
//
// Contract (school zero-tolerance, no auto-punishment):
//   * 1+ UNIQUE slang terms in one blocked submission = that many violations.
//     Repetition of the SAME term inside one submission does not farm extra
//     violations (the caller passes a de-duplicated Set).
//   * The violation counter is SEPARATE from `users_meta.strikes`, which is
//     owned by the human report ladder (STRIKE_SUSPEND_AT / STRIKE_BAN_AT).
//     Overloading that column would let automated slang hits suspend or ban
//     a user with no human in the loop — exactly what we must not do.
//   * At ESCALATE_AT violations the user is escalated: an admin is notified,
//     the user is warned that an admin will review, and NOTHING is blocked
//     automatically. The admin chooses the scope (full block / browse only /
//     feed only) or dismisses the escalation.
//
// State lives in the schema-free `settings` KV (see _restrictions.js for why).

import supabase from "./_db-client.js";
import { auditLog, notifyUser } from "./_auth.js";
import { RESTRICTION_SCOPES, SCOPE_LABELS, setRestriction, clearRestriction } from "./_restrictions.js";

/** Violations before an admin must look at the user. */
export const ESCALATE_AT = 3;
/** Upper bound on the counter so a fuzzed submission cannot inflate it. */
export const MAX_VIOLATIONS = 999;

const PENDING_KEY = "escalations:pending";

async function readSetting(key) {
	const { data, error } = await supabase
		.from("settings")
		.select("key,value")
		.eq("key", key)
		.maybeSingle();
	if (error) {
		console.error(`[escalation] read ${key} failed:`, error.message);
		return null;
	}
	return data?.value ?? null;
}

async function writeSetting(key, value) {
	const { data } = await supabase
		.from("settings")
		.select("key")
		.eq("key", key)
		.maybeSingle();
	if (data) {
		const { error } = await supabase.from("settings").update({ value }).eq("key", key);
		if (error) throw error;
	} else {
		const { error } = await supabase.from("settings").insert({ key, value });
		if (error) throw error;
	}
}

/** The escalation record for an anon id, or null. Never throws. */
export async function getEscalation(anonId) {
	const id = String(anonId || "").toLowerCase();
	if (!/^anon_/.test(id)) return null;
	try {
		return await readSetting(`escalation:${id}`);
	} catch (e) {
		console.error("[escalation] get failed:", e?.message);
		return null;
	}
}

/** Every escalation currently waiting on an admin decision. */
export async function getPendingEscalations() {
	try {
		const v = await readSetting(PENDING_KEY);
		const items = v?.items && typeof v.items === "object" ? v.items : {};
		return Object.values(items)
			.filter((row) => row && row.status === "escalated")
			.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
	} catch (e) {
		console.error("[escalation] pending list failed:", e?.message);
		return [];
	}
}

async function addToPending(record) {
	const v = (await readSetting(PENDING_KEY)) || {};
	const items = v.items && typeof v.items === "object" ? v.items : {};
	items[record.anon_id] = record;
	await writeSetting(PENDING_KEY, { items, updated_at: new Date().toISOString() });
}

async function removeFromPending(anonId) {
	const v = (await readSetting(PENDING_KEY)) || {};
	const items = v.items && typeof v.items === "object" ? { ...v.items } : {};
	if (!(anonId in items)) return;
	delete items[anonId];
	await writeSetting(PENDING_KEY, { items, updated_at: new Date().toISOString() });
}

/**
 * Record `count` slang violations for `authorId`.
 * Best-effort: never throws and never delays the caller's content block.
 *
 * Returns { violations, escalated, restricted, already_escalated }.
 */
export async function recordSlangViolation(authorId, count, meta = {}) {
	const out = { violations: 0, escalated: false, restricted: false, already_escalated: false };
	try {
		const id = String(authorId || "").toLowerCase();
		if (!id || !/^anon_/.test(id) || id === "admin") return out;
		const add = Math.max(1, Math.min(Number(count) || 1, MAX_VIOLATIONS));

		const prev = (await getEscalation(id)) || {
			anon_id: id,
			violations: 0,
			terms: [],
			first_at: new Date().toISOString(),
			status: "watch",
		};
		const violations = Math.min(prev.violations + add, MAX_VIOLATIONS);
		const terms = Array.isArray(prev.terms) ? prev.terms.slice(0, 20) : [];
		for (const t of Array.isArray(meta.terms) ? meta.terms : []) {
			const term = String(t).slice(0, 40);
			if (term && !terms.includes(term) && terms.length < 20) terms.push(term);
		}

		const crossed = prev.violations < ESCALATE_AT && violations >= ESCALATE_AT;
		const record = {
			...prev,
			violations,
			terms,
			last_at: new Date().toISOString(),
			target_type: String(meta.targetType || prev.target_type || "").slice(0, 20) || undefined,
			status: violations >= ESCALATE_AT ? "escalated" : "watch",
		};
		await writeSetting(`escalation:${id}`, record);
		out.violations = violations;

		if (record.status === "escalated") {
			if (crossed) {
				await addToPending(record);
				out.escalated = true;
				// Admin delivery: notifyUser("ADMIN") is a deliberate no-op
				// (_auth.js skips it), and there is no admin notification
				// channel to write to. The admin console gets this through
				// the `escalated_users` poll (pending_escalations), which
				// raises the in-app popup — see src/hooks/useAdminStream.ts.
				// No restriction is applied here either: that is a human
				// decision (see resolveEscalation).
				await auditLog("moderation", "slang_escalated", `${id} reached ${violations} slang violations; awaiting admin scope decision`);
				await notifyUser(
					id,
					"warning",
					"Slang escalation — a moderator is reviewing",
					"Your posts were blocked for repeated slang. A moderator will review your account and decide what happens next. Nothing is restricted until they do.",
				);
			} else {
				out.already_escalated = true;
			}
		} else {
			await auditLog("moderation", "slang_violation", `${id} now at ${violations}/${ESCALATE_AT} slang violations (+${add})`);
			await notifyUser(
				id,
				"warning",
				`Slang warning ${violations}/${ESCALATE_AT}`,
				"Your post was blocked for slang. Repeated slang is escalated to a human admin for review.",
			);
		}
		return out;
	} catch (e) {
		console.error("[escalation] record failed:", e?.message);
		return out;
	}
}

/**
 * Admin decision on an escalation.
 *   action "apply"   → restrict the user with `scope`
 *   action "dismiss" → lift / leave unrestricted, escalation closed
 */
export async function resolveEscalation(anonId, action, meta = {}) {
	const id = String(anonId || "").toLowerCase();
	if (!id || !/^anon_/.test(id)) return { ok: false, error: "Invalid anonymous ID." };
	const by = String(meta.by || "admin").slice(0, 60);

	if (action === "apply") {
		const scope = RESTRICTION_SCOPES.includes(meta.scope) ? meta.scope : "full_block";
		const esc = (await getEscalation(id)) || { violations: 0 };
		const row = await setRestriction(id, scope, {
			violations: esc.violations,
			reason: String(meta.reason || `Slang escalation (${esc.violations} violations)`),
			by,
			expires_at: meta.expires_at || null,
		});
		await writeSetting(`escalation:${id}`, { ...(await getEscalation(id)) || {}, anon_id: id, status: "resolved", resolved_at: new Date().toISOString(), resolution: `restricted:${scope}` });
		await removeFromPending(id);
		await notifyUser(
			id,
			"warning",
			"Your account has been restricted",
			`A moderator restricted this ID: ${SCOPE_LABELS[scope]}. You can still browse and report content you believe was wrongly removed.`,
		);
		await auditLog("moderation", "escalation_applied", `${id} restricted to ${scope} by ${by}`);
		return { ok: true, restriction: row };
	}

	if (action === "dismiss") {
		await clearRestriction(id);
		const esc = (await getEscalation(id)) || { anon_id: id, violations: 0 };
		await writeSetting(`escalation:${id}`, {
			...esc,
			anon_id: id,
			status: "dismissed",
			resolved_at: new Date().toISOString(),
			resolution: "dismissed",
		});
		await removeFromPending(id);
		await notifyUser(
			id,
			"info",
			"Your escalation was reviewed",
			"A moderator reviewed your account and took no further action. Please keep posts free of slang.",
		);
		await auditLog("moderation", "escalation_dismissed", `${id} escalation dismissed by ${by}`);
		return { ok: true, dismissed: true };
	}

	return { ok: false, error: "Unknown escalation action." };
}

export default { ESCALATE_AT, getEscalation, getPendingEscalations, recordSlangViolation, resolveEscalation };
