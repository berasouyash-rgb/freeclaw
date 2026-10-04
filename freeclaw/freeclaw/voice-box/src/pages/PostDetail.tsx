import {
	AlertTriangle,
	ArrowLeft,
	Bell,
	BellRing,
	Bookmark,
	CheckCircle2,
	Eye,
	EyeOff,
	FileDown,
	Flag,
	Link2,
	Lock,
	RefreshCw,
	ShieldCheck,
	Sparkles,
	Trash2,
	Volume2,
	VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import Comments from "../components/Comments";
import PollCard from "../components/PollCard";
import { ReactionButton, getReactionMeta } from "../components/PostCard";
import StatusTimeline from "../components/StatusTimeline";
import { ConfirmDialog, ReportDialog } from "../components/ui";
import { useApp } from "../contexts/AppContext";
import UpdateNotice from "../components/admin/UpdateNotice";
import { useUpdateSignal } from "../hooks/useUpdateSignal";
import { api, hasAdminSession, isNotFound } from "../lib/api";
import { buildCaseXls, downloadXls } from "../lib/excelXML";
import { readAloud, speechOutputSupported, stopReading } from "../lib/speech";
import { useRealtime } from "../lib/useRealtime";
import { CAT_EMOJI, timeAgo } from "../lib/utils";
import type { CommentData, PollData, PostData, PostStatus } from "../types";

/**
 * Canonical linked poll: a double-created question can leave several poll
 * rows on one post with the votes split between them. Every surface must
 * show the same one — the highest total, oldest first on ties — so the feed
 * badge, the detail card, and the polls page never disagree.
 */
export function pickCanonicalLinkedPoll(polls: PollData[]): PollData | null {
	if (!polls.length) return null;
	return polls.reduce((best, p) => {
		const votes = p.total_votes ?? 0;
		const bestVotes = best.total_votes ?? 0;
		if (votes !== bestVotes) return votes > bestVotes ? p : best;
		return String(p.created_at || "") < String(best.created_at || "")
			? p
			: best;
	});
}

/** Display name for a post status value. `waiting` is shown as Working on. */
export function statusLabel(status: string): string {
	if (status === "in_progress") return "In progress";
	if (status === "waiting") return "Working on";
	return status.charAt(0).toUpperCase() + status.slice(1);
}

const STATUS_CIRCLES: { value: string; label: string; dot: string }[] = [
	{ value: "reported", label: "Reported", dot: "var(--vb-ink3)" },
	{ value: "verified", label: "Verified", dot: "var(--vb-accent2)" },
	{ value: "in_progress", label: "In progress", dot: "var(--vb-warn)" },
	{ value: "waiting", label: "Working on", dot: "var(--vb-accent)" },
	{ value: "solved", label: "Solved", dot: "var(--vb-good)" },
];

/**
 * Resolution evidence — "did the fix actually work?" answered from database
 * rows (/api/resolution-evidence), never from a story. Renders only on
 * solved posts: before/after complaint counts, the deterministic verdict,
 * and links to still-open lookalikes when the fix may not have held.
 */
function ResolutionEvidence({ postId }: { postId: string }) {
	const [data, setData] = useState<{
		complaints_before: number;
		complaints_after: number;
		change_pct: number | null;
		verdict: string;
		related_open: { id: string; title: string; status: string }[];
		comments_after: number;
	} | null>(null);
	useEffect(() => {
		let live = true;
		api
			.get<{
				complaints_before: number;
				complaints_after: number;
				change_pct: number | null;
				verdict: string;
				related_open: { id: string; title: string; status: string }[];
				comments_after: number;
			}>(`/api/resolution-evidence?post_id=${encodeURIComponent(postId)}`)
			.then((d) => {
				if (live) setData(d);
			})
			.catch(() => {
				/* evidence is supplementary — the solved state stands without it */
			});
		return () => {
			live = false;
		};
	}, [postId]);
	if (!data) return null;
	const verdictCopy =
		data.verdict === "recurrence"
			? "Possible recurrence detected"
			: data.verdict === "watch"
				? "Improving — still watching"
				: "Resolution supported by current evidence";
	const verdictColor =
		data.verdict === "recurrence"
			? "var(--vb-bad)"
			: data.verdict === "watch"
				? "var(--vb-warn)"
				: "var(--vb-good)";
	return (
		<div
			className="mt-4 rounded-xl p-4"
			style={{ background: "var(--vb-accent-soft)", border: "1px solid rgba(86,82,214,0.2)" }}
			aria-label="Resolution evidence"
		>
			<p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1.5 flex items-center gap-1.5">
				<CheckCircle2 size={12} /> Resolution evidence
			</p>
			<p className="text-sm font-semibold" style={{ color: verdictColor }}>
				{verdictCopy}
			</p>
			<p className="text-xs text-ink2 mt-1">
				{data.complaints_before} similar complaint{data.complaints_before !== 1 ? "s" : ""} before
				{" → "}
				{data.complaints_after} after
				{data.change_pct !== null && data.complaints_before > 0
					? ` (↓${data.change_pct}%)`
					: ""}
				{data.comments_after > 0 && ` · ${data.comments_after} comment${data.comments_after !== 1 ? "s" : ""} since`}
			</p>
			{data.related_open.length > 0 && (
				<div className="mt-2 space-y-1">
					<p className="text-[11px] font-semibold text-ink2">Still open and similar:</p>
					{data.related_open.map((r) => (
						<Link
							key={r.id}
							to={`/post/${r.id}`}
							className="block text-xs text-accent font-semibold hover:underline truncate"
						>
							{r.title}
						</Link>
					))}
				</div>
			)}
		</div>
	);
}

function AdminStatusCircles({	status,
	busy,
	onPick,
}: {
	status: string;
	busy: boolean;
	onPick: (status: PostStatus) => void;
}) {
	return (
		<div className="mt-5 rounded-xl border border-border p-4">
			<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-3 flex items-center gap-1.5">
				<ShieldCheck size={11} /> Set status
			</p>
			<div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Set post status">
				{STATUS_CIRCLES.map(({ value, label, dot }) => {
					const active = status === value;
					return (
						<button
							key={value}
							type="button"
							role="radio"
							aria-checked={active}
							disabled={busy}
							onClick={() => onPick(value as PostStatus)}
							title={`Mark as ${label}`}
							className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold border transition-all disabled:opacity-40 ${
								active
									? "border-accent bg-accent-soft text-accent"
									: "border-border text-ink2 hover:border-accent/50"
							}`}
						>
							<span
								className="w-2.5 h-2.5 rounded-full shrink-0"
								style={{ background: dot }}
								aria-hidden
							/>
							{label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export default function PostDetail() {
	const { id } = useParams<{ id: string }>();
	const nav = useNavigate();
	const { anonId, toast, bookmarks, toggleBookmark, retireNotifsForLink, addRecentlyViewed } =
		useApp();

	const [p, setPost] = useState<PostData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	/** True only when the server said 404 — a failed request is NOT a missing post. */
	const [gone, setGone] = useState(false);
	const [counts, setCounts] = useState<Record<string, number>>({});
	const [mine, setMine] = useState<string[]>([]);
	const [busy, setBusy] = useState<string | null>(null);
	const [reportOpen, setReportOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [reading, setReading] = useState(false);
	const [copied, setCopied] = useState(false);
	// Case export ("the invoice") in-flight flag — prevents double-clicks
	// while the thread is being fetched and serialized to .xls.
	const [exporting, setExporting] = useState(false);
	const [follows, setFollows] = useState<string[]>([]);
	const [followBusy, setFollowBusy] = useState(false);
	const [linkedPoll, setLinkedPoll] = useState<PollData | null>(null);
	const [attachPollOpen, setAttachPollOpen] = useState(false);
	const [attachQuestion, setAttachQuestion] = useState("");
	const [attachOptions, setAttachOptions] = useState<string[]>(["", ""]);
	const [attachBusy, setAttachBusy] = useState(false);
	// The viewer's existing votes per poll id ({ poll_id: choices }). The poll API
	// only returns aggregate results, so the raw ?voter= rows carry the per-viewer
	// state that makes the linked card show "liked"/voted on first render.
	const [myVotes, setMyVotes] = useState<Record<string, number[]>>({});
	// Tracks which postId has already rendered. Background refreshes (realtime
	// polling fallback, post-vote refresh) must NOT setLoading(true) � that
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
			setGone(false);
			const res = await api.getFresh<{
				post: PostData;
				counts: Record<string, number>;
				mine: string[];
			}>(`/api/posts?id=${postId}&viewer=${anonId}`);
			setPost(res.post);
			setCounts(res.counts || {});
			setMine(res.mine || []);
			// A successful render IS the "view". Recorded here rather than on
			// the click so a 404/removed post never lands in the list, and
			// only on the FIRST load of this id so background refetches
			// (lock toggle, realtime reconcile, handleDetailUpdate) neither
			// reshuffle the history nor re-run a write on every event.
			if (loadedRef.current !== postId) addRecentlyViewed(postId);
			loadedRef.current = postId;
		} catch (e: unknown) {
			// Distinguish "this post is gone" (404) from "the request failed"
			// (429/500/timeout). Collapsing them told users their post had been
			// deleted whenever the API was merely busy.
			setGone(isNotFound(e));
			setError(e instanceof Error ? e.message : "Failed to load post");
		} finally {
			setLoading(false);
		}
	}, [postId, anonId, addRecentlyViewed]);

	useEffect(() => {
		if (postId) fetchPost();
	}, [postId, fetchPost]);

	// Load the current user's followed posts (non-critical � keep reading even if it fails)
	useEffect(() => {
		if (!anonId) return;
		api
			.get<{ follows: string[] }>(`/api/follows?user_id=${anonId}`)
			.then((r) => setFollows(r.follows || []))
			.catch(() => {
				/* follow state is best-effort */
			});
	}, [anonId]);

	// Fetch the real poll linked to this post (the post row only stores the poll id �
	// the card needs its options/vote data to be interactive).
	const fetchPoll = useCallback(async () => {
		if (!postId) return;
		try {
			const polls = await api.getFresh<PollData[]>(
				`/api/polls?post_id=${postId}&viewer=${anonId}`,
			);
			setLinkedPoll(pickCanonicalLinkedPoll(Array.isArray(polls) ? polls : []));
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

	// Freshness signal, not a refetch: the old wiring re-pulled counts on
	// every reaction/comment event and the linked poll on every vote, so a
	// busy post rebuilt this page every second or two. Realtime now only
	// raises a badge; the reader pulls counts + poll with the update
	// notice. Own reactions and votes stay instant via their optimistic
	// updates, and failures still keep stale-but-correct local state.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();

	const createAttachedPoll = async () => {
		const q = attachQuestion.trim();
		const opts = attachOptions.map((o) => o.trim()).filter(Boolean);
		if (q.length < 5) {
			toast("Poll question must be at least 5 characters", "err");
			return;
		}
		if (opts.length < 2) {
			toast("Add at least 2 poll options", "err");
			return;
		}
		setAttachBusy(true);
		try {
			await api.post("/api/polls", { title: q.slice(0, 140), ptype: "single", options: opts.slice(0, 10), post_id: postId });
			setAttachPollOpen(false);
			setAttachQuestion("");
			setAttachOptions(["", ""]);
			toast("Poll attached to this post", "ok");
			await fetchPoll();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to attach poll", "err");
		}
		setAttachBusy(false);
	};

	const handleDetailUpdate = useCallback(async () => {
		try {
			// Counts/mine only — never replace the post object here, which
			// makes the page feel like it "resets".
			const res = await api.getFresh<{
				post: PostData;
				counts: Record<string, number>;
				mine: string[];
			}>(`/api/posts?id=${postId}&viewer=${anonId}`);
			setCounts(res.counts || {});
			setMine(res.mine || []);
		} catch {
			/* keep stale-but-correct local state */
		}
		await fetchPoll();
		await fetchMyVotes();
		clearUpdates();
	}, [postId, anonId, fetchPoll, fetchMyVotes, clearUpdates]);

	useRealtime(["reactions", "comments"], markUpdatesAvailable, 1_500);

	// Post content is the other thing this page must notice (edits, status
	// changes, moderation) — a badge, per the load-once contract.
	useRealtime(["posts"], markUpdatesAvailable, 2_000);

	// ── Vote fast lane (zero debounce). ──
	// The linked poll is the page's only poll row, and a vote's only signal
	// is the `polls` updated_at touch — so refetch that one row with no
	// debounce instead of waiting out a badge. Nothing else: no list reload,
	// no raw network call.
	useRealtime(["polls"], () => void fetchPoll(), 0);

	const toggleFollow = async () => {
		// Defense-in-depth: the Follow button is disabled while a request is in
		// flight, so re-entrancy is already blocked at the DOM level (React does
		// not dispatch clicks on disabled buttons) � this guard is unreachable.
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
		// while a request is in flight � this guard is unreachable.
		/* v8 ignore next -- @preserve */
		if (busy) return;
		setBusy(kind);
		// Optimistic flip � feels instant; reconciled with the server response below.
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
			// Server returns the authoritative state (counts + MY reactions � opposites auto-cleared)
			setCounts(res.counts || {});
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
			// Soft-delete via PUT (owner-scoped) � the DELETE route is admin-only
			await api.put("/api/posts", {
				id: postId,
				author_id: anonId,
				deleted: true,
			});
			retireNotifsForLink(`/post/${postId}`);
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

	// ── Case export ("the invoice") ─────────────────────────────
	// Fetches the full comment thread (server-masked for privacy), builds the
	// SpreadsheetML workbook and triggers a native .xls download. Guarded by a
	// ref so a double-click can never fire two downloads.
	const exportBusyRef = useRef(false);
	const exportCase = useCallback(async () => {
		if (!p || exportBusyRef.current) return;
		exportBusyRef.current = true;
		setExporting(true);
		try {
			// Fresh, not cached: an export must reflect the thread as it is
			// now, not the 5s client cache.
			const raw = await api.getFresh<CommentData[]>(`/api/comments?post_id=${p.id}`);
			const comments = Array.isArray(raw) ? raw : [];
			const rows = comments.map((c) => ({
				when: new Date(c.created_at).toLocaleString(),
				author: c.is_admin
					? "Admin"
					: c.is_mine
						? "You"
						: `${(c.author_id || "anon").slice(0, 12)}…`,
				body: c.body || "",
				status: [c.hidden && "hidden", c.deleted && "deleted"]
					.filter(Boolean)
					.join(", "),
			}));
			const xml = buildCaseXls({
				post: {
					id: p.id,
					title: p.title,
					description: p.description,
					category: p.category,
					status: p.status,
					priority: p.priority,
					created_at: p.created_at,
					updated_at: p.updated_at,
					author_id: p.author_id,
					tags: p.tags,
					visibility: p.visibility,
					pinned: p.pinned,
					locked: p.locked,
					official: p.official,
					hidden: p.hidden,
					comment_count: p.comment_count,
					reactions: p.reactions,
					linked_poll: p.linked_poll,
					merged_into: p.merged_into,
					admin_reply: p.admin_reply,
					admin_notes: p.admin_notes,
					ai_summary: p.ai_summary,
					status_history: p.status_history,
				},
				comments: rows,
			});
			downloadXls(`case-${p.id}.xls`, xml);
			toast("Case exported as Excel (.xls)", "ok");
		} catch (err) {
			console.error("[post] case export failed", err);
			toast("Export failed — could not load the case", "err");
		} finally {
			exportBusyRef.current = false;
			setExporting(false);
		}
	}, [p, toast]);

	if (loading) {
		return (
			<div className="max-w-3xl mx-auto vb-page-enter">
				<button className="btn btn-ghost !px-3 mb-4" onClick={() => nav(-1)}>
					<ArrowLeft size={15} /> Back
				</button>
				<div className="card p-6 sm:p-8 space-y-4">
					<div className="flex gap-2 mb-2">
						<div className="skeleton h-6 w-20 rounded-full" />
						<div className="skeleton h-6 w-16 rounded-full" />
					</div>
					<div className="skeleton h-7 w-3/4 rounded" />
					<div className="space-y-2">
						<div className="skeleton h-4 w-full rounded" />
						<div className="skeleton h-4 w-5/6 rounded" />
						<div className="skeleton h-4 w-2/3 rounded" />
					</div>
					<div className="flex gap-2 pt-2">
						<div className="skeleton h-8 w-20 rounded-lg" />
						<div className="skeleton h-8 w-20 rounded-lg" />
						<div className="skeleton h-8 w-20 rounded-lg" />
					</div>
				</div>
			</div>
		);
	}		if (error || !p) {
			// A 404 (or a 200 carrying no post) means it is genuinely absent.
			// Anything else is a loading failure and must say so — and must offer
			// Retry, because the post is still there.
			const absent = gone || (!error && !p);
			return (
				<div className="max-w-3xl mx-auto vb-page-enter">
					<button className="btn btn-ghost !px-3 mb-4" onClick={() => nav(-1)}>
						<ArrowLeft size={15} /> Back
					</button>
					<div className="card p-8 sm:p-12 text-center">
						<div
							className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 ${
								absent ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn"
							}`}
						>
							{absent ? <Link2 size={26} /> : <AlertTriangle size={26} />}
						</div>
						<p className="font-display font-bold text-lg text-ink mb-1">
							{absent ? "Post not found" : "Couldn't load this post"}
						</p>
						<p className="text-sm text-ink3 mb-6 max-w-xs mx-auto leading-relaxed">
							{absent
								? "This post may have been removed or the link is invalid."
								: `${error} — the post itself is still here, so this is worth retrying.`}
						</p>
						<div className="flex flex-wrap items-center justify-center gap-2">
							{!absent && (
								<button
									className="btn btn-primary"
									onClick={() => void fetchPost()}
								>
									<RefreshCw size={14} /> Retry
								</button>
							)}
							<button className="btn btn-ghost" onClick={() => nav("/")}>
								Go to Home
							</button>
							<button className="btn btn-ghost" onClick={() => nav("/submit")}>
								Submit a post
							</button>
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

			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => void handleDetailUpdate()}
			/>

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
							<Lock size={11} className="inline" /> Private � admins only
						</span>
					)}
					<span className="ml-auto text-xs text-ink3">
						{timeAgo(p.created_at)} � by{" "}
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
							<Link
								key={t}
								to={`/search?q=${encodeURIComponent(`#${t}`)}`}
								className="text-xs text-accent font-semibold hover:underline"
								aria-label={`Show all posts tagged ${t}`}
							>
								#{t}
							</Link>
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

				{/* Resolution evidence — solved posts only, derived from real rows */}
				{p.status === "solved" && <ResolutionEvidence postId={postId} />}

				{/* Admin status picker — one-tap circles: Reported, Verified,
				In progress, Working on (= waiting), Solved. Working on maps to
				the existing `waiting` status so all five choices are distinct
				values with no DB migration. */}
				{hasAdminSession() && (
					<AdminStatusCircles
						status={p.status}
						busy={busy !== null}
						onPick={async (status) => {
							if (busy || status === p.status) return;
							setBusy("status");
							try {
								await api.put("/api/posts", { id: postId, status });
								setPost((prev) => (prev ? { ...prev, status } : prev));
								toast(`Status set to ${statusLabel(status)}`, "ok");
							} catch (e: unknown) {
								toast(e instanceof Error ? e.message : "Update failed", "err");
							}
							setBusy(null);
						}}
					/>
				)}

				{/* Action bar */}
				<div className="flex flex-wrap items-center gap-1 mt-5 pt-4 border-t border-border">
					{getReactionMeta(p.type).map(({ kind, label, icon: Icon, color }) => (
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
						inactiveClassName="text-ink3 hover:bg-surface2 hover:-translate-y-0.5 hover:shadow-sm"
						/>
					))}

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
						{/* -- Admin-only actions ------------------------------ */}
						{hasAdminSession() && (
							<>
								<button
									onClick={async () => {
										// Optimistic flip with rollback: without the
										// try/catch a failed PUT left the UI showing
										// hidden/solved while the server was unchanged.
										const wasHidden = p.hidden;
										try {
											await api.put("/api/posts", { id: postId, hidden: !wasHidden });
											setPost((prev) => (prev ? { ...prev, hidden: !wasHidden } : null));
											toast(wasHidden ? "Post unhidden" : "Post hidden", "ok");
										} catch (e: unknown) {
											toast(e instanceof Error ? e.message : "Update failed", "err");
										}
									}}
									title={p.hidden ? "Unhide post" : "Hide post (flag)"}
									className={`p-2 rounded-lg transition-all duration-200 ${p.hidden ? 'text-red-400 bg-red-500/10' : 'text-ink3 hover:text-red-400 hover:bg-red-500/10'}`}
								>
									{p.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
								</button>
								<button
									onClick={async () => {
										const wasOfficial = p.official;
										try {
											await api.put("/api/posts", { id: postId, official: !wasOfficial });
											setPost((prev) => (prev ? { ...prev, official: !wasOfficial } : null));
											toast(wasOfficial ? "Removed official" : "Marked official", "ok");
										} catch (e: unknown) {
											toast(e instanceof Error ? e.message : "Update failed", "err");
										}
									}}
									title={p.official ? "Remove official" : "Mark official"}
									className={`p-2 rounded-lg transition-all duration-200 ${p.official ? 'text-amber-400 bg-amber-500/10' : 'text-ink3 hover:text-amber-400 hover:bg-amber-500/10'}`}
								>
									<ShieldCheck size={14} />
								</button>
								{p.status !== "solved" && p.status !== "archived" && (
									<button
										onClick={async () => {
											try {
												await api.put("/api/posts", { id: postId, status: "solved" });
												setPost((prev) => (prev ? { ...prev, status: "solved" } : null));
												toast("Issue solved � the community will be notified!", "ok");
											} catch (e: unknown) {
												toast(e instanceof Error ? e.message : "Update failed", "err");
											}
										}}
										title="Mark solved"
										className="p-2 rounded-lg text-ink3 hover:text-good hover:bg-good/10 transition-all duration-200"
									>
										<CheckCircle2 size={14} />
									</button>
								)}
							</>
						)}
						{/* -- Case export: post owner or admin ("the invoice") ------ */}
						{(p.author_id === anonId || hasAdminSession()) && (
							<button
								onClick={exportCase}
								disabled={exporting}
								title="Export case as Excel (.xls)"
								className="p-2 rounded-lg text-ink3 hover:text-accent hover:bg-surface2 transition-all duration-200 disabled:opacity-50"
							>
								<FileDown size={14} />
							</button>
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
							Loading linked poll�
						</div>
					)}
				</div>
			)}

			{!p.linked_poll && (p.is_mine || p.author_id === anonId || hasAdminSession()) && (
				<div className="mt-4 card p-4">
					<button
						type="button"
						onClick={() => setAttachPollOpen((v) => !v)}
						aria-expanded={attachPollOpen}
						className="flex items-center gap-2 text-xs font-semibold text-ink2 hover:text-ink transition-colors"
					>
						<Link2 size={13} className="text-accent" />
						{attachPollOpen ? "Close poll builder" : "Attach a poll"}
					</button>
					{attachPollOpen && (
						<div className="mt-3 space-y-2.5">
							<input
								className="input !py-2 !text-sm w-full"
								placeholder="Poll question"
								aria-label="Attached poll question"
								value={attachQuestion}
								onChange={(e) => setAttachQuestion(e.target.value)}
								maxLength={140}
							/>
							{attachOptions.map((o, i) => (
								<input
									key={i}
									className="input !py-2 !text-sm w-full"
										placeholder={`Option ${i + 1}`}
										aria-label={`Attached poll option ${i + 1}`}
										value={o}
										onChange={(e) =>
											setAttachOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
										}
										maxLength={60}
									/>
							))}
							<div className="flex gap-2">
								{attachOptions.length < 10 && (
									<button
										type="button"
										className="btn btn-ghost !text-xs"
										onClick={() => setAttachOptions((prev) => [...prev, ""])}
									>
										+ Add option
									</button>
								)}
								<button
									type="button"
									className="btn btn-primary !text-xs"
									disabled={attachBusy}
									onClick={() => void createAttachedPoll()}
								>
									{attachBusy ? "Attaching…" : "Create poll"}
								</button>
							</div>
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
				message="The post will be removed from public view. This cannot be undone from here — message the team via inbox if removed by mistake."
				confirmLabel="Delete"
				danger
			/>
		</div>
	);
}
