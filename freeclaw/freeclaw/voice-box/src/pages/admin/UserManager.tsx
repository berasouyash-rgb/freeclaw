import { useState, useCallback } from 'react';
import { Search, X, AlertTriangle, Ban, RotateCcw, ShieldAlert, MessageSquare, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { timeAgo, fmtDate } from '../../lib/utils';
import { ConfirmDialog, PromptDialog } from '../../components/ui';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import type { PostData, CommentData } from '../../types';

interface UserSummary {
  anon_id: string;
  last_seen?: string;
  post_count?: number;
  comment_count?: number;
  reaction_count?: number;
  strikes?: number;
  spam_score?: number;
  banned?: boolean;
  suspended_until?: string;
  created_at?: string;
  [k: string]: unknown;
}

interface UserDetail {
  anon_id: string;
  meta: {
    anon_id: string;
    notes?: string;
    warnings?: { text: string; at: string }[];
    created_at?: string;
    strikes?: number;
    spam_score?: number;
    banned?: boolean;
    suspended_until?: string;
    [k: string]: unknown;
  };
  posts: (PostData & { created_at: string; deleted?: boolean })[];
  comments: (CommentData & { created_at: string; deleted?: boolean })[];
  reactions: { created_at: string; kind: string; target_id: string }[];
  reports: { created_at: string; target_type: string; reason: string }[];
  [k: string]: unknown;
}

const SUSPEND_OPTIONS = [1, 3, 7, 30, 90];

export default function UserManager() {
  const { toast } = useApp();
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dialog, setDialog] = useState<{ kind: 'warn' | 'spam' | 'ban' } | null>(null);

  const fetchUsers = useCallback(async ({ cursor, limit }: { cursor: string | null; limit: number }) => {
    const result = await api.postPaginated<UserSummary>('/api/admin', { action: 'users', cursor, limit });
    return { data: result.data || [], nextCursor: result.nextCursor, total: result.total || 0 };
  }, []);

  const { items: users, loading, initialLoading, hasMore, total, sentinelRef, reset } = useInfiniteScroll<UserSummary>(fetchUsers, { limit: 30 });

  const openDetail = async (anonId: string) => {
    setDetailLoading(true);
    try { setDetail(await api.post<UserDetail>('/api/admin', { action: 'user_detail', anon_id: anonId })); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to load user detail', 'err'); }
    setDetailLoading(false);
  };

  const updateUser = async (anonId: string, patch: Record<string, unknown>) => {
    try {
      await api.post('/api/admin', { action: 'update_user', anon_id: anonId, ...patch });
      toast('User updated', 'ok');
      reset(); // reload from scratch to get updated counts
      openDetail(anonId);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to update user', 'err'); }
  };

  const filtered = users
    .filter((u) => !query || u.anon_id.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => +new Date(b.last_seen || 0) - +new Date(a.last_seen || 0));
  const meta = detail?.meta;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display font-bold text-xl">Anonymous user management</h1>
        <span className="text-xs text-ink3">{total} total</span>
      </div>
      <p className="text-xs text-ink3 mb-4">Only anonymous browser IDs are visible — no personal data exists anywhere in the system.</p>
      <div className="relative mb-4 max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
        <input className="input !pl-8 !py-2 text-sm font-mono" placeholder="Search anonymous ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {initialLoading ? <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="skeleton h-14" />)}</div> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead><tr className="text-left text-[11px] uppercase text-ink3 border-b border-border">
              <th className="px-4 py-3">Anonymous ID</th><th className="px-2 py-3">Posts</th><th className="px-2 py-3">Comments</th>
              <th className="px-2 py-3">Reactions</th><th className="px-2 py-3">Strikes</th><th className="px-2 py-3">Spam</th><th className="px-2 py-3">Status</th>
            </tr></thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.anon_id} className="border-b border-border last:border-0 hover:bg-surface2/60 cursor-pointer" onClick={() => openDetail(u.anon_id)}>
                  <td className="px-4 py-3 font-mono text-xs">{u.anon_id}</td>
                  <td className="px-2 py-3">{u.post_count}</td>
                  <td className="px-2 py-3">{u.comment_count}</td>
                  <td className="px-2 py-3">{u.reaction_count}</td>
                  <td className="px-2 py-3">{u.strikes || 0}</td>
                  <td className="px-2 py-3">{u.spam_score || 0}</td>
                  <td className="px-2 py-3 text-xs">
                    {u.banned ? <span className="chip !text-bad !text-[10px]">Banned</span>
                      : u.suspended_until && new Date(u.suspended_until) > new Date() ? <span className="chip !text-warn !text-[10px]">Suspended</span>
                      : <span className="chip !text-good !text-[10px]">Active</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink3 text-xs">No users found.</td></tr>}
            </tbody>
          </table>
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />
          {loading && !initialLoading && (
            <div className="flex items-center justify-center py-3 gap-2 text-ink3 text-xs">
              <Loader2 size={14} className="animate-spin" /> Loading more users…
            </div>
          )}
          {!hasMore && users.length > 0 && (
            <p className="text-center text-[11px] text-ink3 py-2">All {total} users loaded</p>
          )}
        </div>
      )}

      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-lg bg-surface h-full overflow-y-auto p-5 vb-rise">
            {detailLoading || !meta ? <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="skeleton h-16" />)}</div> : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="font-display font-bold font-mono text-sm">{meta.anon_id}</h2>
                    <p className="text-[11px] text-ink3">First seen {timeAgo(meta.created_at ?? '')} · {meta.strikes || 0} strike(s) · spam score {meta.spam_score || 0}</p>
                  </div>
                  <button className="btn btn-ghost !p-2" onClick={() => setDetail(null)}><X size={16} /></button>
                </div>

                {meta.banned && <p className="card !border-bad/40 p-3 text-sm text-bad mb-3 flex items-center gap-2"><Ban size={14} /> Permanently banned</p>}
                {meta.suspended_until && new Date(meta.suspended_until) > new Date() && (
                  <p className="card !border-warn/40 p-3 text-sm text-warn mb-3 flex items-center gap-2"><ShieldAlert size={14} /> Suspended until {fmtDate(meta.suspended_until)}</p>
                )}

                <div className="grid grid-cols-2 gap-2 mb-4">
                  <button className="btn btn-soft !text-xs col-span-2" onClick={() => { sessionStorage.setItem('vb:adminChatTarget', meta.anon_id); window.dispatchEvent(new CustomEvent('vb:admin-tab', { detail: 'chat' })); }}><MessageSquare size={13} /> Message this user</button>
                  <button className="btn btn-ghost !text-xs" onClick={() => setDialog({ kind: 'warn' })}><AlertTriangle size={13} /> Warn (+strike)</button>
                  <button className="btn btn-ghost !text-xs" onClick={() => setDialog({ kind: 'spam' })}>Set spam score</button>
                  {SUSPEND_OPTIONS.map((d) => (
                    <button key={d} className="btn btn-ghost !text-xs" onClick={() => updateUser(meta.anon_id, { suspend_days: d })}>Suspend {d}d</button>
                  ))}
                  <button className="btn btn-soft !text-xs" onClick={() => updateUser(meta.anon_id, { suspend_days: 0 })}><RotateCcw size={13} /> Lift suspension</button>
                  {meta.banned
                    ? <button className="btn btn-soft !text-xs" onClick={() => updateUser(meta.anon_id, { banned: false })}>Unban</button>
                    : <button className="btn btn-danger !text-xs" onClick={() => setDialog({ kind: 'ban' })}><Ban size={13} /> Permanent ban</button>}
                </div>

                <label className="text-xs block mb-4">
                  <span className="font-semibold text-ink2">Moderator notes / appeals</span>
                  <textarea className="input mt-1 min-h-16" defaultValue={meta.notes || ''} placeholder="Notes, appeal outcomes, context…" onBlur={(e) => e.target.value !== (meta.notes || '') && updateUser(meta.anon_id, { notes: e.target.value })} />
                </label>

                {(meta.warnings || []).length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-xs font-bold uppercase text-ink3 mb-2">Warnings issued</h3>
                    {meta.warnings?.map((w, i) => (
                      <p key={i} className="text-xs text-ink2 py-1 border-b border-border">{w.text} <span className="text-ink3">· {timeAgo(w.at)}</span></p>
                    ))}
                  </div>
                )}

                <h3 className="text-xs font-bold uppercase text-ink3 mb-2">Activity timeline</h3>
                <div className="space-y-1.5 mb-4">
                  {[...detail.posts.map((p) => ({ at: p.created_at, label: `Posted: ${p.title}`, del: p.deleted })),
                    ...detail.comments.map((c) => ({ at: c.created_at, label: `Commented: ${c.body.slice(0, 60)}`, del: c.deleted })),
                    ...detail.reactions.map((r) => ({ at: r.created_at, label: `Reacted (${r.kind}) on ${r.target_id.slice(0, 14)}`, del: false })),
                    ...detail.reports.map((r) => ({ at: r.created_at, label: `Reported ${r.target_type}: ${r.reason.slice(0, 50)}`, del: false }))]
                    .sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 40)
                    .map((e, i) => (
                      <p key={i} className={`text-xs py-1 border-b border-border last:border-0 ${e.del ? 'line-through text-ink3' : 'text-ink2'}`}>
                        {e.label} <span className="text-ink3">· {timeAgo(e.at)}</span>
                      </p>
                    ))}
                  {detail.posts.length + detail.comments.length + detail.reactions.length === 0 && <p className="text-xs text-ink3">No activity recorded.</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {meta && (
        <>
          <PromptDialog open={dialog?.kind === 'warn'} onClose={() => setDialog(null)}
            onSubmit={(v) => updateUser(meta.anon_id, { warn: v })} title="Issue warning"
            label="Warning message (adds one strike)" placeholder="e.g. Repeated off-topic posts — please keep it constructive" multiline submitLabel="Send warning" />
          <PromptDialog open={dialog?.kind === 'spam'} onClose={() => setDialog(null)}
            onSubmit={(v) => updateUser(meta.anon_id, { spam_score: Math.min(100, Math.max(0, Number(v) || 0)) })}
            title="Set spam score" label="Score from 0 (clean) to 100 (definite spam)" placeholder="0-100" defaultValue={String(meta.spam_score || 0)} submitLabel="Save score" />
          <ConfirmDialog open={dialog?.kind === 'ban'} onClose={() => setDialog(null)}
            onConfirm={() => updateUser(meta.anon_id, { banned: true })} title="Permanent ban"
            message={`Permanently ban ${meta.anon_id}? They will no longer be able to post, comment, vote or chat. You can unban later if needed.`}
            confirmLabel="Ban permanently" danger />
        </>
      )}
    </div>
  );
}
