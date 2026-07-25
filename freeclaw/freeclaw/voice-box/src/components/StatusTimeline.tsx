import { useEffect, useRef, useState } from 'react';
import { STATUS_META } from '../lib/utils';
import { CheckCircle2, Circle } from 'lucide-react';
import PurgeCountdown from './PurgeCountdown';

const ORDER = ['reported', 'verified', 'in_progress', 'waiting', 'solved'];

interface StatusHistoryEntry {
  status: string;
  at: string;
  note?: string;
}

interface StatusPost {
  status: string;
  progress?: number;
  eta?: string;
  purge_at?: string;
  status_history?: StatusHistoryEntry[];
}

/**
 * Animated resolution pipeline. Stage icons pop in sequentially, connectors
 * slide left→right, progress bar animates, and when the status CHANGES while
 * the user is watching, the whole pipeline re-animates + flashes so the
 * change is unmissable.
 */
export default function StatusTimeline({ post }: { post: StatusPost }) {
  const history: StatusHistoryEntry[] = post.status_history || [];
  const currentIdx = post.status === 'archived' ? ORDER.length - 1 : ORDER.indexOf(post.status);
  const prevStatus = useRef(post.status);
  const [replayKey, setReplayKey] = useState(0);
  const [flash, setFlash] = useState(false);

  // Re-animate when status changes live
  useEffect(() => {
    if (prevStatus.current !== post.status) {
      prevStatus.current = post.status;
      setReplayKey((k) => k + 1);
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [post.status]);

  return (
    <div key={replayKey} className={`rounded-xl transition-colors ${flash ? 'vb-status-flash' : ''}`}>
      {/* progress bar */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-ink2">Progress</span>
        <span className="text-xs font-mono font-bold text-accent vb-pop" key={post.progress}>{post.progress ?? 0}%</span>
      </div>
      <div className="h-2 rounded-full bg-surface2 overflow-hidden mb-4" role="progressbar" aria-valuenow={post.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent vb-bar-anim" style={{ width: `${post.progress ?? 0}%` }} />
      </div>

      {/* animated stage pipeline with sliding connectors */}
      <ol className="flex items-start mb-4" aria-label="Status stages">
        {ORDER.map((s, i) => {
          const meta = STATUS_META[s] ?? { label: s, color: 'var(--vb-ink3)', pct: 0 };
          const done = i <= currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <li key={s} className="flex-1 flex flex-col items-center gap-1 min-w-0 relative">
              {/* connector line sliding in from the previous stage */}
              {i > 0 && (
                <span
                  className={`absolute top-2 right-1/2 h-0.5 ${i <= currentIdx ? 'vb-connector' : ''}`}
                  style={{
                    width: '100%', zIndex: 0,
                    background: i <= currentIdx ? meta.color : 'var(--vb-border)',
                    animationDelay: `${i * 150}ms`,
                  }} aria-hidden />
              )}
              <span className={`relative z-10 bg-surface rounded-full ${done ? 'vb-stage-pop' : ''}`} style={{ animationDelay: `${i * 150 + 100}ms` }}>
                {done
                  ? <CheckCircle2 size={17} style={{ color: meta.color }} className={isCurrent ? 'vb-glow rounded-full' : ''} />
                  : <Circle size={17} className="text-ink3/50" />}
              </span>
              <span className={`text-[9px] sm:text-[10px] font-semibold truncate ${done ? '' : 'text-ink3'}`}
                style={done ? { color: meta.color } : undefined}>
                {meta.label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* auto-deletion countdown for solved/archived posts */}
      {post.purge_at && (
        <div className="mb-3">
          <PurgeCountdown purgeAt={post.purge_at} />
          <p className="text-[10px] text-ink3 mt-1">Commenting or reacting resets the 5-day countdown.</p>
        </div>
      )}

      {/* history entries slide in sequentially */}
      {history.length > 0 && (
        <ul className="space-y-2">
          {[...history].reverse().map((h, i) => (
            <li key={`${h.at}-${i}`} className="flex gap-2.5 text-xs vb-slide-in" style={{ animationDelay: `${i * 90}ms` }}>
              <span className="w-2 h-2 rounded-full mt-1 shrink-0 vb-stage-pop" style={{ background: STATUS_META[h.status]?.color || '#888', animationDelay: `${i * 90 + 60}ms` }} />
              <div>
                <span className="font-semibold">{STATUS_META[h.status]?.label || h.status}</span>
                <span className="text-ink3"> · {new Date(h.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                {h.note && <p className="text-ink2 mt-0.5 vb-text-appear" style={{ animationDelay: `${i * 90 + 150}ms` }}>{h.note}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {post.eta && <p className="text-xs text-ink2 mt-3">⏳ Estimated completion: <span className="font-semibold">{post.eta}</span></p>}
    </div>
  );
}
