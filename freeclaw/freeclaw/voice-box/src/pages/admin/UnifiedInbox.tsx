import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Send, Bot, ChevronLeft, Loader2, ArrowLeftRight, Headphones,
  Shield, SmilePlus, CloudRain, Meh, AlertTriangle, Phone,
  Lock, Unlock, Sparkles, Plus, MessageSquare, Search, Copy, Check,
  Download, ArrowDown, X, Image as ImageIcon, Trash2,
} from 'lucide-react';
import { PromptDialog } from '../../components/ui';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { timeAgo, fmtDate } from '../../lib/utils';
import { useRealtime } from '../../lib/useRealtime';

/* ═══════════════════════════════════════════════════════════════
   HELPERS — Markdown, copy, download
   ═══════════════════════════════════════════════════════════════ */

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  };
  return (
    <button onClick={copy} className="p-1 rounded-md hover:bg-surface2 transition-colors" title="Copy">
      {copied ? <Check size={13} className="text-good" /> : <Copy size={13} className="text-ink3" />}
    </button>
  );
}

function DownloadButton({ url, filename }: { url: string; filename?: string }) {
  const download = async () => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || url.split('/').pop() || 'attachment';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { window.open(url, '_blank'); }
  };
  return (
    <button onClick={download} className="p-1 rounded-md hover:bg-surface2 transition-colors" title="Download">
      <Download size={13} className="text-ink3" />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EMOTION CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const EMOTION_ICONS: Record<string, any> = {
  critical: AlertTriangle, high: Phone, moderate: CloudRain, mild: Meh, none: SmilePlus,
};
const EMOTION_COLORS: Record<string, string> = {
  critical: 'text-red-500 bg-red-500/10 border-red-500/20',
  high: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
  moderate: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20',
  mild: 'text-green-500 bg-green-500/10 border-green-500/20',
  none: 'text-ink3 bg-surface2 border-border',
};
const EMOTION_LABELS: Record<string, string> = {
  critical: 'Crisis', high: 'High Distress', moderate: 'Moderate', mild: 'Mild', none: 'Neutral',
};

/* ═══════════════════════════════════════════════════════════════
   MESSAGE BUBBLE
   ═══════════════════════════════════════════════════════════════ */

function MessageBubble({ msg, isAdmin }: { msg: any; isAdmin: boolean }) {
  const htmlBody = useMemo(() => msg.body ? renderMarkdown(msg.body) : '', [msg.body]);

  return (
    <div className={`group flex ${isAdmin ? 'justify-end' : 'justify-start'} px-4 chat-msg-anim`}>
      <div className={`flex ${isAdmin ? 'flex-row-reverse' : 'flex-row'} items-end gap-2.5 max-w-[78%]`}>
        {!isAdmin && (
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mb-5 ${
            msg.sender === 'ai' ? 'bg-accent/10' : 'bg-surface2'
          }`}>
            {msg.sender === 'ai' ? <Bot size={14} className="text-accent" /> : <MessageSquare size={14} className="text-ink3" />}
          </div>
        )}

        <div className="flex flex-col gap-1">
          {!isAdmin && (
            <p className={`text-[10px] font-bold mb-0.5 flex items-center gap-1 ${
              msg.sender === 'ai' ? 'text-accent/70' : 'text-ink3'
            }`}>
              {msg.sender === 'admin' ? <><Shield size={10} /> ADMIN</> :
               msg.sender === 'ai' ? <><Bot size={10} /> AI ASSISTANT</> :
               'ANONYMOUS USER'}
            </p>
          )}

          {msg.attachment_url && (
            <div className={`rounded-xl overflow-hidden border border-border ${isAdmin ? 'rounded-br-md' : 'rounded-bl-md'}`}>
              {msg.attachment_url.match(/\.(png|jpg|jpeg|gif|webp)/i) ? (
                <img src={msg.attachment_url} alt="attachment" loading="lazy" className="max-h-48 object-cover" />
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 bg-surface2">
                  <ImageIcon size={14} className="text-ink3" />
                  <span className="text-xs text-ink2 truncate flex-1">{msg.attachment_url.split('/').pop()}</span>
                  <DownloadButton url={msg.attachment_url} />
                </div>
              )}
            </div>
          )}

          {msg.body && (
            <div
              className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                isAdmin
                  ? 'bg-accent text-white rounded-br-md'
                  : msg.sender === 'ai'
                    ? 'bg-surface2 border border-accent/10 rounded-bl-md'
                    : 'bg-surface2 rounded-bl-md border border-border/50'
              }`}
              dangerouslySetInnerHTML={{ __html: htmlBody }}
            />
          )}

          <div className={`flex items-center gap-1.5 ${isAdmin ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] text-ink3 opacity-0 group-hover:opacity-100 transition-opacity">
              {fmtDate(msg.created_at)}
            </span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton text={msg.body || ''} />
              {msg.attachment_url && <DownloadButton url={msg.attachment_url} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   THREAD ITEM — sidebar card
   ═══════════════════════════════════════════════════════════════ */

function ThreadItem({ t, active, onClick, onDelete }: {
  t: any; active: boolean; onClick: () => void; onDelete: () => void;
}) {
  const agent = t.source === 'inbox' ? (t.ai_agent || t.state?.agent || 'ai') : 'direct';
  const emotion = t.emotion?.level || t.state?.emotion?.level || 'none';
  const _EIcon = EMOTION_ICONS[emotion] || SmilePlus;

  return (
    <div
      className={`relative group border-b border-border/50 cursor-pointer transition-all ${
        active ? 'bg-accent/10 border-l-2 border-l-accent' : 'border-l-2 border-l-transparent hover:bg-surface2'
      }`}
      onClick={onClick}
    >
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
            agent === 'emotional' ? 'bg-blue-500/10' :
            agent === 'admin' ? 'bg-accent/10' :
            t.source === 'chat' ? 'bg-purple-500/10' : 'bg-surface2'
          }`}>
            {agent === 'emotional' ? <Headphones size={14} className="text-blue-500" /> :
             agent === 'admin' ? <Shield size={14} className="text-accent" /> :
             t.source === 'chat' ? <MessageSquare size={14} className="text-purple-500" /> :
             <Bot size={14} className="text-ink3" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ink truncate">{t.thread_id.slice(0, 20)}</span>
              {emotion !== 'none' && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${EMOTION_COLORS[emotion]}`}>
                  {EMOTION_LABELS[emotion]}
                </span>
              )}
              {t.status === 'closed' && <Lock size={10} className="text-ink3 flex-shrink-0" />}
              {t.source === 'chat' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-500 border border-purple-500/20">Chat</span>
              )}
            </div>
            <p className="text-[11px] text-ink3 truncate mt-0.5">{t.last_message || t.summary || 'No messages yet'}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-ink3">{timeAgo(t.updated_at || t.last_at)}</span>
              {agent !== 'admin' && agent !== 'direct' && (
                <span className="text-[10px] text-accent/70 flex items-center gap-0.5">
                  <Bot size={9} /> {agent === 'emotional' ? 'Emotional' : 'AI'} active
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            {t.unread > 0 && (
              <span className="w-5 h-5 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">{t.unread}</span>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-10 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
        title="Delete conversation"
      >
        <Trash2 size={12} className="text-red-400" />
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   UNIFIED INBOX — merged AdminInbox + AdminChat
   ═══════════════════════════════════════════════════════════════ */

const QUICK_REPLIES = [
  'Thanks for reaching out — we\'re looking into this now.',
  'Could you share more details (location, time, how often it happens)?',
  'This has been forwarded to the responsible staff member.',
  'Your issue has been verified and is now in progress. ✅',
  'This has been resolved — please let us know if it happens again.',
];

export default function UnifiedInbox() {
  const { toast } = useApp();

  const [threads, setThreads] = useState<any[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [threadState, setThreadState] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [threadSearch, setThreadSearch] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadsRef = useRef<any[]>([]);
  threadsRef.current = threads;

  const agent = threadState?.agent || 'ai';
  const emotion = threadState?.emotion_history?.[threadState.emotion_history.length - 1]?.level
    || threadState?.emotion?.level || 'none';
  const handoff = threadState?.handoff || false;
  const EIcon = EMOTION_ICONS[emotion] || SmilePlus;

  const filteredThreads = useMemo(() => {
    if (!threadSearch) return threads;
    const q = threadSearch.toLowerCase();
    return threads.filter((t) =>
      t.thread_id.toLowerCase().includes(q) ||
      (t.last_message || '').toLowerCase().includes(q) ||
      (t.summary || '').toLowerCase().includes(q)
    );
  }, [threads, threadSearch]);

  /* ── Load threads from BOTH APIs ──────────────────────── */
  const loadThreads = useCallback(async () => {
    try {
      const [inboxRes, chatRes] = await Promise.allSettled([
        api.get<any>('/api/inbox?threads=1'),
        api.get<any>('/api/chat?threads=1'),
      ]);

      const inboxThreads = inboxRes.status === 'fulfilled'
        ? (Array.isArray(inboxRes.value) ? inboxRes.value : (inboxRes.value?.threads || []))
        : [];
      const chatThreads = chatRes.status === 'fulfilled'
        ? (Array.isArray(chatRes.value) ? chatRes.value : [])
        : [];

      const merged = new Map<string, any>();
      for (const t of chatThreads) merged.set(t.thread_id, { ...t, source: 'chat' });
      for (const t of inboxThreads) merged.set(t.thread_id, { ...t, source: 'inbox' });

      const sorted = [...merged.values()].sort((a, b) => {
        const da = new Date(a.updated_at || a.last_at || 0).getTime();
        const db = new Date(b.updated_at || b.last_at || 0).getTime();
        return db - da;
      });

      setThreads(sorted);
    } catch (e: unknown) { console.warn('[UnifiedInbox] Failed to load threads:', e instanceof Error ? e.message : e); }
    setLoading(false);
  }, []);

  /* ── Load messages — source-aware ─────────────────────── */
  const loadMessages = useCallback(async (threadId: string) => {
    const t = threadsRef.current.find((x) => x.thread_id === threadId);
    const source = t?.source || 'inbox';

    try {
      if (source === 'chat') {
        const data = await api.get<{ messages: any[]; thread: any }>(`/api/chat?thread_id=${threadId}`);
        setMessages(data.messages || []);
        setThreadState({ ...data.thread, source: 'chat' });
        await api.put('/api/chat', { action: 'mark_read', thread_id: threadId, as: 'admin' });
      } else {
        const data = await api.get<{ messages?: any[]; state?: any }>(`/api/inbox?thread_id=${threadId}`);
        setMessages(data.messages || []);
        setThreadState({ ...(data.state || {}), source: 'inbox' });
      }
    } catch (e: unknown) { console.warn('[UnifiedInbox] Failed to load messages:', e instanceof Error ? e.message : e); }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { if (active) loadMessages(active); }, [active, loadMessages]);

  useEffect(() => {
    const id = setInterval(loadThreads, 12000);
    return () => clearInterval(id);
  }, [loadThreads]);

  // Single subscription covers both threads list and active message thread
  const threadRefreshRef = useRef(0);
  useRealtime(['chat_messages', 'chat_threads'], (table) => {
    loadThreads();
    const now = Date.now();
    if (active && table === 'chat_messages' && now - threadRefreshRef.current > 3000) {
      threadRefreshRef.current = now;
      loadMessages(active);
    }
  }, 2000);

  /* ── Auto-scroll ──────────────────────────────────────── */
  useEffect(() => {
    if (showScrollBtn) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, showScrollBtn]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight >= 80);
  };

  const onTextChange = (val: string) => {
    setText(val);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px';
    }
  };

  /* ── Send — source-aware ──────────────────────────────── */
  const send = async (body?: string) => {
    const msg = (body ?? text).trim();
    if (!msg || !active || sending) return;
    setSending(true);
    const t = threadsRef.current.find((x) => x.thread_id === active);
    const source = t?.source || 'inbox';
    try {
      if (source === 'chat') {
        await api.post('/api/chat', { thread_id: active, sender: 'admin', body: msg });
      } else {
        await api.post('/api/inbox', { thread_id: active, sender: 'admin', body: msg });
      }
      setText('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      await loadMessages(active);
      setShowScrollBtn(false);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to send', 'err'); }
    setSending(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  /* ── Actions (inbox) ──────────────────────────────────── */
  const doAction = async (action: string, extra?: any) => {
    if (!active) return;
    setActionBusy(action);
    try {
      await api.post('/api/inbox', { thread_id: active, action, ...extra });
      toast(`Action: ${action}`, 'ok');
      await loadMessages(active);
      await loadThreads();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Action failed', 'err'); }
    setActionBusy(null);
  };

  /* ── Status (chat) ────────────────────────────────────── */
  const setStatus = async (status: 'open' | 'closed') => {
    if (!active) return;
    try {
      await api.put('/api/chat', { action: 'set_status', thread_id: active, status });
      await loadMessages(active);
      await loadThreads();
      toast(`Conversation ${status}`, 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
  };

  /* ── AI suggest ───────────────────────────────────────── */
  const aiSuggest = async () => {
    if (!messages.length) { setText(QUICK_REPLIES[0] ?? ''); return; }
    setAiBusy(true);
    try {
      const r = await api.post<{ reply?: string; engine?: string }>('/api/assist', {
        task: 'chat_reply',
        messages: messages.map((m: any) => ({ sender: m.sender, body: m.body })),
      });
      if (r.reply) {
        setText(r.reply);
        toast(r.engine === 'keyword' ? 'Suggested reply (add ANTHROPIC_API_KEY for smarter AI)' : 'AI reply drafted — edit before sending', 'info');
        inputRef.current?.focus();
      }
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'AI suggest failed', 'err'); }
    setAiBusy(false);
  };

  /* ── New conversation ─────────────────────────────────── */
  const startNew = (anonId: string) => {
    const id = anonId.trim();
    if (!id) return;
    setActive(id);
    if (!threads.some((t) => t.thread_id === id)) {
      setThreads((prev) => [{
        thread_id: id, status: 'open', updated_at: new Date().toISOString(),
        last_message: '', last_at: new Date().toISOString(), unread: 0, source: 'chat',
      }, ...prev]);
    }
  };

  /* ── Delete thread ────────────────────────────────────── */
  const deleteThread = async (tid: string) => {
    if (!confirm('Delete this conversation?')) return;
    const t = threadsRef.current.find((x) => x.thread_id === tid);
    try {
      if (t?.source === 'chat') {
        await api.del('/api/chat', { thread_id: tid });
      } else {
        await api.post('/api/inbox', { thread_id: tid, action: 'close' });
      }
      setThreads((prev) => prev.filter((x) => x.thread_id !== tid));
      if (active === tid) { setActive(null); setMessages([]); setThreadState(null); }
      toast('Conversation removed', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
  };

  /* ── Export ────────────────────────────────────────────── */
  const exportChat = () => {
    if (!messages.length) return;
    const lines = messages.map((m: any) => {
      const sender = m.sender === 'admin' ? 'Admin' : m.sender === 'ai' ? 'AI' : 'User';
      return `[${fmtDate(m.created_at)}] ${sender}: ${m.body || '(attachment)'}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${active}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Chat exported', 'ok');
  };

  /* ── Global keyboard shortcuts ────────────────────────── */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.getElementById('inbox-search')?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="flex h-[calc(100vh-6rem)] gap-0 rounded-2xl border border-border overflow-hidden bg-surface">
      {/* ── Sidebar ──────────────────────────────────────── */}
      <div className={`${active ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 lg:w-96 shrink-0 border-r border-border bg-surface`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-display font-bold text-base flex items-center gap-2">
            <MessageSquare size={16} className="text-accent" /> Inbox
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">{threads.length}</span>
          </h2>
          <button className="btn btn-primary !text-xs !py-1.5" onClick={() => setShowNew(true)}>
            <Plus size={13} /> New
          </button>
        </div>

        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input id="inbox-search" className="input !text-xs !pl-8 !py-2 !rounded-lg"
              placeholder="Search… ( / )" value={threadSearch}
              onChange={(e) => setThreadSearch(e.target.value)} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="space-y-2 p-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>}
          {!loading && filteredThreads.length === 0 && (
            <div className="text-center py-12 px-4">
              <MessageSquare size={28} className="mx-auto text-ink3/40 mb-3" />
              <p className="text-xs text-ink3">{threadSearch ? 'No matching conversations' : 'No conversations yet'}</p>
              {!threadSearch && (
                <button className="btn btn-soft !text-xs mt-3" onClick={() => setShowNew(true)}>
                  <Plus size={12} /> Start one
                </button>
              )}
            </div>
          )}
          {filteredThreads.map((t) => (
            <ThreadItem key={t.thread_id} t={t} active={active === t.thread_id}
              onClick={() => { setActive(t.thread_id); setShowScrollBtn(false); }}
              onDelete={() => deleteThread(t.thread_id)} />
          ))}
        </div>
      </div>

      {/* ── Main chat area ───────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-w-0 ${!active ? 'hidden md:flex' : 'flex'}`}>
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
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-surface">
              <button className="md:hidden btn btn-ghost !p-1.5" onClick={() => setActive(null)}>
                <ChevronLeft size={18} />
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold truncate">{active}</span>
                  {emotion !== 'none' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${EMOTION_COLORS[emotion]}`}>
                      <EIcon size={10} /> {EMOTION_LABELS[emotion]}
                    </span>
                  )}
                  {threadState?.status === 'closed' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink3/10 text-ink3 border border-border flex items-center gap-1">
                      <Lock size={9} /> Closed
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[11px] flex items-center gap-1 ${
                    agent === 'admin' ? 'text-accent' : agent === 'emotional' ? 'text-blue-500' : 'text-ink3'
                  }`}>
                    {agent === 'admin' ? <><Shield size={10} /> Admin handling</> :
                     agent === 'emotional' ? <><Headphones size={10} /> Emotional agent</> :
                     agent === 'direct' ? <><MessageSquare size={10} /> Direct chat</> :
                     <><Bot size={10} /> AI assistant active</>}
                  </span>
                  {handoff && <span className="text-[10px] text-orange-500">⏳ Handoff pending</span>}
                  <span className="text-[10px] text-ink3">· {messages.length} messages</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowSearch(!showSearch)}
                  className={`p-2 rounded-lg transition-colors ${showSearch ? 'bg-accent-soft text-accent' : 'hover:bg-surface2 text-ink3'}`}
                  title="Search in chat">
                  <Search size={14} />
                </button>
                <button onClick={exportChat} className="btn btn-ghost !text-xs !py-1.5" title="Export">
                  <Download size={13} />
                </button>

                {threadState?.source !== 'chat' && agent !== 'admin' && (
                  <button onClick={() => doAction('takeover')} disabled={actionBusy === 'takeover'}
                    className="btn btn-primary !text-[11px] !py-1.5 !px-3">
                    {actionBusy === 'takeover' ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
                    <span className="ml-1">Take Over</span>
                  </button>
                )}
                {threadState?.source !== 'chat' && agent === 'admin' && (
                  <button onClick={() => doAction('release')} disabled={actionBusy === 'release'}
                    className="btn btn-ghost !text-[11px] !py-1.5 !px-3">
                    {actionBusy === 'release' ? <Loader2 size={12} className="animate-spin" /> : <ArrowLeftRight size={12} />}
                    <span className="ml-1">Release</span>
                  </button>
                )}
                {threadState?.source !== 'chat' && agent !== 'emotional' && (
                  <button onClick={() => doAction('transfer_emotional')} disabled={actionBusy === 'transfer_emotional'}
                    className="btn btn-ghost !text-[11px] !py-1.5 !px-3 text-blue-500">
                    {actionBusy === 'transfer_emotional' ? <Loader2 size={12} className="animate-spin" /> : <Headphones size={12} />}
                  </button>
                )}

                {threadState?.source === 'chat' && (
                  threadState?.status === 'closed'
                    ? <button className="btn btn-soft !text-xs !py-1.5" onClick={() => setStatus('open')}><Unlock size={12} /> Reopen</button>
                    : <button className="btn btn-ghost !text-xs !py-1.5" onClick={() => setStatus('closed')}><Lock size={12} /> Close</button>
                )}
              </div>
            </div>

            {/* Search bar */}
            {showSearch && (
              <div className="px-5 py-2 border-b border-border bg-surface2/50 flex items-center gap-2 chat-msg-anim">
                <Search size={13} className="text-ink3" />
                <input className="input !text-xs !py-1.5 !rounded-lg flex-1" placeholder="Search in this conversation…"
                  value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
                <button onClick={() => { setShowSearch(false); setSearch(''); }} className="p-1 rounded-md hover:bg-surface2">
                  <X size={12} className="text-ink3" />
                </button>
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-4 space-y-4 scroll-smooth">
              {messages.length === 0 && (
                <div className="flex-1 flex items-center justify-center h-full">
                  <p className="text-xs text-ink3">No messages yet — say hello! 👋</p>
                </div>
              )}
              {messages
                .filter((m: any) => !search || (m.body || '').toLowerCase().includes(search.toLowerCase()))
                .map((m: any) => <MessageBubble key={m.id} msg={m} isAdmin={m.sender === 'admin'} />)
              }
              <div ref={bottomRef} />
            </div>

            {/* Scroll to bottom */}
            {showScrollBtn && (
              <div className="flex justify-center -mt-8 mb-2 relative z-10">
                <button onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowScrollBtn(false); }}
                  className="w-9 h-9 rounded-full bg-surface border border-border shadow-lg flex items-center justify-center hover:bg-surface2 transition-colors">
                  <ArrowDown size={14} className="text-ink2" />
                </button>
              </div>
            )}

            {/* Input */}
            <div className="border-t border-border bg-surface px-4 py-3">
              <div className="flex gap-1.5 overflow-x-auto pb-2.5 scrollbar-none">
                <button className="chip shrink-0 cursor-pointer !text-accent hover:!border-accent disabled:opacity-50 !py-1"
                  onClick={aiSuggest} disabled={aiBusy}>
                  {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {aiBusy ? 'Thinking…' : 'AI suggest'}
                </button>
                {QUICK_REPLIES.slice(0, 4).map((q) => (
                  <button key={q} className="chip shrink-0 cursor-pointer hover:border-accent !py-1 !text-[11px]"
                    onClick={() => { setText(q); inputRef.current?.focus(); }}>
                    {q.slice(0, 40)}
                  </button>
                ))}
              </div>

              <div className="flex items-end gap-2 bg-surface2 rounded-2xl border border-border px-3 py-2">
                <textarea ref={inputRef}
                  className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-ink placeholder:text-ink3 max-h-40"
                  placeholder={agent === 'admin' ? 'Reply as admin…' : 'Type a message… (Shift+Enter for new line)'}
                  value={text} onChange={(e) => onTextChange(e.target.value)} onKeyDown={onKeyDown}
                  rows={1} maxLength={2000} />
                <button className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center flex-shrink-0 transition-all hover:bg-accent2 disabled:opacity-30 disabled:cursor-not-allowed"
                  onClick={() => send()} disabled={!text.trim() || sending}>
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
              <p className="text-[9px] text-ink3 mt-1.5 px-1">{text.length > 0 && `${text.length}/2000`}</p>
            </div>
          </>
        )}
      </div>

      <PromptDialog open={showNew} onClose={() => setShowNew(false)} onSubmit={startNew}
        title="Start new conversation" label="Anonymous user ID"
        placeholder="anon_xxxxxxxxxxxx" submitLabel="Open chat" />
    </div>
  );
}
