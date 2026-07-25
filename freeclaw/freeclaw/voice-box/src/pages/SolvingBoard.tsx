import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { KanbanSquare } from 'lucide-react';
import PurgeCountdown from '../components/PurgeCountdown';
import { api } from '../lib/api';
import { useRealtime } from '../lib/useRealtime';
import { STATUS_META, CAT_EMOJI, timeAgo } from '../lib/utils';

const COLUMNS = ['reported', 'verified', 'in_progress', 'waiting', 'solved', 'archived'];

export default function SolvingBoard() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setError(''); setPosts(await api.get('/api/posts?type=problem')); }
    catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Real-time: cards should move between columns when admin changes status
  useRealtime(['posts'], useCallback(() => { load(); }, [load]), 1200);

  return (
    <div>
      <h1 className="font-display font-bold text-2xl flex items-center gap-2 mb-1"><KanbanSquare className="text-accent" size={24} /> Public Solving Board</h1>
      <p className="text-sm text-ink3 mb-6">Full transparency — track every reported issue from submission to resolution.</p>

      {error && <div className="card p-6 text-center"><p className="text-bad text-sm">{error}</p><button className="btn btn-soft mt-3" onClick={() => { setLoading(true); load(); }}>Retry</button></div>}
      {loading && <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton h-48" />)}</div>}

      {!loading && !error && (
        <div className="flex gap-3 overflow-x-auto pb-4 snap-x">
          {COLUMNS.map((col) => {
            const meta = STATUS_META[col] ?? { label: col, color: '#888', pct: 0 };
            const items = posts.filter((p) => p.status === col);
            return (
              <div key={col} className="w-72 shrink-0 snap-start">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} aria-hidden />
                  <h2 className="font-display font-semibold text-sm">{meta.label}</h2>
                  <span className="chip !text-[10px] ml-auto">{items.length}</span>
                </div>
                <div className="space-y-2 min-h-24 rounded-2xl bg-surface2/50 p-2">
                  {items.length === 0 && <p className="text-xs text-ink3 text-center py-6">Empty</p>}
                  {items.map((p, idx) => (
                    <Link key={p.id} to={`/post/${p.id}`} className="card card-hover block p-3 vb-slide-in" style={{ animationDelay: `${idx * 70}ms` }}>
                      <div className="flex items-center gap-1.5 text-[11px] text-ink3 mb-1">
                        <span>{CAT_EMOJI[p.category]}</span><span>{p.category}</span>
                        <span className="ml-auto">{timeAgo(p.updated_at || p.created_at)}</span>
                      </div>
                      <p className="text-[13px] font-semibold leading-snug line-clamp-2">{p.title}</p>
                      <div className="h-1.5 rounded-full bg-surface2 mt-2.5 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${p.progress || 0}%`, background: meta.color }} />
                      </div>
                      <div className="flex justify-between items-center mt-1.5">
                        <span className="text-[10px] text-ink3 font-mono">{p.progress || 0}%</span>
                        {p.eta && <span className="text-[10px] text-ink3">⏳ {p.eta}</span>}
                        {p.purge_at && <PurgeCountdown purgeAt={p.purge_at} />}
                      </div>
                      {(p.status_history?.length || 0) > 1 && (
                        <p className="text-[10px] text-ink3 mt-1">Last: {p.status_history[p.status_history.length - 1].note || STATUS_META[p.status_history[p.status_history.length - 1].status]?.label}</p>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
