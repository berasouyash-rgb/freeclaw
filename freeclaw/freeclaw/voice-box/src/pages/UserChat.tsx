import {
	Bot,
	Heart,
	ImagePlus,
	Loader2,
	MessageSquare,
	Send,
	ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	LoadingSpinner,
	prefersReducedMotion,
	VB_FULL_CYCLE_MS,
} from "../components/ErrorBoundary";
import TypingIndicator from "../components/TypingIndicator";
import { useApp } from "../contexts/AppContext";
import { api } from "../lib/api";
import { useRealtime } from "../lib/useRealtime";
import { fmtDate, sanitize } from "../lib/utils";
import type { ChatMessage } from "../types";

interface InboxResponse {
	messages: ChatMessage[];
	thread: { thread_id: string; status: string };
	state?: { agent?: string };
}

// Merge server messages into the local list WITHOUT producing duplicates.
// The optimistic user bubble (id "user-<ts>") has a different id than the
// DB-confirmed copy, so plain id-dedup would render the user's message
// twice. If a server user message matches an optimistic bubble on
// (sender + body), the optimistic copy is replaced.
//
// NOTE: there is deliberately NO age window here. The server generates the
// AI reply inline and can take up to 35s, so the confirmation may arrive
// long after the optimistic bubble was created. A time cutoff (e.g. 15s)
// would let the old bubble survive, and the confirmed copy would be
// appended alongside it — rendering the user's message twice. Server ids
// are UUIDs, so the "user-" prefix uniquely identifies optimistic bubbles.
export function mergeMessages(
	prev: ChatMessage[],
	incoming: ChatMessage[],
): ChatMessage[] {
	const existingIds = new Set(prev.map((m) => m.id));
	const merged = [...prev];
	for (const m of incoming) {
		if (m.id && existingIds.has(m.id)) continue;
		if (m.sender === "user") {
			// Optimistic bubbles are the only string ids ("user-<ts>"); DB messages
			// use numeric identity ids — guard the type or a numeric id would throw.
			const optIdx = merged.findIndex(
				(x) =>
					typeof x.id === "string" &&
					x.id.startsWith("user-") &&
					x.sender === "user" &&
					x.body === m.body,
			);
			if (optIdx >= 0) merged.splice(optIdx, 1);
		}
		if (m.id) {
			merged.push(m);
			existingIds.add(m.id);
		}
	}
	merged.sort(
		(a, b) =>
			new Date(a.created_at || 0).getTime() -
			new Date(b.created_at || 0).getTime(),
	);
	return merged;
}

export default function UserChat() {
	const { anonId, toast, setChatUnread } = useApp();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [thread, setThread] = useState<{
		thread_id: string;
		status: string;
	} | null>(null);
	const [text, setText] = useState("");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [typing, setTyping] = useState(false);
	const [agentLabel, setAgentLabel] = useState<string | null>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const sendingRef = useRef(false);

	// ── Initial-loader minimum display time ─────────────────────────
	// The motive loader tells a 5-line story over VB_FULL_CYCLE_MS. If the
	// inbox answers instantly, the spinner used to vanish before the story
	// was told. Hold it until the full cycle has had time to play (shorter
	// for reduced-motion users).
	const MIN_LOADER_MS = prefersReducedMotion() ? 1200 : VB_FULL_CYCLE_MS;
	const mountTimeRef = useRef(Date.now());
	const loaderTimerRef = useRef<number | null>(null);
	const mountedRef = useRef(true);
	useEffect(() => {
		return () => {
			mountedRef.current = false;
			if (loaderTimerRef.current !== null)
				window.clearTimeout(loaderTimerRef.current);
		};
	}, []);

	const holdLoaderForFullStory = useCallback(() => {
		if (loaderTimerRef.current !== null) return; // already scheduled
		const remaining = MIN_LOADER_MS - (Date.now() - mountTimeRef.current);
		if (remaining <= 0) {
			setLoading(false);
			return;
		}
		loaderTimerRef.current = window.setTimeout(() => {
			if (mountedRef.current) setLoading(false);
		}, remaining);
	}, [MIN_LOADER_MS]);

	const load = useCallback(async (): Promise<ChatMessage[]> => {
		try {
			// Use inbox API for AI-powered replies
			const data = await api.get<InboxResponse>(
				`/api/inbox?thread_id=${anonId}`,
			);
			const newMsgs = data.messages || [];
			// Deduplicate by message id + replace optimistic bubbles on server confirm
			setMessages((prev: ChatMessage[]) => mergeMessages(prev, newMsgs));
			setThread(data.thread);
			if (data.state?.agent) {
				setAgentLabel(
					data.state.agent === "emotional"
						? "💙 Emotional Support Agent"
						: data.state.agent === "admin"
							? "👤 Admin"
							: "🤖 AI Assistant",
				);
			}
			await api.put("/api/inbox", {
				action: "mark_read",
				thread_id: anonId,
				as: "user",
			});
			setChatUnread(0);
			holdLoaderForFullStory(); // release the initial loader once the story has had time to play
			// Return the authoritative SERVER list (NOT a value captured from the
			// setMessages updater — React 18 executes updaters during a later render,
			// so a locally-assigned variable would still be empty here).
			return newMsgs;
		} catch {
			// Fallback to old chat API
			try {
				const data = await api.get<InboxResponse>(
					`/api/chat?thread_id=${anonId}`,
				);
				setMessages(data.messages);
				setThread(data.thread);
				await api.put("/api/chat", {
					action: "mark_read",
					thread_id: anonId,
					as: "user",
				});
				setChatUnread(0);
				holdLoaderForFullStory();
				return data.messages || [];
			} catch {
				/* offline ok */
			}
		}
		holdLoaderForFullStory();
		return [];
	}, [anonId, setChatUnread, holdLoaderForFullStory]);

	useEffect(() => {
		load();
	}, [load]);

	// Realtime subscription (with built-in fallback polling in useRealtime)
	// handles both live updates AND silent-channel recovery — no raw setInterval needed.
	useRealtime(["chat_messages"], () => load(), 500);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length]);

	const send = async (attachment_url?: string) => {
		const body = sanitize(text, 2000);
		if (!body && !attachment_url) return;
		if (sendingRef.current) return;
		sendingRef.current = true;
		setBusy(true);
		setTyping(true);
		setText(""); // Clear input immediately for instant UX

		// ── Step 1: Add user message instantly for immediate feedback ──
		const userMsg: ChatMessage = {
			id: `user-${Date.now()}`,
			sender: "user",
			body,
			created_at: new Date().toISOString(),
			read: true,
		};
		setMessages((prev) => [...prev, userMsg]);

		// ── Step 2: Send to server API (NVIDIA AI) for AI response ──
		// CRITICAL: use postInbox (45s timeout) — the server generates the AI reply
		// inline and can take up to 35s. The 8s default timeout caused aborted
		// requests → the catch block re-sent the message to /api/chat → DUPLICATES,
		// and the AI reply never rendered.
		try {
			const result = await api.postInbox<{
				message?: ChatMessage;
				auto_reply?: ChatMessage;
				emotion?: { level?: string };
			}>("/api/inbox", {
				thread_id: anonId,
				sender: "user",
				body,
				attachment_url,
			});

			// Show agent indicator
			if (result.emotion?.level && result.emotion.level !== "none") {
				const labels: Record<string, string> = {
					critical: "🔴 Crisis Support Agent activated",
					high: "🟠 Emotional Support Agent activated",
					moderate: "🟡 Support Agent activated",
					mild: "🟢 Support Agent online",
				};
				setAgentLabel(labels[result.emotion.level] || "🤖 AI Assistant");
			}

			// Add user message + AI auto_reply immediately
			if (result.message) {
				setMessages((prev) =>
					mergeMessages(
						prev,
						[result.message!, result.auto_reply].filter(
							Boolean,
						) as ChatMessage[],
					),
				);
			}

			// Then sync with server to catch anything we missed
			await load();
		} catch (e: unknown) {
			// NOTE: We do NOT re-post to /api/chat here — the inbox endpoint already
			// saved the user's message server-side before generating the AI reply.
			// Re-sending would create a duplicate message. Sync + let the AI reply
			// arrive via realtime/polling instead.
			const errMsg = e instanceof Error ? e.message : "Send failed";
			// Sync with the server so a late AI reply (or the confirmed copy of the
			// user's message) replaces the optimistic bubble.
			await load();
			if (errMsg.includes("timed out") || errMsg.includes("network")) {
				toast("Message sent — AI is still composing a reply.", "info");
			} else {
				toast(errMsg, "err");
			}
		}
		setBusy(false);
		setTyping(false);
		sendingRef.current = false;
	};

	const attach = (f: File) => {
		if (f.size > 3 * 1024 * 1024) {
			toast("Image must be under 3 MB", "err");
			return;
		}
		const reader = new FileReader();
		reader.onload = async () => {
			try {
				const b64 = (reader.result as string).split(",")[1] ?? "";
				const url = await api.uploadImage(b64, f.type, anonId);
				await send(url);
			} catch (e: unknown) {
				toast(e instanceof Error ? e.message : "Upload failed", "err");
			}
		};
		reader.readAsDataURL(f);
	};

	return (
		<div className="max-w-3xl mx-auto px-4 py-6 vb-page-enter flex flex-col h-[calc(100vh-9.5rem)] lg:h-[calc(100vh-8rem)]">
			{/* Header — same treatment as Community insights */}
			<div className="flex items-center gap-2.5 mb-5">
				<span className="vb-empty-icon !w-9 !h-9">
					<MessageSquare size={17} />
				</span>
				<div>
					<h1 className="font-display font-bold text-xl sm:text-2xl leading-tight">
						Anonymous inbox
					</h1>
					<p className="text-xs text-ink3">
						Chat directly — our AI assistant responds instantly. An admin will
						join when available.
						{thread?.status === "closed" &&
							" · This conversation was closed by admin."}
					</p>
				</div>
			</div>

			{/* Agent indicator banner */}
			{agentLabel && (
				<div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-xs text-accent mb-3 animate-in slide-in-from-top-1">
					{agentLabel.includes("Crisis") || agentLabel.includes("Emotional") ? (
						<Heart size={13} />
					) : (
						<Bot size={13} />
					)}
					<span className="font-medium">{agentLabel}</span>
					<span className="text-ink3 ml-auto">Responding instantly</span>
				</div>
			)}

			<div className="card flex-1 overflow-y-auto p-4 space-y-3">
				{loading && (
					<LoadingSpinner
						text="Opening your anonymous inbox…"
						durationMs={MIN_LOADER_MS}
					/>
				)}
				{!loading && messages.length === 0 && (
					<div className="text-center py-14 vb-rise">
						<div className="vb-empty-icon mx-auto mb-2">
							<MessageSquare size={24} />
						</div>
						<p className="font-display font-semibold text-sm">
							No messages yet
						</p>
						<p className="text-xs text-ink3 mt-1">
							Send a message to reach the support team anonymously. Our AI
							responds instantly.
						</p>
					</div>
				)}
				{messages.map((m) => (
					<div
						key={m.id}
						className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}
					>
						<div
							className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
								m.sender === "user"
									? "bg-accent text-white rounded-br-md"
									: m.sender === "ai"
										? "bg-surface2 border border-accent/10 rounded-bl-md"
										: "bg-surface2 rounded-bl-md"
							}`}
						>
							{m.sender === "admin" && (
								<p className="text-[10px] font-bold flex items-center gap-1 text-accent mb-0.5">
									<ShieldCheck size={10} /> ADMIN
								</p>
							)}
							{m.sender === "ai" && (
								<p className="text-[10px] font-bold flex items-center gap-1 text-accent/70 mb-0.5">
									<Bot size={10} /> AI ASSISTANT
								</p>
							)}
							{m.attachment_url && (
								<img
									src={m.attachment_url}
									alt="attachment"
									loading="lazy"
									className="rounded-lg mb-1.5 max-h-48"
								/>
							)}
							{m.body && <p className="prose-desc">{m.body}</p>}
							<p
								className={`text-[9px] mt-1 ${m.sender === "user" ? "text-white/60" : "text-ink3"}`}
							>
								{fmtDate(m.created_at ?? "")}
							</p>
						</div>
					</div>
				))}

				{/* Typing indicator — premium animated dots */}
				{typing && (
					<TypingIndicator variant="preview" label="AI is responding..." />
				)}

				<div ref={bottomRef} />
			</div>

			<div className="flex gap-2 mt-3">
				<button
					className="btn btn-ghost !px-3"
					onClick={() => fileRef.current?.click()}
					aria-label="Attach image"
				>
					<ImagePlus size={16} />
				</button>
				<input
					ref={fileRef}
					type="file"
					name="chat-attachment"
					accept="image/*"
					className="hidden"
					onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])}
				/>
				<input
					className="input"
					name="chat-message"
					placeholder="Message the support team…"
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
					maxLength={2000}
					aria-label="Chat message"
				/>
				<button
					className="btn btn-primary !px-4"
					onClick={() => send()}
					disabled={busy || !text.trim()}
					aria-label="Send"
				>
					{busy ? (
						<Loader2 size={15} className="animate-spin" />
					) : (
						<Send size={15} />
					)}
				</button>
			</div>
		</div>
	);
}
