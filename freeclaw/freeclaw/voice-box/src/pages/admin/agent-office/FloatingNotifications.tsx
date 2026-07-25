import { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle2, AlertTriangle, Zap, Bell } from 'lucide-react';
import type { WorkflowResult } from './types';
import { api } from '../../../lib/api';

interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'spawn';
  message: string;
  detail?: string;
  time: string;
  dismissAt: number;
}

const ICON_MAP = {
  success: <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />,
  error: <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />,
  info: <Bell size={14} className="text-sky-400 flex-shrink-0" />,
  spawn: <Zap size={14} className="text-amber-400 flex-shrink-0" />,
};

/* ═══════════════════════════════════════════════════════════════
   FLOATING NOTIFICATIONS — Real events from backend workflow results
   Smooth toast-in animation + auto-dismiss progress bar
   ═══════════════════════════════════════════════════════════════ */
export default function FloatingNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastCount, setLastCount] = useState(0);

  // Poll backend for new workflow results
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await api.get<{ results?: WorkflowResult[] }>('/api/agent-team?action=results&limit=5');
        const results: WorkflowResult[] = r.results || [];

        if (results.length > lastCount && lastCount > 0) {
          const newResults = results.slice(0, results.length - lastCount + Math.min(3, results.length));
          const now = Date.now();
          const newNotifs: Notification[] = newResults.map((wf) => ({
            id: wf.workflow_id,
            type: 'success' as const,
            message: `Workflow completed: ${wf.task?.slice(0, 60) || 'Unknown task'}`,
            detail: `${wf.agents_used.length} agents · ${wf.total_time_ms}ms · ${wf.classification.division}`,
            time: new Date(wf.completed_at).toLocaleTimeString(),
            dismissAt: now + 12000,
          }));

          setNotifications((prev) => {
            const merged = [...newNotifs.reverse(), ...prev];
            return merged.slice(0, 8);
          });
        }

        setLastCount(results.length);
      } catch (e: unknown) { console.warn('[FloatingNotifications] polling failed:', e instanceof Error ? e.message : e); }
    };

    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [lastCount]);

  // Auto-dismiss oldest after 12s
  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setTimeout(() => {
      setNotifications((prev) => prev.slice(1));
    }, 12000);
    return () => clearTimeout(timer);
  }, [notifications.length]);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-4 z-40 space-y-2 pointer-events-none max-w-xs">
      {notifications.map((n) => (
        <div
          key={n.id}
          className="bg-surface border border-border rounded-xl shadow-lg px-3 py-2.5 flex items-start gap-2.5 pointer-events-auto toast-anim relative overflow-hidden"
        >
          <div className="mt-0.5">{ICON_MAP[n.type]}</div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-ink1 truncate">{n.message}</p>
            {n.detail && <p className="text-[9px] text-ink3 mt-0.5 font-mono truncate">{n.detail}</p>}
          </div>
          <button onClick={() => dismiss(n.id)} className="p-1 rounded-md hover:bg-surface2 flex-shrink-0 transition-colors">
            <X size={10} className="text-ink3" />
          </button>
          {/* Auto-dismiss progress bar */}
          <div className="absolute bottom-0 left-0 h-0.5 bg-accent/40 animate-[shrink_12s_linear_forwards]" style={{ width: '100%' }} />
        </div>
      ))}
    </div>
  );
}
