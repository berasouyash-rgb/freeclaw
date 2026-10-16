import {
	ArrowBigUp,
	Bookmark,
	CheckCircle2,
	Lightbulb,
	MessageCircle,
	PlusCircle,
	RefreshCw,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";import { Link } from "react-router";
import UpdateNotice from "../components/admin/UpdateNotice";
import { useApp } from "../contexts/AppContext";
import { useUpdateSignal } from "../hooks/useUpdateSignal";
import { Segmented } from "../components/ui";
import { api } from "../lib/api";
import { applyServerMine } from "../lib/feedReactionMerge";
import { postWithdrawal } from "../lib/postWithdrawal";
import { useRealtime, type RealtimePayload } from "../lib/useRealtime";
import { STATUS_META, timeAgo, trendingScore } from "../lib/utils";
import type { PostData, ReactionEntry, ReactionResponse } from "../types";

export default function Suggestions() {
	const { anonId, bookmarks, toggleBookmark, toast } = useApp();
	const [items, setItems] = useState<PostData[]>([]);
	const [mine, setMine] = useState<Record<string, string[]>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [sort, setSort] = useState<"top" | "trending" | "new">("new");
	const [statusF, setStatusF] = useState<"all" | "accepted">("all");	const [busy, setBusy] = useState<string | null>(null);
	const knownIdsRef = useRef(new Set<string>());

	const load = useCallback(async (silent = false) => {
		try {
			setError("");
			const fetchFn = silent ? api.getSlowFresh : api.getSlow;
			// In silent (realtime) mode both reads bypass the 5s GET cache: the
			// database has already changed, and a cached reactions response
			// re-serves the counts from before the change.
			const [data, reactions] = await Promise.all([
				fetchFn<PostData[]>("/api/posts?type=suggestion"),
				silent
					? api.getFresh<ReactionEntry[]>(`/api/reactions?author=${anonId}`)
					: api.get<ReactionEntry[]>(`/api/reactions?author=${anonId}`),
		]);
			// Null-safe: a 200 with no rows must render empty, never throw
			// inside the try (which would surface as a cryptic TypeError).
			const rows = data || [];
			setItems(rows);
			const map: Record<string, string[]> = {};
			(reactions || []).forEach((r) => {
				map[r.target_id] = [...(map[r.target_id] || []), r.kind];
		});
			setMine(map);
			knownIdsRef.current = new Set(rows.map((s) => s.id));
		} catch (e: unknown) {
			if (!silent)
				setError(e instanceof Error ? e.message : "Failed to load suggestions");
		}
		setLoading(false);
	}, [anonId]);

	useEffect(() => {
		load();
	}, [load]);

	// Freshness signal + single-row merge: the old wiring reloaded the whole
	// suggestion list on every posts event (and re-pulled the reaction map
	// on every reaction event), so steady activity rebuilt the page under
	// the reader's finger. New ideas and upvote touches now merge one row
	// at a time (see below); Refresh or the update notice still pulls one
	// fresh snapshot. Own votes stay instant via the optimistic flip in
	// vote().
	//
	// The one exception is withdrawal: a suggestion the server no longer
	// serves (hidden by moderation, soft-deleted, hard-deleted) leaves the
	// list right now. `api/_posts.js:456-460` filters those rows out of this
	// list for every viewer, so the badge path would keep moderation-hidden
	// content on screen until someone chose to refresh. The `reactions`
	// lane is untouched — the predicate ignores other tables.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();
	const [refreshing, setRefreshing] = useState(false);

	// ── Single-row live merge (contract evolution 2026-10-05) ──
	// New ideas and upvote touches arrive as posts INSERT/UPDATE (every
	// toggle touches the parent row). One small GET per changed id merges
	// into the list — no whole-list reload under the reader's finger.
	// Withdrawal keeps its immediate drop below; unresolvable events keep
	// the badge.
	const pendingRowIds = useRef<Set<string>>(new Set());
	const rowFlushTimer = useRef<number | null>(null);

	const flushSuggestionRows = useCallback(async () => {
		rowFlushTimer.current = null;
		const ids = [...pendingRowIds.current].slice(0, 20);
		pendingRowIds.current.clear();
		if (ids.length === 0) return;
		const settled = await Promise.all(
			ids.map(async (rowId) => {
				try {
					const res = await api.getFresh<{
						post: PostData;
						mine?: string[];
					}>(`/api/posts?id=${rowId}&viewer=${anonId}`);
					return { row: res.post ?? null, mine: res.mine, id: rowId };
				} catch {
					return { row: null, mine: undefined, id: rowId };
				}
			}),
		);
		const rows = settled
			.map((s) => s.row)
			.filter((r): r is PostData => !!r);
		if (rows.length === 0) {
			markUpdatesAvailable();
			return;
		}
		// Live mine sync (same rule as the Home feed): the by-id lane carries
		// the viewer's authoritative kinds per row, so another device on this
		// identity toggling converges here without a full refresh.
		setMine((prev) => {
			let next = prev;
			for (const s of settled) {
				if (s.row && s.mine !== undefined)
					next = applyServerMine(next, s.id, s.mine);
			}
			return next;
		});
		// Suggestions-only list: new rows of another type never join, and
		// a known card that changed away drops off.
		setItems((prev) => {
			const next: PostData[] = [];
			for (const s of prev) {
				const f = rows.find((r) => r.id === s.id);
				if (f) {
					if (f.type === "suggestion") next.push(f);
				} else next.push(s);
			}
			for (const r of rows) {
				if (r.type === "suggestion" && !prev.some((q) => q.id === r.id))
					next.push(r);
			}
			return next;
		});
	}, [markUpdatesAvailable, anonId]);

	const scheduleSuggestionFlush = useCallback(() => {
		if (rowFlushTimer.current !== null) return;
		rowFlushTimer.current = window.setTimeout(() => {
			void flushSuggestionRows();
		}, 400);
	}, [flushSuggestionRows]);

	useEffect(
		() => () => {
			if (rowFlushTimer.current !== null) {
				window.clearTimeout(rowFlushTimer.current);
				rowFlushTimer.current = null;
			}
		},
		[],
	);

	const handlePostWithdrawal = useCallback(
		(table: string, payload: RealtimePayload) => {
			const withdrawn = postWithdrawal(table, payload);
			if (withdrawn) {
				setItems((prev) => prev.filter((s) => s.id !== withdrawn.id));
				return;
			}
			if (table === "posts") {
				const evt = payload.eventType;
				const next = payload.new as { id?: string } | undefined;
				const prev = payload.old as { id?: string } | undefined;
				const rowId = (evt === "DELETE" ? prev?.id : next?.id) ?? prev?.id;
				if ((evt === "INSERT" || evt === "UPDATE") && rowId) {
					pendingRowIds.current.add(rowId);
					scheduleSuggestionFlush();
					return;
				}
			}
			markUpdatesAvailable();
		},
		[markUpdatesAvailable, scheduleSuggestionFlush],
	);

	const handleRefresh = useCallback(async () => {
		setRefreshing(true);
		try {
			await load(true);
			clearUpdates();
		} finally {
			setRefreshing(false);
		}
	}, [load, clearUpdates]);

	useRealtime(["posts", "reactions"], handlePostWithdrawal, 1_000);

	const vote = async (id: string) => {
		if (busy) return;
		setBusy(id);
		// Optimistic flip — instant; reconciled with the authoritative server response.
		const prevCounts = items.find((s) => s.id === id)?.reactions;
		const prevMine = mine[id] ?? [];
		const wasActive = prevMine.includes("upvote");
		setItems((prev) =>
			prev.map((s) =>
				s.id === id
					? {
							...s,
							reactions: {
								...s.reactions,
								upvote: Math.max(
									0,
									(s.reactions?.upvote || 0) + (wasActive ? -1 : 1),
								),
							},
						}
					: s,
			),
		);
		setMine((m) => ({ ...m, [id]: wasActive ? [] : ["upvote"] }));
		try {
			const res = await api.post<ReactionResponse>("/api/reactions", {
				author_id: anonId,
				target_id: id,
				target_type: "suggestion",
				kind: "upvote",
			});
			setItems((prev) =>
				prev.map((s) => (s.id === id ? { ...s, reactions: res.counts } : s)),
			);
			setMine((m) => ({
				...m,
				[id]: res.mine ?? (res.toggled ? ["upvote"] : []),
			}));
		} catch (e: unknown) {
			setItems((prev) =>
				prev.map((s) =>
					s.id === id ? { ...s, reactions: prevCounts ?? s.reactions } : s,
				),
			);
			setMine((m) => ({ ...m, [id]: prevMine }));
			toast(e instanceof Error ? e.message : "Vote failed", "err");
		}
		setBusy(null);
	};

	const net = (s: PostData) => s.reactions?.upvote || 0;

	const sorted = useMemo(() => {
		let list = [...items];
		if (statusF === "accepted")
			list = list.filter((s) =>
				["in_progress", "waiting", "solved"].includes(s.status),
			);
		if (sort === "top") list.sort((a, b) => net(b) - net(a));
		else if (sort === "trending")
			list.sort((a, b) => trendingScore(b) - trendingScore(a));
		else list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
		return list;
	}, [items, sort, statusF]);

	return (
		<div className="max-w-3xl mx-auto">
			<div className="flex items-center justify-between mb-1">
				<h1 className="font-display font-bold text-2xl flex items-center gap-2">
					<Lightbulb className="text-warn" size={24} /> Suggestion Board
				</h1>
				<Link to="/submit?type=suggestion" className="btn btn-primary !py-2">
					<PlusCircle size={15} /> New idea
				</Link>
			</div>
			<p className="text-sm text-ink3 mb-5">
				Improvement ideas ranked by the community. Top suggestions get official
				replies.
			</p>
			<div className="mb-4">
				<button
					className="btn btn-soft !py-1.5 !px-3 text-xs flex items-center gap-1.5"
					onClick={() => void handleRefresh()}
					disabled={refreshing}
					aria-label="Refresh suggestions"
				>
					<RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
					{refreshing ? "Refreshing…" : "Refresh"}
				</button>
				<UpdateNotice
					count={updatesAvailable}
					onViewUpdates={() => void handleRefresh()}
					refreshing={refreshing}
				/>
			</div>

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<Segmented<"top" | "trending" | "new">
					value={sort}
					onChange={setSort}
					options={[
						{ value: "top", label: "🏆 Top ranked" },
						{ value: "trending", label: "Trending" },
						{ value: "new", label: "Newest" },
					]}
				/>
				<div className="ml-auto">
					<Segmented<"all" | "accepted">
						value={statusF}
						onChange={setStatusF}
						options={[
							{ value: "all", label: "All" },
							{ value: "accepted", label: "✓ Accepted" },
						]}
					/>
				</div>
			</div>

			{error && (
				<div className="card p-6 text-center">
					<p className="text-bad text-sm">{error}</p>
					<button
						className="btn btn-soft mt-3"
						// Silent retry: keep the error card honest without
						// blanking to skeletons first.
						onClick={() => {
							load(true);
						}}
					>
						Retry
					</button>
				</div>
			)}
			{loading && (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-28" />
					))}
				</div>
			)}
			{!loading && !error && sorted.length === 0 && (
				<div className="card p-10 text-center">
					<p className="text-3xl mb-2">💡</p>
					<p className="font-display font-semibold">No suggestions yet</p>
					<Link
						to="/submit?type=suggestion"
						className="btn btn-primary mt-4 inline-flex"
					>
						Share the first idea
					</Link>
				</div>
			)}

			<div className="space-y-3">
				{sorted.map((s, rank) => (
					<article
						key={s.id}
						className="card card-hover p-4 flex gap-3.5 vb-rise"
					>
						<button
							onClick={() => vote(s.id)}
							disabled={busy === s.id}
							aria-label={`Support this idea (${net(s)})`}
							aria-pressed={(mine[s.id] || []).includes("upvote")}
							className={`self-start flex flex-col items-center justify-center shrink-0 rounded-xl border px-3 py-2 transition-all active:scale-90 ${
								(mine[s.id] || []).includes("upvote")
									? "border-accent bg-accent-soft text-accent vb-pop"
									: "border-border text-ink3 hover:border-accent hover:text-accent hover:-translate-y-0.5"
							}`}
						>
							<ArrowBigUp
								size={22}
								fill={
									(mine[s.id] || []).includes("upvote")
										? "currentColor"
										: "none"
								}
							/>
							<span
								key={net(s)}
								className="text-sm font-bold leading-none vb-pop"
							>
								{net(s)}
							</span>
						</button>
						{sort === "top" && rank < 3 && (
							<span
								className="text-base self-center -ml-1.5"
								aria-label={`Rank ${rank + 1}`}
							>
								{["🥇", "🥈", "🥉"][rank]}
							</span>
						)}
						<div className="min-w-0 flex-1">
							<Link to={`/post/${s.id}`} className="group">
								<h3 className="font-display font-semibold text-[15px] leading-snug group-hover:text-accent transition-colors">
									{s.title}
								</h3>
								<p className="text-sm text-ink2 mt-1 line-clamp-2">
									{s.description}
								</p>
							</Link>
							{s.ai_summary && (
								<p className="text-xs text-accent mt-2 flex items-center gap-1">
									<Sparkles size={11} /> {s.ai_summary}
								</p>
							)}
							{s.admin_reply && (
								<div className="mt-2 rounded-lg bg-good/8 border border-good/25 px-3 py-2">
									<p className="text-[10px] font-bold text-good flex items-center gap-1">
										<ShieldCheck size={10} /> ADMIN REPLY
									</p>
									<p className="text-xs mt-0.5">{s.admin_reply}</p>
								</div>
							)}
							{/* min-w-0 lets the row shrink on a 320px phone: category + status
							    chips plus a timestamp used to push the card 10px past the
							    viewport instead of wrapping. */}
							<div className="flex items-center gap-3 mt-2 text-xs text-ink3 min-w-0 flex-wrap">
								<span className="chip !text-[10px]">{s.category}</span>
								{/* Status — clearly visible, incl. Solved */}
								<span
									className="chip !text-[10px] font-bold"
									style={{
										color: STATUS_META[s.status]?.color,
										// color-mix, not `${color}44`: the palette values are CSS variables now
										borderColor: `color-mix(in srgb, ${STATUS_META[s.status]?.color} 27%, transparent)`,
									}}
								>
									{s.status === "solved" && <CheckCircle2 size={10} />}{" "}
									{s.status === "solved"
										? "Implemented"
										: STATUS_META[s.status]?.label || s.status}
								</span>
								<Link
									to={`/post/${s.id}`}
									className="flex items-center gap-1 hover:text-accent"
								>
									<MessageCircle size={12} /> {s.comment_count || 0}
								</Link>
								<button
									onClick={() => toggleBookmark(s.id)}
									className={
										bookmarks.includes(s.id) ? "text-accent" : "hover:text-ink2"
									}
									aria-label="Bookmark"
								>
									<Bookmark
										size={12}
										fill={bookmarks.includes(s.id) ? "currentColor" : "none"}
									/>
								</button>
								<span className="ml-auto whitespace-nowrap">{timeAgo(s.created_at)}</span>
							</div>
						</div>
					</article>
				))}
			</div>
		</div>
	);
}
