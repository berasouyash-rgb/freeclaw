import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Lightbulb, PlusCircle, ArrowBigUp, MessageCircle, ShieldCheck, Bookmark, Sparkles, CheckCircle2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import { timeAgo, trendingScore, STATUS_META } from '../lib/utils';
import { useRealtime } from '../lib/useRealtime';
import { Segmented } from '../components/ui';
import type { PostData, ReactionEntry, ReactionResponse } from '../types';

export default function Suggestions() {
  const { anonId, bookmarks, toggleBookmark, toast } = useApp();
  const [items, setItems] = useState<PostData[]>([]);
  const [mine, setMine] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<'top' | 'trending' | 'new'>('top');
  const [statusF, setStatusF] = useState<'all' | 'open' | 'accepted'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const [data, reactions] = await Promise.all([
        api.get<PostData[]>('/api/posts?type=suggestion'),
        api.get<ReactionEntry[]>(`/api/reactions?author=${anonId}`),
      ]);
      setItems(data);
      const map: Record<string, string[]> = {};
      reactions.forEach((r) => { map[r.target_id] = [...(map[r.target_id] || []), r.kind]; });
      setMine(map);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load suggestions'); }
    setLoading(false);
  }, [anonId]);

  useEffect(() => { load(); }, [load]);

  // Real-time: auto-refresh when posts or reactions change in Supabase
  useRealtime(['posts', 'reactions'], useCallback(() => { load(); }, [load]), 1500);

  const vote = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      const res = await api.post<ReactionResponse>('/api/reactions', { author_id: anonId, target_id: id, target_type: 'suggestion', kind: 'upvote' });
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, reactions: res.counts } : s)));
      setMine((m) => ({ ...m, [id]: res.mine ?? (res.toggled ? ['upvote'] : []) }));
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Vote failed', 'err'); }
    setBusy(null);
  };

  const net = (s: PostData) => s.reactions?.upvote || 0;

  const sorted = useMemo(() => {
    let list = [...items];
    if (statusF === 'open') list = list.filter((s) => !['solved', 'archived'].includes(s.status));
    if (statusF === 'accepted') list = list.filter((s) => ['in_progress', 'waiting', 'solved'].includes(s.status));
    if (sort === 'top') list.sort((a, b) => net(b) - net(a));
    else if (sort === 'trending') list.sort((a, b) => trendingScore(b) - trendingScore(a));
    else list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return list;
  }, [items, sort, statusF]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display font-bold text-2xl flex items-center gap-2"><Lightbulb className="text-warn" size={24} /> Suggestion Board</h1>
        <Link to="/submit?type=suggestion" className="btn btn-primary !py-2"><PlusCircle size={15} /> New idea</Link>
      </div>
      <p className="text-sm text-ink3 mb-5">Improvement ideas ranked by the community. Top suggestions get official replies.</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<'top' | 'trending' | 'new'> value={sort} onChange={setSort} options={[
          { value: 'top', label: '🏆 Top ranked' },
          { value: 'trending', label: 'Trending' },
          { value: 'new', label: 'Newest' },
        ]} />
        <div className="ml-auto">
          <Segmented<'all' | 'open' | 'accepted'> value={statusF} onChange={setStatusF} options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'accepted', label: '✓ Accepted' },
          ]} />
        </div>
      </div>

      {error && <div className="card p-6 text-center"><p className="text-bad text-sm">{error}</p><button className="btn btn-soft mt-3" onClick={() => { setLoading(true); load(); }}>Retry</button></div>}
      {loading && <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}</div>}
      {!loading && !error && sorted.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-3xl mb-2">💡</p><p className="font-display font-semibold">No suggestions yet</p>
          <Link to="/submit?type=suggestion" className="btn btn-primary mt-4 inline-flex">Share the first idea</Link>
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((s, rank) => (
          <article key={s.id} className="card card-hover p-4 flex gap-3.5 vb-rise">
            <button onClick={() => vote(s.id)} disabled={busy === s.id}
              aria-label={`Support this idea (${net(s)})`} aria-pressed={(mine[s.id] || []).includes('upvote')}
              className={`self-start flex flex-col items-center justify-center shrink-0 rounded-xl border px-3 py-2 transition-all active:scale-90 ${
                (mine[s.id] || []).includes('upvote')
                  ? 'border-accent bg-accent-soft text-accent vb-pop'
                  : 'border-border text-ink3 hover:border-accent hover:text-accent hover:-translate-y-0.5'
              }`}>
              <ArrowBigUp size={22} fill={(mine[s.id] || []).includes('upvote') ? 'currentColor' : 'none'} />
              <span key={net(s)} className="text-sm font-bold leading-none vb-pop">{net(s)}</span>
            </button>
            {sort === 'top' && rank < 3 && <span className="text-base self-center -ml-1.5" aria-label={`Rank ${rank + 1}`}>{['🥇', '🥈', '🥉'][rank]}</span>}
            <div className="min-w-0 flex-1">
              <Link to={`/post/${s.id}`} className="group">
                <h3 className="font-display font-semibold text-[15px] leading-snug group-hover:text-accent transition-colors">{s.title}</h3>
                <p className="text-sm text-ink2 mt-1 line-clamp-2">{s.description}</p>
              </Link>
              {s.ai_summary && (
                <p className="text-xs text-accent mt-2 flex items-center gap-1"><Sparkles size={11} /> {s.ai_summary}</p>
              )}
              {s.admin_reply && (
                <div className="mt-2 rounded-lg bg-good/8 border border-good/25 px-3 py-2">
                  <p className="text-[10px] font-bold text-good flex items-center gap-1"><ShieldCheck size={10} /> ADMIN REPLY</p>
                  <p className="text-xs mt-0.5">{s.admin_reply}</p>
                </div>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-ink3">
                <span className="chip !text-[10px]">{s.category}</span>
                {/* Status — clearly visible, incl. Solved */}
                <span className="chip !text-[10px] font-bold" style={{ color: STATUS_META[s.status]?.color, borderColor: `${STATUS_META[s.status]?.color}44` }}>
                  {s.status === 'solved' && <CheckCircle2 size={10} />} {s.status === 'solved' ? 'Implemented' : STATUS_META[s.status]?.label || s.status}
                </span>
                <Link to={`/post/${s.id}`} className="flex items-center gap-1 hover:text-accent"><MessageCircle size={12} /> {s.comment_count || 0}</Link>
                <button onClick={() => toggleBookmark(s.id)} className={bookmarks.includes(s.id) ? 'text-accent' : 'hover:text-ink2'} aria-label="Bookmark">
                  <Bookmark size={12} fill={bookmarks.includes(s.id) ? 'currentColor' : 'none'} />
                </button>
                <span className="ml-auto">{timeAgo(s.created_at)}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
