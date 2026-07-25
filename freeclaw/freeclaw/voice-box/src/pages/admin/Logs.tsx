// Enhanced Logs — Master Activity Timeline
// Shows both admin audit logs AND all 110 agents' events in one chronological view
import { useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate, downloadFile, toCSV, safeStringify } from '../../lib/utils';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';

interface AgentActivity {
  id: string;
  agent_id: string;
  event_type: string;
  details: Record<string, unknown>;
  severity: string;
  created_at: string;
}

interface AuditLog {
  id: string;
  actor: string;
  action: string;
  detail: string;
  created_at: string;
}

// Division color mapping
const DIV_COLORS: Record<string, string> = {
  executive: '#FFD700',
  content: '#4FC3F7',
  users: '#81C784',
  analytics: '#CE93D8',
  system: '#FF8A65',
  meta: '#A1887F',
  specialist: '#90A4AE',
  platform: '#4DD0E1',
  'eng-backend': '#FFB74D',
  'eng-frontend': '#F06292',
  'eng-database': '#AED581',
  'eng-infra': '#7986CB',
  'eng-qa': '#E57373',
  'eng-dev': '#4DB6AC',
};

function getAgentColor(agentId: string): string {
  const division = agentId.split('-').slice(0, -1).join('-');
  return DIV_COLORS[division] ?? DIV_COLORS[agentId.split('-')[0] ?? ''] ?? '#9E9E9E';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'error': return '#F44336';
    case 'warning': return '#FF9800';
    case 'info': return '#4CAF50';
    default: return '#9E9E9E';
  }
}

export default function Logs() {
  const [allLogs, setAllLogs] = useState<AuditLog[]>([]);
  const [agentActivities, setAgentActivities] = useState<AgentActivity[]>([]);
  const [activeTab, setActiveTab] = useState<'audit' | 'agents' | 'combined'>('combined');
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentFilter, setAgentFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch audit logs with infinite scroll
  const fetchLogs = useCallback(async ({ cursor, limit }: { cursor: string | null; limit: number }) => {
    const params = new URLSearchParams({ action: 'logs', paginate: '1', limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const result = await api.get<{ data: AuditLog[]; nextCursor: string; total: number }>(`/api/admin?${params}`);
    const rows = result.data || [];
    setAllLogs((prev) => {
      const ids = new Set(prev.map((l) => l.id));
      return [...prev, ...rows.filter((r: AuditLog) => !ids.has(r.id))];
    });
    return { data: rows, nextCursor: result.nextCursor, total: result.total || 0 };
  }, []);

  const { items: logs, loading, initialLoading, hasMore, total, sentinelRef } = useInfiniteScroll<AuditLog>(fetchLogs, { limit: 30 });

  // Fetch agent activities
  const fetchAgentActivities = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const data = await api.get<{ activities: AgentActivity[] }>('/api/agent-executions?action=activity&limit=200');
      setAgentActivities(data.activities || []);
    } catch (err) {
      console.error('[Logs] Failed to load agent activities:', err);
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'agents' || activeTab === 'combined') {
      fetchAgentActivities();
    }
  }, [activeTab, fetchAgentActivities]);

  // Auto-refresh agent activities
  useEffect(() => {
    if (activeTab !== 'agents' && activeTab !== 'combined') return;
    const interval = setInterval(fetchAgentActivities, 12000);
    return () => clearInterval(interval);
  }, [activeTab, fetchAgentActivities]);

  // Combined timeline
  const combinedTimeline = activeTab === 'combined' ? [
    ...agentActivities.map(a => ({
      id: a.id,
      type: 'agent' as const,
      actor: a.agent_id,
      action: a.event_type,
      detail: a.severity,
      timestamp: a.created_at,
      data: a,
    })),
    ...logs.map(l => ({
      id: l.id,
      type: 'audit' as const,
      actor: l.actor,
      action: l.action,
      detail: l.detail,
      timestamp: l.created_at,
      data: l,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) : [];

  // Filtered agent activities
  const filteredActivities = agentActivities.filter(a => {
    if (agentFilter !== 'all' && !a.agent_id.includes(agentFilter)) return false;
    if (searchQuery && !a.agent_id.toLowerCase().includes(searchQuery.toLowerCase()) && !a.event_type.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const uniqueAgentDivisions = [...new Set(agentActivities.map(a => a.agent_id.split('-')[0]))].sort();

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display font-bold text-xl">Activity & Audit Log</h1>
          <p className="text-xs text-ink3 mt-1">Master timeline of all platform events — admin actions and 110 agent activities</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink3">{total + agentActivities.length} total events</span>
          <button className="btn btn-ghost !text-xs" onClick={() => downloadFile('voicebox-audit.csv', toCSV(allLogs as unknown as Record<string, unknown>[]), 'text/csv')}>Export CSV</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border pb-2">
        {([
          { key: 'combined', label: 'Combined Timeline', icon: '🕐' },
          { key: 'agents', label: 'Agent Events', icon: '🤖' },
          { key: 'audit', label: 'Admin Audit Log', icon: '📋' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white/10 text-white'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      {(activeTab === 'agents' || activeTab === 'combined') && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input
            type="text"
            placeholder="Search agents, events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20 w-56"
          />
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white/70 focus:outline-none"
          >
            <option value="all">All Agent Divisions</option>
            {uniqueAgentDivisions.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {/* Content */}
      {initialLoading && activeTab === 'audit' ? (
        <div className="space-y-2">{[1,2,3,4].map((i) => <div key={i} className="skeleton h-10" />)}</div>
      ) : (
        <div className="card divide-y divide-border">
          {/* Combined Timeline */}
          {activeTab === 'combined' && combinedTimeline.map((item) => (
            <div key={item.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              {item.type === 'agent' ? (
                <>
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: getSeverityColor(item.detail) }}
                  />
                  <span
                    className="chip !text-[10px] shrink-0"
                    style={{ borderColor: getAgentColor(item.actor), color: getAgentColor(item.actor) }}
                  >
                    🤖 {item.actor}
                  </span>
                  <span className="font-semibold text-xs shrink-0">{item.action}</span>
                  <span className="text-xs text-ink2 truncate flex-1">
                    {safeStringify((item.data as AgentActivity).details || {}).slice(0, 120)}
                  </span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full shrink-0 bg-blue-400" />
                  <span className="chip !text-[10px] shrink-0">{item.actor}</span>
                  <span className="font-semibold text-xs shrink-0">{item.action}</span>
                  <span className="text-xs text-ink2 truncate flex-1">{item.detail}</span>
                </>
              )}
              <span className="text-[10px] text-ink3 shrink-0">{timeAgo(item.timestamp)}</span>
            </div>
          ))}

          {/* Agent Events Only */}
          {activeTab === 'agents' && (
            <>
              {loadingAgents && filteredActivities.length === 0 ? (
                <div className="flex items-center justify-center py-8 gap-2 text-ink3 text-xs">
                  <Loader2 size={14} className="animate-spin" /> Loading agent events...
                </div>
              ) : filteredActivities.length === 0 ? (
                <div className="text-center py-8 text-ink3">
                  <div className="text-2xl mb-2">🤖</div>
                  <div className="text-sm">No agent events yet</div>
                  <div className="text-xs mt-1">Agent activities will appear here as they execute</div>
                </div>
              ) : (
                filteredActivities.map((act) => (
                  <div key={act.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: getSeverityColor(act.severity) }}
                    />
                    <span
                      className="chip !text-[10px] shrink-0"
                      style={{ borderColor: getAgentColor(act.agent_id), color: getAgentColor(act.agent_id) }}
                    >
                      {act.agent_id}
                    </span>
                    <span className="font-semibold text-xs shrink-0">{act.event_type}</span>
                    <span className="text-xs text-ink2 truncate flex-1">
                      {safeStringify(act.details || {}).slice(0, 150)}
                    </span>
                    <span className="text-[10px] text-ink3 shrink-0">{timeAgo(act.created_at)}</span>
                  </div>
                ))
              )}
            </>
          )}

          {/* Audit Log Only */}
          {activeTab === 'audit' && (
            <>
              {logs.map((l) => (
                <div key={l.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="chip !text-[10px] shrink-0">{l.actor}</span>
                  <span className="font-semibold text-xs shrink-0">{l.action}</span>
                  <span className="text-xs text-ink2 truncate flex-1">{l.detail}</span>
                  <span className="text-[10px] text-ink3 shrink-0">{fmtDate(l.created_at)}</span>
                </div>
              ))}
              <div ref={sentinelRef} className="h-4" />
              {loading && !initialLoading && (
                <div className="flex items-center justify-center py-3 gap-2 text-ink3 text-xs">
                  <Loader2 size={14} className="animate-spin" /> Loading more logs…
                </div>
              )}
              {!hasMore && logs.length > 0 && (
                <p className="text-center text-[11px] text-ink3 py-2">All {total} log entries loaded</p>
              )}
              {logs.length === 0 && !loading && <p className="p-8 text-center text-sm text-ink3">No log entries yet.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
