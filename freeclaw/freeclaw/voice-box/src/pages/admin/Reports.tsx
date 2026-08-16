import {
	ArrowUpRight,
	BarChart3,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	ExternalLink,
	Eye,
	EyeOff,
	Flag,
	Gavel,
	Image as ImageIcon,
	Inbox,
	Lock,
	MessageSquare,
	RefreshCcw,
	Search,
	Shield,
	ShieldCheck,
	ShieldX,
	Tag,
	Trash2,
	User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import PostPreviewCard from "../../components/PostPreviewCard";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import { CAT_EMOJI, CATEGORIES, timeAgo } from "../../lib/utils";
import type { PostData } from "../../types";

/* ═══════════════════════════════════════════════════════════════
   REPORTS & CONTENT REVIEW — the classic Report queue desk with
   Content Review + Approval Center merged into ONE page.

   Tabs (all REAL backend data — nothing simulated):
     • Open        — /api/reports          (report rows, moderate author,
                                             resolve, escalate → approval)
     • AI Review   — /api/posts?all=1      (AI-flagged / pending_review posts,
                                             search + status filter + expandable
                                             detail with comments & screenshots)
     • Pre-publish — /api/pre-review       (blocked submissions: publish /
                                             reject / keep private / ban)
     • Approvals   — /api/workforce        (pending-approvals: approve-task /
                                             reject-task — the REAL workforce
                                             approval pipeline)
     • Resolved    — /api/reports          (resolved history)
   ═══════════════════════════════════════════════════════════════ */

interface ReportRow {
	id: number;
	target_id: string;
	target_type: "post" | "comment" | "poll";
	reason: string;
	details?: string;
	status?: string;
	author_id?: string; // the REPORTER
	target_author_id?: string | null; // the reported author (resolved by the API)
	enforcement?: {
		strike_applied: boolean;
		strikes: number;
		suspended: boolean;
		banned: boolean;
		already_struck: boolean;
	};
	created_at: string;
	[k: string]: unknown;
}

interface PreReviewItem {
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
	status?: string;
	checks?: {
		privacy?: { pass: boolean; issues: string[] };
		safety?: { pass: boolean; issues: string[] };
		spam?: { pass: boolean; issues: string[] };
		quality?: { pass: boolean; issues: string[] };
	};
	[k: string]: unknown;
}

interface ReviewPost {
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

interface Comment {
	id: string;
	post_id: string;
	body: string;
	author_id: string;
	created_at: string;
	flagged?: boolean;
	moderation_flags?: unknown;
}

interface ApprovalItem {
	id: string;
	title: string;
	description: string | null;
	source: string;
	priority: string;
	risk_level: string;
	verification_status: string;
	input: unknown;
	created_by: string;
	created_at: string;
}

type Tab = "open" | "review" | "approvals" | "resolved";

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

/* ── Post preview card (for existing reports) ────────────────── */
function PostPreview({ targetId }: { targetId: string }) {
	const [post, setPost] = useState<PostData | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				// Single-post fetches return { post, counts, mine } — unwrap so the
				// preview card renders the actual post (not the wrapper).
				const data = await api.get<{ post?: PostData }>(
					`/api/posts?id=${targetId}`,
				);
				if (!cancelled) setPost(data?.post || (data as PostData) || null);
			} catch {
				/* target may not exist */
			}
			if (!cancelled) setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [targetId]);

	if (loading) return <div className="skeleton h-24 mt-2" />;
	if (!post)
		return (
			<p className="text-[11px] text-ink3 mt-2 italic">
				Target post not found or deleted.
			</p>
		);

	const statusColors: Record<string, string> = {
		open: "var(--vb-warn)",
		in_progress: "var(--vb-accent)",
		resolved: "var(--vb-good)",
		closed: "var(--vb-ink3)",
	};

	return (
		<div className="mt-2.5 rounded-xl border border-border bg-surface2/50 overflow-hidden">
			{post.image_url && (
				<div className="relative h-32 bg-surface2 overflow-hidden">
					<img
						src={post.image_url}
						alt={post.title || "Post image"}
						className="w-full h-full object-cover"
						loading="lazy"
						onError={(e) => {
							(e.target as HTMLImageElement).style.display = "none";
						}}
					/>
					<span className="absolute top-2 left-2 chip !text-[9px] !py-0.5 !px-1.5 bg-black/60 text-white backdrop-blur-sm">
						<ImageIcon size={9} /> screenshot
					</span>
				</div>
			)}

			<div className="p-3">
				<div className="flex items-center gap-1.5 flex-wrap mb-1.5">
					<span
						className="chip !text-[9px]"
						style={{
							color: statusColors[post.status] || "var(--vb-ink3)",
							borderColor:
								(statusColors[post.status] || "var(--vb-ink3)") + "44",
						}}
					>
						{post.status || "unknown"}
					</span>
					{post.category && (
						<span className="chip !text-[9px]">{post.category}</span>
					)}
					{post.priority && post.priority !== "medium" && (
						<span
							className="chip !text-[9px]"
							style={{
								color:
									post.priority === "critical"
										? "var(--vb-bad)"
										: post.priority === "high"
											? "var(--vb-warn)"
											: "var(--vb-ink3)",
							}}
						>
							{post.priority}
						</span>
					)}
				</div>

				<p className="text-sm font-semibold leading-snug mb-1">
					{post.title || "(no title)"}
				</p>

				{post.description && (
					<p className="text-xs text-ink2 leading-relaxed line-clamp-3 mb-1.5">
						{post.description}
					</p>
				)}

				<div className="flex items-center gap-3 text-[10px] text-ink3">
					{typeof post.reactions === "object" && post.reactions && (
						<span>
							👍{" "}
							{Object.values(post.reactions as Record<string, number>).reduce(
								(a, b) => a + (typeof b === "number" ? b : 0),
								0,
							)}{" "}
							reactions
						</span>
					)}
					{post.comment_count != null && (
						<span>💬 {post.comment_count} comments</span>
					)}
					{post.author_id && <span>by {post.author_id.slice(0, 10)}…</span>}
					{post.created_at && <span>{timeAgo(post.created_at)}</span>}
				</div>

				{post.admin_reply && (
					<div className="mt-2 p-2 rounded-lg bg-accent/5 border border-accent/10 text-[11px] text-ink2">
						<span className="font-semibold text-accent">Admin reply:</span>{" "}
						{post.admin_reply}
					</div>
				)}
			</div>
		</div>
	);
}

/* ── Pre-publish review item (classic queue card) ─────────────── */
function PrePublishReview({
	item,
	onAction,
	busy,
}: {
	item: PreReviewItem;
	onAction: (key: string, action: string) => void;
	busy: boolean;
}) {
	return (
		<div
			className="card overflow-hidden"
			style={{ borderColor: "rgba(220,75,75,0.2)" }}
		>
			{/* Header */}
			<div className="p-4 flex items-start gap-3 border-b border-border bg-red-500/5">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 mb-1">
						<span
							className="chip !text-[9px] !py-0.5"
							style={{
								color: "var(--vb-bad)",
								borderColor: "rgba(220,75,75,0.3)",
							}}
						>
							<ShieldX size={9} /> pre-publish review
						</span>
						<span
							className="chip !text-[9px] !py-0.5"
							style={{
								color: "var(--vb-warn)",
								borderColor: "rgba(220,170,50,0.3)",
							}}
						>
							{item.status || "pending"}
						</span>
						{item.risk_score != null && (
							<span
								className="chip !text-[9px] !py-0.5"
								style={{
									color:
										item.risk_score >= 80 ? "var(--vb-bad)" : "var(--vb-warn)",
									borderColor: "rgba(220,170,50,0.3)",
								}}
							>
								risk {item.risk_score}/100
							</span>
						)}
					</div>
					<p className="text-sm font-medium">
						🛡️ AI flagged this content for review
					</p>
					{item.title && (
						<p className="text-sm font-semibold leading-snug mt-0.5">
							{item.title}
						</p>
					)}
					{item.description && (
						<p className="text-xs text-ink2 mt-0.5 line-clamp-2">
							{item.description}
						</p>
					)}
					<p className="text-[11px] text-ink3 mt-1 font-mono">
						type: {item.content_type} ·{" "}
						{item.created_at ? timeAgo(item.created_at) : "unknown"}
					</p>
				</div>
			</div>

			{/* Post preview with screenshot rendering */}
			<div className="p-4">
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
					blocked={true}
				/>
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

			{/* Action buttons */}
			<div className="p-4 border-t border-border flex gap-2 flex-wrap">
				<button
					className="flex-1 btn btn-soft !text-xs flex items-center justify-center gap-1.5"
					onClick={() => onAction(item.key, "approve")}
					disabled={busy}
					aria-label={`Publish review ${item.key}`}
				>
					<ShieldCheck size={13} /> Approve & Publish
				</button>
				<button
					className="flex-1 btn btn-ghost !text-xs flex items-center justify-center gap-1.5 text-good"
					onClick={() => onAction(item.key, "keep_private")}
					disabled={busy}
					aria-label={`Keep private review ${item.key}`}
				>
					<Lock size={13} /> Keep private
				</button>
				<button
					className="flex-1 btn btn-ghost !text-xs flex items-center justify-center gap-1.5 text-bad"
					onClick={() => onAction(item.key, "reject")}
					disabled={busy}
					aria-label={`Reject review ${item.key}`}
				>
					<ShieldX size={13} /> Reject
				</button>
				<button
					className="btn btn-ghost !p-2 flex items-center justify-center"
					onClick={() => {
						if (confirm("Ban this user?")) onAction(item.key, "ban");
					}}
					disabled={busy}
					title="Ban author"
					aria-label={`Ban review ${item.key}`}
				>
					<Trash2 size={13} />
				</button>
			</div>
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMBINED COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function Reports() {
	const { toast } = useApp();
	const [tab, setTab] = useState<Tab>("open");

	// ── Data ──────────────────────────────────────────────────────
	const [reports, setReports] = useState<ReportRow[]>([]);
	const [preReviews, setPreReviews] = useState<PreReviewItem[]>([]);
	const [posts, setPosts] = useState<ReviewPost[]>([]);
	const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
	const [queueError, setQueueError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);

	// ── Report view state ─────────────────────────────────────────
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [actingId, setActingId] = useState<number | null>(null);

	// ── Content Review view state ─────────────────────────────────
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState("all");
	const [categoryFilter, setCategoryFilter] = useState("all");
	const [expandedPost, setExpandedPost] = useState<string | null>(null);
	const [postComments, setPostComments] = useState<Record<string, Comment[]>>(
		{},
	);
	const [loadingComments, setLoadingComments] = useState<
		Record<string, boolean>
	>({});
	const [showImage, setShowImage] = useState<Record<string, boolean>>({});

	// ── Fast queues (reports / pre-review / approvals) ────────────────
	// These three endpoints are lightweight and safe to refresh on every
	// realtime tick + 15s poll + visibility change.
	const loadFast = useCallback(async (silent = false) => {
		if (!silent) setLoading(true);
		setQueueError(null);
		try {
			const [reportsData, reviewData, approvalsRes] = await Promise.all([
				api.get<ReportRow[]>("/api/reports").catch(() => []),
				// Surfacing admin-session expiry for the review queue (real user pain)
				api
					.get<{ items: PreReviewItem[] }>("/api/pre-review")
					.catch((e: unknown) => {
						const msg = e instanceof Error ? e.message : String(e);
						if (
							msg.includes("403") ||
							msg.includes("Admin only") ||
							msg.includes("Forbidden")
						) {
							setQueueError(
								"Admin session expired — log out and log back in to see the review queue.",
							);
						}
						return { items: [] };
					}),
				api
					.post<{ approvals: ApprovalItem[] }>("/api/workforce", {
						action: "pending-approvals",
					})
					.catch(() => ({ approvals: [] })),
			]);

			setReports(Array.isArray(reportsData) ? reportsData : []);
			setPreReviews(reviewData?.items || []);
			setApprovals(approvalsRes?.approvals || []);
		} catch (e: unknown) {
			console.warn(
				"[Reports] load failed:",
				e instanceof Error ? e.message : e,
			);
		}
		setLoading(false);
	}, []);

	// ── Heavy content-review scan (throttled) ────────────────────────
	// /api/posts?all=1 scans the whole feed (up to 2000 rows) — firing it on
	// every 1.2s realtime tick is what made this page crawl. It now only runs
	// on mount / manual refresh, and re-runs at most every 60s, and only while
	// the AI Review desk is the active tab.
	const postsLoadRef = useRef(0);
	const POSTS_RELOAD_MS = 60000;
	const loadPosts = useCallback(async (force = false) => {
		const now = Date.now();
		// force = explicit user Refresh — always re-scan. Otherwise throttle.
		if (!force && now - postsLoadRef.current < POSTS_RELOAD_MS) return;
		postsLoadRef.current = now;
		try {
			const allPosts = await api
				.getSlow<ReviewPost[]>("/api/posts?all=1")
				.catch(() => []);
			// Only posts that went through AI review / await a moderation decision
			setPosts(
				(Array.isArray(allPosts) ? allPosts : []).filter(
					(p) =>
						p.status === "pending_review" ||
						p.status === "flagged" ||
						p.status === "pending" ||
						p.ai_analysis ||
						p.moderation_flags,
				),
			);
		} catch (e: unknown) {
			console.warn(
				"[Reports] post scan failed:",
				e instanceof Error ? e.message : e,
			);
		}
	}, []);

	// Full load (mount + after actions): fast queues + a THROTTLED posts scan.
	// Action handlers (resolve/escalate/approve) call this — they must NOT
	// re-trigger a 2000-row scan each time.
	const load = useCallback(
		async (silent = false) => {
			await loadFast(silent);
			await loadPosts();
		},
		[loadFast, loadPosts],
	);

	// Explicit user Refresh — always fresh, bypasses the posts throttle.
	const refreshAll = useCallback(() => {
		void loadFast(true);
		void loadPosts(true);
	}, [loadFast, loadPosts]);

	useEffect(() => {
		load();
	}, [load]);

	// 🔴 Live: new reports / flagged posts / comments appear without refresh.
	// Realtime ticks only reload the FAST queues — the heavy posts scan is
	// throttled and tied to the review tab (below).
	useRealtime(
		["reports", "posts", "comments"],
		() => {
			void loadFast(true);
			if (tab === "review") void loadPosts();
		},
		1200,
	);
	useEffect(() => {
		const iv = setInterval(() => {
			if (!document.hidden) void loadFast(true);
		}, 15000);
		const onVis = () => {
			if (!document.hidden) void loadFast(true);
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			clearInterval(iv);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, [loadFast]);

	// Entering the AI Review desk triggers a (throttled) fresh posts scan.
	useEffect(() => {
		if (tab === "review") void loadPosts();
	}, [tab, loadPosts]);

	// ── Report actions ────────────────────────────────────────────
	const resolve = async (id: number) => {
		setBusy(`resolve:${id}`);
		try {
			await api.put("/api/reports", { id, status: "resolved" });
			toast("Resolved", "ok");
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Action failed", "err");
		}
		setBusy(null);
	};

	const escalateReport = async (id: number) => {
		setBusy(`esc-report:${id}`);
		try {
			const r = await api.post<{ ok: boolean; error?: string }>(
				"/api/workforce",
				{ action: "escalate-report", id: String(id) },
			);
			if (r.ok === false) {
				toast(r.error || "Escalation failed", "err");
				return;
			}
			toast("Report escalated — now in the Approval Center", "ok");
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : String(e), "err");
		}
		setBusy(null);
	};

	const escalatePost = async (id: string) => {
		setBusy(`esc-post:${id}`);
		try {
			const r = await api.post<{ ok: boolean; error?: string }>(
				"/api/workforce",
				{ action: "escalate-post", id },
			);
			if (r.ok === false) {
				toast(r.error || "Escalation failed", "err");
				return;
			}
			toast("Post escalated — moderation decision now needs approval", "ok");
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : String(e), "err");
		}
		setBusy(null);
	};

	// ── Direct moderation on the REPORTED author (warn/suspend/ban) ──
	const moderateAuthor = async (
		report: ReportRow,
		action: "warn" | "suspend" | "ban",
	) => {
		let authorId = report.target_author_id || "";
		if (!authorId) {
			try {
				if (report.target_type === "comment") {
					const c = await api
						.get<{ id: string; author_id: string }[]>(`/api/comments?all=1`)
						.catch(() => []);
					const found = (Array.isArray(c) ? c : []).find(
						(x) => x.id === report.target_id,
					);
					authorId = found?.author_id || "";
				} else {
					const p = await api
						.get<{ post?: { author_id?: string } }>(
							`/api/posts?id=${report.target_id}`,
						)
						.catch(() => null as never);
					authorId = p?.post?.author_id || "";
				}
			} catch {
				/* fall through */
			}
		}
		if (!authorId || authorId === "ADMIN") {
			toast("No author to moderate on this report", "err");
			return;
		}

		if (
			action === "ban" &&
			!confirm(
				`Permanently ban ${authorId}? They will immediately lose posting, commenting and voting.`,
			)
		)
			return;
		setActingId(report.id);
		try {
			const body: Record<string, unknown> = {
				action: "update_user",
				anon_id: authorId,
			};
			if (action === "warn")
				body.warn = `Content reported for: ${report.reason}`;
			if (action === "suspend") body.suspend_days = 7;
			if (action === "ban") body.banned = true;
			await api.post("/api/admin", body);
			toast(
				action === "ban"
					? `User ${authorId.slice(0, 10)}… banned — they were notified instantly`
					: action === "suspend"
						? `User ${authorId.slice(0, 10)}… suspended for 7 days`
						: `Warning issued to ${authorId.slice(0, 10)}… — strike applied & notified`,
				"ok",
			);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Moderation action failed", "err");
		}
		setActingId(null);
	};

	// ── Approval actions (real workforce commands) ────────────────
	const approveTask = async (id: string) => {
		setBusy(`approve:${id}`);
		try {
			const r = await api.post<{ ok: boolean; error?: string }>(
				"/api/workforce",
				{ action: "approve-task", id },
			);
			if (r.ok === false) {
				toast(r.error || "Approve failed", "err");
				return;
			}
			toast("Approved — queued for execution", "ok");
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : String(e), "err");
		}
		setBusy(null);
	};

	const rejectTask = async (id: string) => {
		setBusy(`reject:${id}`);
		try {
			const r = await api.post<{ ok: boolean; error?: string }>(
				"/api/workforce",
				{ action: "reject-task", id, reason: "Rejected in Reports & Review" },
			);
			if (r.ok === false) {
				toast(r.error || "Reject failed", "err");
				return;
			}
			toast("Rejected — task cancelled", "ok");
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : String(e), "err");
		}
		setBusy(null);
	};

	// ── Pre-publish action ────────────────────────────────────────
	const handleReviewAction = async (key: string, action: string) => {
		setBusy(`review:${key}`);
		try {
			await api.post("/api/pre-review", { key, action });
			toast(
				`Review ${action === "approve" ? "approved & published" : action}d`,
				"ok",
			);
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : String(e), "err");
		}
		setBusy(null);
	};

	// ── Content Review actions ────────────────────────────────────
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
		if (expandedPost === postId) setExpandedPost(null);
		else {
			setExpandedPost(postId);
			loadPostComments(postId);
		}
	};

	const updateStatus = async (postId: string, newStatus: string) => {
		setBusy(`status:${postId}`);
		try {
			await api.put("/api/posts", { id: postId, status: newStatus });
			setPosts((prev) =>
				prev.map((p) => (p.id === postId ? { ...p, status: newStatus } : p)),
			);
			toast(`Post status → ${newStatus}`, "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Update failed", "err");
		}
		setBusy(null);
	};

	const deletePost = async (postId: string) => {
		if (!confirm("Delete this post permanently?")) return;
		setBusy(`delete:${postId}`);
		try {
			await api.del("/api/posts", { id: postId });
			setPosts((prev) => prev.filter((p) => p.id !== postId));
			toast("Post deleted", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Delete failed", "err");
		}
		setBusy(null);
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

	// ── Derived ───────────────────────────────────────────────────
	const openReports = reports.filter((r) => r.status !== "resolved");
	const resolvedReports = reports.filter((r) => r.status === "resolved");

	const filteredPosts = posts.filter((p) => {
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

	const targetTypeIcon = (type: string) => {
		switch (type) {
			case "post":
				return <Flag size={12} />;
			case "comment":
				return <MessageSquare size={12} />;
			case "poll":
				return <BarChart3 size={12} />;
			default:
				return <Flag size={12} />;
		}
	};

	const priorityColor = (p: string) =>
		p === "critical"
			? "var(--vb-bad)"
			: p === "high"
				? "var(--vb-warn)"
				: p === "low"
					? "var(--vb-good)"
					: "var(--vb-ink3)";

	const TAB_META: {
		key: Tab;
		label: string;
		icon: React.ReactNode;
		count: number;
		color: string;
	}[] = [
		{
			key: "open",
			label: "Open",
			icon: <Flag size={12} />,
			count: openReports.length,
			color: "var(--vb-bad)",
		},
		{
			key: "review",
			label: "AI Review",
			icon: <Shield size={12} />,
			count: posts.length + preReviews.length,
			color: "var(--vb-accent)",
		},
		{
			key: "approvals",
			label: "Approvals",
			icon: <Gavel size={12} />,
			count: approvals.length,
			color: "#8b5cf6",
		},
		{
			key: "resolved",
			label: "Resolved",
			icon: <CheckCircle2 size={12} />,
			count: resolvedReports.length,
			color: "var(--vb-good)",
		},
	];

	return (
		<div>
			{/* ── Header ─────────────────────────────────────────────── */}
			<div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
				<div>
					<h1 className="font-display font-bold text-xl">Report queue</h1>
					<p className="text-xs text-ink3 mt-0.5">
						Reports → AI content review (incl. pre-publish gate) → approvals —
						one desk, all real data
					</p>
				</div>
				<button
					className="btn btn-ghost !text-xs"
					onClick={refreshAll}
					disabled={loading}
				>
					<RefreshCcw
						size={12}
						className={`mr-1 ${loading ? "animate-spin" : ""}`}
					/>{" "}
					Refresh
				</button>
			</div>

			{/* ── Live stats (display only — the tab row below navigates) ── */}
			<div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 mb-4">
				{TAB_META.map((t) => (
					<div key={t.key} className="card p-2 sm:p-3 text-center">
						<p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-ink3 truncate">
							{t.label}
						</p>
						<p
							className="text-lg sm:text-xl font-bold mt-0.5 sm:mt-1"
							style={{ color: t.color }}
						>
							{t.count}
						</p>
					</div>
				))}
			</div>

			{/* ── Error banner (admin session expiry for review queue) ── */}
			{queueError && (
				<div className="card p-3 border-l-4 border-l-yellow-500 bg-yellow-500/10 mb-4">
					<p className="text-xs text-yellow-300 font-semibold">
						⚠️ {queueError}
					</p>
				</div>
			)}

			{/* ── Tabs ───────────────────────────────────────────────── */}
			<div className="flex gap-2 mb-4 flex-wrap">
				{TAB_META.map((t) => (
					<button
						key={t.key}
						className={`btn !text-xs ${tab === t.key ? "btn-primary" : "btn-ghost"}`}
						onClick={() => setTab(t.key)}
					>
						{t.icon} {t.label} ({t.count})
					</button>
				))}
			</div>

			{loading ? (
				<div className="space-y-2">
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-16" />
					))}
				</div>
			) : (
				<div className="space-y-3">
					{/* ══════════ OPEN REPORTS (classic queue) ══════════ */}
					{tab === "open" && (
						<>
							{openReports.map((r) => {
								const isExpanded = expandedId === r.id;
								return (
									<div key={r.id} className="card overflow-hidden">
										<div
											className="p-4 flex items-start gap-3 cursor-pointer hover:bg-surface2/30 transition-colors"
											onClick={() => setExpandedId(isExpanded ? null : r.id)}
										>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2 mb-1 flex-wrap">
													<span
														className="chip !text-[9px] !py-0.5"
														style={{
															color: "var(--vb-bad)",
															borderColor: "rgba(220,75,75,0.3)",
														}}
													>
														{targetTypeIcon(r.target_type)} {r.target_type}
													</span>
													<span
														className="chip !text-[9px] !py-0.5"
														style={{
															color: "var(--vb-warn)",
															borderColor: "rgba(220,170,50,0.3)",
														}}
													>
														open
													</span>
													{r.target_author_id && (
														<span
															className="chip !text-[9px] !py-0.5"
															style={{
																color: "var(--vb-accent)",
																borderColor: "rgba(86,82,214,0.3)",
															}}
														>
															author: {r.target_author_id.slice(0, 12)}…
														</span>
													)}
													{r.enforcement?.strike_applied && (
														<span
															className="chip !text-[9px] !py-0.5"
															style={{
																color: "var(--vb-bad)",
																borderColor: "rgba(220,75,75,0.3)",
															}}
														>
															⚡ auto-strike {r.enforcement.strikes}
														</span>
													)}
													{r.enforcement?.banned && (
														<span className="chip !text-[9px] !py-0.5 !bg-bad/10 !text-bad">
															🚫 auto-banned
														</span>
													)}
													{r.enforcement?.suspended && (
														<span className="chip !text-[9px] !py-0.5 !bg-warn/10 !text-warn">
															⏸ auto-suspended
														</span>
													)}
												</div>
												<p className="text-sm font-medium">🚩 {r.reason}</p>
												<p className="text-[11px] text-ink3 mt-1 font-mono">
													target: {r.target_id} · by{" "}
													{String(r.author_id || "").slice(0, 12)}… ·{" "}
													{timeAgo(r.created_at)}
												</p>
											</div>
											<div className="flex items-center gap-2 shrink-0">
												{r.target_type === "post" && (
													<a
														className="btn btn-ghost !p-2"
														href={`/post/${r.target_id}`}
														target="_blank"
														rel="noreferrer"
														title="Open target"
														aria-label={`Open target post ${r.target_id}`}
														onClick={(e) => e.stopPropagation()}
													>
														<ExternalLink size={14} />
													</a>
												)}
												<button
													className="btn btn-ghost !p-2 text-purple-400"
													title="Escalate to Approval Center"
													onClick={(e) => {
														e.stopPropagation();
														escalateReport(r.id);
													}}
													disabled={busy === `esc-report:${r.id}`}
													aria-label={`Escalate report ${r.id}`}
												>
													<ArrowUpRight size={14} />
												</button>
												<button
													className="btn btn-soft !text-xs"
													onClick={(e) => {
														e.stopPropagation();
														resolve(r.id);
													}}
													disabled={busy === `resolve:${r.id}`}
													aria-label={`Resolve report ${r.id}`}
												>
													<CheckCircle2 size={13} /> Resolve
												</button>
											</div>
										</div>

										{/* Direct moderation actions — strike/warn/suspend/ban the reported author */}
										{(r.target_author_id ||
											r.target_type === "post" ||
											r.target_type === "comment") && (
											<div className="px-4 pb-3 border-t border-border flex items-center gap-1.5 flex-wrap">
												<span className="text-[10px] text-ink3 mr-1 font-semibold">
													Moderate author:
												</span>
												<button
													className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all hover:brightness-110"
													style={{
														background: "rgba(217,138,11,0.14)",
														color: "#d98a0b",
													}}
													disabled={actingId === r.id}
													onClick={() => moderateAuthor(r, "warn")}
												>
													⚠ Warn + strike
												</button>
												<button
													className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all hover:brightness-110"
													style={{
														background: "rgba(22,160,106,0.14)",
														color: "#16a06a",
													}}
													disabled={actingId === r.id}
													onClick={() => moderateAuthor(r, "suspend")}
												>
													⏸ Suspend 7d
												</button>
												<button
													className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all hover:brightness-110"
													style={{
														background: "rgba(220,75,75,0.14)",
														color: "#dc4b4b",
													}}
													disabled={actingId === r.id}
													onClick={() => moderateAuthor(r, "ban")}
												>
													🚫 Ban
												</button>
												{actingId === r.id && (
													<span className="text-[10px] text-ink3 animate-pulse">
														applying…
													</span>
												)}
											</div>
										)}

										{isExpanded && r.target_type === "post" && (
											<div className="px-4 pb-4 border-t border-border">
												<PostPreview targetId={r.target_id} />
											</div>
										)}
									</div>
								);
							})}
							{openReports.length === 0 && (
								<p className="card p-8 text-center text-sm text-ink3">
									Queue is clear — no open reports.
								</p>
							)}
						</>
					)}

					{/* ══════════ AI REVIEW (Content Review + pre-publish merged) ══════════ */}
					{tab === "review" && (
						<>
							{/* ── Pre-publish queue (merged INTO content review) ── */}
							{preReviews.length > 0 && (
								<div className="mb-3 space-y-3">
									<div className="flex items-center gap-2">
										<ShieldX size={13} className="text-warn" />
										<p className="text-xs font-semibold text-ink2">
											AI pre-publish gate — {preReviews.length} blocked{" "}
											{preReviews.length === 1 ? "submission" : "submissions"}{" "}
											awaiting decision
										</p>
									</div>
									{preReviews.map((item) => (
										<PrePublishReview
											key={item.key}
											item={item}
											busy={busy === `review:${item.key}`}
											onAction={handleReviewAction}
										/>
									))}
								</div>
							)}

							{/* Filters */}
							<div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center mb-3">
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

							{filteredPosts.length === 0 && preReviews.length === 0 ? (
								<div className="card p-10 text-center">
									<div className="vb-empty-icon mx-auto mb-3">
										<Inbox size={28} className="text-ink3" />
									</div>
									<p className="text-sm font-semibold text-ink2 mb-1">
										No flagged or pending posts right now
									</p>
									<p className="text-xs text-ink3 mb-4">
										Posts flagged by the AI pre-publish check and AI review
										appear here automatically
									</p>
									<button
										className="btn btn-ghost !text-xs"
										onClick={refreshAll}
									>
										<RefreshCcw size={12} className="mr-1" /> Refresh
									</button>
								</div>
							) : (
								filteredPosts.map((post) => {
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
																{CAT_EMOJI[post.category] || "📁"}{" "}
																{post.category}
															</span>
															<span
																className="chip !text-[9px] sm:!text-[10px] !py-0.5 capitalize"
																style={{ color: priorityColor(post.priority) }}
															>
																{post.priority}
															</span>
															{post.image_url && (
																<span className="chip !text-[9px] sm:!text-[10px] !py-0.5">
																	<ImageIcon size={9} /> Image
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
																<Clock size={9} /> {timeAgo(post.created_at)}
															</span>
															<span className="flex items-center gap-1">
																<MessageSquare size={9} />{" "}
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
													<div>
														<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">
															Full Description
														</p>
														<p className="text-sm text-ink2 whitespace-pre-wrap">
															{post.description}
														</p>
													</div>

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
																		setShowImage((s) => ({
																			...s,
																			[post.id]: true,
																		}));
																	}}
																>
																	<Eye size={13} /> Show image
																</button>
															)}
														</div>
													)}

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

													{/* Comments */}
													<div>
														<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-2 flex items-center gap-1">
															<MessageSquare size={11} /> Comments (
															{postCommentList.length})
														</p>
														{loadingComments[post.id] ? (
															<p className="text-xs text-ink3">
																Loading comments…
															</p>
														) : postCommentList.length === 0 ? (
															<p className="text-xs text-ink3 italic">
																No comments
															</p>
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
																					{new Date(
																						c.created_at,
																					).toLocaleString()}
																					{c.flagged && (
																						<span className="text-bad font-semibold">
																							{" "}
																							· FLAGGED
																						</span>
																					)}
																				</p>
																				<p className="text-xs text-ink2">
																					{c.body}
																				</p>
																				{!!c.moderation_flags && (
																					<p className="text-[10px] text-warn mt-1">
																						<Shield
																							size={10}
																							className="inline"
																						/>{" "}
																						Moderation flags present
																					</p>
																				)}
																			</div>
																			<button
																				className="btn btn-ghost !p-1.5 shrink-0 text-bad/60 hover:text-bad"
																				onClick={() =>
																					deleteComment(c.id, post.id)
																				}
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

													{/* Admin actions */}
													<div className="grid grid-cols-2 sm:flex gap-1.5 sm:gap-2 pt-2 border-t border-border">
														{post.status === "pending_review" && (
															<button
																className="btn !text-[10px] sm:!text-xs bg-good/15 text-good border border-good/30 hover:bg-good/25 font-semibold w-full sm:w-auto"
																onClick={() =>
																	updateStatus(post.id, "reported")
																}
																disabled={busy === `status:${post.id}`}
															>
																<CheckCircle2 size={12} /> Approve ✓
															</button>
														)}
														{post.status !== "in_progress" && (
															<button
																className="btn btn-ghost !text-[10px] sm:!text-xs w-full sm:w-auto"
																onClick={() =>
																	updateStatus(post.id, "in_progress")
																}
																disabled={busy === `status:${post.id}`}
															>
																<CheckCircle2 size={12} /> In Progress
															</button>
														)}
														{post.status !== "solved" && (
															<button
																className="btn btn-ghost !text-[10px] sm:!text-xs w-full sm:w-auto"
																onClick={() => updateStatus(post.id, "solved")}
																disabled={busy === `status:${post.id}`}
															>
																<CheckCircle2 size={12} /> Solved
															</button>
														)}
														{post.status !== "archived" && (
															<button
																className="btn btn-ghost !text-[10px] sm:!text-xs w-full sm:w-auto"
																onClick={() =>
																	updateStatus(post.id, "archived")
																}
																disabled={busy === `status:${post.id}`}
															>
																<ShieldX size={12} /> Archive
															</button>
														)}
														<button
															className="btn btn-ghost !text-[10px] sm:!text-xs w-full sm:w-auto text-purple-400"
															onClick={() => escalatePost(post.id)}
															disabled={busy === `esc-post:${post.id}`}
															aria-label={`Escalate post ${post.id}`}
														>
															<ArrowUpRight size={12} /> Escalate
														</button>
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
															disabled={busy === `delete:${post.id}`}
														>
															<Trash2 size={12} /> Delete
														</button>
													</div>
												</div>
											)}
										</div>
									);
								})
							)}
						</>
					)}



					{/* ══════════ APPROVALS (workforce approval center) ══════════ */}
					{tab === "approvals" && (
						<>
							{approvals.length === 0 ? (
								<div className="card p-10 text-center">
									<div className="vb-empty-icon mx-auto mb-3">
										<Gavel size={28} className="text-ink3" />
									</div>
									<p className="text-sm font-semibold text-ink2 mb-1">
										No high-risk tasks awaiting approval
									</p>
									<p className="text-xs text-ink3 mb-4">
										Escalated reports and posts land here for your decision
									</p>
									<button
										className="btn btn-ghost !text-xs"
										onClick={refreshAll}
									>
										<RefreshCcw size={12} className="mr-1" /> Refresh
									</button>
								</div>
							) : (
								approvals.map((a) => {
									const why =
										typeof a.input === "object" &&
										a.input &&
										"target_id" in (a.input as object)
											? `Target: ${(a.input as { target_id: string }).target_id}`
											: `Source: ${a.source}`;
									return (
										<div key={a.id} className="card overflow-hidden">
											<div className="p-4 flex items-start gap-3">
												<div
													className="mt-0.5 p-2 rounded-lg shrink-0"
													style={{
														background: "rgba(139,92,246,0.12)",
														color: "#a78bfa",
													}}
												>
													<Gavel size={16} />
												</div>
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-2 mb-1 flex-wrap">
														<span className="chip !text-[9px] !py-0.5 !bg-purple-500/10 !text-purple-300">
															requires approval
														</span>
														<span
															className="chip !text-[9px] !py-0.5 capitalize"
															style={{
																color: priorityColor(a.priority),
																borderColor: priorityColor(a.priority) + "44",
															}}
														>
															{a.priority}
														</span>
														<span
															className="chip !text-[9px] !py-0.5 capitalize"
															style={{
																color: "var(--vb-warn)",
																borderColor: "rgba(220,170,50,0.3)",
															}}
														>
															risk: {a.risk_level}
														</span>
														{a.verification_status && (
															<span
																className="chip !text-[9px] !py-0.5"
																style={{
																	color: "var(--vb-ink3)",
																	borderColor: "rgba(120,120,120,0.3)",
																}}
															>
																{a.verification_status}
															</span>
														)}
													</div>
													<p className="text-sm font-semibold">{a.title}</p>
													{a.description && (
														<p className="text-xs text-ink2 mt-1">
															{a.description}
														</p>
													)}
													<p className="text-[10px] font-mono text-ink3 mt-2">
														{why} · by {a.created_by} · {timeAgo(a.created_at)}
													</p>
												</div>
												<div className="flex items-center gap-2 shrink-0">
													<button
														className="btn btn-soft !text-xs bg-good/15 text-good border border-good/30"
														onClick={() => approveTask(a.id)}
														disabled={busy === `approve:${a.id}`}
														aria-label={`Approve task ${a.id}`}
													>
														<CheckCircle2 size={13} /> Approve
													</button>
													<button
														className="btn btn-ghost !text-xs text-bad"
														onClick={() => rejectTask(a.id)}
														disabled={busy === `reject:${a.id}`}
														aria-label={`Reject task ${a.id}`}
													>
														<ShieldX size={13} /> Reject
													</button>
												</div>
											</div>
										</div>
									);
								})
							)}
						</>
					)}

					{/* ══════════ RESOLVED HISTORY ══════════ */}
					{tab === "resolved" && (
						<>
							{resolvedReports.map((r) => (
								<div key={r.id} className="card p-4 opacity-60">
									<div className="flex items-start gap-3">
										<CheckCircle2
											size={16}
											className="text-good shrink-0 mt-0.5"
										/>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium">{r.reason}</p>
											<p className="text-[11px] text-ink3 mt-1 font-mono">
												target: {r.target_id} · resolved {timeAgo(r.created_at)}
											</p>
										</div>
									</div>
								</div>
							))}
							{resolvedReports.length === 0 && (
								<p className="card p-8 text-center text-sm text-ink3">
									No resolved reports yet.
								</p>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
}
