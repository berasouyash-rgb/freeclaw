import {
	Activity,
	ArrowUp,
	CheckCircle2,
	Clock,
	FileText,
	Megaphone,
	MessageCircle,
	MessageSquare,
	PlusCircle,
	Search,
	SlidersHorizontal,
	Sparkles,
	Target,
	ThumbsUp,
	TrendingUp,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import UpdateNotice from "../components/admin/UpdateNotice";
import { useUpdateSignal } from "../hooks/useUpdateSignal";
import { Link } from "react-router";
import CountUp from "../components/CountUp";
import GlowButton from "../components/GlowButton";
import GridPattern from "../components/ui/grid-pattern";
import ShimmerButton from "../components/ui/shimmer-button";
import BorderBeam from "../components/ui/border-beam";
import PostCard from "../components/PostCard";
import RecapCard from "../components/RecapCard";
import Trend, { Sparkline } from "../components/Trend";
import WordCloud from "../components/WordCloud";
import { useApp } from "../contexts/AppContext";
import { useCategories } from "../hooks/useCategories";
import { api } from "../lib/api";
import { apiBase, isNativeShell } from "../lib/platform";
import { useRealtime, type RealtimePayload } from "../lib/useRealtime";
import { dedupeById, errorText, trendingScore } from "../lib/utils";
import type { PollData, PostData, ReactionEntry } from "../types";

// ─── Cross-visit feed snapshot ────────────────────────────────
// The feed mounts fresh on every route entry, which used to mean an empty
// list + a network round-trip on EVERY visit (the "navigating always
// loads" flash). This module-level snapshot lets a revisit paint the
// last-known list INSTANTLY, then silently revalidate behind the existing
// quiet-merge path (newcomers park behind the pill — never a reorder, no
// skeleton, no flash).
// Bounds (so it can never show the wrong thing): default view only —
// never a search/filter result — and at most HOME_SNAPSHOT_TTL_MS old.
// Realtime deltas keep applying on top, and every explicit refresh (manual,
// pill, badge) overwrites it, so it converges instead of going stale.
interface HomeSnapshot {
	posts: PostData[];
	myReactions: Record<string, string[]>;
	pollsMap: Record<string, PollData>;
	myPollVotes: Record<string, number[]>;
	knownIds: string[];
	at: number;
}
let homeSnapshot: HomeSnapshot | null = null;
const HOME_SNAPSHOT_TTL_MS = 60_000;
// Persisted so a full page RELOAD — not just an in-app revisit — can paint too.
// sessionStorage, not localStorage: the snapshot dies with the tab, so a shared
// school machine never shows the previous student's feed and nothing outlives
// the anonymous session that produced it.
const HOME_SNAPSHOT_KEY = "voicebox:home-snapshot:v1";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v);

/** Write-through: stores the snapshot and returns it, for `homeSnapshot = persist(x)`. */
function persistSnapshot(snapshot: HomeSnapshot): HomeSnapshot {
	try {
		sessionStorage.setItem(HOME_SNAPSHOT_KEY, JSON.stringify({ v: 1, ...snapshot }));
	} catch {
		// Storage disabled or over quota — the in-memory snapshot still works.
	}
	return snapshot;
}

/**
 * Reads the persisted snapshot, or null when it is absent, foreign, corrupt or
 * expired. Every field is re-validated: sessionStorage is writable by anything
 * running on the origin and can hold a half-written value, and a bad shape here
 * would paint a broken feed or throw during render.
 */
function readPersistedSnapshot(): HomeSnapshot | null {
	try {
		const raw = sessionStorage.getItem(HOME_SNAPSHOT_KEY);
		if (!raw) return null;
		const p = JSON.parse(raw) as Partial<HomeSnapshot> & { v?: number };
		if (!isPlainObject(p) || p.v !== 1) return null;
		if (!Array.isArray(p.posts) || p.posts.length === 0) return null;
		if (!Array.isArray(p.knownIds)) return null;
		if (typeof p.at !== "number" || !isHomeSnapshotFresh(p.at)) return null;
		return {
			posts: p.posts,
			myReactions: isPlainObject(p.myReactions)
				? (p.myReactions as Record<string, string[]>)
				: {},
			pollsMap: isPlainObject(p.pollsMap)
				? (p.pollsMap as unknown as Record<string, PollData>)
				: {},
			myPollVotes: isPlainObject(p.myPollVotes)
				? (p.myPollVotes as Record<string, number[]>)
				: {},
			knownIds: p.knownIds,
			at: p.at,
		};
	} catch {
		return null;
	}
}

/** Test-only reset of the persisted copy (the in-memory reset is below). */
export function clearPersistedSnapshot(): void {
	try {
		sessionStorage.removeItem(HOME_SNAPSHOT_KEY);
	} catch {
		/* nothing to clear */
	}
}

export function isHomeSnapshotFresh(at: number, now = Date.now()): boolean {
	return now - at < HOME_SNAPSHOT_TTL_MS;
}

/** Test-only reset: module state would otherwise leak across test cases. */
export function __resetHomeSnapshot(): void {
	homeSnapshot = null;
	clearPersistedSnapshot();
}

const SORTS = [
	{ key: "trending", label: "Trending", icon: TrendingUp },
	{ key: "newest", label: "Newest", icon: Clock },
	{ key: "discussed", label: "Most Discussed", icon: MessageCircle },
	{ key: "supported", label: "Most Supported", icon: ThumbsUp },
];
type FeedType = "all" | "problem" | "suggestion" | "poll";
type FeedLoadOptions = {
	silent?: boolean;
	fresh?: boolean;
	search?: string;
	feedType?: FeedType;
	category?: string;
	status?: string;
};

function buildPostsPath({
	search = "",
	feedType = "problem",
	category = "All",
	status = "all",
	fresh = false,
}: {
	search?: string;
	feedType?: FeedType;
	category?: string;
	status?: string;
	fresh?: boolean;
}) {
	// One bounded load: the server returns the whole visible feed (up to 300
	// rows) in a single response. No pagination, no Load more — scrolling is
	// the only action. Pinned posts sort to the top client-side.
	const params: string[] = [];
	const term = search.trim();
	if (term) params.push(`q=${encodeURIComponent(term)}`);
	if (feedType !== "all") params.push(`type=${encodeURIComponent(feedType)}`);
	if (category && category !== "All") {
		params.push(`category=${encodeURIComponent(category)}`);
	}
	if (status && status !== "all") params.push(`status=${encodeURIComponent(status)}`);
	if (fresh) params.push("fresh=1");
	return `/api/posts${params.length ? `?${params.join("&")}` : ""}`;
}

export default function Home() {
	const { anonId } = useApp();
	const categories = useCategories();
	const [posts, setPosts] = useState<PostData[]>([]);
	const [myReactions, setMyReactions] = useState<Record<string, string[]>>({});
	// No skeleton preloader: the list area stays quiet until the first load
	// settles, then shows posts, the honest empty state, or the error.
	const [hasLoaded, setHasLoaded] = useState(false);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");
	const [cat, setCat] = useState("All");
	const [feedType, setFeedType] = useState<FeedType>("problem");
	const [sort, setSort] = useState("newest");
	const [statusFilter, setStatusFilter] = useState("all");
	const [showFilters, setShowFilters] = useState(false);
	const [pendingNew, setPendingNew] = useState(0);
	const [pollsMap, setPollsMap] = useState<Record<string, PollData>>({});
	const [myPollVotes, setMyPollVotes] = useState<Record<string, number[]>>({});
	const knownIdsRef = useRef<Set<string>>(new Set());
	const inflightFeedRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
	// Monotonic load id: mount + realtime refreshes race (a slow cold fetch
	// must never clobber a newer fast one), so stale losers return early.
	const loadSeqRef = useRef(0);
	// Storm guards: fetchPolls and the realtime my-reactions refresh skip
	// redundant network work when nothing structurally changed, so bursts of
	// realtime events don't translate into N+1 request storms ("too many").
	const pollsKeyRef = useRef("");
	const pollsLoadedRef = useRef(false);

	const load = useCallback(
		(options: FeedLoadOptions = {}): Promise<void> => {
			const {
				silent = false,
				fresh = silent,
				search = "",
				feedType: requestedType = "problem",
				category = "All",
				status = "all",
			} = options;
			const normalizedSearch = search.trim();
			const isDefaultView =
				!normalizedSearch &&
				requestedType === "problem" &&
				category === "All" &&
				status === "all";
			const requestKey = `${fresh ? "fresh" : "cached"}|${requestedType}|${normalizedSearch}|${category}|${status}`;
			const current = inflightFeedRef.current;
			if (current?.key === requestKey) return current.promise;

			const request = (async () => {
				const seq = ++loadSeqRef.current;
				try {
					setError("");
					// The first bounded load is cached for route entry. Explicit
					// refreshes and realtime updates bypass the 5s client cache so
					// a user never has to wait for a stale snapshot to expire.
					const fetchPosts = fresh ? api.getSlowFresh : api.getSlow;
					const fetchReactions = fresh || silent ? api.getFresh : api.get;
					const [postResponse, reactions] = await Promise.all([
						fetchPosts<
							PostData[] | { data: PostData[]; nextCursor: string | null; total: number }
						>(buildPostsPath({
							search: normalizedSearch,
							feedType: requestedType,
							category,
							status,
							// Explicit refreshes demand a fully fresh read; silent
							// background reloads share the server's 10s snapshot
							// so 1000 clients reacting to the same event don't
							// stampede the database (writes invalidate it, and
							// new posts ride behind the pill + targeted refetch).
							fresh: fresh && !silent,
						})),
						fetchReactions<ReactionEntry[]>(`/api/reactions?author=${anonId}`),
					]);
					const isEnvelope = !Array.isArray(postResponse);
					const data = isEnvelope ? postResponse.data : postResponse;
					if (seq !== loadSeqRef.current) return; // superseded by a newer load
					const map: Record<string, string[]> = {};
					reactions.forEach((r) => {
						map[r.target_id] = [...(map[r.target_id] || []), r.kind];
					});
					setMyReactions(map);

					if (silent && !normalizedSearch && knownIdsRef.current.size > 0) {
						// Live update while user may be scrolling: update existing rows in place,
						// but hold NEW posts behind the "New posts ↑" pill so the list never
						// reorders under their finger. A search result set is replaced
						// atomically instead, otherwise a realtime event would hide the
						// user's active search behind an unrelated live row.
						const newOnes = data.filter((p) => !knownIdsRef.current.has(p.id));
						if (newOnes.length > 0 && window.scrollY > 300) {
							setPosts((prev) =>
								prev.map((p) => data.find((d) => d.id === p.id) || p),
							);
							setPendingNew((n) => n + newOnes.length);
							newOnes.forEach((p) => knownIdsRef.current.add(p.id));
							return;
						}
						// Quiet merge: refresh known rows in place and prepend only
						// genuinely new ids, so a background refresh never deletes
						// rows the user is already reading.
						setPosts((prev) => {
							const freshById = new Map(data.map((p) => [p.id, p]));
							const merged = prev.map((p) => freshById.get(p.id) ?? p);
							const newcomers = data.filter(
								(p) => !prev.some((q) => q.id === p.id),
							);
							return dedupeById([...newcomers, ...merged]);
						});
						data.forEach((p) => knownIdsRef.current.add(p.id));
						setPendingNew(0);
						return;
					}
					const settled = dedupeById(data);
					setPosts(settled);
					knownIdsRef.current = new Set(settled.map((p) => p.id));
					setPendingNew(0);
					// Snapshot the default view so the next visit paints
					// instantly. Poll maps ride along from fetchPolls below;
					// carried-over maps are at most a minute old by TTL.
					if (isDefaultView) {
						homeSnapshot = persistSnapshot({
							posts: settled,
							myReactions: map,
							pollsMap: homeSnapshot?.pollsMap ?? {},
							myPollVotes: homeSnapshot?.myPollVotes ?? {},
							knownIds: settled.map((p) => p.id),
							at: Date.now(),
						});
					}
				} catch (e: unknown) {
					if (!silent && seq === loadSeqRef.current) {
						setError(errorText(e) || "Could not load feed");
					}
				} finally {
					if (seq === loadSeqRef.current) setHasLoaded(true);
				}
			})();
			inflightFeedRef.current = { key: requestKey, promise: request };
			const clearInflight = () => {
				if (inflightFeedRef.current?.promise === request) {
					inflightFeedRef.current = null;
				}
			};
			void request.then(clearInflight, clearInflight);
			return request;
		},
		[anonId],
	);

	// Fetch poll data + user's poll votes for posts that have linked_poll.
	// Runs after every post load so the feed always has up-to-date poll info.
	const fetchPolls = useCallback(
		async (postList: PostData[]) => {
			const pollIds = postList
				.map((p) => p.linked_poll)
				.filter((id): id is string => !!id);
			const uniquePollIds = [...new Set(pollIds)].slice(0, 50);
			// Storm guard: the posts effect re-runs on every realtime delta, but
			// when the SET of linked polls is unchanged there is nothing new to
			// fetch — live vote changes arrive via the targeted per-poll refetch
			// in the realtime handler. Skipping avoids an N+1 request burst per
			// realtime event ("too many requests" / server churn).
			const key = uniquePollIds.slice().sort().join("\u0000");
			if (pollsLoadedRef.current && key === pollsKeyRef.current) return;
			pollsLoadedRef.current = true;
			pollsKeyRef.current = key;
			if (!uniquePollIds.length) {
				setPollsMap({});
				return;
			}
			// One bounded batch replaces the previous one-request-per-poll fanout.
			// A failed poll fetch keeps the feed usable rather than failing it.
			const pollsFetch = api
				.getFresh<PollData[]>(
					`/api/polls?ids=${encodeURIComponent(uniquePollIds.join(","))}&viewer=${anonId}`,
				)
				.catch((err: unknown) => {
					console.error("[home] poll batch fetch failed", {
						error: err instanceof Error ? err.message : String(err),
					});
					return [] as PollData[];
				});
			const votesFetch = anonId
				? api.getFresh<{ poll_id: string; choices: number[] }[]>(
						`/api/polls?voter=${anonId}`,
					).catch((err: unknown) => {
						console.error("[home] poll votes fetch failed", { error: err instanceof Error ? err.message : String(err) });
						return [] as { poll_id: string; choices: number[] }[];
					})
				: Promise.resolve([]);
			const [pollResults, votes] = await Promise.all([pollsFetch, votesFetch]);
			const pMap: Record<string, PollData> = {};
			(Array.isArray(pollResults) ? pollResults : []).forEach((poll) => {
				if (poll?.id) pMap[poll.id] = poll;
			});
			setPollsMap(pMap);
			if (Array.isArray(votes)) {
				const vMap: Record<string, number[]> = {};
				for (const v of votes)
					if (v?.poll_id) vMap[v.poll_id] = v.choices || [];
			setMyPollVotes(vMap);
			// Poll/vote data is view-independent — fold it into a live
			// snapshot so revisits paint it instantly too.
			if (homeSnapshot) {
				homeSnapshot = persistSnapshot({ ...homeSnapshot, pollsMap: pMap, myPollVotes: vMap });
			}
			}
		},
		[anonId],
	);

	useEffect(() => {
		const term = query.trim();
		if (!term) {
			// Cold entry (nothing in memory yet) restores the tab's last snapshot
			// so a RELOAD paints the feed immediately instead of waiting on the
			// network — the reported "posts show up about 5s late".
			let restoredFromStorage = false;
			if (!homeSnapshot) {
				homeSnapshot = readPersistedSnapshot();
				restoredFromStorage = !!homeSnapshot;
			}
			if (
				feedType === "problem" &&
				cat === "All" &&
				statusFilter === "all" &&
				homeSnapshot &&
				isHomeSnapshotFresh(homeSnapshot.at)
			) {
				// Instant revisit: paint last-known state, then revalidate
				// behind the quiet-merge path (no flash, no reorder —
				// newcomers park behind the pill as usual).
				const snap = homeSnapshot;
				setPosts([...snap.posts]);
				setMyReactions(snap.myReactions);
				setPollsMap(snap.pollsMap);
				setMyPollVotes(snap.myPollVotes);
				knownIdsRef.current = new Set(snap.knownIds);
				setHasLoaded(true);
				// A RESTORED snapshot predates this page load, so the quiet merge
				// is wrong for it: that path only ever adds and updates rows, so a
				// post deleted since the snapshot was taken would stay on screen
				// for the rest of the session. Reconcile with a full replace
				// instead. The list is already painted, so this still shows no
				// skeleton and no empty flash.
				void load({
					silent: !restoredFromStorage,
					feedType,
					category: cat,
					status: statusFilter,
				});
				return;
			}
			void load({ feedType, category: cat, status: statusFilter });
			return;
		}
		// Search is a server-side operation. The local filter below remains a
		// rendering guard, but it must not be the only search boundary.
		const timer = setTimeout(() => {
			void load({
				fresh: true,
				search: term,
				feedType,
				category: cat,
				status: statusFilter,
			});
		}, 300);
		return () => clearTimeout(timer);
	}, [cat, feedType, load, query, statusFilter]);

	// Fetch polls whenever posts change
	useEffect(() => {
		if (posts.length) fetchPolls(posts);
	}, [posts, fetchPolls]);

	// Freshness signal, not a refetch: the feed loads ONCE per visit and
	// never reloads itself again. Reaction/comment/vote events still apply
	// their exact local deltas below (zero network), but posts, polls and
	// my-reaction-map changes only raise a badge — the reader pulls one
	// fresh snapshot with the update notice, the "New posts" pill, or
	// pull-to-refresh. This is what stopped the "reloads every few
	// seconds under any activity" storm.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();
	const [feedRefreshing, setFeedRefreshing] = useState(false);

	// Instant local deltas: the realtime payload carries the changed row, so
	// like/support counts from OTHER users are applied immediately without a
	// network round-trip (the old lightweight path only refreshed MY reaction
	// map, so everyone else's likes sat invisible until the 12s reload).
	// Applying the delta to the parent list is correct for every author: the
	// parent's counts are the last server snapshot, which never includes the
	// event that just fired — and PostCard ignores parent counts while its own
	// authoritative localCounts from the POST response are set.
	const applyDelta = useCallback(
		(postId: string, mutate: (p: PostData) => PostData) => {
			setPosts((prev) => {
				const idx = prev.findIndex((p) => p.id === postId);
				if (idx === -1) return prev;
				const cur = prev[idx];
				if (!cur) return prev;
				const next = [...prev];
				next[idx] = mutate(cur);
				return next;
			});
		},
		[],
	);

	const bumpReaction = useCallback(
		(targetId: string, kind: string | undefined, delta: number) => {
			if (!targetId || !kind) return;
			applyDelta(targetId, (p) => ({
				...p,
				reactions: {
					...(p.reactions || {}),
					[kind]: Math.max(0, (p.reactions?.[kind] || 0) + delta),
				},
			}));
		},
		[applyDelta],
	);

	// The feed counts only non-deleted, non-hidden comments (same rule the
	// /api/posts counter uses), so mirror that exactly here.
	const bumpCommentCount = useCallback(
		(postId: string, wasCounted: boolean, isCounted: boolean) => {
			if (!postId || wasCounted === isCounted) return;
			applyDelta(postId, (p) => ({
				...p,
				comment_count: Math.max(0, (p.comment_count || 0) + (isCounted ? 1 : -1)),
			}));
		},
		[applyDelta],
	);

	useRealtime(
		["posts", "reactions", "comments", "polls", "poll_votes"],
		(table: string, payload: RealtimePayload) => {
			const evt = payload.eventType;
			const rowLike = (v: unknown) =>
				(v && typeof v === "object"
					? (v as { target_id?: string; target_type?: string; post_id?: string; poll_id?: string; kind?: string; deleted?: boolean; hidden?: boolean; author_id?: string })
					: undefined);

			// ── Reaction events: apply the exact delta instantly. ──
			// The reactions table itself never delivers (no anon read — voter
			// identity stays private — so there is no channel for it). Its
			// liveness arrives one level up: every toggle touches the parent
			// posts row, which lands below as a posts UPDATE → badge. This
			// branch stays for the exact-delta path: own optimistic toggles
			// apply instantly, and any future allowed source reuses it.
			// The feed only surfaces post reactions; ignore other target types.
			if (table === "reactions" && (evt === "INSERT" || evt === "UPDATE" || evt === "DELETE")) {
				const next = rowLike(payload.new);
				const prev = rowLike(payload.old);
				const targetId = (evt === "DELETE" ? prev?.target_id : next?.target_id) ?? "";
				const targetType = evt === "DELETE" ? prev?.target_type : next?.target_type;
				if (targetId && (!targetType || targetType === "post")) {
					if (evt === "INSERT") bumpReaction(targetId, next?.kind, +1);
					else if (evt === "DELETE") bumpReaction(targetId, prev?.kind, -1);
					else {
						// UPDATE: kind may have changed (rare) — uncount old, count new.
						if (prev?.kind && prev.kind !== next?.kind)
							bumpReaction(targetId, prev.kind, -1);
						bumpReaction(targetId, next?.kind, +1);
					}
				}
				// MY reaction map re-syncs on the next explicit refresh (update
				// notice, pill, or pull-to-refresh) — no GET per event.
				return;
			}

			// ── Comment events: exact comment_count delta, mirrors server rule. ──
			if (table === "comments" && (evt === "INSERT" || evt === "UPDATE" || evt === "DELETE")) {
				const counted = (r: ReturnType<typeof rowLike>) =>
					!!r && r.deleted !== true && r.hidden !== true;
				const next = rowLike(payload.new);
				const prev = rowLike(payload.old);
				if (evt === "INSERT") bumpCommentCount(next?.post_id ?? "", false, counted(next));
				else if (evt === "DELETE") bumpCommentCount(prev?.post_id ?? "", counted(prev), false);
				else bumpCommentCount(next?.post_id ?? "", counted(prev), counted(next));
				return;
			}

			// ── Posts, polls and votes: freshness signal only. ──
			// No fetch here at all — not even the targeted per-poll one. A
			// viral poll fires one vote event per voter, and any refetch per
			// event rebuilds the feed under the reader. The badge below is
			// one click from current; own votes stay instant (optimistic).
			markUpdatesAvailable();
		},
		1500, // longer debounce for the batch
	);

	const showPending = () => {
		window.scrollTo({ top: 0, behavior: "smooth" });
		void load({
			fresh: true,
			search: query,
			feedType,
			category: cat,
			status: statusFilter,
		});
	};

	const refreshFeed = useCallback(
		() =>
			load({
				fresh: true,
				search: query,
				feedType,
				category: cat,
				status: statusFilter,
			}),
		[cat, feedType, load, query, statusFilter],
	);

	// Declared after refreshFeed: the dep array reads it during render.
	const handleFeedUpdate = useCallback(async () => {
		setFeedRefreshing(true);
		try {
			await refreshFeed();
			clearUpdates();
		} finally {
			setFeedRefreshing(false);
		}
	}, [refreshFeed, clearUpdates]);

	const filtered = useMemo(() => {
		let list = posts.filter((p) => !p.merged_into);
		if (feedType !== "all") list = list.filter((p) => p.type === feedType);
		if (cat !== "All") list = list.filter((p) => p.category === cat);
		if (statusFilter === "solved")
			list = list.filter((p) => p.status === "solved");
		if (query.trim()) {
			// Multi-word search: every word must match somewhere in title/description/tags/category
			const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
			list = list.filter((p) => {
				const haystack =
					`${p.title} ${p.description} ${(p.tags || []).join(" ")} ${p.category}`.toLowerCase();
				return words.every((w) => haystack.includes(w));
			});
		}
		const pinned = list.filter((p) => p.pinned);
		const rest = list.filter((p) => !p.pinned);
		const sorter: Record<string, (a: PostData, b: PostData) => number> = {
			trending: (a, b) => trendingScore(b) - trendingScore(a),
			newest: (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
			discussed: (a, b) => (b.comment_count || 0) - (a.comment_count || 0),
			supported: (a, b) =>
				(b.reactions?.support || 0) - (a.reactions?.support || 0),
		};
		rest.sort(sorter[sort] ?? sorter.newest);
		return [...pinned, ...rest];
	}, [posts, cat, feedType, query, sort, statusFilter]);

	const problemPosts = useMemo(
		() => posts.filter((p) => p.type === "problem"),
		[posts],
	);
	const hasLastKnownPosts = posts.length > 0;

	const stats = useMemo(() => {
		const now = Date.now();
		const DAY = 86400000;
		const cnt = (rows: PostData[], from: number, to: number) =>
			rows.filter((p) => {
				const t = +new Date(p.created_at);
				return t >= from && t < to;
			}).length;
		const spark: number[] = [];
		for (let i = 13; i >= 0; i--) {
			const d = new Date();
			d.setHours(0, 0, 0, 0);
			d.setDate(d.getDate() - i);
			spark.push(cnt(problemPosts, +d, +d + DAY));
		}
		return {
			total: problemPosts.length,
			solved: problemPosts.filter((p) => p.status === "solved").length,
			active: problemPosts.filter((p) => !["solved", "archived"].includes(p.status))
				.length,
			week: cnt(problemPosts, now - 7 * DAY, now),
			prevWeek: cnt(problemPosts, now - 14 * DAY, now - 7 * DAY),
			solvedWeek: problemPosts.filter((p) =>
				(p.status_history || []).some(
					(h) => h.status === "solved" && now - +new Date(h.at) < 7 * DAY,
				),
			).length,
			solvedPrevWeek: problemPosts.filter((p) =>
				(p.status_history || []).some((h) => {
					const t = +new Date(h.at);
					return (
						h.status === "solved" && now - t >= 7 * DAY && now - t < 14 * DAY
					);
				}),
			).length,
			spark,
		};
	}, [problemPosts]);


	const pullToRefresh = usePullToRefresh(refreshFeed, { threshold: 80 });

	return (
		<div
			className="min-h-dvh"
			onTouchStart={pullToRefresh.onTouchStart}
			onTouchMove={pullToRefresh.onTouchMove}
			onTouchEnd={pullToRefresh.onTouchEnd}
		>
			{/* Pull-to-refresh indicator */}
			{(pullToRefresh.pulling || pullToRefresh.refreshing) && (
				<div
					className="fixed inset-x-0 top-0 z-40 pointer-events-none flex items-center justify-center gap-2 text-accent text-sm font-medium overflow-hidden transition-all"
					style={{ height: pullToRefresh.pullDistance, opacity: pullToRefresh.pullDistance / 80 }}
					aria-live="polite"
				>
					<span className={`inline-block transition-transform ${pullToRefresh.refreshing ? "animate-spin" : ""}`}>
						↻
					</span>
					{pullToRefresh.refreshing ? "Refreshing…" : "Pull to refresh"}
				</div>
			)}

			{/* Freshness badge — realtime only raises this; the feed itself
			loads once per visit. One click pulls the latest snapshot. */}
			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => void handleFeedUpdate()}
				refreshing={feedRefreshing}
			/>

			{/* "New posts" pill — live content arrived while scrolled down */}
			{pendingNew > 0 && (
				<button
					onClick={showPending}
					className="fixed top-16 left-1/2 -translate-x-1/2 z-50 btn btn-primary !rounded-full !py-2 !px-4 shadow-xl vb-rise"
					aria-live="polite"
				>
					<ArrowUp size={14} /> {pendingNew} new post{pendingNew > 1 ? "s" : ""}
				</button>
			)}

			{/* Hero — animated gradient, premium feel */}
			<section
				className="card !border-transparent mb-6 relative overflow-hidden vb-rise hero-gradient group"
				style={{ color: "#ffffff" }}
			>
				<GridPattern
					cellWidth={48}
					cellHeight={48}
					gap={8}
					className="text-white"
				/>
				<div
					className="absolute -right-10 -top-10 w-52 h-52 rounded-full"
					style={{ background: "rgba(255,255,255,0.09)", filter: "blur(28px)" }}
					aria-hidden
				/>
				<BorderBeam duration={12} size={200} colorFrom="rgba(255,255,255,0.3)" colorTo="rgba(255,255,255,0)" />
				<img
					src="/hero-art.png"
					alt=""
					aria-hidden
					loading="lazy"
					decoding="async"
					fetchPriority="low"
					className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 w-60 lg:w-72 h-auto select-none pointer-events-none"
					style={{
						maskImage: "linear-gradient(to left, black 60%, transparent)",
						WebkitMaskImage: "linear-gradient(to left, black 60%, transparent)",
						mixBlendMode: "soft-light",
					}}
				/>
				<div className="relative p-6 sm:p-8 md:max-w-[62%]">
					<p
						className="text-xs font-bold uppercase tracking-[0.18em] mb-2 flex items-center gap-1.5"
						style={{ color: "rgba(255,255,255,0.72)" }}
					>
						<Megaphone size={13} /> Anonymous school feedback
					</p>
					<h1
						className="font-display font-bold text-2xl sm:text-3xl leading-tight max-w-lg"
						style={{ color: "#fff" }}
					>
						Speak up. Stay invisible. Get things fixed.
					</h1>
					<p
						className="text-sm mt-2 max-w-md"
						style={{ color: "rgba(255,255,255,0.82)" }}
					>
						No names, no emails, no tracking — just your voice. Report problems,
						share ideas, vote in polls.
					</p>
					<div className="flex flex-wrap gap-2 mt-4">
						<Link to="/submit" data-tour="submit">
							<ShimmerButton
								shimmerColor="rgba(255,255,255,0.6)"
								background="rgba(255,255,255,0.95)"
								className="!text-indigo-600 !font-semibold"
							>
								<PlusCircle size={15} /> Report a problem
							</ShimmerButton>
						</Link>
						<Link
							to="/board"
							className="btn"
							style={{ background: "rgba(255,255,255,0.16)", color: "#ffffff" }}
						>
							View solving board
						</Link>
						<GlowButton
							variant="gold"
							size="md"
							className="!mt-0"
							onClick={() =>
								window.scrollTo({
									top: document.body.scrollHeight,
									behavior: "smooth",
								})
							}
						>
							<Sparkles size={14} /> See what's new
						</GlowButton>
					</div>
				</div>
			</section>

			{/* How it works — 3 simple steps for first-time visitors */}
			<div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
				{[
					{
						n: "1",
						icon: FileText,
						title: "Report",
						sub: "No name needed",
						color: "var(--vb-accent)",
					},
					{
						n: "2",
						icon: Users,
						title: "Others support it",
						sub: "More support = faster fix",
						color: "var(--vb-warn)",
					},
					{
						n: "3",
						icon: Target,
						title: "School fixes it",
						sub: "Track live progress",
						color: "var(--vb-good)",
					},
				].map((s, i) => (
					<div
						key={s.n}
						className="card card-hover p-3 sm:p-4 text-center vb-rise"
						style={{ animationDelay: `${i * 80}ms` }}
					>
						<span
							className="inline-flex items-center justify-center w-9 h-9 rounded-xl mb-1.5"
							style={{ background: `${s.color}12`, color: s.color }}
						>
							<s.icon size={18} strokeWidth={2.2} />
						</span>
						<p className="font-display font-bold text-xs sm:text-sm">
							{s.n}. {s.title}
						</p>
						<p className="text-[10px] sm:text-[11px] text-ink3 mt-0.5">
							{s.sub}
						</p>
					</div>
				))}
			</div>

			{/* Stats with animated trends */}
			<div className="grid grid-cols-3 gap-3 mb-6">
				{[
					{
						label: "Reported",
						value: stats.total,
						icon: Megaphone,
						color: "text-accent",
						trend: { cur: stats.week, prev: stats.prevWeek },
						spark: stats.spark,
					},
					{
						label: "In progress",
						value: stats.active,
						icon: Activity,
						color: "text-warn",
					},
					{
						label: "Solved",
						value: stats.solved,
						icon: CheckCircle2,
						color: "text-good",
						trend: { cur: stats.solvedWeek, prev: stats.solvedPrevWeek },
					},
				].map(({ label, value, icon: Icon, color, trend, spark }, i) => (
					<div
						key={label}
						className="card card-hover p-3.5 sm:p-4 vb-rise"
						style={{ animationDelay: `${i * 60}ms` }}
					>
						<div className="flex items-center justify-between">
							<Icon size={16} className={color} />
							{trend && hasLoaded && (
								<Trend
									current={trend.cur}
									previous={trend.prev}
									label="this week vs last week"
								/>
							)}
						</div>
						<p className="font-display font-bold text-xl sm:text-2xl mt-1">
							{hasLoaded ? <CountUp value={value} /> : "–"}
						</p>
						<div className="flex items-end justify-between gap-1">
							<p className="text-[11px] sm:text-xs text-ink3">{label}</p>
							{spark && hasLoaded && (
								<span className="hidden sm:block">
									<Sparkline data={spark} width={56} height={18} />
								</span>
							)}
						</div>
					</div>
				))}
			</div>

			<RecapCard posts={problemPosts} />

			{/* Theme word cloud — what the school is talking about */}
			{hasLoaded && posts.length >= 3 && (
				<div className="card p-4 mb-4 vb-rise">
					<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 text-center mb-1 flex items-center justify-center gap-1.5">
						<MessageSquare size={11} /> What the school is talking about · tap a
						word to filter
					</p>
					<WordCloud posts={posts} onWordClick={(w) => setQuery(w)} />
				</div>
			)}

			{/* Search + filters — single clean toolbar */}
			<div className="card p-3 mb-4 space-y-3">
				<div className="flex flex-col gap-2 sm:flex-row">
					<div className="relative flex-1 min-w-0" data-tour="search">
						<Search
							size={15}
							className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3"
							aria-hidden
						/>
						<input
							id="feed-search"
							className="input !pl-9 !py-2"
							placeholder={feedType === "problem" ? "Search problems…" : "Search all posts…"}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							aria-label={feedType === "problem" ? "Search problems" : "Search all posts"}
						/>
					</div>
					<select
						id="feed-type-filter"
						name="content-type"
						className="input !w-auto !py-2 text-sm max-w-32"
						value={feedType}
						onChange={(e) => setFeedType(e.target.value as FeedType)}
						aria-label="Filter by content type"
					>
						<option value="all">All content</option>
						<option value="problem">Problems</option>
						<option value="suggestion">Suggestions</option>
						<option value="poll">Polls</option>
					</select>
					<select
						id="feed-category-filter"
						name="category"
						className="input !w-auto !py-2 text-sm max-w-36"
						value={cat}
						onChange={(e) => setCat(e.target.value)}
						aria-label="Filter by category"
					>
						<option value="All">All categories</option>
						{categories.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</select>
					<button
						className={`btn !py-2 sm:hidden ${showFilters ? "btn-soft" : "btn-ghost"}`}
						onClick={() => setShowFilters((s) => !s)}
						aria-label="Toggle filters"
						aria-expanded={showFilters}
					>
						<SlidersHorizontal size={15} />
					</button>
				</div>
				<div
					className={`${showFilters ? "flex" : "hidden sm:flex"} flex-wrap items-center gap-2`}
				>
					<div
						className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5 overflow-x-auto"
						role="tablist"
						aria-label="Sort feed"
					>
						{SORTS.map(({ key, label, icon: Icon }) => (
							<button
								key={key}
								role="tab"
								aria-selected={sort === key}
								onClick={() => setSort(key)}
								className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${sort === key ? "bg-surface shadow-sm text-accent" : "text-ink3 hover:text-ink2"}`}
							>
								<Icon size={12} /> {label}
							</button>
						))}
					</div>
					<div
						className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5 ml-auto"
						role="tablist"
						aria-label="Filter by status"
					>
						{(["all", "solved"] as const).map((s) => (
							<button
								key={s}
								role="tab"
								aria-selected={statusFilter === s}
								onClick={() => setStatusFilter(s)}
								className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${statusFilter === s ? "bg-surface shadow-sm text-accent" : "text-ink3 hover:text-ink2"}`}
							>
								{s}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* Feed */}
			<h2 className="sr-only">Recent posts</h2>
			{error && (
				<div
					className={hasLastKnownPosts ? "card p-3 px-4" : "card p-6 text-center"}
					role={hasLastKnownPosts ? "status" : "alert"}
				>
					<p className={hasLastKnownPosts ? "text-sm text-ink2" : "text-bad font-medium text-sm"}>
						{hasLastKnownPosts
							? "Refresh failed — showing the last available posts."
							: error}
					</p>
					{!hasLastKnownPosts && isNativeShell() && (
						<p className="text-xs text-ink3 mt-1">
							App is trying: {apiBase() || "(no API address set — rebuild with VITE_API_BASE)"}
						</p>
					)}
					<button
						className={`btn btn-soft ${hasLastKnownPosts ? "mt-2" : "mt-3"}`}
						onClick={() => {
							if (!hasLastKnownPosts) setHasLoaded(false);
							void load({
								fresh: true,
								search: query,
								feedType,
								category: cat,
								status: statusFilter,
							});
						}}
					>
						Try again
					</button>
				</div>
			)}
			{hasLoaded && !error && filtered.length === 0 && (
				<div className="card p-10 text-center vb-rise">
					<div className="vb-empty-icon">
						<Megaphone size={28} />
					</div>
					<p className="font-display font-semibold">No posts found</p>
					<p className="text-sm text-ink3 mt-1">
						Be the first to share something anonymously.
					</p>
					<Link to="/submit" className="btn btn-primary mt-4 inline-flex">
						<PlusCircle size={15} /> Share an update
					</Link>
				</div>
			)}					<div className="space-y-3 vb-feed-list">
						{filtered.map((p, i) => (
							<div key={p.id} {...(i === 0 ? { "data-tour": "post-card" } : {})}>
											<PostCard
										post={p}
										myReactions={myReactions[p.id]}
										pollData={p.linked_poll ? pollsMap[p.linked_poll] ?? null : null}
										myPollVote={p.linked_poll ? myPollVotes[p.linked_poll] : undefined}
										onPollVoted={() => fetchPolls(posts)}
									/>
							</div>
						))}
					</div>
		</div>
	);
}
