// Shared closed-post retention rule.
//
// A post that reaches a closed status (solved / archived) is kept for
// CLOSED_RETENTION_DAYS after the LAST thing that happened to it, then
// hard-deleted. "Last thing" is the newest of:
//   • the status-history stamp for the closed status (the real close moment)
//   • posts.updated_at — comments and reactions bump it, so activity resets
//     the countdown instead of deleting a post people are still replying to
//   • posts.created_at (last-resort floor for legacy rows)
//
// Both the student-facing `purge_at` countdown and every server sweep derive
// their deadline from THIS module, so the countdown can never promise a date
// the sweep does not honour — and two sweeps can never disagree.
//
// Returns null when nothing is parseable. A purge must never fire on unknown
// age: a bad row is skipped and retried on the next pass.

import supabase from "./_db-client.js";

export const CLOSED_STATUSES = ["solved", "archived"];
// ONE window for every closed status. There is deliberately no solved-specific
// branch: a fixed solve+N window let the sweep delete a thread that people were
// still replying to, while the student-facing countdown, the privacy copy and
// the admin card all promised "5 days after last activity, activity resets".
// A second rule in this module is how those promises drifted apart once
// already, so status must not influence the deadline at all.
export const CLOSED_RETENTION_DAYS = 5;
export const CLOSED_RETENTION_MS = CLOSED_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const DEFAULT_USER_DELETE_HOURS = 5;

/** True when a post status is terminal and therefore subject to retention. */
export function isClosedStatus(status) {
	return CLOSED_STATUSES.includes(status);
}

function parseMs(value) {
	if (!value) return null;
	const t = Date.parse(value);
	return Number.isFinite(t) ? t : null;
}

/** Timestamp of the last status_history entry that closed the post. */
export function closedAtMs(post) {
	const hist = Array.isArray(post?.status_history) ? post.status_history : [];
	for (let i = hist.length - 1; i >= 0; i--) {
		const entry = hist[i];
		if (!entry || !entry.at || !CLOSED_STATUSES.includes(entry.status)) continue;
		const t = parseMs(entry.at);
		if (t !== null) return t;
	}
	return null;
}

/**
 * Epoch-ms of the last status_history entry that SOLVED the post, falling back
 * to updated_at / created_at for legacy rows with no usable history. Null when
 * nothing parses.
 *
 * This is the REPORTING answer to "when was this resolved" (solved_by_week,
 * the weekly trend, the admin executive summary). Those must bucket a
 * resolution by the day it happened, and updated_at cannot answer that: every
 * later comment or edit rewrites it, so an old complaint solved on Monday is
 * filed under whichever week someone last replied in — which is what made the
 * report deck disagree with the board.
 *
 * The retention deadline above deliberately does NOT use this: its window is
 * reset by activity, so pinning it to the solve moment would delete threads
 * people are still replying to. Reporting and retention read the same stamp
 * here, but only for display.
 */
export function solvedAtMs(post) {
	const hist = Array.isArray(post?.status_history) ? post.status_history : [];
	for (let i = hist.length - 1; i >= 0; i--) {
		const entry = hist[i];
		if (!entry || entry.status !== "solved") continue;
		const t = parseMs(entry.at);
		if (t !== null) return t;
	}
	for (const value of [post?.updated_at, post?.created_at]) {
		const t = parseMs(value);
		if (t !== null) return t;
	}
	return null;
}

/**
 * Absolute epoch-ms deadline for hard-deleting a closed post, or null when the
 * row carries no usable timestamp.
 *
 * Deadline = newest observed event + CLOSED_RETENTION_DAYS, where "event" is
 * the close stamp in status_history, posts.updated_at (comments and reactions
 * bump it, so activity resets the countdown) or posts.created_at as a
 * last-resort floor for legacy rows. Status is intentionally NOT consulted:
 * solved and archived behave identically.
 */
export function closedRetentionDueAt(post) {
	const stamps = [
		closedAtMs(post),
		parseMs(post?.updated_at),
		parseMs(post?.created_at),
	].filter((t) => t !== null);
	if (!stamps.length) return null;
	return Math.max(...stamps) + CLOSED_RETENTION_MS;
}

/** Convenience predicate used by the sweeps. */
export function isClosedRetentionDue(post, now = Date.now()) {
	const due = closedRetentionDueAt(post);
	return due !== null && due <= now;
}

/**
 * Parse the admin `user_delete_hours` window.
 *
 * Accepts a number, or a numeric string (the admin write path accepts one and
 * persists a number, so strings here are legacy/hand-edited rows). Rejects
 * everything else — `Number()` would otherwise turn `true` into a 1-hour
 * window and `[12]` into 12, silently hard-deleting user content on a
 * corrupted setting. Returns null when the value is not usable, so callers
 * keep their default instead of switching a sweep off.
 */
export function parseRetentionHours(raw) {
	if (typeof raw === "number") {
		return Number.isInteger(raw) && raw >= 1 && raw <= 168 ? raw : null;
	}
	if (typeof raw === "string" && raw.trim() !== "") {
		const n = Number(raw);
		return Number.isInteger(n) && n >= 1 && n <= 168 ? n : null;
	}
	return null;
}

/**
 * Admin retention policy from settings.retention_config.
 * Defaults preserve the shipped behaviour: everything enabled, 5h user-delete.
 * The `solved_posts` class key is kept verbatim for backwards compatibility
 * even though the rule now covers archived posts too.
 */
export async function getRetentionPolicy() {
	const policy = {
		autoDeleteEnabled: true,
		closedPostsEnabled: true,
		userDeleteHours: DEFAULT_USER_DELETE_HOURS,
	};
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "retention_config")
			.maybeSingle();
		const value = data?.value || {};
		if (value.auto_delete_enabled === false) policy.autoDeleteEnabled = false;
		if (value.classes?.solved_posts === false) policy.closedPostsEnabled = false;
		const hours = parseRetentionHours(value.user_delete_hours);
		if (hours !== null) {
			policy.userDeleteHours = hours;
		}
	} catch {
		/* defaults stand — a settings read failure must not disable retention */
	}
	return policy;
}
