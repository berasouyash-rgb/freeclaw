import {
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	ExternalLink,
	Eye,
	EyeOff,
	Image,
	Inbox,
	MessageCircle,
	RefreshCcw,
	Search,
	Shield,
	Tag,
	Trash2,
	User,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import PostPreviewCard from "../../components/PostPreviewCard";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import { CAT_EMOJI, CATEGORIES } from "../../lib/utils";

interface Post {
	id: string;
	type: string;
	title: string;
	description: string;
	category: string;
	priority: string;
	status: string;
	author_id: string;
	image_url?: string;
	created_at: string;
	tags?: string[];
	reactions?: Record<string, number>;
	moderation_flags?: unknown;
	ai_analysis?: unknown;
}
interface ReviewItem {
	key: string;
	title?: string;
	description?: string;
	body?: string;
	category?: string;
	priority?: string;
	content_type?: string;
	risk_score?: number;
	decision?: string;
	author_id?: string;
	image_url?: string;
	summary?: string;
	created_at?: string;
	options?: string[] | null;
	checks?: {
		privacy?: { pass: boolean; issues: string[] };
		safety?: { pass: boolean; issues: string[] };
		spam?: { pass: boolean; issues: string[] };
		quality?: { pass: boolean; issues: string[] };
	};
}
interface Comment {
	id: string;
	post_id: string;
	body: string;
	author_id: string;
	created_at: string;
	flagged?: boolean;
	moderation_flags?: unknown;
}

const STATUS_COLORS: Record<
	string,
	{ bg: string; text: string; label: string }
> = {
	reported: { bg: "rgba(220,75,75,0.12)", text: "#dc4b4b", label: "Reported" },
	open: { bg: "rgba(86,82,214,0.12)", text: "var(--vb-accent)", label: "Open" },
	pending_review: {
		bg: "rgba(217,138,11,0.12)",
		text: "#d98a0b",
		label: "Pending Review",
	},
	in_progress: {
		bg: "rgba(22,160,106,0.12)",
		text: "var(--vb-good)",
		label: "In Progress",
	},
	solved: {
		bg: "rgba(22,160,106,0.08)",
		text: "var(--vb-good)",
		label: "Solved",
	},
	archived: { bg: "rgba(120,120,120,0.12)", text: "#888", label: "Archived" },
};

export default function ContentReview() {
	const { toast } = useApp();
	const [posts, setPosts] = useState<Post[]>([]);
	const [comments, setComments] = useState<Comment[]>([]);
	const [reviewQueue, setReviewQueue] = useState<ReviewItem[]>([]);
	const [queueError, setQueueError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState("pending_review");
	const [categoryFilter, setCategoryFilter] = useState("all");
	const [expandedPost, setExpandedPost] = useState<string | null>(null);
	const [postComments, setPostComments] = useState<Record<string, Comment[]>>(
		{},
	);
	const [loadingComments, setLoadingComments] = useState<
		Record<string, boolean>
	>({});
	const [showImage, setShowImage] = useState<Record<string, boolean>>({});

	const loadData = useCallback(
		async (silent = false) => {
			if (!silent) setLoading(true);
			setQueueError(null);
			try {
				const [allPosts, allComments] = await Promise.all([
					api.getSlow<Post[]>("/api/posts?all=1"),
					api.get<Comment[]>("/api/comments?all=1").catch(() => []),
				]);
				// Only show posts that went through AI review:
				// 1. Posts flagged by serverModerate (pending_review status)
				// 2. Posts with ai_analysis or moderation_flags data
				const aiReviewed = (Array.isArray(allPosts) ? allPosts : []).filter(
					(p) =>
						p.status === "pending_review" ||
						p.ai_analysis ||
						p.moderation_flags,
				);
				setPosts(aiReviewed);
				setComments(Array.isArray(allComments) ? allComments : []);

				// Fetch pre-publish review queue separately — don't silently swallow errors
				try {
					const reviewData = await api.get<{ items: ReviewItem[] }>(
						"/api/pre-review",
					);
					setReviewQueue(reviewData?.items || []);
				} catch (reviewErr: unknown) {
					const msg =
						reviewErr instanceof Error
							? reviewErr.message
							: "Failed to load review data";
					console.error("[ContentReview] Review queue fetch failed:", msg);
					setReviewQueue([]);
					if (
						msg.includes("403") ||
						msg.includes("Admin only") ||
						msg.includes("Forbidden")
					) {
						setQueueError(
							"Admin session expired — log out and log back in to see the review queue.",
						);
					} else {
						setQueueError(`Review queue failed to load: ${msg}`);
					}
				}
			} catch (e: unknown) {
				console.warn(
					"[ContentReview] Failed to load:",
					e instanceof Error ? e.message : e,
				);
				toast("Failed to load content", "err");
			}
			setLoading(false);
		},
		[toast],
	);

	useEffect(() => {
		loadData();
	}, [loadData]);

	// 🔴 Live updates: new flagged posts / comments appear without a manual refresh.
	// Silent mode keeps the existing list on screen (no skeleton flicker on every event).
	useRealtime(["posts", "comments"], () => loadData(true), 1200);

	// The pre-publish review queue lives in settings keys (pre_publish_review:*), not the
	// posts/comments tables — realtime can't see it. Refresh it on a light interval when
	// the tab is visible so newly blocked submissions appear without a manual refresh.
	useEffect(() => {
		const iv = setInterval(() => {
			if (!document.hidden) loadData(true);
		}, 20000);
		const onVis = () => {
			if (!document.hidden) loadData(true);
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			clearInterval(iv);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, [loadData]);

	const loadPostComments = async (postId: string) => {
		if (postComments[postId]) return;
		setLoadingComments((p) => ({ ...p, [postId]: true }));
		try {
			const c = await api.get<Comment[]>(`/api/comments?post_id=${postId}`);
			setPostComments((p) => ({ ...p, [postId]: c || [] }));
		} catch {
			/* ignore */
		}
		setLoadingComments((p) => ({ ...p, [postId]: false }));
	};

	const toggleExpand = (postId: string) => {
		if (expandedPost === postId) {
			setExpandedPost(null);
		} else {
			setExpandedPost(postId);
			loadPostComments(postId);
		}
	};

	const updateStatus = async (postId: string, newStatus: string) => {
		try {
			await api.put("/api/posts", { id: postId, status: newStatus });
			setPosts((prev) =>
				prev.map((p) => (p.id === postId ? { ...p, status: newStatus } : p)),
			);
			toast(`Post status → ${newStatus}`, "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Update failed", "err");
		}
	};

	const deletePost = async (postId: string) => {
		if (!confirm("Delete this post permanently?")) return;
		try {
			await api.del("/api/posts", { id: postId });
			setPosts((prev) => prev.filter((p) => p.id !== postId));
			toast("Post deleted", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Delete failed", "err");
		}
	};

	const deleteComment = async (commentId: string, postId: string) => {
		if (!confirm("Delete this comment?")) return;
		try {
			await api.del("/api/comments", { id: commentId });
			setPostComments((prev) => ({
				...prev,
				[postId]: (prev[postId] || []).filter((c) => c.id !== commentId),
			}));
			toast("Comment deleted", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Delete failed", "err");
		}
	};

	// Filter
	const filtered = posts.filter((p) => {
		if (statusFilter !== "all" && p.status !== statusFilter) return false;
		if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
		if (search) {
			const q = search.toLowerCase();
			if (
				!p.title.toLowerCase().includes(q) &&
				!p.description.toLowerCase().includes(q) &&
				!p.author_id.toLowerCase().includes(q)
			)
				return false;
		}
		return true;
	});

	const stats = {
		total: posts.length,
		reported: posts.filter((p) => p.status === "reported").length,
		pending: posts.filter((p) => p.status === "pending_review").length,
		withImages: posts.filter((p) => p.image_url).length,
		flagged: comments.filter((c) => c.flagged).length,
		queue: reviewQueue.length,
	};

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="font-display font-bold text-lg">Content Review</h2>
					<p className="text-xs text-ink3 mt-0.5">
						Posts flagged by AI pre-publish check — review, approve, or remove
					</p>
				</div>
				<button
					className="btn btn-ghost !text-xs"
					onClick={() => loadData()}
					disabled={loading}
				>
					<RefreshCcw
						size={12}
						className={`mr-1 ${loading ? "animate-spin" : ""}`}
					/>{" "}
					Refresh
				</button>
			</div>

			{/* Stats bar — 3 cols on mobile, 6 on sm+ */}
			<div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
				{(
					[
						["AI-Reviewed", stats.total, "var(--vb-accent)"],
						["Pending", stats.pending, "#d98a0b"],
						["Reported", stats.reported, "#dc4b4b"],
						["Queue", stats.queue, "#8b5cf6"],
						["Images", stats.withImages, "var(--vb-good)"],
						["Flagged", stats.flagged, "#dc4b4b"],
					] as [string, number, string][]
				).map(([label, count, color]) => (
					<div key={label} className="card p-2 sm:p-3 text-center">
						<p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-ink3 truncate">
							{label}
						</p>
						<p
							className="text-lg sm:text-xl font-bold mt-0.5 sm:mt-1"
							style={{ color }}
						>
							{count}
						</p>
					</div>
				))}
			</div>

			{/* Error banner for review queue failures */}
			{queueError && (
				<div className="card p-3 border-l-4 border-l-yellow-500 bg-yellow-500/10">
					<p className="text-xs text-yellow-300 font-semibold">
						⚠️ {queueError}
					</p>
				</div>
			)}

			{/* Filters — stack on mobile, row on sm+ */}
			<div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
				<div className="relative flex-1 min-w-0 w-full sm:min-w-[200px]">
					<Search
						size={14}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3"
					/>
					<input
						className="input !pl-8 !py-2 !text-xs"
						placeholder="Search title, description, or author ID…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
				<div className="flex gap-2 w-full sm:w-auto">
					<select
						className="input !py-2 !text-xs flex-1 sm:flex-none sm:!w-auto"
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
					>
						<option value="all">All statuses</option>
						{Object.entries(STATUS_COLORS).map(([k, v]) => (
							<option key={k} value={k}>
								{v.label}
							</option>
						))}
					</select>
					<select
						className="input !py-2 !text-xs flex-1 sm:flex-none sm:!w-auto"
						value={categoryFilter}
						onChange={(e) => setCategoryFilter(e.target.value)}
					>
						<option value="all">All categories</option>
						{CATEGORIES.map((c) => (
							<option key={c} value={c}>
								{CAT_EMOJI[c]} {c}
							</option>
						))}
					</select>
				</div>
			</div>

			{/* Pre-Publish Review Queue */}
			{reviewQueue.length > 0 && (
				<div className="card p-4 border-l-4 border-l-purple-500">
					<h3 className="text-sm font-bold text-purple-400 mb-2">
						Pre-Publish Review Queue ({reviewQueue.length})
					</h3>
					<p className="text-xs text-ink3 mb-3">
						High-risk content awaiting admin decision. These posts were blocked
						by the AI pre-publish check.
					</p>
					<div className="space-y-3">
						{reviewQueue.map((item) => (
							<div
								key={item.key}
								className="p-3 sm:p-4 bg-surface2/40 rounded-lg border border-border/50"
							>
								<div className="flex flex-col lg:flex-row items-start gap-3 lg:gap-4">
									{/* Full snapshot — exactly what would have been published */}
									<div className="flex-1 min-w-0 w-full lg:max-w-[420px]">
										<PostPreviewCard
											title={item.title}
											description={item.description}
											body={item.body}
											category={item.category}
											priority={item.priority}
											content_type={item.content_type}
											risk_score={item.risk_score}
											checks={item.checks}
											summary={item.summary}
											author_id={item.author_id}
											created_at={item.created_at}
											image_url={item.image_url}
											blocked
										/>
										{/* Poll options (when the held item was a poll) */}
										{Array.isArray(item.options) && item.options.length > 0 && (
											<div className="mt-2 space-y-1">
												{item.options.map((opt, i) => (
													<div
														key={i}
														className="flex items-center gap-2 text-[11px] text-ink2"
													>
														<span className="w-3.5 h-3.5 rounded-full border border-border flex items-center justify-center text-[8px]">
															{i + 1}
														</span>
														{opt}
													</div>
												))}
											</div>
										)}
									</div>
									<div className="grid grid-cols-2 sm:flex gap-1.5 w-full lg:w-auto lg:flex-col lg:shrink-0">
										<button
											className="text-[10px] px-2 py-1.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 font-semibold text-center w-full sm:w-auto"
											onClick={async () => {
												try {
													await api.post("/api/pre-review", {
														key: item.key,
														action: "approve",
													});
													setReviewQueue((q) =>
														q.filter((i) => i.key !== item.key),
													);
													toast("Approved & published", "ok");
												} catch (e: unknown) {
													toast(
														e instanceof Error ? e.message : "Failed",
														"err",
													);
												}
											}}
										>
											✓ Approve
										</button>
										<button
											className="text-[10px] px-2 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 font-semibold text-center w-full sm:w-auto"
											onClick={async () => {
												try {
													await api.post("/api/pre-review", {
														key: item.key,
														action: "reject",
													});
													setReviewQueue((q) =>
														q.filter((i) => i.key !== item.key),
													);
													toast("Rejected", "ok");
												} catch (e: unknown) {
													toast(
														e instanceof Error ? e.message : "Failed",
														"err",
													);
												}
											}}
										>
											✗ Reject
										</button>
										<button
											className="text-[10px] px-2 py-1.5 rounded bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 font-semibold text-center w-full sm:w-auto"
											onClick={async () => {
												try {
													await api.post("/api/pre-review", {
														key: item.key,
														action: "keep_private",
													});
													setReviewQueue((q) =>
														q.filter((i) => i.key !== item.key),
													);
													toast("Kept private", "ok");
												} catch (e: unknown) {
													toast(
														e instanceof Error ? e.message : "Failed",
														"err",
													);
												}
											}}
										>
											🔒 Private
										</button>
										<button
											className="text-[10px] px-2 py-1.5 rounded bg-red-700/20 text-red-300 hover:bg-red-700/30 font-semibold text-center w-full sm:w-auto"
											onClick={async () => {
												if (!confirm("Ban this user?")) return;
												try {
													await api.post("/api/pre-review", {
														key: item.key,
														action: "ban",
													});
													setReviewQueue((q) =>
														q.filter((i) => i.key !== item.key),
													);
													toast("User banned", "ok");
												} catch (e: unknown) {
													toast(
														e instanceof Error ? e.message : "Failed",
														"err",
													);
												}
											}}
										>
											🚫 Ban
										</button>
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{loading ? (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="card p-4 animate-pulse">
							<div className="flex items-center gap-2 mb-2">
								<div className="h-5 w-20 rounded bg-surface2" />
								<div className="h-5 w-16 rounded bg-surface2" />
								<div className="h-5 w-12 rounded bg-surface2" />
							</div>
							<div className="h-4 w-3/4 rounded bg-surface2 mb-2" />
							<div className="h-3 w-full rounded bg-surface2 mb-1" />
							<div className="h-3 w-2/3 rounded bg-surface2" />
						</div>
					))}
				</div>
			) : filtered.length === 0 ? (
				<div className="card p-10 text-center">
					<div className="vb-empty-icon mx-auto mb-3">
						<Inbox size={28} className="text-ink3" />
					</div>
					<p className="text-sm font-semibold text-ink2 mb-1">
						No AI-reviewed posts match your filters
					</p>
					<p className="text-xs text-ink3 mb-4">
						Try changing the status filter or search query
					</p>
					<button className="btn btn-ghost !text-xs" onClick={() => loadData()}>
						<RefreshCcw size={12} className="mr-1" /> Refresh
					</button>
				</div>
			) : (
				<div className="space-y-3">
					{filtered.map((post) => {
						const expanded = expandedPost === post.id;
						const statusStyle = STATUS_COLORS[post.status] || {
							bg: "rgba(86,82,214,0.12)",
							text: "var(--vb-accent)",
							label: "Open",
						};
						const postCommentList = postComments[post.id] || [];
						const isImageShown = showImage[post.id];

						return (
							<div key={post.id} className="card overflow-hidden">
								{/* Post header */}
								<div
									className="p-4 cursor-pointer hover:bg-surface2/50 transition-colors"
									onClick={() => toggleExpand(post.id)}
								>
									<div className="flex items-start gap-3">
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
												<span
													className="chip !text-[9px] sm:!text-[10px] !py-0.5"
													style={{
														background: statusStyle.bg,
														color: statusStyle.text,
													}}
												>
													{statusStyle.label}
												</span>
												<span className="chip !text-[9px] sm:!text-[10px] !py-0.5">
													{CAT_EMOJI[post.category] || "📁"} {post.category}
												</span>
												<span className="chip !text-[9px] sm:!text-[10px] !py-0.5 capitalize">
													{post.priority}
												</span>
												{post.image_url && (
													<span className="chip !text-[9px] sm:!text-[10px] !py-0.5">
														<Image size={9} /> Image
													</span>
												)}
												{post.tags?.length ? (
													<span className="chip !text-[9px] sm:!text-[10px] !py-0.5">
														<Tag size={9} /> {post.tags.length}t
													</span>
												) : null}
											</div>
											<h3 className="font-semibold text-sm leading-snug">
												{post.title}
											</h3>
											<p className="text-xs text-ink2 mt-1 line-clamp-2">
												{post.description}
											</p>
											<div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-3 mt-2 text-[9px] sm:text-[10px] text-ink3">
												<span className="flex items-center gap-1 truncate max-w-full sm:max-w-[160px]">
													<User size={9} className="shrink-0" />{" "}
													{post.author_id}
												</span>
												<span className="hidden sm:flex items-center gap-1">
													<Clock size={9} />{" "}
													{new Date(post.created_at).toLocaleString()}
												</span>
												<span className="flex items-center gap-1">
													<MessageCircle size={9} />{" "}
													{postCommentList.length || "—"} comments
												</span>
												{post.reactions &&
													Object.keys(post.reactions).length > 0 && (
														<span className="truncate">
															{Object.entries(post.reactions)
																.map(([k, v]) => `${k}:${v}`)
																.join(" ")}
														</span>
													)}
											</div>
										</div>
										<div className="flex items-center gap-1 shrink-0 self-start mt-1">
											{expanded ? (
												<ChevronUp size={16} className="text-ink3" />
											) : (
												<ChevronDown size={16} className="text-ink3" />
											)}
										</div>
									</div>
								</div>

								{/* Expanded detail */}
								{expanded && (
									<div className="border-t border-border p-4 space-y-4 bg-surface2/30">
										{/* Full description */}
										<div>
											<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">
												Full Description
											</p>
											<p className="text-sm text-ink2 whitespace-pre-wrap">
												{post.description}
											</p>
										</div>

										{/* Image screenshot */}
										{post.image_url && (
											<div>
												<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">
													Screenshot / Image
												</p>
												{isImageShown ? (
													<div className="relative inline-block">
														<img
															src={post.image_url}
															alt="Post screenshot"
															className="max-h-64 rounded-lg border border-border object-contain"
														/>
														<button
															className="absolute top-2 right-2 btn btn-ghost !p-1.5 bg-bg/80 backdrop-blur"
															onClick={(e) => {
																e.stopPropagation();
																setShowImage((s) => ({
																	...s,
																	[post.id]: false,
																}));
															}}
														>
															<EyeOff size={12} />
														</button>
													</div>
												) : (
													<button
														className="btn btn-ghost !text-xs"
														onClick={(e) => {
															e.stopPropagation();
															setShowImage((s) => ({ ...s, [post.id]: true }));
														}}
													>
														<Eye size={13} /> Show image
													</button>
												)}
											</div>
										)}

										{/* User details — 2 cols on mobile with truncated values */}
										<div className="grid grid-cols-2 gap-2 sm:gap-3">
											<div className="rounded-lg p-2 sm:p-2.5 bg-bg border border-border overflow-hidden">
												<p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-ink3">
													Author ID
												</p>
												<p className="text-[10px] sm:text-[11px] font-mono text-ink2 mt-0.5 truncate">
													{post.author_id}
												</p>
											</div>
											<div className="rounded-lg p-2 sm:p-2.5 bg-bg border border-border overflow-hidden">
												<p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-ink3">
													Post ID
												</p>
												<p className="text-[10px] sm:text-[11px] font-mono text-ink2 mt-0.5 truncate">
													{post.id}
												</p>
											</div>
											<div className="rounded-lg p-2 sm:p-2.5 bg-bg border border-border">
												<p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-ink3">
													Type
												</p>
												<p className="text-[10px] sm:text-[11px] text-ink2 mt-0.5 capitalize">
													{post.type}
												</p>
											</div>
											<div className="rounded-lg p-2 sm:p-2.5 bg-bg border border-border overflow-hidden">
												<p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-ink3">
													Posted
												</p>
												<p className="text-[9px] sm:text-[11px] text-ink2 mt-0.5 truncate">
													{new Date(post.created_at).toLocaleString()}
												</p>
											</div>
										</div>

										{/* Tags */}
										{post.tags && post.tags.length > 0 && (
											<div>
												<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">
													Tags
												</p>
												<div className="flex flex-wrap gap-1.5">
													{post.tags.map((t) => (
														<span key={t} className="chip !text-[10px]">
															#{t}
														</span>
													))}
												</div>
											</div>
										)}

										{/* Comments section */}
										<div>
											<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-2 flex items-center gap-1">
												<MessageCircle size={11} /> Comments (
												{postCommentList.length})
											</p>
											{loadingComments[post.id] ? (
												<p className="text-xs text-ink3">Loading comments…</p>
											) : postCommentList.length === 0 ? (
												<p className="text-xs text-ink3 italic">No comments</p>
											) : (
												<div className="space-y-2 max-h-64 overflow-y-auto">
													{postCommentList.map((c) => (
														<div
															key={c.id}
															className={`rounded-lg p-3 border ${c.flagged ? "border-bad/30 bg-bad/5" : "border-border bg-bg"}`}
														>
															<div className="flex items-start justify-between gap-2">
																<div className="flex-1 min-w-0">
																	<p className="text-[10px] text-ink3 mb-1">
																		<span className="font-mono">
																			{c.author_id}
																		</span>
																		{" · "}
																		{new Date(c.created_at).toLocaleString()}
																		{c.flagged && (
																			<span className="text-bad font-semibold">
																				{" "}
																				· FLAGGED
																			</span>
																		)}
																	</p>
																	<p className="text-xs text-ink2">{c.body}</p>
																	{!!c.moderation_flags && (
																		<p className="text-[10px] text-warn mt-1">
																			<Shield size={10} className="inline" />{" "}
																			Moderation flags present
																		</p>
																	)}
																</div>
																<button
																	className="btn btn-ghost !p-1.5 shrink-0 text-bad/60 hover:text-bad"
																	onClick={() => deleteComment(c.id, post.id)}
																	aria-label="Delete comment"
																>
																	<Trash2 size={12} />
																</button>
															</div>
														</div>
													))}
												</div>
											)}
										</div>

										{/* Admin actions — 2-col grid on mobile, row on sm+ */}
										<div className="grid grid-cols-2 sm:flex gap-1.5 sm:gap-2 pt-2 border-t border-border">												{post.status === "pending_review" && (
													<>
														<button
															className="btn !text-[10px] sm:!text-xs bg-good/15 text-good border border-good/30 hover:bg-good/25 font-semibold w-full sm:w-auto"
															onClick={() => updateStatus(post.id, "reported")}
														>
															<Check size={12} /> Approve ✓
														</button>
														<button
															className="btn !text-[10px] sm:!text-xs bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25 font-semibold w-full sm:w-auto"
															onClick={() => {
																if (confirm("Hide this post from the public feed?"))
																	updateStatus(post.id, "hidden");
															}}
														>
															<Trash2 size={12} /> Hide ✗
														</button>
													</>
											)}
											{post.status !== "in_progress" && (
												<button
													className="btn btn-ghost !text-[10px] sm:!text-xs w-full sm:w-auto"
													onClick={() => updateStatus(post.id, "in_progress")}
												>
													<CheckCircle2 size={12} /> In Progress
												</button>
											)}
											{post.status !== "solved" && (
												<button
													className="btn btn-ghost !text-[10px] sm:!text-xs w-full sm:w-auto"
													onClick={() => updateStatus(post.id, "solved")}
												>
													<CheckCircle2 size={12} /> Solved
												</button>
											)}
											{post.status !== "archived" && (
												<button
													className="btn btn-ghost !text-[10px] sm:!text-xs w-full sm:w-auto"
													onClick={() => updateStatus(post.id, "archived")}
												>
													<XCircle size={12} /> Archive
												</button>
											)}
											<a
												href={`/post/${post.id}`}
												target="_blank"
												rel="noopener noreferrer"
												className="btn btn-ghost !text-[10px] sm:!text-xs w-full sm:w-auto !col-span-2 sm:!col-auto text-center"
												onClick={(e) => e.stopPropagation()}
											>
												<ExternalLink size={12} /> View Live
											</a>
											<button
												className="btn btn-ghost !text-[10px] sm:!text-xs text-bad w-full sm:w-auto sm:ml-auto"
												onClick={() => deletePost(post.id)}
											>
												<Trash2 size={12} /> Delete
											</button>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
