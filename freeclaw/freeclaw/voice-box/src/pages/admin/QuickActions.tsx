import { useState, useEffect } from 'react';
import { Megaphone, Trash2, Send, Zap, CheckCircle2, Play, Inbox } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import type { PostData } from '../../types';

interface Announcement {
  text: string;
  kind: 'info' | 'success' | 'warning';
}

/** Broadcast announcement + one-click triage widget shown at top of admin dashboard */
export default function QuickActions({ posts, onStatusChange }: { posts: PostData[]; onStatusChange: (id: string, status: string) => void }) {
  const { toast } = useApp();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'info' | 'success' | 'warning'>('info');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/api/announcement').then(setAnnouncement).catch((e: unknown) => { console.warn('[QuickActions] Failed to load announcement:', e instanceof Error ? e.message : e); }); }, []);

  const publish = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ value: Announcement }>('/api/announcement', { text: text.trim(), kind });
      setAnnouncement(r.value); setText('');
      toast('Announcement is now live for everyone 📣', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
    setBusy(false);
  };

  const clear = async () => {
    try {
      await api.post('/api/announcement', { clear: true });
      setAnnouncement(null);
      toast('Announcement removed', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
  };

  // Triage queue: oldest unhandled reports first
  const triage = posts
    .filter((p) => p.type === 'problem' && !p.deleted && !p.hidden && p.status === 'reported')
    .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
    .slice(0, 4);

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      {/* Announcement broadcaster */}
      <div className="card p-4 vb-rise">
        <h2 className="font-display font-semibold text-sm flex items-center gap-1.5 mb-3"><Megaphone size={14} className="text-accent" /> Broadcast announcement</h2>
        {announcement ? (
          <div className={`rounded-xl px-3.5 py-3 text-sm flex items-start gap-2.5 ${announcement.kind === 'warning' ? 'bg-warn/10 text-warn' : announcement.kind === 'success' ? 'bg-good/10 text-good' : 'bg-accent-soft text-accent'}`}>
            <span className="flex-1">{announcement.text}</span>
            <button className="btn btn-ghost !p-1.5 shrink-0" onClick={clear} aria-label="Remove announcement" title="Remove"><Trash2 size={13} /></button>
          </div>
        ) : (
          <>
            <textarea className="input min-h-16 text-sm" placeholder="e.g. Library hours extended to 18:00 during exam weeks 🎉" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
            <div className="flex items-center gap-2 mt-2">
              <div className="inline-flex rounded-lg bg-surface2 p-0.5 gap-0.5">
                {(['info', 'success', 'warning'] as const).map((k) => (
                  <button key={k} onClick={() => setKind(k)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-all ${kind === k ? 'bg-surface shadow-sm ' + (k === 'warning' ? 'text-warn' : k === 'success' ? 'text-good' : 'text-accent') : 'text-ink3'}`}>
                    {k}
                  </button>
                ))}
              </div>
              <button className="btn btn-primary !py-1.5 !px-3 !text-xs ml-auto" onClick={publish} disabled={busy || !text.trim()}><Send size={12} /> Publish</button>
            </div>
            <p className="text-[10px] text-ink3 mt-2">Shown as a banner to every visitor until removed.</p>
          </>
        )}
      </div>

      {/* One-click triage */}
      <div className="card p-4 vb-rise" style={{ animationDelay: '60ms' }}>
        <h2 className="font-display font-semibold text-sm flex items-center gap-1.5 mb-3"><Zap size={14} className="text-warn" /> Needs triage <span className="chip !text-[10px] ml-1">{triage.length} waiting</span></h2>
        {triage.length === 0 ? (
          <div className="text-center py-5">
            <Inbox size={22} className="mx-auto text-good mb-1.5" />
            <p className="text-xs text-ink3">All caught up — no new reports waiting. ✨</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {triage.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1.5 border-b border-border last:border-0">
                <span className="text-sm font-medium truncate flex-1">{p.title}</span>
                <button className="btn btn-soft !py-1 !px-2 !text-[10px] shrink-0" onClick={() => onStatusChange(p.id, 'verified')}><CheckCircle2 size={11} /> Verify</button>
                <button className="btn !py-1 !px-2 !text-[10px] !bg-warn/12 !text-warn hover:!bg-warn/20 shrink-0" onClick={() => onStatusChange(p.id, 'in_progress')}><Play size={11} /> Start</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
