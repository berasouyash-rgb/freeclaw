import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, Loader2, Sparkles, Zap, Square,
  CheckCircle2, XCircle, Clock, Wrench,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import type { Message } from './agent-chat/tool-meta';
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
}

/* ── Main Component ────────────────────────────────────────────── */
export default function AgentChat() {
  const { toast } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* Load session history */
  const loadHistory = useCallback(async () => {
    try {
      const data = await api.postLong<Record<string, unknown>[]>('/api/agent-chat', { action: 'history', session_id: 'ai-chat-main' });
      if (Array.isArray(data)) {
        setMessages(data.map((d: Record<string, unknown>) => ({
          role: d.role as ChatMessage['role'],
          content: d.content as string,
          created_at: d.created_at as string,
          toolResults: d.actions ? JSON.parse(d.actions as string) : undefined,
          hasToolUse: !!d.actions,
        })));
      }
    } catch (e: unknown) {
      console.error('Failed to load chat history:', e);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.postLong<Record<string, unknown>[]>('/api/agent-chat', { action: 'sessions' });
      setSessions(data);
    } catch (e: unknown) {
      console.error('Failed to load chat sessions:', e);
    }
  }, []);

  useEffect(() => { loadHistory(); loadSessions(); }, [loadHistory, loadSessions]);

  /* Auto-scroll */
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  /* Cancel active run */
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
    } catch { /* best effort */ }
    setBusy(false);
    setActiveRunId(null);
  }, []);

  /* ── Send message via SSE streaming ──────────────────────────── */
  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput('');

    const runId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userMsg: ChatMessage = { role: 'user', content: msg, created_at: new Date().toISOString() };

    // Create a placeholder assistant message that we'll stream into
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      streamingContent: '',
      isStreaming: true,
      steps: [],
      toolResults: [],
      hasToolUse: false,
      runId,
      created_at: new Date().toISOString(),
    };

    setMessages((m) => [...m, userMsg, assistantMsg]);
    setBusy(true);
    setActiveRunId(runId);

    // Get admin token for auth header
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

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { 'X-Admin-Token': adminToken } : {}),
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: msg }],
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
              case 'content_delta': {
                // Append streaming token to the assistant message
                setMessages((m) => m.map((msg, i) => {
                  if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
                  return {
                    ...msg,
                    streamingContent: (msg.streamingContent || '') + (event.delta || ''),
                  };
                }));
                break;
              }

              case 'process_step': {
                // Add/update a process step
                setMessages((m) => m.map((msg, i) => {
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

              case 'tool_result': {
                // Record a tool result
                const toolResult: ToolResult = {
                  tool: event.tool,
                  args: event.args || {},
                  result: event.result,
                  error: event.result?.error,
                };
                setMessages((m) => m.map((msg, i) => {
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
                // Stream complete — finalize the message
                setMessages((m) => m.map((msg, i) => {
                  if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
                  const finalContent = msg.streamingContent || msg.content;
                  return {
                    ...msg,
                    content: finalContent,
                    streamingContent: undefined,
                    isStreaming: false,
                    provider: event.provider,
                    model: event.model,
                  };
                }));
                break;
              }

              case 'error': {
                setMessages((m) => m.map((msg, i) => {
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

      // Finalize: if streamingContent exists but no 'done' event was received
      setMessages((m) => m.map((msg, i) => {
        if (i !== m.length - 1 || msg.role !== 'assistant' || !msg.isStreaming) return msg;
        const finalContent = msg.streamingContent || msg.content || 'No response received.';
        return {
          ...msg,
          content: finalContent,
          streamingContent: undefined,
          isStreaming: false,
        };
      }));

    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('aborted')) {
        // User cancelled — just stop
        setMessages((m) => m.map((msg, i) => {
          if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
          return {
            ...msg,
            content: msg.streamingContent || 'Cancelled.',
            streamingContent: undefined,
            isStreaming: false,
          };
        }));
      } else {
        toast(errMsg, 'err');
        setMessages((m) => m.map((msg, i) => {
          if (i !== m.length - 1 || msg.role !== 'assistant') return msg;
          return {
            ...msg,
            content: `Error: ${errMsg}`,
            streamingContent: undefined,
            isStreaming: false,
          };
        }));
      }
    } finally {
      setBusy(false);
      setActiveRunId(null);
      abortRef.current = null;
      loadSessions();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-semibold text-sm flex items-center gap-2">
            <MessageSquare size={15} className="text-accent" /> AI Admin Agent
          </h2>
          <p className="text-[11px] text-ink3 mt-0.5">
            Streaming AI — tools execute automatically, results appear inline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost !text-xs" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Current chat' : `History (${sessions.length})`}
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="card p-4 max-h-64 overflow-auto">
          {sessions.length === 0 && <p className="text-xs text-ink3">No previous sessions</p>}
          {sessions.map((s) => (
            <div key={String(s.session_id)} className="text-xs text-ink2 py-1 border-b border-border last:border-0">
              <span className="font-mono text-ink3">{String(s.session_id)}</span>
              <span className="ml-2 text-ink3">{new Date(String(s.last_message)).toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Chat area */}
          <div ref={chatRef} className="card p-4 min-h-[300px] max-h-[500px] overflow-auto space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8 vb-rise">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-accent/10 flex items-center justify-center mb-3 vb-pop">
                  <Sparkles size={28} className="text-accent" />
                </div>
                <p className="font-display font-semibold text-sm text-ink">AI Admin Agent</p>
                <p className="text-xs text-ink3 mt-1 max-w-xs mx-auto">Ask me anything. I'll automatically query your database, manage posts, users, and more — results stream live.</p>
              </div>
            )}

            {messages.map((m, mi) => (
              <div key={mi} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} vb-slide-in`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === 'user' ? 'bg-accent text-white shadow-lg shadow-accent/20' :
                  'bg-surface2 text-ink'
                }`}>
                  {/* Main text content — show streaming or final */}
                  {(m.streamingContent || m.content) ? (
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {m.streamingContent || m.content}
                      {m.isStreaming && <span className="inline-block w-1.5 h-4 bg-accent/70 ml-0.5 animate-pulse rounded-sm align-text-bottom" />}
                    </p>
                  ) : m.isStreaming && !m.streamingContent && m.steps?.length === 0 ? (
                    <p className="text-ink3 italic">Connecting…</p>
                  ) : null}

                  {/* Process steps — tool execution timeline */}
                  {m.steps && m.steps.length > 0 && (
                    <div className="mt-3 space-y-1.5">
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
                          {step.model ? (
                            <Wrench size={10} className="text-ink3 shrink-0" />
                          ) : null}
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

                  {/* Tool results — displayed inline */}
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

                  {/* Provider badge */}
                  {m.provider && m.provider !== 'none' && !m.isStreaming && (
                    <p className="text-[9px] font-mono mt-1.5 opacity-50 flex items-center gap-1">
                      <Zap size={8} /> {m.provider}/{m.model}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* Busy indicator (only when no streaming message yet) */}
            {busy && messages.length > 0 && !messages[messages.length - 1]?.isStreaming && (
              <div className="flex justify-start vb-slide-in">
                <div className="bg-surface2 rounded-2xl px-4 py-2.5 text-xs text-ink3 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((qa) => (
              <button key={qa.label} className="btn btn-ghost !text-[10px] !py-1 !px-2 rounded-xl" onClick={() => send(qa.msg)} disabled={busy}>
                {qa.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              className="input flex-1 !text-xs !py-2.5"
              placeholder="Ask the agent… (e.g. 'show me the 3 most recent posts')"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && send()}
              disabled={busy}
            />
            {busy && activeRunId ? (
              <button
                className="btn btn-ghost !text-xs !py-2.5 !px-5 rounded-xl text-red-400 border border-red-500/20 hover:bg-red-500/10"
                onClick={() => cancelRun(activeRunId)}
              >
                <Square size={14} />
              </button>
            ) : (
              <button className="btn btn-primary !text-xs !py-2.5 !px-5 rounded-xl shadow-lg shadow-accent/20" onClick={() => send()} disabled={!input.trim()}>
                <Send size={14} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
