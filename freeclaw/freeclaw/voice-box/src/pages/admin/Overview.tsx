import { useState, useEffect, useMemo } from 'react';
import { Megaphone, CheckCircle2, Clock, Users, TrendingUp, Flag, Lightbulb, MessageCircle, Play } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { downloadFile, toCSV, trendingScore, CAT_EMOJI, STATUS_META, safeStringify } from '../../lib/utils';
import CountUp from '../../components/CountUp';
import Trend, { Sparkline } from '../../components/Trend';
import QuickActions from './QuickActions';
import { StatusDialog } from '../../components/ui';

const DAY = 86400000;

export default function Overview() {
  const { toast } = useApp();
  const [posts, setPosts] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<any[]>('/api/posts?all=1').catch(() => []),
      api.get<any[]>('/api/comments?all=1').catch(() => []),
      api.get<any[]>('/api/reports').catch(() => []),
      api.post<any[]>('/api/admin', { action: 'users' }).catch(() => []),
    ]).then(([p, c, r, u]) => { setPosts(p); setComments(c); setReports(r); setUsers(u); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  /** Direct status action — opens the message dialog first so students always get an update note */
  const [statusDialog, setStatusDialog] = useState<{ id: string; status: string } | null>(null);
  const setStatus = (id: string, status: string) => setStatusDialog({ id, status });
  const applyStatus = async (note: string) => {
    if (!statusDialog) return;
    try {
      const updated = await api.put<Record<string, unknown>>('/api/posts', { id: statusDialog.id, status: statusDialog.status, status_note: note || undefined });
      setPosts((prev) => prev.map((p) => (p.id === statusDialog.id ? { ...p, ...updated } : p)));
      toast(statusDialog.status === 'solved' ? '✅ Marked as solved — students notified' : '🔧 Status updated — students notified', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
  };

  const inWindow = (rows: any[], from: number, to: number) =>
    rows.filter((r) => { const t = +new Date(r.created_at); return t >= from && t < to; }).length;

  const stats = useMemo(() => {
    const now = Date.now();
    const problems = posts.filter((p) => p.type === 'problem' && !p.deleted);
    const solved = problems.filter((p) => p.status === 'solved');
    const solveTimes = solved.map((p) => {
      const h = (p.status_history || []).find((x: any) => x.status === 'solved');
      return h ? (+new Date(h.at) - +new Date(p.created_at)) / DAY : null;
    }).filter((x): x is number => x !== null);
    const catCount: Record<string, number> = {};
    problems.forEach((p) => { catCount[p.category] = (catCount[p.category] || 0) + 1; });

    const reactionsTotal = posts.reduce((a, p) => a + Object.values(p.reactions || {}).reduce((x: number, y: any) => x + y, 0), 0);
    const engagement = reactionsTotal + comments.length;

    // this week vs previous week for trend arrows
    const wk = { posts: inWindow(posts, now - 7 * DAY, now), postsPrev: inWindow(posts, now - 14 * DAY, now - 7 * DAY),
      comments: inWindow(comments, now - 7 * DAY, now), commentsPrev: inWindow(comments, now - 14 * DAY, now - 7 * DAY),
      reports: inWindow(reports, now - 7 * DAY, now), reportsPrev: inWindow(reports, now - 14 * DAY, now - 7 * DAY) };
    const solvedThisWeek = solved.filter((p) => (p.status_history || []).some((h: any) => h.status === 'solved' && now - +new Date(h.at) < 7 * DAY)).length;
    const solvedPrevWeek = solved.filter((p) => (p.status_history || []).some((h: any) => { const t = +new Date(h.at); return h.status === 'solved' && now - t >= 7 * DAY && now - t < 14 * DAY; })).length;

    const health = Math.min(100, Math.round(
      (problems.length ? (solved.length / problems.length) * 50 : 25) +
      Math.min(25, engagement / 4) + Math.min(25, wk.posts * 3)
    ));

    // AI-style urgency: weighted priority load
    const urgency = Math.min(100, Math.round(problems.reduce((a, p) => a +
      ({ low: 2, medium: 5, high: 12, critical: 25 }[p.priority as string] || 5), 0) / Math.max(1, problems.length) * 2.5));

    return {
      today: inWindow(posts, now - DAY, now), week: wk.posts, month: inWindow(posts, now - 30 * DAY, now),
      total: posts.length, wk, solvedThisWeek, solvedPrevWeek,
      resolution: problems.length ? Math.round((solved.length / problems.length) * 100) : 0,
      avgSolve: solveTimes.length ? (solveTimes.reduce((a, b) => a + b, 0) / solveTimes.length).toFixed(1) : '–',
      openReports: reports.filter((r) => r.status !== 'resolved').length,
      users: users.length, engagement, reactionsTotal, health, urgency, catCount,
      suggestions: posts.filter((p) => p.type === 'suggestion').length,
      trending: [...problems].sort((a, b) => trendingScore(b) - trendingScore(a)).slice(0, 5),
      statusDist: Object.keys(STATUS_META).map((s) => ({ s, n: problems.filter((p) => p.status === s).length })),
      problemsCount: problems.length,
    };
  }, [posts, comments, reports, users]);

  // daily series for sparklines + main chart (last 14 days)
  const series = useMemo(() => {
    const mk = (rows: any[]) => {
      const out: number[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
        out.push(inWindow(rows, +d, +d + DAY));
      }
      return out;
    };
    return { posts: mk(posts), comments: mk(comments), reports: mk(reports) };
  }, [posts, comments, reports]);

  const timeline = useMemo(() => {
    const days: { label: string; count: number; comments: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      days.push({
        label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        count: series.posts[13 - i] ?? 0,
        comments: series.comments[13 - i] ?? 0,
      });
    }
    return days;
  }, [series]);
  const maxDay = Math.max(1, ...timeline.map((d) => d.count + d.comments));

  // weekday × 4-week heatmap
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 4 }, () => Array(7).fill(0));
    const now = new Date(); now.setHours(0, 0, 0, 0);
    posts.forEach((p) => {
      const t = new Date(p.created_at);
      const daysAgo = Math.floor((+now - +new Date(t.getFullYear(), t.getMonth(), t.getDate())) / DAY);
      if (daysAgo < 0 || daysAgo >= 28) return;
      const week = Math.floor(daysAgo / 7);
      const row = grid[3 - week];
      if (row) { const col = (t.getDay() + 6) % 7; row[col] = (row[col] ?? 0) + 1; }
    });
    return grid;
  }, [posts]);
  const heatMax = Math.max(1, ...heatmap.flat());

  if (loading) return <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{[1,2,3,4,5,6,7,8].map((i) => <div key={i} className="skeleton h-28" />)}</div>;

  const ringCirc = 2 * Math.PI * 34;

  const CARDS: { label: string; value: number; suffix?: string; sub: string; icon: any; color: string; trend?: { cur: number; prev: number; invert?: boolean }; spark?: number[] }[] = [
    { label: 'Posts this week', value: stats.week, sub: `${stats.today} today · ${stats.month} this month`, icon: Megaphone, color: 'text-accent', trend: { cur: stats.wk.posts, prev: stats.wk.postsPrev }, spark: series.posts },
    { label: 'Resolution rate', value: stats.resolution, suffix: '%', sub: `avg solve ${stats.avgSolve} days`, icon: CheckCircle2, color: 'text-good', trend: { cur: stats.solvedThisWeek, prev: stats.solvedPrevWeek } },
    { label: 'Engagement', value: stats.engagement, sub: `${stats.reactionsTotal} reactions · ${comments.length} comments`, icon: TrendingUp, color: 'text-accent', trend: { cur: stats.wk.comments, prev: stats.wk.commentsPrev }, spark: series.comments },
    { label: 'Comments this week', value: stats.wk.comments, sub: 'community discussion', icon: MessageCircle, color: 'text-ink2', trend: { cur: stats.wk.comments, prev: stats.wk.commentsPrev }, spark: series.comments },
    { label: 'Anonymous users', value: stats.users, sub: 'seen by the platform', icon: Users, color: 'text-ink2' },
    { label: 'Open reports', value: stats.openReports, sub: 'moderation queue', icon: Flag, color: stats.openReports ? 'text-bad' : 'text-good', trend: { cur: stats.wk.reports, prev: stats.wk.reportsPrev, invert: true }, spark: series.reports },
    { label: 'Suggestions', value: stats.suggestions, sub: 'improvement ideas', icon: Lightbulb, color: 'text-warn' },
    { label: 'Total content', value: stats.total, sub: 'problems + suggestions', icon: Clock, color: 'text-ink2' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-display font-bold text-xl">Dashboard</h1>
        <div className="flex gap-2">
          <button className="btn btn-ghost !text-xs" onClick={() => downloadFile('voicebox-posts.csv', toCSV(posts), 'text/csv')}>Export CSV</button>
          <button className="btn btn-ghost !text-xs" onClick={() => downloadFile('voicebox-export.json', safeStringify({ posts, comments, reports, exported: new Date().toISOString() }, 2))}>Export JSON</button>
          <button className="btn btn-ghost !text-xs" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      {/* Hero row: health ring + urgency gauge + stat highlights */}
      <div className="grid md:grid-cols-3 gap-3">
        {/* Community health ring */}
        <div className="card p-5 flex items-center gap-5 vb-rise">
          <div className="relative shrink-0" style={{ width: 84, height: 84 }}>
            <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
              <circle cx="42" cy="42" r="34" fill="none" stroke="var(--vb-surface2)" strokeWidth="9" />
              <circle cx="42" cy="42" r="34" fill="none"
                stroke={stats.health > 65 ? 'var(--vb-good)' : stats.health > 40 ? 'var(--vb-warn)' : 'var(--vb-bad)'}
                strokeWidth="9" strokeLinecap="round"
                strokeDasharray={ringCirc}
                strokeDashoffset={ringCirc * (1 - stats.health / 100)}
                transform="rotate(-90 42 42)"
                className="vb-ring" style={{ ['--ring-circ' as any]: ringCirc }} />
            </svg>
            <span className="absolute inset-0 grid place-items-center font-display font-bold text-xl"><CountUp value={stats.health} /></span>
          </div>
          <div>
            <p className="font-display font-semibold text-sm">Community health</p>
            <p className="text-[11px] text-ink3 mt-0.5 leading-relaxed">Composite of resolution rate, engagement & weekly activity.</p>
            <Trend current={stats.wk.posts + stats.wk.comments} previous={stats.wk.postsPrev + stats.wk.commentsPrev} label="activity vs last week" />
          </div>
        </div>

        {/* AI urgency gauge */}
        <div className="card p-5 vb-rise" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center justify-between">
            <p className="font-display font-semibold text-sm">AI urgency score</p>
            <span className={`font-display font-bold text-2xl ${stats.urgency > 60 ? 'text-bad' : stats.urgency > 35 ? 'text-warn' : 'text-good'}`}><CountUp value={stats.urgency} /></span>
          </div>
          <div className="h-2.5 rounded-full bg-surface2 overflow-hidden mt-3">
            <div className={`h-full rounded-full vb-bar-anim ${stats.urgency > 60 ? 'bg-bad' : stats.urgency > 35 ? 'bg-warn' : 'bg-good'}`} style={{ width: `${stats.urgency}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-ink3 mt-1"><span>calm</span><span>elevated</span><span>critical</span></div>
          <p className="text-[11px] text-ink3 mt-2">Weighted by priority levels across open issues.</p>
        </div>

        {/* Status distribution */}
        <div className="card p-5 vb-rise" style={{ animationDelay: '120ms' }}>
          <p className="font-display font-semibold text-sm mb-3">Pipeline distribution</p>
          <div className="flex h-3 rounded-full overflow-hidden bg-surface2">
            {stats.statusDist.filter((d) => d.n > 0).map((d) => (
              <div key={d.s} className="h-full vb-bar-anim first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(d.n / Math.max(1, stats.problemsCount)) * 100}%`, background: STATUS_META[d.s]?.color ?? '#888' }}
                title={`${STATUS_META[d.s]?.label ?? d.s}: ${d.n}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
            {stats.statusDist.filter((d) => d.n > 0).map((d) => (
              <span key={d.s} className="flex items-center gap-1 text-[10px] text-ink2">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_META[d.s]?.color ?? '#888' }} />{STATUS_META[d.s]?.label ?? d.s} · {d.n}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Stat cards with animated arrows + sparklines */}
      <QuickActions posts={posts} onStatusChange={setStatus} />
      <StatusDialog open={!!statusDialog} onClose={() => setStatusDialog(null)}
        status={statusDialog?.status || ''} statusLabel={(STATUS_META[statusDialog?.status || ''] || { label: '' }).label}
        onSubmit={applyStatus} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {CARDS.map(({ label, value, suffix, sub, icon: Icon, color, trend, spark }, i) => (
          <div key={label} className="card card-hover p-4 vb-rise" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between">
              <Icon size={16} className={color} />
              {trend && <Trend current={trend.cur} previous={trend.prev} invert={trend.invert} />}
            </div>
            <p className="font-display font-bold text-2xl mt-1.5"><CountUp value={value} suffix={suffix} /></p>
            <p className="text-xs font-semibold">{label}</p>
            <div className="flex items-end justify-between gap-2">
              <p className="text-[10px] text-ink3 leading-tight">{sub}</p>
              {spark && <Sparkline data={spark} width={64} height={22} />}
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Stacked timeline chart */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-sm">Activity — last 14 days</h2>
            <div className="flex gap-3 text-[10px] text-ink3">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent" /> posts</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent2 opacity-60" /> comments</span>
            </div>
          </div>
          <div className="flex items-end gap-1 h-36" role="img" aria-label="Activity timeline chart">
            {timeline.map((d, i) => (
              <div key={d.label} className="flex-1 flex flex-col items-center justify-end gap-px group h-full">
                <span className="text-[9px] font-mono text-ink3 opacity-0 group-hover:opacity-100 transition-opacity">{d.count + d.comments}</span>
                <div className="w-full rounded-t bg-accent2 opacity-60 vb-bar-anim" style={{ height: `${(d.comments / maxDay) * 100}%`, animationDelay: `${i * 30}ms` }} title={`${d.label}: ${d.comments} comments`} />
                <div className="w-full rounded-b-sm bg-accent vb-bar-anim group-hover:brightness-110" style={{ height: `${Math.max(2, (d.count / maxDay) * 100)}%`, animationDelay: `${i * 30}ms` }} title={`${d.label}: ${d.count} posts`} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-ink3 mt-1"><span>{timeline[0]?.label ?? ''}</span><span>{timeline[13]?.label ?? ''}</span></div>
        </div>

        {/* Category bars */}
        <div className="card p-5">
          <h2 className="font-display font-semibold text-sm mb-4">Active categories</h2>
          <div className="space-y-2">
            {Object.entries(stats.catCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cat, n], i) => {
              const max = Math.max(...Object.values(stats.catCount));
              return (
                <div key={cat} className="flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 font-medium">{CAT_EMOJI[cat]} {cat}</span>
                  <div className="flex-1 h-4 rounded bg-surface2 overflow-hidden">
                    <div className="h-full rounded vb-bar-anim" style={{ width: `${(n / max) * 100}%`, animationDelay: `${i * 60}ms`, background: 'linear-gradient(90deg, var(--vb-accent), var(--vb-accent2))' }} />
                  </div>
                  <span className="font-mono w-6 text-right">{n}</span>
                </div>
              );
            })}
            {Object.keys(stats.catCount).length === 0 && <p className="text-xs text-ink3">No data yet</p>}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Weekday heatmap */}
        <div className="card p-5">
          <h2 className="font-display font-semibold text-sm mb-4">Submission heatmap — last 4 weeks</h2>
          <div className="grid grid-cols-[auto_repeat(7,1fr)] gap-1.5 text-[9px] text-ink3">
            <span />
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => <span key={d} className="text-center">{d}</span>)}
            {heatmap.map((week, w) => (
              <div key={w} className="contents">
                <span className="self-center pr-1">W{w + 1}</span>
                {week.map((n, d) => (
                  <div key={d} className="aspect-square rounded-md vb-pop transition-transform hover:scale-110"
                    style={{
                      animationDelay: `${(w * 7 + d) * 20}ms`,
                      background: n === 0 ? 'var(--vb-surface2)' : `rgba(86, 82, 214, ${(0.25 + (n / heatMax) * 0.75).toFixed(2)})`,
                    }}
                    title={`${n} submission${n !== 1 ? 's' : ''}`} />
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 mt-3 text-[9px] text-ink3">
            less
            {[0, 0.33, 0.66, 1].map((f) => (
              <span key={f} className="w-3 h-3 rounded" style={{ background: f === 0 ? 'var(--vb-surface2)' : `rgba(86, 82, 214, ${(0.25 + f * 0.75).toFixed(2)})` }} />
            ))}
            more
          </div>
        </div>

        {/* Trending */}
        <div className="card p-5">
          <h2 className="font-display font-semibold text-sm mb-3">🔥 Trending issues right now</h2>
          <div className="space-y-1">
            {stats.trending.map((p, i) => {
              const eng = (p.reactions?.support || 0) + (p.comment_count || 0);
              const maxEng = Math.max(1, ...stats.trending.map((t) => (t.reactions?.support || 0) + (t.comment_count || 0)));
              return (
                <div key={p.id} className="flex items-center gap-3 text-sm py-2 border-b border-border last:border-0 group">
                  <span className={`font-display font-bold w-5 ${i === 0 ? 'text-accent' : 'text-ink3'}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block group-hover:text-accent transition-colors">{p.title}</span>
                    <div className="h-1 rounded-full bg-surface2 overflow-hidden mt-1">
                      <div className="h-full rounded-full vb-bar-anim" style={{ width: `${(eng / maxEng) * 100}%`, animationDelay: `${i * 80}ms`, background: 'linear-gradient(90deg, var(--vb-accent), var(--vb-accent2))' }} />
                    </div>
                  </div>
                  <span className="chip !text-[10px] shrink-0 hidden sm:inline-flex">{p.category}</span>
                  <span className="text-xs text-ink3 font-mono shrink-0 hidden sm:inline">↑{p.reactions?.support || 0} 💬{p.comment_count || 0}</span>
                  {/* Direct action buttons */}
                  <div className="flex gap-1 shrink-0">
                    {!['in_progress', 'solved', 'archived'].includes(p.status) && (
                      <button className="btn btn-soft !py-1 !px-2 !text-[10px]" onClick={() => setStatus(p.id, 'in_progress')} title="Mark in progress"><Play size={11} /> Start</button>
                    )}
                    {p.status !== 'solved' && p.status !== 'archived' && (
                      <button className="btn !py-1 !px-2 !text-[10px] !bg-good/12 !text-good hover:!bg-good/20" onClick={() => setStatus(p.id, 'solved')} title="Mark solved"><CheckCircle2 size={11} /> Solve</button>
                    )}
                    {p.status === 'solved' && <span className="chip !text-[10px] !text-good">✓ Solved</span>}
                  </div>
                </div>
              );
            })}
            {stats.trending.length === 0 && <p className="text-xs text-ink3">No problems submitted yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
