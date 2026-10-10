import {
	Bot,
	BotOff,
	Heart,
	ImagePlus,
	Loader2,
	MessageSquare,
	Send,
	ShieldCheck,
	Trash2,
	Volume2,
	VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	LoadingSpinner,
	prefersReducedMotion,
	VB_FULL_CYCLE_MS,
} from "../components/ErrorBoundary";
import TypingIndicator from "../components/TypingIndicator";
import Typewriter from "../components/Typewriter";
import { ConfirmDialog } from "../components/ui";
import UpdateNotice from "../components/admin/UpdateNotice";
import { useApp } from "../contexts/AppContext";
import { useUpdateSignal } from "../hooks/useUpdateSignal";
import { api } from "../lib/api";
import { useRealtime } from "../lib/useRealtime";
import { fmtDate, sanitize } from "../lib/utils";
import { lsGet, lsSet } from "../lib/identity";
import {
	readAloud,
	speechOutputSupported,
	stopReading,
} from "../lib/speech";
import type { ChatMessage } from "../types";

interface InboxResponse {
	messages: ChatMessage[];
	thread: { thread_id: string; status: string };
	state?: {
		agent?: string;
		draft_proposal?: { status?: string; title?: string; description?: string; category?: string };
		draft_suggestion?: { status?: string };
	};
	title?: string;
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
	const [chatTitle, setChatTitle] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [text, setText] = useState("");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [typing, setTyping] = useState(false);
	// Typewriter reveal + voice read-back for the freshly arrived AI reply.
	const [streamId, setStreamId] = useState<string | number | null>(null);
	const [readBack, setReadBack] = useState<boolean>(() => lsGet<boolean>("vb:readaloud", true));
	const [agentLabel, setAgentLabel] = useState<string | null>(null);
	// AI-mode: user-controllable auto-replies. The server gates generation
	// authoritatively; this cached copy just renders the switch instantly
	// without an extra request on chat open.
	const [aiEnabled, setAiEnabled] = useState<boolean>(() =>
		lsGet<boolean>("vb:aichat", true),
	);
	const [aiBusy, setAiBusy] = useState(false);
	const [triageNote, setTriageNote] = useState<string | null>(null);
	// In-chat draft card: the AI proposed a post from an explicit request.
	// Accept publishes it with the student's own visibility choice (default
	// private; public drafts are held for admin review first); Dismiss drops it.
	const [pendingDraft, setPendingDraft] = useState<{ title: string; description: string; category: string } | null>(null);
	const [draftVisibility, setDraftVisibility] = useState<"private" | "public">("private");
	const [draftBusy, setDraftBusy] = useState(false);
	// Proactive nudge ("Would you like me to generate a complaint?") shown
	// when the server suggests a draft for a described problem. Generate
	// reuses the draft card below (with its private/public choice); Not now
	// dismisses server-side so the nudge never returns for this thread.
	const [showNudge, setShowNudge] = useState(false);
	const [nudgeBusy, setNudgeBusy] = useState(false);
	// Local Dismiss of the draft card must survive the next load(): the
	// server proposal stays open until accepted, and load() restores open
	// proposals (reload-loss fix) — without this the card would resurrect.
	const draftDismissedRef = useRef(false);
	const acceptDraftCard = async () => {
		if (!pendingDraft || draftBusy) return;
		setDraftBusy(true);
		try {
			const res = await api.postInbox<{ status?: string }>("/api/inbox", {
				thread_id: anonId,
				action: "accept_own_draft",
				visibility: draftVisibility,
			});
			setPendingDraft(null);
			setDraftVisibility("private");
			setTriageNote(
				res.status === "pending_review"
					? "📋 Sent for admin review — it goes public once approved."
					: draftVisibility === "public"
						? "📋 Sent for admin review — it goes public once approved."
						: "✅ Your private post is live — visible only to you and the admin team.",
			);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Could not publish — try again", "err");
		} finally {
			setDraftBusy(false);
		}
	};
	// Nudge actions: Generate runs the shared server pipeline through an
	// explicit tap (the draft card takes over from there, with its
	// private/public choice); Not now dismisses server-side so the nudge
	// never returns for this thread. Both hide the card instantly; failures
	// surface honestly and the next load converges from server truth.
	const generateFromNudge = async () => {
		if (nudgeBusy) return;
		setNudgeBusy(true);
		try {
			const res = await api.postInbox<{
				draft_proposed?: boolean;
				draft?: { title: string; description: string; category: string } | null;
			}>("/api/inbox", {
				thread_id: anonId,
				action: "request_own_draft",
			});
			setShowNudge(false);
			if (res.draft && res.draft.title) {
				draftDismissedRef.current = false;
				setPendingDraft({
					title: res.draft.title,
					description: res.draft.description,
					category: res.draft.category,
				});
			} else {
				toast("Couldn't draft that just now — describe it once more?", "err");
			}
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Could not draft — try again", "err");
		} finally {
			setNudgeBusy(false);
		}
	};
	const dismissNudge = async () => {
		if (nudgeBusy) return;
		setNudgeBusy(true);
		setShowNudge(false);
		try {
			await api.postInbox("/api/inbox", {
				thread_id: anonId,
				action: "dismiss_draft_suggestion",
			});
		} catch {
			// Dismiss is idempotent server-side; a failed call simply leaves
			// the suggestion live, and the next load resurrects the nudge.
		} finally {
			setNudgeBusy(false);
		}
	};
	const [readingId, setReadingId] = useState<string | number | null>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const sendingRef = useRef(false);

	// ── Initial-loader floor ─────────────────────────────────────────
	// The loader must reflect REAL loading, not a decorative countdown.
	//
	// It used to be VB_FULL_CYCLE_MS — 3200ms x 5 motives = 16 SECONDS held
	// unconditionally, even when the inbox answered in 50ms. That is the
	// "cover the problem with a loading spinner" antipattern: it converts a
	// fast response into a slow one and hides real latency behind a splash.
	// A genuine load failure looked identical to a slow network.
	//
	// What is actually justified is a tiny anti-flicker floor: a loader that
	// appears for 30ms and vanishes reads as a rendering glitch. 250ms is
	// enough. Reduced-motion users get none at all — there is no animation to
	// protect, and a longer floor for them was simply backwards.
	const MIN_LOADER_MS = prefersReducedMotion() ? 0 : 250;
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
			setChatTitle(data.title ?? null);
			// Restore an open draft proposal so a reload never loses the card —
			// unless the student dismissed it locally (the server proposal stays
			// open until accepted; the next Generate reuses it via dedupe).
			const openProposal = data.state?.draft_proposal;
			if (
				openProposal?.status === "proposed" &&
				!draftDismissedRef.current &&
				typeof openProposal.title === "string" &&
				openProposal.title
			) {
				setPendingDraft({
					title: openProposal.title,
					description:
						typeof openProposal.description === "string"
							? openProposal.description
							: "",
					category:
						typeof openProposal.category === "string"
							? openProposal.category
							: "Other",
				});
				setShowNudge(false);
			} else if (!openProposal || openProposal.status !== "proposed") {
				// Converge the nudge from server truth (covers POST-driven and
				// reload-driven arrivals alike).
				setShowNudge(data.state?.draft_suggestion?.status === "suggested");
			}
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
			// Fallback to old chat API — merge, don't replace, so an
			// optimistic bubble from an in-flight send is never wiped.
			try {
				const data = await api.get<InboxResponse>(
					`/api/chat?thread_id=${anonId}`,
				);
				setMessages((prev: ChatMessage[]) =>
					mergeMessages(prev, data.messages || []),
				);
				setThread(data.thread);
			setChatTitle(data.title ?? null);
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

	// ── Visible-only auto-peek (contract evolution 2026-10-05) ──
	// chat_messages is outside the anon realtime contract
	// (src/lib/realtimeContract.json), so the subscription below can never
	// deliver: without this, a reply from another device appears only after
	// a manual refresh. Peek at the thread every 4s while this page is
	// mounted AND visible, plus once on focus/visibility return. This is a
	// merge, not a load: no mark_read PUT (read state is written by the
	// explicit load/send paths), no loader touch, and getFresh bypasses the
	// 5s GET cache so the tick sees live rows. One timer for one thread —
	// no fan-out; torn down on unmount.
	const peek = useCallback(async () => {
		if (
			typeof document !== "undefined" &&
			document.visibilityState === "hidden"
		)
			return;
		try {
			const data = await api.getFresh<InboxResponse>(
				`/api/inbox?thread_id=${anonId}`,
			);
			const newMsgs = data.messages || [];
			setMessages((prev: ChatMessage[]) => mergeMessages(prev, newMsgs));
		} catch {
			/* offline ok */
		}
	}, [anonId]);

	useEffect(() => {
		const id = window.setInterval(() => {
			void peek();
		}, 4000);
		const refetch = () => {
			void peek();
		};
		window.addEventListener("focus", refetch);
		document.addEventListener("visibilitychange", refetch);
		return () => {
			window.clearInterval(id);
			window.removeEventListener("focus", refetch);
			document.removeEventListener("visibilitychange", refetch);
		};
	}, [peek]);

	const toggleAi = async () => {
		if (aiBusy) return;
		const next = !aiEnabled;
		setAiBusy(true);
		try {
			await api.post("/api/notify-prefs", {
				user_id: anonId,
				ai_chat_enabled: next,
			});
			setAiEnabled(next);
			lsSet("vb:aichat", next);
			toast(
				next
					? "AI replies are back on"
					: "AI replies paused — an admin will answer you directly",
				"ok",
			);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Could not update setting", "err");
		}
		setAiBusy(false);
	};

	// Freshness signal, not a refetch: the old wiring reloaded the WHOLE
	// thread on every matching event, so a lively conversation (or a slow AI
	// reply landing in pieces) fired a burst of full refetches that competed
	// with actual message delivery — the thread visibly rebuilt over and
	// over. Realtime now only raises a badge; the reader pulls the thread
	// with the update notice. Own messages stay instant (optimistic bubble
	// in send()), and the send path still refreshes after its own write.
	//
	// SCALE: chat_messages is a global table, but this page owns exactly one
	// thread (the current user's anon id). Without filtering on the changed
	// thread_id, one message from any user would raise a badge on every open
	// conversation — the same fan-out the old refetch had, just cheaper.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();

	const handleThreadUpdate = useCallback(async () => {
		await load();
		clearUpdates();
	}, [load, clearUpdates]);

	useRealtime(
		["chat_messages"],
		(_table, payload) => {
			const next = payload?.new as { thread_id?: string } | undefined;
			const prev = payload?.old as { thread_id?: string } | undefined;
			const changedThreadId =
				payload?.eventType === "DELETE" ? prev?.thread_id : next?.thread_id;
			// POLL/VISIBLE events intentionally carry no row payload. They are
			// recovery signals, so raise the badge when the thread id is
			// unavailable rather than fetching blindly.
			if (changedThreadId && changedThreadId !== anonId) return;
			markUpdatesAvailable();
		},
		1000,
	);

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
				triage?: { reported?: boolean; urgency?: string; private?: boolean };
				draft_proposed?: boolean;
				draft_suggested?: boolean;
				draft?: { title: string; description: string; category: string; private: boolean } | null;
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

			// TYPEWRITER-STREAM-ARM: reveal + voice the fresh reply only.
		if (result.auto_reply && (result.auto_reply as ChatMessage).id !== undefined) {
			const freshId = (result.auto_reply as ChatMessage).id as string | number;
			setStreamId(freshId);
			if (readBack && speechOutputSupported && (result.auto_reply as ChatMessage).body) {
				readAloud((result.auto_reply as ChatMessage).body || "");
			}
		}
		// Surface instant triage: the inbox files real reports, not chat.
		setTriageNote(null);
		if (result.triage?.reported) {
			setTriageNote(
				result.triage.urgency === "urgent"
					? "🚨 Marked urgent — filed as a private report and the admin team was notified immediately."
					: result.triage.private
						? "🔒 Filed as a private report — it stays between you and the admin team, never public."
						: "📋 Filed as a report — the admin team will review it shortly.",
			);
		}
		if (result.draft && result.draft.title) setPendingDraft({
			title: result.draft.title,
			description: result.draft.description,
			category: result.draft.category,
		});
		if (result.draft_proposed) {
			setTriageNote((prev) =>
				(prev ? prev + " " : "") +
				"✏️ I drafted a post from what you asked to share — an admin reviews it before anything is published.",
			);
		}
		if (result.draft_suggested) setShowNudge(true);

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
			const synced = (await load()) || [];
			if (!synced.some((m) => m.body === body && m.sender === "user")) {
				// The message provably did NOT land server-side — restore the
				// draft instead of eating the user's words.
				setText(body);
			}
			if (/offline|taking too long|timed out|network|failed to fetch/i.test(errMsg)) {
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

	// ── Voice ────────────────────────────────────────────────


	useEffect(
		() => () => {
			stopReading();
		},
		[],
	);
	const toggleRead = (m: ChatMessage) => {
		if (readingId === m.id) {
			stopReading();
			setReadingId(null);
			return;
		}
		stopReading();
		setReadingId(m.id ?? null);
		readAloud(m.body || "", () => setReadingId(null));
	};

	const deleteConversation = async () => {
		if (deleting) return;
		setDeleting(true);
		setConfirmDelete(false);
		try {
			await api.post("/api/inbox", { action: "delete_thread", thread_id: anonId });
			setMessages([]);
			setThread(null);
			setChatTitle(null);
			setChatUnread(0);
			toast("Conversation deleted", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Could not delete — try again", "err");
		}
		setDeleting(false);
	};
	return (
		<div className="max-w-3xl mx-auto px-4 py-6 vb-page-enter flex flex-col h-[calc(100vh-9.5rem)] lg:h-[calc(100vh-8rem)]">
			{/* Header — same treatment as Community insights */}
			<div className="flex items-center gap-2.5 mb-5">
				<span className="vb-empty-icon !w-9 !h-9">
					<MessageSquare size={17} />
				</span>
				<div className="min-w-0 flex-1">
					<h1 className="font-display font-bold text-xl sm:text-2xl leading-tight">
						Anonymous inbox
					</h1>
					<p className="text-xs text-ink3 truncate">
						{aiEnabled
							? "Chat directly — our AI assistant responds instantly. An admin will join when available."
							: "AI replies are paused. Your messages reach the admin team directly."}
						{thread?.status === "closed" &&
							" · This conversation was closed by admin."}
					</p>
				</div>
				<button
					type="button"
					onClick={toggleAi}
					disabled={aiBusy}
					role="switch"
					aria-checked={aiEnabled}
					title={aiEnabled ? "Turn AI replies off" : "Turn AI replies on"}
					className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold transition-all ${
						aiEnabled
							? "border-accent/30 bg-accent/10 text-accent"
							: "border-border bg-surface2 text-ink3"
					}`}
				>
					{aiBusy ? (
						<Loader2 size={12} className="animate-spin" />
					) : aiEnabled ? (
						<Bot size={12} />
					) : (
						<BotOff size={12} />
					)}
					<span className="hidden sm:inline">AI {aiEnabled ? "ON" : "OFF"}</span>
				</button>
				<button type="button" onClick={() => setConfirmDelete(true)} disabled={deleting} title="Delete conversation" aria-label="Delete conversation" className="shrink-0 inline-flex items-center rounded-full border border-border px-2.5 py-1.5 text-ink3 hover:text-bad hover:border-bad/40 disabled:opacity-50">
					<Trash2 size={12} />
				</button>
			</div>
			{chatTitle && (
				<p className="text-xs text-ink2 truncate mt-2" data-testid="chat-title">{chatTitle}</p>
			)}

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

			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => void handleThreadUpdate()}
			/>

			<div className="card flex-1 overflow-y-auto p-4 space-y-3">
				{loading && (
					<LoadingSpinner
						text="Opening your anonymous inbox…"
						// The SPLASH length is the full story, so a genuinely slow
						// load still gets the animation. It is not a gate: the
						// component unmounts the moment data lands.
						durationMs={VB_FULL_CYCLE_MS}
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
							{m.body && (m.sender === "ai" && m.id === streamId ? (
							<p className="prose-desc">
								<Typewriter text={m.body} label="AI reply" />
							</p>
						) : (
							<p className="prose-desc">{m.body}</p>
						))}
							{(m.sender === "ai" || m.sender === "admin") && m.body && speechOutputSupported && (
								<button
									type="button"
									onClick={() => toggleRead(m)}
									aria-label={readingId === m.id ? "Stop reading aloud" : "Read aloud (device voice)"}
									title={readingId === m.id ? "Stop" : "Listen (device voice)"}
									className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-accent/70 hover:text-accent"
								>
									{readingId === m.id ? <VolumeX size={11} /> : <Volume2 size={11} />}
									{readingId === m.id ? "Stop" : "Listen"}
								</button>
							)}
							<p
								className={`text-[9px] mt-1 ${m.sender === "user" ? "text-white/60" : "text-ink3"}`}
							>
								{fmtDate(m.created_at ?? "")}
							</p>
						</div>
					</div>
				))}

				{/* Typing indicator — premium animated dots (AI mode only) */}
				{typing && aiEnabled && (
					<TypingIndicator variant="preview" label="AI is responding..." />
				)}
				{typing && !aiEnabled && (
					<TypingIndicator variant="preview" label="Sending to the admin team…" />
				)}

				<div ref={bottomRef} />
			</div>

			{/* Triage confirmation — the inbox files reports, not chat */}
			{triageNote && (
				<div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-xs text-accent mt-3 animate-in slide-in-from-top-1" role="status">
					<span className="font-medium">{triageNote}</span>
				</div>
			)}

			{/* Nudge — "Would you like me to generate a complaint?" Nothing is
			    drafted until Generate is tapped; Not now dismisses for good. */}
			{showNudge && !pendingDraft && (
				<div className="card border-accent/30 p-3.5 mt-3" data-testid="draft-nudge" role="dialog" aria-label="Generate a complaint?">
					<p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1.5">Turn this chat into a complaint?</p>
					<p className="text-xs text-ink2 leading-relaxed">I can draft it from what you described — you review it, choose private or public, and post it. Nothing is published automatically.</p>
					<div className="flex gap-2 mt-3">
						<button type="button" disabled={nudgeBusy} onClick={() => void generateFromNudge()} className="btn btn-primary !text-xs flex-1">{nudgeBusy ? "Drafting…" : "Generate complaint"}</button>
						<button type="button" disabled={nudgeBusy} onClick={() => void dismissNudge()} className="btn btn-ghost !text-xs">Not now</button>
					</div>
				</div>
			)}

			{/* Draft card — Accept publishes with your visibility choice, Dismiss drops it */}
			{pendingDraft && (
				<div className="card border-accent/30 p-3.5 mt-3" data-testid="draft-card" role="dialog" aria-label="Suggested post">
					<p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1.5">Suggested post — your call</p>
					<p className="font-semibold text-sm leading-snug">{pendingDraft.title}</p>
					<span className="chip !text-[10px] mt-1.5">{pendingDraft.category}</span>
					<p className="text-xs text-ink2 leading-relaxed mt-1">{pendingDraft.description}</p>
					<div className="flex gap-2 mt-3" role="radiogroup" aria-label="Post visibility">
						{(["private", "public"] as const).map((v) => (
							<button
								key={v}
								type="button"
								role="radio"
								aria-checked={draftVisibility === v}
								disabled={draftBusy}
								onClick={() => setDraftVisibility(v)}
								className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40 ${
									draftVisibility === v
										? "border-accent bg-accent-soft text-accent"
										: "border-border text-ink2"
								}`}
							>
								{v === "private" ? "🔒 Private" : "🌍 Public"}
							</button>
						))}
					</div>
					{draftVisibility === "public" && (
						<p className="text-[11px] text-ink3 mt-1.5">
							Public posts are reviewed by an admin before anyone sees them.
						</p>
					)}
					<div className="flex gap-2 mt-3">
						<button type="button" disabled={draftBusy} onClick={() => void acceptDraftCard()} className="btn btn-primary !text-xs flex-1">{draftBusy ? "Posting…" : draftVisibility === "private" ? "Post privately" : "Send for review"}</button>
						<button type="button" disabled={draftBusy} onClick={() => { setPendingDraft(null); draftDismissedRef.current = true; setDraftVisibility("private"); }} className="btn btn-ghost !text-xs">Dismiss</button>
					</div>
				</div>
			)}

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
		<p className="mt-1.5 text-[10px] text-ink3">Replies can be read back in your device voice.</p>
			{/* READBACK-TOGGLE */}
			<button type="button" onClick={() => { const next = !readBack; setReadBack(next); lsSet("vb:readaloud", next); if (!next) stopReading(); }} aria-pressed={readBack} aria-label="Read AI replies aloud" title="Hear AI replies in your device voice" className="mt-1 text-[10px] font-bold text-accent/70 hover:text-accent">🔊 Read aloud: {readBack ? "on" : "off"}</button>
	<ConfirmDialog
		open={confirmDelete}
		onClose={() => setConfirmDelete(false)}
		onConfirm={() => void deleteConversation()}
		title="Delete conversation?"
		message="Your messages and this conversation will be permanently removed. This cannot be undone."
		confirmLabel="Delete"
		danger
	/>
		</div>
	);
}
