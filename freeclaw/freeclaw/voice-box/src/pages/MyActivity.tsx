import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserCircle2, Download, RefreshCcw, Trash2, Bookmark, FileText, MessageCircle, BarChart3, Bell, Eye, Save, AlertTriangle, PlayCircle } from 'lucide-react';
import { resetTutorial } from '../components/Tutorial';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import { timeAgo, downloadFile, safeStringify } from '../lib/utils';
import { resetAnonId, clearAllLocalData, anonCreatedAt, lsGet } from '../lib/identity';
import { ConfirmDialog } from '../components/ui';
import type { PostData, CommentData, PollData, PollVote, ReactionEntry } from '../types';

type Tab = 'posts' | 'polls' | 'comments' | 'votes' | 'bookmarks' | 'drafts' | 'notifications' | 'viewed';

export default function MyActivity() {
  const { anonId, toast, refreshIdentity, notifications, bookmarks, recentlyViewed } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('posts');
  const [posts, setPosts] = useState<PostData[]>([]);
  const [myPolls, setMyPolls] = useState<PollData[]>([]);
  const [comments, setComments] = useState<CommentData[]>([]);
  const [reactions, setReactions] = useState<ReactionEntry[]>([]);
  const [pollVotes, setPollVotes] = useState<PollVote[]>([]);
  const [bookmarkPosts, setBookmarkPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ kind: 'deletePost' | 'deletePoll' | 'resetId' | 'clearData'; payload?: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [myPosts, myComments, myReactions, myVotes, allPolls] = await Promise.all([
        api.get<PostData[]>(`/api/posts?author=${anonId}`),
        api.get<CommentData[]>(`/api/comments?author=${anonId}`),
        api.get<ReactionEntry[]>(`/api/reactions?author=${anonId}`),
        api.get<PollVote[]>(`/api/polls?voter=${anonId}`),
        api.get<PollData[]>(`/api/polls?viewer=${anonId}`),
      ]);
      setPosts(myPosts);
      setMyPolls(allPolls.filter((p) => p.is_mine && !p.deleted));
      setComments(myComments.filter((c) => !c.deleted));
      setReactions(myReactions);
      setPollVotes(myVotes);
      if (bookmarks.length) {
        const bp = await api.get<PostData[]>(`/api/posts?ids=${bookmarks.join(',')}`);
        setBookmarkPosts(bp);
      } else setBookmarkPosts([]);
    } catch { /* offline ok */ }
    setLoading(false);
  }, [anonId, bookmarks]);

  useEffect(() => { load(); }, [load]);

  const deletePoll = async (id: string) => {
    try {
      await api.put('/api/polls', { id, author_id: anonId, deleted: true });
      setMyPolls((p) => p.filter((x) => x.id !== id));
      toast('Poll deleted', 'info', {
        label: 'Undo (30s)',
        fn: async () => { await api.put('/api/polls', { id, author_id: anonId, deleted: false }); load(); toast('Poll restored', 'ok'); },
      });
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Delete failed', 'err'); }
  };

  const deletePost = async (id: string) => {
    try {
      await api.put('/api/posts', { id, author_id: anonId, deleted: true });
      setPosts((p) => p.filter((x) => x.id !== id));
      toast('Deleted', 'info', {
        label: 'Undo (30s)',
        fn: async () => { await api.put('/api/posts', { id, author_id: anonId, deleted: false }); load(); toast('Restored', 'ok'); },
      });
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Delete failed', 'err'); }
  };

  const exportData = () => {
    downloadFile(`voicebox-activity-${anonId.slice(0, 10)}.json`, safeStringify({
      anon_id: anonId, exported_at: new Date().toISOString(),
      posts, comments, reactions, poll_votes: pollVotes, bookmarks, notifications, recently_viewed: recentlyViewed,
      draft: lsGet('vb:drafts', null),
    }, 2));
    toast('Activity exported', 'ok');
  };

  const doResetId = () => {
    resetAnonId(); refreshIdentity();
    toast('New anonymous identity created 🆕', 'ok');
  };

  const doClear = () => {
    clearAllLocalData(); refreshIdentity();
    toast('Local data cleared', 'ok');
  };

  const draft = lsGet<{ title?: string; desc?: string; savedAt?: string } | null>('vb:drafts', null);

  const TABS: { key: Tab; label: string; icon: typeof FileText; count: number }[] = [
    { key: 'posts', label: 'Posts', icon: FileText, count: posts.length },
    { key: 'polls', label: 'My Polls', icon: BarChart3, count: myPolls.length },
    { key: 'comments', label: 'Comments', icon: MessageCircle, count: comments.length },
    { key: 'votes', label: 'Votes', icon: BarChart3, count: reactions.length + pollVotes.length },
    { key: 'bookmarks', label: 'Bookmarks', icon: Bookmark, count: bookmarks.length },
    { key: 'drafts', label: 'Drafts', icon: Save, count: draft?.title || draft?.desc ? 1 : 0 },
    { key: 'notifications', label: 'Notifications', icon: Bell, count: notifications.length },
    { key: 'viewed', label: 'Recently viewed', icon: Eye, count: recentlyViewed.length },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      {/* Profile card */}
      <div className="card p-5 sm:p-6 mb-5 vb-rise">
        <div className="flex items-center gap-4">
          <span className="w-14 h-14 rounded-2xl bg-accent-soft grid place-items-center text-accent"><UserCircle2 size={30} /></span>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg">Anonymous profile</h1>
            <p className="text-xs text-ink3">ID <code className="font-mono text-accent">{anonId}</code> · created {timeAgo(anonCreatedAt())}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button className="btn btn-ghost !text-xs" onClick={exportData}><Download size={13} /> Export activity</button>
          <button className="btn btn-ghost !text-xs" onClick={() => { resetTutorial(); nav('/'); }}><PlayCircle size={13} /> Replay tutorial</button>
          <button className="btn btn-ghost !text-xs" onClick={() => setDialog({ kind: 'resetId' })}><RefreshCcw size={13} /> Reset anonymous ID</button>
          <button className="btn btn-danger !text-xs" onClick={() => setDialog({ kind: 'clearData' })}><Trash2 size={13} /> Clear local data</button>
        </div>
        <p className="text-[11px] text-ink3 mt-3 flex items-start gap-1.5"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> Your ID lives only in this browser. Voice Box never stores names, emails, phone numbers, IPs, or device fingerprints.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4">
        {TABS.map(({ key, label, icon: Icon, count }) => (
          <button key={key} onClick={() => setTab(key)} className={`btn !py-1.5 !px-3 !text-xs shrink-0 ${tab === key ? 'btn-primary' : 'btn-ghost'}`}>
            <Icon size={13} /> {label} <span className="opacity-70">({count})</span>
          </button>
        ))}
      </div>

      {loading && <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}</div>}

      {!loading && tab === 'posts' && (
        <div className="space-y-2.5">
          {posts.length === 0 && <Empty text="You haven't posted anything yet." />}
          {posts.map((p) => (
            <div key={p.id} className="card p-3.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Link to={`/post/${p.id}`} className="font-semibold text-sm hover:text-accent line-clamp-1">{p.title}</Link>
                <p className="text-xs text-ink3">{p.type} · {p.category} · {p.status.replace('_', ' ')} · {timeAgo(p.created_at)}</p>
              </div>
              <button className="btn btn-danger !p-2 shrink-0" onClick={() => setDialog({ kind: 'deletePost', payload: p.id })} aria-label="Delete post"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'polls' && (
        <div className="space-y-2.5">
          {myPolls.length === 0 && <Empty text="You haven't created any polls yet." />}
          {myPolls.map((p) => (
            <div key={p.id} className="card p-3.5 flex items-center gap-3 vb-rise">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm line-clamp-1">{p.title}</p>
                <p className="text-xs text-ink3">{p.total_votes || 0} votes · {p.ptype} · {p.archived ? 'archived' : 'active'} · {timeAgo(p.created_at ?? '')}</p>
              </div>
              <Link to="/polls" className="btn btn-ghost !text-xs shrink-0">View</Link>
              <button className="btn btn-danger !p-2 shrink-0" onClick={() => setDialog({ kind: 'deletePoll', payload: p.id })} aria-label="Delete poll"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'comments' && (
        <div className="space-y-2.5">
          {comments.length === 0 && <Empty text="No comments yet." />}
          {comments.map((c) => (
            <div key={c.id} className="card p-3.5">
              <p className="text-sm line-clamp-2">{c.body}</p>
              <div className="flex justify-between mt-1">
                <Link to={`/post/${c.post_id}`} className="text-xs text-accent font-semibold hover:underline">View thread →</Link>
                <span className="text-xs text-ink3">{timeAgo(c.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'votes' && (
        <div className="space-y-2.5">
          {reactions.length + pollVotes.length === 0 && <Empty text="No votes or reactions yet." />}
          {reactions.map((r) => (
            <div key={r.id} className="card p-3 flex items-center gap-2 text-sm">
              <span className="chip capitalize">{r.kind}</span>
              <Link to={`/post/${r.target_id}`} className="text-accent text-xs font-semibold hover:underline truncate">on {r.target_type} {r.target_id.slice(0, 16)}…</Link>
            </div>
          ))}
          {pollVotes.map((v, i) => (
            <div key={i} className="card p-3 flex items-center gap-2 text-sm">
              <span className="chip">poll vote</span>
              <span className="text-xs text-ink3">choices: {v.choices.join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'bookmarks' && (
        <div className="space-y-2.5">
          {bookmarkPosts.length === 0 && <Empty text="No bookmarks yet — tap the bookmark icon on any post." />}
          {bookmarkPosts.map((p) => (
            <Link key={p.id} to={`/post/${p.id}`} className="card card-hover p-3.5 block">
              <p className="font-semibold text-sm line-clamp-1">{p.title}</p>
              <p className="text-xs text-ink3">{p.category} · {timeAgo(p.created_at)}</p>
            </Link>
          ))}
        </div>
      )}

      {!loading && tab === 'drafts' && (
        draft?.title || draft?.desc ? (
          <div className="card p-4">
            <p className="font-semibold text-sm">{draft.title || '(untitled draft)'}</p>
            <p className="text-xs text-ink2 mt-1 line-clamp-3">{draft.desc}</p>
            <p className="text-[11px] text-ink3 mt-2">Autosaved {draft.savedAt ? timeAgo(draft.savedAt) : ''}</p>
            <Link to="/submit" className="btn btn-soft !text-xs mt-3 inline-flex">Continue editing →</Link>
          </div>
        ) : <Empty text="No drafts. Drafts autosave while you write." />
      )}

      {!loading && tab === 'notifications' && (
        <div className="space-y-2">
          {notifications.length === 0 && <Empty text="No notifications yet." />}
          {notifications.map((n) => (
            <div key={n.id} className="card p-3.5">
              <p className="text-sm font-medium">{n.title}</p>
              <p className="text-xs text-ink3">{n.body} · {timeAgo(n.at)}</p>
              {n.link && <Link to={n.link} className="text-xs text-accent font-semibold hover:underline">Open →</Link>}
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'viewed' && (
        <div className="space-y-2">
          {recentlyViewed.length === 0 && <Empty text="Nothing viewed recently." />}
          {recentlyViewed.map((id) => (
            <Link key={id} to={`/post/${id}`} className="card card-hover p-3 block text-sm font-mono text-ink2 hover:text-accent">{id}</Link>
          ))}
        </div>
      )}

      <ConfirmDialog open={dialog?.kind === 'deletePoll'} onClose={() => setDialog(null)}
        onConfirm={() => dialog?.payload && deletePoll(dialog.payload)} title="Delete this poll?"
        message="Your poll and its results will be removed. You can undo within 30 seconds." confirmLabel="Delete poll" danger />
      <ConfirmDialog open={dialog?.kind === 'deletePost'} onClose={() => setDialog(null)}
        onConfirm={() => dialog?.payload && deletePost(dialog.payload)} title="Delete this post?"
        message="Your post will be removed from the feed. You can undo within 30 seconds using the toast at the bottom of the screen." confirmLabel="Delete" danger />
      <ConfirmDialog open={dialog?.kind === 'resetId'} onClose={() => setDialog(null)}
        onConfirm={doResetId} title="Reset anonymous ID?"
        message="A new random identity will be created. You will permanently lose ownership of your existing posts, comments and votes — they stay public but can no longer be edited or deleted by you." confirmLabel="Reset ID" danger />
      <ConfirmDialog open={dialog?.kind === 'clearData'} onClose={() => setDialog(null)}
        onConfirm={doClear} title="Clear all local data?"
        message="This removes your anonymous ID, bookmarks, drafts and notifications from this browser. Public posts remain visible but you lose ownership of them." confirmLabel="Clear everything" danger />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="card p-8 text-center text-sm text-ink3">{text}</div>;
}
