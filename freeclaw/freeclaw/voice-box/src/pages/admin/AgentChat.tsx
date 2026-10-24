// ═══════════════════════════════════════════════════════════════════
// AI COWORKER — the admin-visible front door to the autonomous workforce.
// Talks to the real /api/agent-chat backend (chat / execute / reject /
// history / sessions) and renders real workforce state from
// /api/workforce?action=ops-summary. No fake or simulated activity:
// every reply and action card is produced server-side from live queries.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import {
	Bot,
	Loader2,
	MessageSquare,
	Plus,
	RefreshCw,
	Search,
	Send,
	Sparkles,
	Terminal,
} from "lucide-react";
import { api } from "../../lib/api";
import { useApp } from "../../contexts/AppContext";
import ActionCard from "./agent-chat/ActionCard";
import {
	QUICK_ACTIONS,
	TOOL_META,
	type Action,
	type Message,
} from "./agent-chat/tool-meta";

/* ── Types (mirrors the /api/agent-chat + ops-summary contracts) ── */
interface ChatResponse {
	reply?: string;
	actions?: unknown[];
	requires_approval?: boolean;
	session_id?: string;
	provider?: string;
	error?: string;
}

interface ActionResult {
	id?: string;
	success?: boolean;
	result?: unknown;
	error?: string;
}

interface ExecuteResponse {
	results?: ActionResult[];
	error?: string;
}

interface HistoryRow {
	id?: string;
	session_id: string;
	role: "user" | "assistant" | "system" | string;
	content: string;
	actions?: unknown;
	provider?: string;
	created_at?: string;
}

interface SessionRow {
	session_id: string;
	last_message?: string;
}

/* ── Normalizers (backend rows → UI Message/Action) ─────────────── */
function toActions(raw: unknown): Action[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((a, i) => {
			const obj = (a ?? {}) as Record<string, unknown>;
			return {
				// Generated ids must be unique across messages AND time:
				// Date.now()+index alone collides for two id-less actions in
				// different messages within the same millisecond, and then
				// patchAction/executing-set would hit the wrong card.
				id:
					typeof obj.id === "string"
						? obj.id
						: `act_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
				tool: typeof obj.tool === "string" ? obj.tool : "generic",
				args:
					obj.args && typeof obj.args === "object"
						? (obj.args as Record<string, unknown>)
						: {},
				reason: typeof obj.reason === "string" ? obj.reason : "",
				destructive: Boolean(obj.destructive),
				result: obj.result ? (obj.result as Action["result"]) : undefined,
			} satisfies Action;
		})
		.filter((a) => a.tool !== "generic" || a.reason);
}

function rowToMessage(row: HistoryRow): Message {
	const role = row.role === "user" || row.role === "system" ? row.role : "assistant";
	return {
		role,
		content: row.content ?? "",
		actions: toActions(row.actions),
		provider: row.provider ?? undefined,
		created_at: row.created_at ?? new Date().toISOString(),
	};
}

const SESSION_KEY = "vb:agentChatSession";

export default function AgentChat() {
	const { toast } = useApp();

	const [messages, setMessages] = useState<Message[]>([]);
	const [sessionId, setSessionId] = useState("");
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [executing, setExecuting] = useState<Set<string>>(new Set());
	const [sessions, setSessions] = useState<SessionRow[]>([]);
	const [loadingHistory, setLoadingHistory] = useState(false);

	// Real workforce state (fail-soft — the chat must keep working even if
	// the ops-summary scan is unavailable)
	const [status, setStatus] = useState<{
		metrics?: {
			working?: number;
			verifying?: number;
			total_employees?: number;
			verified_outcomes?: number;
			success_rate?: number | null;
		};
		ai_provider?: { ok?: boolean; status?: string; note?: string };
		config?: { paused?: boolean };
		updated_at?: string;
	} | null>(null);
	const [statusError, setStatusError] = useState(false);

	const endRef = useRef<HTMLDivElement | null>(null);

	/* ── Mount: real backend state ─────────────────────────────── */
	useEffect(() => {
		let cancelled = false;

		// Ops-summary gives REAL workforce state (working/verifying/verified
		// outcomes + AI provider) — informative, never load-bearing.
		api
			.getSlow<unknown>("/api/workforce?action=ops-summary")
			.then((s) => {
				if (cancelled) return;
				if (s && typeof s === "object" && !Array.isArray(s))
					setStatus(s as NonNullable<typeof status>);
				else throw new Error("unexpected ops-summary shape");
			})
			.catch(() => !cancelled && setStatusError(true));

		// Sessions list — real persisted conversations
		void api
			.get<SessionRow[]>("/api/agent-chat?action=sessions")
			.then((rows) => {
				if (!cancelled && Array.isArray(rows)) setSessions(rows);
			})
			.catch(() => {
				/* non-fatal */
			});

		// Restore the last session, if any (inline so the effect deps stay [])
		let stored = "";
		try {
			stored = window.sessionStorage.getItem(SESSION_KEY) ?? "";
		} catch {
			/* storage unavailable */
		}
		if (stored) {
			setSessionId(stored);
			setLoadingHistory(true);
			void api
				.get<HistoryRow[]>(
					`/api/agent-chat?action=history&session_id=${encodeURIComponent(stored)}`,
				)
				.then((rows) => {
					if (!cancelled)
						setMessages(Array.isArray(rows) ? rows.map(rowToMessage) : []);
				})
				.catch(() => {
					/* non-fatal — chat still works without restored history */
				})
				.finally(() => {
					if (!cancelled) setLoadingHistory(false);
				});
		}

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		// Guard: jsdom (tests) and some embedded webviews lack scrollIntoView.
		const el = endRef.current;
		if (el && typeof el.scrollIntoView === "function")
			el.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}, [messages.length, busy]);

	/* ── Session management ────────────────────────────────────── */
	async function refreshSessions() {
		try {
			const rows = await api.get<SessionRow[]>("/api/agent-chat?action=sessions");
			if (Array.isArray(rows)) setSessions(rows);
		} catch {
			/* non-fatal */
		}
	}

	async function openSession(sid: string) {
		setSessionId(sid);
		setLoadingHistory(true);
		try {
			const rows = await api.get<HistoryRow[]>(
				`/api/agent-chat?action=history&session_id=${encodeURIComponent(sid)}`,
			);
			setMessages(Array.isArray(rows) ? rows.map(rowToMessage) : []);
			try {
				window.sessionStorage.setItem(SESSION_KEY, sid);
			} catch {
				/* ignore */
			}
		} catch (e) {
			toast(
				e instanceof Error ? e.message : "Failed to load conversation",
				"err",
			);
		} finally {
			setLoadingHistory(false);
		}
	}

	async function newSession() {
		setSessionId("");
		setMessages([]);
		try {
			window.sessionStorage.removeItem(SESSION_KEY);
		} catch {
			/* ignore */
		}
		void refreshSessions();
	}

	/* ── Core loop: TRIGGER → REAL TOOLS → REAL STATE CHANGE ──── */
	async function send(text?: string) {
		const raw = (text ?? input).trim();
		if (!raw || busy) return;

		setBusy(true);
		const optimistic: Message = {
			role: "user",
			content: raw,
			created_at: new Date().toISOString(),
		};
		const prev = messages;
		setMessages((m) => [...m, optimistic]);
		setInput("");

		try {
			const r = await api.postAgent<ChatResponse>("/api/agent-chat", {
				message: raw,
				session_id: sessionId || undefined,
			});
			if (r.error) throw new Error(r.error);

			const sid = r.session_id ?? sessionId;
			if (sid) {
				setSessionId(sid);
				try {
					window.sessionStorage.setItem(SESSION_KEY, sid);
				} catch {
					/* ignore */
				}
			}
			const reply: Message = {
				role: "assistant",
				content: r.reply ?? "",
				actions: toActions(r.actions),
				provider: r.provider ?? undefined,
				created_at: new Date().toISOString(),
			};
			setMessages((m) => [...m, reply]);
			void refreshSessions();
		} catch (e) {
			// Draft recovery — restore the input and drop the un-sent row
			const msg = e instanceof Error ? e.message : "Request failed";
			setInput(raw);
			setMessages(prev);
			toast(`AI Coworker failed: ${msg}`, "err");
		} finally {
			setBusy(false);
		}
	}

	function patchAction(actId: string, result: Action["result"]) {
		setMessages((m) =>
			m.map((msg) =>
				msg.actions?.some((a) => a.id === actId)
					? {
							...msg,
							actions: msg.actions.map((a) =>
								a.id === actId ? { ...a, result } : a,
							),
						}
					: msg,
			),
		);
	}

	async function runAction(act: Action, mode: "execute" | "reject") {
		if (executing.has(act.id)) return;
		setExecuting((s) => new Set(s).add(act.id));
		try {
			const r = await api.postAgent<ExecuteResponse>("/api/agent-chat", {
				action: mode,
				actions: [{ id: act.id, tool: act.tool, args: act.args }],
				session_id: sessionId || undefined,
			});
			const res = (r.results ?? [])[0];
			if (mode === "execute") {
				if (res?.success)
					patchAction(act.id, {
						success: true,
						data: res.result,
					});
				else
					patchAction(act.id, {
						success: false,
						error: res?.error ?? "Execution failed",
					});
				toast(
					res?.success ? `Executed ${act.tool} — real change applied` : `Execute failed: ${res?.error ?? "unknown"}`,
					res?.success ? "ok" : "err",
				);
			} else {
				patchAction(act.id, {
					success: false,
					data: { rejected: true },
					error: "Rejected by admin — no change applied",
				});
				toast(`Rejected ${act.tool} — no change applied`, "ok");
			}
		} catch (e) {
			toast(
				e instanceof Error ? e.message : `${mode} failed`,
				"err",
			);
		} finally {
			setExecuting((s) => {
				const n = new Set(s);
				n.delete(act.id);
				return n;
			});
		}
	}

	/* ── Render helpers ────────────────────────────────────────── */
	const fmtTime = (iso?: string) => {
		if (!iso) return "";
		try {
			return new Date(iso).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return "";
		}
	};

	const pendingCount = messages.reduce(
		(n, m) => n + (m.actions?.filter((a) => !a.result).length ?? 0),
		0,
	);

	return (
		<div className="vb-agent-chat">
			{/* ── Header: real workforce + AI provider state ───────── */}
			<div className="flex flex-wrap items-start justify-between gap-3 mb-4">
				<div>
					<h1 className="text-lg font-bold text-ink flex items-center gap-2">
						<Bot size={20} className="text-accent" aria-hidden />
						AI Coworker
					</h1>
					<p className="text-xs text-ink3 mt-0.5 max-w-xl">
						Autonomous admin front door. Every answer is computed server-side
						from live platform queries — nothing here is simulated.
					</p>
				</div>
				<div className="flex flex-wrap gap-1.5 text-[11px]">
					{status?.metrics ? (
						<>
							<span className="px-2 py-1 rounded-lg bg-surface2 border border-border text-ink2">
								Working:{" "}
								<span className="font-semibold text-ink">
									{status.metrics.working ?? 0}
								</span>
							</span>
							<span className="px-2 py-1 rounded-lg bg-surface2 border border-border text-ink2">
								Verifying:{" "}
								<span className="font-semibold text-ink">
									{status.metrics.verifying ?? 0}
								</span>
							</span>
							<span className="px-2 py-1 rounded-lg bg-surface2 border border-border text-ink2">
								Verified outcomes:{" "}
								<span className="font-semibold text-ink">
									{status.metrics.verified_outcomes ?? 0}
								</span>
							</span>
							<span className="px-2 py-1 rounded-lg bg-surface2 border border-border text-ink2">
								Success rate:{" "}
								<span className="font-semibold text-ink">
									{status.metrics.success_rate == null
										? "—"
										: `${status.metrics.success_rate.toFixed(1)}%`}
								</span>
							</span>
						</>
					) : (
						<span
							className={`px-2 py-1 rounded-lg border ${
								statusError
									? "bg-surface2 border-border text-ink3"
									: "bg-surface2 border-border text-ink3 animate-pulse"
							}`}
						>
							{statusError
								? "live workforce state unavailable"
								: "loading live workforce state…"}
						</span>
					)}
					<span
						className={`px-2 py-1 rounded-lg border flex items-center gap-1.5 ${
							status?.ai_provider?.ok === false
								? "bg-red-500/5 border-red-500/25 text-red-300"
								: "bg-green-500/5 border-green-500/25 text-green-300"
						}`}
						title={status?.ai_provider?.note ?? ""}
					>
						<Sparkles size={11} aria-hidden /> AI:{" "}
						{status?.ai_provider?.status ?? "unknown"}
					</span>
					{status?.config?.paused && (
						<span className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300">
							workforce paused
						</span>
					)}
				</div>
			</div>

			<div className="grid gap-4 xl:grid-cols-[1fr_280px]">
				{/* ── Chat column ───────────────────────────────────── */}
				<div className="flex flex-col min-h-[60vh]">
					<div className="flex-1 rounded-2xl border border-border bg-surface/60 overflow-hidden flex flex-col">
						{/* Session bar */}
						<div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2 text-[11px] text-ink3 bg-surface2/50">
							<span className="flex items-center gap-1.5 min-w-0">
								<MessageSquare size={12} aria-hidden />
								{loadingHistory ? (
									"Loading conversation…"
								) : sessionId ? (
									<span className="truncate">
										Session <code className="text-accent">{sessionId}</code>
									</span>
								) : (
									"New session — first message creates it"
								)}
							</span>
							<span className="flex items-center gap-1.5 shrink-0">
								{pendingCount > 0 && (
									<span className="px-1.5 py-0.5 rounded-md bg-accent/15 text-accent font-semibold">
										{pendingCount} action{pendingCount === 1 ? "" : "s"} awaiting review
									</span>
								)}
								<button
									type="button"
									onClick={() => void newSession()}
									className="flex items-center gap-1 hover:text-ink transition-colors"
									title="New session"
								>
									<Plus size={12} aria-hidden /> New session
								</button>
							</span>
						</div>

						{/* Messages */}
						<div className="flex-1 overflow-y-auto p-3 space-y-3 max-h-[50vh] min-h-[40vh]">
							{messages.length === 0 && !loadingHistory && (
								<div className="text-center py-10 px-6">
									<div className="mx-auto w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-3">
										<Terminal size={22} className="text-accent" aria-hidden />
									</div>
									<h2 className="font-bold text-ink mb-1">
										Your autonomous workforce, on call
									</h2>
									<p className="text-xs text-ink3 max-w-md mx-auto leading-relaxed">
										Ask the Coworker anything about the platform. It observes
										live state, investigates with real database queries, then
										proposes actions backed by tools — destructive ones only
										execute after you approve.
									</p>
								</div>
							)}

							{messages.map((m, i) => {
								if (m.role === "system")
									return (
										<div
											key={i}
											className="text-center text-[11px] text-ink3 bg-surface2 rounded-lg px-3 py-1.5 mx-auto max-w-md"
										>
											{m.content}
										</div>
									);
								const isUser = m.role === "user";
								return (
									<div
										key={i}
										className={`flex ${isUser ? "justify-end" : "justify-start"}`}
									>
										<div
											className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
												isUser
													? "bg-accent/15 border border-accent/25 text-ink"
													: "bg-surface2 border border-border text-ink"
											}`}
										>
											{!isUser && m.provider && (
												<div className="flex items-center gap-1.5 mb-1.5 text-[10px] uppercase tracking-wide text-ink3">
													<Bot size={10} aria-hidden />
													<span className="truncate max-w-[240px]" title={m.provider}>
														{m.provider}
													</span>
												</div>
											)}
											<p className="whitespace-pre-wrap break-words">{m.content}</p>
											{m.actions && m.actions.length > 0 && (
												<div className="mt-2.5 space-y-2">
													{m.actions.map((a) => (
														<ActionCard
															key={a.id}
															action={a}
															executing={executing.has(a.id)}
															onExecute={() => void runAction(a, "execute")}
															onDismiss={() => void runAction(a, "reject")}
														/>
													))}
												</div>
											)}
											<div className="mt-1 text-[10px] text-ink3/70">
												{fmtTime(m.created_at)}
											</div>
										</div>
									</div>
								);
							})}
							{busy && (
								<div className="flex justify-start">
									<div className="flex items-center gap-2 text-xs text-ink3 bg-surface2 border border-border rounded-2xl px-3.5 py-2.5">
										<Loader2 size={13} className="animate-spin text-accent" />
										Coworker is querying live data…
									</div>
								</div>
							)}
							<div ref={endRef} />
						</div>

						{/* Composer */}
						<div className="p-3 border-t border-border bg-surface2/40">
							<div className="flex gap-2">
								<input
									type="text"
									value={input}
									onChange={(e) => setInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && !e.shiftKey) {
											e.preventDefault();
											void send();
										}
									}}
									placeholder="Ask the Coworker something, or pick a quick action…"
									disabled={busy}
									className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:outline-none focus:border-accent disabled:opacity-60"
									aria-label="Coworker message"
								/>
								<button
									type="button"
									onClick={() => void send()}
									disabled={busy || !input.trim()}
									className="rounded-xl bg-accent text-white px-3.5 flex items-center gap-1.5 text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
								>
									{busy ? (
										<Loader2 size={14} className="animate-spin" aria-hidden />
									) : (
										<Send size={14} aria-hidden />
									)}
									Send
								</button>
							</div>
							<div className="flex flex-wrap gap-1.5 mt-2">
								{QUICK_ACTIONS.map((q) => (
									<button
										key={q.label}
										type="button"
										disabled={busy}
										onClick={() => void send(q.msg)}
										className="text-[11px] px-2.5 py-1 rounded-lg bg-surface2 border border-border text-ink2 hover:border-accent/50 hover:text-ink transition-colors disabled:opacity-50"
									>
										{q.label}
									</button>
								))}
							</div>
						</div>
					</div>
				</div>

				{/* ── Rail: real sessions + tool catalog ───────────── */}
				<aside className="space-y-4 xl:sticky xl:top-2 self-start w-full">
					<div className="rounded-2xl border border-border bg-surface/60 p-3">
						<h3 className="text-[11px] uppercase tracking-wide text-ink3 font-semibold mb-2 flex items-center gap-1.5">
							<RefreshCw size={11} aria-hidden /> Sessions
						</h3>
						<div className="space-y-1 max-h-[220px] overflow-y-auto">
							{sessions.length === 0 && (
								<p className="text-[11px] text-ink3">
									No persisted sessions yet — every reply is still real and
									stored server-side.
								</p>
							)}
							{sessions.map((s) => (
								<button
									key={s.session_id}
									type="button"
									onClick={() => void openSession(s.session_id)}
									className={`w-full text-left text-[11px] px-2 py-1.5 rounded-lg flex items-center justify-between gap-2 transition-colors ${
										s.session_id === sessionId
											? "bg-accent/15 text-accent font-semibold"
											: "hover:bg-surface2 text-ink2"
									}`}
									title={s.session_id}
								>
									<span className="truncate font-mono">{s.session_id}</span>
									<span className="shrink-0 text-ink3">
										{fmtTime(s.last_message)}
									</span>
								</button>
							))}
						</div>
					</div>

					<div className="rounded-2xl border border-border bg-surface/60 p-3">
						<h3 className="text-[11px] uppercase tracking-wide text-ink3 font-semibold mb-2 flex items-center gap-1.5">
							<Search size={11} aria-hidden /> Real tool capabilities
						</h3>
						<div className="flex flex-wrap gap-1.5">
							{Object.entries(TOOL_META).map(([tool, meta]) => {
								const Icon = meta.icon;
								return (
									<span
										key={tool}
										title={tool}
										className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg border bg-surface2"
									>
										<Icon size={10} className={meta.color} aria-hidden />
										{meta.label}
									</span>
								);
							})}
						</div>
						<p className="text-[10px] text-ink3 mt-2 leading-relaxed">
							These run against real database tables via the agent execution
							engine — results return as verifiable state changes, not
							simulations.
						</p>
					</div>
				</aside>
			</div>
		</div>
	);
}