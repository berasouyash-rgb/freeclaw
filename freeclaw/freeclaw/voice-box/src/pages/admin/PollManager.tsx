import { useState, useEffect, useCallback } from 'react';
import { Archive, Trash2, RotateCcw, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { timeAgo } from '../../lib/utils';
import { ConfirmDialog } from '../../components/ui';

export default function PollManager() {
  const { toast } = useApp();
  const [polls, setPolls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [ptype, setPtype] = useState<'yesno' | 'single' | 'multi'>('yesno');
  const [opts, setOpts] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPolls(await api.get('/api/polls')); } catch (e: any) { toast(e.message, 'err'); }
    setLoading(false);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      await api.post('/api/polls', { title, ptype, options: opts.split('\n').map((o) => o.trim()).filter(Boolean), author_id: 'ADMIN' });
      setShowNew(false); setTitle(''); setOpts(''); load(); toast('Poll created', 'ok');
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const setArchived = async (id: string, archived: boolean) => {
    try { await api.put('/api/polls', { id, archived }); load(); } catch (e: any) { toast(e.message, 'err'); }
  };
  const del = async (id: string) => {
    try { await api.del('/api/polls', { id }); load(); toast('Deleted', 'ok'); } catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-xl">Poll manager</h1>
        <button className="btn btn-primary !text-xs" onClick={() => setShowNew((s) => !s)}><Plus size={14} /> New poll</button>
      </div>

      {showNew && (
        <div className="card p-4 mb-4 space-y-3 vb-rise">
          <input className="input" placeholder="Poll question" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
          <div className="flex gap-2">
            {([['yesno', 'Yes/No'], ['single', 'Single'], ['multi', 'Multi']] as const).map(([k, l]) => (
              <button key={k} className={`btn !text-xs flex-1 ${ptype === k ? 'btn-soft' : 'btn-ghost'}`} onClick={() => setPtype(k)}>{l}</button>
            ))}
          </div>
          {ptype !== 'yesno' && <textarea className="input min-h-20" placeholder="One option per line (2–10)" value={opts} onChange={(e) => setOpts(e.target.value)} />}
          <button className="btn btn-primary !text-xs" onClick={create} disabled={title.trim().length < 5}>Publish poll</button>
        </div>
      )}

      {loading ? <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-16" />)}</div> : (
        <div className="space-y-2.5">
          {polls.map((p) => (
            <div key={p.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{p.title} {p.archived && <span className="chip !text-[10px] ml-1">archived</span>}</p>
                  <p className="text-xs text-ink3 mt-0.5">{p.ptype} · {p.total_votes} votes · created {timeAgo(p.created_at)} {p.post_id && '· linked to complaint'}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button className="btn btn-ghost !p-2" onClick={() => setArchived(p.id, !p.archived)} title={p.archived ? 'Restore' : 'Archive'}>{p.archived ? <RotateCcw size={14} /> : <Archive size={14} />}</button>
                  <button className="btn btn-danger !p-2" onClick={() => setDeleteId(p.id)} title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
              {/* results history */}
              <div className="mt-3 space-y-1.5">
                {(p.options || []).map((o: string, i: number) => {
                  const n = p.vote_counts?.[i] || 0;
                  const pct = p.total_votes ? Math.round((n / p.total_votes) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-32 truncate">{o}</span>
                      <div className="flex-1 h-2.5 rounded bg-surface2 overflow-hidden"><div className="h-full bg-accent vb-bar-anim" style={{ width: `${pct}%` }} /></div>
                      <span className="font-mono w-14 text-right">{pct}% · {n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {polls.length === 0 && <p className="card p-8 text-center text-sm text-ink3">No polls yet.</p>}
        </div>
      )}
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del(deleteId)}
        title="Delete poll?" message="The poll and all of its votes will be permanently removed. This cannot be undone." confirmLabel="Delete poll" danger />
    </div>
  );
}
