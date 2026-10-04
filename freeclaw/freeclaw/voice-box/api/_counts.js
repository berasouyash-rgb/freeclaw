// ─── Derived-count cache (feed load-shedding) ─────────────────────────
//
// attachCounts() used to cost FOUR Postgres round trips on EVERY feed read:
// reactions, comments and polls in parallel, then a strictly serialized
// poll_votes pass (it cannot start before the polls rows reveal which poll
// ids exist). That is 4 × N database queries for N concurrent visitors, and
// it — plus one exact COUNT(*) on page 1 — is what actually blows the p95
// budget at 1 000–5 000 concurrent users: the expensive 2000-row feed scan
// is already behind staleWhileRevalidate, so the DERIVED queries are the
// remaining per-request DB work.
//
// This module puts those four queries behind the same staleWhileRevalidate
// primitive the feed rows already use, keyed by a digest of the id set.
//
// Freshness, stated honestly:
//   • ttl 3 s      — a warm entry answers instantly for 3 s.
//   • staleTtl 6 s — after that it is still served while ONE background
//     fetch revalidates (deduped per key, so a burst cannot stampede).
//   • Under Vitest the cache is BYPASSED (same contract as feedSWR) so every
//     test exercises the real query path against its own mocked data.
//
// Why a bounded window is acceptable rather than a compromise on "no fake
// data": every count surface the client renders already has a faster,
// uncached truth path.
//   • Connected viewers get reactions/comments as exact local deltas from
//     realtime (Home applies bumpReaction/bumpCommentCount), which never
//     round-trips the server at all.
//   • Poll totals come from GET /api/polls?ids= … — a different handler that
//     never touches this cache — which is what the ≤100 ms vote lane calls.
//   • The feed rows themselves are allowed ttl 10 s / stale 60 s today, so
//     these counts are an order of magnitude fresher than the list they
//     decorate.
// The cache therefore only ever affects a cold render, where a ≤6 s old
// counter is imperceptible — and it is what makes the read path scale.

import { staleWhileRevalidate } from "./_cache.js";
import supabase from "./_db-client.js";

const CHUNK_SIZE = 100;

// Two independent FNV-1a passes (different offset basis) so the digest is
// 64-bit effective. A single 32-bit pass over ~100 ids has a birthday
// collision probability near 1 in 200 000 at maxEntries — small, but a
// collision would hand one page's counts to a DIFFERENT page, which is
// exactly the "silently wrong number" failure this platform must never ship.
function digest(ids) {
	// Sort first: two views that happen to contain the same id set share one
	// entry regardless of ordering, and the length prefix keeps ["a","b"]
	// distinct from ["ab"].
	const joined = [...ids].sort().join("\u0001");
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let i = 0; i < joined.length; i++) {
		const c = joined.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193) >>> 0;
		b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
	}
	return `${ids.length}-${a.toString(36)}-${b.toString(36)}`;
}

// The four raw count queries for a set of post ids. Returns maps only — the
// per-post presentation (status gates, ready_for_decision, purge_at) is
// deliberately computed on every request in _posts.js so wall-clock and
// status-dependent fields are NEVER cached.
async function fetchRawCounts(ids) {
	const chunks = [];
	for (let i = 0; i < ids.length; i += CHUNK_SIZE)
		chunks.push(ids.slice(i, i + CHUNK_SIZE));

	const results = await Promise.all(
		chunks.flatMap((chunk) => [
			supabase
				.from("reactions")
				.select("target_id,kind")
				.in("target_id", chunk),
			supabase
				.from("comments")
				.select("post_id")
				.in("post_id", chunk)
				.eq("deleted", false)
				.eq("hidden", false),
			supabase.from("polls").select("id,post_id").in("post_id", chunk),
		]),
	);

	const allReactions = [];
	const allComments = [];
	const allPolls = [];

	// Unpack results: every 3 entries correspond to one chunk (reactions, comments, polls)
	for (let i = 0; i < results.length; i += 3) {
		const reactRes = results[i];
		const commRes = results[i + 1];
		const pollRes = results[i + 2];
		if (reactRes.data) allReactions.push(...reactRes.data);
		if (commRes.data) allComments.push(...commRes.data);
		if (pollRes.data) allPolls.push(...pollRes.data);
	}

	const rMap = {};
	const cMap = {};
	const pollsByPost = {};
	allReactions.forEach((r) => {
		rMap[r.target_id] = rMap[r.target_id] || {};
		rMap[r.target_id][r.kind] = (rMap[r.target_id][r.kind] || 0) + 1;
	});
	allComments.forEach((c) => {
		cMap[c.post_id] = (cMap[c.post_id] || 0) + 1;
	});
	allPolls.forEach((p) => {
		(pollsByPost[p.post_id] = pollsByPost[p.post_id] || []).push(p.id);
	});

	// Live vote count per linked poll. Vote upserts never write the polls row,
	// so count poll_votes rows directly (same source as /api/polls results).
	const pollIds = [...new Set(Object.values(pollsByPost).flat())].filter(Boolean);
	const pvMap = {};
	for (let i = 0; i < pollIds.length; i += CHUNK_SIZE) {
		const chunk = pollIds.slice(i, i + CHUNK_SIZE);
		const { data: votes } = await supabase
			.from("poll_votes")
			.select("poll_id")
			.in("poll_id", chunk);
		(votes || []).forEach((v) => {
			pvMap[v.poll_id] = (pvMap[v.poll_id] || 0) + 1;
		});
	}

	// Canonical linked poll: a double-created question can leave several poll
	// rows on one post with the votes split between them. Link the highest
	// total (first-seen wins ties) so the feed badge shows the real count
	// instead of whichever duplicate the scan hits last.
	const pMap = {};
	for (const [postId, idsOfPost] of Object.entries(pollsByPost)) {
		let best = idsOfPost[0];
		for (const id of idsOfPost) {
			if ((pvMap[id] || 0) > (pvMap[best] || 0)) best = id;
		}
		pMap[postId] = best;
	}

	return { rMap, cMap, pMap, pvMap };
}

// ONE wrapper instance for the process lifetime — created per-request it
// would never hit. The digest rides FIRST in the key so two different id sets
// can never share an entry even though the helper truncates keys at 200 chars.
const countsSWR = staleWhileRevalidate((sig, ids) => fetchRawCounts(ids), {
	ttl: 3_000,
	staleTtl: 6_000,
	keyPrefix: "postcounts",
	maxEntries: 200,
});

const EMPTY = { rMap: {}, cMap: {}, pMap: {}, pvMap: {} };

export async function getRawCounts(ids) {
	if (!ids.length) return EMPTY;
	// Vitest bypass: every test must exercise the real four-query path against
	// its own mocked rows, or a warmed entry from a previous test would make
	// assertions lie (same reason feedSWR is bypassed there).
	if (process.env.VITEST) return fetchRawCounts(ids);
	return countsSWR(digest(ids), ids);
}

// Write paths call this so a mutation is visible immediately instead of
// waiting out the stale window. Cheap: it only clears two in-memory maps.
export function invalidateCounts() {
	countsSWR.invalidate();
}
