import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, Loader2, Sparkles, Zap, ArrowRight, Check,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import type { Message } from './agent-chat/tool-meta';
import { TOOL_META, QUICK_ACTIONS } from './agent-chat/tool-meta';
import ActionCard from './agent-chat/ActionCard';

/* ── Main Component ────────────────────────────────────────── */
export default function AgentChat() {
  const { toast } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId] = useState(() => `s_${Date.now()}`);
  const [busy, setBusy] = useState(false);
  const [executingIds, setExecutingIds] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  /* Load session history */
  const loadHistory = useCallback(async () => {
    try {
      const data = await api.postLong('/api/agent-chat', { action: 'history', session_id: sessionId });
      if (Array.isArray(data)) {
        setMessages(data.map((d: Record<string, unknown>) => ({
          role: d.role as Message['role'],
          content: d.content as string,
          actions: d.actions as Message['actions'],
          created_at: d.created_at as string,
        })));
      }
    } catch (e: unknown) {
      console.error('Failed to load chat history:', e);
    }
  }, [sessionId]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.postLong('/api/agent-chat', { action: 'sessions' });
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

  /* Send message */
  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg, created_at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const r = await api.postLong('/api/agent-chat', { action: 'chat', message: msg, session_id: sessionId });
      const assistantMsg: Message = {
        role: 'assistant',
        content: r.reply,
        actions: r.actions,
        provider: r.provider,
        model: r.model,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, assistantMsg]);
      loadSessions();
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      toast(errMsg, 'err');
      setMessages((m) => [...m, { role: 'system', content: `Error: ${errMsg}`, created_at: new Date().toISOString() }]);
    }
    setBusy(false);
  };

  /* Execute a single action */
  const executeAction = async (msgIndex: number, actionId: string) => {
    const msg = messages[msgIndex];
    const action = msg.actions?.find((a) => a.id === actionId);
    if (!action) return;

    setExecutingIds((s) => new Set([...s, actionId]));
    try {
      const r = await api.postLong('/api/agent-chat', {
        action: 'execute',
        actions: [{ id: action.id, tool: action.tool, args: action.args }],
        session_id: sessionId,
      });
      const result = r.results?.[0] || { success: false, error: 'No result returned' };

      setMessages((m) => m.map((msg, i) => {
        if (i !== msgIndex || !msg.actions) return msg;
        return { ...msg, actions: msg.actions.map((a) => a.id === actionId ? { ...a, result } : a) };
      }));

      if (result.success) {
        toast(`${TOOL_META[action.tool]?.label || action.tool} completed`, 'ok');
        const redirectTab = TOOL_META[action.tool]?.redirectTab;
        if (redirectTab) setTimeout(() => window.dispatchEvent(new CustomEvent('vb:admin-tab', { detail: redirectTab })), 1200);
      } else {
        toast(`Failed: ${result.error}`, 'err');
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      toast(errMsg, 'err');
      setMessages((m) => m.map((msg, i) => {
        if (i !== msgIndex || !msg.actions) return msg;
        return { ...msg, actions: msg.actions.map((a) => a.id === actionId ? { ...a, result: { success: false, error: errMsg } } : a) };
      }));
    }
    setExecutingIds((s) => { const next = new Set(s); next.delete(actionId); return next; });
  };

  /* Execute all actions in a message */
  const executeAll = async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg.actions) return;
    for (const action of msg.actions) {
      if (!action.result) await executeAction(msgIndex, action.id);
    }
  };

  /* Dismiss (remove) a single action */
  const dismissAction = (msgIndex: number, actionId: string) => {
    setMessages((m) => m.map((msg, i) => {
      if (i !== msgIndex || !msg.actions) return msg;
      const filtered = msg.actions.filter((a) => a.id !== actionId);
      return { ...msg, actions: filtered.length > 0 ? filtered : undefined };
    }));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-semibold text-sm flex items-center gap-2">
            <MessageSquare size={15} className="text-accent" /> Admin Agent
          </h2>
          <p className="text-[11px] text-ink3 mt-0.5">
            Natural language admin — ask questions, get analytics, manage content. Click action cards to expand and preview.
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
                <p className="font-display font-semibold text-sm text-ink">Admin Agent</p>
                <p className="text-xs text-ink3 mt-1 max-w-xs mx-auto">Ask me anything about your platform. I can manage posts, users, polls, announcements, and more.</p>
              </div>
            )}
            {messages.map((m, mi) => (
              <div key={mi} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} vb-slide-in`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === 'user' ? 'bg-accent text-white shadow-lg shadow-accent/20' :
                  m.role === 'system' ? 'bg-warn/10 text-warn border border-warn/20' :
                  'bg-surface2 text-ink'
                }`}>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>

                  {/* Provider badge */}
                  {m.provider && m.provider !== 'none' && (
                    <p className="text-[9px] font-mono mt-1.5 opacity-50 flex items-center gap-1">
                      <Zap size={8} /> {m.provider}/{m.model}
                    </p>
                  )}

                  {/* Visual action cards */}
                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-3 space-y-2.5">
                      <p className="text-[11px] font-semibold text-ink3 flex items-center gap-1.5">
                        <ArrowRight size={10} /> Proposed actions — click to expand
                      </p>
                      {m.actions.map((a, ai) => (
                        <div key={a.id} style={{ animationDelay: `${ai * 100}ms` }} className="vb-rise">
                          <ActionCard
                            action={a}
                            executing={executingIds.has(a.id)}
                            onExecute={() => executeAction(mi, a.id)}
                            onDismiss={() => dismissAction(mi, a.id)}
                          />
                        </div>
                      ))}
                      {/* Execute all button */}
                      {m.actions.filter((a) => !a.result).length > 1 && (
                        <button
                          className="btn btn-primary !text-[11px] !py-2 flex items-center gap-1.5 rounded-xl shadow-lg shadow-accent/20"
                          onClick={() => executeAll(mi)}
                          disabled={executingIds.size > 0}
                        >
                          <Check size={12} /> Execute all {m.actions.filter((a) => !a.result).length} actions
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
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
              <button key={qa.label} className="btn btn-ghost !text-[10px] !py-1 !px-2 rounded-xl" onClick={() => send(qa.msg)}>
                {qa.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              className="input flex-1 !text-xs !py-2.5"
              placeholder="Ask the agent… (e.g. 'hide post The cricket ground is wet')"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              disabled={busy}
            />
            <button className="btn btn-primary !text-xs !py-2.5 !px-5 rounded-xl shadow-lg shadow-accent/20" onClick={() => send()} disabled={busy || !input.trim()}>
              <Send size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
