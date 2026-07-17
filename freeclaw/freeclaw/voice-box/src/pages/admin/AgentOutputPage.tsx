// Agent Output Page — Central AI Output Center
// Shows every completed agent task with full metadata:
// Agent Name, Task, Trigger, Complaint/User ID, Start/End Time, Duration,
// Result, Status, Confidence Score, Logs, Errors, Download Report
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../lib/api';
import { safeStringify } from '../../lib/utils';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════
interface AgentResult {
  agent_id: string;
  agent_name: string;
  icon: string;
  result: {
    type: string;
    agent: string;
    data: Record<string, unknown>;
    llm_analysis?: string;
    llm_model?: string;
    llm_provider?: string;
    source?: string;
  };
}

interface WorkflowResult {
  workflow_id: string;
  classification: {
    topic: string;
    urgency: string;
    category: string;
    confidence: number;
    subcategories: string[];
  };
  agents_used: Array<{ id: string; name: string; icon: string; status: string }>;
  results: AgentResult[];
  total_time_ms: number;
  created_at: string;
  completed_at: string;
  task: string;
}

interface ExecutionRecord {
  id: string;
  agent_id: string;
  agent_name: string;
  division: string;
  trigger_type: string;
  task: string;
  status: string;
  output: unknown;
  duration_ms: number;
  started_at: string;
  completed_at: string;
  error?: string;
}

interface ActivityRecord {
  id: string;
  agent_id: string;
  event_type: string;
  details: Record<string, unknown>;
  severity: string;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// DIVISION COLORS
// ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return '#4CAF50';
    case 'running': return '#2196F3';
    case 'failed': return '#F44336';
    case 'error': return '#F44336';
    default: return '#9E9E9E';
  }
}

function getTriggerBadge(type: string): { label: string; color: string } {
  switch (type) {
    case 'cron': return { label: '24/7', color: '#FFD700' };
    case 'event': return { label: 'Event', color: '#4FC3F7' };
    case 'manual': return { label: 'Manual', color: '#CE93D8' };
    default: return { label: type, color: '#9E9E9E' };
  }
}

function downloadReport(result: WorkflowResult | ExecutionRecord) {
  const report = safeStringify(result, 2);
  const blob = new Blob([report], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agent-report-${('workflow_id' in result) ? result.workflow_id : (result as ExecutionRecord).id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════
// WORKFLOW RESULT CARD
// ═══════════════════════════════════════════════════════════════════
function WorkflowCard({ wf, onDownload }: { wf: WorkflowResult; onDownload: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const trigger = getTriggerBadge('manual');
  const duration = wf.total_time_ms;
  const urgencyColor = wf.classification.urgency === 'high' ? '#F44336'
    : wf.classification.urgency === 'medium' ? '#FF9800' : '#4CAF50';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-white/10 rounded-lg overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="text-lg">🤖</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white text-sm truncate">{wf.task}</span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: trigger.color + '22', color: trigger.color }}
              >
                {trigger.label}
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: urgencyColor + '22', color: urgencyColor }}
              >
                {wf.classification.urgency}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-white/50">
              <span>{wf.agents_used.length} agents</span>
              <span>·</span>
              <span>{formatDuration(duration)}</span>
              <span>·</span>
              <span>{timeAgo(wf.created_at)}</span>
              <span>·</span>
              <span className="text-green-400">✓ completed</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(); }}
            className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/70 transition-colors"
          >
            📥 Report
          </button>
          <span className="text-white/30 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-white/5">
              {/* Agent list */}
              <div className="mt-3 mb-3">
                <div className="text-xs font-mono text-white/40 mb-2 uppercase tracking-wider">Agents Deployed</div>
                <div className="flex flex-wrap gap-2">
                  {wf.agents_used.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border"
                      style={{
                        borderColor: (DIV_COLORS as Record<string, string>)[a.id.split('-')[0]] || '#666',
                        color: (DIV_COLORS as Record<string, string>)[a.id.split('-')[0]] || '#999',
                      }}
                    >
                      {a.icon} {a.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Classification */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div className="p-2 rounded bg-white/5">
                  <div className="text-[10px] font-mono text-white/40 uppercase">Topic</div>
                  <div className="text-xs text-white/80 mt-0.5">{wf.classification.topic}</div>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <div className="text-[10px] font-mono text-white/40 uppercase">Category</div>
                  <div className="text-xs text-white/80 mt-0.5">{wf.classification.category}</div>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <div className="text-[10px] font-mono text-white/40 uppercase">Confidence</div>
                  <div className="text-xs mt-0.5" style={{ color: urgencyColor }}>
                    {(wf.classification.confidence * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <div className="text-[10px] font-mono text-white/40 uppercase">Duration</div>
                  <div className="text-xs text-white/80 mt-0.5">{formatDuration(duration)}</div>
                </div>
              </div>

              {/* Individual agent results */}
              <div className="space-y-2">
                <div className="text-xs font-mono text-white/40 uppercase tracking-wider">Agent Outputs</div>
                {wf.results.map((r, i) => (
                  <div key={i} className="p-3 rounded bg-white/5 border border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <span>{r.icon}</span>
                      <span className="text-xs font-semibold text-white">{r.agent_name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{r.result.type}</span>
                    </div>
                    {r.result.llm_analysis && (
                      <div className="text-xs text-white/60 mb-2 p-2 rounded bg-black/20 border border-white/5">
                        <div className="text-[10px] font-mono text-white/30 mb-1">AI Analysis</div>
                        <div className="whitespace-pre-wrap">{r.result.llm_analysis.slice(0, 500)}{r.result.llm_analysis.length > 500 ? '...' : ''}</div>
                      </div>
                    )}
                    {r.result.data && Object.keys(r.result.data).length > 0 && (
                      <div className="text-[11px] text-white/50 font-mono">
                        {Object.entries(r.result.data).slice(0, 8).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <span className="text-white/30">{k}:</span>
                            <span className="text-white/60">{typeof v === 'object' ? safeStringify(v) : String(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {r.result.source && (
                      <div className="text-[10px] text-white/30 mt-1">Source: {r.result.source}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EXECUTION RECORD CARD (from runner)
// ═══════════════════════════════════════════════════════════════════
function ExecutionCard({ ex }: { ex: ExecutionRecord }) {
  const [expanded, setExpanded] = useState(false);
  const trigger = getTriggerBadge(ex.trigger_type);
  const divColor = DIV_COLORS[ex.division] || '#9E9E9E';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-white/10 rounded-lg overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold"
            style={{ background: divColor + '22', color: divColor }}
          >
            {ex.agent_name?.charAt(0) || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-white text-sm">{ex.agent_name}</span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: divColor + '22', color: divColor }}
              >
                {ex.division}
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: trigger.color + '22', color: trigger.color }}
              >
                {trigger.label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-white/50">
              <span className="truncate max-w-[200px]">{ex.task}</span>
              <span>·</span>
              <span>{formatDuration(ex.duration_ms || 0)}</span>
              <span>·</span>
              <span>{timeAgo(ex.started_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
            style={{ background: getStatusColor(ex.status) + '22', color: getStatusColor(ex.status) }}
          >
            {ex.status}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); downloadReport(ex); }}
            className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/70 transition-colors"
          >
            📥
          </button>
          <span className="text-white/30 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-white/5">
              {/* Metadata */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 mb-3">
                <div className="p-2 rounded bg-white/5">
                  <div className="text-[10px] font-mono text-white/40 uppercase">Agent ID</div>
                  <div className="text-xs text-white/80 mt-0.5 font-mono">{ex.agent_id}</div>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <div className="text-[10px] font-mono text-white/40 uppercase">Started</div>
                  <div className="text-xs text-white/80 mt-0.5">{new Date(ex.started_at).toLocaleString()}</div>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <div className="text-[10px] font-mono text-white/40 uppercase">Completed</div>
                  <div className="text-xs text-white/80 mt-0.5">{ex.completed_at ? new Date(ex.completed_at).toLocaleString() : '—'}</div>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <div className="text-[10px] font-mono text-white/40 uppercase">Duration</div>
                  <div className="text-xs text-white/80 mt-0.5">{formatDuration(ex.duration_ms || 0)}</div>
                </div>
              </div>

              {/* Output */}
              {ex.output && (
                <div className="mb-3">
                  <div className="text-xs font-mono text-white/40 uppercase tracking-wider mb-2">Output</div>
                  <pre className="text-xs text-white/60 p-3 rounded bg-black/20 border border-white/5 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                    {typeof ex.output === 'string' ? ex.output : safeStringify(ex.output, 2)}
                  </pre>
                </div>
              )}

              {/* Error */}
              {ex.error && (
                <div className="mb-3">
                  <div className="text-xs font-mono text-red-400/60 uppercase tracking-wider mb-2">Error</div>
                  <div className="text-xs text-red-400 p-3 rounded bg-red-500/10 border border-red-500/20">
                    {ex.error}
                  </div>
                </div>
              )}
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function AgentOutputPage() {
  const [workflows, setWorkflows] = useState<WorkflowResult[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'workflows' | 'executions' | 'activity'>('workflows');
  const [filterDivision, setFilterDivision] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Stats
  const [stats, setStats] = useState({
    totalWorkflows: 0,
    totalExecutions: 0,
    avgDuration: 0,
    successRate: 0,
    activeAgents: 0,
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch all data sources in parallel — api.get() returns parsed JSON
      const results = await Promise.allSettled([
        api.get('/api/agent-team?action=results&limit=50'),
        api.get('/api/agent-executions?action=list&limit=100'),
        api.get('/api/agent-executions?action=activity&limit=100'),
        api.get('/api/agent-team?action=dashboard'),
      ]);

      const wfData = results[0].status === 'fulfilled' ? results[0].value : null;
      const exData = results[1].status === 'fulfilled' ? results[1].value : null;
      const actData = results[2].status === 'fulfilled' ? results[2].value : null;
      const dashData = results[3].status === 'fulfilled' ? results[3].value : null;

      if (wfData) setWorkflows(wfData.results || []);
      if (exData) setExecutions(exData.executions || []);
      if (actData) setActivities(actData.activities || []);

      if (dashData) {
        const states = dashData.agent_states || {};
        setStats({
          totalWorkflows: wfData?.total || 0,
          totalExecutions: exData?.total || 0,
          avgDuration: 0,
          successRate: 0,
          activeAgents: (states.working || 0) + (states.completed || 0),
        });
      }
    } catch (err) {
      console.error('[AgentOutput] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 8s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadData, 8000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  // Filtered data
  const filteredWorkflows = workflows.filter((wf) => {
    if (filterDivision !== 'all') {
      const hasDivision = wf.agents_used.some(a => a.id.includes(filterDivision));
      if (!hasDivision) return false;
    }
    if (searchQuery && !wf.task.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const filteredExecutions = executions.filter((ex) => {
    if (filterDivision !== 'all' && ex.division !== filterDivision) return false;
    if (filterStatus !== 'all' && ex.status !== filterStatus) return false;
    if (searchQuery && !ex.agent_name.toLowerCase().includes(searchQuery.toLowerCase()) && !ex.task.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const uniqueDivisions = [...new Set(executions.map(e => e.division))].sort();

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">AI Output Center</h1>
          <p className="text-sm text-white/50 mt-1">
            Central hub for all 110 agent outputs — workflows, executions, and activity timeline
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              autoRefresh
                ? 'border-green-500/30 text-green-400 bg-green-500/10'
                : 'border-white/20 text-white/50 hover:bg-white/5'
            }`}
          >
            {autoRefresh ? '● Live' : '○ Paused'}
          </button>
          <button
            onClick={loadData}
            className="text-xs px-3 py-1.5 rounded-full border border-white/20 text-white/50 hover:bg-white/5 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Workflows', value: stats.totalWorkflows, icon: '🔄' },
          { label: 'Executions', value: stats.totalExecutions, icon: '⚡' },
          { label: 'Active Agents', value: stats.activeAgents, icon: '🤖' },
          { label: 'Avg Duration', value: stats.avgDuration > 0 ? formatDuration(stats.avgDuration) : '—', icon: '⏱️' },
          { label: 'Success Rate', value: stats.successRate > 0 ? `${stats.successRate}%` : '—', icon: '✅' },
        ].map((s) => (
          <div key={s.label} className="p-3 rounded-lg border border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-2 mb-1">
              <span>{s.icon}</span>
              <span className="text-[10px] font-mono text-white/40 uppercase">{s.label}</span>
            </div>
            <div className="text-lg font-bold text-white">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-white/10 pb-2">
        {([
          { key: 'workflows', label: 'Workflows', count: filteredWorkflows.length },
          { key: 'executions', label: 'Executions', count: filteredExecutions.length },
          { key: 'activity', label: 'Activity Log', count: activities.length },
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
            {tab.label}
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search agents, tasks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20 w-64"
        />
        <select
          value={filterDivision}
          onChange={(e) => setFilterDivision(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white/70 focus:outline-none"
        >
          <option value="all">All Divisions</option>
          {uniqueDivisions.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        {activeTab === 'executions' && (
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white/70 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
          </select>
        )}
      </div>

      {/* Content */}
      {loading && workflows.length === 0 && executions.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <div className="text-4xl mb-3">🤖</div>
          <div>Loading agent outputs...</div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Workflows Tab */}
          {activeTab === 'workflows' && (
            <>
              {filteredWorkflows.length === 0 ? (
                <div className="text-center py-12 text-white/30">
                  <div className="text-3xl mb-2">📋</div>
                  <div>No workflow results yet</div>
                  <div className="text-xs mt-1">Spawn agents from the Agent Team tab to see output here</div>
                </div>
              ) : (
                filteredWorkflows.map((wf) => (
                  <WorkflowCard
                    key={wf.workflow_id}
                    wf={wf}
                    onDownload={() => downloadReport(wf)}
                  />
                ))
              )}
            </>
          )}

          {/* Executions Tab */}
          {activeTab === 'executions' && (
            <>
              {filteredExecutions.length === 0 ? (
                <div className="text-center py-12 text-white/30">
                  <div className="text-3xl mb-2">⚡</div>
                  <div>No agent executions yet</div>
                  <div className="text-xs mt-1">Run agents from the Agent Team tab or wait for scheduled executions</div>
                </div>
              ) : (
                filteredExecutions.map((ex) => (
                  <ExecutionCard key={ex.id} ex={ex} />
                ))
              )}
            </>
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <>
              {activities.length === 0 ? (
                <div className="text-center py-12 text-white/30">
                  <div className="text-3xl mb-2">📜</div>
                  <div>No activity recorded yet</div>
                  <div className="text-xs mt-1">Agent activities will appear here as they execute</div>
                </div>
              ) : (
                <div className="space-y-1">
                  {activities.map((act) => (
                    <div
                      key={act.id}
                      className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors border border-white/5"
                    >
                      <div
                        className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
                        style={{
                          background: act.severity === 'error' ? '#F44336'
                            : act.severity === 'warning' ? '#FF9800'
                            : '#4CAF50',
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white">{act.agent_id}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono">
                            {act.event_type}
                          </span>
                          <span className="text-[10px] text-white/30">{timeAgo(act.created_at)}</span>
                        </div>
                        {act.details && Object.keys(act.details).length > 0 && (
                          <div className="text-xs text-white/40 mt-1 font-mono truncate max-w-[500px]">
                            {safeStringify(act.details).slice(0, 200)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
