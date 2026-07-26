// ─── Admin AI — Central Intelligence Workspace ───────────────────
// Dedicated page for Voice Box administrators to:
// • Talk with the Voice Box AI (SSE streaming via /api/v3/stream)
// • Watch agents execute work live
// • See execution timelines and tool calls
// • View verification results and evidence
// • Approve/reject sensitive actions
// • Monitor system health
// • Search memory and knowledge base
// • Review audit logs
// • Manage AI tools and agents
// • Continue previous conversations
//
// NOT a separate product. NOT a ChatGPT clone.
// The intelligence layer of Voice Box Admin.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Brain, Send, Loader2, Sparkles, ChevronDown, ChevronUp,
  Activity, Shield, CheckCircle, AlertTriangle, Clock,
  Search, RefreshCw, X, Copy, Check, Wrench,
  Database, FileText, HeartPulse, ClipboardList,
  Bot, History,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { fmtDate, timeAgo } from '../../lib/utils';

/* ─── Types ──────────────────────────────────────────────────── */
interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  agent?: string;
  toolCalls?: ToolCallEvent[];
  timestamp: number;
}

interface ToolCallEvent {
  tool: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown> | string;
  status: 'executing' | 'result' | 'error';
  timestamp: number;
}

interface AgentRoute {
  agentId: string;
  agentRole?: string;
  icon?: string;
  confidence?: number;
  timestamp: number;
}

interface ExecutionEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
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

/* ─── Constants ──────────────────────────────────────────────── */
const SESSION_KEY = 'vb:admin-ai-session';
const MAX_TOKEN_LENGTH = 4000;

/** Read admin token from sessionStorage (same key as api.ts) */
function getAdminToken(): string | null {
  try {
    const raw = sessionStorage.getItem('vb:adminAuth');
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw);
    if (exp && exp < Date.now()) { sessionStorage.removeItem('vb:adminAuth'); return null; }
    return token;
  } catch { return null; }
}

/* ─── Simple markdown renderer ─────────────────────────────── */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(text: string): string {
  let html = escapeHtml(text)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^>\s*(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m: string, label: string, href: string) => {
      const safeHref = href.replace(/^\s*javascript\s*:/i, '#');
      return `<a href="${safeHref}" target="_blank" rel="noopener" class="text-accent underline">${label}</a>`;
    })
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');
  if (!html.startsWith('<pre>') && !html.startsWith('<ul>') && !html.startsWith('<blockquote>')) {
    html = `<p>${html}</p>`;
  }
  return html;
}

/* ─── Strip tool call JSON from displayed text ─────────────── */
function stripToolCallJson(text: string): string {
  let cleaned = text.trim();
  // Strip array tool calls: [{"name":"...", "arguments":{...}}]
  cleaned = cleaned.replace(/^\s*\[\s*\{\s*"name"\s*:.*\}\s*\]\s*$/s, '');
  // Strip single object tool calls: {"name":"...", "arguments":{...}}
  cleaned = cleaned.replace(/^\s*\{\s*"name"\s*:.*"arguments"\s*:.*\}\s*$/s, '');
  // Strip legacy format: {"tool":"...", "input":{...}}
  cleaned = cleaned.replace(/^\s*\{\s*"tool"\s*:.*"input"\s*:.*\}\s*$/s, '');
  // Strip tool calls embedded after text
  cleaned = cleaned.replace(/\n*\s*\[\s*\{\s*"name"\s*:.*\}\s*\]\s*$/s, '');
  cleaned = cleaned.replace(/\n*\s*\{\s*"tool"\s*:.*"input"\s*:.*\}\s*$/s, '');
  return cleaned.trim();
}

/* ─── Thinking Animation — Claude-style pulsing dots ─────────── */
function ThinkingAnimation({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="thinking-animation">
      {/* Ambient glow */}
      <circle className="thinking-glow" cx="20" cy="20" r="16" fill="var(--vb-accent, oklch(84% 0.19 80.46))" />
      {/* Three pulsing dots */}
      <circle className="thinking-dot-1" cx="12" cy="20" r="3" fill="var(--vb-accent, oklch(84% 0.19 80.46))" />
      <circle className="thinking-dot-2" cx="20" cy="20" r="3" fill="var(--vb-accent, oklch(84% 0.19 80.46))" />
      <circle className="thinking-dot-3" cx="28" cy="20" r="3" fill="var(--vb-accent, oklch(84% 0.19 80.46))" />
    </svg>
  );
}

/* ─── Copy button ─────────────────────────────────────────────── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };
  return (
    <button onClick={copy} className="p-1 rounded-md hover:bg-surface2 transition-colors" title="Copy">
      {copied ? <Check size={12} className="text-good" /> : <Copy size={12} className="text-ink3" />}
    </button>
  );
}

/* ─── Tab type ────────────────────────────────────────────────── */
type SideTab = 'chat' | 'agents' | 'tools' | 'health' | 'audit' | 'memory' | 'rag' | 'reports';

/* ═══════════════════════════════════════════════════════════════
   MAIN — Admin AI Central Intelligence Workspace
   ═══════════════════════════════════════════════════════════════ */
export default function AdminAI() {
  const { toast } = useApp();

  // ── Chat state ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [sessionId] = useState(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const id = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  });

  // ── Side panel state ──
  const [sideTab, setSideTab] = useState<SideTab>('agents');
  const [sideCollapsed, setSideCollapsed] = useState(false);

  // ── Agent tracking ──
  const [agentRoute, setAgentRoute] = useState<AgentRoute | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolCallEvent[]>([]);
  const [execEvents, setExecEvents] = useState<ExecutionEvent[]>([]);

  // ── Tools ──
  const [tools, setTools] = useState<ToolSchema[]>([]);
  const [_toolsLoading, setToolsLoading] = useState(false);
  const [toolFilter, setToolFilter] = useState('');

  // ── Health ──
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // ── Audit ──
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilter, setAuditFilter] = useState('');

  // ── Memory ──
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySearch, setMemorySearch] = useState('');
  const [memorySearchResults, setMemorySearchResults] = useState<MemoryEntry[]>([]);

  // ── RAG ──
  const [ragQuery, setRagQuery] = useState('');
  const [ragResults, setRagResults] = useState<Record<string, unknown>[]>([]);
  const [ragLoading, setRagLoading] = useState(false);

  // ── Agent Reports ──
  const [agentReports, setAgentReports] = useState<Record<string, unknown>[]>([]);
  const [reportStats, setReportStats] = useState<{ total_24h: number; by_severity: Record<string, number>; by_division: Record<string, number>; critical: number; high: number } | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [supervisorAlerts, setSupervisorAlerts] = useState<Record<string, unknown> | null>(null);
  const [supervisorLoading, setSupervisorLoading] = useState(false);
  const [reportFilter, setReportFilter] = useState('');
  const [reportSeverityFilter, setReportSeverityFilter] = useState('');

  // ── Conversation history ──
  const [conversations, setConversations] = useState<{ id: string; title?: string; agent_id?: string; created_at: string; session_id?: string; updated_at?: string; last_message?: string; message_count?: number }[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // ── Refs ──
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ─── Auto-scroll chat ──────────────────────────────────── */
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages.length, streaming]);

  /* ─── Load data on mount ──────────────────────────────────── */
  useEffect(() => {
    loadTools();
    loadHealth();
    loadAuditLogs();
    loadMemory();
    loadConversations();
  }, []);

  /* ─── Data loaders ─────────────────────────────────────────── */
  const loadTools = async () => {
    setToolsLoading(true);
    try {
      const data = await api.get<{ tools: ToolSchema[] }>('/api/v3/tools?action=list');
      setTools(data.tools || []);
    } catch (e: unknown) { console.warn('[AdminAI] Failed to load tools:', e instanceof Error ? e.message : e); }
    setToolsLoading(false);
  };

  const loadHealth = async () => {
    setHealthLoading(true);
    try {
      const token = getAdminToken();
      const headers: Record<string, string> = {};
      if (token) headers['x-admin-token'] = token;
      const res = await fetch('/api/v3/monitoring?action=health', { headers });
      if (res.ok) setHealth(await res.json());
    } catch (e: unknown) { console.warn('[AdminAI] Failed to load health:', e instanceof Error ? e.message : e); }
    setHealthLoading(false);
  };

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const data = await api.get<{ logs: AuditEntry[] }>('/api/v3/audit?action=recent&limit=50');
      setAuditLogs(data.logs || []);
    } catch (e: unknown) { console.warn('[AdminAI] Failed to load audit logs:', e instanceof Error ? e.message : e); }
    setAuditLoading(false);
  };

  const loadMemory = async () => {
    setMemoryLoading(true);
    try {
      const data = await api.get<{ memories: MemoryEntry[] }>('/api/v3/memory?action=list&limit=50');
      setMemories(data.memories || []);
    } catch (e: unknown) { console.warn('[AdminAI] Failed to load memory:', e instanceof Error ? e.message : e); }
    setMemoryLoading(false);
  };

  /* ─── Agent Reports ───────────────────────────────────────── */
  const loadReports = async () => {
    setReportsLoading(true);
    try {
      const data = await api.get<{ reports: Record<string, unknown>[]; stats: { total_24h: number; by_severity: Record<string, number>; by_division: Record<string, number>; critical: number; high: number } }>(
        `/api/agent-team?action=reports&limit=50${reportSeverityFilter ? `&severity=${reportSeverityFilter}` : ''}`
      );
      setAgentReports(data.reports || []);
      setReportStats(data.stats || null);
    } catch (e: unknown) { console.warn('[AdminAI] Failed to load reports:', e instanceof Error ? e.message : e); }
    setReportsLoading(false);
  };

  const loadSupervisorAlerts = async () => {
    setSupervisorLoading(true);
    try {
      const data = await api.get<Record<string, unknown>>('/api/agent-team?action=supervisor');
      setSupervisorAlerts(data);
    } catch (e: unknown) { console.warn('[AdminAI] Failed to load supervisor alerts:', e instanceof Error ? e.message : e); }
    setSupervisorLoading(false);
  };

  const loadConversations = async () => {
    setConversationsLoading(true);
    try {
      const data = await api.get<{ conversations: { id: string; title?: string; agent_id?: string; created_at: string }[] }>('/api/v3/stream?action=conversations&limit=20');
      setConversations(data.conversations || []);
    } catch (e: unknown) { console.warn('[AdminAI] Failed to load conversations:', e instanceof Error ? e.message : e); }
    setConversationsLoading(false);
  };

  /* ─── Memory search ────────────────────────────────────────── */
  const searchMemory = async () => {
    if (!memorySearch.trim()) return;
    setMemoryLoading(true);
    try {
      const data = await api.get<{ memories: MemoryEntry[] }>(
        `/api/v3/memory?action=search&q=${encodeURIComponent(memorySearch)}`
      );
      setMemorySearchResults(data.memories || []);
    } catch (e: unknown) { console.warn('[AdminAI] Failed to search memory:', e instanceof Error ? e.message : e); }
    setMemoryLoading(false);
  };

  /* ─── RAG search ──────────────────────────────────────────── */
  const searchRAG = async () => {
    if (!ragQuery.trim()) return;
    setRagLoading(true);
    try {
      const data = await api.post<{ results: Record<string, unknown>[] }>('/api/v3/rag', {
        query: ragQuery,
        limit: 10,
      });
      setRagResults(data.results || []);
    } catch (e: unknown) { console.warn('[AdminAI] Failed to search RAG:', e instanceof Error ? e.message : e); }
    setRagLoading(false);
  };

  /* ─── Send chat message ────────────────────────────────────── */
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setStreaming(true);
    setToolEvents([]);
    setAgentRoute(null);
    setExecEvents([]);

    if (inputRef.current) inputRef.current.style.height = 'auto';

    try {
      abortRef.current = new AbortController();
      const token = getAdminToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['x-admin-token'] = token;

      const response = await fetch('/api/v3/stream', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [...messages.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: text }],
          session_id: sessionId,
          stream: true,
          is_admin: true,
          page_context: { page: 'admin-ai' },
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error(`Stream failed: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';
      let currentAgent = '';
      let suppressDisplay = false; // suppress when LLM outputs tool call JSON
      const currentToolCalls: ToolCallEvent[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;

          try {
            const event = JSON.parse(data);
            switch (event.type) {
              case 'token':
                if (event.text || event.token) {
                  assistantContent += event.text || event.token;
                  // Detect if accumulated text is becoming tool call JSON — suppress display
                  const trimmed = assistantContent.trim();
                  if (!suppressDisplay && (
                    trimmed.startsWith('[{') || trimmed.startsWith('{"tool"') || trimmed.startsWith('{"name"')
                  )) {
                    suppressDisplay = true;
                  }
                  // If suppressed and we got a tool_event, the tool executed — stop suppressing after a beat
                  if (!suppressDisplay) {
                    setMessages((prev) => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1];
                      if (last && last.role === 'assistant') {
                        last.content = assistantContent;
                      } else {
                        updated.push({ role: 'assistant', content: assistantContent, timestamp: Date.now() });
                      }
                      return updated;
                    });
                  }
                }
                break;
              case 'agent_routed':
                if (event.agent) {
                  currentAgent = event.agent;
                  setAgentRoute({ agentId: event.agent, icon: event.icon, confidence: event.confidence, timestamp: Date.now() });
                  setExecEvents((prev) => [...prev, { type: 'agent_routed', data: event, timestamp: Date.now() }]);
                }
                break;
              case 'tool_event':
                if (event.tool) {
                  const te: ToolCallEvent = { tool: event.tool, input: event.input, result: event.result, status: (event.status || event.event || 'executing') as ToolCallEvent['status'], timestamp: Date.now() };
                  currentToolCalls.push(te);
                  setToolEvents([...currentToolCalls]);
                  setExecEvents((prev) => [...prev, { type: 'tool_event', data: event, timestamp: Date.now() }]);
                }
                // Tool executed — clear suppress flag so natural language response shows
                // Server sends "event" field, frontend also checks "status" for compatibility
                {
                  const toolStatus = event.status || event.event;
                  if (toolStatus === 'result' || toolStatus === 'error') {
                    suppressDisplay = false;
                    assistantContent = ''; // reset — LLM will respond with natural language after tool result
                  }
                }
                break;
              case 'rag_context':
                setExecEvents((prev) => [...prev, { type: 'rag', data: event, timestamp: Date.now() }]);
                break;
              case 'security_injection_detected':
                setExecEvents((prev) => [...prev, { type: 'security', data: event, timestamp: Date.now() }]);
                break;
              case 'stream_done':
                if (event.text && !suppressDisplay) {
                  assistantContent = event.text;
                }
                break;
              case 'response_complete':
                setExecEvents((prev) => [...prev, { type: 'complete', data: event, timestamp: Date.now() }]);
                break;
              case 'done':
                if (event.text && !suppressDisplay) {
                  assistantContent = event.text || assistantContent;
                }
                break;
              case 'error':
                toast(event.error || event.message || 'Stream error', 'err');
                break;
              case 'stream_error':
                toast(event.error || event.message || 'Stream error', 'err');
                break;
            }
          } catch { /* skip malformed */ }
        }
      }

      // Finalize — strip any raw tool call JSON from displayed text
      const displayContent = stripToolCallJson(assistantContent);
      if (assistantContent) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            last.content = displayContent || assistantContent;
            last.agent = currentAgent;
            last.toolCalls = currentToolCalls;
          } else {
            updated.push({ role: 'assistant', content: displayContent || assistantContent, agent: currentAgent, toolCalls: currentToolCalls, timestamp: Date.now() });
          }
          return updated;
        });
      } else {
        // Fallback non-streaming
        const fallback = await api.post<{ reply: string; agent?: string }>('/api/v3/stream', {
          messages: [...messages.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: text }],
          session_id: sessionId, stream: false, is_admin: true, page_context: { page: 'admin-ai' },
        });
        if (fallback.reply) {
          setMessages((prev) => [...prev, { role: 'assistant', content: fallback.reply, agent: fallback.agent, timestamp: Date.now() }]);
          if (fallback.agent) setAgentRoute({ agentId: fallback.agent, timestamp: Date.now() });
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') { /* cancelled */ }
      else toast(err instanceof Error ? err.message : 'Failed to send', 'err');
    } finally {
      setSending(false);
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, sending, messages, sessionId, toast]);

  /* ─── Keyboard shortcut ────────────────────────────────────── */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  /* ─── Auto-resize textarea ─────────────────────────────────── */
  const onInputChange = (val: string) => {
    setInput(val);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px';
    }
  };

  /* ─── Load conversation from history ───────────────────────── */
  const loadConversation = async (convId: string) => {
    try {
      const data = await api.get<{ messages: { role: string; content: string; agent_id?: string; created_at: string }[] }>(`/api/v3/stream?action=history&session_id=${convId}`);
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages.map((m) => ({
          role: m.role as ChatMessage['role'], content: m.content, agent: m.agent_id, timestamp: new Date(m.created_at).getTime(),
        })));
        setShowHistory(false);
        toast('Conversation loaded', 'ok');
      }
    } catch (e: unknown) { console.warn('[AdminAI] Failed to load conversation:', e instanceof Error ? e.message : e); }
  };

  /* ─── New conversation ─────────────────────────────────────── */
  const newConversation = () => {
    const id = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(SESSION_KEY, id);
    setMessages([]);
    setToolEvents([]);
    setAgentRoute(null);
    setExecEvents([]);
    setShowHistory(false);
  };

  /* ─── Stop streaming ───────────────────────────────────────── */
  const stopStreaming = () => {
    if (abortRef.current) { abortRef.current.abort(); setSending(false); setStreaming(false); }
  };

  /* ─── Filtered tools ───────────────────────────────────────── */
  const filteredTools = useMemo(() => {
    if (!toolFilter) return tools;
    const q = toolFilter.toLowerCase();
    return tools.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  }, [tools, toolFilter]);

  /* ─── Filtered audit logs ──────────────────────────────────── */
  const filteredAuditLogs = useMemo(() => {
    if (!auditFilter) return auditLogs;
    const q = auditFilter.toLowerCase();
    return auditLogs.filter((l) => l.actor.toLowerCase().includes(q) || l.action.toLowerCase().includes(q) || l.detail.toLowerCase().includes(q));
  }, [auditLogs, auditFilter]);

  /* ─── Tool category colors ─────────────────────────────────── */
  const toolCatColor: Record<string, string> = {
    read: 'text-blue-400 bg-blue-400/10',
    create: 'text-green-400 bg-green-400/10',
    update: 'text-amber-400 bg-amber-400/10',
    delete: 'text-red-400 bg-red-400/10',
    search: 'text-purple-400 bg-purple-400/10',
    system: 'text-cyan-400 bg-cyan-400/10',
  };

  /* ─── Quick actions ────────────────────────────────────────── */
  const QUICK_ACTIONS = [
    { label: 'Show system status', icon: HeartPulse, prompt: 'Show me the current system health and status' },
    { label: 'List all tools', icon: Wrench, prompt: 'List all available AI tools and their capabilities' },
    { label: 'Recent activity', icon: Clock, prompt: 'Show me the recent admin activity logs' },
    { label: 'Search knowledge base', icon: Database, prompt: 'Search the knowledge base for common issues' },
    { label: 'Memory overview', icon: Brain, prompt: 'Show me what the AI system remembers' },
    { label: 'Agent performance', icon: Bot, prompt: 'Show me agent execution statistics and performance' },
  ];

  /* ─── Render ────────────────────────────────────────────────── */
  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
            <Brain size={18} className="text-accent" />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg flex items-center gap-2">
              Admin AI
              <span className="text-[10px] font-mono text-ink3 bg-surface2 px-2 py-0.5 rounded-full">INTELLIGENCE CENTER</span>
            </h1>
            <p className="text-[11px] text-ink3">Talk with AI &middot; Watch agents &middot; Monitor systems &middot; Search knowledge</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHistory(true)} className="btn btn-ghost !text-xs !py-1.5" title="Conversation history">
            <History size={13} />
          </button>
          <button onClick={loadTools} className="btn btn-ghost !text-xs !py-1.5" title="Refresh tools">
            <RefreshCw size={13} />
          </button>
          <button onClick={newConversation} className="btn btn-primary !text-xs !py-1.5">
            <Sparkles size={13} /> New chat
          </button>
        </div>
      </div>

      {/* ── Main layout: Chat + Side panel ───────────────────── */}
      <div className="flex-1 flex gap-0 rounded-2xl border border-border overflow-hidden bg-surface min-h-0">
        {/* ── LEFT: Chat Area ─────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat messages */}
          <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-6 max-w-md mx-auto">
                <div className="w-20 h-20 rounded-3xl bg-accent/10 flex items-center justify-center">
                  <Brain size={36} className="text-accent" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-xl mb-2">Voice Box Admin AI</h2>
                  <p className="text-sm text-ink3 leading-relaxed">
                    Your intelligent control center. Ask anything about your system,
                    agents, tools, users, or issues. Watch agents work in real-time.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full">
                  {QUICK_ACTIONS.map((qa) => (
                    <button
                      key={qa.label}
                      onClick={() => { setInput(qa.prompt); inputRef.current?.focus(); }}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border hover:border-accent/30 hover:bg-accent/5 text-left transition-all group"
                    >
                      <qa.icon size={14} className="text-accent/60 group-hover:text-accent transition-colors" />
                      <span className="text-xs text-ink2 group-hover:text-ink">{qa.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} chat-msg-anim px-2`}>
                <div className={`flex ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-end gap-2.5 max-w-[85%]`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0 mb-5">
                      <Sparkles size={14} className="text-accent" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {msg.agent && msg.role === 'assistant' && (
                      <div className="flex items-center gap-1.5">
                        <Bot size={11} className="text-accent" />
                        <span className="text-[10px] font-mono text-accent">{msg.agent}</span>
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <span className="text-[9px] text-ink3 bg-surface2 px-1.5 py-0.5 rounded">
                            {msg.toolCalls.length} tool{msg.toolCalls.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                    <div
                      className={`chat-msg rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-accent text-white rounded-br-md'
                          : 'bg-surface2 text-ink rounded-bl-md border border-border/50'
                      }`}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="space-y-1 mt-1">
                        {msg.toolCalls.map((tc, j) => (
                          <div key={j} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-surface2/50 border border-border/30">
                            <Wrench size={10} className={tc.status === 'error' ? 'text-red-400' : 'text-accent'} />
                            <span className="text-[10px] font-mono text-ink2">{tc.tool}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                              tc.status === 'result' ? 'bg-green-400/10 text-green-400' :
                              tc.status === 'error' ? 'bg-red-400/10 text-red-400' :
                              'bg-amber-400/10 text-amber-400'
                            }`}>{tc.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={`flex items-center gap-1.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <span className="text-[9px] text-ink3 opacity-0 group-hover:opacity-100 transition-opacity">
                        {fmtDate(new Date(msg.timestamp).toISOString())}
                      </span>
                      <CopyButton text={msg.content} />
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex items-center gap-2 px-4 text-ink3">
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                  <ThinkingAnimation size={28} />
                </div>
                <div className="flex items-center gap-1.5 bg-surface2 rounded-2xl rounded-bl-md px-4 py-2.5">
                  <span className="text-[11px] text-ink3 italic">Thinking...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="border-t border-border bg-surface px-4 py-3 flex-shrink-0">
            <div className="chat-input-wrap flex items-end gap-2 bg-surface2 rounded-2xl border border-border px-3 py-2">
              <textarea
                ref={inputRef}
                className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-ink placeholder:text-ink3 max-h-40"
                placeholder="Ask the AI anything... (Shift+Enter for new line)"
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                maxLength={MAX_TOKEN_LENGTH}
              />
              {sending ? (
                <button onClick={stopStreaming} className="w-9 h-9 rounded-xl bg-red-500 text-white flex items-center justify-center flex-shrink-0 transition-all hover:bg-red-600" title="Stop">
                  <X size={15} />
                </button>
              ) : (
                <button className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center flex-shrink-0 transition-all hover:bg-accent2 disabled:opacity-30 disabled:cursor-not-allowed" onClick={sendMessage} disabled={!input.trim() || sending}>
                  <Send size={15} />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1">
              <span className="text-[9px] text-ink3">{input.length > 0 && `${input.length}/${MAX_TOKEN_LENGTH}`}</span>
              <span className="text-[9px] text-ink3 font-mono">Session: {sessionId.slice(0, 16)}...</span>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Side Panel ──────────────────────────── */}
        <div className={`${sideCollapsed ? 'w-12' : 'w-80'} flex-shrink-0 border-l border-border flex flex-col bg-surface transition-all relative`}>
          <button onClick={() => setSideCollapsed(!sideCollapsed)} className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-surface border border-border hover:bg-surface2 transition-colors" title={sideCollapsed ? 'Expand' : 'Collapse'}>
            {sideCollapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {!sideCollapsed && (
            <>
              <div className="flex border-b border-border overflow-x-auto scrollbar-none">
                {([
                  { key: 'agents' as SideTab, label: 'Agents', icon: Bot },
                  { key: 'tools' as SideTab, label: 'Tools', icon: Wrench },
                  { key: 'health' as SideTab, label: 'Health', icon: HeartPulse },
                  { key: 'audit' as SideTab, label: 'Audit', icon: ClipboardList },
                  { key: 'memory' as SideTab, label: 'Memory', icon: Brain },
                  { key: 'rag' as SideTab, label: 'KB', icon: Database },
                  { key: 'reports' as SideTab, label: 'Reports', icon: FileText },
                ]).map(({ key, label, icon: Icon }) => (
                  <button key={key} onClick={() => setSideTab(key)} className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${sideTab === key ? 'border-accent text-accent bg-accent/5' : 'border-transparent text-ink3 hover:text-ink2'}`}>
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {/* ── AGENTS TAB ────────────────────────────── */}
                {sideTab === 'agents' && (
                  <div className="space-y-3">
                    {agentRoute && (
                      <div className="p-3 rounded-xl border border-accent/20 bg-accent/5">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center"><Bot size={14} className="text-accent" /></div>
                          <div>
                            <p className="text-xs font-bold text-ink">{agentRoute.agentId}</p>
                            <p className="text-[10px] text-ink3">Active agent</p>
                          </div>
                        </div>
                        {agentRoute.confidence !== undefined && (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-ink3">Confidence:</span>
                            <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden"><div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.min(100, agentRoute.confidence * 100)}%` }} /></div>
                            <span className="text-[10px] font-mono text-accent">{(agentRoute.confidence * 100).toFixed(0)}%</span>
                          </div>
                        )}
                      </div>
                    )}

                    {execEvents.length > 0 && (
                      <div>
                        <h3 className="text-[10px] font-mono text-ink3 uppercase tracking-wider mb-2">Execution Timeline</h3>
                        <div className="space-y-1.5">
                          {execEvents.map((ev, i) => (
                            <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-surface2/50 border border-border/30">
                              <div className="mt-0.5">
                                {ev.type === 'agent_routed' && <Bot size={10} className="text-accent" />}
                                {ev.type === 'tool_event' && <Wrench size={10} className="text-amber-400" />}
                                {ev.type === 'rag' && <Database size={10} className="text-blue-400" />}
                                {ev.type === 'security' && <Shield size={10} className="text-red-400" />}
                                {ev.type === 'complete' && <CheckCircle size={10} className="text-green-400" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-ink2 font-mono truncate">{ev.type}</p>
                                {ev.type === 'tool_event' && !!ev.data.tool && <p className="text-[9px] text-ink3">{String(ev.data.tool)} &middot; {String(ev.data.status)}</p>}
                                {ev.type === 'agent_routed' && !!ev.data.agent && <p className="text-[9px] text-ink3">&rarr; {String(ev.data.agent)}</p>}
                              </div>
                              <span className="text-[8px] text-ink3 whitespace-nowrap">{timeAgo(new Date(ev.timestamp).toISOString())}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {execEvents.length === 0 && !agentRoute && (
                      <div className="text-center py-8">
                        <Bot size={24} className="mx-auto text-ink3/30 mb-2" />
                        <p className="text-[11px] text-ink3">Send a message to see agent activity</p>
                      </div>
                    )}

                    {toolEvents.length > 0 && (
                      <div>
                        <h3 className="text-[10px] font-mono text-ink3 uppercase tracking-wider mb-2">Tool Calls</h3>
                        <div className="space-y-1">
                          {toolEvents.map((tc, i) => (
                            <div key={i} className="p-2 rounded-lg bg-surface2/50 border border-border/30">
                              <div className="flex items-center gap-2">
                                <Wrench size={10} className={tc.status === 'error' ? 'text-red-400' : tc.status === 'result' ? 'text-green-400' : 'text-amber-400'} />
                                <span className="text-[10px] font-mono text-ink2">{tc.tool}</span>
                                <span className={`text-[9px] px-1 py-0.5 rounded ml-auto ${tc.status === 'result' ? 'bg-green-400/10 text-green-400' : tc.status === 'error' ? 'bg-red-400/10 text-red-400' : 'bg-amber-400/10 text-amber-400'}`}>{tc.status}</span>
                              </div>
                              {tc.result && (
                                <pre className="text-[9px] text-ink3 mt-1 max-h-20 overflow-y-auto bg-surface rounded p-1.5">
                                  {JSON.stringify(tc.result, null, 2).slice(0, 300)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── TOOLS TAB ─────────────────────────────── */}
                {sideTab === 'tools' && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
                      <input className="input !text-[11px] !pl-7 !py-1.5 !rounded-lg w-full" placeholder="Search tools..." value={toolFilter} onChange={(e) => setToolFilter(e.target.value)} />
                    </div>
                    <div className="text-[10px] text-ink3 font-mono">{filteredTools.length} tools registered</div>
                    <div className="space-y-1.5">
                      {filteredTools.map((tool) => (
                        <div key={tool.name} className="p-2 rounded-lg bg-surface2/50 border border-border/30 hover:border-accent/20 transition-colors">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${toolCatColor[tool.category] || 'text-ink3 bg-surface2'}`}>{tool.category}</span>
                            <span className="text-[11px] font-mono text-ink truncate">{tool.name}</span>
                          </div>
                          <p className="text-[10px] text-ink3 line-clamp-2">{tool.description}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] text-ink3">{tool.permissions}</span>
                            {tool.requiresApproval && <span className="text-[9px] text-amber-400 bg-amber-400/10 px-1 rounded">approval</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── HEALTH TAB ────────────────────────────── */}
                {sideTab === 'health' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-mono text-ink3 uppercase tracking-wider">System Health</h3>
                      <button onClick={loadHealth} className="text-[10px] text-accent hover:underline flex items-center gap-1"><RefreshCw size={10} /> Refresh</button>
                    </div>
                    {healthLoading && <div className="text-[11px] text-ink3 py-4 text-center"><Loader2 size={14} className="animate-spin mx-auto" /></div>}
                    {health && (
                      <div className="space-y-2">
                        <div className={`p-3 rounded-xl border ${health.status === 'healthy' ? 'border-green-400/20 bg-green-400/5' : health.status === 'degraded' ? 'border-amber-400/20 bg-amber-400/5' : 'border-red-400/20 bg-red-400/5'}`}>
                          <div className="flex items-center gap-2">
                            {health.status === 'healthy' ? <CheckCircle size={14} className="text-green-400" /> : <AlertTriangle size={14} className={health.status === 'degraded' ? 'text-amber-400' : 'text-red-400'} />}
                            <span className="text-xs font-bold text-ink capitalize">{health.status}</span>
                          </div>
                          {health.uptime && <p className="text-[10px] text-ink3 mt-1">Uptime: {Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m</p>}
                        </div>
                        {health.database && (
                          <div className="p-2.5 rounded-xl border border-border/50">
                            <div className="flex items-center gap-2 mb-1">
                              <Database size={12} className="text-blue-400" />
                              <span className="text-[11px] font-medium text-ink">Database</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded ${health.database.status === 'ok' ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>{health.database.status}</span>
                            </div>
                            <p className="text-[10px] text-ink3">Latency: {health.database.latency_ms}ms</p>
                          </div>
                        )}
                        {health.circuit_breakers && (
                          <div className="p-2.5 rounded-xl border border-border/50">
                            <div className="flex items-center gap-2 mb-2"><Activity size={12} className="text-purple-400" /><span className="text-[11px] font-medium text-ink">Circuit Breakers</span></div>
                            <div className="space-y-1">
                              {Object.entries(health.circuit_breakers).map(([name, cb]) => (
                                <div key={name} className="flex items-center justify-between">
                                  <span className="text-[10px] text-ink3 font-mono">{name}</span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${cb.state === 'closed' ? 'bg-green-400/10 text-green-400' : cb.state === 'open' ? 'bg-red-400/10 text-red-400' : 'bg-amber-400/10 text-amber-400'}`}>{cb.state} ({cb.failures})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {health.cache && (
                          <div className="p-2.5 rounded-xl border border-border/50">
                            <div className="flex items-center gap-2 mb-1"><Database size={12} className="text-cyan-400" /><span className="text-[11px] font-medium text-ink">Cache</span></div>
                            <p className="text-[10px] text-ink3">Size: {health.cache.size} entries</p>
                            {health.cache.hit_rate !== undefined && <p className="text-[10px] text-ink3">Hit rate: {(health.cache.hit_rate * 100).toFixed(1)}%</p>}
                          </div>
                        )}
                      </div>
                    )}
                    {!health && !healthLoading && (
                      <div className="text-center py-8"><HeartPulse size={24} className="mx-auto text-ink3/30 mb-2" /><p className="text-[11px] text-ink3">Failed to load health data</p></div>
                    )}
                  </div>
                )}

                {/* ── AUDIT TAB ─────────────────────────────── */}
                {sideTab === 'audit' && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
                      <input className="input !text-[11px] !pl-7 !py-1.5 !rounded-lg w-full" placeholder="Search audit logs..." value={auditFilter} onChange={(e) => setAuditFilter(e.target.value)} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-ink3 font-mono">{filteredAuditLogs.length} entries</span>
                      <button onClick={loadAuditLogs} className="text-[10px] text-accent hover:underline flex items-center gap-1"><RefreshCw size={10} /> Refresh</button>
                    </div>
                    {auditLoading && <div className="text-[11px] text-ink3 py-4 text-center"><Loader2 size={14} className="animate-spin mx-auto" /></div>}
                    <div className="space-y-1.5">
                      {filteredAuditLogs.map((log) => (
                        <div key={log.id} className="p-2 rounded-lg bg-surface2/50 border border-border/30">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] font-mono text-accent">{log.actor}</span>
                            <span className="text-[9px] text-ink3">&middot;</span>
                            <span className="text-[10px] text-ink2">{log.action}</span>
                          </div>
                          <p className="text-[9px] text-ink3 line-clamp-2">{log.detail}</p>
                          <span className="text-[8px] text-ink3">{timeAgo(log.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── MEMORY TAB ────────────────────────────── */}
                {sideTab === 'memory' && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
                      <input className="input !text-[11px] !pl-7 !py-1.5 !rounded-lg w-full" placeholder="Search memory..." value={memorySearch} onChange={(e) => setMemorySearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchMemory()} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-ink3 font-mono">{memorySearchResults.length > 0 ? `${memorySearchResults.length} results` : `${memories.length} memories`}</span>
                      <button onClick={loadMemory} className="text-[10px] text-accent hover:underline flex items-center gap-1"><RefreshCw size={10} /> Refresh</button>
                    </div>
                    {memoryLoading && <div className="text-[11px] text-ink3 py-4 text-center"><Loader2 size={14} className="animate-spin mx-auto" /></div>}
                    <div className="space-y-1.5">
                      {(memorySearchResults.length > 0 ? memorySearchResults : memories).map((mem) => (
                        <div key={mem.id} className="p-2 rounded-lg bg-surface2/50 border border-border/30">
                          <div className="flex items-center gap-2 mb-1">
                            <Brain size={10} className="text-purple-400" />
                            <span className="text-[10px] font-mono text-ink2">{mem.agent_id}</span>
                            <span className="text-[9px] text-ink3 px-1.5 py-0.5 rounded bg-purple-400/10 text-purple-400">{mem.memory_type}</span>
                          </div>
                          <pre className="text-[9px] text-ink3 max-h-16 overflow-y-auto bg-surface rounded p-1.5">{typeof mem.content === 'string' ? mem.content : JSON.stringify(mem.content, null, 2)}</pre>
                          <span className="text-[8px] text-ink3">{timeAgo(mem.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── RAG / KB TAB ──────────────────────────── */}
                {sideTab === 'rag' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input className="input !text-[11px] !py-1.5 !rounded-lg flex-1" placeholder="Search knowledge base..." value={ragQuery} onChange={(e) => setRagQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchRAG()} />
                      <button onClick={searchRAG} disabled={ragLoading || !ragQuery.trim()} className="btn btn-primary !text-[10px] !py-1.5 !px-3">
                        {ragLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
                      </button>
                    </div>
                    {ragResults.length > 0 && (
                      <div>
                        <span className="text-[10px] text-ink3 font-mono">{ragResults.length} results</span>
                        <div className="space-y-1.5 mt-2">
                          {ragResults.map((r, i) => (
                            <div key={i} className="p-2 rounded-lg bg-surface2/50 border border-border/30">
                              <div className="flex items-center gap-2 mb-1">
                                <FileText size={10} className="text-blue-400" />
                                <span className="text-[10px] font-mono text-ink2 truncate">{String(r.title || r.id || `Result ${i + 1}`)}</span>
                                {r.score != null && <span className="text-[9px] text-accent ml-auto">{(Number(r.score) * 100).toFixed(0)}%</span>}
                              </div>
                              <p className="text-[9px] text-ink3 line-clamp-3">{String(r.content || r.text || r.description)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {ragResults.length === 0 && !ragLoading && (
                      <div className="text-center py-8"><Database size={24} className="mx-auto text-ink3/30 mb-2" /><p className="text-[11px] text-ink3">Search the knowledge base for answers</p></div>
                    )}
                  </div>
                )}

                {/* ── REPORTS TAB ─────────────────────────────── */}
                {sideTab === 'reports' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-mono text-ink3 uppercase tracking-wider">Agent Reports Feed</h3>
                      <div className="flex items-center gap-2">
                        <button onClick={loadReports} disabled={reportsLoading} className="text-[10px] text-accent hover:underline flex items-center gap-1">
                          {reportsLoading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Refresh
                        </button>
                        <button onClick={loadSupervisorAlerts} disabled={supervisorLoading} className="text-[10px] text-amber-400 hover:underline flex items-center gap-1">
                          {supervisorLoading ? <Loader2 size={10} className="animate-spin" /> : <Shield size={10} />} Supervisor
                        </button>
                      </div>
                    </div>

                    {/* Stats cards */}
                    {reportStats && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 rounded-lg bg-surface2/50 border border-border/30">
                          <div className="text-[10px] text-ink3">24h Reports</div>
                          <div className="text-sm font-bold text-ink">{reportStats.total_24h}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-surface2/50 border border-border/30">
                          <div className="text-[10px] text-ink3">Critical</div>
                          <div className={`text-sm font-bold ${reportStats.critical > 0 ? 'text-red-400' : 'text-green-400'}`}>{reportStats.critical}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-surface2/50 border border-border/30">
                          <div className="text-[10px] text-ink3">High</div>
                          <div className={`text-sm font-bold ${reportStats.high > 0 ? 'text-amber-400' : 'text-green-400'}`}>{reportStats.high}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-surface2/50 border border-border/30">
                          <div className="text-[10px] text-ink3">Divisions</div>
                          <div className="text-sm font-bold text-ink">{Object.keys(reportStats.by_division).length}</div>
                        </div>
                      </div>
                    )}

                    {/* Supervisor alerts */}
                    {supervisorAlerts && (
                      <div className={`p-2.5 rounded-xl border ${
                        (supervisorAlerts as Record<string, unknown>).danger_level === 'critical' ? 'border-red-400/30 bg-red-400/5' :
                        (supervisorAlerts as Record<string, unknown>).danger_level === 'elevated' ? 'border-amber-400/30 bg-amber-400/5' :
                        'border-green-400/30 bg-green-400/5'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Shield size={12} className={
                            (supervisorAlerts as Record<string, unknown>).danger_level === 'critical' ? 'text-red-400' :
                            (supervisorAlerts as Record<string, unknown>).danger_level === 'elevated' ? 'text-amber-400' : 'text-green-400'
                          } />
                          <span className="text-[10px] font-bold text-ink">AI Supervisor</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                            (supervisorAlerts as Record<string, unknown>).danger_level === 'critical' ? 'bg-red-400/10 text-red-400' :
                            (supervisorAlerts as Record<string, unknown>).danger_level === 'elevated' ? 'bg-amber-400/10 text-amber-400' :
                            'bg-green-400/10 text-green-400'
                          }`}>{String((supervisorAlerts as Record<string, unknown>).danger_level || 'unknown')}</span>
                        </div>
                        <p className="text-[9px] text-ink3">
                          Reviewed {String((supervisorAlerts as Record<string, unknown>).reports_reviewed || 0)} reports &middot;
                          {' '}{String((supervisorAlerts as Record<string, unknown>).critical_count || 0)} critical &middot;
                          {' '}{String((supervisorAlerts as Record<string, unknown>).high_count || 0)} high &middot;
                          {' '}{String((supervisorAlerts as Record<string, unknown>).failed_count || 0)} failed
                        </p>
                        {((supervisorAlerts as Record<string, unknown>).unhealthy_divisions as Record<string, unknown>[])?.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {((supervisorAlerts as Record<string, unknown>).unhealthy_divisions as Record<string, unknown>[]).map((ud, i) => (
                              <span key={i} className="text-[8px] px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 font-mono">
                                {String(ud.division)}: {String(ud.critical)}C {String(ud.high)}H
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-[8px] text-ink3 mt-1">Escalation: Kaku (Bally Howrah) &middot; Principal (Rahil)</p>
                      </div>
                    )}

                    {/* Severity filter */}
                    <div className="flex gap-1.5">
                      {['', 'critical', 'high', 'medium', 'low', 'info'].map(sev => (
                        <button key={sev} onClick={() => { setReportSeverityFilter(sev); }}
                          className={`text-[9px] px-2 py-1 rounded-full border transition-colors ${
                            reportSeverityFilter === sev ? 'border-accent text-accent bg-accent/10' : 'border-border text-ink3 hover:text-ink2'
                          }`}>
                          {sev || 'All'}
                        </button>
                      ))}
                    </div>

                    {/* Reports list */}
                    {agentReports.length > 0 && (
                      <div className="space-y-1.5">
                        {agentReports.filter(r => !reportFilter || String(r.agent_name || r.agent_id || '').toLowerCase().includes(reportFilter.toLowerCase()) || String(r.task_summary || '').toLowerCase().includes(reportFilter.toLowerCase())).map((report, i) => (
                          <div key={i} className={`p-2 rounded-lg border ${
                            report.severity === 'critical' ? 'border-red-400/30 bg-red-400/5' :
                            report.severity === 'high' ? 'border-amber-400/30 bg-amber-400/5' :
                            'border-border/30 bg-surface2/50'
                          }`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono ${
                                report.severity === 'critical' ? 'bg-red-400/10 text-red-400' :
                                report.severity === 'high' ? 'bg-amber-400/10 text-amber-400' :
                                report.severity === 'medium' ? 'bg-blue-400/10 text-blue-400' :
                                'bg-surface2 text-ink3'
                              }`}>{String(report.severity || 'info')}</span>
                              <span className="text-[10px] font-mono text-ink truncate">{String(report.agent_name || report.agent_id || 'unknown')}</span>
                              <span className="text-[8px] text-ink3 ml-auto">{timeAgo(String(report.created_at || ''))}</span>
                            </div>
                            <p className="text-[9px] text-ink2 line-clamp-2">{String(report.task_summary || 'No summary')}</p>
                            {report.findings != null && (
                              <div className="mt-1 text-[8px] text-ink3 line-clamp-2">
                                {typeof report.findings === 'string' ? report.findings : JSON.stringify(report.findings).slice(0, 120)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {agentReports.length === 0 && !reportsLoading && (
                      <div className="text-center py-8">
                        <FileText size={24} className="mx-auto text-ink3/30 mb-2" />
                        <p className="text-[11px] text-ink3">No agent reports yet</p>
                        <p className="text-[9px] text-ink3 mt-1">Reports appear when autonomous agents run scans</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Conversation history modal ───────────────────────── */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-display font-bold text-sm flex items-center gap-2"><History size={15} className="text-accent" /> Conversation History</h3>
              <button onClick={() => setShowHistory(false)} className="p-1.5 rounded-lg hover:bg-surface2"><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {conversationsLoading && <div className="text-center py-8"><Loader2 size={16} className="animate-spin mx-auto text-ink3" /></div>}
              {!conversationsLoading && conversations.length === 0 && <div className="text-center py-8 text-[11px] text-ink3">No previous conversations</div>}
              {conversations.map((conv) => (
                <button key={conv.id || conv.session_id} onClick={() => loadConversation(conv.id || conv.session_id || '')} className="w-full text-left p-3 rounded-xl border border-border hover:border-accent/30 hover:bg-accent/5 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-ink">{(conv.id || conv.session_id || '').slice(0, 24)}</span>
                    <span className="text-[9px] text-ink3">{timeAgo(conv.created_at || conv.updated_at || '')}</span>
                  </div>
                  <p className="text-[10px] text-ink3 mt-1 line-clamp-1">{conv.last_message || `${conv.message_count || 0} messages`}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
