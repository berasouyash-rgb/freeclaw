import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Send, Lock, Unlock, Sparkles, Plus, MessageSquare, Search,
  Copy, Check, Download, ArrowDown, MoreVertical, Trash2,
  Image as ImageIcon, X, Loader2,
} from 'lucide-react';
import { PromptDialog } from '../../components/ui';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { timeAgo, fmtDate } from '../../lib/utils';
import { useRealtime } from '../../lib/useRealtime';

/* ── Simple markdown renderer ─────────────────────────────── */
/** Escape HTML entities to prevent XSS via dangerouslySetInnerHTML */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(text: string): string {
  // Escape HTML first to prevent injection, then apply markdown transformations
  let html = escapeHtml(text)
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Blockquotes
    .replace(/^>\s*(.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-accent underline">$1</a>')
    // Line breaks (preserve double newlines as paragraphs)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');
  // Wrap in paragraph if no block elements
  if (!html.startsWith('<pre>') && !html.startsWith('<ul>') && !html.startsWith('<blockquote>')) {
    html = `<p>${html}</p>`;
  }
  return html;
}

/* ── Copy-to-clipboard button ──────────────────────────────── */
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
    <button onClick={copy} className="copy-btn p-1.5 rounded-md hover:bg-surface2 transition-colors" title="Copy message">
      {copied ? <Check size={13} className="text-good" /> : <Copy size={13} className="text-ink3" />}
    </button>
  );
}

/* ── Download attachment ───────────────────────────────────── */
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
    <button onClick={download} className="copy-btn p-1.5 rounded-md hover:bg-surface2 transition-colors" title="Download">
      <Download size={13} className="text-ink3" />
    </button>
  );
}

/* ── Typing indicator ──────────────────────────────────────── */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 chat-msg-anim px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center flex-shrink-0">
        <Sparkles size={14} className="text-accent" />
      </div>
      <div className="bg-surface2 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
        <span className="typing-dot w-2 h-2 rounded-full bg-ink3" />
        <span className="typing-dot w-2 h-2 rounded-full bg-ink3" />
        <span className="typing-dot w-2 h-2 rounded-full bg-ink3" />
      </div>
    </div>
  );
}

/* ── Single message bubble ─────────────────────────────────── */
function MessageBubble({ msg, isAdmin }: { msg: any; isAdmin: boolean }) {
  const htmlBody = useMemo(() => msg.body ? renderMarkdown(msg.body) : '', [msg.body]);

  return (
    <div className={`chat-msg-wrap group flex ${isAdmin ? 'justify-end' : 'justify-start'} chat-msg-anim px-4`}>
      <div className={`flex ${isAdmin ? 'flex-row-reverse' : 'flex-row'} items-end gap-2.5 max-w-[78%]`}>
        {/* Avatar */}
        {!isAdmin && (
          <div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center flex-shrink-0 mb-5">
            <Sparkles size={14} className="text-accent" />
          </div>
        )}

        <div className="flex flex-col gap-1">
          {/* Attachment */}
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

          {/* Message body */}
          {msg.body && (
            <div
              className={`chat-msg rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                isAdmin
                  ? 'bg-accent text-white rounded-br-md'
                  : 'bg-surface2 text-ink rounded-bl-md border border-border/50'
              }`}
              dangerouslySetInnerHTML={{ __html: htmlBody }}
            />
          )}

          {/* Timestamp + actions */}
          <div className={`flex items-center gap-1.5 ${isAdmin ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] text-ink3 opacity-0 group-hover:opacity-100 transition-opacity">{fmtDate(msg.created_at)}</span>
            <div className="msg-actions flex items-center gap-0.5">
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
   MAIN — Premium Admin Chat (ChatGPT/Claude-tier)
   ═══════════════════════════════════════════════════════════════ */
export default function AdminChat() {
  const { toast } = useApp();
  const [threads, setThreads] = useState<any[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [thread, setThread] = useState<any>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const QUICK_REPLIES = [
    'Thanks for reaching out — we\'re looking into this now.',
    'Could you share more details (location, time, how often it happens)?',
    'This has been forwarded to the responsible staff member.',
    'Your issue has been verified and is now in progress. ✅',
    'This has been resolved — please let us know if it happens again.',
  ];

  // Deep-link
  useEffect(() => {
    const target = sessionStorage.getItem('vb:adminChatTarget');
    if (target) { setActive(target); sessionStorage.removeItem('vb:adminChatTarget'); }
  }, []);

  const loadThreads = useCallback(async () => {
    try { setThreads(await api.get('/api/chat?threads=1')); } catch { /* */ }
    setLoading(false);
  }, []);

  const loadMessages = useCallback(async (tid: string) => {
    try {
      const data = await api.get(`/api/chat?thread_id=${tid}`);
      setMessages(data.messages); setThread(data.thread);
      await api.put('/api/chat', { action: 'mark_read', thread_id: tid, as: 'admin' });
      loadThreads();
    } catch { /* */ }
  }, [loadThreads]);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { if (active) loadMessages(active); }, [active, loadMessages]);

  // Realtime
  useRealtime(['chat_messages', 'chat_threads'], () => {
    loadThreads();
    if (active) loadMessages(active);
  }, 200);

  // Auto-scroll
  useEffect(() => {
    if (showScrollBtn) return; // don't jump if user scrolled up
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, showScrollBtn]);

  // Scroll detection
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setShowScrollBtn(!atBottom);
  };

  // Auto-resize textarea
  const onTextChange = (val: string) => {
    setText(val);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px';
    }
  };

  // Send message
  const send = async (body?: string) => {
    const msg = (body ?? text).trim();
    if (!msg || !active || sending) return;
    setSending(true);
    try {
      await api.post('/api/chat', { thread_id: active, sender: 'admin', body: msg });
      setText('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      await loadMessages(active);
      setShowScrollBtn(false);
    } catch (e: any) { toast(e.message, 'err'); }
    setSending(false);
    inputRef.current?.focus();
  };

  // Keyboard shortcut: Enter to send, Shift+Enter for newline
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Thread status
  const setStatus = async (status: 'open' | 'closed') => {
    if (!active) return;
    try {
      await api.put('/api/chat', { action: 'set_status', thread_id: active, status });
      await loadMessages(active);
      toast(`Conversation ${status}`, 'ok');
    } catch (e: any) { toast(e.message, 'err'); }
  };

  // AI suggest
  const aiSuggest = async () => {
    if (!messages.length) { setText(QUICK_REPLIES[0]); return; }
    setAiBusy(true);
    try {
      const r = await api.post('/api/assist', {
        task: 'chat_reply',
        messages: messages.map((m) => ({ sender: m.sender, body: m.body })),
      });
      if (r.reply) {
        setText(r.reply);
        toast(r.engine === 'keyword' ? 'Suggested reply (add ANTHROPIC_API_KEY for smarter AI)' : 'AI reply drafted — edit before sending', 'info');
        inputRef.current?.focus();
      }
    } catch (e: any) { toast(e.message, 'err'); }
    setAiBusy(false);
  };

  // Start new conversation
  const startNew = (anonId: string) => {
    const id = anonId.trim();
    if (!id) return;
    setActive(id);
    if (!threads.some((t) => t.thread_id === id)) {
      setThreads((prev) => [{ thread_id: id, status: 'open', updated_at: new Date().toISOString(), last_message: '', last_at: new Date().toISOString(), unread: 0 }, ...prev]);
    }
  };

  // Delete thread
  const deleteThread = async (tid: string) => {
    if (!confirm('Delete this conversation?')) return;
    try {
      await api.del('/api/chat', { thread_id: tid });
      setThreads((prev) => prev.filter((t) => t.thread_id !== tid));
      if (active === tid) { setActive(null); setMessages([]); setThread(null); }
      toast('Conversation deleted', 'ok');
    } catch (e: any) { toast(e.message, 'err'); }
  };

  // Filter threads by search
  const filteredThreads = useMemo(() => {
    if (!search) return threads;
    const q = search.toLowerCase();
    return threads.filter((t) =>
      t.thread_id.toLowerCase().includes(q) ||
      (t.last_message || '').toLowerCase().includes(q)
    );
  }, [threads, search]);

  // Export conversation
  const exportChat = () => {
    if (!messages.length) return;
    const lines = messages.map((m) => {
      const sender = m.sender === 'admin' ? 'Admin' : 'User';
      const time = fmtDate(m.created_at);
      return `[${time}] ${sender}: ${m.body || '(attachment)'}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${active}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Chat exported', 'ok');
  };

  return (
    <div className="h-[calc(100vh-6rem)]">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-xl flex items-center gap-2">
          <MessageSquare size={20} className="text-accent" /> Chat
        </h1>
        <div className="flex gap-2">
          {active && (
            <button onClick={exportChat} className="btn btn-ghost !text-xs !py-1.5">
              <Download size={13} /> Export
            </button>
          )}
          <button className="btn btn-primary !text-xs !py-1.5" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New
          </button>
        </div>
      </div>

      <div className="flex h-[calc(100%-3.5rem)] gap-0 rounded-2xl border border-border overflow-hidden bg-surface">
        {/* ── Sidebar: Thread List ──────────────────────────── */}
        <div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-surface">
          {/* Search */}
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                className="input !text-xs !pl-8 !py-2 !rounded-lg"
                placeholder="Search conversations…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="space-y-2 p-3">
                {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
              </div>
            )}
            {!loading && filteredThreads.length === 0 && (
              <div className="text-center py-12 px-4">
                <MessageSquare size={28} className="mx-auto text-ink3/40 mb-3" />
                <p className="text-xs text-ink3">
                  {search ? 'No matching conversations' : 'No conversations yet'}
                </p>
                {!search && (
                  <button className="btn btn-soft !text-xs mt-3" onClick={() => setShowNew(true)}>
                    <Plus size={12} /> Start one
                  </button>
                )}
              </div>
            )}
            {filteredThreads.map((t) => (
              <div
                key={t.thread_id}
                className={`thread-item relative group border-b border-border/50 cursor-pointer ${
                  active === t.thread_id ? 'active border-l-2 border-l-accent' : ''
                }`}
                onClick={() => setActive(t.thread_id)}
              >
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-accent-soft flex items-center justify-center flex-shrink-0">
                      <MessageSquare size={14} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-ink truncate">{t.thread_id.slice(0, 18)}</span>
                        {t.status === 'closed' && <Lock size={10} className="text-ink3 flex-shrink-0" />}
                      </div>
                      <p className="text-[11px] text-ink3 truncate mt-0.5">{t.last_message || 'No messages yet'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[9px] text-ink3">{timeAgo(t.last_at)}</span>
                      {t.unread > 0 && (
                        <span className="w-5 h-5 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">
                          {t.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Delete on hover */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteThread(t.thread_id); }}
                  className="absolute top-3 right-10 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
                  title="Delete conversation"
                >
                  <Trash2 size={12} className="text-red-400" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Main: Chat Area ──────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
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
              {/* Thread header */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-surface">
                <div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center">
                  <MessageSquare size={14} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-ink truncate">{active}</p>
                  <p className="text-[10px] text-ink3">
                    {thread?.status === 'closed' ? '🔒 Closed' : '🟢 Open'} · {messages.length} messages
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setShowSearch(!showSearch)} className={`p-2 rounded-lg transition-colors ${showSearch ? 'bg-accent-soft text-accent' : 'hover:bg-surface2 text-ink3'}`} title="Search in chat">
                    <Search size={14} />
                  </button>
                  {thread?.status === 'closed'
                    ? <button className="btn btn-soft !text-xs !py-1.5" onClick={() => setStatus('open')}><Unlock size={12} /> Reopen</button>
                    : <button className="btn btn-ghost !text-xs !py-1.5" onClick={() => setStatus('closed')}><Lock size={12} /> Close</button>}
                </div>
              </div>

              {/* Search bar */}
              {showSearch && (
                <div className="px-5 py-2 border-b border-border bg-surface2/50 flex items-center gap-2 chat-msg-anim">
                  <Search size={13} className="text-ink3" />
                  <input
                    className="input !text-xs !py-1.5 !rounded-lg flex-1"
                    placeholder="Search in this conversation…"
                    autoFocus
                  />
                  <button onClick={() => setShowSearch(false)} className="p-1 rounded-md hover:bg-surface2">
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
                {messages.map((m) => (
                  <MessageBubble key={m.id} msg={m} isAdmin={m.sender === 'admin'} />
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Scroll to bottom button */}
              {showScrollBtn && (
                <div className="flex justify-center -mt-8 mb-2 relative z-10">
                  <button
                    onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowScrollBtn(false); }}
                    className="scroll-btn-anim w-9 h-9 rounded-full bg-surface border border-border shadow-lg flex items-center justify-center hover:bg-surface2 transition-colors"
                  >
                    <ArrowDown size={14} className="text-ink2" />
                  </button>
                </div>
              )}

              {/* Quick replies + input */}
              <div className="border-t border-border bg-surface px-4 py-3">
                {/* Quick reply pills */}
                <div className="flex gap-1.5 overflow-x-auto pb-2.5 scrollbar-none">
                  <button
                    className="chip shrink-0 cursor-pointer !text-accent hover:!border-accent disabled:opacity-50 !py-1"
                    onClick={aiSuggest}
                    disabled={aiBusy}
                  >
                    {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    {aiBusy ? 'Thinking…' : 'AI suggest'}
                  </button>
                  {QUICK_REPLIES.slice(0, 4).map((q) => (
                    <button
                      key={q}
                      className="chip shrink-0 cursor-pointer hover:border-accent !py-1 !text-[11px]"
                      onClick={() => { setText(q); inputRef.current?.focus(); }}
                    >
                      {q.slice(0, 40)}
                    </button>
                  ))}
                </div>

                {/* Input area */}
                <div className="chat-input-wrap flex items-end gap-2 bg-surface2 rounded-2xl border border-border px-3 py-2">
                  <textarea
                    ref={inputRef}
                    className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-ink placeholder:text-ink3 max-h-40"
                    placeholder="Type a message… (Shift+Enter for new line)"
                    value={text}
                    onChange={(e) => onTextChange(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    maxLength={2000}
                  />
                  <button
                    className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center flex-shrink-0 transition-all hover:bg-accent2 disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => send()}
                    disabled={!text.trim() || sending}
                  >
                    {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  </button>
                </div>
                <p className="text-[9px] text-ink3 mt-1.5 px-1">
                  {text.length > 0 && `${text.length}/2000`}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <PromptDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onSubmit={startNew}
        title="Start new conversation"
        label="Anonymous user ID"
        placeholder="anon_xxxxxxxxxxxx"
        submitLabel="Open chat"
      />
    </div>
  );
}
