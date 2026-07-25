import { memo, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ThumbsUp, MessageCircle, Bookmark, Pin, Sparkles, CheckCircle2, Flame, BarChart3, AlertCircle, Angry, Heart, Gavel } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { timeAgo, CAT_EMOJI, STATUS_META, PRIORITY_META, trendingScore } from '../lib/utils';
import { api } from '../lib/api';
import type { PostData, ReactionMeta } from '../types';

export const REACTION_META: ReactionMeta[] = [
  { kind: 'support', label: 'Support', icon: ThumbsUp, color: 'var(--vb-accent)' },
  { kind: 'concerned', label: 'Concerned', icon: AlertCircle, color: '#d98a0b' },
  { kind: 'frustrated', label: 'Frustrated', icon: Angry, color: '#dc4b4b' },
  { kind: 'appreciate', label: 'Appreciate', icon: Heart, color: '#16a06a' },
];

interface PostCardProps {
  post: PostData;
  myReactions?: string[];
  onReacted?: (id: string, counts: Record<string, number>, kind: string, toggled: boolean) => void;
}

function PostCardInner({ post, myReactions, onReacted }: PostCardProps) {
  const { anonId, bookmarks, toggleBookmark, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [localCounts, setLocalCounts] = useState<Record<string, number> | null>(null);
  const [localMine, setLocalMine] = useState<string[] | null>(null);
  const counts = localCounts || post.reactions || {};
  const mine = localMine || myReactions || [];
  const status = STATUS_META[post.status] ?? STATUS_META.reported ?? { label: 'Unknown', color: '#888', pct: 0 };
  const prio = PRIORITY_META[post.priority] ?? PRIORITY_META.medium ?? { label: 'Medium', color: '#888' };
  // Trending: fast-rising support relative to age
  const isTrending = trendingScore(post) > 1.2 && (Date.now() - +new Date(post.created_at)) < 7 * 86400000;

  const react = useCallback(async (kind: string) => {
    if (busy) return;
    setBusy(kind);
    try {
      const res = await api.post<{ counts: Record<string, number>; mine: string[]; toggled: boolean }>('/api/reactions', { author_id: anonId, target_id: post.id, target_type: 'post', kind });
      setLocalCounts(res.counts);
      // Server returns the authoritative list of MY reactions — opposites are auto-cleared
      setLocalMine(res.mine ?? (res.toggled ? [...mine, kind] : mine.filter((k) => k !== kind)));
      onReacted?.(post.id, res.counts, kind, res.toggled);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Reaction failed', 'err'); }
    setBusy(null);
  }, [busy, anonId, post.id, mine, onReacted, toast]);

  return (
    <article className="card card-hover p-4 sm:p-5 vb-rise vb-card-press">
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none mt-0.5 shrink-0" aria-hidden>{CAT_EMOJI[post.category] || '📌'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            {post.ready_for_decision && (
              <span className="chip !border-transparent vb-pop" style={{ background: 'rgba(22,160,106,0.14)', color: '#16a06a' }} title={`Reached ${post.ready_threshold} co-signs — flagged for admin decision`}>
                <Gavel size={11} className="vb-trend-bounce" /> Ready for decision
              </span>
            )}
            {isTrending && <span className="chip !border-transparent vb-pop" style={{ background: 'rgba(217,138,11,0.12)', color: '#d98a0b' }}><Flame size={11} className="vb-trend-bounce" /> Trending</span>}
            {post.pinned && <span className="chip !bg-accent-soft !text-accent !border-transparent"><Pin size={11} /> Pinned</span>}
            {post.featured && <span className="chip !bg-warn/10 !text-warn !border-transparent"><Sparkles size={11} /> Featured</span>}
            <span className="chip">{post.category}</span>
            <span className="chip" style={{ color: prio.color, borderColor: `${prio.color}44` }}>{prio.label}</span>
            <span className="chip" style={{ color: status.color, borderColor: `${status.color}44` }}>
              {post.status === 'solved' && <CheckCircle2 size={11} />} {status.label}
            </span>
          </div>
          <Link to={`/post/${post.id}`} className="block group">
            <h3 className="font-display font-semibold text-[15px] sm:text-base leading-snug group-hover:text-accent transition-colors duration-200">{post.title}</h3>
            <p className="text-sm text-ink2 mt-1.5 line-clamp-2 leading-relaxed">{post.description}</p>
          </Link>
          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">{post.tags.map((t) => <span key={t} className="text-[11px] text-accent font-medium">#{t}</span>)}</div>
          )}
          <div className="flex flex-wrap items-center gap-1 mt-3 -ml-1">
            {REACTION_META.map(({ kind, label, icon: Icon, color }) => {
              const active = mine.includes(kind);
              const n = counts[kind] || 0;
              return (
                <button key={kind} onClick={() => react(kind)} disabled={busy !== null}
                  aria-label={`${label} (${n})`} aria-pressed={active}
                  title={label}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    active ? 'vb-pop ring-1' : 'text-ink3 hover:bg-surface2 hover:-translate-y-0.5 hover:shadow-sm'
                  }`}
                  style={active ? { color, background: 'var(--vb-surface2)', boxShadow: `0 0 0 1px ${color}33` } : undefined}>
                  <Icon size={13} fill={active && kind !== 'concerned' ? 'currentColor' : 'none'} className={`transition-transform duration-200 ${active ? 'scale-110' : ''}`} />
                  <span className="hidden sm:inline">{label}</span>
                  <span key={n} className="vb-pop inline-block min-w-[14px] text-center">{n}</span>
                </button>
              );
            })}
            <Link to={`/post/${post.id}`} data-tour="comments-link" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-ink3 hover:bg-surface2 hover:text-accent transition-all duration-200">
              <MessageCircle size={13} className="transition-transform duration-200 hover:scale-110" /> {post.comment_count || 0}
            </Link>
            {post.linked_poll && (
              <Link to={`/post/${post.id}`} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-accent hover:bg-accent-soft transition-all duration-200" title="This post has a live poll">
                <BarChart3 size={13} /> Poll
              </Link>
            )}
            <button onClick={() => { toggleBookmark(post.id); toast(bookmarks.includes(post.id) ? 'Bookmark removed' : 'Bookmarked — find it in My Activity', 'ok'); }}
              aria-label="Bookmark" aria-pressed={bookmarks.includes(post.id)}
              className={`px-2.5 py-1.5 rounded-lg transition-all duration-200 ${bookmarks.includes(post.id) ? 'text-accent vb-pop' : 'text-ink3 hover:text-accent hover:-translate-y-0.5 hover:bg-surface2'}`}>
              <Bookmark size={13} fill={bookmarks.includes(post.id) ? 'currentColor' : 'none'} className="transition-transform duration-200" />
            </button>
            <span className="ml-auto text-[11px] text-ink3">{timeAgo(post.created_at)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export const PostCard = memo(PostCardInner);
export default PostCard;
