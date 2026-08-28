import {
	ArrowLeft,
	Bell,
	BellRing,
	Bookmark,
	CheckCircle2,
	Eye,
	EyeOff,
	Flag,
	Link2,
	Lock,
	ShieldCheck,
	Sparkles,
	Trash2,
	Volume2,
	VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import Comments from "../components/Comments";
import PollCard from "../components/PollCard";
import { REACTION_META } from "../components/PostCard";
import StatusTimeline from "../components/StatusTimeline";
import { ConfirmDialog, ReportDialog } from "../components/ui";
import { useApp } from "../contexts/AppContext";
import { api, hasAdminSession } from "../lib/api";
import { readAloud, speechOutputSupported, stopReading } from "../lib/speech";
import { useRealtime } from "../lib/useRealtime";
import { CAT_EMOJI, timeAgo } from "../lib/utils";
import type { PollData, PostData } from "../types";

export default function PostDetail() {
	const { id } = useParams<{ id: string }>();
	const nav = useNavigate();
	const { anonId, toast, bookmarks, toggleBookmark } = useApp();

	const [p, setPost] = useState<PostData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [counts, setCounts] = useState<Record<string, number>>({});
	const [mine, setMine] = useState<string[]>([]);
	const [busy, setBusy] = useState<string | null>(null);
	const [reportOpen, setReportOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [reading, setReading] = useState(false);
	const [copied, setCopied] = useState(false);
	const [follows, setFollows] = useState<string[]>([]);
	const [followBusy, setFollowBusy] = useState(false);
	const [linkedPoll, setLinkedPoll] = useState<PollData | null>(null);
	// The viewer's existing votes per poll id ({ poll_id: choices }). The poll API
	// only returns aggregate results, so the raw ?voter= rows carry the per-viewer
	// state that makes the linked card show "liked"/voted on first render.
	const [myVotes, setMyVotes] = useState<Record<string, number[]>>({});
	const _readRef = useRef(false);
	// Tracks which postId has already rendered. Background refreshes (realtime
	// polling fallback, post-vote refresh) must NOT setLoading(true) — that
	// collapses the whole page to a skeleton, unmounting Comments and wiping
	// the user's draft input. Only the first load of a post may show the
	// skeleton.
	const loadedRef = useRef<string | null>(null);

	const postId = id || "";
	const isBookmarked = bookmarks.includes(postId);
	const isFollowing = follows.includes(postId);

	const fetchPost = useCallback(async () => {
		try {
			if (loadedRef.current !== postId) setLoading(true);
			setError("");
			const res = await api.getFresh<{
				post: PostData;
				counts: Record<string, number>;
				mine: string[];
			}>(`/api/posts?id=${postId}&viewer=${anonId}`);
			setPost(res.post);
			setCounts(res.counts || {});
			setMine(res.mine || []);
			loadedRef.current = postId;
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Failed to load post");
		} finally {
			setLoading(false);
		}
	}, [postId, anonId]);

	useEffect(() => {
		if (postId) fetchPost();
	}, [postId, fetchPost]);

	// Load the current user's followed posts (non-critical — keep reading even if it fails)
	useEffect(() => {
		if (!anonId) return;
		api
			.get<{ follows: string[] }>(`/api/follows?user_id=${anonId}`)
			.then((r) => setFollows(r.follows || []))
			.catch(() => {
				/* follow state is best-effort */
			});
	}, [anonId]);

	// Fetch the real poll linked to this post (the post row only stores the poll id —
	// the card needs its options/vote data to be interactive).
	const fetchPoll = useCallback(async () => {
		if (!postId) return;
		try {
			const polls = await api.getFresh<PollData[]>(
				`/api/polls?post_id=${postId}&viewer=${anonId}`,
			);
			setLinkedPoll(Array.isArray(polls) ? polls[0] || null : null);
		} catch {
			setLinkedPoll(null);
		}
	}, [postId, anonId]);

	// Load the viewer's existing poll votes so the linked card opens in the voted
	// state (feed "liked" bug: without this the card shows un-voted until the
	// next refetch).
	const fetchMyVotes = useCallback(async () => {
		if (!anonId) return;
		try {
			const votes = await api.getFresh<
				{ poll_id: string; choices: number[] }[]
			>(`/api/polls?voter=${anonId}`);
			if (Array.isArray(votes)) {
				const map: Record<string, number[]> = {};
				for (const v of votes)
					if (v && v.poll_id) map[v.poll_id] = v.choices || [];
				setMyVotes(map);
			}
		} catch {
			// Existing votes are best-effort; the card still works without them.
		}
	}, [anonId]);

	useEffect(() => {
		if (postId) fetchPoll();
	}, [postId, fetchPoll]);
	useEffect(() => {
		fetchMyVotes();
	}, [fetchMyVotes]);

	// Live updates: reload post + linked poll on votes, reactions, comments, edits.
	// getFresh inside the fetchers bypasses the 5s client GET cache.
	// Silently ignore refresh failures — the user's local state (reactions, votes)
	// is already correct from the optimistic update; showing "Failed to load post"
	// after a successful reaction is worse than keeping stale-but-correct data.
	useRealtime(
		["reactions", "comments"],
		() => {
			// Only update counts/mine — do NOT replace the entire post object,
			// which causes the page to feel like it "resets" on every reaction.
			// Full post refresh only happens on explicit user action or mount.
			api.getFresh<{
				post: PostData;
				counts: Record<string, number>;
				mine: string[];
			}>(`/api/posts?id=${postId}&viewer=${anonId}`).then((res) => {
				setCounts(res.counts || {});
				setMine(res.mine || []);
			}).catch(() => {});
		},
		1500,
	);

	// Poll changes trigger a lighter update — only the linked poll data.
	useRealtime(
		["polls", "poll_votes"],
		() => {
			fetchPoll().catch(() => {});
			fetchMyVotes().catch(() => {});
		},
		2000,
	);

	const toggleFollow = async () => {
		// Defense-in-depth: the Follow button is disabled while a request is in
		// flight, so re-entrancy is already blocked at the DOM level (React does
		// not dispatch clicks on disabled buttons) — this guard is unreachable.
		/* v8 ignore next -- @preserve */
		if (followBusy) return;
		setFollowBusy(true);
		const next = !isFollowing;
		try {
			const res = await api.post<{ following: boolean; follows: string[] }>(
				"/api/follows",
				{
					user_id: anonId,
					post_id: postId,
					following: next,
				},
			);
			setFollows(res.follows || []);
			toast(
				res.following
					? "Following — you will be notified on updates"
					: "Unfollowed",
				"ok",
			);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Follow failed", "err");
		}
		setFollowBusy(false);
	};

	// Cleanup TTS on unmount
	useEffect(
		() => () => {
			stopReading();
		},
		[],
	);

	const react = async (kind: string) => {
		// Defense-in-depth: reaction buttons are disabled while `busy` is set
		// (disabled={busy !== null}), so React never dispatches a second click
		// while a request is in flight — this guard is unreachable.
		/* v8 ignore next -- @preserve */
		if (busy) return;
		setBusy(kind);
		// Optimistic flip — feels instant; reconciled with the server response below.
		const prevCounts = counts;
		const prevMine = mine;
		const wasActive = mine.includes(kind);
		setCounts((c) => ({
			...c,
			[kind]: Math.max(0, (c[kind] || 0) + (wasActive ? -1 : 1)),
		}));
		setMine((m) =>
			m.includes(kind) ? m.filter((k) => k !== kind) : [...m, kind],
		);
		try {
			const res = await api.post<{
				counts: Record<string, number>;
				mine: string[];
				toggled: boolean;
			}>("/api/reactions", {
				author_id: anonId,
				target_id: postId,
				target_type: "post",
				kind,
			});
			// Server returns the authoritative state (counts + MY reactions — opposites auto-cleared)
			setCounts(res.counts);
			setMine(res.mine ?? []);
		} catch (e: unknown) {
			setCounts(prevCounts);
			setMine(prevMine);
			toast(e instanceof Error ? e.message : "Reaction failed", "err");
		}
		setBusy(null);
	};

	const del = async () => {
		try {
			// Soft-delete via PUT (owner-scoped) — the DELETE route is admin-only
			await api.put("/api/posts", {
				id: postId,
				author_id: anonId,
				deleted: true,
			});
			toast("Post deleted", "ok");
			nav("/");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Delete failed", "err");
		}
	};

	const toggleLock = async () => {
		if (busy) return;
		setBusy("lock");
		try {
			await api.put("/api/posts", {
				id: postId,
				author_id: anonId,
				locked: !p?.locked,
			});
			toast(p?.locked ? "Comments enabled" : "Comments turned off", "ok");
			fetchPost();
		} catch (e: unknown) {
			toast(
				e instanceof Error ? e.message : "Failed to update comments",
				"err",
			);
		}
		setBusy(null);
	};

	const toggleRead = () => {
		// Defensive: the read-aloud button only renders once the post has loaded (p truthy).
		/* v8 ignore next -- @preserve */
		if (!p) return;
		if (reading) {
			stopReading();
			setReading(false);
			return;
		}
		setReading(true);
		readAloud(`${p.title}. ${p.description}`, () => setReading(false));
	};

	const copyLink = async () => {
		try {
			await navigator.clipboard.writeText(window.location.href);
			setCopied(true);
			toast("Link copied to clipboard", "ok");
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast("Copy failed — check permissions", "err");
		}
	};

	if (loading) {
		return (
			<div className="max-w-3xl mx-auto">
				<button className="btn btn-ghost !px-3 mb-4" onClick={() => nav(-1)}>
					<ArrowLeft size={15} /> Back
				</button>
				<div className="card p-6 space-y-3">
					<div className="h-4 bg-surface2 rounded vb-shimmer w-1/3" />
					<div className="h-6 bg-surface2 rounded vb-shimmer w-2/3" />
					<div className="h-20 bg-surface2 rounded vb-shimmer" />
				</div>
			</div>
		);
	}		if (error || !p) {
			return (
				<div className="max-w-3xl mx-auto vb-page-enter">
					<button className="btn btn-ghost !px-3 mb-4" onClick={() => nav(-1)}>
						<ArrowLeft size={15} /> Back
					</button>
					<div className="card p-8 text-center">
						<div className="vb-empty-icon mx-auto mb-3">
							<span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-500">
								<Link2 size={24} />
							</span>
						</div>
						<p className="text-ink2 font-semibold mb-1">Post not found</p>
						<p className="text-sm text-ink3 mb-4">
							{error || "This post may have been removed or the link is invalid."}
						</p>
						<div className="flex flex-wrap items-center justify-center gap-2">
							<button className="btn btn-primary !text-xs" onClick={() => nav("/")}>
								Go to Home
							</button>
							<button className="btn btn-ghost !text-xs" onClick={() => nav("/submit")}>
								Submit a post
							</button>
							{error && (
								<button className="btn btn-ghost !text-xs" onClick={fetchPost}>
									Retry
								</button>
							)}
						</div>
				</div>
			</div>
			);
		}

	return (
		<div className="max-w-3xl mx-auto vb-page-enter">
			<button className="btn btn-ghost !px-3 mb-4" onClick={() => nav(-1)}>
				<ArrowLeft size={15} /> Back
			</button>

			<article className="card p-5 sm:p-6 vb-rise">
				{/* Meta chips */}
				<div className="flex flex-wrap items-center gap-1.5 mb-3">
					<span className="chip">
						{CAT_EMOJI[p.category]} {p.category}
					</span>
					{p.locked && (
						<span className="chip">
							<Lock size={11} className="inline" /> Locked
						</span>
					)}
					{p.visibility === "private" && (
						<span
							className="chip !bg-accent-soft !text-accent !border-transparent"
							title="Only you, admins and moderators can see this post"
						>
							<Lock size={11} className="inline" /> Private · admins only
						</span>
					)}
					<span className="ml-auto text-xs text-ink3">
						{timeAgo(p.created_at)} · by{" "}
						<code className="font-mono">
							{p.is_mine ? "You" : (p.author_id?.slice(0, 10) ?? "anon")}
						</code>
					</span>
				</div>

				<h1 className="font-display font-bold text-xl sm:text-2xl leading-tight tracking-tight">
					{p.title}
				</h1>
				<p className="text-[15px] text-ink2 mt-3 prose-desc leading-relaxed">
					{p.description}
				</p>

				{p.image_url && (
					<img
						src={p.image_url}
						alt="Attached to post"
						loading="lazy"
						className="mt-4 rounded-xl border border-border max-h-96 object-contain vb-card-press"
					/>
				)}

				{p.tags && p.tags.length > 0 && (
					<div className="flex flex-wrap gap-2 mt-3">
						{p.tags.map((t) => (
							<span key={t} className="text-xs text-accent font-semibold">
								#{t}
							</span>
						))}
					</div>
				)}

				{/* AI summary */}
				{p.ai_summary && (
					<div
						className="mt-4 rounded-xl p-4 vb-card-glow"
						style={{
							background: "var(--vb-accent-soft)",
							border: "1px solid rgba(86,82,214,0.2)",
						}}
					>
						<p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1.5 flex items-center gap-1.5">
							<Sparkles size={12} /> AI summary
						</p>
						<p className="text-sm text-ink2 leading-relaxed">{p.ai_summary}</p>
					</div>
				)}

				{/* Admin reply */}
				{p.admin_reply && (
					<div
						className="mt-4 rounded-xl p-4"
						style={{
							background: "rgba(22,160,106,0.06)",
							border: "1px solid rgba(22,160,106,0.2)",
						}}
					>
						<p
							className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5"
							style={{ color: "var(--vb-good)" }}
						>
							<ShieldCheck size={11} /> Official admin reply
						</p>
						<p className="text-sm prose-desc leading-relaxed">
							{p.admin_reply}
						</p>
					</div>
				)}

				{/* Status timeline */}
				{p.status_history && p.status_history.length > 0 && (
					<div className="mt-5">
						<StatusTimeline post={p} />
					</div>
				)}

				{/* Action bar */}
				<div className="flex flex-wrap items-center gap-1 mt-5 pt-4 border-t border-border">
					{REACTION_META.map(({ kind, label, icon: Icon, color }) => {
						const active = mine.includes(kind);
						const n = counts[kind] || 0;
						return (
							<button
								key={kind}
								onClick={() => react(kind)}
								disabled={busy !== null}
								aria-label={`${label} (${n})`}
								aria-pressed={active}
								title={label}
								className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
									active
										? "vb-pop ring-1"
										: "text-ink3 hover:bg-surface2 hover:-translate-y-0.5 hover:shadow-sm"
								}`}
								style={
									active
										? {
												color,
												background: "var(--vb-surface2)",
												boxShadow: `0 0 0 1px ${color}33`,
											}
										: undefined
								}
							>
								<Icon
									size={13}
									fill={
										active && kind !== "concerned" ? "currentColor" : "none"
									}
									className={`transition-transform duration-200 ${active ? "scale-110" : ""}`}
								/>
								<span className="hidden sm:inline">{label}</span>
								<span
									key={n}
									className="vb-pop inline-block min-w-[14px] text-center"
								>
									{n}
								</span>
							</button>
						);
					})}

					<div className="ml-auto flex items-center gap-1">
						{speechOutputSupported && (
							<button
								onClick={toggleRead}
								aria-label={reading ? "Stop reading" : "Read aloud"}
								title={reading ? "Stop reading" : "Read aloud"}
								className={`p-2 rounded-lg transition-all duration-200 ${reading ? "text-accent bg-accent-soft" : "text-ink3 hover:text-accent hover:bg-surface2"}`}
							>
								{reading ? <VolumeX size={14} /> : <Volume2 size={14} />}
							</button>
						)}
						<button
							onClick={copyLink}
							title={copied ? "Copied!" : "Copy link"}
							className={`p-2 rounded-lg transition-all duration-200 ${copied ? "text-good" : "text-ink3 hover:text-accent hover:bg-surface2"}`}
						>
							<Link2 size={14} />
						</button>
						<button
							onClick={() => toggleBookmark(postId)}
							aria-label="Bookmark"
							aria-pressed={isBookmarked}
							title="Bookmark"
							className={`p-2 rounded-lg transition-all duration-200 ${isBookmarked ? "text-accent vb-pop" : "text-ink3 hover:text-accent hover:bg-surface2"}`}
						>
							<Bookmark
								size={14}
								fill={isBookmarked ? "currentColor" : "none"}
							/>
						</button>
						<button
							onClick={toggleFollow}
							disabled={followBusy}
							aria-label={isFollowing ? "Following" : "Follow post"}
							aria-pressed={isFollowing}
							title={isFollowing ? "Unfollow this post" : "Follow this post"}
							className={`p-2 rounded-lg transition-all duration-200 ${isFollowing ? "text-accent vb-pop" : "text-ink3 hover:text-accent hover:bg-surface2"}`}
						>
							{isFollowing ? (
								<BellRing size={14} fill="currentColor" />
							) : (
								<Bell size={14} />
							)}
						</button>
						<button
							onClick={() => setReportOpen(true)}
							title="Report"
							className="p-2 rounded-lg text-ink3 hover:text-warn hover:bg-surface2 transition-all duration-200"
						>
							<Flag size={14} />
						</button>
						{p.is_mine && (
							<>
								<button
									onClick={toggleLock}
									disabled={busy === "lock"}
									title={
										p.locked ? "Turn comments back on" : "Turn off comments"
									}
									className={`p-2 rounded-lg transition-all duration-200 ${p.locked ? "text-accent" : "text-ink3 hover:text-accent hover:bg-surface2"}`}
								>
									<Lock size={14} fill={p.locked ? "currentColor" : "none"} />
								</button>
								<button
									onClick={() => setDeleteOpen(true)}
									title="Delete"
									className="p-2 rounded-lg text-ink3 hover:text-red-500 hover:bg-red-500/10 transition-all duration-200"
								>
									<Trash2 size={14} />
								</button>
							</>
						)}
						{/* ── Admin-only actions ────────────────────────────── */}
						{hasAdminSession() && (
							<>
								<button
									onClick={async () => {
										await api.put("/api/posts", { id: postId, hidden: !p.hidden });
										setPost((prev) => (prev ? { ...prev, hidden: !prev.hidden } : null));
										toast(p.hidden ? "Post unhidden" : "Post hidden", "ok");
									}}
									title={p.hidden ? "Unhide post" : "Hide post (flag)"}
									className={`p-2 rounded-lg transition-all duration-200 ${p.hidden ? 'text-red-400 bg-red-500/10' : 'text-ink3 hover:text-red-400 hover:bg-red-500/10'}`}
								>
									{p.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
								</button>
								<button
									onClick={async () => {
										await api.put("/api/posts", { id: postId, official: !p.official });
										setPost((prev) => (prev ? { ...prev, official: !prev.official } : null));
										toast(p.official ? "Removed official" : "Marked official", "ok");
									}}
									title={p.official ? "Remove official" : "Mark official"}
									className={`p-2 rounded-lg transition-all duration-200 ${p.official ? 'text-amber-400 bg-amber-500/10' : 'text-ink3 hover:text-amber-400 hover:bg-amber-500/10'}`}
								>
									<ShieldCheck size={14} />
								</button>
								{p.status !== "solved" && p.status !== "archived" && (
									<button
										onClick={async () => {
											await api.put("/api/posts", { id: postId, status: "solved" });
											setPost((prev) => (prev ? { ...prev, status: "solved" } : null));
											toast("Issue solved — the community will be notified!", "ok");
										}}
										title="Mark solved"
										className="p-2 rounded-lg text-ink3 hover:text-good hover:bg-good/10 transition-all duration-200"
									>
										<CheckCircle2 size={14} />
									</button>
								)}
							</>
						)}
					</div>
				</div>
			</article>

			{/* Linked poll — real poll data fetched via /api/polls?post_id= (the post row
          only stores the poll id; the old placeholder rendered zero options and
          made the poll unvoteable) */}
			{p.linked_poll && (
				<div className="mt-4">
					{linkedPoll ? (
						// key={linkedPoll.id} forces a fresh card (fresh useState) when the
						// linked poll changes; myVote opens it in the viewer's voted state.
						<PollCard
							key={linkedPoll.id}
							poll={linkedPoll}
							myVote={myVotes[linkedPoll.id]}
							onVoted={() => {
								fetchPost();
								fetchPoll();
								fetchMyVotes();
							}}
						/>
					) : (
						<div className="card p-4 text-sm text-ink3 animate-pulse">
							Loading linked poll…
						</div>
					)}
				</div>
			)}

			{/* Comments */}
			<div className="mt-6">
				<Comments postId={postId} locked={!!p.locked} />
			</div>

			{/* Report dialog — sends author_id (the API rejects reports without it) and
          surfaces failures instead of silently showing "Report submitted". */}
			<ReportDialog
				open={reportOpen}
				onClose={() => setReportOpen(false)}
				onSubmit={async (reason) => {
					try {
						await api.post("/api/reports", {
							target_id: postId,
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

			{/* Delete confirmation */}
			<ConfirmDialog
				open={deleteOpen}
				onClose={() => setDeleteOpen(false)}
				onConfirm={del}
				title="Delete this post?"
				message="This action cannot be undone. The post and all its comments will be permanently removed."
				confirmLabel="Delete"
				danger
			/>
		</div>
	);
}
