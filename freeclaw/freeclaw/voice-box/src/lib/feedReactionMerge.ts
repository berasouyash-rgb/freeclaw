import type { PostData } from "../types";

/**
 * Parent-side merge for an authoritative reaction result.
 *
 * Why this exists: the reaction POST response is the freshest truth for one
 * row (global counts + the caller's own kinds). Folding it into the parent
 * list immediately — instead of waiting for the next full refresh — is what
 * keeps reacted cards moving while other users' realtime deltas land on top.
 * Pure (no React) so the merge rule is unit-testable in isolation.
 */

/** Replace one row's counts with the server's authoritative counts. */
export function mergeReactionCounts(
	posts: PostData[],
	id: string,
	counts: Record<string, number>,
): PostData[] {
	return posts.map((p) =>
		p.id === id ? { ...p, reactions: { ...counts } } : p,
	);
}

/**
 * Fold the server mine list for one row into the my-map.
 * An absent/empty list clears the entry (toggle-off converges to no mine).
 */
export function applyServerMine(
	prev: Record<string, string[]>,
	id: string,
	mine: string[],
): Record<string, string[]> {
	if (!mine || mine.length === 0) {
		if (!(id in prev)) return prev;
		const next = { ...prev };
		delete next[id];
		return next;
	}
	return { ...prev, [id]: [...mine] };
}
