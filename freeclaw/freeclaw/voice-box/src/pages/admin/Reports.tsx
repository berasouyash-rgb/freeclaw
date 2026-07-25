import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, ExternalLink, Flag, Image as ImageIcon, MessageSquare, BarChart3, Shield, ShieldCheck, ShieldX, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { timeAgo } from '../../lib/utils';
import PostPreviewCard from '../../components/PostPreviewCard';

/* ── Post preview card (for existing reports) ────────────────── */
function PostPreview({ targetId }: { targetId: string }) {
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/api/posts?id=${targetId}`);
        if (!cancelled) setPost(data);
      } catch { /* target may not exist */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [targetId]);

  if (loading) return <div className="skeleton h-24 mt-2" />;
  if (!post) return <p className="text-[11px] text-ink3 mt-2 italic">Target post not found or deleted.</p>;

  const statusColors: Record<string, string> = {
    open: 'var(--vb-warn)',
    in_progress: 'var(--vb-accent)',
    resolved: 'var(--vb-good)',
    closed: 'var(--vb-ink3)',
  };

  return (
    <div className="mt-2.5 rounded-xl border border-border bg-surface2/50 overflow-hidden">
      {post.image_url && (
        <div className="relative h-32 bg-surface2 overflow-hidden">
          <img
            src={post.image_url}
            alt={post.title || 'Post image'}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className="absolute top-2 left-2 chip !text-[9px] !py-0.5 !px-1.5 bg-black/60 text-white backdrop-blur-sm">
            <ImageIcon size={9} /> screenshot
          </span>
        </div>
      )}

      <div className="p-3">
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <span className="chip !text-[9px]" style={{ color: statusColors[post.status] || 'var(--vb-ink3)', borderColor: (statusColors[post.status] || 'var(--vb-ink3)') + '44' }}>
            {post.status || 'unknown'}
          </span>
          {post.category && (
            <span className="chip !text-[9px]">{post.category}</span>
          )}
          {post.priority && post.priority !== 'medium' && (
            <span className="chip !text-[9px]" style={{ color: post.priority === 'critical' ? 'var(--vb-bad)' : post.priority === 'high' ? 'var(--vb-warn)' : 'var(--vb-ink3)' }}>
              {post.priority}
            </span>
          )}
        </div>

        <p className="text-sm font-semibold leading-snug mb-1">{post.title || '(no title)'}</p>

        {post.description && (
          <p className="text-xs text-ink2 leading-relaxed line-clamp-3 mb-1.5">{post.description}</p>
        )}

        <div className="flex items-center gap-3 text-[10px] text-ink3">
          {typeof post.reactions === 'object' && post.reactions && (
            <span>👍 {Object.values(post.reactions as Record<string, number>).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)} reactions</span>
          )}
          {post.comment_count != null && <span>💬 {post.comment_count} comments</span>}
          {post.author_id && <span>by {post.author_id.slice(0, 10)}…</span>}
          {post.created_at && <span>{timeAgo(post.created_at)}</span>}
        </div>

        {post.admin_reply && (
          <div className="mt-2 p-2 rounded-lg bg-accent/5 border border-accent/10 text-[11px] text-ink2">
            <span className="font-semibold text-accent">Admin reply:</span> {post.admin_reply}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Pre-publish review item ─────────────────────────────────── */
function PrePublishReview({ item, onAction }: { item: any; onAction: (key: string, action: string) => void }) {
  const [acting, setActing] = useState(false);

  const handleAction = async (action: string) => {
    setActing(true);
    try {
      await api.post('/api/pre-review', { key: item.key, action });
      onAction(item.key, action);
    } catch (e: unknown) {
      console.error('Review action failed:', e);
    }
    setActing(false);
  };

  return (
    <div className="card overflow-hidden" style={{ borderColor: 'rgba(220,75,75,0.2)' }}>
      {/* Header */}
      <div className="p-4 flex items-start gap-3 border-b border-border bg-red-500/5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="chip !text-[9px] !py-0.5" style={{ color: 'var(--vb-bad)', borderColor: 'rgba(220,75,75,0.3)' }}>
              <ShieldX size={9} /> pre-publish review
            </span>
            <span className="chip !text-[9px] !py-0.5" style={{ color: 'var(--vb-warn)', borderColor: 'rgba(220,170,50,0.3)' }}>
              {item.status || 'pending'}
            </span>
          </div>
          <p className="text-sm font-medium">🛡️ AI flagged this content for review</p>
          <p className="text-[11px] text-ink3 mt-1 font-mono">
            type: {item.content_type} · risk: {item.risk_score}/100 · {item.created_at ? timeAgo(item.created_at) : 'unknown'}
          </p>
        </div>
      </div>

      {/* Post preview with screenshot rendering */}
      <div className="p-4">
        <PostPreviewCard
          title={item.title}
          description={item.description}
          body={item.body}
          category={item.category}
          priority={item.priority}
          content_type={item.content_type}
          risk_score={item.risk_score}
          checks={item.checks}
          summary={item.summary}
          author_id={item.author_id}
          created_at={item.created_at}
          blocked={true}
        />
      </div>

      {/* Action buttons */}
      <div className="p-4 border-t border-border flex gap-2">
        <button
          className="flex-1 btn btn-soft !text-xs flex items-center justify-center gap-1.5"
          onClick={() => handleAction('approve')}
          disabled={acting}
        >
          <ShieldCheck size={13} /> Approve & Publish
        </button>
        <button
          className="flex-1 btn btn-ghost !text-xs flex items-center justify-center gap-1.5 text-bad"
          onClick={() => handleAction('reject')}
          disabled={acting}
        >
          <ShieldX size={13} /> Reject
        </button>
        <button
          className="btn btn-ghost !p-2 flex items-center justify-center"
          onClick={() => handleAction('ban')}
          disabled={acting}
          title="Ban author"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/* ── Main Reports Component ─────────────────────────────────── */
export default function Reports() {
  const { toast } = useApp();
  const [reports, setReports] = useState<any[]>([]);
  const [preReviews, setPreReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'open' | 'resolved' | 'pre-publish'>('open');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [reportsData, reviewData] = await Promise.all([
        api.get<any[]>('/api/reports').catch(() => []),
        api.get<{ items: any[] }>('/api/pre-review').catch(() => ({ items: [] })),
      ]);
      setReports(reportsData || []);
      setPreReviews(reviewData?.items || []);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Unknown error', 'err');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id: number) => {
    try { await api.put('/api/reports', { id, status: 'resolved' }); load(); toast('Resolved', 'ok'); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
  };

  const handleReviewAction = (key: string, action: string) => {
    setPreReviews((prev) => prev.filter((r) => r.key !== key));
    toast(`Review ${action}d`, 'ok');
  };

  const openReports = reports.filter((r) => r.status !== 'resolved');
  const resolvedReports = reports.filter((r) => r.status === 'resolved');

  const targetTypeIcon = (type: string) => {
    switch (type) {
      case 'post': return <Flag size={12} />;
      case 'comment': return <MessageSquare size={12} />;
      case 'poll': return <BarChart3 size={12} />;
      default: return <Flag size={12} />;
    }
  };

  return (
    <div>
      <h1 className="font-display font-bold text-xl mb-4">Report queue</h1>
      <div className="flex gap-2 mb-4">
        <button
          className={`btn !text-xs ${tab === 'open' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('open')}
        >
          Open ({openReports.length})
        </button>
        <button
          className={`btn !text-xs ${tab === 'resolved' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('resolved')}
        >
          Resolved ({resolvedReports.length})
        </button>
        <button
          className={`btn !text-xs ${tab === 'pre-publish' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('pre-publish')}
        >
          <Shield size={12} /> Pre-publish ({preReviews.length})
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-16" />)}</div>
      ) : (
        <div className="space-y-3">
          {/* Pre-publish reviews */}
          {tab === 'pre-publish' && preReviews.map((item) => (
            <PrePublishReview key={item.key} item={item} onAction={handleReviewAction} />
          ))}
          {tab === 'pre-publish' && preReviews.length === 0 && (
            <p className="card p-8 text-center text-sm text-ink3">No pre-publish reviews pending — the AI hasn't flagged anything.</p>
          )}

          {/* Open reports */}
          {tab === 'open' && openReports.map((r) => {
            const isExpanded = expandedId === r.id;
            return (
              <div key={r.id} className="card overflow-hidden">
                <div
                  className="p-4 flex items-start gap-3 cursor-pointer hover:bg-surface2/30 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="chip !text-[9px] !py-0.5" style={{ color: 'var(--vb-bad)', borderColor: 'rgba(220,75,75,0.3)' }}>
                        {targetTypeIcon(r.target_type)} {r.target_type}
                      </span>
                      {r.status !== 'resolved' && (
                        <span className="chip !text-[9px] !py-0.5" style={{ color: 'var(--vb-warn)', borderColor: 'rgba(220,170,50,0.3)' }}>
                          open
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium">🚩 {r.reason}</p>
                    <p className="text-[11px] text-ink3 mt-1 font-mono">
                      target: {r.target_id} · by {r.author_id?.slice(0, 12)}… · {timeAgo(r.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.target_type === 'post' && (
                      <a className="btn btn-ghost !p-2" href={`/post/${r.target_id}`} target="_blank" rel="noreferrer" title="Open target" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink size={14} />
                      </a>
                    )}
                    {r.status !== 'resolved' && (
                      <button className="btn btn-soft !text-xs" onClick={(e) => { e.stopPropagation(); resolve(r.id); }}>
                        <CheckCircle2 size={13} /> Resolve
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && r.target_type === 'post' && (
                  <div className="px-4 pb-4 border-t border-border">
                    <PostPreview targetId={r.target_id} />
                  </div>
                )}
              </div>
            );
          })}
          {tab === 'open' && openReports.length === 0 && (
            <p className="card p-8 text-center text-sm text-ink3">Queue is clear — no open reports.</p>
          )}

          {/* Resolved reports */}
          {tab === 'resolved' && resolvedReports.map((r) => (
            <div key={r.id} className="card p-4 opacity-60">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={16} className="text-good shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.reason}</p>
                  <p className="text-[11px] text-ink3 mt-1 font-mono">
                    target: {r.target_id} · resolved {timeAgo(r.created_at)}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {tab === 'resolved' && resolvedReports.length === 0 && (
            <p className="card p-8 text-center text-sm text-ink3">No resolved reports yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
