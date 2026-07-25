import { useState, useCallback } from 'react';
import { EyeOff, Eye, Trash2, Search, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { timeAgo } from '../../lib/utils';
import { ConfirmDialog } from '../../components/ui';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import type { CommentData } from '../../types';

export default function CommentMod() {
  const { toast } = useApp();
  const [query, setQuery] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchComments = useCallback(async ({ cursor, limit }: { cursor: string | null; limit: number }) => {
    const result = await api.paginated('/api/comments?all=1', { cursor, limit });
    return { data: result.data || [], nextCursor: result.nextCursor, total: result.total || 0 };
  }, []);

  const { items: comments, loading, initialLoading, hasMore, total, sentinelRef, setItems } = useInfiniteScroll<CommentData>(fetchComments, { limit: 30 });

  const setHidden = async (id: string, hidden: boolean) => {
    try { await api.put('/api/comments', { id, hidden }); setItems((p) => p.map((c) => c.id === id ? { ...c, hidden } : c)); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to update', 'err'); }
  };
  const del = async (id: string) => {
    try { await api.del('/api/comments', { id }); setItems((p) => p.filter((c) => c.id !== id)); toast('Deleted', 'ok'); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to delete', 'err'); }
  };

  const q = query.trim().toLowerCase();
  const filtered = comments.filter((c) => !q || c.body.toLowerCase().includes(q) || c.author_id.toLowerCase().includes(q));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-xl">Comment moderation</h1>
        <span className="text-xs text-ink3">{total} total</span>
      </div>
      <div className="relative mb-4 max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
        <input className="input !pl-8 !py-2 text-sm" placeholder="Search comment text or author ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {initialLoading ? <div className="space-y-2">{[1,2,3,4].map((i) => <div key={i} className="skeleton h-16" />)}</div> : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <div key={c.id} className={`card p-3.5 flex items-start gap-3 ${c.hidden ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm prose-desc">{c.body}</p>
                <p className="text-[11px] text-ink3 mt-1 font-mono">{c.author_id?.slice(0, 14) ?? 'anon'} · {timeAgo(c.created_at)} · on {c.post_id} {c.deleted && '· user-deleted'} {c.hidden && '· hidden'}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button className="btn btn-ghost !p-2" onClick={() => setHidden(c.id, !c.hidden)} title={c.hidden ? 'Unhide' : 'Hide'}>{c.hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                <button className="btn btn-danger !p-2" onClick={() => setDeleteId(c.id)} title="Delete"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />
          {loading && !initialLoading && (
            <div className="flex items-center justify-center py-3 gap-2 text-ink3 text-xs">
              <Loader2 size={14} className="animate-spin" /> Loading more comments…
            </div>
          )}
          {!hasMore && comments.length > 0 && (
            <p className="text-center text-[11px] text-ink3 py-2">All {total} comments loaded</p>
          )}
          {filtered.length === 0 && !loading && <p className="card p-8 text-center text-sm text-ink3">No comments found.</p>}
        </div>
      )}
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del(deleteId)}
        title="Delete comment?" message="This comment will be permanently removed. This cannot be undone." confirmLabel="Delete" danger />
    </div>
  );
}
