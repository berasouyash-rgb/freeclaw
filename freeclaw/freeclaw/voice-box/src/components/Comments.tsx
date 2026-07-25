import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Send, Reply, Pencil, Trash2, Flag, ShieldCheck, CornerDownRight, ShieldAlert, Lock, Ban, Pause } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { api, hasAdminSession } from '../lib/api';
import { timeAgo, sanitize } from '../lib/utils';
import { checkCooldown, stampCooldown } from '../lib/identity';
import { ReportDialog } from './ui';
import { useRealtime } from '../lib/useRealtime';
import { moderateContent, isBlocked, type ModerationResult } from '../lib/moderation';
import type { CommentData } from '../types';

interface CommentNode extends CommentData { children: CommentNode[]; }

function buildTree(rows: CommentData[]): CommentNode[] {
  const map: Record<string, CommentNode> = {};
  rows.forEach((r) => { map[r.id] = { ...r, children: [] }; });
  const roots: CommentNode[] = [];
  rows.forEach((r) => {
    const parent = r.parent_id ? map[r.parent_id] : undefined;
    const node = map[r.id];
    if (parent && node) parent.children.push(node);
    else if (node) roots.push(node);
  });
  return roots;
}

export default function Comments({ postId, locked }: { postId: string; locked?: boolean }) {
  const { anonId, toast, accountStatus } = useApp();
  const restricted = !!(accountStatus?.banned || accountStatus?.suspended);
  const [comments, setComments] = useState<CommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [asAdmin, setAsAdmin] = useState(false);
  const [moderation, setModeration] = useState<ModerationResult | null>(null);
  const modSeq = useRef(0);
  const isAdminSession = hasAdminSession();

  const load = useCallback(async () => {
    try {
      const data = await api.get<CommentData[]>(`/api/comments?post_id=${postId}&viewer=${anonId}`);
      setComments(data.filter((c) => !c.deleted));
    } catch {
      toast('Could not load comments — will retry shortly', 'err');
    }
    setLoading(false);
  }, [postId, anonId, toast]);

  useEffect(() => { load(); }, [load]);

  // 🔴 new comments appear live for everyone in the thread
  useRealtime(['comments'], () => load());

  // Live moderation on comment text
  useEffect(() => {
    if (text.length < 3) { setModeration(null); return; }
    const seq = ++modSeq.current;
    const t = setTimeout(() => {
      if (seq === modSeq.current) setModeration(moderateContent(text));
    }, 200);
    return () => clearTimeout(t);
  }, [text]);

  const submit = async () => {
    const body = sanitize(text, 500);
    if (body.length < 2) { toast('Comment is too short', 'err'); return; }
    const cd = checkCooldown('comment', 8);
    if (cd) { toast(`Please wait ${cd}s before commenting again`, 'err'); return; }
    // Check moderation before submission
    const mod = moderateContent(text);
    if (isBlocked(mod)) {
      toast('Content blocked: please remove inappropriate language', 'err');
      return;
    }
    // Use masked text for submission
    const maskedBody = sanitize(mod.maskedText, 500);
    setBusy(true);
    try {
      await api.post('/api/comments', { post_id: postId, parent_id: replyTo, author_id: anonId, body: maskedBody, is_admin: asAdmin && isAdminSession });
      stampCooldown('comment');
      setText(''); setReplyTo(null);
      await load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to post comment', 'err'); }
    setBusy(false);
  };

  const saveEdit = async (id: string) => {
    try {
      await api.put('/api/comments', { id, author_id: anonId, body: sanitize(editText, 500) });
      setEditing(null); await load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to save edit', 'err'); }
  };

  const del = async (id: string) => {
    try {
      await api.put('/api/comments', { id, author_id: anonId, deleted: true });
      await load();
      toast('Comment deleted', 'info', {
        label: 'Undo (30s)',
        fn: async () => {
          await api.put('/api/comments', { id, author_id: anonId, deleted: false });
          await load(); toast('Comment restored', 'ok');
        },
      });
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to delete comment', 'err'); }
  };

  const report = async (id: string, reason: string) => {
    try {
      await api.post('/api/reports', { target_id: id, target_type: 'comment', reason: sanitize(reason, 300), author_id: anonId });
      toast('Reported — our moderators will review it', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to submit report', 'err'); }
  };

  const renderNode = (c: CommentNode, depth: number) => (
    <div key={c.id} className={depth > 0 ? 'ml-5 sm:ml-8 border-l-2 border-border pl-3 sm:pl-4' : ''}>
      <div className="py-2.5 transition-colors duration-150 hover:bg-surface2/30 rounded-lg px-2 -mx-2">
        <div className="flex items-center gap-2 text-xs">
          {c.is_admin
            ? <span className="chip !bg-accent !text-white !border-transparent"><ShieldCheck size={11} /> Admin</span>
            : <span className="font-mono text-ink3">{c.is_mine ? 'You' : (c.author_id?.slice(0, 10) ?? 'anon')}</span>}
          <span className="text-ink3">{timeAgo(c.created_at)}{c.edited ? ' · edited' : ''}</span>
        </div>
        {editing === c.id ? (
          <div className="mt-1.5 flex gap-2">
            <input className="input !py-1.5 text-sm" value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={500} aria-label="Edit comment" />
            <button className="btn btn-primary !py-1.5 !px-3 !text-xs" onClick={() => saveEdit(c.id)}>Save</button>
            <button className="btn btn-ghost !py-1.5 !px-3 !text-xs" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        ) : (
          <p className="text-sm mt-1 prose-desc">{c.body}</p>
        )}
        <div className="flex items-center gap-2.5 mt-1.5">
          {!locked && <button className="text-[11px] font-semibold text-ink3 hover:text-accent flex items-center gap-1" onClick={() => { setReplyTo(c.id); document.getElementById('comment-input')?.focus(); }}><Reply size={11} /> Reply</button>}
          {c.is_mine && !c.is_admin && (
            <>
              <button className="text-[11px] font-semibold text-ink3 hover:text-accent flex items-center gap-1" onClick={() => { setEditing(c.id); setEditText(c.body); }}><Pencil size={11} /> Edit</button>
              <button className="text-[11px] font-semibold text-ink3 hover:text-bad flex items-center gap-1" onClick={() => del(c.id)}><Trash2 size={11} /> Delete</button>
            </>
          )}
          <button className="text-[11px] font-semibold text-ink3 hover:text-warn flex items-center gap-1" onClick={() => setReportTarget(c.id)}><Flag size={11} /> Report</button>
        </div>
      </div>
      {c.children.map((ch) => renderNode(ch, depth + 1))}
    </div>
  );

  const tree = useMemo(() => buildTree(comments), [comments]);

  return (
    <section aria-label="Comments">
      <h2 className="font-display font-semibold text-sm mb-2">{comments.length} Comment{comments.length !== 1 ? 's' : ''}</h2>
      {locked ? (
        <p className="text-sm text-ink3 bg-surface2 rounded-xl px-4 py-3 flex items-center gap-2"><Lock size={14} /> Comments are locked on this post.</p>
      ) : restricted ? (
        <p className="text-sm rounded-xl px-4 py-3 flex items-center gap-2" style={{ background: 'rgba(220,75,75,0.08)', color: '#dc4b4b' }}>
          {accountStatus?.banned ? <><Ban size={14} /> Commenting is disabled — this ID is banned.</> : <><Pause size={14} /> Commenting is paused while your ID is suspended.</>}
        </p>
      ) : (
        <div className="card p-3">
          {replyTo && (
            <div className="flex items-center gap-2 text-xs text-accent mb-2 bg-accent-soft rounded-lg px-2.5 py-1.5">
              <CornerDownRight size={12} /> Replying to a comment
              <button className="ml-auto font-semibold" onClick={() => setReplyTo(null)}>Cancel</button>
            </div>
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input id="comment-input" className={`input flex-1 transition-all duration-200 ${moderation?.flags.some(f => f.severity === 'critical' || f.severity === 'high') ? 'moderation-flag border-bad' : moderation && moderation.flags.length === 0 && text.length > 5 ? 'moderation-ok border-good' : ''}`} placeholder={asAdmin ? 'Reply as Admin (official)…' : 'Add an anonymous comment…'} value={text}
              onChange={(e) => setText(e.target.value)} maxLength={500}
              aria-label="Comment text" />
            <button type="submit" className="btn btn-primary !px-3.5 transition-all duration-200" disabled={busy || text.trim().length < 2 || (moderation ? isBlocked(moderation) : false)} aria-label="Send comment">
              {moderation && isBlocked(moderation) ? <ShieldAlert size={15} /> : <Send size={15} />}
            </button>
          </form>
          {/* Comment moderation feedback */}
          {moderation && moderation.flags.length > 0 && (
            <div className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs ${isBlocked(moderation) ? 'moderation-blocked' : moderation.overallSeverity === 'medium' ? 'moderation-warn' : 'moderation-info'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                {isBlocked(moderation) ? <ShieldAlert size={11} className="text-bad" /> : <ShieldCheck size={11} className="text-warn" />}
                <span className="font-semibold">{isBlocked(moderation) ? 'Content blocked' : 'Content flagged'}</span>
              </div>
              {moderation.flags.slice(0, 2).map((flag, i) => (
                <p key={i} className="text-ink2 mt-0.5">{flag.message}</p>
              ))}
              {isBlocked(moderation) && <p className="mt-1 font-semibold" style={{ color: 'var(--vb-bad)' }}>Please fix to continue.</p>}
            </div>
          )}
          <div className="flex items-center justify-between mt-1.5">
            {isAdminSession ? (
              <button onClick={() => setAsAdmin((a) => !a)} role="switch" aria-checked={asAdmin}
                className={`flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg transition-all ${asAdmin ? 'bg-accent text-white' : 'bg-surface2 text-ink3 hover:text-ink2'}`}>
                <ShieldCheck size={11} /> {asAdmin ? 'Posting as Admin' : 'Post as Admin'}
              </button>
            ) : <span />}
            <p className="text-[10px] text-ink3">{text.length}/500</p>
          </div>
        </div>
      )}
      <div className="mt-3 divide-y divide-border">
        {loading && <div className="space-y-3 py-3">{[1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>}
        {!loading && tree.length === 0 && (
          <p className="text-sm text-ink3 py-6 text-center">No comments yet — start the discussion anonymously.</p>
        )}
        {tree.map((c) => renderNode(c, 0))}
      </div>
      <ReportDialog open={!!reportTarget} onClose={() => setReportTarget(null)} onSubmit={(reason) => reportTarget && report(reportTarget, reason)} />
    </section>
  );
}
