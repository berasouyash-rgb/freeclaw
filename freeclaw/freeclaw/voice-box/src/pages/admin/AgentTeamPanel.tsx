import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, RefreshCcw, Search, Plus, Loader2, Zap, Shield,
  Activity, GitMerge, X, Play,
  CheckCircle2, FileText,
} from 'lucide-react';
import { api } from '../../lib/api';
import { safeStringify } from '../../lib/utils';
import { useApp } from '../../contexts/AppContext';

import type { Agent, Division, Dashboard, AgentState, WorkflowResult, AgentActivation } from './agent-office/types';
import { DIV_COLORS } from './agent-office/constants';
import OfficeVisualization from './agent-office/OfficeVisualization';
import InspectorPanel from './agent-office/InspectorPanel';
import ActivityConsole from './agent-office/ActivityConsole';
import FloatingNotifications from './agent-office/FloatingNotifications';
import AgentOutput from './agent-office/AgentOutput';

/* ── Stat card ───────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <div className="bg-surface2 rounded-xl p-3.5 border border-border flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-xl font-bold text-ink1">{value}</p>
        <p className="text-[10px] text-ink3 font-medium">{label}</p>
      </div>
    </div>
  );
}

/* ── Create agent modal ──────────────────────────────────── */
function CreateAgentForm({ onCreated, onClose }: { onCreated: (a: Agent) => void; onClose: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('🤖');
  const [division, setDivision] = useState('specialist');
  const [role, setRole] = useState('Specialist');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) { toast('Name is required', 'err'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ agent: Agent }>('/api/agent-team', {
        action: 'create', name: name.trim(), description: description.trim(),
        icon, division, role: role.trim(), permissions: ['posts.read'], capabilities: ['custom_task'],
      });
      toast(`Agent "${r.agent.name}" created`, 'ok');
      onCreated(r.agent);
      onClose();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), 'err'); }
    setBusy(false);
  };

  const iconOptions = ['🤖', '🧠', '📝', '🔍', '📊', '🛡️', '⚡', '🎯', '🧬', '💡', '🔧', '📣', '🗂️', '🧪', '🌐', '☕'];
  const divisions = ['executive', 'content', 'users', 'analytics', 'system', 'meta', 'specialist', 'platform', 'eng-backend', 'eng-frontend', 'eng-database', 'eng-infra', 'eng-qa', 'eng-dev'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-md p-6 space-y-4 vb-pop">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-lg flex items-center gap-2"><Plus size={18} className="text-accent" /> Create Agent</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface2"><X size={14} className="text-ink3" /></button>
        </div>
        <div>
          <label className="text-[11px] font-bold text-ink3 uppercase tracking-wider block mb-1.5">Icon</label>
          <div className="flex gap-1.5 flex-wrap">
            {iconOptions.map((ic) => (
              <button key={ic} onClick={() => setIcon(ic)}
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg border transition-all ${icon === ic ? 'bg-accent-soft border-accent scale-110' : 'bg-surface2 border-border hover:border-ink3'}`}>
                {ic}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-bold text-ink3 uppercase tracking-wider block mb-1.5">Name</label>
          <input className="input text-sm" placeholder="e.g. Report Builder" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-[11px] font-bold text-ink3 uppercase tracking-wider block mb-1.5">Description</label>
          <textarea className="input text-sm h-16 resize-none" placeholder="What does this agent do?" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-ink3 uppercase tracking-wider block mb-1.5">Division</label>
            <select className="input text-sm" value={division} onChange={(e) => setDivision(e.target.value)}>
              {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-ink3 uppercase tracking-wider block mb-1.5">Role</label>
            <input className="input text-sm" placeholder="e.g. Builder" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
        </div>
        <button onClick={create} disabled={busy || !name.trim()} className="btn btn-primary w-full text-sm">
          {busy ? <Loader2 size={14} className="animate-spin mr-2" /> : <Plus size={14} className="mr-2" />}
          Create Agent
        </button>
      </div>
    </div>
  );
}

/* ── Spawn workflow modal ────────────────────────────────── */
function SpawnPanel({ agents, onClose, onResult }: { agents: Agent[]; onClose: () => void; onResult: () => void }) {
  const { toast } = useApp();
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WorkflowResult | null>(null);

  const spawn = async () => {
    if (!task.trim()) { toast('Describe the task', 'err'); return; }
    setBusy(true);
    try {
      const r = await api.postLong<WorkflowResult>('/api/agent-team', { action: 'spawn', message: task.trim() });
      setResult(r);
      toast(`Spawned ${r.agents_used?.length || 0} agents — ${r.total_time_ms}ms`, 'ok');
      onResult(); // refresh data
    } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), 'err'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-lg p-6 space-y-4 vb-pop">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-lg flex items-center gap-2"><Zap size={18} className="text-cyan-400" /> Spawn Subagents</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface2"><X size={14} className="text-ink3" /></button>
        </div>
        <p className="text-xs text-ink3">Describe a task. The orchestrator classifies it and dispatches the best agents with real database queries.</p>
        <textarea className="input text-sm h-20 resize-none" placeholder="e.g. Analyze all posts from this week and generate a sentiment report" value={task} onChange={(e) => setTask(e.target.value)} />
        <button onClick={spawn} disabled={busy || !task.trim()} className="btn btn-primary w-full text-sm">
          {busy ? <Loader2 size={14} className="animate-spin mr-2" /> : <Play size={14} className="mr-2" />}
          {busy ? 'Orchestrating…' : 'Spawn & Execute'}
        </button>

        {/* Real result display */}
        {result && (
          <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
            <div className="flex items-center gap-2 text-sm font-bold text-ink1">
              <CheckCircle2 size={16} className="text-emerald-400" /> Real Execution Result
              {result.workflow_id && <span className="text-[10px] font-mono text-ink3 ml-auto">{result.workflow_id}</span>}
            </div>
            {result.total_time_ms && (
              <p className="text-[10px] text-ink3 font-mono">{result.total_time_ms}ms total · {result.agents_used?.length || 0} agents · {result.classification?.division}</p>
            )}
            {(result.results || []).map((r: any, i: number) => {
              const agent = agents.find((a) => a.id === r.agent_id);
              const hasData = r.result && r.result.data && Object.keys(r.result.data).length > 0;
              return (
                <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-surface2 border border-border">
                  <span className="text-base flex-shrink-0">{r.icon || agent?.icon || '🤖'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-ink1">{r.agent_name || agent?.name || r.agent_id}</p>
                    {hasData ? (
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(r.result.data).slice(0, 3).map(([k, v]) => (
                          <p key={k} className="text-[10px] text-ink3 font-mono truncate">
                            <span className="text-ink2 uppercase">{k}:</span> {typeof v === 'object' ? safeStringify(v).slice(0, 40) : String(v).slice(0, 60)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-ink3 mt-0.5">{r.result?.message || r.result?.type || 'Processed'}</p>
                    )}
                  </div>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full flex-shrink-0 bg-emerald-500/15 text-emerald-400">done</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT — Real agent states from backend
   ═══════════════════════════════════════════════════════════════ */
export default function AgentTeamPanel() {
  const { toast } = useApp();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [activations, setActivations] = useState<Record<string, AgentActivation>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSpawn, setShowSpawn] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Load agents, divisions, dashboard
  const load = useCallback(async () => {
    try {
      const [agentsRes, divRes, dashRes] = await Promise.all([
        api.get<{ agents: Agent[] }>('/api/agent-team?action=list'),
        api.get<{ divisions: Division[] }>('/api/agent-team?action=divisions'),
        api.get<Dashboard>('/api/agent-team?action=dashboard'),
      ]);
      setAgents(agentsRes.agents || []);
      setDivisions(divRes.divisions || []);
      setDashboard(dashRes);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), 'err'); }
    setLoading(false);
  }, [toast]);

  // Load activation state from backend
  const loadActivations = useCallback(async () => {
    try {
      const r = await api.get<{ agents: AgentActivation[] }>('/api/agent-team?action=activationState');
      if (r.agents) {
        const map: Record<string, AgentActivation> = {};
        r.agents.forEach((a) => { map[a.id] = a; });
        setActivations(map);
      }
    } catch (e: unknown) { console.warn('[AgentTeamPanel] activation load failed:', e instanceof Error ? e.message : e); }
  }, []);

  // Load real agent states from backend
  const loadAgentStates = useCallback(async () => {
    try {
      const r = await api.get<{ states: Record<string, AgentState> }>('/api/agent-team?action=status');
      if (r.states) setAgentStates(r.states);
    } catch (e: unknown) { console.warn('[AgentTeamPanel] polling failed:', e instanceof Error ? e.message : e); }
  }, []);

  useEffect(() => { load(); loadAgentStates(); loadActivations(); }, [load, loadAgentStates, loadActivations]);

  // Auto-refresh: agents every 30s, states every 10s (DB-backed, no need for 3s polling)
  useEffect(() => {
    if (!autoRefresh) return;
    const ivData = setInterval(load, 30000);
    const ivStates = setInterval(loadAgentStates, 10000);
    return () => { clearInterval(ivData); clearInterval(ivStates); };
  }, [autoRefresh, load, loadAgentStates]);

  // Filtered agents
  const filtered = useMemo(() => {
    let list = agents;
    if (selectedDivision) list = list.filter((a) => a.division === selectedDivision);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.division.includes(q) ||
        a.capabilities.some((c) => c.includes(q))
      );
    }
    return list;
  }, [agents, search, selectedDivision]);

  // Selected agent state for inspector
  const selectedAgentState = selectedAgent ? (agentStates[selectedAgent.id] || null) : null;

  // Spawn handler for inspector panel
  const handleSpawnFromInspector = useCallback(async (agentId: string) => {
    toast(`Spawning ${agentId}…`, 'ok');
    try {
      await api.postLong('/api/agent-team', { action: 'spawn', message: `Execute ${agentId} capabilities` });
      toast(`Agent completed`, 'ok');
      loadAgentStates();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), 'err'); }
  }, [toast, loadAgentStates]);

  // Toggle agent activation
  const handleToggleActivation = useCallback(async (agentId: string, active: boolean) => {
    try {
      await api.post('/api/agent-team', { action: active ? 'activate' : 'deactivate', id: agentId });
      toast(`Agent ${active ? 'activated' : 'deactivated'}`, 'ok');
      loadActivations();
      load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), 'err'); }
  }, [toast, loadActivations, load]);

  // Toggle autonomous mode
  const handleToggleAutonomous = useCallback(async (agentId: string, autonomous: boolean) => {
    try {
      await api.post('/api/agent-team', { action: 'setAutonomous', id: agentId, autonomous });
      toast(`Autonomous ${autonomous ? 'enabled' : 'disabled'}`, 'ok');
      loadActivations();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), 'err'); }
  }, [toast, loadActivations]);

  // Bulk activation
  const handleBulkActivation = useCallback(async (active: boolean) => {
    const division = selectedDivision || undefined;
    try {
      await api.post('/api/agent-team', { action: active ? 'activateAll' : 'deactivateAll', division });
      toast(`${active ? 'Activated' : 'Deactivated'} all${division ? ` in ${division}` : ''}`, 'ok');
      loadActivations();
      load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), 'err'); }
  }, [toast, selectedDivision, loadActivations, load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-ink3 text-sm">
        <Loader2 size={16} className="animate-spin" />
        <span>Initializing office floor…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-xl flex items-center gap-2">
            <Users className="text-accent" size={20} /> Agent Team Office
          </h1>
          <p className="text-xs text-ink3 mt-0.5">
            {dashboard?.total_agents || agents.length} agents · {dashboard?.total_roles || 0} RBAC roles · {divisions.length} divisions ·
            {' '}<span className="text-emerald-400">{dashboard?.agent_states?.working || 0} working</span> ·
            {' '}<span className="text-sky-400">{dashboard?.recent_results || 0} results</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowSpawn(true)} className="btn btn-primary text-xs px-3 py-2">
            <Zap size={13} className="mr-1.5" /> Spawn
          </button>
          <button onClick={() => setShowOutput(true)} className="btn text-xs px-3 py-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25">
            <FileText size={13} className="mr-1.5" /> Output
          </button>
          <button onClick={() => setShowCreate(true)} className="btn text-xs px-3 py-2 bg-surface2 border border-border hover:border-accent">
            <Plus size={13} className="mr-1.5" /> New Agent
          </button>
          <button onClick={() => handleBulkActivation(true)} className="btn text-xs px-3 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20" title={selectedDivision ? `Activate all in ${selectedDivision}` : 'Activate all agents'}>
            Activate All
          </button>
          <button onClick={() => handleBulkActivation(false)} className="btn text-xs px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20" title={selectedDivision ? `Deactivate all in ${selectedDivision}` : 'Deactivate all agents'}>
            Deactivate All
          </button>
          <button onClick={() => { load(); loadAgentStates(); }} className="btn btn-ghost !p-2" title="Refresh"><RefreshCcw size={14} /></button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`btn !p-2 ${autoRefresh ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25' : 'btn-ghost'}`}
            title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          >
            <Activity size={14} />
          </button>
        </div>
      </div>

      {/* ── Stats row ─────────────────────────────────────── */}
      {dashboard && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={Users} label="Total Agents" value={dashboard.total_agents} color="bg-blue-500/15 text-blue-400" />
          <StatCard icon={Zap} label="Working Now" value={dashboard.agent_states?.working || 0} color="bg-emerald-500/15 text-emerald-400" />
          <StatCard icon={CheckCircle2} label="Completed" value={dashboard.agent_states?.completed || 0} color="bg-sky-500/15 text-sky-400" />
          <StatCard icon={Shield} label="RBAC Roles" value={dashboard.total_roles} color="bg-violet-500/15 text-violet-400" />
          <StatCard icon={GitMerge} label="Workflows" value={dashboard.active_workflows} color="bg-cyan-500/15 text-cyan-400" />
          <StatCard icon={FileText} label="Results" value={dashboard.recent_results || 0} color="bg-pink-500/15 text-pink-400" />
        </div>
      )}

      {/* ── Search + division filter ──────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input
            className="input text-xs pl-8 w-full"
            placeholder="Search agents, roles, capabilities, divisions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X size={12} className="text-ink3 hover:text-ink1" />
            </button>
          )}
        </div>
      </div>

      {/* Division chips */}
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setSelectedDivision(null)}
          className={`text-[10px] font-mono px-2.5 py-1 rounded-full transition-all ${!selectedDivision ? 'bg-accent text-white' : 'bg-surface2 text-ink3 border border-border hover:border-accent'}`}>
          All ({agents.length})
        </button>
        {divisions.map((d) => {
          const fallback = { bg: 'bg-surface2', text: 'text-ink3', border: 'border-border' };
          const c = DIV_COLORS[d.id] ?? DIV_COLORS.specialist ?? fallback;
          const divWorking = Object.values(agentStates).filter((s) => {
            const ag = agents.find((a) => a.id === s.agent_id);
            return ag?.division === d.id && s.state === 'working';
          }).length;
          return (
            <button key={d.id} onClick={() => setSelectedDivision(selectedDivision === d.id ? null : d.id)}
              className={`text-[10px] font-mono px-2.5 py-1 rounded-full transition-all flex items-center gap-1 ${selectedDivision === d.id ? `${c.bg} ${c.text} border ${c.border}` : 'bg-surface2 text-ink3 border border-border hover:border-accent'}`}>
              {d.icon} {d.name.split(' ')[0]} ({d.count})
              {divWorking > 0 && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            </button>
          );
        })}
      </div>

      {/* ── Office visualization — real states ─────────────── */}
      <OfficeVisualization
        agents={filtered}
        agentStates={agentStates}
        selectedAgentId={selectedAgent?.id || null}
        onSelectAgent={setSelectedAgent}
        searchQuery={search}
        isConnected={autoRefresh}
        activations={activations}
      />

      {/* ── Activity console — real events ─────────────────── */}
      <ActivityConsole />

      {/* ── Inspector panel — real state ───────────────────── */}
      {selectedAgent && (
        <InspectorPanel
          agent={selectedAgent}
          agentState={selectedAgentState}
          activation={activations[selectedAgent.id] || null}
          onClose={() => setSelectedAgent(null)}
          onSpawn={handleSpawnFromInspector}
          onToggleActivation={handleToggleActivation}
          onToggleAutonomous={handleToggleAutonomous}
        />
      )}

      {/* ── Floating notifications — real results ──────────── */}
      <FloatingNotifications />

      {/* ── Agent output viewer ────────────────────────────── */}
      {showOutput && (
        <AgentOutput onClose={() => setShowOutput(false)} />
      )}

      {/* ── Modals ────────────────────────────────────────── */}
      {showCreate && (
        <CreateAgentForm
          onCreated={(a) => setAgents((prev) => [...prev, a])}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showSpawn && (
        <SpawnPanel agents={agents} onClose={() => setShowSpawn(false)} onResult={() => { load(); loadAgentStates(); }} />
      )}
    </div>
  );
}
