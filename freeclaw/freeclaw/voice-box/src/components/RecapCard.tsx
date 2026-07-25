import { useMemo } from 'react';
import { CalendarDays, CheckCircle2, TrendingUp } from 'lucide-react';
import { CAT_EMOJI } from '../lib/utils';
import type { PostData, StatusHistoryEntry } from '../types';

/** Weekly community recap — computed client-side from the loaded feed */
export default function RecapCard({ posts }: { posts: PostData[] }) {
  const recap = useMemo(() => {
    const now = Date.now();
    const DAY = 86400000;
    const week = posts.filter((p) => now - +new Date(p.created_at) < 7 * DAY);
    const solvedWeek = posts.filter((p) => (p.status_history || []).some((h: StatusHistoryEntry) => h.status === 'solved' && now - +new Date(h.at) < 7 * DAY));
    const cats: Record<string, number> = {};
    week.forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
    const topSupported = [...week].sort((a, b) => (b.reactions?.support || 0) - (a.reactions?.support || 0))[0];
    return { newCount: week.length, solvedCount: solvedWeek.length, topCat: top?.[0], topCatN: top?.[1] || 0, star: topSupported };
  }, [posts]);

  if (recap.newCount === 0 && recap.solvedCount === 0) return null;

  return (
    <section className="card p-4 sm:p-5 mb-6 vb-rise" style={{ background: 'linear-gradient(135deg, var(--vb-accent-soft), var(--vb-surface))' }} aria-label="Weekly recap">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent flex items-center gap-1.5 mb-2"><CalendarDays size={12} /> This week at your school</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5"><TrendingUp size={14} className="text-accent" /> <b>{recap.newCount}</b>&nbsp;new post{recap.newCount !== 1 ? 's' : ''}</span>
        <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-good" /> <b>{recap.solvedCount}</b>&nbsp;solved</span>
        {recap.topCat && <span>{CAT_EMOJI[recap.topCat]} <b>{recap.topCat}</b> most active ({recap.topCatN})</span>}
      </div>
      {recap.star && (recap.star.reactions?.support || 0) > 0 && (
        <p className="text-xs text-ink2 mt-2">⭐ Most supported: “{recap.star.title}” ({recap.star.reactions.support} supports)</p>
      )}
    </section>
  );
}
