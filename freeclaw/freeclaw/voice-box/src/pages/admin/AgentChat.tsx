import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send, Loader2, Sparkles, Zap, Square,
  CheckCircle2, XCircle, Wrench, Eye, Copy, Check, Clock,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { QUICK_ACTIONS } from './agent-chat/tool-meta';

/* ── Types ─────────────────────────────────────────────────────── */
interface ProcessStep {
  step_id: string;
  label: string;
  status: 'active' | 'done' | 'error';
  detail?: string;
  model?: string;
}

interface ToolResult {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

/* ── Chat Message Type (extended for streaming) ──────────────── */
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Streaming text deltas appended in real-time */
  streamingContent?: string;
  /** True while tokens are arriving */
  isStreaming?: boolean;
  /** Tool execution steps shown inline */
  steps?: ProcessStep[];
  /** Tool results from this turn */
  toolResults?: ToolResult[];
  /** Whether any tools were executed */
  hasToolUse?: boolean;
  provider?: string;
  model?: string;
  created_at: string;
  /** Unique run ID for cancel support */
  runId?: string;
  /** Reasoning/thinking text from <thinking> blocks */
  thinking?: string;
  /** Accumulated thinking delta during streaming */
  streamingThinking?: string;
}

/* ── Helpers ────────────────────────────────────────────────────── */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function AutoResizeTextarea({ value, onChange, onKeyDown, placeholder, disabled }: {
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
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
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
      style={{ minHeight: '44px', maxHeight: '120px' }}
    />
  );
}

/* ── Main Component ────────────────────────────────────────────── */
export default function AgentChat() {
  const { toast } = useApp();
  const [messages, _setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ── Throttled message updates ───────────────────────────────── */
  const messagesRef = useRef<ChatMessage[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setMessagesImmediate = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    const next = typeof updater === 'function' ? updater(messagesRef.current) : updater;
    messagesRef.current = next;
    _setMessages(next);
  }, []);

  const setMessagesThrottled = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    messagesRef.current = updater(messagesRef.current);
    if (!flushTimerRef.current) {
      flushTimerRef.current = setInterval(() => {
        _setMessages([...messagesRef.current]);
        if (flushTimerRef.current) { clearInterval(flushTimerRef.current); flushTimerRef.current = null; }
      }, 50);
    }
  }, []);

  const flushMessages = useCallback(() => {
    if (flushTimerRef.current) { clearInterval(flushTimerRef.current); flushTimerRef.current = null; }
    _setMessages([...messagesRef.current]);
  }, []);

  useEffect(() => () => { if (flushTimerRef.current) clearInterval(flushTimerRef.current); }, []);

  /* ── History ──────────────────────────────────────────────────── */
  const loadHistory = useCallback(async () => {
    try {
      const data = await api.postLong<Record<string, unknown>[]>('/api/ai-chat', {
        action: 'history',
        session_id: 'ai-chat-main',
      });
      if (Array.isArray(data)) {
        setMessagesImmediate(data.map((d: Record<string, unknown>) => ({
          role: d.role as ChatMessage['role'],
          content: d.content as string,
          created_at: d.created_at as string,
          toolResults: d.actions ? JSON.parse(d.actions as string) : undefined,
          hasToolUse: !!d.actions,
        })));
      }
    } catch (e: unknown) {
      console.error('Failed to load chat history:', e);
    } finally {
      setLoadingHistory(false);
    }
  }, [setMessagesImmediate]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.postLong<Record<string, unknown>[]>('/api/ai-chat', { action: 'sessions' });
      setSessions(data);
    } catch (e: unknown) {
      console.error('Failed to load chat sessions:', e);
    }
  }, []);

  useEffect(() => { loadHistory(); loadSessions(); }, [loadHistory, loadSessions]);

  /* ── Auto-scroll ──────────────────────────────────────────────── */
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    }
  }, [messages]);

  /* ── Cancel ───────────────────────────────────────────────────── */
  const cancelRun = useCallback(async (runId: string) => {
    abortRef.current?.abort();
    try {
      await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': sessionStorage.getItem('vb:adminAuth') ? JSON.parse(sessionStorage.getItem('vb:adminAuth')!).token : '',
        },
        body: JSON.stringify({ action: 'cancel', run_id: runId }),
      });
    } catch (e: unknown) { console.warn('[AgentChat] Failed to cancel run:', e instanceof Error ? e.message : e); }
    setBusy(false);
    setActiveRunId(null);
  }, []);

  /* ── Copy message content ─────────────────────────────────────── */
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const copyMessage = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  }, []);

  /* ── Send message via SSE streaming ──────────────────────────── */
  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput('');

    const runId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = 'ai-chat-main';
    const userMsg: ChatMessage = { role: 'user', content: msg, created_at: new Date().toISOString() };

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      streamingContent: '',
      streamingThinking: '',
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

    let adminToken = '';
    try {
      const raw = sessionStorage.getItem('vb:adminAuth');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.exp && parsed.exp > Date.now()) adminToken = parsed.token;
      }
    } catch { /* no token */ }

    const abortController = new AbortController();
    abortRef.current = abortController;

    // Build full conversation history for LLM context
    // messagesRef already has the new userMsg + empty assistantMsg appended,
    // so exclude the last two entries (the ones we just added).
    const currentMessages = messagesRef.current;
    const historyForBackend = currentMessages
      .slice(0, -2) // Exclude the userMsg and assistantMsg we just appended
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map((m) => ({ role: m.role, content: m.content }));
    // Add the new user message
    historyForBackend.push({ role: 'user' as const, content: msg });

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { 'X-Admin-Token': adminToken } : {}),
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
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const event = JSON.parse(dataStr);

            switch (event.ada_event) {
              case 'thinking_delta': {
                setMessagesThrottled((m) => m.map((msg, i) => {
                  if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
                  return {
                    ...msg,
                    streamingThinking: (msg.streamingThinking || '') + (event.delta || ''),
                  };
                }));
                break;
              }

              case 'content_delta': {
                setMessagesThrottled((m) => m.map((msg, i) => {
                  if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
                  return {
                    ...msg,
                    streamingContent: (msg.streamingContent || '') + (event.delta || ''),
                  };
                }));
                break;
              }

              case 'process_step': {
                setMessagesThrottled((m) => m.map((msg, i) => {
                  if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
                  const existingSteps = msg.steps || [];
                  const stepIdx = existingSteps.findIndex(s => s.step_id === event.step_id);
                  const newStep: ProcessStep = {
                    step_id: event.step_id,
                    label: event.label,
                    status: event.status,
                    detail: event.detail,
                    model: event.model,
                  };
                  const updatedSteps = stepIdx >= 0
                    ? existingSteps.map((s, si) => si === stepIdx ? newStep : s)
                    : [...existingSteps, newStep];
                  return { ...msg, steps: updatedSteps, hasToolUse: true };
                }));
                break;
              }

              case 'iteration_start': {
                setMessagesThrottled((m) => m.map((msg, i) => {
                  if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
                  return {
                    ...msg,
                    streamingContent: '',
                    streamingThinking: (msg.streamingThinking || '') + `\n${event.message || 'Processing...'}\n`,
                  };
                }));
                break;
              }

              case 'tool_result': {
                const toolResult: ToolResult = {
                  tool: event.tool,
                  args: event.args || {},
                  result: event.result,
                  error: event.result?.error,
                };
                setMessagesThrottled((m) => m.map((msg, i) => {
                  if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
                  return {
                    ...msg,
                    toolResults: [...(msg.toolResults || []), toolResult],
                    hasToolUse: true,
                  };
                }));
                break;
              }

              case 'done': {
                flushMessages();
                setMessagesImmediate((m) => m.map((msg, i) => {
                  if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
                  const finalContent = event.text || msg.streamingContent || msg.content;
                  const finalThinking = event.thinking || msg.streamingThinking || undefined;
                  return {
                    ...msg,
                    content: finalContent,
                    thinking: finalThinking,
                    streamingContent: undefined,
                    streamingThinking: undefined,
                    isStreaming: false,
                    provider: event.provider,
                    model: event.model,
                  };
                }));
                break;
              }

              case 'error': {
                flushMessages();
                setMessagesImmediate((m) => m.map((msg, i) => {
                  if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
                  return {
                    ...msg,
                    content: `Error: ${event.message || 'Unknown error'}`,
                    streamingContent: undefined,
                    isStreaming: false,
                  };
                }));
                break;
              }
            }
          } catch { /* skip malformed events */ }
        }
      }

      flushMessages();
      setMessagesImmediate((m) => m.map((msg, i) => {
        if (i !== m.length - 1 || msg.role !== 'assistant' || !msg.isStreaming) return msg;
        const finalContent = msg.streamingContent || msg.content || 'No response received.';
        return {
          ...msg,
          content: finalContent,
          thinking: msg.streamingThinking || msg.thinking,
          streamingContent: undefined,
          streamingThinking: undefined,
          isStreaming: false,
        };
      }));

    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      flushMessages();
      if (errMsg.includes('aborted')) {
        setMessagesImmediate((m) => m.map((msg, i) => {
          if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
          return {
            ...msg,
            content: msg.streamingContent || 'Cancelled.',
            thinking: msg.streamingThinking || msg.thinking,
            streamingContent: undefined,
            streamingThinking: undefined,
            isStreaming: false,
          };
        }));
      } else {
        toast(errMsg, 'err');
        setMessagesImmediate((m) => m.map((msg, i) => {
          if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
          return {
            ...msg,
            content: `Error: ${errMsg}`,
            streamingContent: undefined,
            streamingThinking: undefined,
            isStreaming: false,
          };
        }));
      }
    } finally {
      flushMessages();
      setBusy(false);
      setActiveRunId(null);
      abortRef.current = null;
      loadSessions();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  /* ── Render: Empty state ──────────────────────────────────────── */
  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-12 px-6 select-none">
      <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-4">
        <Sparkles size={24} className="text-accent" />
      </div>
      <h3 className="font-display font-semibold text-sm text-ink mb-1">AI Admin Agent</h3>
      <p className="text-xs text-ink3 text-center max-w-[280px] leading-relaxed mb-5">
        Ask me anything about your platform. I'll query your database, manage content, and analyze data — results stream live.
      </p>
      <div className="grid grid-cols-2 gap-2 w-full max-w-[320px]">
        {[
          { label: 'Show recent posts', msg: 'Show me the 5 most recent posts' },
          { label: 'Check user stats', msg: 'How many users are registered?' },
          { label: 'Analyze activity', msg: 'Give me an overview of platform activity today' },
          { label: 'Database schema', msg: 'What tables exist in the database?' },
        ].map((s) => (
          <button
            key={s.label}
            className="text-left text-[11px] text-ink2 px-3 py-2.5 rounded-xl border border-border hover:border-accent/40 hover:bg-accent/5 transition-all cursor-pointer"
            onClick={() => send(s.msg)}
            disabled={busy}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );

  /* ── Render: Single message ───────────────────────────────────── */
  const renderMessage = (m: ChatMessage, idx: number) => {
    const isUser = m.role === 'user';
    const displayText = m.streamingContent || m.content;
    const showThinking = m.role === 'assistant' && (m.thinking || m.streamingThinking);
    const _hasContent = displayText || (m.steps && m.steps.length > 0) || (m.toolResults && m.toolResults.length > 0);

    return (
      <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'} gap-2.5 group`}>
        {/* Assistant avatar */}
        {!isUser && (
          <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles size={13} className="text-accent" />
          </div>
        )}

        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[75%] min-w-0`}>
          {/* Message bubble */}
          <div className={`rounded-2xl px-4 py-3 text-sm ${
            isUser
              ? 'bg-accent text-white rounded-br-md'
              : 'bg-surface2 text-ink border border-border/50 rounded-bl-md'
          }`}>
            {/* Thinking / reasoning — collapsible */}
            {showThinking && (
              <details className="mb-2 group/think">
                <summary className="flex items-center gap-1.5 text-[11px] text-ink3 cursor-pointer select-none hover:text-ink2 transition-colors list-none">
                  {m.isStreaming && m.streamingThinking ? (
                    <Loader2 size={10} className="animate-spin text-accent" />
                  ) : (
                    <Eye size={10} className="text-ink3/60" />
                  )}
                  <span className="font-medium">
                    {m.isStreaming && m.streamingThinking ? 'Analyzing…' : 'Reasoning'}
                  </span>
                  <span className="text-[9px] text-ink3/40 ml-auto group-open/think:rotate-90 transition-transform">▸</span>
                </summary>
                <div className="mt-2 p-3 rounded-lg bg-black/30 border border-white/5 text-[11px] text-ink3/80 leading-relaxed max-h-48 overflow-auto whitespace-pre-wrap font-mono">
                  {m.thinking || m.streamingThinking}
                </div>
              </details>
            )}

            {/* Main text content */}
            {displayText ? (
              <div className="whitespace-pre-wrap leading-relaxed">
                {displayText}
                {m.isStreaming && <span className="inline-block w-1.5 h-4 bg-accent/70 ml-0.5 animate-pulse rounded-sm align-text-bottom" />}
              </div>
            ) : m.isStreaming && !m.streamingContent && (!m.steps || m.steps.length === 0) ? (
              <div className="flex items-center gap-2 text-ink3">
                <Loader2 size={12} className="animate-spin" />
                <span className="text-xs italic">Thinking…</span>
              </div>
            ) : null}

            {/* Tool execution steps */}
            {m.steps && m.steps.length > 0 && (
              <div className="mt-3 space-y-1">
                {m.steps.map((step) => (
                  <div key={step.step_id} className="flex items-center gap-2 text-[11px]">
                    {step.status === 'active' && (
                      <Loader2 size={11} className="text-accent animate-spin shrink-0" />
                    )}
                    {step.status === 'done' && (
                      <CheckCircle2 size={11} className="text-green-400 shrink-0" />
                    )}
                    {step.status === 'error' && (
                      <XCircle size={11} className="text-red-400 shrink-0" />
                    )}
                    {step.model && <Wrench size={10} className="text-ink3 shrink-0" />}
                    <span className={`${
                      step.status === 'active' ? 'text-accent' :
                      step.status === 'error' ? 'text-red-400' :
                      'text-ink3'
                    }`}>
                      {step.label}
                    </span>
                    {step.detail && (
                      <span className="text-ink3/60 truncate max-w-[200px]">— {step.detail}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Tool results */}
            {m.toolResults && m.toolResults.length > 0 && (
              <div className="mt-3 space-y-2">
                {m.toolResults.map((tr, tri) => (
                  <div key={tri} className={`rounded-xl border p-3 text-[11px] ${
                    tr.error
                      ? 'bg-red-500/5 border-red-500/20'
                      : 'bg-green-500/5 border-green-500/15'
                  }`}>
                    <div className="flex items-center gap-1.5 font-semibold mb-1.5">
                      {tr.error ? (
                        <XCircle size={11} className="text-red-400" />
                      ) : (
                        <CheckCircle2 size={11} className="text-green-400" />
                      )}
                      <span className={tr.error ? 'text-red-400' : 'text-green-400'}>
                        {tr.tool}
                      </span>
                    </div>
                    {tr.error ? (
                      <p className="text-red-400/80">{tr.error}</p>
                    ) : (
                      <pre className="font-mono text-[10px] text-ink3/70 whitespace-pre-wrap max-h-40 overflow-auto">
                        {typeof tr.result === 'string'
                          ? tr.result
                          : JSON.stringify(tr.result, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Meta row: timestamp + copy + provider */}
          <div className={`flex items-center gap-2 mt-1 px-1 text-[9px] text-ink3/50 ${isUser ? 'flex-row-reverse' : ''}`}>
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
                {copiedIdx === idx ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
              </button>
            )}
            {!isUser && m.provider && m.provider !== 'none' && !m.isStreaming && (
              <span className="flex items-center gap-0.5 opacity-60">
                <Zap size={7} /> {m.provider}/{m.model}
              </span>
            )}
          </div>
        </div>

        {/* User avatar */}
        {isUser && (
          <div className="w-7 h-7 rounded-lg bg-surface3 border border-border flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-[11px] font-semibold text-ink2">Y</span>
          </div>
        )}
      </div>
    );
  };

  /* ── Main render ──────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3 border-b border-border/50 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Sparkles size={16} className="text-accent" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-sm text-ink leading-none">AI Admin Agent</h2>
            <p className="text-[10px] text-ink3 mt-0.5">Database, analytics, content management</p>
          </div>
        </div>
        <button
          className="btn btn-ghost !text-[11px] !py-1.5 !px-3"
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? 'Back to chat' : `History (${sessions.length})`}
        </button>
      </div>

      {showHistory ? (
        <div className="card p-4 max-h-64 overflow-auto">
          {sessions.length === 0 && <p className="text-xs text-ink3">No previous sessions</p>}
          {sessions.map((s) => (
            <div key={String(s.session_id)} className="text-xs text-ink2 py-1.5 border-b border-border/30 last:border-0 flex items-center justify-between">
              <span className="font-mono text-ink3">{String(s.session_id).slice(0, 24)}…</span>
              <span className="text-ink3/60">{new Date(String(s.last_message)).toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Chat messages area */}
          <div ref={chatRef} className="flex-1 overflow-auto px-1 py-2 space-y-4" style={{ minHeight: 0 }}>
            {loadingHistory ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-accent mb-2" />
                <span className="text-xs text-ink3">Loading conversation…</span>
              </div>
            ) : messages.length === 0 ? (
              renderEmptyState()
            ) : (
              messages.map((m, i) => renderMessage(m, i))
            )}

            {/* Initial "thinking" indicator when busy but no streaming message yet */}
            {busy && messages.length > 0 && !messages[messages.length - 1]?.isStreaming && (
              <div className="flex justify-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                  <Sparkles size={13} className="text-accent" />
                </div>
                <div className="bg-surface2 border border-border/50 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin text-accent" />
                  <span className="text-xs text-ink3 italic">Thinking…</span>
                </div>
              </div>
            )}
          </div>

          {/* Quick action chips */}
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 mb-2">
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
          )}

          {/* Input area */}
          <div className="relative flex items-end gap-2 px-1 pt-2 border-t border-border/50">
            <AutoResizeTextarea
              value={input}
              onChange={setInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !busy) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about your platform…"
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
          <p className="text-[9px] text-ink3/40 text-center mt-1">
            Shift+Enter for new line · Enter to send
          </p>
        </>
      )}
    </div>
  );
}
