import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, ShieldCheck, MessageSquare, ImagePlus } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import { fmtDate, sanitize } from '../lib/utils';
import { useRealtime } from '../lib/useRealtime';

export default function UserChat() {
  const { anonId, toast, setChatUnread } = useApp();
  const [messages, setMessages] = useState<any[]>([]);
  const [thread, setThread] = useState<any>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/api/chat?thread_id=${anonId}`);
      setMessages(data.messages); setThread(data.thread);
      await api.put('/api/chat', { action: 'mark_read', thread_id: anonId, as: 'user' });
      setChatUnread(0); // clear nav badge immediately — don't wait for next poll
    } catch { /* offline ok */ }
    setLoading(false);
  }, [anonId, setChatUnread]);

  useEffect(() => { load(); }, [load]);

  // 🔴 admin messages arrive instantly — no polling delay
  useRealtime(['chat_messages'], () => load(), 200);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async (attachment_url?: string) => {
    const body = sanitize(text, 1000);
    if (!body && !attachment_url) return;
    setBusy(true);
    try {
      await api.post('/api/chat', { thread_id: anonId, sender: 'user', body, attachment_url });
      setText(''); await load();
    } catch (e: any) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const attach = (f: File) => {
    if (f.size > 3 * 1024 * 1024) { toast('Image must be under 3 MB', 'err'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const b64 = (reader.result as string).split(',')[1];
        const url = await api.uploadImage(b64, f.type, anonId);
        await send(url);
      } catch (e: any) { toast(e.message, 'err'); }
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-8.5rem)] lg:h-[calc(100vh-7rem)]">
      <div className="mb-3">
        <h1 className="font-display font-bold text-2xl flex items-center gap-2"><MessageSquare className="text-accent" size={22} /> Anonymous Inbox</h1>
        <p className="text-sm text-ink3">Chat directly with school admins. They only see your anonymous ID — never who you are.{thread?.status === 'closed' && ' · This conversation was closed by admin; sending a message reopens it.'}</p>
      </div>

      <div className="card flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="skeleton h-12 w-2/3" />)}</div>}
        {!loading && messages.length === 0 && (
          <div className="text-center py-14">
            <p className="text-3xl mb-2">💌</p>
            <p className="font-display font-semibold text-sm">No messages yet</p>
            <p className="text-xs text-ink3 mt-1">Send a message to reach the admin team anonymously.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${m.sender === 'user' ? 'bg-accent text-white rounded-br-md' : 'bg-surface2 rounded-bl-md'}`}>
              {m.sender === 'admin' && <p className="text-[10px] font-bold flex items-center gap-1 text-accent mb-0.5"><ShieldCheck size={10} /> ADMIN</p>}
              {m.attachment_url && <img src={m.attachment_url} alt="attachment" loading="lazy" className="rounded-lg mb-1.5 max-h-48" />}
              {m.body && <p className="prose-desc">{m.body}</p>}
              <p className={`text-[9px] mt-1 ${m.sender === 'user' ? 'text-white/60' : 'text-ink3'}`}>{fmtDate(m.created_at)}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 mt-3">
        <button className="btn btn-ghost !px-3" onClick={() => fileRef.current?.click()} aria-label="Attach image"><ImagePlus size={16} /></button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
        <input className="input" placeholder="Message the admin team…" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()} maxLength={1000} aria-label="Chat message" />
        <button className="btn btn-primary !px-4" onClick={() => send()} disabled={busy || !text.trim()} aria-label="Send"><Send size={15} /></button>
      </div>
    </div>
  );
}
