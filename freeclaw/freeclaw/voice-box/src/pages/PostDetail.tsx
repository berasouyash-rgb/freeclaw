import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bookmark, Flag, Trash2, ShieldCheck, Volume2, VolumeX, Link2, Lock, Sparkles } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import { CAT_EMOJI, timeAgo, PRIORITY_META } from '../lib/utils';
import { readAloud, stopReading, speechOutputSupported } from '../lib/speech';
import { REACTION_META } from '../components/PostCard';
import Comments from '../components/Comments';
import PollCard from '../components/PollCard';
import StatusTimeline from '../components/StatusTimeline';
import { ConfirmDialog, ReportDialog } from '../components/ui';
import type { PostData, ReactionEntry } from '../types';

export default function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { anonId, toast, bookmarks, toggleBookmark } = useApp();

  const [p, setPost] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [copied, setCopied] = useState(false);
  const _readRef = useRef(false);

  const postId = id || '';
  const isBookmarked = bookmarks.includes(postId);

  const fetchPost = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get<{ post: PostData; counts: Record<string, number>; mine: string[]; reactions: ReactionEntry[] }>(
        `/api/posts?id=${postId}&author_id=${anonId}`
      );
      setPost(res.post);
      setCounts(res.counts || {});
      setMine(res.mine || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load post');
    } finally {
      setLoading(false);
    }
  }, [postId, anonId]);

  useEffect(() => { if (postId) fetchPost(); }, [postId, fetchPost]);

  // Cleanup TTS on unmount
  useEffect(() => () => { stopReading(); }, []);

  const react = async (kind: string) => {
    if (busy) return;
    setBusy(kind);
    try {
      const res = await api.post<{ counts: Record<string, number>; mine: string[] }>(
        '/api/posts',
        { action: 'react', post_id: postId, kind, author_id: anonId }
      );
      setCounts(res.counts);
      setMine(res.mine);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Reaction failed', 'err');
    }
    setBusy(null);
  };

  const del = async () => {
    try {
      await api.del('/api/posts', { id: postId, author_id: anonId });
      toast('Post deleted', 'ok');
      nav('/');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'err');
    }
  };

  const toggleRead = () => {
    if (!p) return;
    if (reading) { stopReading(); setReading(false); return; }
    setReading(true);
    readAloud(`${p.title}. ${p.description}`, () => setReading(false));
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast('Link copied to clipboard', 'ok');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Copy failed — check permissions', 'err');
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto">
        <button className="btn btn-ghost !px-3 mb-4" onClick={() => nav(-1)}><ArrowLeft size={15} /> Back</button>
        <div className="card p-6 space-y-3">
          <div className="h-4 bg-surface2 rounded vb-shimmer w-1/3" />
          <div className="h-6 bg-surface2 rounded vb-shimmer w-2/3" />
          <div className="h-20 bg-surface2 rounded vb-shimmer" />
        </div>
      </div>
    );
  }

  if (error || !p) {
    return (
      <div className="max-w-3xl mx-auto">
        <button className="btn btn-ghost !px-3 mb-4" onClick={() => nav(-1)}><ArrowLeft size={15} /> Back</button>
        <div className="card p-8 text-center">
          <div className="vb-empty-icon mx-auto mb-3"><span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-500"><Link2 size={24} /></span></div>
          <p className="text-ink2 font-semibold mb-1">Post not found</p>
          <p className="text-sm text-ink3">{error || 'This post may have been removed or the link is invalid.'}</p>
        </div>
      </div>
    );
  }

  const prio = PRIORITY_META[p.priority] ?? PRIORITY_META.medium ?? { label: 'Medium', color: '#888' };

  return (
    <div className="max-w-3xl mx-auto vb-page-enter">
      <button className="btn btn-ghost !px-3 mb-4" onClick={() => nav(-1)}><ArrowLeft size={15} /> Back</button>

      <article className="card p-5 sm:p-6 vb-rise">
        {/* Meta chips */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="chip">{CAT_EMOJI[p.category]} {p.category}</span>
          <span className="chip" style={{ color: prio.color, borderColor: `${prio.color}44` }}>{prio.label} priority</span>
          {p.locked && <span className="chip"><Lock size={11} className="inline" /> Locked</span>}
          <span className="ml-auto text-xs text-ink3">{timeAgo(p.created_at)} · by <code className="font-mono">{p.is_mine ? 'You' : (p.author_id?.slice(0, 10) ?? 'anon')}</code></span>
        </div>

        <h1 className="font-display font-bold text-xl sm:text-2xl leading-tight tracking-tight">{p.title}</h1>
        <p className="text-[15px] text-ink2 mt-3 prose-desc leading-relaxed">{p.description}</p>

        {p.image_url && (
          <img src={p.image_url} alt="Attached to post" loading="lazy"
            className="mt-4 rounded-xl border border-border max-h-96 object-contain vb-card-press" />
        )}

        {p.tags && p.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {p.tags.map((t) => <span key={t} className="text-xs text-accent font-semibold">#{t}</span>)}
          </div>
        )}

        {/* AI summary */}
        {p.ai_summary && (
          <div className="mt-4 rounded-xl p-4 vb-card-glow" style={{ background: 'var(--vb-accent-soft)', border: '1px solid rgba(86,82,214,0.2)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1.5 flex items-center gap-1.5">
              <Sparkles size={12} /> AI summary
            </p>
            <p className="text-sm text-ink2 leading-relaxed">{p.ai_summary}</p>
          </div>
        )}

        {/* Admin reply */}
        {p.admin_reply && (
          <div className="mt-4 rounded-xl p-4" style={{ background: 'rgba(22,160,106,0.06)', border: '1px solid rgba(22,160,106,0.2)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--vb-good)' }}>
              <ShieldCheck size={11} /> Official admin reply
            </p>
            <p className="text-sm prose-desc leading-relaxed">{p.admin_reply}</p>
          </div>
        )}

        {/* Status timeline */}
        {p.status_history && p.status_history.length > 0 && (
          <div className="mt-5">
            <StatusTimeline post={p} />
          </div>
        )}

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-1 mt-5 pt-4 border-t border-border">
          {REACTION_META.map(({ kind, label, icon: Icon, color }) => {
            const active = mine.includes(kind);
            const n = counts[kind] || 0;
            return (
              <button key={kind} onClick={() => react(kind)} disabled={busy !== null}
                aria-label={`${label} (${n})`} aria-pressed={active} title={label}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  active ? 'vb-pop ring-1' : 'text-ink3 hover:bg-surface2 hover:-translate-y-0.5 hover:shadow-sm'
                }`}
                style={active ? { color, background: 'var(--vb-surface2)', boxShadow: `0 0 0 1px ${color}33` } : undefined}>
                <Icon size={13} fill={active && kind !== 'concerned' ? 'currentColor' : 'none'}
                  className={`transition-transform duration-200 ${active ? 'scale-110' : ''}`} />
                <span className="hidden sm:inline">{label}</span>
                <span key={n} className="vb-pop inline-block min-w-[14px] text-center">{n}</span>
              </button>
            );
          })}

          <div className="ml-auto flex items-center gap-1">
            {speechOutputSupported && (
              <button onClick={toggleRead} aria-label={reading ? 'Stop reading' : 'Read aloud'}
                title={reading ? 'Stop reading' : 'Read aloud'}
                className={`p-2 rounded-lg transition-all duration-200 ${reading ? 'text-accent bg-accent-soft' : 'text-ink3 hover:text-accent hover:bg-surface2'}`}>
                {reading ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            )}
            <button onClick={copyLink} title={copied ? 'Copied!' : 'Copy link'}
              className={`p-2 rounded-lg transition-all duration-200 ${copied ? 'text-good' : 'text-ink3 hover:text-accent hover:bg-surface2'}`}>
              <Link2 size={14} />
            </button>
            <button onClick={() => toggleBookmark(postId)} aria-label="Bookmark" aria-pressed={isBookmarked}
              title="Bookmark"
              className={`p-2 rounded-lg transition-all duration-200 ${isBookmarked ? 'text-accent vb-pop' : 'text-ink3 hover:text-accent hover:bg-surface2'}`}>
              <Bookmark size={14} fill={isBookmarked ? 'currentColor' : 'none'} />
            </button>
            <button onClick={() => setReportOpen(true)} title="Report"
              className="p-2 rounded-lg text-ink3 hover:text-warn hover:bg-surface2 transition-all duration-200">
              <Flag size={14} />
            </button>
            {p.is_mine && (
              <button onClick={() => setDeleteOpen(true)} title="Delete"
                className="p-2 rounded-lg text-ink3 hover:text-red-500 hover:bg-red-500/10 transition-all duration-200">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </article>

      {/* Linked poll */}
      {p.linked_poll && (
        <div className="mt-4">
          <PollCard
            poll={{ id: p.linked_poll, title: p.title, ptype: 'yesno', options: [], author_id: p.author_id }}
            onVoted={() => fetchPost()}
          />
        </div>
      )}

      {/* Comments */}
      <div className="mt-6">
        <Comments postId={postId} locked={!!p.locked} />
      </div>

      {/* Report dialog */}
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} onSubmit={(reason) => { api.post('/api/reports', { target_id: postId, target_type: 'post', reason }); setReportOpen(false); toast('Report submitted', 'ok'); }} />

      {/* Delete confirmation */}
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={del}
        title="Delete this post?" message="This action cannot be undone. The post and all its comments will be permanently removed."
        confirmLabel="Delete" danger />
    </div>
  );
}
