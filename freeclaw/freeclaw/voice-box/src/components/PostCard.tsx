import {
	ArrowUp,
	BarChart3,
	Bookmark,
	CheckCircle2,
	Flag,
	Flame,
	Gavel,
	Lock,
	MessageCircle,
	Pin,
	Sparkles,
	ThumbsUp,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
import { Link } from "react-router";
import { useApp } from "../contexts/AppContext";
import { api, hasAdminSession } from "../lib/api";
import { prefetchRouteChunk } from "../lib/routeChunks";
import PostCardAdminBar from "./PostCardAdminBar";
import {
	CAT_EMOJI,
	PRIORITY_META,
	STATUS_META,
	timeAgo,
	trendingScore,
} from "../lib/utils";
import type { PollData, PostData, ReactionMeta } from "../types";
import PollCard from "./PollCard";
import { ReportDialog } from "./ui";

// Support-only voting: problems get thumbs-up Support, suggestions get
// arrow Upvote. There is deliberately no negative feedback UI — no Against,
// no Downvote. Historical disagree/downvote rows still count server-side
// (ranking stability), but no button offers them anymore.
const PROBLEM_REACTIONS: ReactionMeta[] = [
	{
		kind: "support",
		label: "Support",
		icon: ThumbsUp,
		color: "var(--vb-accent)",
	},
];
const SUGGESTION_REACTIONS: ReactionMeta[] = [
	{
		kind: "upvote",
		label: "Upvote",
		icon: ArrowUp,
		color: "var(--vb-accent)",
	},
];
export const REACTION_META: ReactionMeta[] = PROBLEM_REACTIONS;
export function getReactionMeta(type?: string): ReactionMeta[] {
	return type === "suggestion" ? SUGGESTION_REACTIONS : PROBLEM_REACTIONS;
}

/** Support-style vote button with a YouTube-like burst on activation: an
 *  expanding ring plus eight radiating particles (transform/opacity only,
 *  GPU-cheap), then the element unmounts itself. Fires on activating taps
 *  only — toggling off just unfills. Under prefers-reduced-motion the burst
 *  stays invisible (base opacity 0 + animation killed globally) while the
 *  count pop (existing vb-pop) still confirms the tap. */
export function ReactionButton({
	kind,
	label,
	icon: Icon,
	color,
	active,
	count,
	disabled,
	onReact,
	inactiveClassName,
}: {
	kind: string;
	label: string;
	icon: ComponentType<{
		size?: number | string;
		fill?: string;
		className?: string;
	}>;
	color: string;
	active: boolean;
	count: number;
	disabled: boolean;
	onReact: (kind: string) => void;
	inactiveClassName: string;
}) {
	const [burst, setBurst] = useState(0);
	const timer = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);
	const click = () => {
		if (!active) {
			setBurst((b) => b + 1);
			if (timer.current !== null) window.clearTimeout(timer.current);
			timer.current = window.setTimeout(() => setBurst(0), 650);
		}
		onReact(kind);
	};
	return (
		<button
			onClick={click}
			disabled={disabled}
			aria-label={`${label} (${count})`}
			aria-pressed={active}
			title={label}
			className={`relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
				active ? "vb-pop ring-1" : inactiveClassName
			}`}
			style={
				active
					? {
							color,
							background: "var(--vb-surface2)",
							boxShadow: `0 0 0 1px color-mix(in srgb, ${color} 20%, transparent)`,
						}
					: undefined
			}
		>
			{burst > 0 && (
				<span
					key={burst}
					className="vb-burst"
					aria-hidden
					data-testid="support-burst"
				>
					<span className="vb-burst-ring" />
					{Array.from({ length: 8 }, (_, i) => {
						const a = (i * Math.PI) / 4;
						return (
							<span
								key={i}
								className="vb-burst-particle"
								style={
									{
										"--tx": `${Math.round(Math.cos(a) * 26)}px`,
										"--ty": `${Math.round(Math.sin(a) * 26)}px`,
										animationDelay: `${i * 18}ms`,
									} as CSSProperties
								}
							/>
						);
					})}
				</span>
			)}
			<Icon
				size={13}
				fill={active ? "currentColor" : "none"}
				className={`transition-transform duration-200 ${active ? "scale-110" : ""}`}
			/>
			<span className="hidden sm:inline">{label}</span>
			<span
				key={count}
				className="vb-pop inline-block min-w-[14px] text-center"
			>
				{count}
			</span>
		</button>
	);
}

interface PostCardProps {
	post: PostData;
	myReactions?: string[];
	onReacted?: (
		id: string,
		counts: Record<string, number>,
		kind: string,
		toggled: boolean,
	) => void;
	pollData?: PollData | null;
	myPollVote?: number[];
	onPollVoted?: () => void;
}

function PostCardInner({ post, myReactions, onReacted, pollData, myPollVote, onPollVoted }: PostCardProps) {
	const { anonId, bookmarks, toggleBookmark, toast } = useApp();
	const [busy, setBusy] = useState<string | null>(null);
	const [reportOpen, setReportOpen] = useState(false);
	// confirmAction, replyOpen, and replyText are handled by PostCardAdminBar
	const [localCounts, setLocalCounts] = useState<Record<string, number> | null>(
		null,
	);
	const [localMine, setLocalMine] = useState<string[] | null>(null);
	const postedRef = useRef(false);
	const counts = useMemo(
		() => localCounts || post.reactions || {},
		[localCounts, post.reactions],
	);
	const mine = useMemo(
		() => localMine || myReactions || [],
		[localMine, myReactions],
	);
	// Single source for the badge count: the live poll fetch wins over the
	// feed snapshot (`post.linked_poll_votes`), which only refreshes when the
	// whole feed refetches — otherwise the badge lags the PollCard below it.
	const badgeVotes = useMemo(() => {
		if (pollData && typeof pollData.total_votes === "number")
			return pollData.total_votes;
		return post.linked_poll_votes ?? 0;
	}, [pollData, post.linked_poll_votes]);

	// Reset stale optimistic state when server data arrives (prevents double-reaction bug).
	// Skip the reset immediately after a successful POST — onReacted() updates the parent,
	// which re-renders with new myReactions, but our local state is already reconciled
	// from the server response. Clearing it here would revert the reaction visually.
	useEffect(() => {
		if (postedRef.current) {
			postedRef.current = false;
			return;
		}
		setLocalMine(null);
		setLocalCounts(null);
	}, [myReactions]);

	const status = STATUS_META[post.status] ??
		STATUS_META.reported ?? { label: "Unknown", color: "var(--vb-ink3)", pct: 0 };
	// Trending: fast-rising support relative to age
	const isTrending =
		trendingScore(post) > 1.2 &&
		Date.now() - +new Date(post.created_at) < 7 * 86400000;

	// Priority meta for chip (only show for non-medium priorities)
	const priorityMeta = post.priority && post.priority !== "medium" ? PRIORITY_META[post.priority] : null;

	const react = useCallback(
		async (kind: string) => {
			if (busy) return;
			setBusy(kind);
			// Optimistic flip: update locally FIRST so the button feels instant,
			// then reconcile with the authoritative server response.
			const prevCounts = counts;
			const prevMine = mine;
			const wasActive = mine.includes(kind);
			setLocalCounts((c) => ({
				...(c || post.reactions || {}),
				[kind]: Math.max(
					0,
					((c || post.reactions || {})[kind] || 0) + (wasActive ? -1 : 1),
				),
			}));
			setLocalMine((m) =>
				(m || myReactions || []).includes(kind)
					? (m || myReactions || []).filter((k) => k !== kind)
					: [...(m || myReactions || []), kind],
			);
			try {
				const res = await api.post<{
					counts: Record<string, number>;
					mine: string[];
					toggled: boolean;
				}>("/api/reactions", {
					author_id: anonId,
					target_id: post.id,
					target_type: "post",
					kind,
				});
				// Server returns the authoritative list of MY reactions — opposites are auto-cleared
				setLocalCounts(res.counts);
				setLocalMine(res.mine ?? []);
				postedRef.current = true;
				onReacted?.(post.id, res.counts, kind, res.toggled);
			} catch (e: unknown) {
				// Roll back the optimistic flip
				setLocalCounts(prevCounts);
				setLocalMine(prevMine);
				toast(e instanceof Error ? e.message : "Reaction failed", "err");
			}
			setBusy(null);
		},
		[
			busy,
			anonId,
			post.id,
			mine,
			myReactions,
			counts,
			post.reactions,
			onReacted,
			toast,
		],
	);

	return (
		<article className="card card-hover p-4 sm:p-5 vb-rise vb-card-press">
			<div className="flex items-start gap-3">
				<span className="text-xl leading-none mt-0.5 shrink-0" aria-hidden>
					{CAT_EMOJI[post.category] || "📌"}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-1.5 mb-1">
						{post.ready_for_decision && (
							<span
								className="chip !border-transparent vb-pop"
								style={{
									background: "color-mix(in srgb, var(--vb-good) 14%, transparent)",
									color: "var(--vb-good)",
								}}
								title={`Reached ${post.ready_threshold} co-signs — flagged for admin decision`}
							>
								<Gavel size={11} className="vb-trend-bounce" /> Ready for
								decision
							</span>
						)}
						{isTrending && (
							<span
								className="chip !border-transparent vb-pop"
								style={{
									background: "color-mix(in srgb, var(--vb-warn) 12%, transparent)",
									color: "var(--vb-warn)",
								}}
							>
								<Flame size={11} className="vb-trend-bounce" /> Trending
							</span>
						)}
						{post.pinned && (
							<span className="chip !bg-accent-soft !text-accent !border-transparent">
								<Pin size={11} /> Pinned
							</span>
						)}
						{post.featured && (
							<span className="chip !bg-warn/10 !text-warn !border-transparent">
								<Sparkles size={11} /> Featured
							</span>
						)}
						{post.visibility === "private" && (
							<span
								className="chip !bg-accent-soft !text-accent !border-transparent"
								title="Only you, admins and moderators can see this post"
							>
								<Lock size={11} /> Private · admins only
							</span>
						)}							<span className="chip">{post.category}</span>
							<span
								className="chip"
								title={
									post.type === "suggestion"
										? "Suggestion — an idea, not a complaint"
										: post.type === "poll"
											? "Poll — vote, not a complaint"
											: "Problem — a complaint needing a fix"
								}
							>
								{post.type === "suggestion"
									? "Suggestion"
									: post.type === "poll"
										? "Poll"
										: "Problem"}
							</span>
						<span
						className="chip"
						style={{
							color: status.color,
							borderColor: `color-mix(in srgb, ${status.color} 27%, transparent)`,
						}}
						>
						{post.status === "solved" && <CheckCircle2 size={11} />}{" "}
						{status.label}
						</span>
						{post.deleted && (
							<span
							className="chip"
							style={{
								color: "var(--vb-ink3)",
								borderColor: "color-mix(in srgb, var(--vb-ink3) 27%, transparent)",
							}}
							title="This post was deleted by its author"
							>
								Deleted by user
							</span>
						)}
						{post.priority && post.priority !== "medium" && priorityMeta && (
							<span
								className="chip"
								style={{
									color: priorityMeta.color,
									borderColor: `color-mix(in srgb, ${priorityMeta.color} 27%, transparent)`,
								}}
								title={`Auto-assigned priority: ${priorityMeta.label}`}
							>
								{post.priority === "critical" && "🔴"}
								{post.priority === "high" && "🟠"}
								{post.priority === "low" && "🟢"}
								{" "}{priorityMeta.label}
							</span>
						)}
					</div>
					<Link
						to={`/post/${post.id}`}
						className="block group"
						onMouseEnter={() => prefetchRouteChunk("post")}
						onFocus={() => prefetchRouteChunk("post")}
					>
						<h3 className="font-display font-semibold text-[15px] sm:text-base leading-snug break-words group-hover:text-accent transition-colors duration-200">
							{post.title}
						</h3>							<p className="text-sm text-ink2 mt-1.5 line-clamp-2 leading-relaxed break-words">
								{post.description}
							</p>
							{post.ai_summary && (
								<p className="text-xs text-accent mt-2 flex items-center gap-1.5 bg-accent/5 rounded-lg px-2.5 py-1.5">
									<Sparkles size={11} className="shrink-0" />
									<span className="line-clamp-1">{post.ai_summary}</span>
								</p>
							)}
					</Link>
					{post.tags && post.tags.length > 0 && (
						<div className="flex flex-wrap gap-1.5 mt-2">
							{post.tags.map((t) => (
								<Link
									key={t}
									to={`/search?q=${encodeURIComponent(`#${t}`)}`}
									className="text-[11px] text-accent font-medium hover:underline"
									aria-label={`Show all posts tagged ${t}`}
									onClick={(e) => e.stopPropagation()}
								>
									#{t}
								</Link>
							))}
						</div>
					)}
					<div className="flex flex-wrap items-center gap-1 mt-3 -ml-1">
						{getReactionMeta(post.type).map(({ kind, label, icon: Icon, color }) => (
							<ReactionButton
							key={kind}
							kind={kind}
							label={label}
							icon={Icon}
							color={color}
							active={mine.includes(kind)}
							count={counts[kind] || 0}
							disabled={busy !== null}
							onReact={react}
							inactiveClassName="text-ink3 hover:text-accent"
							/>
						))}
					<Link
						to={`/post/${post.id}`}
						data-tour="comments-link"
						aria-label={`${post.comment_count || 0} comments on ${post.title}`}
						className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-ink3 hover:text-accent transition-colors duration-200"
					>
						<MessageCircle
							size={13}
							className="transition-transform duration-200 hover:scale-110"
						/>{" "}
						{post.comment_count || 0}
					</Link>
						{post.linked_poll && (
							<span
								className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-accent"
								role="status"
								aria-label={`Poll with ${badgeVotes} vote${badgeVotes === 1 ? "" : "s"}`}
								title="This post has a live poll — see below"
							>
								<BarChart3 size={13} /> Poll ·{" "}
								{badgeVotes === 1
									? "1 vote"
									: `${badgeVotes} votes`}
							</span>
						)}
						<button
							onClick={() => {
								toggleBookmark(post.id);
								toast(
									bookmarks.includes(post.id)
										? "Bookmark removed"
										: "Bookmarked — find it in My Activity",
									"ok",
								);
							}}
							aria-label="Bookmark"
							aria-pressed={bookmarks.includes(post.id)}
							className={`px-2.5 py-1.5 rounded-lg transition-colors duration-200 ${bookmarks.includes(post.id) ? "text-accent vb-pop" : "text-ink3 hover:text-accent"}`}
						>
							<Bookmark
								size={13}
								fill={bookmarks.includes(post.id) ? "currentColor" : "none"}
								className="transition-transform duration-200"
							/>
						</button>
						<button
							onClick={() => setReportOpen(true)}
							aria-label="Report this post"
							title="Report this post"
							className="px-2.5 py-1.5 rounded-lg text-ink3 hover:text-bad transition-colors duration-200"
						>
							<Flag size={13} className="transition-transform duration-200" />
						</button>
						<span className="ml-auto text-[11px] text-ink3">
							{timeAgo(post.created_at)}
						</span>
					</div>
				</div>
			</div>

			{/* ── Inline poll — when a linked poll exists and data is loaded, show
			    the full PollCard so users can see options, results, and vote state
			    without leaving the feed. */}
			{post.linked_poll && pollData && (
				<div className="mt-3 border-t border-border pt-3">
					<PollCard
						poll={pollData}
						myVote={myPollVote}
						onVoted={onPollVoted}
					/>
				</div>
			)}			{/* ── Admin-only moderation — extracted to PostCardAdminBar for clean
			    separation and memoization */}
			{hasAdminSession() && <PostCardAdminBar post={post} />}

			{/* Report from the feed — same flow as the detail page: sends author_id
          (the API rejects reports without it), surfaces failures honestly,
          and the API auto-strikes the target author + pushes the warning popup. */}
			<ReportDialog
				open={reportOpen}
				onClose={() => setReportOpen(false)}
				onSubmit={async (reason) => {
					try {
						await api.post("/api/reports", {
							target_id: post.id,
							target_type: "post",
							reason,
							author_id: anonId,
						});
						setReportOpen(false);
						toast("Report submitted — our moderators will review it", "ok");
					} catch (e: unknown) {
						setReportOpen(false);
						toast(
							e instanceof Error ? e.message : "Failed to submit report",
							"err",
						);
					}
				}}
			/>
		</article>
	);
}

export const PostCard = memo(PostCardInner);
export default PostCard;
