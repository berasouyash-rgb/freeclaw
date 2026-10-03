import {
	AlertTriangle,
	BarChart3,
	Bell,
	Bookmark,
	Download,
	Eye,
	FileText,
	MessageCircle,
	PlayCircle,
	RefreshCcw,		Save,
		Scale,
		Trash2,
		UserCircle2,
	} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { resetTutorial } from "../components/Tutorial";
import { ConfirmDialog } from "../components/ui";
import { useApp } from "../contexts/AppContext";
import { api } from "../lib/api";	import { anonCreatedAt, lsGet } from "../lib/identity";
import { downloadFile, safeStringify, timeAgo } from "../lib/utils";
import { SERVER_PII_COPY } from "../lib/privacyCopy";
import type {
	CommentData,
	PollData,
	PollVote,
	PostData,
	ReactionEntry,
} from "../types";

type Tab =
	| "posts"
	| "polls"
	| "comments"
	| "votes"
	| "bookmarks"
	| "drafts"
	| "notifications"
	| "viewed"
	| "appeals";

interface AppealRow {
	id: string;
	surface: string;
	title: string;
	body: string;
	status: string;
	review_note?: string;
	created_at: string;
	published?: { kind: string; id: string };
}

type ActivitySection =
	| "posts"
	| "polls"
	| "comments"
	| "votes"
	| "bookmarks"
	| "appeals";

type SectionStatus = "loading" | "ready" | "error";

const ACTIVITY_SECTIONS: ActivitySection[] = [
	"posts",
	"polls",
	"comments",
	"votes",
	"bookmarks",
	"appeals",
];

function SectionBoundary({
	status,
	error,
	hasData,
	label,
	lastUpdatedAt,
	onRetry,
	children,
}: {
	status: SectionStatus;
	error?: string;
	hasData: boolean;
	label: string;
	lastUpdatedAt?: number;
	onRetry: () => void;
	children: ReactNode;
}) {
	if (status === "loading" && !hasData) {
		return (
			<div className="space-y-3" aria-busy="true" aria-label={`Loading ${label}`}>
				{[1, 2, 3].map((i) => (
					<div key={i} className="skeleton h-20" />
				))}
			</div>
		);
	}

	if (status === "error" && !hasData) {
		return (
			<div
				role="alert"
				className="card border-warn/30 bg-warn/[0.06] p-4 flex flex-col sm:flex-row sm:items-center gap-3"
			>
				<AlertTriangle size={18} className="text-warn shrink-0" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold text-ink2">
						Couldn&apos;t load {label}
					</p>
					<p className="text-xs text-ink3 mt-0.5">
						Your last successful {label} are preserved. {error}
					</p>
				</div>
				<button
					type="button"
					className="btn btn-soft !text-xs shrink-0"
					onClick={onRetry}
					aria-label={`Retry ${label}`}
				>
					<RefreshCcw size={13} /> Retry
				</button>
			</div>
		);
	}

	return (
		<>
			{status === "error" && (
				<div
					role="status"
					className="card border-warn/30 bg-warn/[0.06] p-3 mb-3 flex flex-wrap items-center justify-between gap-2"
				>
					<p className="text-xs text-ink2">
						Showing the last successful {label}. {error}
					</p>
					<button
						type="button"
						className="btn btn-soft !text-xs"
						onClick={onRetry}
						aria-label={`Retry ${label}`}
					>
						<RefreshCcw size={12} /> Retry
					</button>
				</div>
			)}
			{status === "loading" && hasData && (
				<p role="status" className="text-[11px] text-ink3 mb-2">
					Refreshing {label.toLowerCase()}…
				</p>
			)}
			{lastUpdatedAt && status === "ready" && (
				<p className="text-[11px] text-ink3 mb-2">
					Updated {timeAgo(new Date(lastUpdatedAt).toISOString())}
				</p>
			)}
			{children}
		</>
	);
}

export default function MyActivity() {
	const {
		anonId,
		toast,
		displayName,
		profile,
		notifications,
		bookmarks,
		recentlyViewed,
		retireNotifsForLink,
	} = useApp();
	const nav = useNavigate();
	const [tab, setTab] = useState<Tab>("posts");
	const [posts, setPosts] = useState<PostData[]>([]);
	const [myPolls, setMyPolls] = useState<PollData[]>([]);
	const [comments, setComments] = useState<CommentData[]>([]);
	const [reactions, setReactions] = useState<ReactionEntry[]>([]);
	const [pollVotes, setPollVotes] = useState<PollVote[]>([]);
	const [bookmarkPosts, setBookmarkPosts] = useState<PostData[]>([]);
	const [appeals, setAppeals] = useState<AppealRow[]>([]);
	const [sectionStatus, setSectionStatus] = useState<
		Record<ActivitySection, SectionStatus>
	>({
		posts: "loading",
		polls: "loading",
		comments: "loading",
		votes: "loading",
		bookmarks: "loading",
		appeals: "loading",
	});
	const [sectionErrors, setSectionErrors] = useState<
		Partial<Record<ActivitySection, string>>
	>({});
	const [sectionUpdatedAt, setSectionUpdatedAt] = useState<
		Partial<Record<ActivitySection, number>>
	>({});
	const [exporting, setExporting] = useState(false);
	const [dialog, setDialog] = useState<{
		kind: "deletePost" | "deletePoll";
		payload?: string;
	} | null>(null);

	const errorMessage = (error: unknown, fallback: string) =>
		error instanceof Error ? error.message : fallback;

	const loadSection = useCallback(
		async (section: ActivitySection, bookmarkIds: string[] = []) => {
			setSectionStatus((current) => ({ ...current, [section]: "loading" }));
			setSectionErrors((current) => {
				const next = { ...current };
				delete next[section];
				return next;
			});

			try {
				switch (section) {
					case "posts": {
						const result = await api.get<PostData[]>(
							`/api/posts?author=${anonId}&viewer=${anonId}`,
						);
						setPosts(Array.isArray(result) ? result : []);
						break;
					}
					case "comments": {
						const result = await api.get<CommentData[]>(
							`/api/comments?author=${anonId}&viewer=${anonId}`,
						);
						setComments(
							(Array.isArray(result) ? result : []).filter((comment) => !comment.deleted),
						);
						break;
					}
					case "votes": {
						const [reactionResult, voteResult] = await Promise.all([
							api.get<ReactionEntry[]>(`/api/reactions?author=${anonId}`),
							api.get<PollVote[]>(`/api/polls?voter=${anonId}`),
						]);
						setReactions(Array.isArray(reactionResult) ? reactionResult : []);
						setPollVotes(Array.isArray(voteResult) ? voteResult : []);
						break;
					}
					case "polls": {
						const [pollResult, voteResult] = await Promise.all([
							api.get<PollData[]>(`/api/polls?viewer=${anonId}`),
							api.get<PollVote[]>(`/api/polls?voter=${anonId}`),
						]);
						setMyPolls(
							(Array.isArray(pollResult) ? pollResult : []).filter(
								(poll) => poll.is_mine && !poll.deleted,
							),
						);
						setPollVotes(Array.isArray(voteResult) ? voteResult : []);
						break;
					}
					case "bookmarks": {
						if (!bookmarkIds.length) {
							setBookmarkPosts([]);
							break;
						}
						const result = await api.get<PostData[]>(
							`/api/posts?ids=${bookmarkIds.join(",")}`,
						);
						setBookmarkPosts(Array.isArray(result) ? result : []);
						break;
					}
					case "appeals": {
						const result = await api.get<AppealRow[] | { items?: AppealRow[] }>(
							`/api/appeals`,
						);
						setAppeals(
							Array.isArray(result) ? result : (result.items ?? []),
						);
						break;
					}
				}
				setSectionUpdatedAt((current) => ({
					...current,
					[section]: Date.now(),
				}));
				setSectionStatus((current) => ({ ...current, [section]: "ready" }));
			} catch (error: unknown) {
				setSectionStatus((current) => ({ ...current, [section]: "error" }));
				setSectionErrors((current) => ({
					...current,
					[section]: errorMessage(
						error,
						`The ${section} service did not respond.`,
					),
				}));
			}
		},
		[anonId],
	);

	const loadAll = useCallback(async () => {
		await Promise.all(
			ACTIVITY_SECTIONS.filter((section) => section !== "bookmarks").map((section) =>
				loadSection(section),
			),
		);
	}, [loadSection]);

	useEffect(() => {
		void loadAll();
	}, [loadAll]);

	const bookmarkKey = bookmarks.join(",");

	useEffect(() => {
		void loadSection(
			"bookmarks",
			bookmarkKey ? bookmarkKey.split(",").filter(Boolean) : [],
		);
	}, [bookmarkKey, loadSection]);

	const deletePoll = async (id: string) => {
		try {
			await api.put("/api/polls", { id, author_id: anonId, deleted: true });
			setMyPolls((p) => p.filter((x) => x.id !== id));
			toast("Poll deleted", "info", {
				label: "Undo (30s)",
				fn: async () => {
					await api.put("/api/polls", {
						id,
						author_id: anonId,
						deleted: false,
					});
					void loadSection("polls");
					toast("Poll restored", "ok");
				},
			});
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Delete failed", "err");
		}
	};

	const deletePost = async (id: string) => {
		try {
			await api.put("/api/posts", { id, author_id: anonId, deleted: true });
			setPosts((p) => p.filter((x) => x.id !== id));
			// Retire its "live" notice too — otherwise notifications keep
			// claiming posts that no longer exist.
			retireNotifsForLink(`/post/${id}`);
			toast("Deleted", "info", {
				label: "Undo (30s)",
				fn: async () => {
					await api.put("/api/posts", {
						id,
						author_id: anonId,
						deleted: false,
					});
					void loadSection("posts");
					toast("Restored", "ok");
				},
			});
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Delete failed", "err");
		}
	};

	const localBundle = () => ({
		anon_id: anonId,
		exported_at: new Date().toISOString(),
		posts,
		comments,
		reactions,
		poll_votes: pollVotes,
		bookmarks,
		notifications,
		recently_viewed: recentlyViewed,
		draft: lsGet("vb:drafts", null),
	});

	const exportData = async () => {
		// Defense-in-depth: the Export button is disabled={exporting}, and React
		// does not dispatch clicks on disabled buttons, so re-entrancy is already
		// blocked at the DOM level — this guard is unreachable in tests.
		/* v8 ignore next -- @preserve */
		if (exporting) return;
		setExporting(true);
		try {
			const server = await api.get<Record<string, unknown>>(
				`/api/data-export?anon_id=${anonId}`,
			);
			downloadFile(
				`voicebox-data-${anonId.slice(0, 10)}.json`,
				safeStringify(
					{
						...server,
						bookmarks,
						recently_viewed: recentlyViewed,
						draft: lsGet("vb:drafts", null),
					},
					2,
				),
			);
			toast("All your data exported", "ok");
		} catch {
			downloadFile(
				`voicebox-activity-${anonId.slice(0, 10)}.json`,
				safeStringify(localBundle(), 2),
			);
			toast("Offline — exported your on-device activity", "ok");
		}
		setExporting(false);
	};

	const draft = lsGet<{
		title?: string;
		desc?: string;
		savedAt?: string;
	} | null>("vb:drafts", null);

	const TABS: {
		key: Tab;
		label: string;
		icon: typeof FileText;
		count: number;
	}[] = [
		{ key: "posts", label: "Posts", icon: FileText, count: posts.length },
		{ key: "polls", label: "My Polls", icon: BarChart3, count: myPolls.length },
		{
			key: "comments",
			label: "Comments",
			icon: MessageCircle,
			count: comments.length,
		},
		{
			key: "votes",
			label: "Votes",
			icon: BarChart3,
			count: reactions.length + pollVotes.length,
		},
		{
			key: "bookmarks",
			label: "Bookmarks",
			icon: Bookmark,
			count: bookmarks.length,
		},
		{
			key: "drafts",
			label: "Drafts",
			icon: Save,
			count: draft?.title || draft?.desc ? 1 : 0,
		},
		{
			key: "notifications",
			label: "Notifications",
			icon: Bell,
			count: notifications.length,
		},
		{
			key: "viewed",
			label: "Recently viewed",
			icon: Eye,
			count: recentlyViewed.length,
		},
		{
			key: "appeals",
			label: "My appeals",
			icon: Scale,
			count: appeals.length,
		},
	];

	const sectionHasData = (section: ActivitySection) => {
		switch (section) {
			case "posts":
				return posts.length > 0;
			case "polls":
				return myPolls.length > 0;
			case "comments":
				return comments.length > 0;
			case "votes":
				return reactions.length > 0 || pollVotes.length > 0;
			case "bookmarks":
				return bookmarkPosts.length > 0;
			case "appeals":
				return appeals.length > 0;
		}
	};

	const hasAnyActivityData = ACTIVITY_SECTIONS.some(sectionHasData);
	const sectionsRequiringData = ACTIVITY_SECTIONS.filter(
		(section) => section !== "bookmarks" || bookmarks.length > 0,
	);
	const allSectionsUnavailable =
		!hasAnyActivityData &&
		sectionsRequiringData.every((section) => sectionStatus[section] === "error");

	const retrySection = (section: ActivitySection) => {
		void loadSection(section, section === "bookmarks" ? bookmarks : []);
	};

	return (
		<div className="max-w-3xl mx-auto">
			{/* Profile card */}
			<div className="card p-5 sm:p-6 mb-5 vb-rise">
				<div className="flex items-center gap-4">
					{profile?.photo ? (
						<img
							src={profile.photo}
							alt="Your profile"
							className="w-14 h-14 rounded-2xl object-cover vb-avatar"
						/>
					) : (
						<span className="w-14 h-14 rounded-2xl bg-surface3 grid place-items-center text-2xl vb-avatar">
							{profile?.avatar || <UserCircle2 size={30} className="text-accent" />}
						</span>
					)}
					<div className="min-w-0">
						<h1 className="font-display font-bold text-lg">
							{displayName || "Anonymous profile"}
						</h1>
						<p className="text-xs text-ink3">
							ID <code className="font-mono text-accent">{anonId}</code> ·
							created {timeAgo(anonCreatedAt())}
						</p>
						{profile.bio && (
							<p className="text-xs text-ink2 mt-1.5 leading-relaxed">{profile.bio}</p>
						)}
					</div>
				</div>
				<div className="flex flex-wrap gap-2 mt-4">
					<button
						className="btn btn-ghost !text-xs"
						onClick={exportData}
						disabled={exporting}
					>
						<Download size={13} /> {exporting ? "Exporting…" : "Export my data"}
					</button>
					<button
						className="btn btn-ghost !text-xs"
						onClick={() => {
							resetTutorial();
							nav("/");
						}}
					>
						<PlayCircle size={13} /> Replay tutorial
					</button>						<Link
							to="/settings"
							className="btn btn-ghost !text-xs"
						>
							<UserCircle2 size={13} /> Edit profile
						</Link>
					</div>
				<p className="text-[11px] text-ink3 mt-3 flex items-start gap-1.5">
					<AlertTriangle size={11} className="mt-0.5 shrink-0" /> {SERVER_PII_COPY}
				</p>
			</div>

			{/* Tabs */}
			<div className="flex gap-1.5 overflow-x-auto pb-2 mb-4">
				{TABS.map(({ key, label, icon: Icon, count }) => (
					<button
						key={key}
						onClick={() => setTab(key)}
						className={`btn !py-1.5 !px-3 !text-xs shrink-0 ${tab === key ? "btn-primary" : "btn-ghost"}`}
					>
						<Icon size={13} /> {label}{" "}
						<span className="opacity-70">({count})</span>
					</button>
				))}
			</div>

			{allSectionsUnavailable && (
				<div
					role="alert"
					className="card border-warn/30 bg-warn/[0.06] p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3"
				>
					<AlertTriangle size={18} className="text-warn shrink-0" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold text-ink2">
							Couldn&apos;t load your activity
						</p>
						<p className="text-xs text-ink3 mt-0.5">
							Your posts may still be here — the last successful lists are preserved. Try again when the activity service responds.
						</p>
					</div>
					<button
						type="button"
						className="btn btn-soft !text-xs shrink-0"
						onClick={() => void loadAll()}
						aria-label="Try again — retry posts and activity"
					>
						<RefreshCcw size={13} /> Try again
					</button>
				</div>
			)}

			{!allSectionsUnavailable && tab === "posts" && (
				<SectionBoundary
					status={sectionStatus.posts}
					error={sectionErrors.posts}
					hasData={sectionHasData("posts")}
					label="posts"
					lastUpdatedAt={sectionUpdatedAt.posts}
					onRetry={() => retrySection("posts")}
				>
					<div className="space-y-2.5">
					{posts.length === 0 && (
						<Empty text="You haven't posted anything yet." />
					)}
					{posts.map((p) => (
						<div key={p.id} className="card p-3.5 flex items-center gap-3">
							<div className="min-w-0 flex-1">
								<Link
									to={`/post/${p.id}`}
									className="font-semibold text-sm hover:text-accent line-clamp-1"
								>
									{p.title}
								</Link>
								<p className="text-xs text-ink3">
									{p.type} · {p.category} · {p.status.replace("_", " ")} ·{" "}
									{timeAgo(p.created_at)}
									{p.hidden && (
										<span className="ml-1 rounded-full bg-warn/15 px-1.5 py-0.5 font-semibold text-warn">
											Hidden by moderators
										</span>
									)}
								</p>
							</div>
							<button
								className="btn btn-danger !p-2 shrink-0"
								onClick={() => setDialog({ kind: "deletePost", payload: p.id })}
								aria-label="Delete post"
							>
								<Trash2 size={14} />
							</button>
						</div>
					))}
					</div>
				</SectionBoundary>
			)}

			{!allSectionsUnavailable && tab === "polls" && (
				<SectionBoundary
					status={sectionStatus.polls}
					error={sectionErrors.polls}
					hasData={sectionHasData("polls")}
					label="polls"
					lastUpdatedAt={sectionUpdatedAt.polls}
					onRetry={() => retrySection("polls")}
				>
					<div className="space-y-2.5">
					{myPolls.length === 0 && (
						<Empty text="You haven't created any polls yet." />
					)}
					{myPolls.map((p) => (
						<div
							key={p.id}
							className="card p-3.5 flex items-center gap-3 vb-rise"
						>
							<div className="min-w-0 flex-1">
								<p className="font-semibold text-sm line-clamp-1">{p.title}</p>
								<p className="text-xs text-ink3">
									{p.total_votes || 0} votes · {p.ptype} ·{" "}
									{p.archived ? "archived" : "active"} ·{" "}
									{timeAgo(p.created_at ?? "")}
								</p>
							</div>
							<Link to="/polls" className="btn btn-ghost !text-xs shrink-0">
								View
							</Link>
							<button
								className="btn btn-danger !p-2 shrink-0"
								onClick={() => setDialog({ kind: "deletePoll", payload: p.id })}
								aria-label="Delete poll"
							>
								<Trash2 size={14} />
							</button>
						</div>
					))}
					</div>
				</SectionBoundary>
			)}

			{!allSectionsUnavailable && tab === "comments" && (
				<SectionBoundary
					status={sectionStatus.comments}
					error={sectionErrors.comments}
					hasData={sectionHasData("comments")}
					label="comments"
					lastUpdatedAt={sectionUpdatedAt.comments}
					onRetry={() => retrySection("comments")}
				>
					<div className="space-y-2.5">
					{comments.length === 0 && <Empty text="No comments yet." />}
					{comments.map((c) => (
						<div key={c.id} className="card p-3.5">
							<p className="text-sm line-clamp-2">{c.body}</p>
							<div className="flex justify-between mt-1">
								<Link
									to={`/post/${c.post_id}`}
									className="text-xs text-accent font-semibold hover:underline"
								>
									View thread →
								</Link>
								<span className="text-xs text-ink3">
									{timeAgo(c.created_at)}
								</span>
							</div>
						</div>
					))}
					</div>
				</SectionBoundary>
			)}

			{!allSectionsUnavailable && tab === "votes" && (
				<SectionBoundary
					status={sectionStatus.votes}
					error={sectionErrors.votes}
					hasData={sectionHasData("votes")}
					label="votes"
					lastUpdatedAt={sectionUpdatedAt.votes}
					onRetry={() => retrySection("votes")}
				>
					<div className="space-y-2.5">
					{reactions.length + pollVotes.length === 0 && (
						<Empty text="No votes or reactions yet." />
					)}
					{reactions.map((r) => (
						<div
							key={r.id}
							className="card p-3 flex items-center gap-2 text-sm"
						>
							<span className="chip capitalize">{r.kind}</span>
							<Link
								to={`/post/${r.target_id}`}
								className="text-accent text-xs font-semibold hover:underline truncate"
							>
								on {r.target_type} {r.target_id.slice(0, 16)}…
							</Link>
						</div>
					))}
					{pollVotes.map((v, i) => (
						<div key={i} className="card p-3 flex items-center gap-2 text-sm">
							<span className="chip">poll vote</span>
							<span className="text-xs text-ink3">
								choices: {v.choices.join(", ")}
							</span>
						</div>
					))}
					</div>
				</SectionBoundary>
			)}

			{!allSectionsUnavailable && tab === "bookmarks" && (
				<SectionBoundary
					status={sectionStatus.bookmarks}
					error={sectionErrors.bookmarks}
					hasData={sectionHasData("bookmarks")}
					label="bookmarks"
					lastUpdatedAt={sectionUpdatedAt.bookmarks}
					onRetry={() => retrySection("bookmarks")}
				>
					<div className="space-y-2.5">
					{bookmarkPosts.length === 0 && (
						<Empty text="No bookmarks yet — tap the bookmark icon on any post." />
					)}
					{bookmarkPosts.map((p) => (
						<Link
							key={p.id}
							to={`/post/${p.id}`}
							className="card card-hover p-3.5 block"
						>
							<p className="font-semibold text-sm line-clamp-1">{p.title}</p>
							<p className="text-xs text-ink3">
								{p.category} · {timeAgo(p.created_at)}
							</p>
						</Link>
					))}
					</div>
				</SectionBoundary>
			)}

			{tab === "drafts" &&
				(draft?.title || draft?.desc ? (
					<div className="card p-4">
						<p className="font-semibold text-sm">
							{draft.title || "(untitled draft)"}
						</p>
						<p className="text-xs text-ink2 mt-1 line-clamp-3">{draft.desc}</p>
						<p className="text-[11px] text-ink3 mt-2">
							Autosaved {draft.savedAt ? timeAgo(draft.savedAt) : ""}
						</p>
						<Link
							to="/submit"
							className="btn btn-soft !text-xs mt-3 inline-flex"
						>
							Continue editing →
						</Link>
					</div>
				) : (
					<Empty text="No drafts. Drafts autosave while you write." />
				))}

			{tab === "notifications" && (
				<div className="space-y-2">
					{notifications.length === 0 && <Empty text="No notifications yet." />}
					{notifications.map((n) => (
						<div key={n.id} className="card p-3.5">
							<p className="text-sm font-medium">{n.title}</p>
							<p className="text-xs text-ink3">
								{n.body} · {timeAgo(n.at)}
							</p>
							{n.link && (
								<Link
									to={n.link}
									className="text-xs text-accent font-semibold hover:underline"
								>
									Open →
								</Link>
							)}
						</div>
					))}
				</div>
			)}

			{tab === "viewed" && (
				<div className="space-y-2">
					{recentlyViewed.length === 0 && (
						<Empty text="Nothing viewed recently." />
					)}
					{recentlyViewed.map((id) => (
						<Link
							key={id}
							to={`/post/${id}`}
							className="card card-hover p-3 block text-sm font-mono text-ink2 hover:text-accent"
						>
							{id}
						</Link>
					))}
				</div>
			)}

			{!allSectionsUnavailable && tab === "appeals" && (
				<SectionBoundary
					status={sectionStatus.appeals}
					error={sectionErrors.appeals}
					hasData={sectionHasData("appeals")}
					label="appeals"
					lastUpdatedAt={sectionUpdatedAt.appeals}
					onRetry={() => retrySection("appeals")}
				>
					<div className="space-y-2">
					{appeals.length === 0 && (
						<Empty text="No appeals yet. If safety blocks a post, comment, or poll, you can appeal for human review." />
					)}
					{appeals.map((a) => (
						<div key={a.id} className="card p-3.5">
							<p className="text-sm font-medium">
								{a.title || a.body.slice(0, 60)}{" "}
								<span className="text-xs text-ink3">({a.surface})</span>
							</p>
							<p className="text-xs text-ink3">
								{a.status === "open" && "Under review — a moderator will decide."}
								{a.status === "upheld" && "Reviewed — the block stands. Rephrase and resubmit."}
								{a.status === "overturned" && "Approved — your content is live."}{" "}
								· {timeAgo(a.created_at)}
							</p>
							{a.review_note && (
								<p className="text-xs text-ink2">Moderator note: {a.review_note}</p>
							)}
							{a.status === "overturned" && a.published?.kind === "post" && (
								<Link
									to={`/post/${a.published.id}`}
									className="text-xs text-accent font-semibold hover:underline"
								>
									View published post →
								</Link>
							)}
						</div>
					))}
					</div>
				</SectionBoundary>
			)}

			<ConfirmDialog
				open={dialog?.kind === "deletePoll"}
				onClose={() => setDialog(null)}
				onConfirm={() =>
					dialog?.payload ? deletePoll(dialog.payload) : undefined
				}
				title="Delete this poll?"
				message="Your poll and its results will be removed. You can undo within 30 seconds."
				confirmLabel="Delete poll"
				danger
			/>
			<ConfirmDialog
				open={dialog?.kind === "deletePost"}
				onClose={() => setDialog(null)}
				onConfirm={() =>
					dialog?.payload ? deletePost(dialog.payload) : undefined
				}
				title="Delete this post?"
				message="Your post will be removed from the feed. You can undo within 30 seconds using the toast at the bottom of the screen."
				confirmLabel="Delete"
				danger
			/>		</div>
	);
}

function Empty({ text }: { text: string }) {
	return <div className="card p-8 text-center text-sm text-ink3">{text}</div>;
}
