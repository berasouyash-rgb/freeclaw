// ─── Community Detail — one group's discussion feed ──────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
	AlertTriangle,
	ArrowLeft,
	BarChart3,
	CheckCircle2,
	Flag,
	Heart,
	MessageSquare,
	Plus,
	RefreshCw,
	Send,
	ThumbsUp,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { useApp } from "../contexts/AppContext";
import { api, hasAdminSession, isNotFound } from "../lib/api";

interface CommunityPollOption {
	id: string;
	text: string;
	votes: number;
}

interface CommunityPoll {
	id: string;
	question: string;
	options: CommunityPollOption[];
	created_by: string;
	my_vote: string | null;
	total_votes: number;
}

interface CommunityPost {
	id: string;
	anon_id: string;
	author: string;
	text: string;
	created_at: string;
	reactions: Record<string, string[]>;
	reaction_counts: Record<string, number>;
	mine_reactions: Record<string, boolean>;
	poll: CommunityPoll | null;
	comments: { id: string; anon_id: string; author: string; text: string; created_at: string }[];
}

interface CommunityDetailData {
	slug: string;
	name: string;
	description: string;
	avatar: string;
	created_by: string;
	created_at: string;
	hidden: boolean;
	member_count: number;
	post_count: number;
	members: string[];
	is_member: boolean;
	is_creator: boolean;
	posts: CommunityPost[];
}

const REACTION_KINDS = [
	{ kind: "support", icon: ThumbsUp, label: "Support" },
	{ kind: "helpful", icon: Heart, label: "Helpful" },
];

function authorName(author: string, anonId: string): string {
	return author || (anonId ? `anon…${anonId.slice(-6)}` : "Anonymous");
}

function timeAgoShort(iso: string): string {
	const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

export default function CommunityDetail() {
	const { slug = "" } = useParams<{ slug: string }>();
	const { anonId, toast, displayName } = useApp();
	const isAdmin = hasAdminSession();
	const [data, setData] = useState<CommunityDetailData | null>(null);
	const [notFound, setNotFound] = useState(false);
	/** Non-404 load failure — a different fact from "this community is gone". */
	const [loadError, setLoadError] = useState("");
	const [busy, setBusy] = useState(false);
	const [draft, setDraft] = useState("");
	// In-flight dedupe keys for fire-and-forget actions (vote/react/comment/
	// report have no per-button busy state — see handlers below).
	const inflightRef = useRef<Set<string>>(new Set());
	const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
	const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
	const [pollOpen, setPollOpen] = useState(false);
	const [pollQuestion, setPollQuestion] = useState("");
	const [pollOptions, setPollOptions] = useState(["", ""]);

	const load = useCallback(async () => {
		try {
			const r = await api.get<CommunityDetailData>(
				`/api/communities?action=get&slug=${encodeURIComponent(slug)}&anon_id=${anonId}`,
			);
			setData(r);
			setNotFound(false);
			setLoadError("");
		} catch (e: unknown) {
			// Only a 404 means the community actually does not exist. Anything
			// else (429, timeout, 500) is a failed request and must say so —
			// otherwise a busy API tells users the group was deleted.
			if (isNotFound(e)) {
				setNotFound(true);
				setLoadError("");
				return;
			}
			setLoadError(
				e instanceof Error ? e.message : "Failed to load community",
			);
		}
	}, [slug, anonId]);

	useEffect(() => {
		void load();
	}, [load]);

	const joinLeave = async () => {
		if (!data) return;
		setBusy(true);
		try {
			await api.post("/api/communities", {
				action: data.is_member ? "leave" : "join",
				slug: data.slug,
				anon_id: anonId,
			});
			toast(data.is_member ? "Left community" : "Joined community", "ok");
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed", "err");
		} finally {
			setBusy(false);
		}
	};

	const postMessage = async () => {
		if (!data) return;
		const text = draft.trim();
		if (!text) return;
		// poll validation when enabled
		const options = pollOptions.map((o) => o.trim()).filter(Boolean);
		if (pollOpen && !pollQuestion.trim()) {
			toast("Add a question for your poll", "err");
			return;
		}
		if (pollOpen && options.length < 2) {
			toast("A poll needs at least 2 options", "err");
			return;
		}
		setBusy(true);
		try {
			await api.post("/api/communities", {
				action: "post",
				slug: data.slug,
				anon_id: anonId,
				author: displayName,
				text,
				poll: pollOpen
					? { question: pollQuestion.trim(), options }
					: undefined,
			});
			setDraft("");
			setPollOpen(false);
			setPollQuestion("");
			setPollOptions(["", ""]);
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to post", "err");
		} finally {
			setBusy(false);
		}
	};

	const vote = async (postId: string, optionId: string) => {
		if (!data) return;
		// Collapse rapid double-clicks into one request (no busy UI state
		// here — the key includes the option so changing your vote fast
		// still goes through, while an identical in-flight vote is dropped).
		const key = `vote:${postId}:${optionId}`;
		if (inflightRef.current.has(key)) return;
		inflightRef.current.add(key);
		try {
			await api.post("/api/communities", {
				action: "vote",
				slug: data.slug,
				post_id: postId,
				option_id: optionId,
				anon_id: anonId,
			});
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to vote", "err");
		} finally {
			inflightRef.current.delete(key);
		}
	};

	const solvePoll = async (postId: string) => {
		if (!data) return;
		if (
			!confirm(
				"Mark this poll as solved? The poll and this post will be removed from the feed.",
			)
		) return;
		try {
			await api.post("/api/communities", {
				action: "solve_poll",
				slug: data.slug,
				post_id: postId,
				anon_id: anonId,
			});
			toast("Poll solved — post removed", "ok");
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed", "err");
		}
	};

	const deletePost = async (postId: string) => {
		if (!data) return;
		if (!confirm("Delete this post? This cannot be undone.")) return;
		try {
			await api.post("/api/communities", {
				action: "delete_post",
				slug: data.slug,
				post_id: postId,
				anon_id: anonId,
			});
			toast("Post deleted", "ok");
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed", "err");
		}
	};

	const react = async (postId: string, kind: string) => {
		if (!data) return;
		// Toggle + double-click without this guard flips on then off.
		const key = `react:${postId}:${kind}`;
		if (inflightRef.current.has(key)) return;
		inflightRef.current.add(key);
		try {
			await api.post("/api/communities", {
				action: "react",
				slug: data.slug,
				post_id: postId,
				anon_id: anonId,
				kind,
			});
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed", "err");
		} finally {
			inflightRef.current.delete(key);
		}
	};

	const comment = async (postId: string) => {
		if (!data) return;
		const text = (commentDrafts[postId] || "").trim();
		if (!text) return;
		// Key includes the text: an identical double-submit collapses, but
		// a genuinely new message typed fast still sends.
		const key = `comment:${postId}:${text}`;
		if (inflightRef.current.has(key)) return;
		inflightRef.current.add(key);
		try {
			await api.post("/api/communities", {
				action: "comment",
				slug: data.slug,
				post_id: postId,
				anon_id: anonId,
				author: displayName,
				text,
			});
			setCommentDrafts((d) => ({ ...d, [postId]: "" }));
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed", "err");
		} finally {
			inflightRef.current.delete(key);
		}
	};

	const report = async (postId: string | null) => {
		if (!data) return;
		const reason = postId ? "Inappropriate community post" : "Inappropriate community";
		const key = `report:${postId ?? "community"}`;
		if (inflightRef.current.has(key)) return;
		inflightRef.current.add(key);
		try {
			await api.post("/api/communities", {
				action: "report",
				slug: data.slug,
				post_id: postId,
				anon_id: anonId,
				reason,
			});
			toast("Reported — moderators will review it", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to report", "err");
		} finally {
			inflightRef.current.delete(key);
		}
	};

	const adminOp = async (op: "hide" | "unhide" | "delete") => {
		if (!data) return;
		setBusy(true);
		try {
			await api.post("/api/communities", { action: "admin", slug: data.slug, op });
			toast(op === "delete" ? "Community deleted" : op === "hide" ? "Community hidden" : "Community restored", "ok");
			if (op === "delete") {
				window.location.href = "/communities";
				return;
			}
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed", "err");
		} finally {
			setBusy(false);
		}
	};

	if (notFound) {
		return (
			<div className="max-w-3xl mx-auto px-4 py-16 text-center vb-page-enter">
				<div className="text-5xl mb-4">🔍</div>
				<h1 className="font-display font-bold text-xl">Community not found</h1>
				<p className="text-sm text-ink3 mt-2 mb-5">
					It may have been removed or hidden by a moderator.
				</p>
				<Link to="/communities" className="btn btn-primary !text-sm">
					<ArrowLeft size={15} /> Back to communities
				</Link>
			</div>
		);
	}

	if (loadError && !data) {
		return (
			<div className="max-w-3xl mx-auto px-4 py-16 text-center vb-page-enter">
				<div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-warn/10 text-warn mb-4">
					<AlertTriangle size={26} />
				</div>
				<h1 className="font-display font-bold text-xl">
					Couldn't load this community
				</h1>
				<p className="text-sm text-ink3 mt-2 mb-5 max-w-sm mx-auto">
					{loadError} — the community itself is still here, so this is
					worth retrying.
				</p>
				<div className="flex flex-wrap items-center justify-center gap-2">
					<button
						className="btn btn-primary !text-sm"
						onClick={() => void load()}
					>
						<RefreshCw size={14} /> Retry
					</button>
					<Link to="/communities" className="btn btn-ghost !text-sm">
						<ArrowLeft size={15} /> Back to communities
					</Link>
				</div>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="max-w-3xl mx-auto px-4 py-16">
				<div className="card p-8 animate-pulse bg-surface2/60" />
			</div>
		);
	}

	return (
		<div className="max-w-3xl mx-auto px-4 py-8 vb-page-enter">
			<Link
				to="/communities"
				className="inline-flex items-center gap-1.5 text-xs text-ink3 hover:text-accent mb-4 transition-colors"
			>
				<ArrowLeft size={13} /> All communities
			</Link>

			{/* Header */}
			<div className="card p-5 mb-5">
				<div className="flex items-start gap-4 flex-wrap">
					<div className="w-14 h-14 rounded-2xl bg-surface3 flex items-center justify-center text-3xl flex-shrink-0 vb-avatar">
						{data.avatar}
					</div>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2 flex-wrap">
							<h1 className="font-display font-bold text-xl">{data.name}</h1>
							{data.hidden && (
								<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-bad/10 text-bad">
									HIDDEN
								</span>
							)}
						</div>
						<p className="text-sm text-ink2 mt-0.5">
							{data.description || "No description yet."}
						</p>
						<div className="flex items-center gap-3 text-[11px] text-ink3 mt-2">
							<span className="inline-flex items-center gap-1">
								<Users size={11} /> {data.member_count} members
							</span>
							<span className="inline-flex items-center gap-1">
								<MessageSquare size={11} /> {data.post_count} posts
							</span>
							<span>Created {timeAgoShort(data.created_at)}</span>
						</div>
					</div>
					<div className="flex items-center gap-2 flex-shrink-0">
						<button
							className="btn btn-ghost !text-sm !py-2"
							onClick={() => void load()}
							aria-label="Refresh community"
							title="Refresh community"
						>
							<RefreshCw size={14} /> Refresh
						</button>
						{!data.is_member ? (
							<button className="btn btn-primary !text-sm !py-2" disabled={busy} onClick={() => void joinLeave()}>
								<Plus size={15} /> Join
							</button>
						) : (
							<button className="btn btn-ghost !text-sm !py-2" disabled={busy} onClick={() => void joinLeave()}>
								Leave
							</button>
						)}
						<button
							className="btn btn-ghost !text-sm !p-2"
							title="Report community"
							onClick={() => void report(null)}
						>
							<Flag size={14} />
						</button>
					</div>
				</div>
				{isAdmin && (
					<div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
						<span className="text-[11px] text-ink3 mr-1">Admin:</span>
						<button className="btn btn-ghost !text-xs !py-1 !px-2.5" onClick={() => void adminOp(data.hidden ? "unhide" : "hide")}>
							{data.hidden ? "Unhide" : "Hide"}
						</button>
						<button
							className="btn btn-ghost !text-xs !py-1 !px-2.5 !text-bad"
							onClick={() => {
								if (confirm(`Delete "${data.name}"? This removes all its discussions.`)) void adminOp("delete");
							}}
						>
							Delete
						</button>
					</div>
				)}
			</div>

			{/* Composer (members only) */}
			{data.is_member ? (
				<div className="card p-4 mb-5">
					<textarea
						className="input !py-2.5 !text-sm w-full min-h-16 resize-none"
						placeholder={`Share something with ${data.name}…`}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						maxLength={500}
					/>
					{/* Poll composer (toggle + fields) */}
					{pollOpen && (
						<div className="mt-3 pt-3 border-t border-border space-y-2.5">
							<div className="flex items-center gap-2">
								<BarChart3 size={14} className="text-accent flex-shrink-0" />
								<input
									className="input !py-2 !text-sm flex-1"
									placeholder="Poll question…"
									value={pollQuestion}
									onChange={(e) => setPollQuestion(e.target.value)}
									maxLength={80}
									aria-label="Poll question"
								/>
								<button
									className="btn btn-ghost !p-1.5"
									title="Remove poll"
									onClick={() => {
										setPollOpen(false);
										setPollQuestion("");
										setPollOptions(["", ""]);
									}}
								>
									<X size={14} className="text-ink3" />
								</button>
							</div>
							{pollOptions.map((opt, i) => (
								<div key={i} className="flex gap-2">
									<input
										className="input !py-1.5 !text-sm flex-1"
										placeholder={`Option ${i + 1}`}
										value={opt}
										onChange={(e) =>
											setPollOptions((o) =>
												o.map((v, j) => (j === i ? e.target.value : v)),
											)
										}
										maxLength={40}
										aria-label={`Poll option ${i + 1}`}
									/>
									{pollOptions.length > 2 && (
										<button
											className="btn btn-ghost !p-1.5"
											title="Remove option"
											onClick={() =>
												setPollOptions((o) => o.filter((_, j) => j !== i))
											}
										>
											<X size={13} className="text-ink3" />
										</button>
									)}
								</div>
							))}
							{pollOptions.length < 4 && (
								<button
									className="btn btn-ghost !text-xs !py-1 !px-3"
									onClick={() => setPollOptions((o) => [...o, ""])}
								>
									<Plus size={13} /> Add option
								</button>
							)}
						</div>
					)}
					<div className="flex items-center justify-between gap-2 mt-2">
						<button
							className={`btn !text-xs !py-2 !px-3 ${pollOpen ? "btn-primary" : "btn-ghost"}`}
							onClick={() => setPollOpen((v) => !v)}
						>
							<BarChart3 size={13} /> Poll
						</button>
						<button
							className="btn btn-primary !text-xs !py-2 !px-4"
							disabled={busy || !draft.trim()}
							onClick={() => void postMessage()}
						>
							<Send size={13} /> Post
						</button>
					</div>
				</div>
			) : (
				<div className="card p-4 mb-5 text-center text-sm text-ink3">
					Join this community to join the discussion.
				</div>
			)}

			{/* Feed */}
			{data.posts.length === 0 ? (
				<div className="card p-10 text-center">
					<div className="text-3xl mb-2">💬</div>
					<p className="text-sm text-ink3">
						No posts yet — {data.is_member ? "start the conversation above" : "be the first member to post"}.
					</p>
				</div>
			) : (
				<div className="space-y-3">
					{data.posts.map((p) => (
						<div key={p.id} className="card p-4">
							<div className="flex items-center gap-2 mb-1.5">
								<div className="w-7 h-7 rounded-lg bg-surface3 flex items-center justify-center text-sm flex-shrink-0 vb-avatar">
									{data.avatar}
								</div>
								<span className="text-xs font-medium text-ink">
									{authorName(p.author, p.anon_id)}
								</span>
								<span className="text-[10px] text-ink3">{timeAgoShort(p.created_at)}</span>
								<span className="ml-auto">
									<button
										className="btn btn-ghost !p-1"
										title="Report post"
										onClick={() => void report(p.id)}
									>
										<Flag size={12} className="text-ink3" />
									</button>
								</span>
							</div>
							<p className="text-sm text-ink leading-relaxed whitespace-pre-wrap break-words">
								{p.text}
							</p>

							{/* Attached poll */}
							{p.poll && (
								<div className="mt-3 p-3.5 rounded-xl border border-border bg-surface2/50">
									<div className="flex items-center gap-2 mb-2.5">
										<BarChart3 size={14} className="text-accent flex-shrink-0" />
										<span className="text-xs font-semibold text-ink leading-snug">
											{p.poll.question}
										</span>
									</div>
									<div className="space-y-1.5">
										{p.poll.options.map((o) => {
											const total = p.poll!.total_votes || 0;
											const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
											const mine = p.poll!.my_vote === o.id;
											return (
												<button
													key={o.id}
													onClick={() => void vote(p.id, o.id)}
													disabled={!!p.poll!.my_vote}
													className={`relative w-full text-left px-3 py-2 rounded-lg border text-xs transition-all overflow-hidden ${
														mine
															? "border-accent bg-accent/10 text-ink"
															: "border-border hover:border-accent/40 bg-surface1"
													}`}
												>
													{total > 0 && (
														<span
															className="absolute inset-y-0 left-0 bg-accent/15 transition-all"
															style={{ width: `${pct}%` }}
														/>
													)}
													<span className="relative flex items-center justify-between gap-2">
														<span className="font-medium text-ink">{o.text}</span>
														<span className="text-[10px] text-ink3 flex-shrink-0">
															{total > 0 ? `${o.votes} · ${pct}%` : o.votes}
														</span>
													</span>
												</button>
											);
										})}
									</div>
									<p className="text-[10px] text-ink3 mt-2">
										{p.poll.my_vote
											? `${p.poll.total_votes} vote${p.poll.total_votes === 1 ? "" : "s"} — tap an option to change your vote`
											: `${p.poll.total_votes} vote${p.poll.total_votes === 1 ? "" : "s"} — tap to vote`}
									</p>
								</div>
							)}

							{/* Author / admin controls */}
							{(isAdmin || p.anon_id === anonId) && (
								<div className="flex items-center gap-1.5 mt-2">
									{p.poll && (
										<button
											className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-good/30 text-good hover:bg-good/10 transition-all"
											onClick={() => void solvePoll(p.id)}
											title="Mark poll solved — removes this post and its poll"
										>
											<CheckCircle2 size={12} /> Solve poll
										</button>
									)}
									<button
										className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-bad/30 text-bad hover:bg-bad/10 transition-all"
										onClick={() => void deletePost(p.id)}
										title="Delete post"
									>
										<Trash2 size={12} /> Delete
									</button>
								</div>
							)}

							<div className="flex items-center gap-1.5 mt-3">
								{REACTION_KINDS.map(({ kind, icon: Icon, label }) => {
									const active = !!p.mine_reactions[kind];
									const count = p.reaction_counts[kind] || 0;
									return (
										<button
											key={kind}
											onClick={() => void react(p.id, kind)}
											title={label}
											className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-all ${
												active
													? "border-accent bg-accent/10 text-accent"
													: "border-border text-ink3 hover:border-accent/40 hover:text-ink2"
											}`}
										>
											<Icon size={12} />
											{count > 0 ? count : label}
										</button>
									);
								})}
								<button
									onClick={() =>
										setOpenComments((o) => ({ ...o, [p.id]: !o[p.id] }))
									}
									className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-border text-ink3 hover:border-accent/40 hover:text-ink2 transition-all"
								>
									<MessageSquare size={12} />
									{p.comments.length}
								</button>
							</div>

							{openComments[p.id] && (
								<div className="mt-3 pt-3 border-t border-border space-y-2">
									{p.comments.map((c) => (
										<div key={c.id} className="text-xs">
											<span className="font-medium text-ink">
												{authorName(c.author, c.anon_id)}
											</span>
											<span className="text-ink3"> · {timeAgoShort(c.created_at)}</span>
											<p className="text-ink2 leading-relaxed mt-0.5 whitespace-pre-wrap break-words">
												{c.text}
											</p>
										</div>
									))}
									<div className="flex gap-2">
										<input
											className="input !py-1.5 !text-xs flex-1"
											placeholder="Reply…"
											value={commentDrafts[p.id] || ""}
											onChange={(e) =>
												setCommentDrafts((d) => ({ ...d, [p.id]: e.target.value }))
											}
											maxLength={400}
											onKeyDown={(e) => {
												if (e.key === "Enter" && !e.shiftKey) void comment(p.id);
											}}
										/>
										<button
											className="btn btn-primary !text-xs !py-1.5 !px-3"
											disabled={!(commentDrafts[p.id] || "").trim()}
											onClick={() => void comment(p.id)}
										>
											Send
										</button>
									</div>
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
