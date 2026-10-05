import { KanbanSquare, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import PurgeCountdown from "../components/PurgeCountdown";
import UpdateNotice from "../components/admin/UpdateNotice";
import { useUpdateSignal } from "../hooks/useUpdateSignal";
import { api } from "../lib/api";
import { postWithdrawal } from "../lib/postWithdrawal";
import { useRealtime, type RealtimePayload } from "../lib/useRealtime";
import { CAT_EMOJI, STATUS_META, timeAgo } from "../lib/utils";
import type { PostData } from "../types";

const COLUMNS = [
	"reported",
	"verified",
	"in_progress",
	"waiting",
	"solved",
	"archived",
];

// Board display names that differ from the global STATUS_META labels:
// "waiting" is the school's working state, shown everywhere else as
// "Working on" (admin status circles, feed counter). The global meta keeps
// the "Waiting" label for timelines and exports; the board translates.
const BOARD_LABELS: Record<string, string> = {
	waiting: "Working on",
};

function supportCount(p: PostData): number {
	const r = p.reactions || {};
	return (r.support || 0) + (r.upvote || 0);
}

/**
 * Unanswered spotlight: reported posts nobody has picked up yet, most
 * supported first. Real rows only — an empty list renders nothing.
 */
export function topUnanswered(posts: PostData[], limit = 3): PostData[] {
	return posts
		.filter((p) => p.status === "reported")
		.sort((a, b) => supportCount(b) - supportCount(a))
		.slice(0, Math.max(0, limit));
}

export default function SolvingBoard() {
	const [posts, setPosts] = useState<PostData[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	// Safety net: statuses the board has no column for (e.g. future
	// workflow states) must never vanish silently — they get their own
	// column below.
	const orphans = posts.filter((p) => !COLUMNS.includes(p.status));

	const load = useCallback(async (silent = false) => {
		try {
			setError("");
			if (!silent) setLoading(true);
			setPosts((await api.getSlow("/api/posts?type=problem")) || []);
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Failed to load data");
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	// Freshness signal + single-row merge: the old wiring reloaded the WHOLE
	// board (skeletons and all) on every posts event, so under any steady
	// write activity the columns visibly rebuilt every ~1s and no work was
	// possible. New reports and status changes now merge one row at a time
	// (see below) — cards move between columns on their own. Anything the
	// merge cannot resolve still raises the badge for an explicit pull.
	//
	// The single exception is withdrawal: a card the server no longer serves
	// (hidden by moderation, soft-deleted, hard-deleted) leaves the columns
	// immediately, because `api/_posts.js:456-460` filters those rows out of
	// the feed for every viewer and the badge path would leave moderation-
	// hidden content sitting on the board until someone chose to refresh.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();

	// ── Single-row live merge (contract evolution 2026-10-05) ──
	// New reports and status changes arrive as posts INSERT/UPDATE. One
	// small GET per changed id slots the card into its column (or moves
	// it) without rebuilding the board — the old whole-board reload made
	// steady activity unusable. Withdrawal keeps its immediate drop
	// below; unresolvable events keep the badge.
	const pendingRowIds = useRef<Set<string>>(new Set());
	const rowFlushTimer = useRef<number | null>(null);

	const flushBoardRows = useCallback(async () => {
		rowFlushTimer.current = null;
		const ids = [...pendingRowIds.current].slice(0, 20);
		pendingRowIds.current.clear();
		if (ids.length === 0) return;
		const settled = await Promise.all(
			ids.map(async (rowId) => {
				try {
					const res = await api.getFresh<{ post: PostData }>(
						`/api/posts?id=${rowId}`,
					);
					return res.post ?? null;
				} catch {
					return null;
				}
			}),
		);
		const rows = settled.filter((r): r is PostData => !!r);
		if (rows.length === 0) {
			markUpdatesAvailable();
			return;
		}
		// The board is problems-only: new rows of another type never join,
		// and a known card that changed away drops off.
		setPosts((prev) => {
			const next: PostData[] = [];
			for (const p of prev) {
				const f = rows.find((r) => r.id === p.id);
				if (f) {
					if (f.type === "problem") next.push(f);
				} else next.push(p);
			}
			for (const r of rows) {
				if (r.type === "problem" && !prev.some((q) => q.id === r.id))
					next.push(r);
			}
			return next;
		});
	}, [markUpdatesAvailable]);

	const scheduleBoardFlush = useCallback(() => {
		if (rowFlushTimer.current !== null) return;
		rowFlushTimer.current = window.setTimeout(() => {
			void flushBoardRows();
		}, 400);
	}, [flushBoardRows]);

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
				setPosts((prev) => prev.filter((post) => post.id !== withdrawn.id));
				return;
			}
			if (table === "posts") {
				const evt = payload.eventType;
				const next = payload.new as { id?: string } | undefined;
				const prev = payload.old as { id?: string } | undefined;
				const rowId = (evt === "DELETE" ? prev?.id : next?.id) ?? prev?.id;
				if ((evt === "INSERT" || evt === "UPDATE") && rowId) {
					pendingRowIds.current.add(rowId);
					scheduleBoardFlush();
					return;
				}
			}
			markUpdatesAvailable();
		},
		[markUpdatesAvailable, scheduleBoardFlush],
	);
	const [refreshing, setRefreshing] = useState(false);

	const handleRefresh = useCallback(async () => {
		setRefreshing(true);
		try {
			await load(true);
			clearUpdates();
		} finally {
			setRefreshing(false);
		}
	}, [load, clearUpdates]);

	useRealtime(["posts"], handlePostWithdrawal, 1_000);

	return (
		<div>
			<div className="flex items-center justify-between gap-3 flex-wrap">
				<h1 className="font-display font-bold text-2xl flex items-center gap-2 mb-1">
					<KanbanSquare className="text-accent" size={24} /> Public Solving Board
				</h1>
				<button
					className="btn btn-soft !py-1.5 !px-3 text-xs flex items-center gap-1.5"
					onClick={() => void handleRefresh()}
					disabled={refreshing}
					aria-label="Refresh solving board"
				>
					<RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
					{refreshing ? "Refreshing…" : "Refresh"}
				</button>
			</div>
			<p className="text-sm text-ink3 mb-6">
				Full transparency — track every reported issue from submission to
				resolution.
			</p>
			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => void handleRefresh()}
				refreshing={refreshing}
			/>

			{!loading && !error && topUnanswered(posts).length > 0 && (
				<section aria-label="Unanswered issues needing attention" className="card p-4 mb-4 vb-rise">
					<p className="text-[10px] font-bold uppercase tracking-wider text-warn mb-2">
						Unanswered — needs attention
					</p>
					<div className="space-y-2">
						{topUnanswered(posts).map((q) => (
							<Link
								key={q.id}
								to={`/post/${q.id}`}
								className="flex items-center gap-2 text-sm hover:text-accent transition-colors"
							>
								<span className="font-semibold truncate flex-1">{q.title}</span>
								<span className="text-[11px] text-ink3 shrink-0">
									{supportCount(q)} support · {timeAgo(q.updated_at || q.created_at)}
								</span>
							</Link>
						))}
					</div>
				</section>
			)}

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
				<div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
					{[1, 2, 3, 4, 5, 6].map((i) => (
						<div key={i} className="skeleton h-48" />
					))}
				</div>
			)}

			{!loading && !error && (
				<div className="flex gap-3 overflow-x-auto pb-4 snap-x">
					{orphans.length > 0 && (
						<div key="__needs-triage" className="w-72 shrink-0 snap-start">
						<div className="flex items-center gap-2 mb-2 px-1">
							<span className="w-2.5 h-2.5 rounded-full" style={{ background: "#d98a0b" }} aria-hidden />
							<h2 className="font-display font-semibold text-sm">Needs triage</h2>
							<span className="chip !text-[10px] ml-auto">{orphans.length}</span>
						</div>
						<div className="space-y-2 min-h-24 rounded-2xl bg-surface2/50 p-2">
							{orphans.map((p) => (
								<Link key={p.id} to={`/post/${p.id}`} className="card card-hover block p-3">
									<p className="text-[13px] font-semibold leading-snug line-clamp-2">{p.title}</p>
									<p className="text-[10px] text-ink3 mt-1">status: {p.status || "unknown"}</p>
								</Link>
							))}
						</div>
						</div>
					)}
					{COLUMNS.map((col) => {
						const meta = STATUS_META[col] ?? {
							label: col,
							color: "#888",
							pct: 0,
						};
						const items = posts.filter((p) => p.status === col);
						return (
							<div key={col} className="w-72 shrink-0 snap-start">
								<div className="flex items-center gap-2 mb-2 px-1">
									<span
										className="w-2.5 h-2.5 rounded-full"
										style={{ background: meta.color }}
										aria-hidden
									/>
									<h2 className="font-display font-semibold text-sm">
										{BOARD_LABELS[col] ?? meta.label}
									</h2>
									<span className="chip !text-[10px] ml-auto">
										{items.length}
									</span>
								</div>
								<div className="space-y-2 min-h-24 rounded-2xl bg-surface2/50 p-2">
									{items.length === 0 && (
										<p className="text-xs text-ink3 text-center py-6">Empty</p>
									)}
									{items.map((p, idx) => (
										<Link
											key={p.id}
											to={`/post/${p.id}`}
											className="card card-hover block p-3 vb-slide-in"
											style={{ animationDelay: `${idx * 70}ms` }}
										>
											<div className="flex items-center gap-1.5 text-[11px] text-ink3 mb-1">
												<span>{CAT_EMOJI[p.category]}</span>
												<span>{p.category}</span>
												<span className="ml-auto">
													{timeAgo(p.updated_at || p.created_at)}
												</span>
											</div>
											<p className="text-[13px] font-semibold leading-snug line-clamp-2">
												{p.title}
											</p>
											<div className="h-1.5 rounded-full bg-surface2 mt-2.5 overflow-hidden">
												<div
													className="h-full rounded-full"
													style={{
														width: `${p.progress || 0}%`,
														background: meta.color,
													}}
												/>
											</div>
											<div className="flex justify-between items-center mt-1.5">
												<span className="text-[10px] text-ink3 font-mono">
													{p.progress || 0}%
												</span>
												{p.eta && (
													<span className="text-[10px] text-ink3">
														⏳ {p.eta}
													</span>
												)}
												{p.purge_at && <PurgeCountdown purgeAt={p.purge_at} />}
											</div>
											{p.status_history &&
												p.status_history.length > 1 &&
												(() => {
													const last =
														p.status_history![p.status_history!.length - 1];
													return (
														last && (
															<p className="text-[10px] text-ink3 mt-1">
																Last:{" "}
																{last.note || STATUS_META[last.status]?.label}
															</p>
														)
													);
												})()}
										</Link>
									))}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
