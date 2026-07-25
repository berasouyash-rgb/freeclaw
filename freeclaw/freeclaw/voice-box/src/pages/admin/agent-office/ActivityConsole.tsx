import { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronRight } from 'lucide-react';
import type { WorkflowResult } from './types';
import { api } from '../../../lib/api';

interface ActivityEvent {
  id: string;
  time: string;
  type: 'spawn' | 'complete' | 'error' | 'info';
  icon: string;
  agent: string;
  message: string;
}

const TYPE_STYLES: Record<string, { label: string; color: string; dot: string }> = {
  spawn:    { label: 'spawned', color: 'text-amber-400', dot: 'bg-amber-400' },
  complete: { label: 'done',     color: 'text-emerald-400', dot: 'bg-emerald-400' },
  error:    { label: 'error',    color: 'text-red-400', dot: 'bg-red-400' },
  info:     { label: 'info',     color: 'text-sky-400', dot: 'bg-sky-400' },
};
const DEFAULT_STYLE = { label: 'info', color: 'text-sky-400', dot: 'bg-sky-400' };

/* ═══════════════════════════════════════════════════════════════
   ACTIVITY CONSOLE — Real events from backend workflow results
   Scrolling event feed showing agent spawn/completion/result
   ═══════════════════════════════════════════════════════════════ */
export default function ActivityConsole() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [lastCount, setLastCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll backend for new workflow results
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await api.get<{ results?: WorkflowResult[] }>('/api/agent-team?action=results&limit=20');
        const results: WorkflowResult[] = r.results || [];

        if (results.length > lastCount && lastCount > 0) {
          const newEvents: ActivityEvent[] = [];

          for (const wf of results.slice(0, Math.min(5, results.length - lastCount + 1))) {
            // Spawn event
            newEvents.push({
              id: `${wf.workflow_id}_spawn`,
              time: new Date(wf.created_at).toLocaleTimeString(),
              type: 'spawn',
              icon: '🚀',
              agent: wf.agents_used[0]?.name || 'System',
              message: `Spawned ${wf.agents_used.length} agents for: ${wf.task?.slice(0, 50) || 'task'}`,
            });

            // Individual agent completions
            for (const r2 of wf.results || []) {
              newEvents.push({
                id: `${wf.workflow_id}_${r2.agent_id}`,
                time: new Date(wf.completed_at).toLocaleTimeString(),
                type: r2.result?.error ? 'error' : 'complete',
                icon: r2.icon,
                agent: r2.agent_name,
                message: r2.result?.error
                  ? `Error: ${String(r2.result.error).slice(0, 60)}`
                  : `Completed — ${String(r2.result?.type || 'processed').replace(/_/g, ' ')}`,
              });
            }
          }

          setEvents((prev) => {
            const merged = [...newEvents.reverse(), ...prev];
            return merged.slice(0, 50); // max 50 events
          });
        }

        setLastCount(results.length);
      } catch (e: unknown) { console.warn('[ActivityConsole] polling failed:', e instanceof Error ? e.message : e); }
    };

    poll();
    const iv = setInterval(poll, 4000);
    return () => clearInterval(iv);
  }, [lastCount]);

  // Auto-scroll to top on new events
  useEffect(() => {
    if (scrollRef.current && expanded) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length, expanded]);

  return (
    <div className="bg-surface2 rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface2/80 transition-colors"
      >
        <Terminal size={14} className="text-ink3" />
        <span className="text-[11px] font-bold text-ink1 flex-1 text-left">Activity Console</span>
        <span className="text-[9px] text-ink3 font-mono">{events.length} events</span>
        {expanded ? <ChevronDown size={12} className="text-ink3" /> : <ChevronRight size={12} className="text-ink3" />}
      </button>

      {/* Event list */}
      {expanded && (
        <div ref={scrollRef} className="max-h-48 overflow-y-auto border-t border-border">
          {events.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-[10px] text-ink3">Waiting for agent activity…</p>
              <p className="text-[9px] text-ink3/60 mt-1">Spawn agents to see real events here</p>
            </div>
          )}
          {events.map((evt) => {
            const style = TYPE_STYLES[evt.type] ?? DEFAULT_STYLE;
            return (
              <div
                key={evt.id}
                className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface/50 transition-colors chat-msg-anim"
              >
                {/* Status dot */}
                <span className={`w-2 h-2 rounded-full ${style.dot} flex-shrink-0 mt-1.5`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px]">{evt.icon}</span>
                    <span className="text-[10px] font-bold text-ink1">{evt.agent}</span>
                    <span className={`text-[9px] font-mono font-bold ${style.color}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="text-[9px] text-ink3 truncate font-mono mt-0.5">{evt.message}</p>
                </div>
                <span className="text-[8px] text-ink3/60 font-mono flex-shrink-0 mt-0.5">{evt.time}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
