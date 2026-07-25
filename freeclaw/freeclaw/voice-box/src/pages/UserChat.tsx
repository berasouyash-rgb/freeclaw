import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, ShieldCheck, MessageSquare, ImagePlus, Bot, Heart, Loader2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import { fmtDate, sanitize } from '../lib/utils';
import { useRealtime } from '../lib/useRealtime';
import type { ChatMessage } from '../types';

interface InboxResponse { messages: ChatMessage[]; thread: { thread_id: string; status: string }; state?: { agent?: string } }

export default function UserChat() {
  const { anonId, toast, setChatUnread } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thread, setThread] = useState<{ thread_id: string; status: string } | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [agentLabel, setAgentLabel] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      // Use inbox API for AI-powered replies
      const data = await api.get<InboxResponse>(`/api/inbox?thread_id=${anonId}`);
      const newMsgs = data.messages || [];
      // Deduplicate by message id to prevent realtime + polling collisions
      setMessages((prev: ChatMessage[]) => {
        const seen = new Set(prev.map((m) => m.id));
        const deduped = [...prev.filter((m) => m.id && seen.has(m.id))];
        for (const m of newMsgs) {
          if (m.id && !seen.has(m.id)) deduped.push(m);
        }
        deduped.sort((a: ChatMessage, b: ChatMessage) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
        return deduped;
      });
      setThread(data.thread);
      if (data.state?.agent) {
        setAgentLabel(data.state.agent === 'emotional' ? '💙 Emotional Support Agent' : data.state.agent === 'admin' ? '👤 Admin' : '🤖 AI Assistant');
      }
      await api.put('/api/inbox', { action: 'mark_read', thread_id: anonId, as: 'user' });
      setChatUnread(0);
    } catch {
      // Fallback to old chat API
      try {
        const data = await api.get<InboxResponse>(`/api/chat?thread_id=${anonId}`);
        setMessages(data.messages); setThread(data.thread);
        await api.put('/api/chat', { action: 'mark_read', thread_id: anonId, as: 'user' });
        setChatUnread(0);
      } catch { /* offline ok */ }
    }
    setLoading(false);
  }, [anonId, setChatUnread]);

  useEffect(() => { load(); }, [load]);

  // Admin messages arrive instantly via realtime — increased debounce to prevent duplicates
  useRealtime(['chat_messages'], () => load(), 3000);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async (attachment_url?: string) => {
    const body = sanitize(text, 2000);
    if (!body && !attachment_url) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setBusy(true);
    setTyping(true);
    setText(''); // Clear input immediately for instant UX

    try {
      const result = await api.post<{ message?: ChatMessage; auto_reply?: ChatMessage; emotion?: { level?: string } }>('/api/inbox', {
        thread_id: anonId, sender: 'user', body, attachment_url,
      });

      // Show agent indicator
      if (result.emotion?.level && result.emotion.level !== 'none') {
        const labels: Record<string, string> = {
          critical: '🔴 Crisis Support Agent activated',
          high: '🟠 Emotional Support Agent activated',
          moderate: '🟡 Support Agent activated',
          mild: '🟢 Support Agent online',
        };
        setAgentLabel(labels[result.emotion.level] || '🤖 AI Assistant');
      }

      await load();
    } catch {
      try {
        await api.post('/api/chat', { thread_id: anonId, sender: 'user', body, attachment_url });
        await load();
      } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Send failed', 'err'); }
    }
    setBusy(false);
    setTyping(false);
    sendingRef.current = false;
  };

  const attach = (f: File) => {
    if (f.size > 3 * 1024 * 1024) { toast('Image must be under 3 MB', 'err'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const b64 = (reader.result as string).split(',')[1] ?? '';
        const url = await api.uploadImage(b64, f.type, anonId);
        await send(url);
      } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Upload failed', 'err'); }
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-8.5rem)] lg:h-[calc(100vh-7rem)]">
      <div className="mb-3">
        <h1 className="font-display font-bold text-2xl flex items-center gap-2"><MessageSquare className="text-accent" size={22} /> Anonymous Inbox</h1>
        <p className="text-sm text-ink3">
          Chat directly — our AI assistant responds instantly. An admin will join when available.
          {thread?.status === 'closed' && ' · This conversation was closed by admin.'}
        </p>
      </div>

      {/* Agent indicator banner */}
      {agentLabel && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-xs text-accent mb-3 animate-in slide-in-from-top-1">
          {agentLabel.includes('Crisis') || agentLabel.includes('Emotional') ? <Heart size={13} /> : <Bot size={13} />}
          <span className="font-medium">{agentLabel}</span>
          <span className="text-ink3 ml-auto">Responding instantly</span>
        </div>
      )}

      <div className="card flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="skeleton h-12 w-2/3" />)}</div>}
        {!loading && messages.length === 0 && (
          <div className="text-center py-14">
            <p className="text-3xl mb-2">💌</p>
            <p className="font-display font-semibold text-sm">No messages yet</p>
            <p className="text-xs text-ink3 mt-1">Send a message to reach the support team anonymously. Our AI responds instantly.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
              m.sender === 'user'
                ? 'bg-accent text-white rounded-br-md'
                : m.sender === 'ai'
                  ? 'bg-surface2 border border-accent/10 rounded-bl-md'
                  : 'bg-surface2 rounded-bl-md'
            }`}>
              {m.sender === 'admin' && (
                <p className="text-[10px] font-bold flex items-center gap-1 text-accent mb-0.5">
                  <ShieldCheck size={10} /> ADMIN
                </p>
              )}
              {m.sender === 'ai' && (
                <p className="text-[10px] font-bold flex items-center gap-1 text-accent/70 mb-0.5">
                  <Bot size={10} /> AI ASSISTANT
                </p>
              )}
              {m.attachment_url && <img src={m.attachment_url} alt="attachment" loading="lazy" className="rounded-lg mb-1.5 max-h-48" />}
              {m.body && <p className="prose-desc">{m.body}</p>}
              <p className={`text-[9px] mt-1 ${m.sender === 'user' ? 'text-white/60' : 'text-ink3'}`}>{fmtDate(m.created_at ?? '')}</p>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {typing && (
          <div className="flex justify-start">
            <div className="bg-surface2 rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-2">
              <Loader2 size={13} className="text-accent animate-spin" />
              <span className="text-xs text-ink3">AI is typing...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 mt-3">
        <button className="btn btn-ghost !px-3" onClick={() => fileRef.current?.click()} aria-label="Attach image"><ImagePlus size={16} /></button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
        <input className="input" placeholder="Message the support team…" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()} maxLength={2000} aria-label="Chat message" />
        <button className="btn btn-primary !px-4" onClick={() => send()} disabled={busy || !text.trim()} aria-label="Send">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </div>
  );
}
