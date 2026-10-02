import {
	AlertCircle,
	Ban,
	CornerDownRight,
	Flag,
	Lock,
	Pause,
	Pencil,
	RefreshCw,
	Reply,
	Send,
	ShieldAlert,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../contexts/AppContext";
import { api, hasAdminSession, queuedCount } from "../lib/api";
import { checkCooldown, lsGet, lsSet, stampCooldown } from "../lib/identity";
import {
	commentBlockMessage,
	isBlockedByServer,
	type ModerationResult,
	moderateContent,
} from "../lib/moderation";
import { useRealtime } from "../lib/useRealtime";
import { sanitize, timeAgo } from "../lib/utils";
import type { CommentData } from "../types";
import { ReportDialog } from "./ui";

// ─── @mention helpers ────────────────────────────────────────────────
// Matches @handle tokens like @anon_1a2b3c or @you. Renders them as
// highlighted chips, and lets users notify a specific anonymous user.
const MENTION_RE = /@([\w.-]{3,})/g;

function renderMentions(body: string): React.ReactNode {
	const parts = (body || "").split(MENTION_RE);
	const nodes: React.ReactNode[] = [];
	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			// Odd indexes are the captured mention handles
			const handle = parts[i];
			nodes.push(
				<span
					key={i}
					className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-accent/10 text-accent font-semibold text-[0.9em]"
					title={`Mentioned user: @${handle}`}
				>
					@{handle}
				</span>,
			);
		} else if (parts[i]) {
			nodes.push(<span key={i}>{parts[i]}</span>);
		}
	}
	return nodes.length ? nodes : body;
}

// LocalStorage key tracking which mention-notifications we've already fired,
// so we don't spam the user on every realtime refresh of the same comment.
const MENTION_SEEN_KEY = "vb:seenMentions";

interface CommentNode extends CommentData {
	children: CommentNode[];
}

function buildTree(rows: CommentData[]): CommentNode[] {
	const map: Record<string, CommentNode> = {};
	rows.forEach((r) => {
		map[r.id] = { ...r, children: [] };
	});
	const roots: CommentNode[] = [];
	rows.forEach((r) => {
		const parent = r.parent_id ? map[r.parent_id] : undefined;
		const node = map[r.id];
		if (parent && node) parent.children.push(node);
		else if (node) roots.push(node);
	});
	return roots;
}

export default memo(function Comments({
	postId,
	locked,
}: {
	postId: string;
	locked?: boolean;
}) {
	const { anonId, toast, accountStatus, pushNotif } = useApp();
	const restricted = !!(accountStatus?.banned || accountStatus?.suspended);
	const [comments, setComments] = useState<CommentData[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState("");
	const [text, setText] = useState("");
	const [replyTo, setReplyTo] = useState<string | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	const [editText, setEditText] = useState("");
	const [busy, setBusy] = useState(false);
	const [reportTarget, setReportTarget] = useState<string | null>(null);
	const [asAdmin, setAsAdmin] = useState(false);
	const [moderation, setModeration] = useState<ModerationResult | null>(null);
	const [editModeration, setEditModeration] = useState<ModerationResult | null>(
		null,
	);
	const modSeq = useRef(0);
	const editModSeq = useRef(0);
	const isAdminSession = hasAdminSession();

	/**
	 * Load the thread.
	 *
	 * `fresh` bypasses the client's 5s GET cache. Every path EXCEPT first mount
	 * must pass it: a realtime event means the database already changed, and
	 * re-reading through a cache that was populated seconds ago returns the
	 * pre-change body — the comment exists but never renders. That is the
	 * "realtime fired but the UI did not update" failure, and it is why the
	 * thread looked frozen until a manual refresh.
	 */
	const load = useCallback(
		async (fresh = false) => {
			setLoadError("");
			try {
				const path = `/api/comments?post_id=${postId}&viewer=${anonId}`;
				const data = fresh
					? await api.getFresh<CommentData[]>(path)
					: await api.get<CommentData[]>(path);
				setComments(
					(Array.isArray(data) ? data : []).filter((c) => !c.deleted),
				);
			} catch (error: unknown) {
				setLoadError(
					error instanceof Error ? error.message : "Could not load comments",
				);
			}
			setLoading(false);
		},
		[postId, anonId],
	);

	useEffect(() => {
		load();
	}, [load]);

	// 🔴 new comments appear live for everyone in the thread
	//
	// SCALE: the realtime channel is shared GLOBALLY per table, so this
	// callback fires for EVERY comment written anywhere in the platform, not
	// just this thread. The previous version ignored the payload and refetched
	// unconditionally — at school scale (thousands of open threads) a single
	// comment anywhere could fan out into thousands of unrelated requests.
	// Filter on the changed post_id so only the affected thread refetches;
	// latency for the thread that actually changed stays at 150ms.
	useRealtime(
		["comments"],
		(_table, payload) => {
			const next = payload?.new as { post_id?: string } | undefined;
			const prev = payload?.old as { post_id?: string } | undefined;
			const changedPostId =
				payload?.eventType === "DELETE" ? prev?.post_id : next?.post_id;
			// No post_id in the payload (unexpected shape) → stay conservative
			// and refresh rather than risk showing a stale thread.
			if (changedPostId && changedPostId !== postId) return;
			void load(true);
		},
		150,
	);

	// 🔔 When a new comment @mentions the current anonymous user, fire a
	// notification + toast (deduped per comment id via localStorage).
	useEffect(() => {
		const myMentions = comments.filter((c) => {
			if (c.deleted || c.is_mine) return false;
			// Notify ONLY on an exact anon-id match — the literal `@you` is
			// highlighted in renderMentions but must NOT notify every viewer.
			const escaped = (anonId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			// Single-quoted '\\b' is an unambiguous regex word boundary — inside a
			// template literal, `\b` would be the backspace escape (U+0008) and the
			// detection would silently never match.
			const re = new RegExp("@" + escaped + "\\b", "i");
			return re.test(c.body || "");
		});
		if (myMentions.length === 0) return;

		let seen: string[] = [];
		try {
			seen = lsGet<string[]>(MENTION_SEEN_KEY, []);
		} catch {
			/* ignore */
		}
		const fresh = myMentions.filter((c) => !seen.includes(c.id));
		if (fresh.length === 0) return;

		const first = fresh[0];
		pushNotif({
			kind: "mention",
			title: "📣 Someone mentioned you in a comment",
			body: (first!.body || "").slice(0, 140),
			link: `/post/${postId}`,
		});
		toast(`📣 @${anonId} — you were mentioned in a comment`, "info");

		try {
			lsSet(MENTION_SEEN_KEY, [...seen, ...fresh.map((c) => c.id)].slice(-200));
		} catch {
			/* ignore */
		}
	}, [comments, anonId, postId, pushNotif, toast]);

	// Live moderation on comment text
	useEffect(() => {
		if (text.length < 3) {
			setModeration(null);
			return;
		}
		const seq = ++modSeq.current;
		const t = setTimeout(() => {
			if (seq === modSeq.current) setModeration(moderateContent(text));
		}, 200);
		return () => clearTimeout(t);
	}, [text]);

	// Live moderation on the EDIT box — edits go through the same server
	// comment gate (api/_comments.js PUT), so an ungated edit would be
	// rejected after the user pressed Save with no explanation.
	useEffect(() => {
		if (editing === null || editText.length < 3) {
			setEditModeration(null);
			return;
		}
		const seq = ++editModSeq.current;
		const t = setTimeout(() => {
			if (seq === editModSeq.current)
				setEditModeration(moderateContent(editText));
		}, 200);
		return () => clearTimeout(t);
	}, [editing, editText]);

	const submit = async () => {
		if (busy) return;
		const body = sanitize(text, 500);
		if (body.length < 2) {
			toast("Comment is too short", "err");
			return;
		}
		const cd = checkCooldown("comment", 8);
		if (cd) {
			toast(`Please wait ${cd}s before commenting again`, "err");
			return;
		}
		// Gate on the RAW sanitized text with the exact server comment verdict.
		// Sending the pre-masked string here made `serverModerate` see stars
		// instead of the words that were actually typed — masking happens at
		// INSERT time on the server, never before the gate.
		const mod = moderateContent(body);
		if (isBlockedByServer(mod)) {
			toast(commentBlockMessage(mod), "err");
			return;
		}
		setBusy(true);
		// The typed text leaves the box the instant Send is pressed: what you
		// see below is the sending state, not a duplicate of your draft.
		// The box is cleared upfront so there is never a moment where the same
		// words sit in both places. If the send hard-fails (not queued for
		// replay), the text is restored into the box so nothing is lost.
		// Optimistic entry: the comment appears the instant it is sent instead of
		// after a round-trip. It is replaced by the authoritative list on success
		// and removed on failure, so a failed send can never look like a posted one.
		// Display uses the masked text (what the server will store); the request
		// body stays raw so the server's gate sees the real content.
		const tempId = `pending-${Date.now()}`;
		const failedBody = body;
		setText("");
		const optimistic: CommentData = {
			id: tempId,
			post_id: postId,
			parent_id: replyTo,
			author_id: anonId,
			body: sanitize(mod.maskedText, 500),
			is_admin: asAdmin && isAdminSession,
			created_at: new Date().toISOString(),
			is_mine: true,
		};
		setComments((prev) => [...prev, optimistic]);
		const queuedBefore = queuedCount();
		try {
			await api.post("/api/comments", {
				post_id: postId,
				parent_id: replyTo,
				author_id: anonId,
				body,
				is_admin: asAdmin && isAdminSession,
			});
			stampCooldown("comment");
			setReplyTo(null);
			await load(true);
		} catch (e: unknown) {
			// A transient failure is auto-queued by the api layer for replay, so
			// the comment IS going to be posted. Saying "failed" here was wrong and
			// actively harmful: the user retypes it and the queue posts both.
			if (queuedCount() > queuedBefore) {
				stampCooldown("comment");
				setReplyTo(null);
				toast(
					"Saved offline — it will post automatically when you reconnect",
					"info",
				);
				// Keep the optimistic row; the queue flush plus the realtime event
				// will replace it with the server's copy.
			} else {
				setComments((prev) => prev.filter((c) => c.id !== tempId));
				// The box was cleared at send time — put the words back so the
				// user can fix and retry instead of retyping from memory.
				// replyTo is deliberately kept: the retry is still a reply.
				setText(failedBody);
				toast(e instanceof Error ? e.message : "Failed to post comment", "err");
			}
		}
		setBusy(false);
	};

	const saveEdit = async (id: string) => {
		const body = sanitize(editText, 500);
		// Edits hit the same server comment gate (PUT → serverModerate on raw
		// body). Pre-gate here with the same comment verdict so Save is blocked
		// BEFORE the request, not rejected after it.
		const mod = moderateContent(body);
		if (isBlockedByServer(mod)) {
			toast(commentBlockMessage(mod), "err");
			return;
		}
		try {
			await api.put("/api/comments", {
				id,
				author_id: anonId,
				body,
			});
			setEditing(null);
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to save edit", "err");
		}
	};

	const del = async (id: string) => {
		try {
			await api.put("/api/comments", { id, author_id: anonId, deleted: true });
			await load();
			toast("Comment deleted", "info", {
				label: "Undo (30s)",
				fn: async () => {
					await api.put("/api/comments", {
						id,
						author_id: anonId,
						deleted: false,
					});
					await load();
					toast("Comment restored", "ok");
				},
			});
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to delete comment", "err");
		}
	};

	const report = async (id: string, reason: string) => {
		try {
			await api.post("/api/reports", {
				target_id: id,
				target_type: "comment",
				reason: sanitize(reason, 300),
				author_id: anonId,
			});
			toast("Reported — our moderators will review it", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to submit report", "err");
		}
	};

	const renderNode = (c: CommentNode, depth: number) => (
		<div
			key={c.id}
			className={
				depth > 0 ? "ml-5 sm:ml-8 border-l-2 border-border pl-3 sm:pl-4" : ""
			}
		>
			<div className="py-2.5 transition-colors duration-150 hover:bg-surface2/30 rounded-lg px-2 -mx-2">
				<div className="flex items-center gap-2 text-xs">
					{c.id.startsWith("pending-") ? (
						<span
							className="inline-flex items-center gap-1 font-semibold text-accent"
							role="status"
							aria-label="Sending comment"
						>
							<RefreshCw size={11} className="animate-spin" aria-hidden />
							Sending…
						</span>
					) : c.is_admin ? (
						<span className="chip !bg-accent !text-white !border-transparent">
							<ShieldCheck size={11} /> Admin
						</span>
					) : (
						<span className="font-mono text-ink3">
							{c.is_mine ? "You" : (c.author_id?.slice(0, 10) ?? "anon")}
						</span>
					)}
					<span className="text-ink3">
						{timeAgo(c.created_at)}
						{c.edited ? " · edited" : ""}
					</span>
				</div>
				{editing === c.id ? (
					<>
						<div className="mt-1.5 flex gap-2">
							<input
								className="input !py-1.5 text-sm"
								value={editText}
								onChange={(e) => setEditText(e.target.value)}
								maxLength={500}
								aria-label="Edit comment"
							/>
							<button
								className="btn btn-primary !py-1.5 !px-3 !text-xs"
								onClick={() => saveEdit(c.id)}
								disabled={
									!!editModeration && isBlockedByServer(editModeration)
								}
								aria-label="Save edit"
							>
								{editModeration && isBlockedByServer(editModeration) ? (
									<ShieldAlert size={12} />
								) : (
									"Save"
								)}
							</button>
							<button
								className="btn btn-ghost !py-1.5 !px-3 !text-xs"
								onClick={() => {
									setEditing(null);
									setEditModeration(null);
								}}
							>
								Cancel
							</button>
						</div>
						{editModeration && isBlockedByServer(editModeration) && (
							<p className="mt-1 text-[11px] text-bad" role="alert">
								{commentBlockMessage(editModeration)}
							</p>
						)}
					</>
				) : (
					<p className="text-sm mt-1 prose-desc">{renderMentions(c.body)}</p>
				)}
				<div className="flex items-center gap-2.5 mt-1.5">
					{!locked && (
						<button
							className="text-[11px] font-semibold text-ink3 hover:text-accent flex items-center gap-1"
							onClick={() => {
								setReplyTo(c.id);
								document.getElementById("comment-input")?.focus();
							}}
						>
							<Reply size={11} /> Reply
						</button>
					)}
					{c.is_mine && !c.is_admin && (
						<>
							<button
								className="text-[11px] font-semibold text-ink3 hover:text-accent flex items-center gap-1"
								onClick={() => {
									setEditing(c.id);
									setEditText(c.body);
								}}
							>
								<Pencil size={11} /> Edit
							</button>
							<button
								className="text-[11px] font-semibold text-ink3 hover:text-bad flex items-center gap-1"
								onClick={() => del(c.id)}
							>
								<Trash2 size={11} /> Delete
							</button>
						</>
					)}
					<button
						className="text-[11px] font-semibold text-ink3 hover:text-warn flex items-center gap-1"
						onClick={() => setReportTarget(c.id)}
					>
						<Flag size={11} /> Report
					</button>
				</div>
			</div>
			{c.children.map((ch) => renderNode(ch, depth + 1))}
		</div>
	);

	const tree = useMemo(() => buildTree(comments), [comments]);

	return (
		<section aria-label="Comments">
			<h2 className="font-display font-semibold text-sm mb-2">
				{comments.length} Comment{comments.length !== 1 ? "s" : ""}
			</h2>
			{loadError && (
				<div
					role="alert"
					className="mb-3 flex items-center gap-2 rounded-xl border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad"
				>
					<AlertCircle size={14} aria-hidden />
					<span className="min-w-0 flex-1">{loadError}</span>
					<button
						type="button"
						className="btn btn-ghost !px-2 !py-1 !text-[11px]"
						onClick={() => {
							setLoading(true);
							void load();
						}}
						aria-label="Retry comments"
					>
						<RefreshCw size={12} /> Retry
					</button>
				</div>
			)}
			{locked ? (
				<p className="text-sm text-ink3 bg-surface2 rounded-xl px-4 py-3 flex items-center gap-2">
					<Lock size={14} /> Comments are locked on this post.
				</p>
			) : restricted ? (
				<p
					className="text-sm rounded-xl px-4 py-3 flex items-center gap-2"
					style={{ background: "rgba(220,75,75,0.08)", color: "#dc4b4b" }}
				>
					{accountStatus?.banned ? (
						<>
							<Ban size={14} /> Commenting is disabled — this ID is banned.
						</>
					) : (
						<>
							<Pause size={14} /> Commenting is paused while your ID is
							suspended.
						</>
					)}
				</p>
			) : (
				<div className="card p-3">
					{replyTo && (
						<div className="flex items-center gap-2 text-xs text-accent mb-2 bg-accent-soft rounded-lg px-2.5 py-1.5">
							<CornerDownRight size={12} /> Replying to a comment
							<button
								className="ml-auto font-semibold"
								onClick={() => setReplyTo(null)}
							>
								Cancel
							</button>
						</div>
					)}
					<form
						className="flex gap-2 min-w-0"
						onSubmit={(e) => {
							e.preventDefault();
							submit();
						}}
					>
						<input
							id="comment-input"
							className={`input flex-1 min-w-0 transition-all duration-200 ${(moderation?.flags ?? []).some((f) => f.severity === "critical" || f.severity === "high") ? "moderation-flag border-bad" : moderation && (moderation.flags ?? []).length === 0 && text.length > 5 ? "moderation-ok border-good" : ""}`}
							placeholder={
								asAdmin
									? "Reply as Admin (official)…"
									: "Add an anonymous comment…"
							}
							value={text}
							onChange={(e) => setText(e.target.value)}
							maxLength={500}
							aria-label="Comment text"
							disabled={busy}
						/>
						<button
							type="submit"
							className="btn btn-primary !px-3.5 transition-all duration-200"
							disabled={
								busy ||
								text.trim().length < 2 ||
								(moderation ? isBlockedByServer(moderation) : false)
							}
							aria-label="Send comment"
						>
							{busy ? (
								<RefreshCw
									size={15}
									className="animate-spin"
									aria-label="Sending comment"
								/>
							) : moderation && isBlockedByServer(moderation) ? (
								<ShieldAlert size={15} />
							) : (
								<Send size={15} />
							)}
						</button>
					</form>
					{/* Comment moderation feedback */}
					{moderation && (moderation.flags ?? []).length > 0 && (
						<div
							className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs ${isBlockedByServer(moderation) ? "moderation-blocked" : moderation.overallSeverity === "medium" ? "moderation-warn" : "moderation-info"}`}
						>
							<div className="flex items-center gap-1.5 mb-1">
								{isBlockedByServer(moderation) ? (
									<ShieldAlert size={11} className="text-bad" />
								) : (
									<ShieldCheck size={11} className="text-warn" />
								)}
								<span className="font-semibold">
									{isBlockedByServer(moderation)
										? "Content blocked"
										: "Content flagged"}
								</span>
							</div>
							{(moderation.flags ?? []).slice(0, 2).map((flag, i) => (
								<p key={i} className="text-ink2 mt-0.5">
									{flag.message}
								</p>
							))}
							{isBlockedByServer(moderation) && (
								<p
									className="mt-1 font-semibold"
									style={{ color: "var(--vb-bad)" }}
								>
									Please fix to continue.
								</p>
							)}
						</div>
					)}
					<div className="flex items-center justify-between mt-1.5">
						{isAdminSession ? (
							<button
								onClick={() => setAsAdmin((a) => !a)}
								role="switch"
								aria-checked={asAdmin}
								className={`flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg transition-all ${asAdmin ? "bg-accent text-white" : "bg-surface2 text-ink3 hover:text-ink2"}`}
							>
								<ShieldCheck size={11} />{" "}
								{asAdmin ? "Posting as Admin" : "Post as Admin"}
							</button>
						) : (
							<span />
						)}
						<p className="text-[10px] text-ink3">{text.length}/500</p>
					</div>
				</div>
			)}
			<div className="mt-3 divide-y divide-border vb-comment-list">
				{loading && (
					<div className="space-y-3 py-3">
						{[1, 2].map((i) => (
							<div key={i} className="skeleton h-14" />
						))}
					</div>
				)}
				{!loading && tree.length === 0 && (
					<p className="text-sm text-ink3 py-6 text-center">
						No comments yet — start the discussion anonymously.
					</p>
				)}
				{tree.map((c) => renderNode(c, 0))}
			</div>
			<ReportDialog
				open={!!reportTarget}
				onClose={() => setReportTarget(null)}
				onSubmit={(reason) => reportTarget && report(reportTarget, reason)}
			/>
		</section>
	);
});
