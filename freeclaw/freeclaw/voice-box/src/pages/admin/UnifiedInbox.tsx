import {
	AlertTriangle,
	ArrowDown,
	ArrowLeftRight,
	Bot,
	BotOff,
	ChevronLeft,
	CloudRain,
	Download,
	Headphones,
	Image as ImageIcon,
	Loader2,
	Lock,
	type LucideIcon,
	Meh,
	MessageSquare,
	Phone,
	Plus,
	RefreshCw,
	Search,
	Send,
	Shield,
	SmilePlus,
	Sparkles,
	Trash2,
	Unlock,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	CopyButton,
	DownloadButton,
	QUICK_REPLIES,
} from "../../components/admin/chat-utils";
import { PromptDialog } from "../../components/ui";
import UpdateNotice from "../../components/admin/UpdateNotice";
import DraftProposal, { type DraftProposalData } from "../../components/admin/DraftProposal";
import { useApp } from "../../contexts/AppContext";
import { useUpdateSignal } from "../../hooks/useUpdateSignal";
import { api } from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { useRealtime } from "../../lib/useRealtime";
import { fmtDate, timeAgo } from "../../lib/utils";
import { useSearchParams } from "react-router";
import type { ChatMessage } from "../../types";

interface ThreadAISummary {
	summary: string;
	entities?: string[];
	resolution_state?: string;
	summarized_at?: string;
	stale?: boolean;
}

interface ThreadTriage {
	topic?: string;
	priority?: string;
	emotion?: string;
	suggested_action?: string;
	at?: string;
}

interface ThreadSummary {
	thread_id: string;
	title?: string;
	source?: "inbox" | "chat";
	last_message?: string;
	summary?: string;
	ai_summary?: ThreadAISummary | null;
	triage?: ThreadTriage | null;
	slang?: { count: number; terms: string[]; messages: number; at?: string } | null;
	updated_at?: string;
	last_at?: string;
	ai_agent?: string;
	unread?: number;
	emotion?: { level?: string };
	state?: {
		agent?: string;
		emotion?: { level?: string };
		emotion_history?: { level: string }[];
		handoff?: boolean;
	};
	[k: string]: unknown;
}

interface ThreadState {
	agent?: string;
	emotion?: { level?: string };
	emotion_history?: { level: string }[];
	handoff?: boolean;
	source?: string;
	[k: string]: unknown;
}

/* ═══════════════════════════════════════════════════════════════
   EMOTION CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const EMOTION_ICONS: Record<string, LucideIcon> = {
	critical: AlertTriangle,
	high: Phone,
	moderate: CloudRain,
	mild: Meh,
	none: SmilePlus,
};
const EMOTION_COLORS: Record<string, string> = {
	critical: "text-red-500 bg-red-500/10 border-red-500/20",
	high: "text-orange-500 bg-orange-500/10 border-orange-500/20",
	moderate: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
	mild: "text-green-500 bg-green-500/10 border-green-500/20",
	none: "text-ink3 bg-surface2 border-border",
};
const EMOTION_LABELS: Record<string, string> = {
	critical: "Crisis",
	high: "High Distress",
	moderate: "Moderate",
	mild: "Mild",
	none: "Neutral",
};

/* ═══════════════════════════════════════════════════════════════
   MESSAGE BUBBLE
   ═══════════════════════════════════════════════════════════════ */

function MessageBubble({
	msg,
	isAdmin,
}: {
	msg: ChatMessage;
	isAdmin: boolean;
}) {
	const htmlBody = useMemo(
		() => (msg.body ? renderMarkdown(msg.body) : ""),
		[msg.body],
	);

	return (
		<div
			className={`group flex ${isAdmin ? "justify-end" : "justify-start"} px-4 chat-msg-anim`}
		>
			<div
				className={`flex ${isAdmin ? "flex-row-reverse" : "flex-row"} items-end gap-2.5 max-w-[78%]`}
			>
				{!isAdmin && (
					<div
						className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mb-5 ${
							msg.sender === "ai" ? "bg-accent/10" : "bg-surface2"
						}`}
					>
						{msg.sender === "ai" ? (
							<Bot size={14} className="text-accent" />
						) : (
							<MessageSquare size={14} className="text-ink3" />
						)}
					</div>
				)}

				<div className="flex flex-col gap-1">
					{!isAdmin && (
						<p
							className={`text-[10px] font-bold mb-0.5 flex items-center gap-1 ${
								msg.sender === "ai" ? "text-accent/70" : "text-ink3"
							}`}
						>
							{msg.sender === "admin" ? (
								<>
									<Shield size={10} /> ADMIN
								</>
							) : msg.sender === "ai" ? (
								<>
									<Bot size={10} /> AI ASSISTANT
								</>
							) : (
								"ANONYMOUS USER"
							)}
						</p>
					)}

					{msg.attachment_url && (
						<div
							className={`rounded-xl overflow-hidden border border-border ${isAdmin ? "rounded-br-md" : "rounded-bl-md"}`}
						>
							{msg.attachment_url.match(/\.(png|jpg|jpeg|gif|webp)/i) ? (
								<img
									src={msg.attachment_url}
									alt="attachment"
									loading="lazy"
									className="max-h-48 object-cover"
								/>
							) : (
								<div className="flex items-center gap-2 px-3 py-2 bg-surface2">
									<ImageIcon size={14} className="text-ink3" />
									<span className="text-xs text-ink2 truncate flex-1">
										{msg.attachment_url.split("/").pop()}
									</span>
									<DownloadButton url={msg.attachment_url} />
								</div>
							)}
						</div>
					)}

					{msg.body && (
						<div
							className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
								isAdmin
									? "bg-accent text-white rounded-br-md"
									: msg.sender === "ai"
										? "bg-surface2 border border-accent/10 rounded-bl-md"
										: "bg-surface2 rounded-bl-md border border-border/50"
							}`}
							dangerouslySetInnerHTML={{ __html: htmlBody }}
						/>
					)}

					<div
						className={`flex items-center gap-1.5 ${isAdmin ? "justify-end" : "justify-start"}`}
					>
						<span className="text-[10px] text-ink3 opacity-0 group-hover:opacity-100 transition-opacity">
							{fmtDate(msg.created_at || "")}
						</span>
						<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
							<CopyButton text={msg.body || ""} />
							{msg.attachment_url && (
								<DownloadButton url={msg.attachment_url} />
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════
   THREAD ITEM — sidebar card
   ═══════════════════════════════════════════════════════════════ */

function ThreadItem({
	t,
	active,
	onClick,
	onDelete,
}: {
	t: ThreadSummary;
	active: boolean;
	onClick: () => void;
	onDelete: () => void;
}) {
	const agent =
		t.source === "inbox" ? t.ai_agent || t.state?.agent || "ai" : "direct";
	const emotion = t.emotion?.level || t.state?.emotion?.level || "none";
	return (
		<div
			className={`relative group border-b border-border/50 cursor-pointer transition-all ${
				active
					? "bg-accent/10 border-l-2 border-l-accent"
					: "border-l-2 border-l-transparent hover:bg-surface2"
			}`}
			onClick={onClick}
		>
			<div className="px-4 py-3">
				<div className="flex items-center gap-2.5">
					<div
						className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
							agent === "emotional"
								? "bg-blue-500/10"
								: agent === "admin"
									? "bg-accent/10"
									: t.source === "chat"
										? "bg-purple-500/10"
										: "bg-surface2"
						}`}
					>
						{agent === "emotional" ? (
							<Headphones size={14} className="text-blue-500" />
						) : agent === "admin" ? (
							<Shield size={14} className="text-accent" />
						) : t.source === "chat" ? (
							<MessageSquare size={14} className="text-purple-500" />
						) : (
							<Bot size={14} className="text-ink3" />
						)}
					</div>

					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span
								className="text-xs font-bold text-ink truncate"
								title={t.thread_id}
							>
								{t.title || `${t.thread_id.slice(0, 20)}`}
							</span>
							{emotion !== "none" && (
								<span
									className={`text-[9px] px-1.5 py-0.5 rounded-full border ${EMOTION_COLORS[emotion]}`}
								>
									{EMOTION_LABELS[emotion]}
								</span>
							)}
							{t.triage?.topic && t.triage.topic !== "unknown" && (
								<span
									className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 truncate max-w-32"
									title={`AI topic: ${t.triage.topic}`}
								>
									{t.triage.topic}
								</span>
							)}
							{t.triage?.priority &&
								(t.triage.priority === "high" ||
									t.triage.priority === "urgent") && (
									<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 font-bold">
										{t.triage.priority}
									</span>
								)}
							{!!t.slang?.count && (
								<span
									data-testid="slang-chip"
									className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-bold truncate max-w-32"
									title={`Slang in this chat: ${(t.slang?.terms || []).join(", ")} — open the thread to review in the inbox`}
								>
									Slang · {t.slang?.terms?.slice(0, 2).join(", ")}{(t.slang?.terms?.length || 0) > 2 ? "…" : ""}
								</span>
							)}
							{t.status === "closed" && (
								<Lock size={10} className="text-ink3 flex-shrink-0" />
							)}
							{t.source === "chat" && (
								<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-500 border border-purple-500/20">
									Chat
								</span>
							)}
						</div>
						{t.ai_summary?.summary ? (
							<p
								className={`text-[11px] truncate mt-0.5 ${t.ai_summary.stale ? "text-ink3 italic" : "text-ink2"}`}
								title={t.ai_summary.stale ? "Summary outdated — open and re-summarize" : t.ai_summary.summary}
							>
								{t.ai_summary.stale ? "✎ " : "✦ "}
								{t.ai_summary.summary}
							</p>
						) : (
							<p className="text-[11px] text-ink3 truncate mt-0.5">
								{t.last_message || t.summary || "No messages yet"}
							</p>
						)}
						<div className="flex items-center gap-1.5 mt-1">
							<span className="text-[10px] text-ink3">
								{timeAgo((t.updated_at || t.last_at) ?? "")}
							</span>
							{agent !== "admin" && agent !== "direct" && (
								<span className="text-[10px] text-accent/70 flex items-center gap-0.5">
									<Bot size={9} /> {agent === "emotional" ? "Emotional" : "AI"}{" "}
									active
								</span>
							)}
						</div>
					</div>

					<div className="flex flex-col items-end gap-1">
						{(t.unread ?? 0) > 0 && (
							<span className="w-5 h-5 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">
								{String(t.unread)}
							</span>
						)}
					</div>
				</div>
			</div>

			<button
				onClick={(e) => {
					e.stopPropagation();
					onDelete();
				}}
				className="absolute top-3 right-10 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
				title="Delete conversation"
			>
				<Trash2 size={12} className="text-red-400" />
			</button>
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════
   UNIFIED INBOX — merged AdminInbox + AdminChat
   ═══════════════════════════════════════════════════════════════ */

export default function UnifiedInbox() {
	const { toast } = useApp();

	const [threads, setThreads] = useState<ThreadSummary[]>([]);
	const [active, setActive] = useState<string | null>(null);
	// Which thread the responses below belong to: briefing fetches can
	// outlive a thread switch, and writing to `active` at resolve time
	// shows thread A's summary on thread B (seen live with a blackmail
	// summary on a hello-only thread). Every writer captures + checks.
	const activeRef = useRef<string | null>(null);
	useEffect(() => {
		activeRef.current = active;
	}, [active]);
	const [searchParams, setSearchParams] = useSearchParams();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [threadState, setThreadState] = useState<ThreadState | null>(null);
	// Which slice the server sent: admins get the last 5 days only.
	const [historyWindow, setHistoryWindow] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	// Platform-wide inbox AI switch (server gates generation too)
	const [aiMode, setAiMode] = useState(true);
	const [aiModeBusy, setAiModeBusy] = useState(false);

	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const [actionBusy, setActionBusy] = useState<string | null>(null);
	const [aiBusy, setAiBusy] = useState(false);
	const [search, setSearch] = useState("");
	const [showSearch, setShowSearch] = useState(false);
	const [threadSearch, setThreadSearch] = useState("");
	const [threadImportance, setThreadImportance] = useState<"important" | "slang" | "all">("important");
	const [showScrollBtn, setShowScrollBtn] = useState(false);
	const [showNew, setShowNew] = useState(false);

	/* ── AI thread summary (spec §11/§51: never force the admin to read the
	 * whole conversation) — fetched on demand from the real
	 * POST /api/inbox {action:"summary"} endpoint and cached per thread. */
	interface ThreadAISummary {
		summary: string;
		entities: string[];
		resolution_state: string;
	}
	const [aiSummary, setAiSummary] = useState<ThreadAISummary | null>(null);
	const [summaryBusy, setSummaryBusy] = useState(false);
	const summaryCache = useRef<Record<string, ThreadAISummary>>({});

	const bottomRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const threadsRef = useRef<ThreadSummary[]>([]);
	threadsRef.current = threads;
	// Last-known source per thread id. Kept separate from `threads` so a
	// conversation that drops out of the listing (e.g. the shared QA/fuzz
	// artifact filter hides threads whose last message matches) still routes
	// to the correct API for messages/send/delete instead of falling back to
	// the inbox table and showing an empty pane.
	const sourceRef = useRef<Record<string, "chat" | "inbox">>({});

	const agent = threadState?.agent || "ai";
	const emotion =
		threadState?.emotion_history?.[threadState.emotion_history.length - 1]
			?.level ||
		threadState?.emotion?.level ||
		"none";
	const handoff = threadState?.handoff || false;
	const EIcon = EMOTION_ICONS[emotion] || SmilePlus;

	// Important only: critical/high emotion, unread user mail, triage
	// priority, or an admin takeover in progress. Search narrows further.
	const isSlangThread = (t: ThreadSummary) => (t.slang?.count || 0) > 0;
	const isImportantThread = (t: ThreadSummary) =>
		t.emotion?.level === "critical" ||
		t.emotion?.level === "high" ||
		(t.unread ?? 0) > 0 ||
		t.triage?.priority === "high" ||
		t.triage?.priority === "urgent" ||
		(t.handoff as boolean | undefined) === true ||
		t.state?.handoff === true;

	const importantCount = useMemo(() => threads.filter(isImportantThread).length, [threads]);
	const slangCount = useMemo(() => threads.filter(isSlangThread).length, [threads]);

	const filteredThreads = useMemo(() => {
		const base = threadImportance === "important" ? threads.filter(isImportantThread) : threadImportance === "slang" ? threads.filter(isSlangThread) : threads;
		if (!threadSearch) return base;
		const q = threadSearch.toLowerCase();
		return base.filter(
			(t) =>
				t.thread_id.toLowerCase().includes(q) ||
				(t.last_message || "").toLowerCase().includes(q) ||
				(t.summary || "").toLowerCase().includes(q),
		);
	}, [threads, threadSearch, threadImportance]);

	/* ── Platform-wide inbox AI switch ───────────────────── */
	useEffect(() => {
		let alive = true;
		api
			.get<{ enabled?: boolean }>("/api/inbox?action=ai_mode")
			.then((cfg) => {
				if (alive && cfg && cfg.enabled === false) setAiMode(false);
			})
			.catch(() => {
				/* default ON */
			});
		return () => {
			alive = false;
		};
	}, []);

	const toggleAiMode = async () => {
		if (aiModeBusy) return;
		const next = !aiMode;
		setAiModeBusy(true);
		try {
			await api.post("/api/inbox", { action: "set_ai_mode", enabled: next });
			setAiMode(next);
			toast(
				next
					? "Inbox AI replies enabled platform-wide"
					: "Inbox AI replies disabled — messages wait for admins",
				"ok",
			);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to update", "err");
		}
		setAiModeBusy(false);
	};

	/* ── Load threads from BOTH APIs ──────────────────────── */
	const loadThreads = useCallback(async (opts?: { fresh?: boolean }) => {		try {
			// Fresh reads bypass the 5s GET cache: the peek revalidates
			// precisely because the database has changed since the tick.
			const reader = opts?.fresh ? api.getFresh : api.get;
			const [inboxRes, chatRes] = await Promise.allSettled([
				reader<ThreadSummary[] | { threads: ThreadSummary[] }>(
					"/api/inbox?threads=1",
				),
				reader<ThreadSummary[] | { threads: ThreadSummary[] }>(
					"/api/chat?threads=1",
				),
			]);

			const inboxThreads =
				inboxRes.status === "fulfilled"
					? Array.isArray(inboxRes.value)
						? inboxRes.value
						: inboxRes.value?.threads || []
					: [];
			const chatThreads =
				chatRes.status === "fulfilled"
					? Array.isArray(chatRes.value)
						? chatRes.value
						: []
					: [];

			const merged = new Map<string, ThreadSummary>();
			for (const t of chatThreads)
				merged.set(t.thread_id, { ...t, source: "chat" });
			for (const t of inboxThreads)
				merged.set(t.thread_id, { ...t, source: "inbox" });

			const sorted = [...merged.values()].sort((a, b) => {
				const da = new Date(a.updated_at || a.last_at || 0).getTime();
				const db = new Date(b.updated_at || b.last_at || 0).getTime();
				return db - da;
			});

			for (const t of sorted)
				if (t.source) sourceRef.current[t.thread_id] = t.source;
			setThreads(sorted);
		} catch (e: unknown) {
			console.warn(
				"[UnifiedInbox] Failed to load threads:",
				e instanceof Error ? e.message : e,
			);
		}
		setLoading(false);
	}, []);

	/* ── Load messages — source-aware ─────────────────────── */
	const loadMessages = useCallback(async (threadId: string, opts?: { fresh?: boolean; quiet?: boolean }) => {
		const t = threadsRef.current.find((x) => x.thread_id === threadId);
		const source = t?.source || sourceRef.current[threadId] || "inbox";
		// Fresh reads bypass the 5s GET cache; quiet skips the mark_read
		// write (read state belongs to explicit open/send paths, never to
		// a background tick — otherwise the peek would clear unread
		// badges just by looking).
		const reader = opts?.fresh ? api.getFresh : api.get;

		try {
			if (source === "chat") {
				const data = await reader<{
					messages: ChatMessage[];
					thread: ThreadState;
				}>(`/api/chat?thread_id=${threadId}`);
				setMessages(data.messages || []);
				setThreadState({ ...data.thread, source: "chat" });
				if (!opts?.quiet) {
					await api.put("/api/chat", {
						action: "mark_read",
						thread_id: threadId,
						as: "admin",
					});
				}
			} else {
				const data = await reader<{
					messages?: ChatMessage[];
					state?: ThreadState;
					history_window?: string;
				}>(`/api/inbox?thread_id=${threadId}`);
				setMessages(data.messages || []);
				setThreadState({ ...(data.state || {}), source: "inbox" });
				setHistoryWindow(data.history_window ?? null);
			}
		} catch (e: unknown) {
			console.warn(
				"[UnifiedInbox] Failed to load messages:",
				e instanceof Error ? e.message : e,
			);
		}
	}, []);

	useEffect(() => {
		loadThreads();
	}, [loadThreads]);
	useEffect(() => {
		if (active) {
			loadMessages(active);
			setAiSummary(summaryCache.current[active] ?? null);
		}
	}, [active, loadMessages]);

	/* ── Pending chat target (e.g. "Message author" from another admin tab) ── */
	const [pendingTarget, setPendingTarget] = useState<string | null>(null);
	useEffect(() => {
		const target = sessionStorage.getItem("vb:adminChatTarget");
		if (target) {
			setPendingTarget(target);
			sessionStorage.removeItem("vb:adminChatTarget");
		}
	}, []);
	useEffect(() => {
		if (!pendingTarget) return;
		// "Message author" / "Message this user" from another tab: open the
		// conversation, creating the local thread when none exists yet (mirrors
		// startNew so the composer works immediately for a brand-new target).
		setActive(pendingTarget);
		sourceRef.current[pendingTarget] = "chat";
		if (!threads.some((t) => t.thread_id === pendingTarget)) {
			setThreads((prev) => [
				{
					thread_id: pendingTarget,
					status: "open",
					updated_at: new Date().toISOString(),
					last_message: "",
					last_at: new Date().toISOString(),
					unread: 0,
					source: "chat",
				},
				...prev,
			]);
		}
		setPendingTarget(null);
	}, [threads, pendingTarget]);

	// Freshness signal, not a refetch: the old wiring reloaded the thread
	// list on every chat event (500ms debounce) plus the open thread —
	// under any conversation the whole inbox rebuilt twice a second and no
	// admin work was possible. Realtime now only raises a badge; the admin
	// pulls threads + the open conversation with the update notice. Own
	// sends still refresh explicitly in send().
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();

	const handleInboxUpdate = useCallback(async () => {
		await loadThreads();
		if (active) await loadMessages(active);
		clearUpdates();
	}, [active, loadMessages, loadThreads, clearUpdates]);

	useRealtime(["chat_messages", "chat_threads"], markUpdatesAvailable, 1_000);

	// ── Visible-only peek (contract evolution 2026-10-05) ──
	// chat_messages / chat_threads are outside the anon realtime contract,
	// so the subscription above can never deliver: new conversations and
	// replies appeared only after a manual Refresh. Every 5s while mounted
	// AND visible (plus on focus/return), revalidate the thread list and
	// the open thread with fresh reads. Read-only by construction: the
	// peek never issues mark_read and never touches loaders — read state
	// still belongs to the explicit open/send paths.
	const peekInbox = useCallback(async () => {
		if (
			typeof document !== "undefined" &&
			document.visibilityState === "hidden"
		)
			return;
		try {
			await loadThreads({ fresh: true });
			const open = activeRef.current;
			if (open) await loadMessages(open, { fresh: true, quiet: true });
		} catch {
			/* offline ok */
		}
	}, [loadThreads, loadMessages]);

	useEffect(() => {
		const id = window.setInterval(() => {
			void peekInbox();
		}, 5_000);
		const refetch = () => {
			void peekInbox();
		};
		window.addEventListener("focus", refetch);
		document.addEventListener("visibilitychange", refetch);
		return () => {
			window.clearInterval(id);
			window.removeEventListener("focus", refetch);
			document.removeEventListener("visibilitychange", refetch);
		};
	}, [peekInbox]);
	// Deep-link (?thread=): digest rows land straight on the chat.
	useEffect(() => {
		const wanted = searchParams.get("thread");
		if (wanted && threads.some((t) => t.thread_id === wanted)) setActive(wanted);
	}, [threads, searchParams]);
	const openThread = (id: string | null) => {
		setActive(id);
		setSearchParams(
			(prev) => {
				const p = new URLSearchParams(prev);
				if (id) p.set("thread", id);
				else p.delete("thread");
				return p;
			},
			{ replace: true },
		);
	};


	/* ── Auto-scroll ──────────────────────────────────────── */
	useEffect(() => {
		if (showScrollBtn) return;
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length, showScrollBtn]);

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight >= 80);
	};

	const onTextChange = (val: string) => {
		setText(val);
		if (inputRef.current) {
			inputRef.current.style.height = "auto";
			inputRef.current.style.height =
				Math.min(inputRef.current.scrollHeight, 160) + "px";
		}
	};

	/* ── Send — source-aware ──────────────────────────────── */
	const send = async (body?: string) => {
		const msg = (body ?? text).trim();
		if (!msg || !active || sending) return;
		setSending(true);
		const t = threadsRef.current.find((x) => x.thread_id === active);
		const source = t?.source || sourceRef.current[active] || "inbox";
		try {
			if (source === "chat") {
				await api.post("/api/chat", {
					thread_id: active,
					sender: "admin",
					body: msg,
				});
			} else {
				await api.post("/api/inbox", {
					thread_id: active,
					sender: "admin",
					body: msg,
				});
			}
			setText("");
			if (inputRef.current) inputRef.current.style.height = "auto";
			await loadMessages(active);
			setShowScrollBtn(false);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to send", "err");
		}
		setSending(false);
		inputRef.current?.focus();
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	};

	/* ── Actions (inbox) ──────────────────────────────────── */
	const doAction = async (action: string, extra?: Record<string, unknown>) => {
		if (!active) return;
		setActionBusy(action);
		try {
			await api.post("/api/inbox", { thread_id: active, action, ...extra });
			toast(`Action: ${action}`, "ok");
			await loadMessages(active);
			await loadThreads();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Action failed", "err");
		}
		setActionBusy(null);
	};

	/* ── Status (chat) ────────────────────────────────────── */
	const setStatus = async (status: "open" | "closed") => {
		if (!active) return;
		try {
			await api.put("/api/chat", {
				action: "set_status",
				thread_id: active,
				status,
			});
			await loadMessages(active);
			await loadThreads();
			toast(`Conversation ${status}`, "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed", "err");
		}
	};

	/* ── AI thread summary — subject/summary/entities/status without
	 * reading all messages. Real endpoint, cached per thread. ─────── */
	const summarize = async () => {
		if (!active || summaryBusy) return;
		const cached = summaryCache.current[active];
		if (cached) {
			setAiSummary(cached);
			return;
		}
		setSummaryBusy(true);
		try {
			// Summarization runs the fast lane + full chain server-side (up to
			// ~30s) — the default 15s budget timed out every real summary.
			const requestedManual = active;
			const r = await api.postLong<{
				ok?: boolean;
				summary?: string;
				entities?: string[];
				resolution_state?: string;
				}>("/api/inbox", { thread_id: active, action: "summary" });
			const s: ThreadAISummary = {
				summary: r.summary || "",
				entities: Array.isArray(r.entities) ? r.entities : [],
				resolution_state: r.resolution_state || "open",
			};
			// Keyed write: a late arrival still belongs to its thread even
			// when the admin moved on — only the DISPLAY is gated.
			if (s.summary) summaryCache.current[requestedManual as string] = s;
			if (requestedManual !== activeRef.current) return;
			setAiSummary(s);
			if (!s.summary)
				toast("No summary yet — empty thread or AI unreachable", "info");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Summary failed", "err");
		}
		setSummaryBusy(false);
	};

	/* ── Auto-summary on open (spec §11/§51: the admin never reads the whole
	 * thread first). When a conversation with real substance (4+ messages)
	 * opens with no cached summary, the agent briefs it once, silently —
	 * failures stay silent (the manual Summarize button reports them). */
	const autoTried = useRef<Set<string>>(new Set());
	useEffect(() => {
		if (!active) return;
		// Cached briefings render regardless of message count — the length
		// gate below is about fetch-worthiness, not display. (A cached
		// summary must survive reopening even on short threads.)
		if (summaryCache.current[active]) {
			setAiSummary(summaryCache.current[active]);
			return;
		}
		if (aiSummary || summaryBusy) return;
		if (messages.length < 4) return;
		if (autoTried.current.has(active)) return;
		autoTried.current.add(active);
		(async () => {
			setSummaryBusy(true);
			try {
				// Same 28s budget as the manual path — auto-briefings die
				// silently on timeout otherwise.
				const requestedAuto = active;
				const r = await api.postLong<{
					ok?: boolean;
					summary?: string;
					entities?: string[];
					resolution_state?: string;
				}>("/api/inbox", { thread_id: active, action: "summary" });
				const s: ThreadAISummary = {
					summary: r.summary || "",
					entities: Array.isArray(r.entities) ? r.entities : [],
					resolution_state: r.resolution_state || "open",
				};
				// Cache only real briefings — an empty auto result must not
				// poison the manual path (which reports honestly when empty).
				if (s.summary) {
					summaryCache.current[requestedAuto as string] = s;
					if (requestedAuto === activeRef.current) setAiSummary(s);
				}
			} catch {
				/* silent: manual Summarize reports failures */
			} finally {
				setSummaryBusy(false);
			}
		})();
	}, [active, messages, aiSummary, summaryBusy]);

	/* ── AI suggest ───────────────────────────────────────── */
	const aiSuggest = async () => {
		if (!messages.length) {
			setText(QUICK_REPLIES[0] ?? "");
			return;
		}
		setAiBusy(true);
		try {
			// Drafting runs the full chain (up to ~28s) — never the 15s default.
			const r = await api.postLong<{ reply?: string; engine?: string }>(
				"/api/assist",
				{
					task: "chat_reply",
					messages: messages.map((m) => ({ sender: m.sender, body: m.body })),
				},
			);
			if (r.reply) {
				setText(r.reply);
				toast(
					r.engine === "keyword"
						? "Suggested reply (add NVIDIA_API_KEY for smarter AI)"
						: "AI reply drafted — edit before sending",
					"info",
				);
				inputRef.current?.focus();
			}
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "AI suggest failed", "err");
		}
		setAiBusy(false);
	};

	/* ── New conversation ─────────────────────────────────── */
	/* Post-draft proposal (accept/reject popup) */
	const [draftBusy, setDraftBusy] = useState(false);
	const draftProposal = (threadState?.draft_proposal ?? null) as (DraftProposalData & { status?: string }) | null;
	const draftOpen = !!draftProposal && draftProposal.status === "proposed";
	const requestDraft = async () => {
		if (!active || draftBusy) return;
		setDraftBusy(true);
		try {
			const r = await api.post<{ ok?: boolean; proposal?: DraftProposalData | null }>("/api/inbox", {
				action: "draft_post",
				thread_id: active,
			});
			toast(r.proposal ? "Post draft ready — accept or reject below" : "No draft could be produced from this conversation yet", "info");
			await loadMessages(active);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Draft failed", "err");
		} finally {
			setDraftBusy(false);
		}
	};
	const acceptDraft = async (visibility: "private" | "public") => {
		if (!active || draftBusy) return;
		setDraftBusy(true);
		try {
			const r = await api.post<{ ok?: boolean; post_id?: string; status?: string }>("/api/inbox", {
				action: "accept_draft",
				thread_id: active,
				visibility,
			});
			toast(r.status === "pending_review" ? "Post created — held for review before going anywhere" : "Private post created from this conversation", "ok");
			await loadMessages(active);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Accept failed", "err");
		} finally {
			setDraftBusy(false);
		}
	};
	const rejectDraft = async () => {
		if (!active || draftBusy) return;
		setDraftBusy(true);
		try {
			await api.post("/api/inbox", { action: "reject_draft", thread_id: active });
			toast("Draft rejected — nothing was posted", "info");
			await loadMessages(active);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Reject failed", "err");
		} finally {
			setDraftBusy(false);
		}
	};

	const startNew = (anonId: string) => {
		const id = anonId.trim();
		if (!id) return;
		setActive(id);
		sourceRef.current[id] = "chat";
		if (!threads.some((t) => t.thread_id === id)) {
			setThreads((prev) => [
				{
					thread_id: id,
					status: "open",
					updated_at: new Date().toISOString(),
					last_message: "",
					last_at: new Date().toISOString(),
					unread: 0,
					source: "chat",
				},
				...prev,
			]);
		}
	};

	/* ── Delete thread ────────────────────────────────────── */
	const deleteThread = async (tid: string) => {
		if (!confirm("Delete this conversation?")) return;
		const t = threadsRef.current.find((x) => x.thread_id === tid);
		const source = t?.source || sourceRef.current[tid] || "inbox";
		try {
			if (source === "chat") {
				await api.del(`/api/chat?thread_id=${encodeURIComponent(tid)}`, { thread_id: tid });
			} else {
				await api.post("/api/inbox", { thread_id: tid, action: "close" });
			}
			setThreads((prev) => prev.filter((x) => x.thread_id !== tid));
			if (active === tid) {
				openThread(null);
				setMessages([]);
				setThreadState(null);
				setAiSummary(null);
			}
			toast("Conversation removed", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed", "err");
		}
	};

	/* ── Export ────────────────────────────────────────────── */
	const exportChat = () => {
		if (!messages.length) return;
		const lines = messages.map((m) => {
			const sender =
				m.sender === "admin" ? "Admin" : m.sender === "ai" ? "AI" : "User";
			return `[${fmtDate(m.created_at || "")}] ${sender}: ${m.body || "(attachment)"}`;
		});
		const blob = new Blob([lines.join("\n")], { type: "text/plain" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `chat-${active}-${new Date().toISOString().slice(0, 10)}.txt`;
		a.click();
		URL.revokeObjectURL(a.href);
		toast("Chat exported", "ok");
	};

	/* ── Global keyboard shortcuts ────────────────────────── */
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			)
				return;
			if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
				e.preventDefault();
				document.getElementById("inbox-search")?.focus();
			}
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, []);

	/* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
	return (
		<div className="flex h-[calc(100vh-6rem)] gap-0 rounded-2xl border border-border overflow-hidden bg-surface">
			{/* ── Sidebar ──────────────────────────────────────── */}
			<div
				className={`${active ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 lg:w-96 shrink-0 border-r border-border bg-surface`}
			>
				<div className="flex items-center justify-between px-4 py-3 border-b border-border">
					<h2 className="font-display font-bold text-base flex items-center gap-2">
						<MessageSquare size={16} className="text-accent" /> Inbox
						<span className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
							{threads.length}
						</span>
					</h2>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => void handleInboxUpdate()}
						aria-label="Refresh inbox"
						title="Pull the latest threads and messages"
						className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-surface2 px-2 py-1 text-[10px] font-bold text-ink3 hover:text-accent transition-all"
					>
						<RefreshCw size={11} /> Refresh
					</button>
					<button
						type="button"
						onClick={toggleAiMode}
						disabled={aiModeBusy}
						role="switch"
						aria-checked={aiMode}
						title={
							aiMode
								? "AI auto-replies are ON — click to disable platform-wide"
								: "AI auto-replies are OFF — click to enable"
						}
						className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold transition-all ${
							aiMode
								? "border-accent/30 bg-accent/10 text-accent"
								: "border-border bg-surface2 text-ink3"
						}`}
					>
						{aiModeBusy ? (
							<Loader2 size={11} className="animate-spin" />
						) : aiMode ? (
							<Bot size={11} />
						) : (
							<BotOff size={11} />
						)}
						<span className="hidden lg:inline">AI {aiMode ? "ON" : "OFF"}</span>
					</button>
					<button
						className="btn btn-primary !text-xs !py-1.5"
						onClick={() => setShowNew(true)}
					>
						<Plus size={13} /> New
					</button>
				</div>
				</div>

				<div className="p-3 border-b border-border">
					<div className="relative">
						<Search
							size={13}
							className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3"
						/>
						<input
							id="inbox-search"
							className="input !text-xs !pl-8 !py-2 !rounded-lg"
							placeholder="Search… ( / )"
							value={threadSearch}
							onChange={(e) => setThreadSearch(e.target.value)}
						/>
					</div>
				</div>

				<div className="px-3 pt-2 flex flex-wrap items-center gap-2">
					<div className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5" role="tablist" aria-label="Thread importance">
						{(["important", "slang", "all"] as const).map((m) => (
							<button
								key={m}
								role="tab"
								aria-selected={threadImportance === m}
								onClick={() => setThreadImportance(m)}
								className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${threadImportance === m ? "bg-surface shadow-sm text-accent" : "text-ink3 hover:text-ink2"}`}
							>
								{m === "important" ? `Important${importantCount ? ` ${importantCount}` : ""}` : m === "slang" ? `Slang${slangCount ? ` ${slangCount}` : ""}` : `All${threads.length ? ` ${threads.length}` : ""}`}
							</button>
						))}
					</div>
					<div className="ml-auto flex items-center gap-1 text-[11px]">
						<span className="text-ink3">Related:</span>
						{([["reports", "Reports"], ["posts", "Feed"], ["polls", "Polls"]] as const).map(([k, label]) => (
							<button
								key={k}
								type="button"
								className="text-accent hover:underline"
								onClick={() => window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: k }))}
							>
								{label}
							</button>
						))}
					</div>
				</div>
				<div className="px-3 pt-2">
					<UpdateNotice
						count={updatesAvailable}
						onViewUpdates={() => void handleInboxUpdate()}
					/>
				</div>

				<div className="flex-1 overflow-y-auto">
					{loading && (
						<div className="space-y-2 p-3">
							{[1, 2, 3].map((i) => (
								<div key={i} className="skeleton h-16 rounded-xl" />
							))}
						</div>
					)}
					{!loading && filteredThreads.length === 0 && (
						<div className="text-center py-12 px-4">
							<MessageSquare size={28} className="mx-auto text-ink3/40 mb-3" />
							<p className="text-xs text-ink3">
								{threadSearch
									? "No matching conversations"
									: threadImportance === "slang" ? "No slang-flagged threads" : "No conversations yet"}
							</p>
							{!threadSearch && (
								<button
									className="btn btn-soft !text-xs mt-3"
									onClick={() => setShowNew(true)}
								>
									<Plus size={12} /> Start one
								</button>
							)}
						</div>
					)}
					{filteredThreads.map((t) => (
						<ThreadItem
							key={t.thread_id}
							t={t}
							active={active === t.thread_id}
							onClick={() => {
								openThread(t.thread_id);
								setShowScrollBtn(false);
							}}
							onDelete={() => deleteThread(t.thread_id)}
						/>
					))}
				</div>
			</div>

			{/* ── Main chat area ───────────────────────────────── */}
			<div
				className={`flex-1 flex flex-col min-w-0 ${!active ? "hidden md:flex" : "flex"}`}
			>
				{!active ? (
					<div className="flex-1 flex flex-col items-center justify-center text-ink3 gap-3">
						<div className="w-16 h-16 rounded-2xl bg-accent-soft flex items-center justify-center">
							<MessageSquare size={28} className="text-accent" />
						</div>
						<p className="text-sm font-medium">Select a conversation</p>
						<p className="text-xs text-ink3">or start a new one</p>
					</div>
				) : (
					<>
						{/* Header */}
						<div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-surface">
							<button
								className="md:hidden btn btn-ghost !p-1.5"
								onClick={() => openThread(null)}
							>
								<ChevronLeft size={18} />
							</button>

							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className="text-sm font-semibold truncate">
										{active}
									</span>
									{emotion !== "none" && (
										<span
											className={`text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${EMOTION_COLORS[emotion]}`}
										>
											<EIcon size={10} /> {EMOTION_LABELS[emotion]}
										</span>
									)}
									{threadState?.status === "closed" && (
										<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink3/10 text-ink3 border border-border flex items-center gap-1">
											<Lock size={9} /> Closed
										</span>
									)}
								</div>
								<div className="flex items-center gap-2 mt-0.5">
									<span
										className={`text-[11px] flex items-center gap-1 ${
											agent === "admin"
												? "text-accent"
												: agent === "emotional"
													? "text-blue-500"
													: "text-ink3"
										}`}
									>
										{agent === "admin" ? (
											<>
												<Shield size={10} /> Admin handling
											</>
										) : agent === "emotional" ? (
											<>
												<Headphones size={10} /> Emotional agent
											</>
										) : agent === "direct" ? (
											<>
												<MessageSquare size={10} /> Direct chat
											</>
										) : (
											<>
												<Bot size={10} /> AI assistant active
											</>
										)}
									</span>
									{handoff && (
										<span className="text-[10px] text-orange-500">
											⏳ Handoff pending
										</span>
									)}
									<span className="text-[10px] text-ink3">
										· {messages.length} messages
									</span>
								</div>
							</div>

							<div className="flex items-center gap-1.5">
								<button
									onClick={() => setShowSearch(!showSearch)}
									className={`p-2 rounded-lg transition-colors ${showSearch ? "bg-accent-soft text-accent" : "hover:bg-surface2 text-ink3"}`}
									title="Search in chat"
								>
									<Search size={14} />
								</button>
								<button
									onClick={exportChat}
									className="btn btn-ghost !text-xs !py-1.5"
									title="Export"
								>
									<Download size={13} />
								</button>
								<button
									onClick={() => void summarize()}
									disabled={summaryBusy}
									className="btn btn-ghost !text-[11px] !py-1.5 !px-3"
									title="AI summary — subject, key facts and status without reading every message"
								>
									{summaryBusy ? (
										<Loader2 size={12} className="animate-spin" />
									) : (
										<Sparkles size={12} />
									)}
									<span className="ml-1">
										{summaryBusy ? "Summarizing…" : "Summarize"}
									</span>
								</button>

								{threadState?.source !== "chat" && agent !== "admin" && (
									<button
										onClick={() => doAction("takeover")}
										disabled={actionBusy === "takeover"}
										className="btn btn-primary !text-[11px] !py-1.5 !px-3"
									>
										{actionBusy === "takeover" ? (
											<Loader2 size={12} className="animate-spin" />
										) : (
											<Shield size={12} />
										)}
										<span className="ml-1">Take Over</span>
									</button>
								)}
								{threadState?.source !== "chat" && agent === "admin" && (
									<button
										onClick={() => doAction("release")}
										disabled={actionBusy === "release"}
										className="btn btn-ghost !text-[11px] !py-1.5 !px-3"
									>
										{actionBusy === "release" ? (
											<Loader2 size={12} className="animate-spin" />
										) : (
											<ArrowLeftRight size={12} />
										)}
										<span className="ml-1">Release</span>
									</button>
								)}
								{threadState?.source !== "chat" && agent !== "emotional" && (
									<button
										onClick={() => doAction("transfer_emotional")}
										disabled={actionBusy === "transfer_emotional"}
										className="btn btn-ghost !text-[11px] !py-1.5 !px-3 text-blue-500"
									>
										{actionBusy === "transfer_emotional" ? (
											<Loader2 size={12} className="animate-spin" />
										) : (
											<Headphones size={12} />
										)}
									</button>
								)}

								{threadState?.source === "chat" &&
									(threadState?.status === "closed" ? (
										<button
											className="btn btn-soft !text-xs !py-1.5"
											onClick={() => setStatus("open")}
										>
											<Unlock size={12} /> Reopen
										</button>
									) : (
										<button
											className="btn btn-ghost !text-xs !py-1.5"
											onClick={() => setStatus("closed")}
										>
											<Lock size={12} /> Close
										</button>
									))}
							</div>
						</div>

						{/* AI summary — the admin briefing for this conversation */}
						{aiSummary && (
							<div className="mx-5 mt-3 rounded-xl border border-accent/25 bg-accent-soft/40 p-3">
								<p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1.5 flex items-center gap-1.5">
									<Sparkles size={11} /> AI summary · status:{" "}
									{aiSummary.resolution_state}
								</p>
								{aiSummary.summary ? (
									<p className="text-xs text-ink leading-relaxed">
										{aiSummary.summary}
									</p>
								) : (
									<p className="text-xs text-ink3">
										No summary yet — empty thread or AI unreachable. The
										full conversation is below.
									</p>
								)}
								{aiSummary.entities.length > 0 && (
									<div className="flex flex-wrap gap-1.5 mt-2">
										{aiSummary.entities.map((e) => (
											<span
												key={e}
												className="text-[10px] px-2 py-0.5 rounded-full bg-surface border border-border text-ink2"
											>
												{e}
											</span>
										))}
									</div>
								)}
							</div>
						)}

						{/* Search bar */}
						{showSearch && (
							<div className="px-5 py-2 border-b border-border bg-surface2/50 flex items-center gap-2 chat-msg-anim">
								<Search size={13} className="text-ink3" />
								<input
									className="input !text-xs !py-1.5 !rounded-lg flex-1"
									placeholder="Search in this conversation…"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									autoFocus
								/>
								<button
									onClick={() => {
										setShowSearch(false);
										setSearch("");
									}}
									className="p-1 rounded-md hover:bg-surface2"
								>
									<X size={12} className="text-ink3" />
								</button>
							</div>
						)}

						{historyWindow === "5d" && (
							<p className="px-4 pt-1 text-[10px] text-ink3">Showing the last 5 days — older history stays server-side.</p>
						)}
						{/* Messages */}
						<div
							ref={scrollRef}
							onScroll={onScroll}
							className="flex-1 overflow-y-auto py-4 space-y-4 scroll-smooth"
						>
							{messages.length === 0 && (
								<div className="flex-1 flex items-center justify-center h-full">
									<p className="text-xs text-ink3">
										No messages yet — say hello! 👋
									</p>
								</div>
							)}
							{messages
								.filter(
									(m) =>
										!search ||
										(m.body || "").toLowerCase().includes(search.toLowerCase()),
								)
								.map((m) => (
									<MessageBubble
										key={m.id}
										msg={m}
										isAdmin={m.sender === "admin"}
									/>
								))}
							<div ref={bottomRef} />
						</div>

						{/* Scroll to bottom */}
						{showScrollBtn && (
							<div className="flex justify-center -mt-8 mb-2 relative z-10">
								<button
									onClick={() => {
										bottomRef.current?.scrollIntoView({ behavior: "smooth" });
										setShowScrollBtn(false);
									}}
									className="w-9 h-9 rounded-full bg-surface border border-border shadow-lg flex items-center justify-center hover:bg-surface2 transition-colors"
								>
									<ArrowDown size={14} className="text-ink2" />
								</button>
							</div>
						)}

						{draftOpen && draftProposal && (
							<div className="px-4 pt-3">
								<DraftProposal
									proposal={draftProposal}
									excerpt={messages.filter((m) => m.sender === "user").map((m) => m.body ?? "(attachment)").slice(-3)}
									busy={draftBusy}
									onAccept={acceptDraft}
									onReject={rejectDraft}
								/>
							</div>
						)}

						{(() => {
							const sl = (threadState?.slang_hits ?? null) as { count?: number; terms?: string[] } | null;
							if (!sl || !(sl.count || 0)) return null;
							return (
								<p data-testid="slang-terms" className="px-4 pt-1 text-[10px] text-amber-500/90">
									Slang in this chat ({sl.count}×): {(sl.terms || []).slice(0, 6).join(", ")}
								</p>
							);
						})()}
						{/* Input */}
						<div className="border-t border-border bg-surface px-4 py-3">
							<div className="flex gap-1.5 overflow-x-auto pb-2.5 scrollbar-none">
								<button
									className="chip shrink-0 cursor-pointer !text-accent hover:!border-accent disabled:opacity-50 !py-1"
									onClick={aiSuggest}
									disabled={aiBusy}
								>
									{aiBusy ? (
										<Loader2 size={11} className="animate-spin" />
									) : (
										<Sparkles size={11} />
									)}
									{aiBusy ? "Thinking…" : "AI suggest"}
								</button>
								<button
									className="chip shrink-0 cursor-pointer !text-accent hover:!border-accent disabled:opacity-50 !py-1"
									onClick={requestDraft}
									disabled={draftBusy}
								>
									{draftBusy ? (
										<Loader2 size={11} className="animate-spin" />
									) : (
										<Plus size={11} />
									)}
									{draftBusy ? "Drafting…" : "Draft post"}
								</button>
								{QUICK_REPLIES.slice(0, 4).map((q) => (
									<button
										key={q}
										className="chip shrink-0 cursor-pointer hover:border-accent !py-1 !text-[11px]"
										onClick={() => {
											setText(q);
											inputRef.current?.focus();
										}}
									>
										{q.slice(0, 40)}
									</button>
								))}
							</div>

							<div className="flex items-end gap-2 bg-surface2 rounded-2xl border border-border px-3 py-2">
								<textarea
									ref={inputRef}
									className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-ink placeholder:text-ink3 max-h-40"
									placeholder={
										agent === "admin"
											? "Reply as admin…"
											: "Type a message… (Shift+Enter for new line)"
									}
									value={text}
									onChange={(e) => onTextChange(e.target.value)}
									onKeyDown={onKeyDown}
									rows={1}
									maxLength={2000}
								/>
								<button
									className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center flex-shrink-0 transition-all hover:bg-accent2 disabled:opacity-30 disabled:cursor-not-allowed"
									onClick={() => send()}
									disabled={!text.trim() || sending}
								>
									{sending ? (
										<Loader2 size={15} className="animate-spin" />
									) : (
										<Send size={15} />
									)}
								</button>
							</div>
							<p className="text-[9px] text-ink3 mt-1.5 px-1">
								{text.length > 0 && `${text.length}/2000`}
							</p>
						</div>
					</>
				)}
			</div>

			<PromptDialog
				open={showNew}
				onClose={() => setShowNew(false)}
				onSubmit={startNew}
				title="Start new conversation"
				label="Anonymous user ID"
				placeholder="anon_xxxxxxxxxxxx"
				submitLabel="Open chat"
			/>
		</div>
	);
}
