import { useState, useEffect, useCallback } from 'react';
import { RefreshCcw, Activity, Zap, AlertTriangle, CheckCircle, Database, Shield, Brain, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { safeStringify } from '../../lib/utils';

/* ── Types ─────────────────────────────────────────────────── */
interface AgentExecution {
  id: string;
  agent_id: string;
  agent_name: string;
  division: string;
  task: string;
  status: string;
  output: unknown;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

interface ActivityLog {
  id: string;
  agent_id: string;
  event_type: string;
  severity: string;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
}

interface AgentStats {
  total: number;
  by_division: Record<string, number>;
  active: number;
  completed: number;
  failed: number;
}

/* ── Metric Card ────────────────────────────────────────────── */
function MetricCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-surface2 rounded-lg p-3 border border-border/30">
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color }} className="text-sm">{icon}</span>
        <span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold text-ink1">{value}</div>
    </div>
  );
}

/* ── Execution Row ──────────────────────────────────────────── */
function ExecutionRow({ exec }: { exec: AgentExecution }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = exec.status === 'completed' ? '#4CAF50' : exec.status === 'failed' ? '#F44336' : '#FF9800';
  return (
    <div className="border-b border-border/20 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface2/50 transition-colors text-left"
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor }} />
        <span className="text-xs font-mono text-ink1 flex-shrink-0 w-32 truncate">{exec.agent_name || exec.agent_id}</span>
        <span className="text-[10px] text-ink3 flex-1 truncate">{exec.task || '—'}</span>
        <span className="text-[10px] text-ink3 flex-shrink-0">{exec.duration_ms ? `${(exec.duration_ms / 1000).toFixed(1)}s` : '—'}</span>
        <ArrowRight size={10} className={`text-ink3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 bg-surface3/30">
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div><span className="text-ink3">Status:</span> <span className="text-ink1">{exec.status}</span></div>
            <div><span className="text-ink3">Division:</span> <span className="text-ink1">{exec.division}</span></div>
            <div><span className="text-ink3">Started:</span> <span className="text-ink1">{exec.started_at ? new Date(exec.started_at).toLocaleString() : '—'}</span></div>
            <div><span className="text-ink3">Completed:</span> <span className="text-ink1">{exec.completed_at ? new Date(exec.completed_at).toLocaleString() : '—'}</span></div>
          </div>
          {exec.task && <div className="text-[10px] text-ink2 mt-1"><span className="text-ink3">Task:</span> {exec.task}</div>}
          {exec.error && <div className="text-[10px] text-red-400 mt-1"><span className="text-ink3">Error:</span> {exec.error}</div>}
          {!!exec.output && (
            <div className="bg-surface3 rounded-lg p-3 mt-2">
              <p className="text-[10px] font-mono text-ink3 mb-1">OUTPUT:</p>
              <pre className="text-[10px] text-ink1 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                {typeof exec.output === 'string' ? exec.output : safeStringify(exec.output, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Activity log row ──────────────────────────────────────── */
function ActivityRow({ log }: { log: ActivityLog }) {
  const severityColors: Record<string, string> = {
    info: 'text-sky-400',
    warning: 'text-amber-400',
    error: 'text-red-400',
    critical: 'text-red-500',
  };
  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border/30 last:border-0">
      <span className={`text-[10px] font-mono ${severityColors[log.severity] || 'text-ink3'}`}>●</span>
      <span className="text-[10px] font-mono text-ink1 flex-1 truncate">{log.agent_id}</span>
      <span className="text-[10px] text-ink3 flex-1 truncate">{log.message}</span>
      <span className="text-[10px] text-ink3 flex-shrink-0">
        {log.created_at ? new Date(log.created_at).toLocaleTimeString() : '—'}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AGENT DASHBOARD — Real agent metrics + execution history
   ═══════════════════════════════════════════════════════════════ */
export default function AgentDashboard() {
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [execRes, actRes] = await Promise.all([
        api.get<{ executions: AgentExecution[] }>('/api/agent-executions?limit=50'),
        api.get<{ activities: ActivityLog[] }>('/api/agent-activity?limit=30'),
      ]);

      const execs = execRes?.executions || [];
      setExecutions(execs);

      // Compute stats from executions
      const byDivision: Record<string, number> = {};
      let active = 0, completed = 0, failed = 0;
      for (const e of execs) {
        byDivision[e.division || 'general'] = (byDivision[e.division || 'general'] || 0) + 1;
        if (e.status === 'running' || e.status === 'pending') active++;
        else if (e.status === 'completed') completed++;
        else if (e.status === 'failed') failed++;
      }
      setStats({ total: execs.length, by_division: byDivision, active, completed, failed });

      setActivities(actRes?.activities || []);
    } catch (e: unknown) {
      console.warn('[AgentDashboard] Failed to load data:', e instanceof Error ? e.message : e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(loadData, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, loadData]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink1">Agent Dashboard</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${autoRefresh ? 'bg-green-500/20 text-green-400' : 'bg-surface2 text-ink3'}`}
          >
            {autoRefresh ? 'AUTO' : 'PAUSED'}
          </button>
          <button onClick={loadData} className="p-1.5 rounded hover:bg-surface2 transition-colors" title="Refresh">
            <RefreshCcw size={12} className="text-ink3" />
          </button>
        </div>
      </div>

      {/* Summary Metrics */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Total Executions" value={stats.total} icon={<Database size={14} />} color="#8e8ea5" />
          <MetricCard label="Active" value={stats.active} icon={<Activity size={14} />} color="#4FC3F7" />
          <MetricCard label="Completed" value={stats.completed} icon={<CheckCircle size={14} />} color="#4CAF50" />
          <MetricCard label="Failed" value={stats.failed} icon={<AlertTriangle size={14} />} color="#F44336" />
        </div>
      )}

      {/* Division Breakdown */}
      {stats && Object.keys(stats.by_division).length > 0 && (
        <div className="bg-surface2 rounded-lg p-3 border border-border/30">
          <div className="flex items-center gap-2 mb-2">
            <Brain size={12} className="text-ink3" />
            <span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">Divisions</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.by_division).map(([div, count]) => (
              <span key={div} className="px-2 py-0.5 rounded bg-surface3 text-[10px] text-ink2 font-mono">
                {div}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent Executions */}
      <div className="bg-surface2 rounded-lg border border-border/30 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
          <Zap size={12} className="text-ink3" />
          <span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">Recent Executions</span>
          <span className="text-[10px] text-ink3 ml-auto">{executions.length} total</span>
        </div>
        {loading ? (
          <div className="px-3 py-6 text-center text-[10px] text-ink3">Loading...</div>
        ) : executions.length === 0 ? (
          <div className="px-3 py-6 text-center text-[10px] text-ink3">No executions yet</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {executions.map((exec) => (
              <ExecutionRow key={exec.id} exec={exec} />
            ))}
          </div>
        )}
      </div>

      {/* Activity Log */}
      <div className="bg-surface2 rounded-lg border border-border/30 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
          <Shield size={12} className="text-ink3" />
          <span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">Activity Log</span>
          <span className="text-[10px] text-ink3 ml-auto">{activities.length} events</span>
        </div>
        {loading ? (
          <div className="px-3 py-6 text-center text-[10px] text-ink3">Loading...</div>
        ) : activities.length === 0 ? (
          <div className="px-3 py-6 text-center text-[10px] text-ink3">No activity yet</div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {activities.map((log) => (
              <ActivityRow key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
