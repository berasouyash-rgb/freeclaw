// ═══════════════════════════════════════════════════════════════════
// WorkItem — Universal detail view for Reports / Suggestions / Polls
// Matches the production wireframe exactly.
//
// Layout (per wireframe):
// ┌──────────────────────────────────────────────────────────────┐
// │  ← Back                                REPORT #ID      ⋮    │
// │  ● REPORT  ● VERIFIED  ● WAITING  ● IN PROGRESS  ● SOLVED  │
// ├───────────────────────────┬──────────────────────────────────┤
// │  REPORT DETAILS           │  STATUS                          │
// │  ┌────────────────────┐   │  ● In progress                   │
// │  │ content            │   │                                  │
// │  └────────────────────┘   │  ACTIONS                         │
// │  Category: X              │  [ Solve ]                       │
// │  Submitted: X             │  [ Verify ]                      │
// │  Reference: #ID           │  [ Assign ]                      │
// │                           │  [ Escalate ]                    │
// │  ACTIVITY                 │  [ Dismiss ]                     │
// │  ● event  time            │                                  │
// │  ● event  time            │  OFFICIAL REPLY                  │
// │                           │  ┌──────────────────────────┐   │
// │                           │  │ write a reply...          │   │
// │                           │  └──────────────────────────┘   │
// ├───────────────────────────┴──────────────────────────────────┤
// │  OFFICIAL REPLY (shown after sent)                           │
// │  ┌──────────────────────────────────────────────────────────┐│
// │  │ reply text here                                         ││
// │  └──────────────────────────────────────────────────────────┘│
// └──────────────────────────────────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════

import {
	AlertTriangle,
	ArrowLeft,
	ArrowUpRight,
	Ban,
	CheckCircle2,
	Clock,
	Eye,
	EyeOff,
	Image as ImageIcon,
	Flag,
	MessageSquare,
	Shield,
	Trash2,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import type { PostData } from "../../types";
import { STATUS_META, timeAgo } from "../../lib/utils";

// ── Types ──────────────────────────────────────────────────────

export interface WorkItemData {
	id: string | number;
	type: "report" | "suggestion" | "poll" | "comment";
	title: string;
	content: string;
	status: string;
	category?: string;
	priority?: string;
	author_id?: string;
	target_author_id?: string;
	target_type?: string;
	target_id?: string;
	// Related content link for the RELATED CONTENT section (built by the
	// caller, which knows each target type's valid page).
	related?: { kind: string; url?: string | null; label: string; postId?: string | null } | null;
	// Reporter reliability, derived from already-loaded rows (no new fetch).
	reporterStats?: { filed: number; upheld: number } | null;
	created_at: string;
	details?: string;
	assigned_to?: string;
	admin_reply?: string;
	enforcement?: {
		strike_applied: boolean;
		strikes: number;
		suspended: boolean;
		banned: boolean;
		already_struck?: boolean;
	};
}

export interface TimelineEvent {
	id: string;
	action: string;
	actor: string;
	detail?: string;
	created_at: string;
}

/* ── Post preview card (related content) ────────────────── */
function PostPreview({ targetId }: { targetId: string }) {
	const [post, setPost] = useState<PostData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				// Single-post fetches return { post, counts, mine } — unwrap so the
				// preview card renders the actual post (not the wrapper).
				const data = await api.get<{ post?: PostData }>(
					`/api/posts?id=${targetId}`,
				);
				if (!cancelled) {
					setPost(data?.post || (data as PostData) || null);
					setError("");
				}
			} catch (e: unknown) {
				// A failed fetch is NOT a deleted post. This used to swallow the
				// error and report "not found or deleted", which told moderators the
				// evidence had vanished when the API was simply unavailable.
				if (!cancelled)
					setError(e instanceof Error ? e.message : "Failed to load");
			}
			if (!cancelled) setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [targetId]);

	if (loading) return <div className="skeleton h-24 mt-2" />;

	if (error)
		return (
			<p className="text-[11px] text-warn mt-2 flex items-start gap-1.5">
				<AlertTriangle size={12} className="mt-0.5 shrink-0" />
				<span>Couldn't load the target post: {error}</span>
			</p>
		);

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

// ── Status machine ─────────────────────────────────────────────

const STATUS_FLOW = [
	{ key: "pending", label: "REPORT", icon: Flag, color: "#8e8ea5" },
	{ key: "reported", label: "REPORT", icon: Flag, color: "#8e8ea5" },
	{ key: "verified", label: "VERIFIED", icon: CheckCircle2, color: "#3b82f6" },
	{ key: "waiting", label: "WAITING", icon: Clock, color: "#a855f7" },
	{ key: "in_progress", label: "IN PROGRESS", icon: Clock, color: "#d98a0b" },
	{ key: "reviewed", label: "REVIEWED", icon: Eye, color: "#3b82f6" },
	{ key: "solved", label: "SOLVED", icon: CheckCircle2, color: "#16a06a" },
];

const ALTERNATE_STATES = ["dismissed", "duplicate", "escalated", "auto_resolved"];

const PRIORITY_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
	critical: { bg: "rgba(220,38,38,0.08)", text: "#dc2626", border: "rgba(220,38,38,0.25)", label: "Critical" },
	high: { bg: "rgba(239,68,68,0.08)", text: "#ef4444", border: "rgba(239,68,68,0.25)", label: "High" },
	medium: { bg: "rgba(245,158,11,0.08)", text: "#f59e0b", border: "rgba(245,158,11,0.25)", label: "Medium" },
	low: { bg: "rgba(107,114,128,0.08)", text: "#6b7280", border: "rgba(107,114,128,0.25)", label: "Low" },
};

function statusIndex(status: string): number {
	// Normalize: "pending" maps to the first step (REPORT)
	if (status === "pending") return 0;
	const idx = STATUS_FLOW.findIndex((s) => s.key === status);
	return idx >= 0 ? idx : -1;
}

function statusColor(status: string): string {
	const idx = statusIndex(status);
	if (idx >= 0 && STATUS_FLOW[idx]) return STATUS_FLOW[idx].color;
	switch (status) {
		case "dismissed": return "#6b7280";
		case "escalated": return "#a855f7";
		case "duplicate": return "#d98a0b";
		default: return "#8e8ea5";
	}
}

// ── Confirmation dialog ────────────────────────────────────────

function ConfirmDialog({
	title,
	message,
	confirmLabel,
	confirmColor,
	onConfirm,
	onCancel,
	busy,
}: {
	title: string;
	message: string;
	confirmLabel: string;
	confirmColor: string;
	onConfirm: () => void;
	onCancel: () => void;
	busy: boolean;
}) {
	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm">
			<div className="card w-full max-w-sm p-6 space-y-4">
				<h3 className="font-display font-bold text-sm text-ink">{title}</h3>
				<p className="text-xs text-ink2 leading-relaxed">{message}</p>
				<div className="flex gap-2 justify-end">
					<button className="btn btn-ghost !text-xs" onClick={onCancel} disabled={busy}>
						Cancel
					</button>
					<button
						className="btn !text-xs !font-semibold"
						style={{ background: confirmColor, color: "white" }}
						onClick={onConfirm}
						disabled={busy}
					>
						{busy ? "Processing…" : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}

// ── WorkItem component ─────────────────────────────────────────

export default function WorkItem({
	item,
	onBack,
	onUpdate,
}: {
	item: WorkItemData;
	onBack: () => void;
	onUpdate?: (patch: Partial<WorkItemData>) => void;
}) {
	const { toast } = useApp();
	const [acting, setActing] = useState<string | null>(null);
	const [showReply, setShowReply] = useState(false);
	const [replyText, setReplyText] = useState("");
	const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
	const [assignTo, setAssignTo] = useState("");
	const [showAssign, setShowAssign] = useState(false);
	const [confirmAction, setConfirmAction] = useState<{ action: string; label: string; color: string; message: string } | null>(null);

	// Load activity timeline
	useEffect(() => {
		let active = true;
		const load = async () => {
			try {
				const r = await api.get<{ events?: TimelineEvent[] }>(
					`/api/reports?action=timeline&id=${item.id}`,
				);
				if (active) setTimeline(r?.events ?? []);
			} catch {
				// Timeline is best-effort
			}
		};
		void load();
		return () => {
			active = false;
		};
	}, [item.id]);

	const executeAction = useCallback(
		async (action: string, body: Record<string, unknown> = {}) => {
			setActing(action);
			try {
				const r = await api.post<{ ok?: boolean; error?: string }>(
					"/api/reports",
					{ action, id: item.id, ...body },
				);
				if (r.ok === false) {
					toast(r.error || `${action} failed`, "err");
					return;
				}
				const newStatus =
					action === "resolve" || action === "solve"
						? "solved"
						: action === "verify"
							? "verified"
							: action === "dismiss"
								? "dismissed"
								: action === "escalate"
									? "escalated"
									: action === "review"
										? "reviewed"
										: item.status;
				if (onUpdate) onUpdate({ status: newStatus });
				toast(`${action} completed`, "ok");
				// Reload timeline
				try {
					const tl = await api.get<{ events?: TimelineEvent[] }>(
						`/api/reports?action=timeline&id=${item.id}`,
					);
					setTimeline(tl?.events ?? []);
				} catch {
					/* best-effort */
				}
			} catch (e: unknown) {
				toast(
					e instanceof Error ? e.message : `${action} failed`,
					"err",
				);
			}
			setActing(null);
			setConfirmAction(null);
		},
		[item.id, item.status, onUpdate, toast],
	);

	const sendReply = useCallback(async () => {
		if (!replyText.trim()) return;
		setActing("reply");
		try {
			await api.post("/api/reports", {
				action: "reply",
				id: item.id,
				reply: replyText.trim(),
			});
			setReplyText("");
			setShowReply(false);
			toast("Reply sent", "ok");
			if (onUpdate) onUpdate({ admin_reply: replyText.trim() });
		} catch (e: unknown) {
			toast(
				e instanceof Error ? e.message : "Reply failed",
				"err",
			);
		}
		setActing(null);
	}, [replyText, item.id, onUpdate, toast]);

	const handleDestructiveAction = useCallback(
		(action: string, label: string, color: string, message: string) => {
			setConfirmAction({ action, label, color, message });
		},
		[],
	);

	const currentIdx = statusIndex(item.status);
	const isAlternate = ALTERNATE_STATES.includes(item.status);
	const pStyle = PRIORITY_STYLE[item.priority || "medium"] ?? PRIORITY_STYLE.medium!;

	return (
		<div className="space-y-0">
			{/* ── Confirmation dialog ──────────────────────────── */}
			{confirmAction && (
				<ConfirmDialog
					title={`${confirmAction.label}?`}
					message={confirmAction.message}
					confirmLabel={confirmAction.label}
					confirmColor={confirmAction.color}
					onConfirm={() => executeAction(confirmAction.action)}
					onCancel={() => setConfirmAction(null)}
					busy={acting === confirmAction.action}
				/>
			)}

			{/* ── Header bar ──────────────────────────────────── */}
			<div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b border-border bg-surface">
				<div className="flex items-center gap-2 sm:gap-3 min-w-0">
					<button
						onClick={onBack}
						className="btn btn-ghost !p-2 !rounded-lg shrink-0"
						aria-label="Back to list"
					>
						<ArrowLeft size={16} />
					</button>
					{/* min-w-0 lets the title shrink instead of forcing the header wider
					    than the viewport, which is what pushed the card off-screen at
					    320px. */}
					<div className="min-w-0">
						<div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
							<h2 className="text-sm font-bold text-ink truncate">
								{item.type.toUpperCase()} #{String(item.id).slice(0, 12)}
							</h2>
							{item.priority && item.priority !== "medium" && (
								<span
									className="chip !text-[9px] !py-0.5 !px-1.5"
									style={{
										background: pStyle.bg,
										color: pStyle.text,
										borderColor: pStyle.border,
									}}
								>
									{pStyle.label}
								</span>
							)}
						</div>
						<p className="text-[10px] text-ink3 font-mono truncate">
							{item.category && <>{item.category} · </>}
							{timeAgo(item.created_at)}
						</p>
					</div>
				</div>
			</div>

			{/* ── Status progress bar ─────────────────────────── */}
			{!isAlternate && (
				<div className="py-3 border-b border-border bg-surface2/50">
					{/* The stepper is wider than a 320px viewport, so it scrolls
					    horizontally rather than pushing the card wide. Edge padding
					    keeps the first and last pill fully visible while scrolling. */}
					<div className="flex items-center gap-0 overflow-x-auto min-w-0 px-3 sm:px-4 no-scrollbar">
						{STATUS_FLOW.filter((s, i, arr) => {
							// Deduplicate: if both "pending" and "reported" exist, only show one at index 0
							if (i > 0 && s.key === "reported" && arr[i - 1]?.key === "pending") return false;
							return true;
						}).map((s, i, filtered) => {
							const adjustedIdx = s.key === "reported" && currentIdx === 0 ? 0 : currentIdx;
							const reached = i <= adjustedIdx;
							const isCurrent = i === adjustedIdx;
							const Icon = s.icon;
							return (
								<div key={s.key} className="flex items-center">
									<div
										className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-bold tracking-wider whitespace-nowrap transition-colors ${
											isCurrent
												? "text-white"
												: reached
													? "bg-accent/10 text-accent"
													: "text-ink3"
										}`}
										style={isCurrent ? { background: s.color } : undefined}
									>
										<Icon size={10} />
										{s.label}
									</div>
									{i < filtered.length - 1 && (
										<div
											className={`w-6 h-px mx-1 ${
												i < adjustedIdx
													? "bg-accent"
													: "bg-border"
											}`}
										/>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* ── Alternate state badge ───────────────────────── */}
			{isAlternate && (
				<div className="px-4 py-2 border-b border-border bg-surface2/50">
					<span
						className={`chip !text-[10px] ${
							item.status === "dismissed"
								? "!bg-surface2 !text-ink3"
								: item.status === "escalated"
									? "!bg-violet-500/10 !text-violet-500"
									: "!bg-warn/10 !text-warn"
						}`}
					>
						{item.status.toUpperCase()}
					</span>
				</div>
			)}

			{/* ── Main two-column content ─────────────────────── */}
			{/* minmax(0,1fr) + min-w-0: without these a grid child defaults to
			    min-width:auto, so one long unbroken token in the report text
			    widens the whole column past the viewport. */}
			{/* minmax(0,1fr) + min-w-0: a grid child defaults to min-width:auto,
			    so one long unbroken token in the report text would widen the
			    column past its track and overflow the page at lg and up. */}
			<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] min-h-0">
				{/* Left: content + timeline */}
				<div className="divide-y divide-border min-w-0">
					{/* Report details */}
					<div className="p-4">
						<h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink3 mb-3">
							{item.type === "report"
								? "REPORT DETAILS"
								: item.type === "suggestion"
									? "SUGGESTION DETAILS"
									: item.type === "poll"
										? "POLL DETAILS"
										: "COMMENT DETAILS"}
						</h3>
						<div className="rounded-xl border border-border bg-surface2/30 p-3 sm:p-4">
							<p className="text-sm text-ink leading-relaxed whitespace-pre-wrap break-words">
								{item.content || item.title}
							</p>
						</div>
						{item.details && (
							<div className="mt-3 text-[11px] text-ink2">
								<span className="font-semibold">Additional details: </span>
								{item.details}
							</div>
						)}
						<div className="flex flex-wrap gap-4 mt-3 text-[11px] text-ink3">
							<span>
								Category:{" "}
								<span className="font-semibold text-ink2">
									{item.category || "Uncategorized"}
								</span>
							</span>
							<span>
								Submitted: <span className="font-semibold text-ink2">{timeAgo(item.created_at)}</span>
							</span>
							<span>
								Reference: <span className="font-mono text-ink2">#{String(item.id).slice(0, 12)}</span>
							</span>
							{item.author_id && (
								<span>
									Reported by: <span className="font-mono text-ink2">{item.author_id.slice(0, 12)}…</span>
								</span>
							)}
						</div>
					</div>

					{/* Related content + reporter context — the two things that
	   make a report actionable: what was reported, and who reports. */}
	{(item.related || item.reporterStats) && (
		<div className="p-4">
			<h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink3 mb-3">
				RELATED CONTENT
			</h3>
			{item.related?.postId ? (
				<PostPreview targetId={item.related.postId} />
			) : item.related?.kind === "inbox" ? (
				<button type="button" onClick={() => window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: "inbox" }))} className="btn btn-soft !text-xs">
					Open in inbox <ArrowUpRight size={12} aria-hidden />
				</button>
			) : item.related?.url ? (
				<a href={item.related.url} className="btn btn-soft !text-xs">
					{item.related.label} <ArrowUpRight size={12} aria-hidden />
				</a>
			) : null}
			{item.reporterStats && (
				<div className="mt-3 rounded-xl border border-border bg-surface2/30 p-3 text-[11px] text-ink2">
					<span className="font-semibold">Reporter context: </span>
					{item.reporterStats.filed} report{item.reporterStats.filed === 1 ? "" : "s"} filed
					{item.reporterStats.upheld > 0 ? ` · ${item.reporterStats.upheld} upheld` : " · none upheld yet"}
				</div>
			)}
		</div>
	)}
	{/* Enforcement info (strikes/suspension) */}
					{item.enforcement && (item.enforcement.strike_applied || item.enforcement.strikes > 0 || item.enforcement.suspended || item.enforcement.banned) && (
						<div className="p-4">
							<h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink3 mb-3">
								ENFORCEMENT
							</h3>
							<div className="rounded-xl border border-border bg-surface2/30 p-3 space-y-2">
								<div className="flex flex-wrap gap-3 text-[11px]">
									{item.enforcement.strikes > 0 && (
										<span className="flex items-center gap-1.5 text-warn">
											<AlertTriangle size={12} />
											{item.enforcement.strikes} strike{item.enforcement.strikes === 1 ? "" : "s"}
										</span>
									)}
									{item.enforcement.suspended && (
										<span className="flex items-center gap-1.5 text-bad">
											<EyeOff size={12} />
											Suspended
										</span>
									)}
									{item.enforcement.banned && (
										<span className="flex items-center gap-1.5 text-bad font-semibold">
											<Ban size={12} />
											Banned
										</span>
									)}
									{item.enforcement.strike_applied && (
										<span className="flex items-center gap-1.5 text-warn">
											<AlertTriangle size={12} />
											Strike applied on this report
										</span>
									)}
								</div>
							</div>
						</div>
					)}

					{/* Official reply (if exists) */}
					{item.admin_reply && (
						<div className="p-4">
							<h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink3 mb-3">
								OFFICIAL REPLY
							</h3>
							<div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
								<p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
									{item.admin_reply}
								</p>
							</div>
						</div>
					)}

					{/* Activity timeline */}
					<div className="p-4">
						<h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink3 mb-3">
							ACTIVITY
						</h3>
						{timeline.length === 0 ? (
							<div className="text-[11px] text-ink3 py-2 italic">
								No activity recorded yet.
							</div>
						) : (
							<div className="space-y-3 pl-4 border-l-2 border-border">
								{timeline.map((ev, i) => (
									<div key={ev.id || i} className="relative">
										<span
											className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-surface"
											style={{
												background:
													ev.action.toLowerCase().includes("solved") || ev.action.toLowerCase().includes("resolved")
														? "#16a06a"
														: ev.action.toLowerCase().includes("verified") || ev.action.toLowerCase().includes("reviewed")
															? "#3b82f6"
															: ev.action.toLowerCase().includes("dismissed")
																? "#6b7280"
																: ev.action.toLowerCase().includes("escalated")
																	? "#a855f7"
																	: ev.action.toLowerCase().includes("reply")
																		? "#d98a0b"
																		: "var(--vb-accent)",
											}}
										/>
										<p className="text-xs text-ink font-medium">{ev.action}</p>
										{ev.detail && (
											<p className="text-[11px] text-ink2 mt-0.5">{ev.detail}</p>
										)}
										<p className="text-[10px] text-ink3 mt-0.5 font-mono">
											{ev.actor && <>{ev.actor} · </>}
											{timeAgo(ev.created_at)}
										</p>
									</div>
								))}
							</div>
						)}
					</div>
				</div>

				{/* Right: action rail. Stacked below the content on mobile, so the
				    divider belongs on top rather than on the left edge. */}
				<div className="min-w-0 border-t lg:border-t-0 lg:border-l border-border bg-surface2/30 p-3 sm:p-4 space-y-4">
					{/* Status card — prominent per wireframe */}
					<div
						className="rounded-xl border p-3"
						style={{
							borderColor: statusColor(item.status) + "40",
							background: statusColor(item.status) + "08",
						}}
					>
						<h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink3 mb-2">
							STATUS
						</h3>
						<div className="flex items-center gap-2">
							<span
								className="w-2.5 h-2.5 rounded-full"
								style={{ background: statusColor(item.status) }}
							/>
							<span className="text-xs font-bold text-ink">
								{STATUS_META[item.status]?.label || item.status.charAt(0).toUpperCase() + item.status.slice(1)}
							</span>
						</div>
						{item.assigned_to && (
							<p className="text-[10px] text-ink3 mt-1.5">
								Assigned to: <span className="font-mono text-ink2">{item.assigned_to.slice(0, 12)}</span>
							</p>
						)}
					</div>

					{/* Actions */}
					<div>
						<h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink3 mb-2">
							ACTIONS
						</h3>
						<div className="space-y-1.5">
							{item.status !== "solved" && item.status !== "dismissed" && (
								<button
									className="btn btn-soft !w-full !justify-start !text-xs !py-2"
									onClick={() =>
										handleDestructiveAction(
											"resolve",
											"Solve",
											"#16a06a",
											"Mark this report as solved. The reporter will be notified.",
										)
									}
									disabled={acting === "resolve"}
								>
									<CheckCircle2 size={13} />
									{acting === "resolve" ? "Solving…" : "Solve"}
								</button>
							)}
							{item.status === "reported" || item.status === "pending" ? (
								<button
									className="btn btn-ghost !w-full !justify-start !text-xs !py-2"
									onClick={() => executeAction("verify")}
									disabled={acting === "verify"}
								>
									<Shield size={13} />
									{acting === "verify" ? "Verifying…" : "Verify"}
								</button>
							) : null}
							{![ "solved", "dismissed", "escalated"].includes(item.status) && (
								<>
									<button
										className="btn btn-ghost !w-full !justify-start !text-xs !py-2"
										onClick={() => setShowAssign(!showAssign)}
									>
										<UserPlus size={13} />
										Assign
									</button>
									{showAssign && (
										<div className="flex gap-1">
											<input
												className="input !text-xs !py-1.5 flex-1"
												placeholder="admin id…"
												value={assignTo}
												onChange={(e) => setAssignTo(e.target.value)}
											/>
											<button
												className="btn btn-soft !text-xs !py-1.5"
												onClick={() => {
													if (assignTo.trim()) {
														executeAction("assign", {
															assigned_to: assignTo.trim(),
														});
														setShowAssign(false);
														setAssignTo("");
													}
												}}
												disabled={!assignTo.trim()}
											>
												OK
											</button>
										</div>
									)}
								</>
							)}
							{![ "solved", "dismissed", "escalated"].includes(item.status) && (
								<button
									className="btn btn-ghost !w-full !justify-start !text-xs !py-2"
									onClick={() =>
										handleDestructiveAction(
											"escalate",
											"Escalate",
											"#a855f7",
											"Escalate this report to higher-level review. This cannot be undone.",
										)
									}
									disabled={acting === "escalate"}
								>
									<ArrowUpRight size={13} />
									{acting === "escalate" ? "Escalating…" : "Escalate"}
								</button>
							)}
							{![ "solved", "dismissed"].includes(item.status) && (
								<button
									className="btn btn-ghost !w-full !justify-start !text-xs !py-2 text-ink3"
									onClick={() =>
										handleDestructiveAction(
											"dismiss",
											"Dismiss",
											"#6b7280",
											"Dismiss this report. It will be marked as dismissed and removed from the active queue.",
										)
									}
									disabled={acting === "dismiss"}
								>
									<Trash2 size={13} />
									{acting === "dismiss" ? "Dismissing…" : "Dismiss"}
								</button>
							)}
						</div>
					</div>

					{/* Official reply (collapsible) */}
					{![ "solved", "dismissed"].includes(item.status) && (
						<div>
							<h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink3 mb-2">
								OFFICIAL REPLY
							</h3>
							{showReply ? (
								<div className="space-y-2">
									<textarea
										className="input !text-xs min-h-20"
										placeholder="Enter your message…"
										value={replyText}
										onChange={(e) => setReplyText(e.target.value)}
									/>
									<div className="flex gap-1.5">
										<button
											className="btn btn-primary !text-xs !py-1.5 flex-1"
											onClick={sendReply}
											disabled={!replyText.trim() || acting === "reply"}
										>
											<MessageSquare size={11} />
											{acting === "reply" ? "Sending…" : "Send reply"}
										</button>
										<button
											className="btn btn-ghost !text-xs !py-1.5"
											onClick={() => {
												setShowReply(false);
												setReplyText("");
											}}
										>
											Cancel
										</button>
									</div>
								</div>
							) : (
								<button
									className="btn btn-ghost !w-full !text-xs !py-2"
									onClick={() => setShowReply(true)}
								>
									<MessageSquare size={13} />
									Write a reply…
								</button>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
