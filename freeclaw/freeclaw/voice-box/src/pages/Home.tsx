import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Search, TrendingUp, Clock, MessageCircle, ThumbsUp, SlidersHorizontal, Megaphone, PlusCircle, CheckCircle2, Activity, ArrowUp, FileText, Users, Target, MessageSquare } from 'lucide-react';
import { useRealtime } from '../lib/useRealtime';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import { CATEGORIES, trendingScore } from '../lib/utils';
import PostCard from '../components/PostCard';
import CountUp from '../components/CountUp';
import Trend, { Sparkline } from '../components/Trend';
import WordCloud from '../components/WordCloud';
import RecapCard from '../components/RecapCard';
import type { PostData, ReactionEntry } from '../types';

const SORTS = [
  { key: 'trending', label: 'Trending', icon: TrendingUp },
  { key: 'newest', label: 'Newest', icon: Clock },
  { key: 'discussed', label: 'Most Discussed', icon: MessageCircle },
  { key: 'supported', label: 'Most Supported', icon: ThumbsUp },
];

export default function Home() {
  const { anonId } = useApp();
  const [posts, setPosts] = useState<PostData[]>([]);
  const [myReactions, setMyReactions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [sort, setSort] = useState('trending');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [pendingNew, setPendingNew] = useState(0);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (silent = false) => {
    try {
      setError('');
      const [data, reactions] = await Promise.all([
        api.get<PostData[]>('/api/posts?type=problem'),
        api.get<ReactionEntry[]>(`/api/reactions?author=${anonId}`),
      ]);
      const map: Record<string, string[]> = {};
      reactions.forEach((r) => { map[r.target_id] = [...(map[r.target_id] || []), r.kind]; });
      setMyReactions(map);

      if (silent && knownIdsRef.current.size > 0) {
        // Live update while user may be scrolling: update existing rows in place,
        // but hold NEW posts behind the "New posts ↑" pill so the list never
        // reorders under their finger.
        const newOnes = data.filter((p) => !knownIdsRef.current.has(p.id));
        if (newOnes.length > 0 && window.scrollY > 300) {
          setPosts((prev) => prev.map((p) => data.find((d) => d.id === p.id) || p));
          setPendingNew((n) => n + newOnes.length);
          newOnes.forEach((p) => knownIdsRef.current.add(p.id));
          return;
        }
      }
      setPosts(data);
      knownIdsRef.current = new Set(data.map((p) => p.id));
      setPendingNew(0);
    } catch (e: unknown) { if (!silent) setError(e instanceof Error ? e.message : 'Could not load feed'); }
    setLoading(false);
  }, [anonId]);

  useEffect(() => { load(); }, [load]);

  // 🔴 Realtime: posts, votes and comment counts update live for everyone
  useRealtime(['posts', 'reactions', 'comments'], () => load(true));

  const showPending = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    load(false);
  };

  const filtered = useMemo(() => {
    let list = posts.filter((p) => !p.merged_into);
    if (cat !== 'All') list = list.filter((p) => p.category === cat);
    if (statusFilter === 'open') list = list.filter((p) => !['solved', 'archived'].includes(p.status));
    if (statusFilter === 'solved') list = list.filter((p) => p.status === 'solved');
    if (query.trim()) {
      // Multi-word search: every word must match somewhere in title/description/tags/category
      const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      list = list.filter((p) => {
        const haystack = `${p.title} ${p.description} ${(p.tags || []).join(' ')} ${p.category}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
    }
    const pinned = list.filter((p) => p.pinned);
    const rest = list.filter((p) => !p.pinned);
    const sorter: Record<string, (a: PostData, b: PostData) => number> = {
      trending: (a, b) => trendingScore(b) - trendingScore(a),
      newest: (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
      discussed: (a, b) => (b.comment_count || 0) - (a.comment_count || 0),
      supported: (a, b) => (b.reactions?.support || 0) - (a.reactions?.support || 0),
    };
    rest.sort(sorter[sort]);
    return [...pinned, ...rest];
  }, [posts, cat, query, sort, statusFilter]);

  const stats = useMemo(() => {
    const now = Date.now();
    const DAY = 86400000;
    const cnt = (rows: PostData[], from: number, to: number) => rows.filter((p) => { const t = +new Date(p.created_at); return t >= from && t < to; }).length;
    const spark: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      spark.push(cnt(posts, +d, +d + DAY));
    }
    return {
      total: posts.length,
      solved: posts.filter((p) => p.status === 'solved').length,
      active: posts.filter((p) => !['solved', 'archived'].includes(p.status)).length,
      week: cnt(posts, now - 7 * DAY, now),
      prevWeek: cnt(posts, now - 14 * DAY, now - 7 * DAY),
      solvedWeek: posts.filter((p) => (p.status_history || []).some((h) => h.status === 'solved' && now - +new Date(h.at) < 7 * DAY)).length,
      solvedPrevWeek: posts.filter((p) => (p.status_history || []).some((h) => { const t = +new Date(h.at); return h.status === 'solved' && now - t >= 7 * DAY && now - t < 14 * DAY; })).length,
      spark,
    };
  }, [posts]);

  return (
    <div>
      {/* "New posts" pill — live content arrived while scrolled down */}
      {pendingNew > 0 && (
        <button onClick={showPending}
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 btn btn-primary !rounded-full !py-2 !px-4 shadow-xl vb-rise"
          aria-live="polite">
          <ArrowUp size={14} /> {pendingNew} new post{pendingNew > 1 ? 's' : ''}
        </button>
      )}

      {/* Hero — plain CSS gradient + rgba colors (works on ALL browsers, no color-mix/oklab) */}
      <section className="card !border-transparent mb-6 relative overflow-hidden vb-rise"
        style={{ background: 'linear-gradient(120deg, #5652d6 0%, #6f63e8 55%, #8a7bf2 100%)', color: '#ffffff' }}>
        <div className="absolute -right-10 -top-10 w-52 h-52 rounded-full" style={{ background: 'rgba(255,255,255,0.09)', filter: 'blur(28px)' }} aria-hidden />
        <img src="/hero-art.png" alt="" aria-hidden loading="eager"
          className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 w-60 lg:w-72 h-auto select-none pointer-events-none"
          style={{ maskImage: 'linear-gradient(to left, black 60%, transparent)', WebkitMaskImage: 'linear-gradient(to left, black 60%, transparent)', mixBlendMode: 'soft-light' }} />
        <div className="relative p-6 sm:p-8 md:max-w-[62%]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] mb-2 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.72)' }}><Megaphone size={13} /> Anonymous school feedback</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl leading-tight max-w-lg" style={{ color: '#fff' }}>Speak up. Stay invisible. Get things fixed.</h1>
          <p className="text-sm mt-2 max-w-md" style={{ color: 'rgba(255,255,255,0.82)' }}>No names, no emails, no tracking — just your voice. Report problems, share ideas, vote in polls.</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link to="/submit" data-tour="submit" className="btn" style={{ background: '#ffffff', color: '#5652d6' }}><PlusCircle size={15} /> Report a problem</Link>
            <Link to="/board" className="btn" style={{ background: 'rgba(255,255,255,0.16)', color: '#ffffff' }}>View solving board</Link>
          </div>
        </div>
      </section>

      {/* How it works — 3 simple steps for first-time visitors */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
        {[
          { n: '1', icon: FileText, title: 'Report', sub: 'No name needed', color: 'var(--vb-accent)' },
          { n: '2', icon: Users, title: 'Others support it', sub: 'More support = faster fix', color: 'var(--vb-warn)' },
          { n: '3', icon: Target, title: 'School fixes it', sub: 'Track live progress', color: 'var(--vb-good)' },
        ].map((s, i) => (
          <div key={s.n} className="card card-hover p-3 sm:p-4 text-center vb-rise" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl mb-1.5" style={{ background: `${s.color}12`, color: s.color }}>
              <s.icon size={18} strokeWidth={2.2} />
            </span>
            <p className="font-display font-bold text-xs sm:text-sm">{s.n}. {s.title}</p>
            <p className="text-[10px] sm:text-[11px] text-ink3 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Stats with animated trends */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total reports', value: stats.total, icon: Megaphone, color: 'text-accent', trend: { cur: stats.week, prev: stats.prevWeek }, spark: stats.spark },
          { label: 'Being worked on', value: stats.active, icon: Activity, color: 'text-warn' },
          { label: 'Solved', value: stats.solved, icon: CheckCircle2, color: 'text-good', trend: { cur: stats.solvedWeek, prev: stats.solvedPrevWeek } },
        ].map(({ label, value, icon: Icon, color, trend, spark }, i) => (
          <div key={label} className="card card-hover p-3.5 sm:p-4 vb-rise" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-center justify-between">
              <Icon size={16} className={color} />
              {trend && !loading && <Trend current={trend.cur} previous={trend.prev} label="this week vs last week" />}
            </div>
            <p className="font-display font-bold text-xl sm:text-2xl mt-1">{loading ? '–' : <CountUp value={value} />}</p>
            <div className="flex items-end justify-between gap-1">
              <p className="text-[11px] sm:text-xs text-ink3">{label}</p>
              {spark && !loading && <span className="hidden sm:block"><Sparkline data={spark} width={56} height={18} /></span>}
            </div>
          </div>
        ))}
      </div>

      <RecapCard posts={posts} />

      {/* Theme word cloud — what the school is talking about */}
      {!loading && posts.length >= 3 && (
        <div className="card p-4 mb-4 vb-rise">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink3 text-center mb-1 flex items-center justify-center gap-1.5"><MessageSquare size={11} /> What the school is talking about · tap a word to filter</p>
          <WordCloud posts={posts} onWordClick={(w) => setQuery(w)} />
        </div>
      )}

      {/* Search + filters — single clean toolbar */}
      <div className="card p-3 mb-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1" data-tour="search">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
            <input id="feed-search" className="input !pl-9 !py-2" placeholder="Search problems…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search problems" />
          </div>
          <select className="input !w-auto !py-2 text-sm max-w-36" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category">
            <option value="All">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className={`btn !py-2 sm:hidden ${showFilters ? 'btn-soft' : 'btn-ghost'}`} onClick={() => setShowFilters((s) => !s)} aria-label="Toggle filters" aria-expanded={showFilters}><SlidersHorizontal size={15} /></button>
        </div>
        <div className={`${showFilters ? 'flex' : 'hidden sm:flex'} flex-wrap items-center gap-2`}>
          <div className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5 overflow-x-auto" role="tablist" aria-label="Sort feed">
            {SORTS.map(({ key, label, icon: Icon }) => (
              <button key={key} role="tab" aria-selected={sort === key} onClick={() => setSort(key)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${sort === key ? 'bg-surface shadow-sm text-accent' : 'text-ink3 hover:text-ink2'}`}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5 ml-auto" role="tablist" aria-label="Filter by status">
            {(['all', 'open', 'solved'] as const).map((s) => (
              <button key={s} role="tab" aria-selected={statusFilter === s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${statusFilter === s ? 'bg-surface shadow-sm text-accent' : 'text-ink3 hover:text-ink2'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feed */}
      <h2 className="sr-only">Recent Reports</h2>
      {error && (
        <div className="card p-6 text-center">
          <p className="text-bad font-medium text-sm">{error}</p>
          <button className="btn btn-soft mt-3" onClick={() => { setLoading(true); load(); }}>Retry</button>
        </div>
      )}
      {loading && <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-32" />)}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div className="card p-10 text-center vb-rise">
          <div className="vb-empty-icon">
            <Megaphone size={28} />
          </div>
          <p className="font-display font-semibold">No problems found</p>
          <p className="text-sm text-ink3 mt-1">Be the first to report something anonymously.</p>
          <Link to="/submit" className="btn btn-primary mt-4 inline-flex"><PlusCircle size={15} /> Report a problem</Link>
        </div>
      )}
      <div className="space-y-3">
        {filtered.map((p, i) => (
          <div key={p.id} {...(i === 0 ? { 'data-tour': 'post-card' } : {})}>
            <PostCard post={p} myReactions={myReactions[p.id]} />
          </div>
        ))}
      </div>
    </div>
  );
}
