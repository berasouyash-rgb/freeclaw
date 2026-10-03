import {
	ArrowUpRight,
	BarChart3,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	Eye,
	EyeOff,
	Flag,
	Gavel,
	Image as ImageIcon,
	Inbox,
	Lock,
	MessageSquare,
	RefreshCcw,
	Scale,
	Search,
	Shield,
	ShieldCheck,
	ShieldX,
	Tag,
	Trash2,
	Unlock,
	User,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import UpdateNotice from "../../components/admin/UpdateNotice";
import { useUpdateSignal } from "../../hooks/useUpdateSignal";
import PostPreviewCard from "../../components/PostPreviewCard";
import WorkItem from "../../components/admin/WorkItem";
import type { WorkItemData } from "../../components/admin/WorkItem";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { groupReports } from "../../lib/report-groups";
import { useRealtime } from "../../lib/useRealtime";
import { CAT_EMOJI, CATEGORIES, timeAgo } from "../../lib/utils";

/* ═══════════════════════════════════════════════════════════════
   REPORTS & CONTENT REVIEW — the classic Report queue desk with
   Content Review + Approval Center merged into ONE page.

   Tabs (all REAL backend data — nothing simulated):
     • Reports     — /api/reports          (ALL reports in one queue — open
                                             rows first with a Pending chip,
                                             resolved rows after with a
                                             Resolved chip; moderate author,
                                             resolve, escalate → approval)
     • AI Review   — /api/posts?all=1      (AI-flagged / pending_review posts,
                                             search + status filter + expandable
                                             detail with comments & screenshots;
                                             also pre-publish /api/pre-review
                                             blocked submissions: publish /
                                             reject / keep private / ban)
     • Approvals   — /api/workforce        (pending-approvals: approve-task /
                                             reject-task — the REAL workforce
                                             approval pipeline)
   ═══════════════════════════════════════════════════════════════ */

interface ReportRow {
	id: number;
	target_id: string;
	target_type: "post" | "comment" | "poll" | "inbox" | string;
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
	/** The autonomous worker's own audit evidence for this report, joined on
	 *  by /api/reports from activity_logs — present only where a worker acted.
	 *  This is how the queue proves AI work instead of a status flip. */
	worker_action?: {
		worker: string;
		action: string;
		disposition: string | null;
		enforced: boolean;
		evidence: string | null;
		target: string | null;
		at: string;
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

interface AppealItem {
	id: string;
	surface: string;
	author_id: string;
	title: string;
	body: string;
	reason: string;
	flags: string[];
	status: string;
	created_at: string;
	review_note?: string;
}

type Tab = "reports" | "review" | "approvals";

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

/* ── Appeal review item (blocked-author recourse queue) ─────────── */
function AppealReview({
	item,
	onAction,
	busy,
}: {
	item: AppealItem;
	onAction: (id: string, decision: "uphold" | "overturn", note: string) => void;
	busy: boolean;
}) {
	const [note, setNote] = useState("");
	return (
		<div
			className="glass-card rounded-xl overflow-hidden"
			style={{ borderColor: "rgba(86,82,214,0.25)" }}
		>
			<div className="p-4 flex items-start gap-3 border-b border-border bg-accent/5">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 mb-1">
						<span
							className="chip !text-[9px] !py-0.5"
							style={{
								color: "var(--vb-accent)",
								borderColor: "rgba(86,82,214,0.3)",
							}}
						>
							<Scale size={9} /> appeal · {item.surface}
						</span>
						<span className="chip !text-[9px] !py-0.5">{item.status}</span>
						{(item.flags || []).length > 0 && (
							<span className="chip !text-[9px] !py-0.5">
								{item.flags.join(", ")}
							</span>
						)}
					</div>
					{item.title && (
						<p className="text-sm font-semibold leading-snug mt-0.5">
							{item.title}
						</p>
					)}
					{item.body && (
						<p className="text-xs text-ink2 mt-0.5 line-clamp-3">{item.body}</p>
					)}
					{item.reason && (
						<p className="text-[11px] text-ink2 mt-1">
							<span className="font-semibold">Author&apos;s case:</span> {item.reason}
						</p>
					)}
					<p className="text-[11px] text-ink3 mt-1 font-mono">
						{item.author_id.slice(0, 10)}… ·{" "}
						{item.created_at ? timeAgo(item.created_at) : "unknown"}
					</p>
				</div>
			</div>
			<div className="p-4 flex flex-col gap-2">
				<input
					className="input !py-2 !text-xs"
					placeholder="Decision note (optional, sent to the author)"
					value={note}
					onChange={(e) => setNote(e.target.value)}
					maxLength={500}
					aria-label="Appeal decision note"
				/>
				<div className="flex gap-2">
					<button
						className="btn btn-ghost !text-xs"
						disabled={busy}
						onClick={() => onAction(item.id, "uphold", note)}
					>
						Uphold block
					</button>
					<button
						className="btn btn-primary !text-xs"
						disabled={busy}
						onClick={() => onAction(item.id, "overturn", note)}
					>
						{busy ? "Publishing…" : "Overturn & publish"}
					</button>
				</div>
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
			className="glass-card rounded-xl overflow-hidden"
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
/* ══════════════════════════════════════════════════════════════════
   AI WORK EVIDENCE
   ──────────────────────────────────────────────────────────────────
   The reports queue used to be a list of rows with a `status`. A row
   reading "resolved" proved only that something set a column — not that
   anyone removed the content, and not that anyone checked (spec §0).

   These surfaces render the WORKFORCE's own audit trail instead: which
   worker acted, what disposition it chose, whether it actually enforced
   removal, and the observation it decided on. The data comes from
   activity_logs (the worker writes it at action time) joined by
   /api/reports — never from a worker narrative generated at render time.
   ══════════════════════════════════════════════════════════════════ */

const DISPOSITION_META: Record<
	string,
	{ label: string; color: string; icon: string }
> = {
	enforced: {
		label: "Violation removed",
		color: "#dc4b4b",
		icon: "🚫",
	},
	already_handled: {
		label: "Already handled",
		color: "#16a06a",
		icon: "✅",
	},
	no_violation: {
		label: "No live violation",
		color: "#8b93a7",
		icon: "🔍",
	},
};

function WorkerEvidence({ r }: { r: ReportRow }) {
	const ev = r.worker_action;
	if (!ev) return null;
	const meta = DISPOSITION_META[ev.disposition || ""] || {
		label: ev.disposition || ev.action,
		color: "var(--vb-accent)",
		icon: "•",
	};
	return (
		<div
			className="px-4 pb-3 pt-2 border-t border-border"
			style={{ background: "rgba(86,82,214,0.04)" }}
		>
			<div className="flex items-center gap-2 flex-wrap mb-1">
				<span
					className="chip !text-[9px] !py-0.5"
					style={{
						color: "var(--vb-accent)",
						borderColor: "rgba(86,82,214,0.35)",
					}}
					title="Which automated worker recorded this action"
				>
					Worker: {ev.worker}
				</span>
				<span
					className="chip !text-[9px] !py-0.5"
					style={{ color: meta.color, borderColor: `${meta.color}55` }}
				>
					{meta.icon} {meta.label}
				</span>
				{ev.enforced && (
					<span className="chip !text-[9px] !py-0.5 !bg-bad/10 !text-bad">
						✓ removal re-read verified
					</span>
				)}
				<span className="text-[10px] text-ink3 ml-auto">
					{ev.at ? timeAgo(ev.at) : ""}
				</span>
				</div>
			<div className="text-[11px] text-ink3 leading-relaxed">
				{ev.evidence ? (
					<>
						<span className="font-semibold text-ink2">Evidence: </span>
						<span className="font-mono">{ev.evidence}</span>
					</>
				) : (
					<span className="italic opacity-70">
						No observation recorded on this action.
					</span>
				)}
				{ev.target && (
					<span className="block mt-0.5">
						<span className="font-semibold text-ink2">Target: </span>
						<span className="font-mono">{ev.target}</span>
					</span>
				)}
			</div>
		</div>
	);
}

/**
 * Headline strip for the Open tab: how much of this queue the workforce has
 * already resolved, and how many it could not — the numbers come from the
 * rows' joined worker evidence, not from a separate counter that could drift.
 */
function WorkerLedger({
	rows,
	handled,
}: {
	rows: ReportRow[];
	handled: ReportRow[];
}) {
	const enforced = handled.filter((r) => r.worker_action?.enforced).length;
	const reopened = handled.filter(
		(r) => r.worker_action?.action === "false_resolution_reopened",
	).length;
	const open = rows.length;

	if (!handled.length && !open) return null;

	return (
		<div className="card p-3.5 mb-3" style={{ background: "rgba(86,82,214,0.05)" }}>
			<div className="flex items-center gap-2 flex-wrap">
				<span className="text-xs font-semibold text-ink2">
					Worker ledger
				</span>
				<span className="text-[11px] text-ink3">
					{open} awaiting you
				</span>
				<span className="text-[11px] text-ink3">·</span>
				<span className="text-[11px] text-ink3">
					{handled.length} dispositioned by AI
				</span>
				{enforced > 0 && (
					<>
						<span className="text-[11px] text-ink3">·</span>
						<span className="text-[11px]" style={{ color: "#dc4b4b" }}>
							{enforced} removed
						</span>
					</>
				)}
				{reopened > 0 && (
					<>
						<span className="text-[11px] text-ink3">·</span>
						<span className="text-[11px]" style={{ color: "#d98a0b" }}>
							{reopened} false resolution(s) corrected
						</span>
					</>
				)}
			</div>
			<p className="text-[10px] text-ink3 mt-1">
				Evidence is the worker's own audit trail, re-read from the target —
				not a self-report.
			</p>
		</div>
	);
}

// ── Report target chip: comments read as comments, posts as posts ──
// Each target type gets its own color, and the chip links to the valid
// page for that object (post → detail, comment → parent post, poll →
// polls, inbox → inbox tab). A comment whose parent post is unknown
// renders plain text — never a dead link.
const TARGET_TYPE_STYLE: Record<string, { color: string; border: string; label: string }> = {
	post: { color: "var(--vb-accent)", border: "color-mix(in srgb, var(--vb-accent) 35%, transparent)", label: "Post" },
	comment: { color: "var(--vb-warn)", border: "rgba(220,170,50,0.35)", label: "Comment" },
	poll: { color: "#8b5cf6", border: "rgba(139,92,246,0.35)", label: "Poll" },
	inbox: { color: "#38bdf8", border: "rgba(56,189,248,0.35)", label: "Inbox" },
	community_post: { color: "#2dd4bf", border: "rgba(45,212,191,0.35)", label: "Community" },
};
function TargetTypeIcon({ type }: { type: string }) {
	switch (type) {
		case "post":
			return <Flag size={12} aria-hidden />;
		case "comment":
			return <MessageSquare size={12} aria-hidden />;
		case "poll":
			return <BarChart3 size={12} aria-hidden />;
		case "inbox":
			return <span aria-hidden>📥</span>;
		case "community_post":
			return <Users size={12} aria-hidden />;
		default:
			return <Flag size={12} aria-hidden />;
	}
}
function TargetTypeChip({ type, targetId, postId }: { type: string; targetId: string; postId?: string | null }) {	const style = TARGET_TYPE_STYLE[type] ?? { color: "var(--vb-ink3)", border: "var(--vb-border)", label: type };
	const cls = "chip !text-[9px] !py-0.5 inline-flex items-center gap-1";
	const inner = (<><TargetTypeIcon type={type} /> {style.label}</>);
	if (type === "post") {
		return <a className={cls} style={{ color: style.color, borderColor: style.border }} href={`/post/${targetId}`} title="Open reported post" aria-label={`Open reported post ${targetId}`}>{inner}</a>;
	}
	if (type === "comment" && postId) {
		return <a className={cls} style={{ color: style.color, borderColor: style.border }} href={`/post/${postId}`} title="Open parent post" aria-label={`Open parent post of comment ${targetId}`}>{inner}</a>;
	}
	if (type === "poll") {
		return <a className={cls} style={{ color: style.color, borderColor: style.border }} href="/polls" title="Open polls" aria-label="Open polls">{inner}</a>;
	}
	if (type === "inbox") {
		return <button type="button" className={cls} style={{ color: style.color, borderColor: style.border }} title="Open inbox" aria-label="Open inbox" onClick={() => window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: "inbox" }))}>{inner}</button>;
	}
	// Communities file reports as `slug` (whole community) or
	// `slug::postId` (one post). Both land on the community page, which is
	// the only valid page for that content — never a dead link.
	if (type === "community_post") {
		const slug = String(targetId || "").split("::")[0];
		if (!slug) return <span className={cls} style={{ color: style.color, borderColor: style.border }}>{inner}</span>;
		return <a className={cls} style={{ color: style.color, borderColor: style.border }} href={`/communities/${slug}`} title="Open reported community" aria-label={`Open reported community ${slug}`}>{inner}</a>;
	}
	return <span className={cls} style={{ color: style.color, borderColor: style.border }}>{inner}</span>;
}

// ── Report context helpers: reporter reliability + related-content link ──
// Both derive from already-loaded rows — no new fetch. Reporter stats count
// this reporter's filings and upheld outcomes (resolved/verified/solved);
// related resolves each target type to its one valid page, mirroring the
// chip rules above (unknown comment parents → null, never a dead link).
const UPHELD_STATUSES = new Set(["resolved", "verified", "solved", "auto_resolved"]);
function reporterStatsFor(all: ReportRow[], authorId: string): { filed: number; upheld: number } | null {
	if (!authorId) return null;
	const mine = all.filter((r) => r.author_id === authorId);
	if (mine.length === 0) return null;
	return {
		filed: mine.length,
		upheld: mine.filter((r) => UPHELD_STATUSES.has(String(r.status || ""))).length,
	};
}
function relatedFor(
	r: ReportRow,
	commentPostId?: string | null,
): WorkItemData["related"] {
	switch (r.target_type) {
		case "post":
			return { kind: "post", url: `/post/${r.target_id}`, label: "Open reported post", postId: r.target_id };
		case "comment":
			return commentPostId
				? { kind: "post", url: `/post/${commentPostId}`, label: "Open parent post", postId: commentPostId }
				: null;
		case "poll":
			return { kind: "poll", url: "/polls", label: "Open polls" };
		case "inbox":
			return { kind: "inbox", label: "Open in inbox" };
		case "community_post": {
			const slug = String(r.target_id || "").split("::")[0];
			return slug
				? { kind: "community", url: `/communities/${slug}`, label: "Open community" }
				: null;
		}
		default:
			return null;
	}
}
export default function Reports() {
	const { toast } = useApp();
	const [tab, setTab] = useState<Tab>("reports");

	// ── Data ──────────────────────────────────────────────────────
	const [reports, setReports] = useState<ReportRow[]>([]);
	const [preReviews, setPreReviews] = useState<PreReviewItem[]>([]);
	const [appeals, setAppeals] = useState<AppealItem[]>([]);
	const [posts, setPosts] = useState<ReviewPost[]>([]);
	const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
	const [queueError, setQueueError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const {
		updatesAvailable,
		markUpdatesAvailable,
		clearUpdates,
	} = useUpdateSignal();

	// ── Report view state ─────────────────────────────────────────
	const [actingId, setActingId] = useState<number | null>(null);
	const [selectedReport, setSelectedReport] = useState<WorkItemData | null>(null);

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

	useRealtime(
		["reports", "posts", "polls", "poll_votes"],
		markUpdatesAvailable,
		1_000,
	);

	// ── Fast queues (reports / pre-review / approvals) ────────────────
	// These endpoints load once on entry and refresh only through the explicit
	// update controls or an authoritative user action.
	const loadFast = useCallback(async (silent = false) => {
		if (!silent) setLoading(true);
		setQueueError(null);
		try {
			const [reportsData, reviewData, approvalsRes, appealsRes] = await Promise.all([
				api.get<ReportRow[]>("/api/reports").catch((e: unknown) => {
					console.error("[Reports] reports fetch failed", { error: e instanceof Error ? e.message : String(e) });
					setQueueError("Reports failed to load — showing last-known queue. Retry shortly.");
					throw e;
				}),
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
					.catch((e: unknown) => {
						console.error("[Reports] approvals fetch failed", { error: e instanceof Error ? e.message : String(e) });
						return { approvals: [] as ApprovalItem[] };
					}),
				// Author appeals against safety blocks — same reviewer owns them.
				api
					.get<{ items: AppealItem[] }>("/api/appeals?status=open")
					.catch(() => ({ items: [] as AppealItem[] })),
			]);

			setReports(Array.isArray(reportsData) ? reportsData : []);
			setPreReviews(reviewData?.items || []);
			setAppeals(appealsRes?.items || []);
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
	// /api/posts?all=1 scans the whole feed (up to 2000 rows). It runs on
	// mount/manual refresh and at most once per minute when the AI Review desk
	// is active; realtime changes only mark the update badge.
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
				.catch((e: unknown) => {
					console.error("[Reports] posts scan failed", { error: e instanceof Error ? e.message : String(e) });
					throw e;
				});
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
	const refreshAll = useCallback(async () => {
		setRefreshing(true);
		try {
			await Promise.all([loadFast(true), loadPosts(true)]);
			clearUpdates();
		} finally {
			setRefreshing(false);
		}
	}, [clearUpdates, loadFast, loadPosts]);

	useEffect(() => {
		load();
	}, [load]);

	// Reports are refreshed explicitly through the page's refresh control and
	// user actions; a quiet moderation queue does not continuously refetch.
	// Entering the AI Review desk triggers a (throttled) fresh posts scan.
	useEffect(() => {
		if (tab === "review") void loadPosts();
	}, [tab, loadPosts]);

	// ── Report actions ────────────────────────────────────────────
	// Resolve returns the backend's verification (spec §23): the toast
	// says WHAT was verified, not just "Resolved".
	const resolve = async (id: number) => {
		setBusy(`resolve:${id}`);
		try {
			const r = await api.put<{
				verification?: { verified?: boolean; detail?: string };
			}>("/api/reports", { id, status: "resolved" });
			const v = r.verification;
			toast(
				v?.detail ? `Resolved — ${v.detail}` : "Resolved",
				v && v.verified === false ? "err" : "ok",
			);
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Action failed", "err");
		}
		setBusy(null);
	};

	// Resolve a whole root issue (spec §24): every member report goes through
	// the same verified PUT as a single resolve, so each keeps its own
	// verification; the toast reports the honest total, never a fake bulk OK.
	const resolveGroup = async (key: string, ids: Array<number | string>) => {
		setBusy(`resolve-group:${key}`);
		let ok = 0;
		let failed = 0;
		for (const id of ids) {
			try {
				await api.put("/api/reports", { id, status: "resolved" });
				ok++;
			} catch {
				failed++;
			}
		}
		toast(
			failed === 0
				? `Resolved root issue — ${ok} report(s) verified`
				: `Resolved ${ok}, ${failed} failed — re-check the remainder`,
			failed === 0 ? "ok" : "err",
		);
		load();
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

	// -- Comment lock/unlock honesty --
	// Unlock renders only when the comment index proves hidden. Deleted
	// rows show Removed, missing rows show Target not found, visible rows
	// show nothing. One lazy index fetch covers every comment-target row.
	const [commentStates, setCommentStates] = useState<
		Record<string, { hidden?: boolean; deleted?: boolean; postId?: string }>
	>({});
	const [commentIndexReady, setCommentIndexReady] = useState(false);
	const commentIndexFlight = useRef<Promise<void> | null>(null);

	useEffect(() => {
		const seen: Record<string, boolean> = {};
		const ids: string[] = [];
		for (const r of reports) {
			if (r.target_type !== "comment") continue;
			const id = String(r.target_id);
			if (!seen[id]) { seen[id] = true; ids.push(id); }
		}
		const missing = ids.filter((id) => commentStates[id] === undefined);
		if (missing.length === 0 || commentIndexFlight.current) return;
		commentIndexFlight.current = (async () => {
			try {
				const list = await api.get<
					Array<{ id?: string; hidden?: boolean; deleted?: boolean; post_id?: string }>
				>("/api/comments?all=1");
				if (!Array.isArray(list)) return;
				const next: Record<string, { hidden?: boolean; deleted?: boolean; postId?: string }> = { ...commentStates };
				for (const c of list) {
					if (!c || typeof c.id !== "string") continue;
					next[c.id] = { hidden: c.hidden, deleted: c.deleted, postId: c.post_id };
				}
				setCommentStates(next);
				setCommentIndexReady(true);
			} catch {
				// Unknown states: render no unlock affordance rather than guessing.
			} finally {
				commentIndexFlight.current = null;
			}
		})();
		void commentIndexFlight.current;
	}, [reports, commentStates]);

	// Unlock a blocked comment. PUT /api/comments { id, hidden: false }
	// already unhides for admins (api/_comments.js). Re-read after the
	// write and verify before claiming ok.
	const unlockComment = async (targetId: string) => {
		setBusy(`unlock-comment:${targetId}`);
		try {
			await api.put("/api/comments", { id: targetId, hidden: false });
			const list = await api
				.get<Array<{ id: string; hidden?: boolean; deleted?: boolean; post_id?: string }>>(
					"/api/comments?all=1",
				)
				.catch(() => []);
			const found = (Array.isArray(list) ? list : []).find(
				(c) => c.id === targetId,
			);
			const verified: { hidden?: boolean; deleted?: boolean; postId?: string } = {
				hidden: found !== undefined && found.hidden === true,
				deleted: found !== undefined && found.deleted === true,
				postId: found?.post_id,
			};
			setCommentStates((prev) => ({ ...prev, [targetId]: verified }));
			setCommentIndexReady(true);
			if (!found) {
				toast("Target not found — it may already be removed", "err");
				load();
				return;
			}
			if (verified.deleted) {
				toast("Comment is removed, not hidden — nothing to unlock", "err");
				load();
				return;
			}
			if (verified.hidden) {
				toast("Unlock failed — the comment is still hidden", "err");
				return;
			}
			toast("Comment unlocked — visible to everyone again", "ok");
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : String(e), "err");
		} finally {
			setBusy(null);
		}
	};

	const commentRowAction = (r: ReportRow) => {
		if (r.target_type !== "comment") return null;
		const targetId = String(r.target_id);
		if (!commentIndexReady) return null;
		const st = commentStates[targetId];
		if (st === undefined)
			return <span className="text-[11px] text-ink3">Target not found</span>;
		if (st.deleted)
			return <span className="text-[11px] text-ink3">Removed</span>;
		if (!st.hidden) return null;
		return (
			<button
			type="button"
			className="btn btn-soft !text-xs"
			onClick={(e) => {
				e.stopPropagation();
				unlockComment(targetId);
			}}
			disabled={busy === `unlock-comment:${targetId}`}
			aria-label={`Unlock comment ${targetId}`}
			title="Unhide this blocked comment — it becomes visible to everyone again"
			>
			<Unlock size={13} /> Unlock comment
			</button>
		);
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
			// Ban requires explicit confirmation on the server side
			await api.post("/api/pre-review", {
				key,
				action,
				...(action === "ban" ? { confirm: true } : {}),
			});
			toast(
				`Review ${action === "approve" ? "approved & published" : action === "reject" ? "rejected" : `${action}d`}`,
				"ok",
			);
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : String(e), "err");
		}
		setBusy(null);
	};

	// ── Appeal review (uphold the block | overturn and publish) ──────────
	const handleAppealAction = async (id: string, decision: "uphold" | "overturn", note: string) => {
		setBusy(`appeal:${id}`);
		try {
			const r = await api.put<{ status: string; published?: { kind: string; id: string } }>("/api/appeals", {
				id,
				decision,
				note,
			});
			toast(
				decision === "overturn"
					? `Appeal approved — ${r.published?.kind ?? "content"} published`
					: "Appeal reviewed — block stands",
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
			await api.del(`/api/posts?id=${encodeURIComponent(postId)}`, { id: postId });
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
			await api.del(`/api/comments?id=${encodeURIComponent(commentId)}`, { id: commentId });
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
	// Reports the autonomous workforce dispositioned on its own — each carries
	// the audit evidence that justified the decision. Shown ABOVE the hand-
	// moderated queue so AI work is visible instead of vanishing into history.
	const aiHandled = reports
		.filter((r) => r.worker_action)
		.sort((a, b) =>
			String(b.worker_action?.at || "").localeCompare(
				String(a.worker_action?.at || ""),
			),
		);
	// Root issues (spec §24): repeated reports about the SAME target collapse
	// into one decision item with impact — "20 reports" reads as one broken
	// water cooler, not 20 disconnected rows. Singletons stay in the queue.
	const rootIssues = groupReports(openReports);

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

	
	const isInboxUrgent = (r: ReportRow) =>
		r.target_type === "inbox" && r.reason.startsWith("[INBOX-URGENT]");
	const isInboxRow = (r: ReportRow) =>
		r.target_type === "inbox" || r.reason.startsWith("[BACKSTOP-");

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
			key: "reports",
			label: "Reports",
			icon: <Flag size={12} />,
			count: reports.length,
			color: "var(--vb-warn)",
		},
		{
			key: "review",
			label: "Review",
			icon: <Shield size={12} />,
			count: posts.length + preReviews.length + appeals.length,
			color: "var(--vb-accent)",
		},
		{
			key: "approvals",
			label: "Approvals",
			icon: <Gavel size={12} />,
			count: approvals.length,
			color: "#8b5cf6",
		},
	];

	// If a report is selected, show the full WorkItem detail view
	if (selectedReport) {
		return (
			<WorkItem
				item={selectedReport}
				onBack={() => setSelectedReport(null)}
				onUpdate={(patch) => {
					setSelectedReport((prev) => prev ? { ...prev, ...patch } : null);
					setReports((prev) => prev.map((r) =>
						String(r.id) === selectedReport.id ? { ...r, ...patch } as ReportRow : r,
					));
				}}
			/>
			);
	}

	return (
		<div>
			{/* ── Header ─────────────────────────────────────────────── */}
			<div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
				<div>
					<h1 className="flex items-center gap-2 font-display font-bold text-2xl tracking-tight">
						<span className="vb-gradient-text">Report Queue</span>
					</h1>
					<p className="text-xs text-ink3 mt-1">
						Reports → content review (incl. pre-publish gate) → approvals —
						one desk, all real data
					</p>
				</div>
				<button
					className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
					onClick={() => void refreshAll()}
					disabled={refreshing}
				>
					<RefreshCcw
						size={12}
						className={`mr-1 ${refreshing ? "animate-spin" : ""}`}
					/>{" "}
					Refresh
				</button>
			</div>

			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => void refreshAll()}
				refreshing={refreshing}
			/>

			{/* No metric-card wall here on purpose: the tab row directly below
			    already renders each queue's live count, and a second copy of the
			    same number is decoration, not information. */}

			{/* ── Error banner (admin session expiry for review queue) ── */}
			{queueError && (
				<div className="rounded-xl p-3 border-l-4 border-l-warn bg-warn/[0.06] mb-4">
					<p className="text-xs text-yellow-300 font-semibold">
						⚠️ {queueError}
					</p>
				</div>
			)}

			{/* ── Tabs ───────────────────────────────────────────────── */}
			<div className="flex gap-1.5 mb-5 flex-wrap">
				{TAB_META.map((t) => (
					<button
						key={t.key}
						className={`flex items-center gap-1.5 !text-[11px] !font-semibold !px-3 !py-1.5 rounded-lg transition-all ${tab === t.key ? "btn-primary shadow-sm" : "btn-ghost hover:bg-surface2"}`}
						onClick={() => setTab(t.key)}
					>
						{t.icon} {t.label} <span className={`ml-0.5 text-[9px] font-bold ${tab === t.key ? 'opacity-80' : 'opacity-60'}`}>({t.count})</span>
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
					{tab === "reports" && (
						<>
							<WorkerLedger rows={openReports} handled={aiHandled} />

							{/* ── Root issues: repeated reports about the SAME target read
							    as ONE decision with impact (spec §24), not N loose rows. */}
							{rootIssues.length > 0 && (
								<details className="glass-card rounded-xl overflow-hidden" open>
									<summary className="p-3.5 cursor-pointer text-xs font-semibold text-ink2 flex items-center gap-2">
										🔗 Root issues
										<span className="text-[10px] text-ink3 font-normal">
											{rootIssues.length} target(s) reported multiple times —
											resolve the cause, not each row
										</span>
									</summary>
									<div className="divide-y divide-border">
										{rootIssues.slice(0, 15).map((g) => (
											<div key={g.key} className="p-3.5">
												<div className="flex items-center gap-2 flex-wrap">
													<TargetTypeChip type={g.target_type} targetId={g.target_id} postId={g.target_type === "comment" ? commentStates[g.target_id]?.postId : null} />
													<span
														className="chip !text-[9px] !py-0.5"
														style={{
															color: "var(--vb-bad)",
															borderColor: "rgba(220,75,75,0.35)",
														}}
													>
														{g.count} reports · {g.reporters} reporter(s)
													</span>
													{g.urgent && (
														<span
															className="chip !text-[9px] !py-0.5"
															style={{
																color: "#fff",
																background: "rgba(220,75,75,0.85)",
																borderColor: "rgba(220,75,75,1)",
															}}
															role="alert"
														>
															🚨 URGENT
														</span>
													)}
													{g.enforced && (
														<span className="chip !text-[9px] !py-0.5 !bg-bad/10 !text-bad">
															✓ removal re-read verified
														</span>
													)}
													<span className="text-[10px] text-ink3 ml-auto shrink-0">
														{timeAgo(g.latest_at)}
													</span>
												</div>
												<p className="text-sm font-medium mt-1 truncate">
													🚩 {g.reasons[0] || g.target_id}
												</p>
												<p className="text-[11px] text-ink3 mt-0.5 font-mono truncate">
													target: {g.target_id} · first {timeAgo(g.first_at)} · latest{" "}
													{timeAgo(g.latest_at)}
												</p>
												<button
													className="btn btn-soft !text-xs mt-2"
													onClick={() => void resolveGroup(g.key, g.report_ids)}
													disabled={busy === `resolve-group:${g.key}`}
													aria-label={`Resolve root issue ${g.target_id} (${g.count} reports)`}
												>
													<CheckCircle2 size={13} /> Resolve root issue ({g.count})
												</button>
											</div>
										))}
									</div>
								</details>
							)}

							{/* ── Auto-dispositioned: real consequences, with evidence ── */}
							{aiHandled.length > 0 && (
								<details className="glass-card rounded-xl overflow-hidden" open>
									<summary className="p-3.5 cursor-pointer text-xs font-semibold text-ink2 flex items-center gap-2">
										Auto-dispositioned
										<span className="text-[10px] text-ink3 font-normal">
											{aiHandled.length} report(s) closed by an automated worker —
											each row shows the recorded action and its evidence
										</span>
									</summary>
									<div className="divide-y divide-border">
										{aiHandled.slice(0, 25).map((r) => {
											const ev = r.worker_action;
											const meta =
												DISPOSITION_META[ev?.disposition || ""] || {
													label: ev?.disposition || ev?.action || "action",
													color: "var(--vb-accent)",
													icon: "•",
												};
											return (
												<div key={`ai-${r.id}`} className="p-3.5">
													<div className="flex items-center gap-2 flex-wrap">
														<span
															className="chip !text-[9px] !py-0.5"
															style={{
																color: meta.color,
																borderColor: `${meta.color}55`,
															}}
														>
															{meta.icon} {meta.label}
														</span>
														<TargetTypeChip type={r.target_type} targetId={r.target_id} postId={r.target_type === "comment" ? commentStates[r.target_id]?.postId : null} />
														<span className="text-[11px] text-ink3 truncate flex-1 min-w-0">
															🚩 {r.reason}
														</span>
														<span className="text-[10px] text-ink3 shrink-0">
															{ev?.at ? timeAgo(ev.at) : ""}
														</span>
													</div>
													<div className="text-[11px] text-ink3 mt-1">
														<span className="font-semibold text-ink2">
															Evidence:{" "}
														</span>
														<span className="font-mono">
															{ev?.evidence ||
																"no observation recorded"}
														</span>
														{ev?.enforced && (
															<span className="ml-2 text-[10px] text-bad">
																✓ removal re-read verified
															</span>
														)}
													</div>
												</div>
											);
										})}
									</div>
								</details>
							)}

							{reports.length > 0 && (
								<p className="text-[11px] font-semibold text-ink3 uppercase tracking-wider px-1 pt-1">
									All reports — {reports.length}
								</p>
							)}
							{openReports.map((r) => {
									return (
									<div key={r.id} className="glass-card rounded-xl overflow-hidden">
										<div
											className="p-4 flex items-start gap-3 cursor-pointer hover:bg-surface2/30 transition-colors"
											onClick={() => setSelectedReport({
												id: r.id,
												type: "report",
												title: r.reason || "Report",
												content: r.details || r.reason || "No details provided",
												status: r.status || "pending",
												category: String((r as Record<string, unknown>).category || ""),
												priority: String((r as Record<string, unknown>).priority || "medium"),
												author_id: String(r.author_id || ""),
												target_author_id: String(r.target_author_id || ""),
											target_type: r.target_type,
											target_id: r.target_id,
											reporterStats: reporterStatsFor(reports, String(r.author_id || "")),
											related: relatedFor(r, r.target_type === "comment" ? commentStates[r.target_id]?.postId : null),
												created_at: r.created_at,
												assigned_to: String((r as Record<string, unknown>).assigned_to || ""),
												enforcement: (r as Record<string, unknown>).enforcement as WorkItemData["enforcement"],
											})}
										>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2 mb-1 flex-wrap">
													<TargetTypeChip type={r.target_type} targetId={r.target_id} postId={r.target_type === "comment" ? commentStates[r.target_id]?.postId : null} />
												<span
													className="chip !text-[9px] !py-0.5"
													style={{
														color: "var(--vb-warn)",
														borderColor: "rgba(220,170,50,0.3)",
													}}
												>
													Pending
												</span>
												{isInboxUrgent(r) && (
													<span
														className="chip !text-[9px] !py-0.5"
														style={{
															color: "#fff",
															background: "rgba(220,75,75,0.85)",
															borderColor: "rgba(220,75,75,1)",
														}}
														role="alert"
													>
														🚨 URGENT — inbox
													</span>
												)}
												{isInboxRow(r) && !isInboxUrgent(r) && (
													<span
														className="chip !text-[9px] !py-0.5"
														style={{
															color: "var(--vb-accent)",
															borderColor: "rgba(86,82,214,0.3)",
														}}
													>
														{r.target_type === "inbox" ? "📥 inbox" : "🛡 backstop"}
													</span>
												)}
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
											{r.worker_action && (
												<span
													className="chip !text-[9px] !py-0.5"
													style={{
														color: "var(--vb-accent)",
														borderColor: "rgba(86,82,214,0.4)",
													}}
														title="Recorded by an automated worker — expand the row to see its evidence"
													>
														Auto: {r.worker_action.disposition || r.worker_action.action}
														{r.worker_action.enforced ? " · removed" : ""}
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
											{commentRowAction(r)}
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

										{/* What the workforce actually did on this report, from its audit
										    trail — not a status flip. */}
										<WorkerEvidence r={r} />

									</div>
								);
							})}
							{resolvedReports.map((r) => (
								<div key={r.id} className="card p-4 opacity-60 cursor-pointer hover:opacity-100 transition-opacity" onClick={() => setSelectedReport({
									id: r.id,
									type: "report",
									title: r.reason || "Report",
									content: r.details || r.reason || "No details provided",
									status: r.status || "resolved",
									category: String((r as Record<string, unknown>).category || ""),
									priority: String((r as Record<string, unknown>).priority || "medium"),
									author_id: String(r.author_id || ""),
									target_author_id: String(r.target_author_id || ""),
									target_type: r.target_type,
									target_id: r.target_id,
									reporterStats: reporterStatsFor(reports, String(r.author_id || "")),
									related: relatedFor(r, r.target_type === "comment" ? commentStates[r.target_id]?.postId : null),
									created_at: r.created_at,
									enforcement: (r as Record<string, unknown>).enforcement as WorkItemData["enforcement"],
								})}>
									<div className="flex items-start gap-3">
										<CheckCircle2
											size={16}
											className="text-good shrink-0 mt-0.5"
										/>
										<div className="min-w-0 flex-1">
											<span
												className="chip !text-[9px] !py-0.5"
												style={{
													color: "var(--vb-good)",
													borderColor: "rgba(22,160,106,0.35)",
												}}
											>
												Resolved
											</span>
											<p className="text-sm font-medium mt-1">{r.reason}</p>
											<p className="text-[11px] text-ink3 mt-1 font-mono">
												target: {r.target_id} · resolved {timeAgo(r.created_at)}
											</p>
										</div>
									</div>
								</div>
							))}
							{reports.length === 0 && (
								<p className="card p-8 text-center text-sm text-ink3">
									No reports yet.
								</p>
							)}
						</>
					)}

					{/* ══════════ AI REVIEW (Content Review + pre-publish merged) ══════════ */}
					{tab === "review" && (
						<>
							{/* ── Appeals queue (blocked-author recourse) ── */}
{appeals.length > 0 && (
	<div className="mb-3 space-y-3">
		<div className="flex items-center gap-2">
			<Scale size={13} className="text-accent" />
			<p className="text-xs font-semibold text-ink2">
				Author appeals — {appeals.length} blocked 
				{appeals.length === 1 ? "submission" : "submissions"}{" "}
				asking for human review
			</p>
		</div>
		{appeals.map((item) => (
			<AppealReview
				key={item.id}
				item={item}
				busy={busy === `appeal:${item.id}`}
				onAction={handleAppealAction}
			/>
		))}
	</div>
)}
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
										<div key={post.id} className="glass-card rounded-xl overflow-hidden">
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
																		type="button"
																		aria-label="Hide image"
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
										<div key={a.id} className="glass-card rounded-xl overflow-hidden">
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

				</div>
			)}
		</div>
	);
}
