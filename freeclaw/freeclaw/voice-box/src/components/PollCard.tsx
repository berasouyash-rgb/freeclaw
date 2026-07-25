import { useState } from 'react';
import { Clock, Archive, CheckCircle2, BarChart3, Trash2, RotateCcw, Sparkles } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import { timeAgo } from '../lib/utils';
import { ConfirmDialog } from './ui';
import type { PollData } from '../types';

interface PollCardProps {
  poll: PollData;
  myVote?: number[];
  onVoted?: () => void;
  onDeleted?: () => void;
}

export default function PollCard({ poll, myVote, onVoted, onDeleted }: PollCardProps) {
  const { anonId, toast } = useApp();
  const [selected, setSelected] = useState<number[]>(myVote || []);
  const [voted, setVoted] = useState((myVote || []).length > 0);
  const [changingVote, setChangingVote] = useState(false);
  const [local, setLocal] = useState<PollData | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const p = local || poll;
  const isOwner = p.is_mine === true || p.author_id === anonId;

  const deleteOwn = async () => {
    try {
      await api.put('/api/polls', { id: p.id, author_id: anonId, deleted: true });
      toast('Poll deleted', 'info', {
        label: 'Undo (30s)',
        fn: async () => {
          await api.put('/api/polls', { id: p.id, author_id: anonId, deleted: false });
          toast('Poll restored', 'ok'); onDeleted?.();
        },
      });
      onDeleted?.();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to delete poll', 'err'); }
  };
  const expired = p.expires_at && new Date(p.expires_at) < new Date();
  const closed = expired || p.archived;
  const total = p.total_votes || 0;
  const showResults = voted && !changingVote || closed;

  const toggle = (i: number) => {
    if (closed && !changingVote) return;
    if (p.ptype === 'multi') setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
    else setSelected((s) => (s.includes(i) ? [] : [i])); // tap again to deselect in single-choice
  };

  const vote = async () => {
    if (!selected.length) { toast('Select an option first', 'err'); return; }
    setBusy(true);
    try {
      const res = await api.post<PollData>('/api/polls', { action: 'vote', poll_id: p.id, author_id: anonId, choices: selected });
      setLocal(res); setVoted(true); setChangingVote(false); onVoted?.();
      toast(voted ? 'Vote updated — anonymously 🔒' : 'Vote recorded — anonymously 🔒', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to record vote', 'err'); }
    setBusy(false);
  };

  const startChangeVote = () => {
    setChangingVote(true);
  };

  const cancelChangeVote = () => {
    setChangingVote(false);
    setSelected(myVote || []);
  };

  return (
    <div className="card p-4 sm:p-5 vb-rise">
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="font-display font-semibold text-[15px] leading-snug flex items-center gap-2"><BarChart3 size={16} className="text-accent shrink-0" />{p.title}</h3>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {p.archived && <span className="chip"><Archive size={11} /> Archived</span>}
          {expired && !p.archived && <span className="chip !text-warn"><Clock size={11} /> Ended</span>}
          {p.expires_at && !expired && <span className="chip"><Clock size={11} /> ends {timeAgo(p.expires_at).replace(' ago', '')}</span>}
        </div>
      </div>
      {changingVote && (
        <p className="text-xs font-semibold text-accent mb-2 flex items-center gap-1.5"><RotateCcw size={12} /> Pick your new choice — then submit below</p>
      )}
      <div className="space-y-2" role={p.ptype === 'multi' ? 'group' : 'radiogroup'} aria-label={p.title}>
        {(p.options || []).map((opt: string, i: number) => {
          const n = p.vote_counts?.[i] || 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          const isMine = selected.includes(i);
          const wasOriginal = (myVote || []).includes(i);
          return (
            <button key={i} onClick={() => toggle(i)} disabled={closed && !changingVote}
              role={p.ptype === 'multi' ? 'checkbox' : 'radio'} aria-checked={isMine}
              className={`relative w-full text-left rounded-xl border overflow-hidden transition-all ${isMine && (!showResults || changingVote) ? 'border-accent bg-accent-soft' : 'border-border hover:border-accent/50'} ${closed && !changingVote ? 'cursor-default' : ''}`}>
              {showResults && !changingVote && (
                <span className="absolute inset-y-0 left-0 bg-accent-soft vb-bar-anim" style={{ width: `${pct}%` }} aria-hidden />
              )}
              <span className="relative flex items-center justify-between px-3.5 py-2.5 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  {isMine && showResults && !changingVote && <CheckCircle2 size={14} className="text-accent" />}
                  {changingVote && isMine && <RotateCcw size={13} className="text-accent" />}
                  {opt}
                  {changingVote && wasOriginal && !isMine && <span className="text-[10px] text-ink3">(your previous pick)</span>}
                </span>
                {showResults && !changingVote && <span className="font-mono text-xs font-semibold text-accent">{pct}% · {n}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-ink3">{total} vote{total !== 1 ? 's' : ''} · {p.ptype === 'multi' ? 'multiple choice' : p.ptype === 'yesno' ? 'yes / no' : 'single choice'}</span>
        <div className="flex items-center gap-1.5">
          {isOwner && <button className="btn btn-danger !p-1.5" onClick={() => setShowDelete(true)} aria-label="Delete my poll" title="Delete my poll"><Trash2 size={13} /></button>}
          {!closed && !voted && <button className="btn btn-primary !py-1.5 !px-4 !text-xs" onClick={vote} disabled={busy || !selected.length}>{busy ? 'Voting…' : 'Vote'}</button>}
          {!closed && voted && !changingVote && (
            <button className="btn btn-ghost !py-1.5 !px-3 !text-xs transition-all duration-200 hover:shadow-sm" onClick={startChangeVote} disabled={busy}>
              <RotateCcw size={12} className="transition-transform duration-200 hover:rotate-[-45deg]" /> Change vote
            </button>
          )}
          {!closed && changingVote && (
            <>
              <button className="btn btn-ghost !py-1.5 !px-3 !text-xs" onClick={cancelChangeVote} disabled={busy}>Cancel</button>
              <button className="btn btn-primary !py-1.5 !px-4 !text-xs" onClick={vote} disabled={busy || !selected.length}>{busy ? 'Updating…' : 'Submit new vote'}</button>
            </>
          )}
        </div>
      </div>
      {/* AI insight on results */}
      {showResults && total > 0 && <PollInsight poll={p} />}

      <ConfirmDialog open={showDelete} onClose={() => setShowDelete(false)} onConfirm={deleteOwn}
        title="Delete your poll?" message="Your poll will be removed. You can undo within 30 seconds using the toast at the bottom of the screen." confirmLabel="Delete poll" danger />
    </div>
  );
}

/** One-line AI insight, fetched lazily on demand */
function PollInsight({ poll }: { poll: PollData }) {
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchInsight = async () => {
    setLoading(true);
    try {
      const r = await api.post<{ insight?: string }>('/api/ai', { task: 'poll_insight', poll: { title: poll.title, options: poll.options, vote_counts: poll.vote_counts, total_votes: poll.total_votes } });
      setInsight(r.insight ?? null);
    } catch { setInsight('Insight unavailable right now.'); }
    setLoading(false);
  };

  if (insight) {
    return <p className="text-xs mt-3 px-3 py-2 rounded-xl vb-rise flex items-start gap-2" style={{ background: 'var(--vb-accent-soft)', color: 'var(--vb-accent)' }}><Sparkles size={14} className="shrink-0 mt-0.5" /><span>{insight}</span></p>;
  }
  return (
    <button className="flex items-center gap-1.5 text-[11px] font-semibold text-accent mt-3 hover:underline disabled:opacity-50 transition-colors" onClick={fetchInsight} disabled={loading}>
      <Sparkles size={12} /> {loading ? 'Analyzing results…' : 'Get AI insight on results'}
    </button>
  );
}
