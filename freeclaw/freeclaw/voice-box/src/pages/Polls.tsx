import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import PollCard from '../components/PollCard';
import { Segmented } from '../components/ui';
import { useRealtime } from '../lib/useRealtime';
import type { PollData, PollVote } from '../types';

export default function Polls() {
  const { anonId } = useApp();
  const [polls, setPolls] = useState<PollData[]>([]);
  const [votes, setVotes] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'active' | 'ended'>('active');

  const load = useCallback(async () => {
    try {
      setError('');
      const [data, myVotes] = await Promise.all([
        api.get<PollData[]>(`/api/polls?viewer=${anonId}`),
        api.get<PollVote[]>(`/api/polls?voter=${anonId}`),
      ]);
      setPolls(data.filter((p) => !p.deleted));
      const map: Record<string, number[]> = {};
      myVotes.forEach((v) => { map[v.poll_id] = v.choices; });
      setVotes(map);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load polls'); }
    setLoading(false);
  }, [anonId]);

  useEffect(() => { load(); }, [load]);

  // 🔴 poll results update live as votes come in
  useRealtime(['polls', 'poll_votes'], () => load());

  const isEnded = (p: PollData) => p.archived || (p.expires_at && new Date(p.expires_at) < new Date());
  const shown = polls.filter((p) => (tab === 'ended' ? isEnded(p) : !isEnded(p)));

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display font-bold text-2xl">Polls</h1>
        <Link to="/submit?type=poll" className="btn btn-primary !py-2"><PlusCircle size={15} /> New poll</Link>
      </div>
      <p className="text-sm text-ink3 mb-5">Vote anonymously. Results update live — change your vote anytime while a poll is open.</p>

      <div className="mb-4">
        <Segmented<'active' | 'ended'> value={tab} onChange={setTab} options={[
          { value: 'active', label: `Active (${polls.filter((p) => !isEnded(p)).length})` },
          { value: 'ended', label: `Ended & archived (${polls.filter(isEnded).length})` },
        ]} />
      </div>

      {error && <div className="card p-6 text-center"><p className="text-bad text-sm">{error}</p><button className="btn btn-soft mt-3" onClick={() => { setLoading(true); load(); }}>Retry</button></div>}
      {loading && <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-44" />)}</div>}
      {!loading && !error && shown.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-3xl mb-2">📊</p>
          <p className="font-display font-semibold">No {tab} polls</p>
          {tab === 'active' && <Link to="/submit?type=poll" className="btn btn-primary mt-4 inline-flex">Create the first poll</Link>}
        </div>
      )}
      <div className="space-y-3">
        <h2 className="sr-only">Poll List</h2>
        {shown.map((p) => (
          <div key={p.id}>
            <PollCard poll={p} myVote={votes[p.id]} onVoted={load} onDeleted={load} />
            {p.post_id && (
              <Link to={`/post/${p.post_id}`}
                className="flex items-center gap-2 -mt-1.5 mx-3 px-3.5 py-2.5 rounded-b-xl text-xs font-semibold text-accent transition-colors hover:brightness-95"
                style={{ background: 'var(--vb-accent-soft)', border: '1px solid rgba(86,82,214,0.15)', borderTop: 'none' }}>
                🔗 This poll is linked to a complaint — view the full issue & discussion →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
