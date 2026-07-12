import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, PlayCircle, Check, AlertTriangle, Loader2, Trash2, Key } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';

interface Action {
  id: string;
  tool: string;
  args: Record<string, any>;
  reason: string;
  destructive: boolean;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  actions?: Action[];
  provider?: string;
  model?: string;
  created_at: string;
}

const TOOL_LABELS: Record<string, string> = {
  get_posts: 'View posts',
  update_post: 'Update post',
  delete_post: 'Delete post',
  warn_user: 'Warn user',
  ban_user: 'Ban user',
  get_user_posts: 'View user posts',
  create_poll: 'Create poll',
  close_poll: 'Close poll',
  get_analytics: 'Get analytics',
  get_activity_logs: 'View activity logs',
  set_announcement: 'Set announcement',
};

const QUICK_ACTIONS = [
  { label: 'Show analytics', msg: 'Show me a summary of platform activity' },
  { label: 'Recent posts', msg: 'Show me the 5 most recent posts' },
  { label: 'Pending reports', msg: 'Show me all reported posts' },
  { label: 'User breakdown', msg: 'Break down post counts by anonymous user' },
  { label: 'Post by category', msg: 'Show me post counts by category' },
];

export default function AgentChat() {
  const { toast } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId] = useState(() => `s_${Date.now()}`);
  const [busy, setBusy] = useState(false);
  const [executing, setExecuting] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  // Load session history
  const loadHistory = useCallback(async () => {
    try {
      const data = await api.post('/api/agent-chat', { action: 'history', session_id: sessionId });
      if (Array.isArray(data)) {
        setMessages(data.map((d: any) => ({
          role: d.role,
          content: d.content,
          actions: d.actions,
          created_at: d.created_at,
        })));
      }
    } catch { /* empty */ }
  }, [sessionId]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.post('/api/agent-chat', { action: 'sessions' });
      setSessions(data);
    } catch { /* empty */ }
  }, []);

  useEffect(() => { loadHistory(); loadSessions(); }, [loadHistory, loadSessions]);

  // Auto-scroll
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg, created_at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const r = await api.post('/api/agent-chat', { action: 'chat', message: msg, session_id: sessionId });
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
    } catch (e: any) {
      toast(e.message, 'err');
      setMessages((m) => [...m, { role: 'system', content: `Error: ${e.message}`, created_at: new Date().toISOString() }]);
    }
    setBusy(false);
  };

  const executeActions = async (actions: Action[]) => {
    const ids = new Set(actions.map((a) => a.id));
    setExecuting(ids);
    try {
      const r = await api.post('/api/agent-chat', { action: 'execute', actions, session_id: sessionId });
      const results = r.results || [];
      const summary = results.map((res: any) => {
        const label = TOOL_LABELS[res.id] || res.id;
        return res.success ? `✓ ${label}` : `✗ ${label}: ${res.error}`;
      }).join('\n');
      setMessages((m) => [...m, {
        role: 'system',
        content: `Actions executed:\n${summary}`,
        created_at: new Date().toISOString(),
      }]);
      toast('Actions executed', 'ok');
    } catch (e: any) {
      toast(e.message, 'err');
    }
    setExecuting(new Set());
  };

  const cancelActions = (actionId: string) => {
    // Remove a single action from the pending list by updating the message
    setMessages((m) => m.map((msg) => {
      if (msg.actions) {
        const filtered = msg.actions.filter((a) => a.id !== actionId);
        return { ...msg, actions: filtered.length > 0 ? filtered : undefined };
      }
      return msg;
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-semibold text-sm flex items-center gap-2"><MessageSquare size={15} className="text-accent" /> Agent Chat</h2>
          <p className="text-[11px] text-ink3 mt-0.5">Natural language admin — ask questions, get analytics, manage posts. Destructive actions require your approval.</p>
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
            <div key={s.session_id} className="text-xs text-ink2 py-1 border-b border-border last:border-0">
              <span className="font-mono text-ink3">{s.session_id}</span>
              <span className="ml-2 text-ink3">{new Date(s.last_message).toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Chat area */}
          <div ref={chatRef} className="card p-4 min-h-[300px] max-h-[500px] overflow-auto space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <MessageSquare size={28} className="mx-auto text-ink3 mb-2" />
                <p className="font-display font-semibold text-sm text-ink2">Admin Agent</p>
                <p className="text-xs text-ink3 mt-1">Ask me anything about your platform, or use a quick action below.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  m.role === 'user' ? 'bg-accent text-lacquer-deep' :
                  m.role === 'system' ? 'bg-warn/10 text-warn border border-warn/20' :
                  'bg-surface2 text-ink'
                }`}>
                  <p className="whitespace-pre-wrap">{m.content}</p>

                  {/* Provider badge */}
                  {m.provider && m.provider !== 'none' && (
                    <p className="text-[9px] font-mono mt-1 opacity-60">{m.provider}/{m.model}</p>
                  )}

                  {/* Action cards */}
                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] font-semibold text-ink3">Proposed actions:</p>
                      {m.actions.map((a) => {
                        const isExecuting = executing.has(a.id);
                        return (
                          <div key={a.id} className="rounded-lg bg-lacquer-deep/50 p-2.5 text-xs space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-semibold text-accent">{TOOL_LABELS[a.tool] || a.tool}</span>
                              {a.destructive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-bad/10 text-bad font-semibold">⚠ Destructive</span>}
                            </div>
                            {a.reason && <p className="text-ink3">{a.reason}</p>}
                            <div className="font-mono text-[10px] text-ink3 break-all">{JSON.stringify(a.args)}</div>
                            <div className="flex gap-2 mt-1.5">
                              <button
                                className={`btn !text-[10px] !py-1 ${a.destructive ? 'bg-bad text-white' : 'bg-good text-lacquer-deep'}`}
                                disabled={isExecuting}
                                onClick={() => executeActions([a])}
                              >
                                {isExecuting ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />}
                                {isExecuting ? 'Running…' : 'Execute'}
                              </button>
                              <button className="btn btn-ghost !text-[10px] !py-1" onClick={() => cancelActions(a.id)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {/* Execute all button */}
                      {m.actions.length > 1 && (
                        <button className="btn btn-primary !text-[10px]" onClick={() => executeActions(m.actions!)} disabled={executing.size > 0}>
                          <Check size={11} /> Execute all {m.actions.length} actions
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-surface2 rounded-xl px-3 py-2 text-xs text-ink3 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((qa) => (
              <button key={qa.label} className="btn btn-ghost !text-[10px] !py-1 !px-2" onClick={() => send(qa.msg)}>
                {qa.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              className="input flex-1 !text-xs"
              placeholder="Ask the agent… (e.g. 'show me unreviewed posts')"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              disabled={busy}
            />
            <button className="btn btn-primary !text-xs" onClick={() => send()} disabled={busy || !input.trim()}>
              <Send size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
