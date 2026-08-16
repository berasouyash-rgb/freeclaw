// ─── Admin AI — Unified Intelligence Workspace ───────────────────
// Replaces AdminAI + AgentChat + AgentPanel into one component.
// Chat SSE via /api/ai-chat (working). Side panel with agents, tools,
// health, suggestions, audit, memory, KB, reports, and learning.
// /api/v3/stream references removed — that endpoint is not deployed.

import type { LucideIcon } from "lucide-react";
import {
	Activity,
	AlertTriangle,
	Bot,
	Brain,
	Check,
	CheckCircle,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	ClipboardList,
	Clock,
	Copy,
	Database,
	Eye,
	FileText,
	Flag,
	GitMerge,
	HeartPulse,
	History,
	Loader2,
	MessageSquare,
	RefreshCcw,
	RefreshCw,
	Search,
	Send,
	Shield,
	Sparkles,
	Square,
	Wrench,
	X,
	XCircle,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	LoadingSpinner,
	prefersReducedMotion,
	VB_FULL_CYCLE_MS,
} from "../../components/ErrorBoundary";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { escapeHtml, renderMarkdown } from "../../lib/markdown";
import { useRealtime } from "../../lib/useRealtime";
import {
	isExecutableSuggestion,
	errorText,
	safeStringify,
	suggestionEffect,
	timeAgo,
} from "../../lib/utils";
import { QUICK_ACTIONS } from "./agent-chat/tool-meta";

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

interface ProcessStep {
	step_id: string;
	label: string;
	status: "active" | "done" | "error";
	detail?: string;
	model?: string;
}

interface ToolResult {
	tool: string;
	args: Record<string, unknown>;
	result?: unknown;
	error?: string;
}

interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
	streamingContent?: string;
	isStreaming?: boolean;
	steps?: ProcessStep[];
	toolResults?: ToolResult[];
	hasToolUse?: boolean;
	provider?: string;
	model?: string;
	created_at: string;
	runId?: string;
	thinking?: string;
	streamingThinking?: string;
}

interface ToolSchema {
	name: string;
	description: string;
	category: string;
	permissions: string;
	parameters?: Record<string, unknown>;
	requiresApproval?: boolean;
}

interface HealthData {
	status: string;
	uptime?: number;
	database?: { status: string; latency_ms: number };
	cache?: { size: number; hit_rate?: number };
	circuit_breakers?: Record<string, { state: string; failures: number }>;
}

interface AuditEntry {
	id: string;
	actor: string;
	action: string;
	detail: string;
	created_at: string;
}

interface MemoryEntry {
	id: string;
	agent_id: string;
	memory_type: string;
	content: Record<string, unknown> | string;
	created_at: string;
}

interface AgentSuggestion {
	id: number;
	kind: string;
	title: string;
	reasoning: string;
	content?: Record<string, string>;
	critical?: boolean;
	status: "pending" | "approved" | "dismissed";
	confidence?: number;
	outcome?: string;
	created_at: string;
}

type SideTab =
	| "agents"
	| "tools"
	| "health"
	| "activity"
	| "audit"
	| "memory"
	| "kb"
	| "reports"
	| "learning";

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */

const SESSION_KEY = "vb:admin-ai-session";
const MAX_TOKEN_LENGTH = 4000;

const KIND_META: Record<
	string,
	{ label: string; icon: LucideIcon; color: string }
> = {
	status_change: {
		label: "Status change",
		icon: Activity,
		color: "var(--vb-accent)",
	},
	solved_confirm: {
		label: "Confirm solved",
		icon: Check,
		color: "var(--vb-good)",
	},
	escalation: { label: "Escalation", icon: Flag, color: "var(--vb-bad)" },
	reply: { label: "Reply draft", icon: MessageSquare, color: "var(--vb-good)" },
	merge: { label: "Merge duplicate", icon: GitMerge, color: "var(--vb-warn)" },
};

const toolCatColor: Record<string, string> = {
	read: "text-blue-400 bg-blue-400/10",
	create: "text-green-400 bg-green-400/10",
	update: "text-amber-400 bg-amber-400/10",
	delete: "text-red-400 bg-red-400/10",
	search: "text-purple-400 bg-purple-400/10",
	system: "text-cyan-400 bg-cyan-400/10",
};

const ADMIN_QUICK_ACTIONS = [
	{
		label: "Show system status",
		icon: HeartPulse,
		prompt: "Show me the current system health and status",
		color: "emerald",
	},
	{
		label: "List all tools",
		icon: Wrench,
		prompt: "List all available AI tools and their capabilities",
		color: "blue",
	},
	{
		label: "Recent activity",
		icon: Clock,
		prompt: "Show me the recent admin activity logs",
		color: "amber",
	},
	{
		label: "Search knowledge base",
		icon: Database,
		prompt: "Search the knowledge base for common issues",
		color: "purple",
	},
	{
		label: "Memory overview",
		icon: Brain,
		prompt: "Show me what the AI system remembers",
		color: "violet",
	},
	{
		label: "Agent performance",
		icon: Bot,
		prompt: "Show me agent execution statistics and performance",
		color: "cyan",
	},
];

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function getAdminToken(): string | null {
	try {
		const raw = sessionStorage.getItem("vb:adminAuth");
		if (!raw) return null;
		const { token, exp } = JSON.parse(raw);
		if (exp && exp < Date.now()) {
			sessionStorage.removeItem("vb:adminAuth");
			return null;
		}
		return token;
	} catch {
		return null;
	}
}

function formatTime(iso: string): string {
	try {
		return new Date(iso).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return "";
	}
}

function stripToolCallJson(text: string): string {
	let cleaned = text.trim();
	cleaned = cleaned.replace(/^\s*\[\s*\{\s*"name"\s*:.*\}\s*\]\s*$/s, "");
	cleaned = cleaned.replace(
		/^\s*\{\s*"name"\s*:.*"arguments"\s*:.*\}\s*$/s,
		"",
	);
	cleaned = cleaned.replace(/^\s*\{\s*"tool"\s*:.*"input"\s*:.*\}\s*$/s, "");
	cleaned = cleaned.replace(/\n*\s*\[\s*\{\s*"name"\s*:.*\}\s*\]\s*$/s, "");
	cleaned = cleaned.replace(/\n*\s*\{\s*"tool"\s*:.*"input"\s*:.*\}\s*$/s, "");
	return cleaned.trim();
}

/* ═══════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */

function ThinkingAnimation({ size = 32 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 40 40"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="thinking-animation"
		>
			<circle
				className="thinking-glow"
				cx="20"
				cy="20"
				r="16"
				fill="var(--vb-accent, oklch(84% 0.19 80.46))"
			/>
			<circle
				className="thinking-dot-1"
				cx="12"
				cy="20"
				r="3"
				fill="var(--vb-accent, oklch(84% 0.19 80.46))"
			/>
			<circle
				className="thinking-dot-2"
				cx="20"
				cy="20"
				r="3"
				fill="var(--vb-accent, oklch(84% 0.19 80.46))"
			/>
			<circle
				className="thinking-dot-3"
				cx="28"
				cy="20"
				r="3"
				fill="var(--vb-accent, oklch(84% 0.19 80.46))"
			/>
		</svg>
	);
}

function AutoResizeTextarea({
	value,
	onChange,
	onKeyDown,
	placeholder,
	disabled,
}: {
	value: string;
	onChange: (v: string) => void;
	onKeyDown: (e: React.KeyboardEvent) => void;
	placeholder: string;
	disabled?: boolean;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = Math.min(el.scrollHeight, 120) + "px";
	}, [value]);
	return (
		<textarea
			ref={ref}
			rows={1}
			className="input flex-1 !text-sm !py-3 !px-4 !pr-12 resize-none leading-relaxed"
			placeholder={placeholder}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			onKeyDown={onKeyDown}
			disabled={disabled}
			style={{ minHeight: "44px", maxHeight: "120px" }}
		/>
	);
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function AdminAI() {
	const { toast } = useApp();

	// ── Chat state (from AgentChat — working SSE) ──
	const [messages, _setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [loadingHistory, setLoadingHistory] = useState(true);
	const [activeRunId, setActiveRunId] = useState<string | null>(null);
	const [sessionId] = useState(() => {
		const stored = localStorage.getItem(SESSION_KEY);
		if (stored) return stored;
		const id = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		localStorage.setItem(SESSION_KEY, id);
		return id;
	});

	// ── Throttled message updates (from AgentChat) ──
	const messagesRef = useRef<ChatMessage[]>([]);
	const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const setMessagesImmediate = useCallback(
		(updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
			const next =
				typeof updater === "function" ? updater(messagesRef.current) : updater;
			messagesRef.current = next;
			_setMessages(next);
		},
		[],
	);

	const setMessagesThrottled = useCallback(
		(updater: (prev: ChatMessage[]) => ChatMessage[]) => {
			messagesRef.current = updater(messagesRef.current);
			if (!flushTimerRef.current) {
				flushTimerRef.current = setInterval(() => {
					_setMessages([...messagesRef.current]);
					if (flushTimerRef.current) {
						clearInterval(flushTimerRef.current);
						flushTimerRef.current = null;
					}
				}, 50);
			}
		},
		[],
	);

	const flushMessages = useCallback(() => {
		if (flushTimerRef.current) {
			clearInterval(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		_setMessages([...messagesRef.current]);
	}, []);

	useEffect(
		() => () => {
			if (flushTimerRef.current) clearInterval(flushTimerRef.current);
		},
		[],
	);

	// ── Side panel state ──
	const [sideTab, setSideTab] = useState<SideTab>("agents");
	const [sideCollapsed, setSideCollapsed] = useState(false);

	// ── History ──
	const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
	const [showHistory, setShowHistory] = useState(false);

	// ── Refs ──
	const chatRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	// ── Tools ──
	const [tools, setTools] = useState<ToolSchema[]>([]);
	const [toolFilter, setToolFilter] = useState("");

	// ── Health ──
	const [health, setHealth] = useState<HealthData | null>(null);
	const [healthLoading, setHealthLoading] = useState(false);

	// ── Audit ──
	const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
	const [auditFilter, setAuditFilter] = useState("");

	// ── Memory ──
	const [memories, setMemories] = useState<MemoryEntry[]>([]);
	const [memorySearch, setMemorySearch] = useState("");
	const [memorySearchResults, setMemorySearchResults] = useState<MemoryEntry[]>(
		[],
	);

	// ── KB / RAG ──
	const [ragQuery, setRagQuery] = useState("");
	const [ragResults, setRagResults] = useState<Record<string, unknown>[]>([]);
	const [ragLoading, setRagLoading] = useState(false);

	// ── Agent Reports ──
	const [agentReports, setAgentReports] = useState<Record<string, unknown>[]>(
		[],
	);
	const [reportStats, setReportStats] = useState<{
		total_24h: number;
		by_severity: Record<string, number>;
		by_division: Record<string, number>;
		critical: number;
		high: number;
	} | null>(null);
	const [reportsLoading, setReportsLoading] = useState(false);
	const [supervisorAlerts] = useState<Record<string, unknown> | null>(null);

	// ── Learning ──
	const [learningStats, setLearningStats] = useState<Record<
		string,
		unknown
	> | null>(null);
	const [learningLoading, setLearningLoading] = useState(false);
	const [learningInsights, setLearningInsights] = useState<
		Record<string, unknown>[]
	>([]);
	const [learningRecords, setLearningRecords] = useState<
		Record<string, unknown>[]
	>([]);

	// ── Suggestions (from AgentPanel) ──
	const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
	const [suggestionsLoading, setSuggestionsLoading] = useState(true);
	const [suggestionsBusy, setSuggestionsBusy] = useState(false);
	const [confirming, setConfirming] = useState<AgentSuggestion | null>(null);
	const [editText, setEditText] = useState("");
	const [suggestionTab, setSuggestionTab] = useState<"pending" | "history">(
		"pending",
	);

	// ── Copy ──
	const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

	// ── Initial-loader minimum display time ─────────────────────────
	// The motive loader tells a 5-line story over VB_FULL_CYCLE_MS. If the
	// history answers instantly, the spinner used to vanish before the story
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
			setLoadingHistory(false);
			return;
		}
		loaderTimerRef.current = window.setTimeout(() => {
			if (mountedRef.current) setLoadingHistory(false);
		}, remaining);
	}, [MIN_LOADER_MS]);

	/* ─── Data loaders ─────────────────────────────────────────── */
	const loadHistory = useCallback(async () => {
		try {
			const data = await api.postLong<Record<string, unknown>[]>(
				"/api/ai-chat",
				{
					action: "history",
					session_id: sessionId,
				},
			);
			if (Array.isArray(data)) {
				setMessagesImmediate(
					data.map((d: Record<string, unknown>) => ({
						role: d.role as ChatMessage["role"],
						content: d.content as string,
						created_at: d.created_at as string,
						toolResults: d.actions
							? JSON.parse(d.actions as string)
							: undefined,
						hasToolUse: !!d.actions,
					})),
				);
			}
		} catch (e: unknown) {
			console.error("Failed to load chat history:", e);
		} finally {
			holdLoaderForFullStory();
		}
	}, [sessionId, setMessagesImmediate, holdLoaderForFullStory]);

	const loadSessions = useCallback(async () => {
		try {
			const data = await api.postLong<Record<string, unknown>[]>(
				"/api/ai-chat",
				{ action: "sessions" },
			);
			setSessions(data);
		} catch (e: unknown) {
			console.error("Failed to load chat sessions:", e);
		}
	}, []);

	const loadTools = useCallback(async () => {
		try {
			const data = await api.get<{ tools: ToolSchema[] }>(
				"/api/tool-registry?action=list",
			);
			setTools(data.tools || []);
		} catch (e: unknown) {
			console.warn(
				"[AdminAI] Failed to load tools:",
				e instanceof Error ? e.message : e,
			);
		}
	}, []);

	const loadHealth = useCallback(async () => {
		setHealthLoading(true);
		try {
			const token = getAdminToken();
			const headers: Record<string, string> = {};
			if (token) headers["x-admin-token"] = token;
			const res = await fetch("/api/health", { headers });
			if (res.ok) setHealth(await res.json());
		} catch (e: unknown) {
			console.warn(
				"[AdminAI] Failed to load health:",
				e instanceof Error ? e.message : e,
			);
		}
		setHealthLoading(false);
	}, []);

	const loadAuditLogs = useCallback(async () => {
		try {
			const data = await api.get<{ logs: AuditEntry[] }>(
				"/api/audit-trail?action=recent&limit=50",
			);
			setAuditLogs(data.logs || []);
		} catch (e: unknown) {
			console.warn(
				"[AdminAI] Failed to load audit logs:",
				e instanceof Error ? e.message : e,
			);
		}
	}, []);

	const loadMemory = useCallback(async () => {
		try {
			const data = await api.get<{ memories: MemoryEntry[] }>(
				"/api/memory?action=list&limit=50",
			);
			setMemories(data.memories || []);
		} catch (e: unknown) {
			console.warn(
				"[AdminAI] Failed to load memory:",
				e instanceof Error ? e.message : e,
			);
		}
	}, []);

	const loadSuggestions = useCallback(async () => {
		try {
			const s = await api.get<AgentSuggestion[]>("/api/agent");
			setSuggestions(Array.isArray(s) ? s : []);
		} catch (e: unknown) {
			toast(
				e instanceof Error ? e.message : "Failed to load suggestions",
				"err",
			);
		}
		setSuggestionsLoading(false);
	}, [toast]);

	const loadReports = useCallback(async () => {
		setReportsLoading(true);
		try {
			const data = await api.get<{
				reports: Record<string, unknown>[];
				stats: typeof reportStats;
			}>("/api/agent-team?action=reports&limit=50");
			setAgentReports(data.reports || []);
			setReportStats(data.stats || null);
		} catch (e: unknown) {
			console.warn(
				"[AdminAI] Failed to load reports:",
				e instanceof Error ? e.message : e,
			);
		}
		setReportsLoading(false);
	}, []);

	const loadLearning = useCallback(async () => {
		setLearningLoading(true);
		try {
			const [stats, insightsData, recordsData] = await Promise.all([
				api.get<Record<string, unknown>>("/api/learning?action=stats"),
				api.get<{ insights: Record<string, unknown>[] }>(
					"/api/learning?action=insights",
				),
				api.get<{ records: Record<string, unknown>[] }>(
					"/api/learning?action=records&limit=30",
				),
			]);
			setLearningStats(stats);
			setLearningInsights(insightsData.insights || []);
			setLearningRecords(recordsData.records || []);
		} catch (e: unknown) {
			console.warn(
				"[AdminAI] Failed to load learning:",
				e instanceof Error ? e.message : e,
			);
		}
		setLearningLoading(false);
	}, []);

	const searchMemory = useCallback(async () => {
		if (!memorySearch.trim()) return;
		try {
			const data = await api.get<{ memories: MemoryEntry[] }>(
				`/api/memory?action=search&q=${encodeURIComponent(memorySearch)}`,
			);
			setMemorySearchResults(data.memories || []);
		} catch (e: unknown) {
			console.warn(
				"[AdminAI] Failed to search memory:",
				e instanceof Error ? e.message : e,
			);
		}
	}, [memorySearch]);

	const searchRAG = useCallback(async () => {
		if (!ragQuery.trim()) return;
		setRagLoading(true);
		try {
			const data = await api.post<{ results: Record<string, unknown>[] }>(
				"/api/rag",
				{ query: ragQuery, limit: 10 },
			);
			setRagResults(data.results || []);
		} catch (e: unknown) {
			console.warn(
				"[AdminAI] Failed to search KB:",
				e instanceof Error ? e.message : e,
			);
		}
		setRagLoading(false);
	}, [ragQuery]);

	/* ─── Mount: load all data ──────────────────────────────────── */
	useEffect(() => {
		loadHistory();
		loadSessions();
		loadTools();
		loadHealth();
		loadAuditLogs();
		loadMemory();
		loadSuggestions();
	}, [
		loadHistory,
		loadSessions,
		loadTools,
		loadHealth,
		loadAuditLogs,
		loadMemory,
		loadSuggestions,
	]);

	/* ─── Realtime: keep side panels live ─────────────────────────
     The chat is already live via SSE. These subscriptions refresh the
     suggestion / memory / audit / reports / learning panels whenever
     their backing tables change (agents insert rows in the background).
     Polling fallback in useRealtime covers channels that can't connect. */
	useRealtime(
		[
			"agent_suggestions",
			"agent_memory",
			"activity_logs",
			"agent_reports",
			"agent_insights",
			"agent_executions",
		],
		(table) => {
			if (table === "agent_suggestions") loadSuggestions();
			else if (table === "agent_memory") loadMemory();
			else if (table === "activity_logs") {
				loadAuditLogs();
				loadHealth();
			} else if (table === "agent_reports") loadReports();
			else if (table === "agent_insights") loadLearning();
			else loadHealth(); // agent_executions → refresh health/agent activity
		},
		1500,
	);

	/* ─── Load on-demand tabs ───────────────────────────────────── */
	useEffect(() => {
		if (sideTab === "reports" && agentReports.length === 0 && !reportsLoading)
			loadReports();
		if (sideTab === "learning" && learningStats === null && !learningLoading)
			loadLearning();
	}, [
		sideTab,
		agentReports.length,
		reportsLoading,
		learningStats,
		learningLoading,
		loadReports,
		loadLearning,
	]);

	/* ─── Auto-scroll ───────────────────────────────────────────── */
	useEffect(() => {
		const el = chatRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
		if (nearBottom) {
			requestAnimationFrame(() => {
				// scrollTo({behavior:'smooth'}) is unsupported in some environments
				// (jsdom tests, older webviews) — fall back to scrollTop assignment.
				if (typeof el.scrollTo === "function") {
					el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
				} else {
					el.scrollTop = el.scrollHeight;
				}
			});
		}
	}, [messages]);

	/* ─── Cancel run ────────────────────────────────────────────── */
	const cancelRun = useCallback(async (runId: string) => {
		abortRef.current?.abort();
		try {
			await fetch("/api/ai-chat", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Admin-Token": getAdminToken() || "",
				},
				body: JSON.stringify({ action: "cancel", run_id: runId }),
			});
		} catch (e: unknown) {
			console.warn(
				"[AdminAI] Failed to cancel:",
				e instanceof Error ? e.message : e,
			);
		}
		setBusy(false);
		setActiveRunId(null);
	}, []);

	/* ─── Copy message ──────────────────────────────────────────── */
	const copyMessage = useCallback((text: string, idx: number) => {
		navigator.clipboard.writeText(text).then(() => {
			setCopiedIdx(idx);
			setTimeout(() => setCopiedIdx(null), 1500);
		});
	}, []);

	/* ─── New conversation ──────────────────────────────────────── */
	const newConversation = () => {
		const id = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		localStorage.setItem(SESSION_KEY, id);
		setMessagesImmediate([]);
		setShowHistory(false);
	};

	/* ═══════════════════════════════════════════════════════════════
     SEND MESSAGE — SSE via /api/ai-chat (NVIDIA cloud AI)
     ═══════════════════════════════════════════════════════════════ */
	const send = useCallback(
		async (text?: string) => {
			const msg = (text || input).trim();
			if (!msg || busy) return;
			setInput("");

			const runId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const userMsg: ChatMessage = {
				role: "user",
				content: msg,
				created_at: new Date().toISOString(),
			};
			const assistantMsg: ChatMessage = {
				role: "assistant",
				content: "",
				streamingContent: "",
				streamingThinking: "",
				isStreaming: true,
				steps: [],
				toolResults: [],
				hasToolUse: false,
				runId,
				created_at: new Date().toISOString(),
			};

			setMessagesImmediate((m) => [...m, userMsg, assistantMsg]);
			setBusy(true);
			setActiveRunId(runId);

			// Abort controller for the SSE request
			const abortController = new AbortController();
			abortRef.current = abortController;

			// ── Cloud AI mode: SSE via /api/ai-chat ──
			const currentMessages = messagesRef.current;
			const historyForBackend = currentMessages
				.slice(0, -2)
				.filter(
					(m) => m.role === "user" || (m.role === "assistant" && m.content),
				)
				.map((m) => ({ role: m.role, content: m.content }));
			historyForBackend.push({ role: "user" as const, content: msg });

			try {
				const response = await fetch("/api/ai-chat", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(getAdminToken() ? { "X-Admin-Token": getAdminToken()! } : {}),
					},
					body: JSON.stringify({
						messages: historyForBackend,
						session_id: sessionId,
						stream: true,
						run_id: runId,
					}),
					signal: abortController.signal,
				});

				if (!response.ok) {
					const errData = await response.json().catch(() => ({}));
					throw new Error(errData.error || `Server error (${response.status})`);
				}

				const reader = response.body?.getReader();
				if (!reader) throw new Error("No response body");

				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";

					for (const line of lines) {
						if (!line.startsWith("data: ")) continue;
						const dataStr = line.slice(6).trim();
						if (dataStr === "[DONE]") continue;

						try {
							const event = JSON.parse(dataStr);

							switch (event.ada_event) {
								case "thinking_delta":
									setMessagesThrottled((m) =>
										m.map((msg, i) => {
											if (i !== m.length - 1 || msg.role !== "assistant")
												return msg;
											return {
												...msg,
												streamingThinking:
													(msg.streamingThinking || "") + (event.delta || ""),
											};
										}),
									);
									break;

								case "content_delta":
									setMessagesThrottled((m) =>
										m.map((msg, i) => {
											if (i !== m.length - 1 || msg.role !== "assistant")
												return msg;
											return {
												...msg,
												streamingContent:
													(msg.streamingContent || "") + (event.delta || ""),
											};
										}),
									);
									break;

								case "process_step":
									setMessagesThrottled((m) =>
										m.map((msg, i) => {
											if (i !== m.length - 1 || msg.role !== "assistant")
												return msg;
											const existingSteps = msg.steps || [];
											const stepIdx = existingSteps.findIndex(
												(s) => s.step_id === event.step_id,
											);
											const newStep: ProcessStep = {
												step_id: event.step_id,
												label: event.label,
												status: event.status,
												detail: event.detail,
												model: event.model,
											};
											const updatedSteps =
												stepIdx >= 0
													? existingSteps.map((s, si) =>
															si === stepIdx ? newStep : s,
														)
													: [...existingSteps, newStep];
											return { ...msg, steps: updatedSteps, hasToolUse: true };
										}),
									);
									break;

								case "iteration_start":
									setMessagesThrottled((m) =>
										m.map((msg, i) => {
											if (i !== m.length - 1 || msg.role !== "assistant")
												return msg;
											return {
												...msg,
												streamingContent: "",
												streamingThinking:
													(msg.streamingThinking || "") +
													`\n${event.message || "Processing..."}\n`,
											};
										}),
									);
									break;

								case "tool_result":
									setMessagesThrottled((m) =>
										m.map((msg, i) => {
											if (i !== m.length - 1 || msg.role !== "assistant")
												return msg;
											const toolResult: ToolResult = {
												tool: event.tool,
												args: event.args || {},
												result: event.result,
												error: errorText(event.result?.error),
											};
											return {
												...msg,
												toolResults: [...(msg.toolResults || []), toolResult],
												hasToolUse: true,
											};
										}),
									);
									break;

								case "done":
									flushMessages();
									setMessagesImmediate((m) =>
										m.map((msg, i) => {
											if (i !== m.length - 1 || msg.role !== "assistant")
												return msg;
											return {
												...msg,
												content:
													event.text || msg.streamingContent || msg.content,
												thinking:
													event.thinking || msg.streamingThinking || undefined,
												streamingContent: undefined,
												streamingThinking: undefined,
												isStreaming: false,
												provider: event.provider,
												model: event.model,
											};
										}),
									);
									break;

								case "error":
									flushMessages();
									setMessagesImmediate((m) =>
										m.map((msg, i) => {
											if (i !== m.length - 1 || msg.role !== "assistant")
												return msg;
											return {
												...msg,
												content: `Error: ${event.message || "Stream error occurred"}`,
												streamingContent: undefined,
												isStreaming: false,
											};
										}),
									);
									break;
							}
						} catch {
							/* skip malformed events */
						}
					}
				}

				// Finalize any remaining streaming content
				flushMessages();
				setMessagesImmediate((m) =>
					m.map((msg, i) => {
						if (
							i !== m.length - 1 ||
							msg.role !== "assistant" ||
							!msg.isStreaming
						)
							return msg;
						return {
							...msg,
							content:
								msg.streamingContent || msg.content || "No response received.",
							thinking: msg.streamingThinking || msg.thinking,
							streamingContent: undefined,
							streamingThinking: undefined,
							isStreaming: false,
						};
					}),
				);
			} catch (e: unknown) {
				const errMsg = e instanceof Error ? e.message : String(e);
				flushMessages();
				if (errMsg.includes("aborted")) {
					setMessagesImmediate((m) =>
						m.map((msg, i) => {
							if (i !== m.length - 1 || msg.role !== "assistant") return msg;
							return {
								...msg,
								content: msg.streamingContent || "Cancelled.",
								thinking: msg.streamingThinking || msg.thinking,
								streamingContent: undefined,
								streamingThinking: undefined,
								isStreaming: false,
							};
						}),
					);
				} else {
					toast(errMsg, "err");
					setMessagesImmediate((m) =>
						m.map((msg, i) => {
							if (i !== m.length - 1 || msg.role !== "assistant") return msg;
							return {
								...msg,
								content: `Error: ${errMsg}`,
								streamingContent: undefined,
								streamingThinking: undefined,
								isStreaming: false,
							};
						}),
					);
				}
			} finally {
				flushMessages();
				setBusy(false);
				setActiveRunId(null);
				abortRef.current = null;
				loadSessions();
				setTimeout(() => inputRef.current?.focus(), 100);
			}
		},
		[
			input,
			busy,
			sessionId,
			toast,
			setMessagesImmediate,
			setMessagesThrottled,
			flushMessages,
			loadSessions,
		],
	);

	/* ─── Suggestion actions (from AgentPanel) ──────────────────── */
	const generateSuggestions = async () => {
		setSuggestionsBusy(true);
		try {
			const r = await api.post<{ created?: number }>("/api/agent", {
				action: "generate",
			});
			toast(
				r.created
					? `${r.created} new suggestion(s) drafted`
					: "No new suggestions",
				"ok",
			);
			await loadSuggestions();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Generate failed", "err");
		}
		setSuggestionsBusy(false);
	};

	const dismissSuggestion = async (id: number) => {
		try {
			await api.put<unknown>("/api/agent", { id, action: "dismiss" });
			loadSuggestions();
			toast("Dismissed", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Dismiss failed", "err");
		}
	};

	const approveSuggestion = async (
		sug: AgentSuggestion,
		confirmed = false,
		edited?: string,
	) => {
		if (sug.critical && !confirmed) {
			setConfirming(sug);
			setEditText(sug.content?.to || sug.content?.reply || "");
			return;
		}
		try {
			await api.put<unknown>("/api/agent", {
				id: sug.id,
				action: "approve",
				confirmed: true,
				edited_text: edited,
			});
			setConfirming(null);
			loadSuggestions();
			toast("Approved and applied", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Approve failed", "err");
		}
	};

	/* ─── Filtered data ─────────────────────────────────────────── */
	const filteredTools = useMemo(() => {
		if (!toolFilter) return tools;
		const q = toolFilter.toLowerCase();
		return tools.filter(
			(t) =>
				t.name.toLowerCase().includes(q) ||
				t.description.toLowerCase().includes(q) ||
				t.category.toLowerCase().includes(q),
		);
	}, [tools, toolFilter]);

	const filteredAuditLogs = useMemo(() => {
		if (!auditFilter) return auditLogs;
		const q = auditFilter.toLowerCase();
		return auditLogs.filter(
			(l) =>
				l.actor.toLowerCase().includes(q) ||
				l.action.toLowerCase().includes(q) ||
				l.detail.toLowerCase().includes(q),
		);
	}, [auditLogs, auditFilter]);

	const pendingSuggestions = useMemo(
		() => suggestions.filter((s) => s.status === "pending"),
		[suggestions],
	);
	const historySuggestions = useMemo(
		() => suggestions.filter((s) => s.status !== "pending"),
		[suggestions],
	);
	const shownSuggestions =
		suggestionTab === "pending" ? pendingSuggestions : historySuggestions;

	/* ─── Keyboard ──────────────────────────────────────────────── */
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey && !busy) {
			e.preventDefault();
			send();
		}
	};

	/* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */
	return (
		<div className="h-[calc(100vh-6rem)] flex flex-col">
			{/* ── Header ──────────────────────────────────────────────── */}
			<div className="flex items-center justify-between mb-3 flex-shrink-0">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
						<Brain size={18} className="text-accent" />
					</div>
					<div>
						<h1 className="font-display font-bold text-lg flex items-center gap-2">
							Admin AI
							<span className="text-[10px] font-mono text-ink3 bg-surface2 px-2 py-0.5 rounded-full">
								INTELLIGENCE CENTER
							</span>
						</h1>
						<p className="text-[11px] text-ink3">
							Chat &middot; Agents &middot; Suggestions &middot; Systems
							&middot; Knowledge
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{/* Provider indicator: NVIDIA cloud AI */}
					<span className="flex items-center gap-1.5 text-[10px] bg-accent/8 px-2.5 py-1.5 rounded-lg border border-accent/15 shadow-sm">
						<Zap size={10} className="text-accent" />
						<span className="font-semibold text-accent">NVIDIA</span>
						<span className="text-ink3/40">·</span>
						<span className="text-ink3/70 text-[9px]">Nemotron 70B</span>
					</span>
					<button
						onClick={() => setShowHistory(true)}
						className="btn btn-ghost !text-xs !py-1.5"
						title="Conversation history"
					>
						<History size={13} />
					</button>
					<button
						onClick={loadHealth}
						className="btn btn-ghost !text-xs !py-1.5"
						title="Refresh"
					>
						<RefreshCw size={13} />
					</button>
					<button
						onClick={newConversation}
						className="btn btn-primary !text-xs !py-1.5"
					>
						<Sparkles size={13} /> New chat
					</button>
				</div>
			</div>

			{/* ── Main layout: Chat + Side panel ────────────────────── */}
			<div className="flex-1 flex gap-0 rounded-2xl border border-border overflow-hidden bg-surface min-h-0">
				{/* ═══════════════════════════════════════════════════════
           LEFT: Chat Area (SSE via /api/ai-chat)
           ═══════════════════════════════════════════════════════ */}
				<div className="flex-1 flex flex-col min-w-0">
					{/* Chat messages */}
					<div
						ref={chatRef}
						className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
					>
						{loadingHistory ? (
							<LoadingSpinner
								text="Loading conversation…"
								durationMs={MIN_LOADER_MS}
							/>
						) : messages.length === 0 ? (
							/* ── Empty state ─────────────────────────────────── */
							<div className="flex flex-col items-center justify-center h-full text-center gap-6 max-w-md mx-auto">
								<div className="w-20 h-20 rounded-3xl bg-accent/10 flex items-center justify-center">
									<Brain size={36} className="text-accent" />
								</div>
								<div>
									<h2 className="font-display font-bold text-xl mb-2">
										Voice Box Admin AI
									</h2>
									<p className="text-sm text-ink3 leading-relaxed">
										Ask anything about your platform. Query your database,
										manage content, analyze data — results stream live.
									</p>
								</div>
								<div className="grid grid-cols-2 gap-2.5 w-full">
									{ADMIN_QUICK_ACTIONS.map((qa, _i) => {
										const catColors: Record<string, string> = {
											emerald:
												"from-emerald-500/20 to-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400",
											blue: "from-blue-500/20 to-blue-500/5 border-blue-500/20 hover:border-blue-500/40 text-blue-400",
											amber:
												"from-amber-500/20 to-amber-500/5 border-amber-500/20 hover:border-amber-500/40 text-amber-400",
											purple:
												"from-purple-500/20 to-purple-500/5 border-purple-500/20 hover:border-purple-500/40 text-purple-400",
											violet:
												"from-violet-500/20 to-violet-500/5 border-violet-500/20 hover:border-violet-500/40 text-violet-400",
											cyan: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/20 hover:border-cyan-500/40 text-cyan-400",
										};
										const c =
											catColors[qa.color as string] ||
											"from-accent/10 to-accent/5 border-accent/20 hover:border-accent/40 text-accent";
										return (
											<button
												key={qa.label}
												onClick={() => {
													setInput(qa.prompt);
													inputRef.current?.focus();
												}}
												className={`flex items-center gap-3 px-3.5 py-3 rounded-xl border bg-gradient-to-br ${c} text-left transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98]`}
											>
												<qa.icon
													size={16}
													className="opacity-80 group-hover:opacity-100 transition-opacity"
												/>
												<span className="text-xs font-medium opacity-80 group-hover:opacity-100 transition-opacity">
													{qa.label}
												</span>
											</button>
										);
									})}
								</div>
								{/* Quick action chips from tool-meta */}
								<div className="flex flex-wrap gap-1.5 justify-center">
									{QUICK_ACTIONS.map((qa) => (
										<button
											key={qa.label}
											className="text-[11px] text-ink2 px-3 py-1.5 rounded-full border border-border hover:border-accent/40 hover:bg-accent/5 transition-all cursor-pointer disabled:opacity-40"
											onClick={() => send(qa.msg)}
											disabled={busy}
										>
											{qa.label}
										</button>
									))}
								</div>
							</div>
						) : (
							/* ── Messages ──────────────────────────────────── */
							messages.map((m, idx) => {
								const isUser = m.role === "user";
								const displayText = m.streamingContent || m.content;
								const showThinking =
									m.role === "assistant" && (m.thinking || m.streamingThinking);

								return (
									<div
										key={idx}
										className={`flex ${isUser ? "justify-end" : "justify-start"} gap-2.5 group chat-msg-anim`}
									>
										{!isUser && (
											<div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 mt-0.5">
												<Sparkles size={14} className="text-accent" />
											</div>
										)}

										<div
											className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[80%] min-w-0`}
										>
											<div
												className={`rounded-2xl px-4 py-3 text-sm ${
													isUser
														? "bg-accent text-white rounded-br-md"
														: "bg-surface2 text-ink border border-border/50 rounded-bl-md"
												}`}
											>
												{/* Thinking / reasoning — collapsible */}
												{showThinking && (
													<details className="mb-2 group/think">
														<summary className="flex items-center gap-1.5 text-[11px] text-ink3 cursor-pointer select-none hover:text-ink2 transition-colors list-none">
															{m.isStreaming && m.streamingThinking ? (
																<Loader2
																	size={10}
																	className="animate-spin text-accent"
																/>
															) : (
																<Eye size={10} className="text-ink3/60" />
															)}
															<span className="font-medium">
																{m.isStreaming && m.streamingThinking
																	? "Analyzing..."
																	: "Reasoning"}
															</span>
															<span className="text-[9px] text-ink3/40 ml-auto group-open/think:rotate-90 transition-transform">
																&#9656;
															</span>
														</summary>
														<div className="mt-2 p-3 rounded-lg bg-black/30 border border-white/5 text-[11px] text-ink3/80 leading-relaxed max-h-48 overflow-auto whitespace-pre-wrap font-mono">
															{m.thinking || m.streamingThinking}
														</div>
													</details>
												)}

												{/* Main text content */}
												{displayText ? (
													<div
														className="whitespace-pre-wrap leading-relaxed"
														dangerouslySetInnerHTML={{
															__html: isUser
																? escapeHtml(displayText)
																: renderMarkdown(
																		stripToolCallJson(displayText),
																	),
														}}
													/>
												) : m.isStreaming &&
													!m.streamingContent &&
													(!m.steps || m.steps.length === 0) ? (
													<div className="flex items-center gap-2 text-ink3">
														<Loader2 size={12} className="animate-spin" />
														<span className="text-xs italic">Thinking...</span>
													</div>
												) : null}

												{/* Streaming cursor */}
												{m.isStreaming && displayText && (
													<span className="inline-block w-1.5 h-4 bg-accent/70 ml-0.5 animate-pulse rounded-sm align-text-bottom" />
												)}

												{/* Tool execution steps */}
												{m.steps && m.steps.length > 0 && (
													<div className="mt-3 space-y-1">
														{m.steps.map((step) => (
															<div
																key={step.step_id}
																className="flex items-center gap-2 text-[11px]"
															>
																{step.status === "active" && (
																	<Loader2
																		size={11}
																		className="text-accent animate-spin shrink-0"
																	/>
																)}
																{step.status === "done" && (
																	<CheckCircle2
																		size={11}
																		className="text-green-400 shrink-0"
																	/>
																)}
																{step.status === "error" && (
																	<XCircle
																		size={11}
																		className="text-red-400 shrink-0"
																	/>
																)}
																{step.model && (
																	<Wrench
																		size={10}
																		className="text-ink3 shrink-0"
																	/>
																)}
																<span
																	className={`${
																		step.status === "active"
																			? "text-accent"
																			: step.status === "error"
																				? "text-red-400"
																				: "text-ink3"
																	}`}
																>
																	{step.label}
																</span>
																{step.detail && (
																	<span className="text-ink3/60 truncate max-w-[200px]">
																		— {step.detail}
																	</span>
																)}
															</div>
														))}
													</div>
												)}

												{/* Tool results */}
												{m.toolResults && m.toolResults.length > 0 && (
													<div className="mt-3 space-y-2">
														{m.toolResults.map((tr, tri) => (
															<div
																key={tri}
																className={`rounded-xl border p-3 text-[11px] ${
																	tr.error
																		? "bg-red-500/5 border-red-500/20"
																		: "bg-green-500/5 border-green-500/15"
																}`}
															>
																<div className="flex items-center gap-1.5 font-semibold mb-1.5">
																	{tr.error ? (
																		<XCircle
																			size={11}
																			className="text-red-400"
																		/>
																	) : (
																		<CheckCircle2
																			size={11}
																			className="text-green-400"
																		/>
																	)}
																	<span
																		className={
																			tr.error
																				? "text-red-400"
																				: "text-green-400"
																		}
																	>
																		{tr.tool}
																	</span>
																</div>
												{tr.error ? (
													<p className="text-red-400/80">
														{errorText(tr.error)}
													</p>
												) : (
																	<pre className="font-mono text-[10px] text-ink3/70 whitespace-pre-wrap max-h-40 overflow-auto">
																		{typeof tr.result === "string"
																			? tr.result
																			: JSON.stringify(tr.result, null, 2)}
																	</pre>
																)}
															</div>
														))}
													</div>
												)}
											</div>

											{/* Meta row */}
											<div
												className={`flex items-center gap-2 mt-1 px-1 text-[9px] text-ink3/50 ${isUser ? "flex-row-reverse" : ""}`}
											>
												{m.created_at && (
													<span className="flex items-center gap-0.5">
														<Clock size={8} />
														{formatTime(m.created_at)}
													</span>
												)}
												{!isUser && displayText && (
													<button
														className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-ink2"
														onClick={() => copyMessage(displayText, idx)}
														title="Copy"
													>
														{copiedIdx === idx ? (
															<Check size={10} className="text-green-400" />
														) : (
															<Copy size={10} />
														)}
													</button>
												)}
												{!isUser &&
													m.provider &&
													m.provider !== "none" &&
													!m.isStreaming && (
														<span className="flex items-center gap-0.5 opacity-60">
															<Zap size={7} /> {m.provider}/{m.model}
														</span>
													)}
											</div>
										</div>

										{isUser && (
											<div className="w-8 h-8 rounded-lg bg-surface3 border border-border flex items-center justify-center shrink-0 mt-0.5">
												<span className="text-[11px] font-semibold text-ink2">
													Y
												</span>
											</div>
										)}
									</div>
								);
							})
						)}

						{/* Initial "thinking" indicator when busy but no streaming message yet */}
						{busy &&
							messages.length > 0 &&
							!messages[messages.length - 1]?.isStreaming && (
								<div className="flex justify-start gap-2.5">
									<div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
										<ThinkingAnimation size={28} />
									</div>
									<div className="bg-surface2 border border-border/50 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
										<span className="text-xs text-ink3 italic">
											Thinking...
										</span>
									</div>
								</div>
							)}
					</div>

					{/* ── Input area ──────────────────────────────────── */}
					<div className="border-t border-border bg-surface px-4 py-3 flex-shrink-0">
						<div className="flex items-end gap-2 bg-surface2 rounded-2xl border border-border px-3 py-2">
							<AutoResizeTextarea
								value={input}
								onChange={setInput}
								onKeyDown={onKeyDown}
								placeholder="Ask about your platform..."
								disabled={busy}
							/>
							{busy && activeRunId ? (
								<button
									className="btn !rounded-xl !w-10 !h-10 !p-0 flex items-center justify-center shrink-0 text-red-400 border border-red-500/20 hover:bg-red-500/10 bg-surface2"
									onClick={() => cancelRun(activeRunId)}
									title="Stop generating"
								>
									<Square size={14} />
								</button>
							) : (
								<button
									className="btn btn-primary !rounded-xl !w-10 !h-10 !p-0 flex items-center justify-center shrink-0 shadow-lg shadow-accent/20 disabled:opacity-40"
									onClick={() => send()}
									disabled={!input.trim()}
									title="Send (Enter)"
								>
									<Send size={15} />
								</button>
							)}
						</div>
						<div className="flex items-center justify-between mt-1.5 px-1">
							<span className="text-[9px] text-ink3">
								{input.length > 0 && `${input.length}/${MAX_TOKEN_LENGTH}`}
							</span>
							<span className="text-[9px] text-ink3">
								Shift+Enter for new line
							</span>
						</div>
					</div>
				</div>

				{/* ═══════════════════════════════════════════════════════
           RIGHT: Side Panel
           ═══════════════════════════════════════════════════════ */}
				<div
					className={`${sideCollapsed ? "w-12" : "w-80"} flex-shrink-0 border-l border-border flex flex-col bg-surface transition-all relative`}
				>
					<button
						onClick={() => setSideCollapsed(!sideCollapsed)}
						className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-surface border border-border hover:bg-surface2 transition-colors"
						title={sideCollapsed ? "Expand panel" : "Collapse panel"}
					>
						{sideCollapsed ? (
							<ChevronUp size={12} />
						) : (
							<ChevronDown size={12} />
						)}
					</button>

					{!sideCollapsed && (
						<>
							{/* ── Tab bar ──────────────────────────────────── */}
							<div className="flex border-b border-border overflow-x-auto scrollbar-none relative">
								{[
									{ key: "agents" as SideTab, label: "Agents", icon: Bot },
									{
										key: "activity" as SideTab,
										label: "Activity",
										icon: Activity,
									},
									{
										key: "health" as SideTab,
										label: "Health",
										icon: HeartPulse,
										live: health !== null,
									},
									{ key: "tools" as SideTab, label: "Tools", icon: Wrench },
									{
										key: "audit" as SideTab,
										label: "Audit",
										icon: ClipboardList,
									},
									{ key: "memory" as SideTab, label: "Memory", icon: Brain },
									{ key: "kb" as SideTab, label: "KB", icon: Database },
									{
										key: "reports" as SideTab,
										label: "Reports",
										icon: FileText,
									},
									{
										key: "learning" as SideTab,
										label: "Learn",
										icon: Sparkles,
									},
								].map(({ key, label, icon: Icon, live }) => (
									<button
										key={key}
										onClick={() => setSideTab(key)}
										className={`flex items-center gap-1.5 px-2.5 py-2.5 text-[10px] font-medium border-b-2 transition-colors whitespace-nowrap relative ${
											sideTab === key
												? "border-accent text-accent bg-accent/5"
												: "border-transparent text-ink3 hover:text-ink2 hover:bg-surface2/50"
										}`}
									>
										<Icon
											size={11}
											className={sideTab === key ? "text-accent" : ""}
										/>
										{label}
										{live && (
											<span className="w-1.5 h-1.5 rounded-full bg-good animate-pulse ml-0.5" />
										)}
									</button>
								))}
							</div>

							{/* ── Tab content ──────────────────────────────── */}
							<div className="flex-1 overflow-y-auto p-3">
								{/* ── AGENTS TAB ────────────────────────────── */}
								{sideTab === "agents" && (
									<div className="space-y-3">
										<div className="flex items-center gap-2 text-[10px] font-mono text-ink3 uppercase tracking-wider">
											<Bot size={12} className="text-accent" />
											<span>Agent Routing</span>
										</div>
										<div className="p-3 rounded-xl bg-gradient-to-br from-accent/5 to-accent/0 border border-accent/10">
											<div className="flex items-center gap-2 mb-2">
												<div className="w-2 h-2 rounded-full bg-good animate-pulse" />
												<span className="text-[11px] font-medium text-ink">
													NVIDIA Nemotron 70B
												</span>
											</div>
											<div className="flex items-center gap-3 text-[10px] text-ink3">
												<span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent">
													Primary
												</span>
												<span>1.3s avg latency</span>
												<span className="vb-live-dot" />
											</div>
										</div>
										<div className="space-y-1.5">
											<div className="flex items-center justify-between p-2.5 rounded-lg bg-surface2/50 border border-border/30">
												<div className="flex items-center gap-2">
													<div className="w-6 h-6 rounded-md bg-surface border border-border flex items-center justify-center">
														<Zap size={10} className="text-accent" />
													</div>
													<span className="text-[11px] font-medium text-ink">
														Tier 1
													</span>
												</div>
												<span className="text-[9px] text-ink3">
													Nemotron 70B
												</span>
											</div>
											<div className="flex items-center justify-between p-2.5 rounded-lg bg-surface2/30 border border-border/20">
												<div className="flex items-center gap-2">
													<div className="w-6 h-6 rounded-md bg-surface border border-border flex items-center justify-center">
														<Zap size={10} className="text-blue-400" />
													</div>
													<span className="text-[11px] font-medium text-ink2">
														Tier 2
													</span>
												</div>
												<span className="text-[9px] text-ink3">
													Llama 3.3 70B
												</span>
											</div>
											<div className="flex items-center justify-between p-2.5 rounded-lg bg-surface2/30 border border-border/20">
												<div className="flex items-center gap-2">
													<div className="w-6 h-6 rounded-md bg-surface border border-border flex items-center justify-center">
														<Zap size={10} className="text-purple-400" />
													</div>
													<span className="text-[11px] font-medium text-ink2">
														Tier 3
													</span>
												</div>
												<span className="text-[9px] text-ink3">
													Mistral Large 2
												</span>
											</div>
										</div>
										<p className="text-[9px] text-ink3/60 text-center pt-2 border-t border-border/30">
											Agent tool calls and routing steps appear here during chat
										</p>
									</div>
								)}

								{/* ── ACTIVITY TAB (Suggestions + History) ──── */}
								{sideTab === "activity" && (
									<div className="space-y-3">
										<div className="flex items-center justify-between">
											<h3 className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
												Suggestions
											</h3>
											<button
												className="btn btn-primary !text-[10px] !py-1 !px-2.5"
												onClick={generateSuggestions}
												disabled={suggestionsBusy}
											>
												<RefreshCcw
													size={11}
													className={suggestionsBusy ? "animate-spin" : ""}
												/>{" "}
												{suggestionsBusy ? "Drafting..." : "Generate"}
											</button>
										</div>

										{/* Pending / History toggle */}
										<div className="inline-flex rounded-xl bg-surface2 p-0.5 gap-0.5">
											{(["pending", "history"] as const).map((t) => (
												<button
													key={t}
													onClick={() => setSuggestionTab(t)}
													className={`px-3 py-1 rounded-lg text-[10px] font-semibold capitalize transition-all ${
														suggestionTab === t
															? "bg-surface shadow-sm text-accent"
															: "text-ink3"
													}`}
												>
													{t} (
													{t === "pending"
														? pendingSuggestions.length
														: historySuggestions.length}
													)
												</button>
											))}
										</div>

										{suggestionsLoading && (
											<div className="space-y-3">
												{[1, 2, 3].map((i) => (
													<div key={i} className="skeleton h-28" />
												))}
											</div>
										)}

										{!suggestionsLoading && shownSuggestions.length === 0 && (
											<div className="text-center py-8">
												<Bot size={24} className="mx-auto text-ink3/30 mb-2" />
												<p className="text-[11px] text-ink3">
													{suggestionTab === "pending"
														? "No pending suggestions"
														: "No history yet"}
												</p>
											</div>
										)}

										<div className="space-y-2">
											{shownSuggestions.map((s) => {
												const executable = isExecutableSuggestion(s.kind);
												const meta = !executable
													? {
															icon: Bot,
															label: "Advisory note",
															color: "#8a8f98",
														}
													: (KIND_META[s.kind] ?? {
															icon: Bot,
															label: "Unknown",
															color: "#888",
														});
												const Icon = meta.icon;
												const p = s.content || {};
												return (
													<div
														key={s.id}
														className={`p-3 rounded-xl border border-border/50 bg-surface2/50 ${s.status !== "pending" ? "opacity-70" : ""}`}
													>
														<div className="flex items-center gap-1.5 flex-wrap mb-1.5">
															<span
																className="text-[9px] px-1.5 py-0.5 rounded border"
																style={{
																	color: meta.color,
																	borderColor: meta.color + "44",
																}}
															>
																<Icon size={9} className="inline mr-0.5" />{" "}
																{meta.label}
															</span>
															{s.critical && (
																<span
																	className="text-[9px] px-1.5 py-0.5 rounded border"
																	style={{
																		color: "var(--vb-bad)",
																		borderColor: "rgba(220,75,75,0.3)",
																	}}
																>
																	Critical
																</span>
															)}
															{s.status !== "pending" && (
																<span
																	className={`text-[9px] px-1.5 py-0.5 rounded capitalize ${s.status === "approved" ? "text-green-400" : "text-ink3"}`}
																>
																	{s.status}
																</span>
															)}
															<span className="ml-auto text-[8px] text-ink3 flex items-center gap-0.5">
																<Clock size={8} /> {timeAgo(s.created_at)}
															</span>
														</div>
														<p className="text-[11px] font-medium mb-1">
															{s.title}
														</p>
														{executable && (
															<div className="rounded-lg bg-surface p-2 mb-1.5 text-[10px]">
																<div className="flex items-center gap-1.5 flex-wrap">
																	<span
																		className="px-1.5 py-0.5 rounded text-[9px] font-mono line-through"
																		style={{
																			background: "rgba(220,75,75,0.1)",
																			color: "var(--vb-bad)",
																		}}
																	>
																		{String(p.from || "(current)").slice(
																			0,
																			50,
																		) || "(empty)"}
																	</span>
																	<span className="text-ink3 text-[9px]">
																		&#8594;
																	</span>
																	<span
																		className="px-1.5 py-0.5 rounded text-[9px] font-mono"
																		style={{
																			background: "rgba(22,160,106,0.1)",
																			color: "var(--vb-good)",
																		}}
																	>
																		{String(
																			p.to ||
																				p.status ||
																				p.reply ||
																				safeStringify(p),
																		).slice(0, 80)}
																	</span>
																</div>
															</div>
														)}
														<div
															className="rounded-lg px-2 py-1.5 mb-1.5 text-[10px] leading-relaxed"
															style={{
																background: executable
																	? "rgba(22,160,106,0.06)"
																	: "rgba(138,143,152,0.08)",
																border: executable
																	? "1px solid rgba(22,160,106,0.18)"
																	: "1px solid rgba(138,143,152,0.2)",
															}}
														>
															<span
																className="text-[9px] font-bold tracking-wider uppercase"
																style={{
																	color: executable
																		? "var(--vb-good)"
																		: "#8a8f98",
																}}
															>
																{executable
																	? "What this will do — "
																	: "Note — "}
															</span>
															<span className="text-ink2">
																{suggestionEffect(s)}
															</span>
														</div>
														<p className="text-[9px] text-ink2 leading-relaxed mb-2">
															{s.reasoning}{" "}
															{typeof s.confidence === "number" && (
																<span className="text-ink3">
																	({Math.round(s.confidence * 100)}%)
																</span>
															)}
														</p>
														{s.status === "pending" && (
															<div className="flex gap-1.5">
																{executable && (
																	<button
																		className="btn !text-[9px] !py-1"
																		style={{
																			background: "rgba(22,160,106,0.12)",
																			color: "var(--vb-good)",
																		}}
																		onClick={() => approveSuggestion(s)}
																	>
																		<Check size={10} />{" "}
																		{s.critical ? "Review..." : "Approve"}
																	</button>
																)}
																<button
																	className="btn btn-ghost !text-[9px] !py-1"
																	onClick={() => dismissSuggestion(s.id)}
																>
																	<X size={10} /> Dismiss
																</button>
															</div>
														)}
													</div>
												);
											})}
										</div>
									</div>
								)}

								{/* ── HEALTH TAB ────────────────────────────── */}
								{sideTab === "health" && (
									<div className="space-y-3">
										<div className="flex items-center justify-between">
											<h3 className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
												System Health
											</h3>
											<button
												onClick={loadHealth}
												className="text-[10px] text-accent hover:underline flex items-center gap-1"
											>
												<RefreshCw size={10} /> Refresh
											</button>
										</div>
										{healthLoading && (
											<div className="text-center py-4">
												<Loader2
													size={14}
													className="animate-spin mx-auto text-ink3"
												/>
											</div>
										)}
										{health && (
											<div className="space-y-2">
												<div
													className={`p-3 rounded-xl border ${
														health.status === "healthy"
															? "border-green-400/20 bg-green-400/5"
															: health.status === "degraded"
																? "border-amber-400/20 bg-amber-400/5"
																: "border-red-400/20 bg-red-400/5"
													}`}
												>
													<div className="flex items-center gap-2">
														{health.status === "healthy" ? (
															<CheckCircle
																size={14}
																className="text-green-400"
															/>
														) : (
															<AlertTriangle
																size={14}
																className={
																	health.status === "degraded"
																		? "text-amber-400"
																		: "text-red-400"
																}
															/>
														)}
														<span className="text-xs font-bold text-ink capitalize">
															{health.status}
														</span>
													</div>
													{health.uptime && (
														<p className="text-[10px] text-ink3 mt-1">
															Uptime: {Math.floor(health.uptime / 3600)}h{" "}
															{Math.floor((health.uptime % 3600) / 60)}m
														</p>
													)}
												</div>
												{health.database && (
													<div className="p-2.5 rounded-xl border border-border/50">
														<div className="flex items-center gap-2 mb-1">
															<Database size={12} className="text-blue-400" />
															<span className="text-[11px] font-medium text-ink">
																Database
															</span>
															<span
																className={`text-[9px] px-1.5 py-0.5 rounded ${health.database.status === "ok" ? "bg-green-400/10 text-green-400" : "bg-red-400/10 text-red-400"}`}
															>
																{health.database.status}
															</span>
														</div>
														<p className="text-[10px] text-ink3">
															Latency: {health.database.latency_ms}ms
														</p>
													</div>
												)}
												{health.circuit_breakers && (
													<div className="p-2.5 rounded-xl border border-border/50">
														<div className="flex items-center gap-2 mb-2">
															<Activity size={12} className="text-purple-400" />
															<span className="text-[11px] font-medium text-ink">
																Circuit Breakers
															</span>
														</div>
														<div className="space-y-1">
															{Object.entries(health.circuit_breakers).map(
																([name, cb]) => (
																	<div
																		key={name}
																		className="flex items-center justify-between"
																	>
																		<span className="text-[10px] text-ink3 font-mono">
																			{name}
																		</span>
																		<span
																			className={`text-[9px] px-1.5 py-0.5 rounded ${cb.state === "closed" ? "bg-green-400/10 text-green-400" : cb.state === "open" ? "bg-red-400/10 text-red-400" : "bg-amber-400/10 text-amber-400"}`}
																		>
																			{cb.state} ({cb.failures})
																		</span>
																	</div>
																),
															)}
														</div>
													</div>
												)}
												{health.cache && (
													<div className="p-2.5 rounded-xl border border-border/50">
														<div className="flex items-center gap-2 mb-1">
															<Database size={12} className="text-cyan-400" />
															<span className="text-[11px] font-medium text-ink">
																Cache
															</span>
														</div>
														<p className="text-[10px] text-ink3">
															Size: {health.cache.size} entries
														</p>
														{health.cache.hit_rate !== undefined && (
															<p className="text-[10px] text-ink3">
																Hit rate:{" "}
																{(health.cache.hit_rate * 100).toFixed(1)}%
															</p>
														)}
													</div>
												)}
											</div>
										)}
										{!health && !healthLoading && (
											<div className="text-center py-8">
												<HeartPulse
													size={24}
													className="mx-auto text-ink3/30 mb-2"
												/>
												<p className="text-[11px] text-ink3">
													Failed to load health data
												</p>
											</div>
										)}
									</div>
								)}

								{/* ── TOOLS TAB ─────────────────────────────── */}
								{sideTab === "tools" && (
									<div className="space-y-3">
										<div className="relative">
											<Search
												size={12}
												className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3"
											/>
											<input
												className="input !text-[11px] !pl-7 !py-1.5 !rounded-lg w-full"
												placeholder="Search tools..."
												value={toolFilter}
												onChange={(e) => setToolFilter(e.target.value)}
											/>
										</div>
										<div className="text-[10px] text-ink3 font-mono">
											{filteredTools.length} tools registered
										</div>
										<div className="space-y-1.5">
											{filteredTools.map((tool) => (
												<div
													key={tool.name}
													className="p-2 rounded-lg bg-surface2/50 border border-border/30 hover:border-accent/20 transition-colors"
												>
													<div className="flex items-center gap-2 mb-1">
														<span
															className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${toolCatColor[tool.category] || "text-ink3 bg-surface2"}`}
														>
															{tool.category}
														</span>
														<span className="text-[11px] font-mono text-ink truncate">
															{tool.name}
														</span>
													</div>
													<p className="text-[10px] text-ink3 line-clamp-2">
														{tool.description}
													</p>
													<div className="flex items-center gap-2 mt-1">
														<span className="text-[9px] text-ink3">
															{tool.permissions}
														</span>
														{tool.requiresApproval && (
															<span className="text-[9px] text-amber-400 bg-amber-400/10 px-1 rounded">
																approval
															</span>
														)}
													</div>
												</div>
											))}
										</div>
									</div>
								)}

								{/* ── AUDIT TAB ─────────────────────────────── */}
								{sideTab === "audit" && (
									<div className="space-y-3">
										<div className="relative">
											<Search
												size={12}
												className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3"
											/>
											<input
												className="input !text-[11px] !pl-7 !py-1.5 !rounded-lg w-full"
												placeholder="Search audit logs..."
												value={auditFilter}
												onChange={(e) => setAuditFilter(e.target.value)}
											/>
										</div>
										<div className="flex items-center justify-between">
											<span className="text-[10px] text-ink3 font-mono">
												{filteredAuditLogs.length} entries
											</span>
											<button
												onClick={loadAuditLogs}
												className="text-[10px] text-accent hover:underline flex items-center gap-1"
											>
												<RefreshCw size={10} /> Refresh
											</button>
										</div>
										<div className="space-y-1.5">
											{filteredAuditLogs.map((log) => (
												<div
													key={log.id}
													className="p-2 rounded-lg bg-surface2/50 border border-border/30"
												>
													<div className="flex items-center gap-2 mb-0.5">
														<span className="text-[10px] font-mono text-accent">
															{log.actor}
														</span>
														<span className="text-[9px] text-ink3">
															&middot;
														</span>
														<span className="text-[10px] text-ink2">
															{log.action}
														</span>
													</div>
													<p className="text-[9px] text-ink3 line-clamp-2">
														{log.detail}
													</p>
													<span className="text-[8px] text-ink3">
														{timeAgo(log.created_at)}
													</span>
												</div>
											))}
										</div>
									</div>
								)}

								{/* ── MEMORY TAB ────────────────────────────── */}
								{sideTab === "memory" && (
									<div className="space-y-3">
										<div className="relative">
											<Search
												size={12}
												className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3"
											/>
											<input
												className="input !text-[11px] !pl-7 !py-1.5 !rounded-lg w-full"
												placeholder="Search memory..."
												value={memorySearch}
												onChange={(e) => setMemorySearch(e.target.value)}
												onKeyDown={(e) => e.key === "Enter" && searchMemory()}
											/>
										</div>
										<div className="flex items-center justify-between">
											<span className="text-[10px] text-ink3 font-mono">
												{memorySearchResults.length > 0
													? `${memorySearchResults.length} results`
													: `${memories.length} memories`}
											</span>
											<button
												onClick={loadMemory}
												className="text-[10px] text-accent hover:underline flex items-center gap-1"
											>
												<RefreshCw size={10} /> Refresh
											</button>
										</div>
										<div className="space-y-1.5">
											{(memorySearchResults.length > 0
												? memorySearchResults
												: memories
											).map((mem) => (
												<div
													key={mem.id}
													className="p-2 rounded-lg bg-surface2/50 border border-border/30"
												>
													<div className="flex items-center gap-2 mb-1">
														<Brain size={10} className="text-purple-400" />
														<span className="text-[10px] font-mono text-ink2">
															{mem.agent_id}
														</span>
														<span className="text-[9px] text-ink3 px-1.5 py-0.5 rounded bg-purple-400/10 text-purple-400">
															{mem.memory_type}
														</span>
													</div>
													<pre className="text-[9px] text-ink3 max-h-16 overflow-y-auto bg-surface rounded p-1.5">
														{typeof mem.content === "string"
															? mem.content
															: JSON.stringify(mem.content, null, 2)}
													</pre>
													<span className="text-[8px] text-ink3">
														{timeAgo(mem.created_at)}
													</span>
												</div>
											))}
										</div>
									</div>
								)}

								{/* ── KB / RAG TAB ──────────────────────────── */}
								{sideTab === "kb" && (
									<div className="space-y-3">
										<div className="flex gap-2">
											<input
												className="input !text-[11px] !py-1.5 !rounded-lg flex-1"
												placeholder="Search knowledge base..."
												value={ragQuery}
												onChange={(e) => setRagQuery(e.target.value)}
												onKeyDown={(e) => e.key === "Enter" && searchRAG()}
											/>
											<button
												onClick={searchRAG}
												disabled={ragLoading || !ragQuery.trim()}
												className="btn btn-primary !text-[10px] !py-1.5 !px-3"
											>
												{ragLoading ? (
													<Loader2 size={11} className="animate-spin" />
												) : (
													<Search size={11} />
												)}
											</button>
										</div>
										{ragResults.length > 0 && (
											<div>
												<span className="text-[10px] text-ink3 font-mono">
													{ragResults.length} results
												</span>
												<div className="space-y-1.5 mt-2">
													{ragResults.map((r, i) => (
														<div
															key={i}
															className="p-2 rounded-lg bg-surface2/50 border border-border/30"
														>
															<div className="flex items-center gap-2 mb-1">
																<FileText size={10} className="text-blue-400" />
																<span className="text-[10px] font-mono text-ink2 truncate">
																	{String(r.title || r.id || `Result ${i + 1}`)}
																</span>
																{r.score != null && (
																	<span className="text-[9px] text-accent ml-auto">
																		{(Number(r.score) * 100).toFixed(0)}%
																	</span>
																)}
															</div>
															<p className="text-[9px] text-ink3 line-clamp-3">
																{String(r.content || r.text || r.description)}
															</p>
														</div>
													))}
												</div>
											</div>
										)}
										{ragResults.length === 0 && !ragLoading && (
											<div className="text-center py-8">
												<Database
													size={24}
													className="mx-auto text-ink3/30 mb-2"
												/>
												<p className="text-[11px] text-ink3">
													Search the knowledge base
												</p>
											</div>
										)}
									</div>
								)}

								{/* ── REPORTS TAB ───────────────────────────── */}
								{sideTab === "reports" && (
									<div className="space-y-3">
										<div className="flex items-center justify-between">
											<h3 className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
												Agent Reports
											</h3>
											<button
												onClick={loadReports}
												disabled={reportsLoading}
												className="text-[10px] text-accent hover:underline flex items-center gap-1"
											>
												{reportsLoading ? (
													<Loader2 size={10} className="animate-spin" />
												) : (
													<RefreshCw size={10} />
												)}{" "}
												Refresh
											</button>
										</div>
										{reportStats && (
											<div className="grid grid-cols-2 gap-2">
												<div className="p-2 rounded-lg bg-surface2/50 border border-border/30">
													<div className="text-[10px] text-ink3">
														24h Reports
													</div>
													<div className="text-sm font-bold text-ink">
														{reportStats.total_24h}
													</div>
												</div>
												<div className="p-2 rounded-lg bg-surface2/50 border border-border/30">
													<div className="text-[10px] text-ink3">Critical</div>
													<div
														className={`text-sm font-bold ${reportStats.critical > 0 ? "text-red-400" : "text-green-400"}`}
													>
														{reportStats.critical}
													</div>
												</div>
											</div>
										)}
										{supervisorAlerts && (
											<div
												className={`p-2.5 rounded-xl border ${
													(supervisorAlerts as Record<string, unknown>)
														.danger_level === "critical"
														? "border-red-400/30 bg-red-400/5"
														: (supervisorAlerts as Record<string, unknown>)
																	.danger_level === "elevated"
															? "border-amber-400/30 bg-amber-400/5"
															: "border-green-400/30 bg-green-400/5"
												}`}
											>
												<div className="flex items-center gap-2 mb-1">
													<Shield
														size={12}
														className={
															(supervisorAlerts as Record<string, unknown>)
																.danger_level === "critical"
																? "text-red-400"
																: (supervisorAlerts as Record<string, unknown>)
																			.danger_level === "elevated"
																	? "text-amber-400"
																	: "text-green-400"
														}
													/>
													<span className="text-[10px] font-bold text-ink">
														AI Supervisor
													</span>
												</div>
												<p className="text-[9px] text-ink3">
													Reviewed{" "}
													{String(
														(supervisorAlerts as Record<string, unknown>)
															.reports_reviewed || 0,
													)}{" "}
													reports
												</p>
											</div>
										)}
										<div className="space-y-1.5">
											{agentReports.map((report, i) => (
												<div
													key={i}
													className={`p-2 rounded-lg border ${
														report.severity === "critical"
															? "border-red-400/30 bg-red-400/5"
															: report.severity === "high"
																? "border-amber-400/30 bg-amber-400/5"
																: "border-border/30 bg-surface2/50"
													}`}
												>
													<div className="flex items-center gap-2 mb-1">
														<span
															className={`text-[8px] px-1.5 py-0.5 rounded font-mono ${
																report.severity === "critical"
																	? "bg-red-400/10 text-red-400"
																	: report.severity === "high"
																		? "bg-amber-400/10 text-amber-400"
																		: "bg-surface2 text-ink3"
															}`}
														>
															{String(report.severity || "info")}
														</span>
														<span className="text-[10px] font-mono text-ink truncate">
															{String(
																report.agent_name ||
																	report.agent_id ||
																	"unknown",
															)}
														</span>
													</div>
													<p className="text-[9px] text-ink2 line-clamp-2">
														{String(report.task_summary || "No summary")}
													</p>
												</div>
											))}
										</div>
										{agentReports.length === 0 && !reportsLoading && (
											<div className="text-center py-8">
												<FileText
													size={24}
													className="mx-auto text-ink3/30 mb-2"
												/>
												<p className="text-[11px] text-ink3">
													No agent reports yet
												</p>
											</div>
										)}
									</div>
								)}

								{/* ── LEARNING TAB ──────────────────────────── */}
								{sideTab === "learning" && (
									<div className="space-y-3">
										<div className="flex items-center justify-between">
											<h3 className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
												Learning Engine
											</h3>
											<button
												onClick={loadLearning}
												disabled={learningLoading}
												className="text-[10px] text-accent hover:underline flex items-center gap-1"
											>
												{learningLoading ? (
													<Loader2 size={10} className="animate-spin" />
												) : (
													<RefreshCw size={10} />
												)}{" "}
												Refresh
											</button>
										</div>
										{learningStats && (
											<div className="grid grid-cols-2 gap-2">
												<div className="p-2 rounded-lg bg-surface2/50 border border-border/30">
													<div className="text-[10px] text-ink3">
														Tasks (24h)
													</div>
													<div className="text-sm font-bold text-ink">
														{String(
															(
																learningStats.learning as Record<
																	string,
																	unknown
																>
															)?.total_24h ?? 0,
														)}
													</div>
												</div>
												<div className="p-2 rounded-lg bg-surface2/50 border border-border/30">
													<div className="text-[10px] text-ink3">
														Insights (7d)
													</div>
													<div className="text-sm font-bold text-accent">
														{String(
															(
																learningStats.insights as Record<
																	string,
																	unknown
																>
															)?.total_7d ?? 0,
														)}
													</div>
												</div>
											</div>
										)}
										{learningInsights.length > 0 && (
											<div className="space-y-1.5">
												<div className="text-[9px] font-mono text-ink3 uppercase">
													Recent Insights
												</div>
												{learningInsights.slice(0, 10).map((insight, i) => (
													<div
														key={i}
														className={`p-2 rounded-lg border ${
															insight.priority === "high"
																? "border-amber-400/30 bg-amber-400/5"
																: insight.applied
																	? "border-green-400/30 bg-green-400/5"
																	: "border-border/30 bg-surface2/50"
														}`}
													>
														<div className="flex items-center gap-2 mb-0.5">
															<span
																className={`text-[8px] px-1.5 py-0.5 rounded font-mono ${
																	insight.priority === "high"
																		? "bg-amber-400/10 text-amber-400"
																		: "bg-surface2 text-ink3"
																}`}
															>
																{String(insight.priority || "low")}
															</span>
															<span
																className={`text-[8px] ml-auto ${insight.applied ? "text-green-400" : "text-ink3"}`}
															>
																{insight.applied ? "applied" : "pending"}
															</span>
														</div>
														<p className="text-[9px] text-ink2 line-clamp-2">
															{String(insight.description || "")}
														</p>
													</div>
												))}
											</div>
										)}
										{learningRecords.length > 0 && (
											<div className="space-y-1.5">
												<div className="text-[9px] font-mono text-ink3 uppercase">
													Task Outcomes
												</div>
												{learningRecords.slice(0, 15).map((record, i) => (
													<div
														key={i}
														className="flex items-center gap-2 p-1.5 rounded bg-surface2/30 border border-border/20"
													>
														<span
															className={`w-1.5 h-1.5 rounded-full ${
																record.outcome === "success"
																	? "bg-green-400"
																	: record.outcome === "failure"
																		? "bg-red-400"
																		: "bg-amber-400"
															}`}
														/>
														<span className="text-[9px] font-mono text-ink truncate">
															{String(record.agent_id || "unknown")}
														</span>
														<span
															className={`text-[8px] ml-auto ${
																record.outcome === "success"
																	? "text-green-400"
																	: record.outcome === "failure"
																		? "text-red-400"
																		: "text-amber-400"
															}`}
														>
															{String(record.outcome || "")}
														</span>
													</div>
												))}
											</div>
										)}
										{learningStats === null && !learningLoading && (
											<div className="text-center py-8">
												<Sparkles
													size={24}
													className="mx-auto text-ink3/30 mb-2"
												/>
												<p className="text-[11px] text-ink3">
													Click Refresh to load learning data
												</p>
											</div>
										)}
									</div>
								)}
							</div>
						</>
					)}
				</div>
			</div>

			{/* ── Critical suggestion confirmation modal ──────────────── */}
			{confirming && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-md p-5">
						<h3 className="font-display font-bold text-sm mb-3 flex items-center gap-2">
							<AlertTriangle size={16} className="text-amber-400" /> Critical
							suggestion — confirm
						</h3>
						<p className="text-sm text-ink2 leading-relaxed mb-3">
							{confirming.reasoning}
						</p>
						{confirming.kind === "reply" && (
							<>
								<label className="text-xs font-semibold text-ink2 block mb-1.5">
									Edit reply before applying
								</label>
								{/* autoFocus + select-all: the cursor must land in the box the moment the modal opens */}
								<textarea
									className="input min-h-20 text-sm mb-3"
									value={editText}
									onChange={(e) => setEditText(e.target.value)}
									maxLength={1000}
									autoFocus
									onFocus={(e) => e.currentTarget.select()}
								/>
							</>
						)}
						<div
							className="rounded-xl p-3 text-xs mb-4"
							style={{
								background: "rgba(220,75,75,0.08)",
								border: "1px solid rgba(220,75,75,0.25)",
								color: "var(--vb-bad)",
							}}
						>
							This is flagged as a critical / safety-related change. Confirming
							will apply it immediately and record it in the audit log.
						</div>
						<div className="flex gap-2 justify-end">
							<button
								className="btn btn-ghost"
								onClick={() => setConfirming(null)}
							>
								Cancel
							</button>
							<button
								className="btn"
								style={{ background: "var(--vb-bad)", color: "#fff" }}
								onClick={() => approveSuggestion(confirming, true, editText)}
							>
								<Check size={14} /> Confirm & apply
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ── Conversation history modal ──────────────────────────── */}
			{showHistory && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border">
							<h3 className="font-display font-bold text-sm flex items-center gap-2">
								<History size={15} className="text-accent" /> Conversation
								History
							</h3>
							<button
								onClick={() => setShowHistory(false)}
								className="p-1.5 rounded-lg hover:bg-surface2"
							>
								<X size={14} />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-3 space-y-2">
							{sessions.length === 0 && (
								<div className="text-center py-8 text-[11px] text-ink3">
									No previous sessions
								</div>
							)}
							{sessions.map((s) => (
								<div
									key={String(s.session_id)}
									className="text-xs text-ink2 py-1.5 border-b border-border/30 last:border-0 flex items-center justify-between"
								>
									<span className="font-mono text-ink3">
										{String(s.session_id).slice(0, 24)}...
									</span>
									<span className="text-ink3/60">
										{new Date(String(s.last_message)).toLocaleString()}
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
