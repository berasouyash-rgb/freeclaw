// Slang-escalation restrictions — schema-free, stored in the `settings` KV.
//
// Why KV and not a column: `users_meta` cannot be ALTERed from a serverless
// function (no migration runner, no DDL rights), and `audit_logs` has no
// `user_id` column either. The settings KV is the one table this codebase
// already writes to for arbitrary key/value state (admin sessions, leader-
// board config, notifications), so restriction state lives there too.
//
// Keys (all values are plain JSON objects):
//   restriction:<anon_id>  { anon_id, scope, violations, reason, by, at, active }
//   escalation:<anon_id>   { anon_id, violations, terms, at, status }
//   escalations:pending    { items: { [anon_id]: escalationRecord } }
//
// Scope is an ALLOWLIST framing: it names what the user may still do, not
// what was taken away. That keeps the semantics stable when new surfaces are
// added later (an unknown surface fails closed into "blocked").
//
//   full_block   nothing allowed (only the always-on surfaces: reporting,
//                reading notifications, reading the restriction notice)
//   browse_only  read-only — same enforcement as full_block in this build
//                (feed reads are not gated by checkUser), but a distinct
//                user-facing state so the notice can say "browse, don't post"
//   feed_only    may still post / comment / react on the feed; every other
//                write surface (polls, communities, chat, uploads, assists,
//                profile prefs) is blocked

import supabase from "./_db-client.js";

export const RESTRICTION_SCOPES = ["full_block", "browse_only", "feed_only"];

/** Surfaces that stay available to a restricted user, whatever the scope.
 *  `presence` is a liveness heartbeat, not content: gating it would only
 *  produce client retry noise (and hide a browse-only user from the roster)
 *  with no safety benefit. Ban/suspension still refuse presence — that check
 *  runs before this one. */
const ALWAYS_ALLOWED = new Set([
	"report_create",
	"notification_read",
	"restriction_read",
	"presence",
]);

/** Surfaces a `feed_only` user may still use on top of the always-on set. */
const FEED_ALLOWED = new Set(["post_write", "comment_write", "reaction_write"]);

/** Capabilities a surface maps to, for scope resolution. */
export function surfaceCapability(surface) {
	if (ALWAYS_ALLOWED.has(surface)) return "always";
	if (FEED_ALLOWED.has(surface)) return "feed";
	return "app";
}

/**
 * Does `scope` block `surface`? Unknown surfaces and unknown scopes both fail
 * closed (blocked) — adding a new write path without tagging it can only ever
 * over-restrict a sanctioned user, never let one slip through.
 */
export function scopeBlocks(scope, surface) {
	const cap = surfaceCapability(surface);
	if (cap === "always") return false;
	if (!RESTRICTION_SCOPES.includes(scope)) return true; // unknown scope → block
	if (scope === "feed_only") return cap !== "feed";
	return true; // full_block / browse_only block every non-always surface
}

/** Human-readable label for the admin console and user-facing notices. */
export const SCOPE_LABELS = {
	full_block: "Full block",
	browse_only: "Browse only (no posting)",
	feed_only: "Feed only (posts & comments)",
};

/** Advisory index of live restrictions — Supabase cannot list KV keys. */
const ACTIVE_INDEX_KEY = "restrictions:active";

// ── storage helpers ─────────────────────────────────────────────

async function readSetting(key) {
	const { data, error } = await supabase
		.from("settings")
		.select("key,value")
		.eq("key", key)
		.maybeSingle();
	// Throws (rather than returning null) so a failed read can never be
	// mistaken for "no restriction" — the gate must fail closed.
	if (error) throw new Error(`settings read ${key}: ${error.message}`);
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

/** Active restriction for an anon id, or null.
 *  Throws on a storage read failure so the caller's gate can fail CLOSED —
 *  a restricted user must never slip through because the KV read hiccuped. */
export async function getRestriction(anonId) {
	const id = String(anonId || "").toLowerCase();
	if (!/^anon_/.test(id)) return null;
	const row = await readSetting(`restriction:${id}`);
	if (!row || row.active !== true) return null;
	if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;
	return row;
}

/** Apply (or re-apply) a scope. Returns the stored row. */
export async function setRestriction(anonId, scope, meta = {}) {
	const id = String(anonId || "").toLowerCase();
	const clean = RESTRICTION_SCOPES.includes(scope) ? scope : "full_block";
	const row = {
		anon_id: id,
		scope: clean,
		violations: Number(meta.violations) || 0,
		reason: String(meta.reason || "Repeated slang violations").slice(0, 300),
		by: String(meta.by || "system").slice(0, 60),
		created_at: new Date().toISOString(),
		expires_at: meta.expires_at || null,
		active: true,
	};
	await writeSetting(`restriction:${id}`, row);
	// Supabase cannot enumerate KV keys, so the admin console needs an index
	// to list live restrictions. Best-effort: the per-user row is authoritative.
	try {
		const idx = (await readSetting(ACTIVE_INDEX_KEY)) || { items: {} };
		idx.items = idx.items && typeof idx.items === "object" ? idx.items : {};
		idx.items[id] = { anon_id: id, scope: clean, at: row.created_at, by: row.by };
		await writeSetting(ACTIVE_INDEX_KEY, { items: idx.items, updated_at: new Date().toISOString() });
	} catch (e) {
		console.error("[restrictions] index update failed:", e?.message);
	}
	return row;
}

/** Lift a restriction (admin dismissed it, or it expired). */
export async function clearRestriction(anonId) {
	const id = String(anonId || "").toLowerCase();
	try {
		const existing = await readSetting(`restriction:${id}`);
		if (!existing) return false;
		await writeSetting(`restriction:${id}`, { ...existing, active: false, cleared_at: new Date().toISOString() });
		try {
			const idx = (await readSetting(ACTIVE_INDEX_KEY)) || { items: {} };
			const items = idx.items && typeof idx.items === "object" ? { ...idx.items } : {};
			delete items[id];
			await writeSetting(ACTIVE_INDEX_KEY, { items, updated_at: new Date().toISOString() });
		} catch {
			/* index is advisory only */
		}
		return true;
	} catch (e) {
		console.error("[restrictions] clear failed:", e?.message);
		return false;
	}
}

/** Every restriction currently in force (admin console listing). */
export async function listActiveRestrictions() {
	try {
		const idx = (await readSetting(ACTIVE_INDEX_KEY)) || { items: {} };
		const entries = idx.items && typeof idx.items === "object" ? Object.values(idx.items) : [];
		// Re-read each row so a stale index entry never reports a lifted
		// restriction as active.
		const rows = await Promise.all(
			entries.map(async (e) => {
				const row = await getRestriction(e?.anon_id);
				return row ? { ...row } : null;
			}),
		);
		return rows.filter(Boolean).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
	} catch (err) {
		console.error("[restrictions] list failed:", err?.message);
		return [];
	}
}
