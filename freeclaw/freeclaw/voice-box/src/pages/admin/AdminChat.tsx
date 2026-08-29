import {
	ArrowDown,
	ChevronUp,
	ChevronDown,
	Download,
	Image as ImageIcon,
	Loader2,
	Lock,
	MessageSquare,
	Plus,
	Search,
	Send,
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
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { useRealtime } from "../../lib/useRealtime";
import { fmtDate, timeAgo } from "../../lib/utils";
import type { ChatMessage, ChatThread } from "../../types";

/* ── Typing indicator ──────────────────────────────────────── */
function _TypingIndicator() {
	return (
		<div className="flex items-center gap-3 chat-msg-anim px-4 py-3">
			<div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center flex-shrink-0">
				<Sparkles size={14} className="text-accent" />
			</div>
			<div className="bg-surface2 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
				<span className="typing-dot w-2 h-2 rounded-full bg-ink3" />
				<span className="typing-dot w-2 h-2 rounded-full bg-ink3" />
				<span className="typing-dot w-2 h-2 rounded-full bg-ink3" />
			</div>
		</div>
	);
}

/**
 * Highlight a search term inside an HTML-escaped string.
 * Returns HTML with <mark> tags wrapping each match.
 */
function highlightHtml(text: string, query: string): string {
	if (!query) return text;
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return text.replace(
		new RegExp(`(${escaped})`, "gi"),
		'<mark class="bg-yellow-300/40 text-inherit rounded px-0.5">$1</mark>',
	);
}

/* ── Single message bubble ─────────────────────────────────── */
function MessageBubble({
	msg,
	isAdmin,
	searchQuery,
	isMatch,
	matchId,
}: {
	msg: ChatMessage & { id: string };
	isAdmin: boolean;
	searchQuery?: string;
	isMatch?: boolean;
	matchId?: string;
}) {
	const htmlBody = useMemo(() => {
		if (!msg.body) return "";
		const rendered = renderMarkdown(msg.body);
		if (searchQuery) return highlightHtml(rendered, searchQuery);
		return rendered;
	}, [msg.body, searchQuery]);

	return (
		<div
			data-match-id={matchId}
			className={`chat-msg-wrap group flex ${isAdmin ? "justify-end" : "justify-start"} chat-msg-anim px-4 transition-opacity duration-200 ${searchQuery && !isMatch ? "opacity-30" : ""}`}
		>
			<div
				className={`flex ${isAdmin ? "flex-row-reverse" : "flex-row"} items-end gap-2.5 max-w-[78%]`}
			>
				{/* Avatar */}
				{!isAdmin && (
					<div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center flex-shrink-0 mb-5">
						<Sparkles size={14} className="text-accent" />
					</div>
				)}

				<div className="flex flex-col gap-1">
					{/* Attachment */}
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

					{/* Message body */}
					{msg.body && (
						<div
							className={`chat-msg rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
								isAdmin
									? "bg-accent text-white rounded-br-md"
									: "bg-surface2 text-ink rounded-bl-md border border-border/50"
							}`}
							dangerouslySetInnerHTML={{ __html: htmlBody }}
						/>
					)}

					{/* Timestamp + actions */}
					<div
						className={`flex items-center gap-1.5 ${isAdmin ? "justify-end" : "justify-start"}`}
					>
						<span className="text-[10px] text-ink3 opacity-0 group-hover:opacity-100 transition-opacity">
							{fmtDate(msg.created_at || msg.at || "")}
						</span>
						<div className="msg-actions flex items-center gap-0.5">
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
   MAIN — Premium Admin Chat (ChatGPT/Claude-tier)
   ═══════════════════════════════════════════════════════════════ */
export default function AdminChat() {
	const { toast } = useApp();
	const [threads, setThreads] = useState<
		(ChatThread & {
			status?: string;
			last_message?: string;
			last_at?: string;
			unread?: number;
		})[]
	>([]);
	const [active, setActive] = useState<string | null>(null);
	const [messages, setMessages] = useState<(ChatMessage & { id: string })[]>(
		[],
	);
	const [thread, setThread] = useState<
		(ChatThread & { status?: string }) | null
	>(null);
	const [text, setText] = useState("");
	const [loading, setLoading] = useState(true);
	const [showNew, setShowNew] = useState(false);
	const [sending, setSending] = useState(false);
	const [aiBusy, setAiBusy] = useState(false);
	const [threadSearch, setThreadSearch] = useState("");
	const [chatSearch, setChatSearch] = useState("");
	const [showSearch, setShowSearch] = useState(false);
	const [matchIndex, setMatchIndex] = useState(0);
	const [showScrollBtn, setShowScrollBtn] = useState(false);

	const bottomRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Deep-link
	useEffect(() => {
		const target = sessionStorage.getItem("vb:adminChatTarget");
		if (target) {
			setActive(target);
			sessionStorage.removeItem("vb:adminChatTarget");
		}
	}, []);

	const loadThreads = useCallback(async () => {
		try {
			const t = await api.get<
				(ChatThread & {
					status?: string;
					last_message?: string;
					last_at?: string;
					unread?: number;
				})[]
			>("/api/chat?threads=1");
			setThreads(Array.isArray(t) ? t : []);
		} catch (e: unknown) {
			console.warn(
				"[AdminChat] Failed to load threads:",
				e instanceof Error ? e.message : e,
			);
		}
		setLoading(false);
	}, []);

	const loadMessages = useCallback(
		async (tid: string) => {
			try {
				const data = await api.get<{
					messages: (ChatMessage & { id: string })[];
					thread: (ChatThread & { status?: string }) | null;
				}>(`/api/chat?thread_id=${tid}`);
				setMessages(data.messages);
				setThread(data.thread);
				await api.put<unknown>("/api/chat", {
					action: "mark_read",
					thread_id: tid,
					as: "admin",
				});
				loadThreads();
			} catch (e: unknown) {
				console.warn(
					"[AdminChat] Failed to load messages:",
					e instanceof Error ? e.message : e,
				);
			}
		},
		[loadThreads],
	);

	useEffect(() => {
		loadThreads();
	}, [loadThreads]);
	useEffect(() => {
		if (active) loadMessages(active);
	}, [active, loadMessages]);

	// Realtime
	useRealtime(
		["chat_messages", "chat_threads"],
		() => {
			loadThreads();
			if (active) loadMessages(active);
		},
		200,
	);

	// Auto-scroll
	useEffect(() => {
		if (showScrollBtn) return; // don't jump if user scrolled up
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length, showScrollBtn]);

	// Scroll detection
	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
		setShowScrollBtn(!atBottom);
	};

	// Auto-resize textarea
	const onTextChange = (val: string) => {
		setText(val);
		if (inputRef.current) {
			inputRef.current.style.height = "auto";
			inputRef.current.style.height =
				Math.min(inputRef.current.scrollHeight, 160) + "px";
		}
	};

	// Send message
	const send = async (body?: string) => {
		const msg = (body ?? text).trim();
		if (!msg || !active || sending) return;
		setSending(true);
		try {
			await api.post<unknown>("/api/chat", {
				thread_id: active,
				sender: "admin",
				body: msg,
			});
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

	// Keyboard shortcut: Enter to send, Shift+Enter for newline
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	};

	// Thread status
	const setStatus = async (status: "open" | "closed") => {
		if (!active) return;
		try {
			await api.put<unknown>("/api/chat", {
				action: "set_status",
				thread_id: active,
				status,
			});
			await loadMessages(active);
			toast(`Conversation ${status}`, "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to update status", "err");
		}
	};

	// AI suggest
	const aiSuggest = async () => {
		if (!messages.length) {
			setText(QUICK_REPLIES[0] ?? "");
			return;
		}
		setAiBusy(true);
		try {
			const r = await api.post<{ reply?: string; engine?: string }>(
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
						? "Suggested reply (add ANTHROPIC_API_KEY for smarter AI)"
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

	// Start new conversation
	const startNew = (anonId: string) => {
		const id = anonId.trim();
		if (!id) return;
		setActive(id);
		if (!threads.some((t) => t.thread_id === id)) {
			setThreads((prev) => [
				{
					thread_id: id,
					messages: [],
					status: "open",
					updated_at: new Date().toISOString(),
					last_message: "",
					last_at: new Date().toISOString(),
					unread: 0,
				},
				...prev,
			]);
		}
	};

	// Delete thread
	const deleteThread = async (tid: string) => {
		if (!confirm("Delete this conversation?")) return;
		try {
			await api.del<unknown>("/api/chat", { thread_id: tid });
			setThreads((prev) => prev.filter((t) => t.thread_id !== tid));
			if (active === tid) {
				setActive(null);
				setMessages([]);
				setThread(null);
			}
			toast("Conversation deleted", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to delete", "err");
		}
	};

	// Filter threads by sidebar search
	const filteredThreads = useMemo(() => {
		if (!threadSearch) return threads;
		const q = threadSearch.toLowerCase();
		return threads.filter(
			(t) =>
				t.thread_id.toLowerCase().includes(q) ||
				(t.last_message || "").toLowerCase().includes(q),
		);
	}, [threads, threadSearch]);

	// Which messages match the in-chat search (for dimming + highlighting)
	const matchInfo = useMemo(() => {
		if (!chatSearch) return { matchedIds: new Set<string>(), count: 0 };
		const q = chatSearch.toLowerCase();
		const matchedIds = new Set(
			messages
				.filter((m) => (m.body || "").toLowerCase().includes(q))
				.map((m) => m.id),
		);
		return { matchedIds, count: matchedIds.size };
	}, [messages, chatSearch]);

	// Reset match index when search changes
	useEffect(() => {
		setMatchIndex(0);
	}, [chatSearch]);

	// Build ordered list of match IDs for up/down navigation
	const matchIds = useMemo(() => {
		if (!chatSearch) return [];
		const q = chatSearch.toLowerCase();
		return messages
			.filter((m) => (m.body || "").toLowerCase().includes(q))
			.map((m) => m.id);
	}, [messages, chatSearch]);

	// Navigate to a specific match
	const goToMatch = useCallback(
		(idx: number) => {
			if (matchIds.length === 0) return;
			const clamped = ((idx % matchIds.length) + matchIds.length) % matchIds.length;
			setMatchIndex(clamped);
			const el = document.querySelector(
				`[data-match-id="match-${matchIds[clamped]}"]`,
			);
			if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
		},
		[matchIds],
	);

	// Export conversation
	const exportChat = () => {
		if (!messages.length) return;
		const lines = messages.map((m) => {
			const sender = m.sender === "admin" ? "Admin" : "User";
			const time = fmtDate(m.created_at || m.at || "");
			return `[${time}] ${sender}: ${m.body || "(attachment)"}`;
		});
		const blob = new Blob([lines.join("\n")], { type: "text/plain" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `chat-${active}-${new Date().toISOString().slice(0, 10)}.txt`;
		a.click();
		URL.revokeObjectURL(a.href);
		toast("Chat exported", "ok");
	};

	return (
		<div className="h-[calc(100vh-6rem)]">
			{/* ── Header ──────────────────────────────────────────── */}
			<div className="flex items-center justify-between mb-4">
				<h1 className="font-display font-bold text-xl flex items-center gap-2">
					<MessageSquare size={20} className="text-accent" /> Chat
				</h1>
				<div className="flex gap-2">
					{active && (
						<button
							onClick={exportChat}
							className="btn btn-ghost !text-xs !py-1.5"
						>
							<Download size={13} /> Export
						</button>
					)}
					<button
						className="btn btn-primary !text-xs !py-1.5"
						onClick={() => setShowNew(true)}
					>
						<Plus size={14} /> New
					</button>
				</div>
			</div>

			<div className="flex h-[calc(100%-3.5rem)] gap-0 rounded-2xl border border-border overflow-hidden bg-surface">
				{/* ── Sidebar: Thread List ──────────────────────────── */}
				<div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-surface">
					{/* Search */}
					<div className="p-3 border-b border-border">
						<div className="relative">
							<Search
								size={13}
								className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3"
							/>								<input
									className="input !text-xs !pl-8 !py-2 !rounded-lg"
									placeholder="Search conversations…"
									value={threadSearch}
									onChange={(e) => setThreadSearch(e.target.value)}
								/>
						</div>
					</div>

					{/* Thread list */}
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
								<MessageSquare
									size={28}
									className="mx-auto text-ink3/40 mb-3"
								/>
								<p className="text-xs text-ink3">
									{threadSearch
										? "No matching conversations"
										: "No conversations yet"}
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
							<div
								key={t.thread_id}
								className={`thread-item relative group border-b border-border/50 cursor-pointer ${
									active === t.thread_id
										? "active border-l-2 border-l-accent"
										: ""
								}`}
								onClick={() => setActive(t.thread_id)}
							>
								<div className="px-4 py-3">
									<div className="flex items-center gap-2">
										{/* Avatar */}
										<div className="w-9 h-9 rounded-full bg-accent-soft flex items-center justify-center flex-shrink-0">
											<MessageSquare size={14} className="text-accent" />
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<span className="text-xs font-bold text-ink truncate">
													{t.thread_id.slice(0, 18)}
												</span>
												{t.status === "closed" && (
													<Lock size={10} className="text-ink3 flex-shrink-0" />
												)}
											</div>
											<p className="text-[11px] text-ink3 truncate mt-0.5">
												{t.last_message || "No messages yet"}
											</p>
										</div>
										<div className="flex flex-col items-end gap-1">
											<span className="text-[9px] text-ink3">
												{timeAgo(t.last_at || "")}
											</span>
											{(t.unread ?? 0) > 0 && (
												<span className="w-5 h-5 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">
													{t.unread}
												</span>
											)}
										</div>
									</div>
								</div>
								{/* Delete on hover */}
								<button
									onClick={(e) => {
										e.stopPropagation();
										deleteThread(t.thread_id);
									}}
									className="absolute top-3 right-10 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
									title="Delete conversation"
								>
									<Trash2 size={12} className="text-red-400" />
								</button>
							</div>
						))}
					</div>
				</div>

				{/* ── Main: Chat Area ──────────────────────────────── */}
				<div className="flex-1 flex flex-col min-w-0">
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
							{/* Thread header */}
							<div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-surface">
								<div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center">
									<MessageSquare size={14} className="text-accent" />
								</div>
								<div className="flex-1 min-w-0">
									<p className="text-sm font-bold text-ink truncate">
										{active}
									</p>
									<p className="text-[10px] text-ink3">
										{thread?.status === "closed" ? "🔒 Closed" : "🟢 Open"} ·{" "}
										{messages.length} messages
									</p>
								</div>
								<div className="flex items-center gap-1.5">
									<button
										onClick={() => setShowSearch(!showSearch)}
										className={`p-2 rounded-lg transition-colors ${showSearch ? "bg-accent-soft text-accent" : "hover:bg-surface2 text-ink3"}`}
										title="Search in chat"
									>
										<Search size={14} />
									</button>
									{thread?.status === "closed" ? (
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
									)}
								</div>
							</div>

							{/* Search bar */}								{showSearch && (
									<div className="px-5 py-2 border-b border-border bg-surface2/50 flex items-center gap-2 chat-msg-anim">
									<Search size={13} className="text-ink3 shrink-0" />
									<input
										className="input !text-xs !py-1.5 !rounded-lg flex-1"
										placeholder="Search in this conversation…"
										autoFocus
										value={chatSearch}
										onChange={(e) => setChatSearch(e.target.value)}
										onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											goToMatch(matchIndex + (e.shiftKey ? -1 : 1));
										}
										if (e.key === "Escape") {
											setShowSearch(false);
											setChatSearch("");
										}
									}}
									/>
									{/* Match count + nav arrows */}
									{chatSearch && (
										<div className="flex items-center gap-0.5 shrink-0">
											<span className="text-[10px] text-ink3 tabular-nums min-w-[3ch] text-center">
												{matchInfo.count > 0
													? `${matchIndex + 1}/${matchInfo.count}`
													: "0"}
											</span>
											<button
												onClick={() => goToMatch(matchIndex - 1)}
												disabled={matchInfo.count === 0}
												className="p-0.5 rounded hover:bg-surface2 disabled:opacity-30"
												title="Previous match (Shift+Enter)"
											>
												<ChevronUp size={14} className="text-ink2" />
											</button>
											<button
												onClick={() => goToMatch(matchIndex + 1)}
												disabled={matchInfo.count === 0}
												className="p-0.5 rounded hover:bg-surface2 disabled:opacity-30"
												title="Next match (Enter)"
											>
												<ChevronDown size={14} className="text-ink2" />
											</button>
										</div>
									)}
									<button
										onClick={() => { setShowSearch(false); setChatSearch(""); }}
										className="p-1 rounded-md hover:bg-surface2 shrink-0"
									>
										<X size={12} className="text-ink3" />
									</button>
								</div>
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
								{messages.map((m) => (
									<MessageBubble
										key={m.id}
										msg={m}
										isAdmin={m.sender === "admin"}
										searchQuery={chatSearch || undefined}
										isMatch={matchInfo.matchedIds.has(m.id)}
										matchId={`match-${m.id}`}
									/>
								))}
								<div ref={bottomRef} />
							</div>

							{/* Scroll to bottom button */}
							{showScrollBtn && (
								<div className="flex justify-center -mt-8 mb-2 relative z-10">
									<button
										onClick={() => {
											bottomRef.current?.scrollIntoView({ behavior: "smooth" });
											setShowScrollBtn(false);
										}}
										className="scroll-btn-anim w-9 h-9 rounded-full bg-surface border border-border shadow-lg flex items-center justify-center hover:bg-surface2 transition-colors"
									>
										<ArrowDown size={14} className="text-ink2" />
									</button>
								</div>
							)}

							{/* Quick replies + input */}
							<div className="border-t border-border bg-surface px-4 py-3">
								{/* Quick reply pills */}
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

								{/* Input area */}
								<div className="chat-input-wrap flex items-end gap-2 bg-surface2 rounded-2xl border border-border px-3 py-2">
									<textarea
										ref={inputRef}
										className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-ink placeholder:text-ink3 max-h-40"
										placeholder="Type a message… (Shift+Enter for new line)"
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
