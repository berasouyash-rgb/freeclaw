import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff, Trash2, CheckCircle2, XCircle, MessageCircle, Image, Clock, User, Tag, Shield, Search, ChevronDown, ChevronUp, ExternalLink, Check, RefreshCcw, Inbox } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { CATEGORIES, CAT_EMOJI } from '../../lib/utils';

interface Post {
  id: string; type: string; title: string; description: string; category: string;
  priority: string; status: string; author_id: string; image_url?: string;
  created_at: string; tags?: string[]; reactions?: Record<string, number>;
  moderation_flags?: unknown; ai_analysis?: unknown;
}
interface Comment {
  id: string; post_id: string; body: string; author_id: string;
  created_at: string; flagged?: boolean; moderation_flags?: unknown;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  reported: { bg: 'rgba(220,75,75,0.12)', text: '#dc4b4b', label: 'Reported' },
  open: { bg: 'rgba(86,82,214,0.12)', text: 'var(--vb-accent)', label: 'Open' },
  pending_review: { bg: 'rgba(217,138,11,0.12)', text: '#d98a0b', label: 'Pending Review' },
  in_progress: { bg: 'rgba(22,160,106,0.12)', text: 'var(--vb-good)', label: 'In Progress' },
  solved: { bg: 'rgba(22,160,106,0.08)', text: 'var(--vb-good)', label: 'Solved' },
  archived: { bg: 'rgba(120,120,120,0.12)', text: '#888', label: 'Archived' },
};

export default function ContentReview() {
  const { toast } = useApp();
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reviewQueue, setReviewQueue] = useState<{ key: string; title?: string; description?: string; risk_score?: number; decision?: string; author_id?: string; content_type?: string }[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [postComments, setPostComments] = useState<Record<string, Comment[]>>({});
  const [loadingComments, setLoadingComments] = useState<Record<string, boolean>>({});
  const [showImage, setShowImage] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setQueueError(null);
    try {
      const [allPosts, allComments] = await Promise.all([
        api.get<Post[]>('/api/posts?all=1'),
        api.get<Comment[]>('/api/comments?all=1').catch(() => []),
      ]);
      // Only show posts that went through AI review:
      // 1. Posts flagged by serverModerate (pending_review status)
      // 2. Posts with ai_analysis or moderation_flags data
      const aiReviewed = (allPosts || []).filter((p) =>
        p.status === 'pending_review' ||
        p.ai_analysis ||
        p.moderation_flags
      );
      setPosts(aiReviewed);
      setComments(allComments || []);

      // Fetch pre-publish review queue separately — don't silently swallow errors
      try {
        const reviewData = await api.get<{ items: { key: string; title?: string; description?: string; risk_score?: number; decision?: string; author_id?: string; content_type?: string }[] }>('/api/pre-review');
        setReviewQueue(reviewData?.items || []);
      } catch (reviewErr: unknown) {
        const msg = reviewErr instanceof Error ? reviewErr.message : 'Unknown error';
        console.error('[ContentReview] Review queue fetch failed:', msg);
        setReviewQueue([]);
        if (msg.includes('403') || msg.includes('Admin only') || msg.includes('Forbidden')) {
          setQueueError('Admin session expired — log out and log back in to see the review queue.');
        } else {
          setQueueError(`Review queue failed to load: ${msg}`);
        }
      }
    } catch (e: unknown) {
      console.warn('[ContentReview] Failed to load:', e instanceof Error ? e.message : e);
      toast('Failed to load content', 'err');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadPostComments = async (postId: string) => {
    if (postComments[postId]) return;
    setLoadingComments((p) => ({ ...p, [postId]: true }));
    try {
      const c = await api.get<Comment[]>(`/api/comments?post_id=${postId}`);
      setPostComments((p) => ({ ...p, [postId]: c || [] }));
    } catch { /* ignore */ }
    setLoadingComments((p) => ({ ...p, [postId]: false }));
  };

  const toggleExpand = (postId: string) => {
    if (expandedPost === postId) {
      setExpandedPost(null);
    } else {
      setExpandedPost(postId);
      loadPostComments(postId);
    }
  };

  const updateStatus = async (postId: string, newStatus: string) => {
    try {
      await api.put('/api/posts', { id: postId, status: newStatus });
      setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, status: newStatus } : p));
      toast(`Post status → ${newStatus}`, 'ok');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Update failed', 'err');
    }
  };

  const deletePost = async (postId: string) => {
    if (!confirm('Delete this post permanently?')) return;
    try {
      await api.del('/api/posts', { id: postId });
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      toast('Post deleted', 'ok');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'err');
    }
  };

  const deleteComment = async (commentId: string, postId: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.del('/api/comments', { id: commentId });
      setPostComments((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).filter((c) => c.id !== commentId),
      }));
      toast('Comment deleted', 'ok');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'err');
    }
  };

  // Filter
  const filtered = posts.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q) && !p.author_id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const stats = {
    total: posts.length,
    reported: posts.filter((p) => p.status === 'reported').length,
    pending: posts.filter((p) => p.status === 'pending_review').length,
    withImages: posts.filter((p) => p.image_url).length,
    flagged: comments.filter((c) => c.flagged).length,
    queue: reviewQueue.length,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-lg">Content Review</h2>
          <p className="text-xs text-ink3 mt-0.5">Posts flagged by AI pre-publish check — review, approve, or remove</p>
        </div>
        <button className="btn btn-ghost !text-xs" onClick={loadData} disabled={loading}>
          <RefreshCcw size={12} className={`mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        {([
          ['AI-Reviewed', stats.total, 'var(--vb-accent)'],
          ['Pending', stats.pending, '#d98a0b'],
          ['Reported', stats.reported, '#dc4b4b'],
          ['Queue', stats.queue, '#8b5cf6'],
          ['With Images', stats.withImages, 'var(--vb-good)'],
          ['Flagged Comments', stats.flagged, '#dc4b4b'],
        ] as [string, number, string][]).map(([label, count, color]) => (
          <div key={label} className="card p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink3">{label}</p>
            <p className="text-xl font-bold mt-1" style={{ color }}>{count}</p>
          </div>
        ))}
      </div>

      {/* Error banner for review queue failures */}
      {queueError && (
        <div className="card p-3 border-l-4 border-l-yellow-500 bg-yellow-500/10">
          <p className="text-xs text-yellow-300 font-semibold">⚠️ {queueError}</p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input className="input !pl-8 !py-2 !text-xs" placeholder="Search title, description, or author ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input !py-2 !text-xs !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input !py-2 !text-xs !w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}
        </select>
      </div>

      {/* Pre-Publish Review Queue */}
      {reviewQueue.length > 0 && (
        <div className="card p-4 border-l-4 border-l-purple-500">
          <h3 className="text-sm font-bold text-purple-400 mb-2">Pre-Publish Review Queue ({reviewQueue.length})</h3>
          <p className="text-xs text-ink3 mb-3">High-risk content awaiting admin decision. These posts were blocked by the AI pre-publish check.</p>
          <div className="space-y-2">
            {reviewQueue.map((item) => (
              <div key={item.key} className="p-3 bg-surface2/50 rounded-lg border border-border/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold mb-1">{item.title || 'Untitled'}</div>
                    {item.description && <p className="text-[11px] text-ink2 line-clamp-2 mb-1">{item.description}</p>}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-ink3 font-mono">{item.author_id || 'unknown'}</span>
                      {item.risk_score != null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">Risk {item.risk_score}/100</span>
                      )}
                      {item.content_type && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface3/50 text-ink3">{item.content_type}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0 flex-wrap">
                    <button className="text-[10px] px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30" onClick={async () => {
                      try {
                        await api.post('/api/pre-review', { key: item.key, action: 'approve' });
                        setReviewQueue((q) => q.filter((i) => i.key !== item.key));
                        toast('Approved & published', 'ok');
                      } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
                    }}>Approve</button>
                    <button className="text-[10px] px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30" onClick={async () => {
                      try {
                        await api.post('/api/pre-review', { key: item.key, action: 'reject' });
                        setReviewQueue((q) => q.filter((i) => i.key !== item.key));
                        toast('Rejected', 'ok');
                      } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
                    }}>Reject</button>
                    <button className="text-[10px] px-2 py-1 rounded bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30" onClick={async () => {
                      try {
                        await api.post('/api/pre-review', { key: item.key, action: 'keep_private' });
                        setReviewQueue((q) => q.filter((i) => i.key !== item.key));
                        toast('Kept private', 'ok');
                      } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
                    }}>Keep Private</button>
                    <button className="text-[10px] px-2 py-1 rounded bg-red-700/20 text-red-300 hover:bg-red-700/30" onClick={async () => {
                      if (!confirm('Ban this user?')) return;
                      try {
                        await api.post('/api/pre-review', { key: item.key, action: 'ban' });
                        setReviewQueue((q) => q.filter((i) => i.key !== item.key));
                        toast('User banned', 'ok');
                      } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
                    }}>Ban</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-5 w-20 rounded bg-surface2" />
                <div className="h-5 w-16 rounded bg-surface2" />
                <div className="h-5 w-12 rounded bg-surface2" />
              </div>
              <div className="h-4 w-3/4 rounded bg-surface2 mb-2" />
              <div className="h-3 w-full rounded bg-surface2 mb-1" />
              <div className="h-3 w-2/3 rounded bg-surface2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="vb-empty-icon mx-auto mb-3"><Inbox size={28} className="text-ink3" /></div>
          <p className="text-sm font-semibold text-ink2 mb-1">No AI-reviewed posts match your filters</p>
          <p className="text-xs text-ink3 mb-4">Try changing the status filter or search query</p>
          <button className="btn btn-ghost !text-xs" onClick={loadData}><RefreshCcw size={12} className="mr-1" /> Refresh</button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((post) => {
            const expanded = expandedPost === post.id;
            const statusStyle = STATUS_COLORS[post.status] || { bg: 'rgba(86,82,214,0.12)', text: 'var(--vb-accent)', label: 'Open' };
            const postCommentList = postComments[post.id] || [];
            const isImageShown = showImage[post.id];

            return (
              <div key={post.id} className="card overflow-hidden">
                {/* Post header */}
                <div className="p-4 cursor-pointer hover:bg-surface2/50 transition-colors" onClick={() => toggleExpand(post.id)}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="chip !text-[10px] !py-0.5" style={{ background: statusStyle.bg, color: statusStyle.text }}>{statusStyle.label}</span>
                        <span className="chip !text-[10px] !py-0.5">{CAT_EMOJI[post.category] || '📁'} {post.category}</span>
                        <span className="chip !text-[10px] !py-0.5 capitalize">{post.priority}</span>
                        {post.image_url && <span className="chip !text-[10px] !py-0.5"><Image size={10} /> Image</span>}
                        {post.tags?.length ? <span className="chip !text-[10px] !py-0.5"><Tag size={10} /> {post.tags.length} tags</span> : null}
                      </div>
                      <h3 className="font-semibold text-sm leading-snug">{post.title}</h3>
                      <p className="text-xs text-ink2 mt-1 line-clamp-2">{post.description}</p>
                      <div className="flex items-center gap-3 mt-2 text-[10px] text-ink3">
                        <span className="flex items-center gap-1"><User size={10} /> {post.author_id}</span>
                        <span className="flex items-center gap-1"><Clock size={10} /> {new Date(post.created_at).toLocaleString()}</span>
                        <span className="flex items-center gap-1"><MessageCircle size={10} /> {postCommentList.length || '—'} comments</span>
                        {post.reactions && Object.keys(post.reactions).length > 0 && (
                          <span>{Object.entries(post.reactions).map(([k, v]) => `${k}:${v}`).join(' ')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {expanded ? <ChevronUp size={16} className="text-ink3" /> : <ChevronDown size={16} className="text-ink3" />}
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {expanded && (
                  <div className="border-t border-border p-4 space-y-4 bg-surface2/30">
                    {/* Full description */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">Full Description</p>
                      <p className="text-sm text-ink2 whitespace-pre-wrap">{post.description}</p>
                    </div>

                    {/* Image screenshot */}
                    {post.image_url && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">Screenshot / Image</p>
                        {isImageShown ? (
                          <div className="relative inline-block">
                            <img src={post.image_url} alt="Post screenshot" className="max-h-64 rounded-lg border border-border object-contain" />
                            <button className="absolute top-2 right-2 btn btn-ghost !p-1.5 bg-bg/80 backdrop-blur" onClick={(e) => { e.stopPropagation(); setShowImage((s) => ({ ...s, [post.id]: false })); }}>
                              <EyeOff size={12} />
                            </button>
                          </div>
                        ) : (
                          <button className="btn btn-ghost !text-xs" onClick={(e) => { e.stopPropagation(); setShowImage((s) => ({ ...s, [post.id]: true })); }}>
                            <Eye size={13} /> Show image
                          </button>
                        )}
                      </div>
                    )}

                    {/* User details */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-lg p-2.5 bg-bg border border-border">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-ink3">Author ID</p>
                        <p className="text-[11px] font-mono text-ink2 mt-0.5 break-all">{post.author_id}</p>
                      </div>
                      <div className="rounded-lg p-2.5 bg-bg border border-border">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-ink3">Post ID</p>
                        <p className="text-[11px] font-mono text-ink2 mt-0.5 break-all">{post.id}</p>
                      </div>
                      <div className="rounded-lg p-2.5 bg-bg border border-border">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-ink3">Type</p>
                        <p className="text-[11px] text-ink2 mt-0.5 capitalize">{post.type}</p>
                      </div>
                      <div className="rounded-lg p-2.5 bg-bg border border-border">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-ink3">Posted</p>
                        <p className="text-[11px] text-ink2 mt-0.5">{new Date(post.created_at).toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Tags */}
                    {post.tags && post.tags.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {post.tags.map((t) => <span key={t} className="chip !text-[10px]">#{t}</span>)}
                        </div>
                      </div>
                    )}

                    {/* Comments section */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-2 flex items-center gap-1">
                        <MessageCircle size={11} /> Comments ({postCommentList.length})
                      </p>
                      {loadingComments[post.id] ? (
                        <p className="text-xs text-ink3">Loading comments…</p>
                      ) : postCommentList.length === 0 ? (
                        <p className="text-xs text-ink3 italic">No comments</p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {postCommentList.map((c) => (
                            <div key={c.id} className={`rounded-lg p-3 border ${c.flagged ? 'border-bad/30 bg-bad/5' : 'border-border bg-bg'}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] text-ink3 mb-1">
                                    <span className="font-mono">{c.author_id}</span>
                                    {' · '}
                                    {new Date(c.created_at).toLocaleString()}
                                    {c.flagged && <span className="text-bad font-semibold"> · FLAGGED</span>}
                                  </p>
                                  <p className="text-xs text-ink2">{c.body}</p>
                                  {!!c.moderation_flags && (
                                    <p className="text-[10px] text-warn mt-1">
                                      <Shield size={10} className="inline" /> Moderation flags present
                                    </p>
                                  )}
                                </div>
                                <button className="btn btn-ghost !p-1.5 shrink-0 text-bad/60 hover:text-bad" onClick={() => deleteComment(c.id, post.id)} aria-label="Delete comment">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Admin actions */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                      {post.status === 'pending_review' && (
                        <button className="btn !text-xs bg-good/15 text-good border border-good/30 hover:bg-good/25 font-semibold" onClick={() => updateStatus(post.id, 'reported')}>
                          <Check size={13} /> Approve — AI flagged this but it's safe
                        </button>
                      )}
                      {post.status !== 'in_progress' && (
                        <button className="btn btn-ghost !text-xs" onClick={() => updateStatus(post.id, 'in_progress')}>
                          <CheckCircle2 size={13} /> Mark In Progress
                        </button>
                      )}
                      {post.status !== 'solved' && (
                        <button className="btn btn-ghost !text-xs" onClick={() => updateStatus(post.id, 'solved')}>
                          <CheckCircle2 size={13} /> Mark Solved
                        </button>
                      )}
                      {post.status !== 'archived' && (
                        <button className="btn btn-ghost !text-xs" onClick={() => updateStatus(post.id, 'archived')}>
                          <XCircle size={13} /> Archive
                        </button>
                      )}
                      <a href={`/post/${post.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !text-xs" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink size={13} /> View Live
                      </a>
                      <button className="btn btn-ghost !text-xs text-bad ml-auto" onClick={() => deletePost(post.id)}>
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
