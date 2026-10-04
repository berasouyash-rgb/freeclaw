import type { RealtimePayload } from "./useRealtime";

/**
 * "This row must leave the viewer's screen now."
 *
 * The server never serves hidden or deleted rows to a public surface:
 *
 *   - the feed filters them out for EVERY viewer, admins included
 *     (`api/_posts.js:456-460`), because the admin `all=1` flag is what
 *     unlocks them (`api/_posts.js:398`) and no public page sends it;
 *   - a direct-by-id read returns 404 unless the caller is an admin or the
 *     row's own author (`api/_posts.js:521-531`);
 *   - a hard DELETE removes the row outright.
 *
 * So a client still holding such a row in memory is holding content the next
 * authoritative read would refuse — and moderation relies on that read being
 * enforced *now*, not whenever the reader happens to tap "N updates".
 *
 * The old client behaviour could not deliver that: a posts UPDATE ran the
 * quiet merge (`Home.tsx`), which is `prev.map(p => freshById.get(p.id) ?? p)`
 * and therefore KEEPS every row absent from the response — the reload
 * happened and its result was thrown away — while a posts DELETE only raised
 * the update badge.
 *
 * `permanent` carries the one asymmetry the server allows:
 *   - hard DELETE → gone for everyone, forever;
 *   - hidden / soft-deleted → still loadable by its author, so a detail page
 *     the author is looking at must not blank itself. A feed must drop it
 *     either way, since the feed never returns it, author or not.
 */
export interface PostWithdrawal {
	/** The post id that must leave the screen. */
	id: string;
	/** True when the row was physically deleted and nobody can load it again. */
	permanent: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function asId(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Decide whether a realtime payload withdraws a post from the viewer.
 *
 * Returns `null` for every payload that must be handled by the caller's
 * normal path (other tables, unknown events, live rows) — the predicate is
 * pure and has no side effects, so call sites can guard their handler with it
 * without changing anything else.
 *
 * Note the INSERT case: a row inserted with `hidden`/`deleted` already set
 * (quarantine-on-create) was never in a feed, so this is a no-op today. The
 * rule is stated over the row's state rather than the event type on purpose —
 * a reader must not have to reason about which event carried the flag.
 */
export function postWithdrawal(
	table: string,
	payload: RealtimePayload,
): PostWithdrawal | null {
	if (table !== "posts") return null;

	const event = payload.eventType;
	if (event !== "INSERT" && event !== "UPDATE" && event !== "DELETE") return null;

	const next = asRecord(payload.new);
	const previous = asRecord(payload.old);

	if (event === "DELETE") {
		// Supabase carries the primary key in `old` for DELETE; fall back to
		// `new` so a replica-identity change cannot silently disarm removal.
		const id = asId(previous?.id) ?? asId(next?.id);
		return id ? { id, permanent: true } : null;
	}

	const id = asId(next?.id);
	if (!id) return null;
	if (next?.hidden === true || next?.deleted === true) {
		return { id, permanent: false };
	}
	return null;
}
