import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, RefreshCcw, Search, ChevronDown, ChevronUp, Plus, Trash2,
  Loader2, Zap, Shield, GitMerge, Sparkles, Bot, Crown, Eye,
  X, ArrowRight, CheckCircle2, XCircle, Activity, BarChart3,
  Layers, Settings, Target, AlertTriangle, Play, Pause,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';

/* ── Types ─────────────────────────────────────────────────── */
interface Agent {
  id: string;
  name: string;
  icon: string;
  division: string;
  role: string;
  description: string;
  permissions: string[];
  capabilities: string[];
  status: 'active' | 'paused' | 'error';
  tier: string;
  custom?: boolean;
}

interface Division {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  agents: { id: string; name: string; icon: string }[];
  count: number;
}

interface Role {
  name: string;
  level: number;
  permissions: string[];
  description: string;
}

interface Dashboard {
  total_agents: number;
  active_agents: number;
  custom_agents: number;
  total_roles: number;
  division_counts: Record<string, number>;
  tier_counts: Record<string, number>;
  active_workflows: number;
}

interface SpawnResult {
  workflow_id: string;
  task: string;
  agents_dispatched: number;
  results: { agent_id: string; status: string; result: string }[];
}

/* ── Division color map ─────────────────────────────────────── */
const DIV_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  executive:  { bg: 'bg-amber-500/10',  border: 'border-amber-500/25',  text: 'text-amber-400',  glow: 'shadow-amber-500/10' },
  content:    { bg: 'bg-blue-500/10',   border: 'border-blue-500/25',   text: 'text-blue-400',   glow: 'shadow-blue-500/10' },
  users:      { bg: 'bg-emerald-500/10',border: 'border-emerald-500/25',text: 'text-emerald-400',glow: 'shadow-emerald-500/10' },
  analytics:  { bg: 'bg-violet-500/10', border: 'border-violet-500/25', text: 'text-violet-400', glow: 'shadow-violet-500/10' },
  system:     { bg: 'bg-red-500/10',    border: 'border-red-500/25',    text: 'text-red-400',    glow: 'shadow-red-500/10' },
  meta:       { bg: 'bg-cyan-500/10',   border: 'border-cyan-500/25',   text: 'text-cyan-400',   glow: 'shadow-cyan-500/10' },
  specialist: { bg: 'bg-pink-500/10',   border: 'border-pink-500/25',   text: 'text-pink-400',   glow: 'shadow-pink-500/10' },
};

const TIER_COLORS: Record<string, string> = {
  executive:   'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  leadership:  'bg-violet-500/15 text-violet-400 border border-violet-500/20',
  specialist:  'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  meta:        'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20',
  custom:      'bg-pink-500/15 text-pink-400 border border-pink-500/20',
};

/* ── Sub-component: Stat card ──────────────────────────────── */
function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <div className="bg-surface2 rounded-xl p-4 border border-border">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={18} />
        </div>
        <div>
          <p className="text-2xl font-bold text-ink1">{value}</p>
          <p className="text-[11px] text-ink3 font-medium">{label}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-component: Division card ──────────────────────────── */
function DivisionCard({ div, expanded, onToggle }: { div: Division; expanded: boolean; onToggle: () => void }) {
  const colors = DIV_COLORS[div.id] || DIV_COLORS.specialist;
  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden transition-all`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left hover:opacity-90 transition-opacity">
        <span className="text-2xl">{div.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-ink1">{div.name}</p>
          <p className="text-[11px] text-ink3">{div.description}</p>
        </div>
        <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-surface border border-border">{div.count}</span>
        {expanded ? <ChevronUp size={14} className="text-ink3" /> : <ChevronDown size={14} className="text-ink3" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {div.agents.map((a) => (
            <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/60 border border-border/50">
              <span className="text-base">{a.icon}</span>
              <span className="text-xs font-medium text-ink1 truncate">{a.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Sub-component: Agent card ─────────────────────────────── */
function AgentCard({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  const colors = DIV_COLORS[agent.division] || DIV_COLORS.specialist;
  const tierColor = TIER_COLORS[agent.tier] || TIER_COLORS.specialist;
  return (
    <button onClick={onClick} className={`w-full text-left rounded-xl border ${colors.border} bg-surface2 hover:shadow-lg ${colors.glow} p-4 transition-all group`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0 group-hover:scale-110 transition-transform">{agent.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink1 truncate">{agent.name}</p>
          <p className="text-[11px] text-ink3 mt-0.5 line-clamp-2">{agent.description}</p>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${tierColor}`}>{agent.tier}</span>
            <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>{agent.division}</span>
            {agent.custom && <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-400 border border-pink-500/20">CUSTOM</span>}
          </div>
        </div>
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${agent.status === 'active' ? 'bg-emerald-400 animate-pulse' : agent.status === 'paused' ? 'bg-yellow-400' : 'bg-red-400'}`} />
      </div>
    </button>
  );
}

/* ── Sub-component: Agent detail modal ─────────────────────── */
function AgentDetail({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const colors = DIV_COLORS[agent.division] || DIV_COLORS.specialist;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-surface/95 backdrop-blur-md p-5 border-b border-border flex items-center gap-3 z-10">
          <span className="text-3xl">{agent.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-ink1">{agent.name}</p>
            <p className="text-xs text-ink3">{agent.role}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface2 transition-colors"><X size={16} className="text-ink3" /></button>
        </div>
        <div className="p-5 space-y-5">
          <p className="text-sm text-ink2 leading-relaxed">{agent.description}</p>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${TIER_COLORS[agent.tier] || TIER_COLORS.specialist}`}>{agent.tier}</span>
            <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full ${colors.bg} ${colors.text}`}>{agent.division}</span>
            <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full flex items-center gap-1 ${agent.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${agent.status === 'active' ? 'bg-emerald-400' : 'bg-red-400'}`} />{agent.status}
            </span>
          </div>

          <div>
            <p className="text-[11px] font-bold text-ink3 uppercase tracking-wider mb-2">Capabilities</p>
            <div className="flex flex-wrap gap-1.5">
              {agent.capabilities.map((c) => (
                <span key={c} className="text-[10px] font-mono px-2 py-1 rounded-md bg-surface2 border border-border text-ink2">{c}</span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-ink3 uppercase tracking-wider mb-2">Permissions</p>
            <div className="flex flex-wrap gap-1.5">
              {agent.permissions.map((p) => (
                <span key={p} className="text-[10px] font-mono px-2 py-1 rounded-md bg-accent-soft text-accent border border-accent/20">{p}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-component: Create agent form ──────────────────────── */
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
      const r = await api.post('/api/agent-team', { action: 'create', name: name.trim(), description: description.trim(), icon, division, role: role.trim(), permissions: ['posts.read'], capabilities: ['custom_task'] });
      toast(`Agent "${r.agent.name}" created`, 'ok');
      onCreated(r.agent);
      onClose();
    } catch (e: any) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const iconOptions = ['🤖', '🧠', '📝', '🔍', '📊', '🛡️', '⚡', '🎯', '🧬', '💡', '🔧', '📣', '🗂️', '🧪', '🌐'];
  const divisions = ['executive', 'content', 'users', 'analytics', 'system', 'meta', 'specialist'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-md p-6 space-y-4">
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

/* ── Sub-component: Spawn workflow ─────────────────────────── */
function SpawnPanel({ agents, onClose }: { agents: Agent[]; onClose: () => void }) {
  const { toast } = useApp();
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SpawnResult | null>(null);

  const spawn = async () => {
    if (!task.trim()) { toast('Describe the task', 'err'); return; }
    setBusy(true);
    try {
      const r = await api.postLong('/api/agent-team', { action: 'spawn', task: task.trim() });
      setResult(r);
      toast(`Spawned ${r.agents_dispatched} agents`, 'ok');
    } catch (e: any) { toast(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-lg flex items-center gap-2"><Zap size={18} className="text-cyan-400" /> Spawn Subagents</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface2"><X size={14} className="text-ink3" /></button>
        </div>

        <p className="text-xs text-ink3">Describe a task and the orchestrator will classify it, select the best agents, and execute in parallel.</p>

        <div>
          <label className="text-[11px] font-bold text-ink3 uppercase tracking-wider block mb-1.5">Task Description</label>
          <textarea className="input text-sm h-20 resize-none" placeholder="e.g. Analyze all posts from this week and generate a sentiment report" value={task} onChange={(e) => setTask(e.target.value)} />
        </div>

        <button onClick={spawn} disabled={busy || !task.trim()} className="btn btn-primary w-full text-sm">
          {busy ? <Loader2 size={14} className="animate-spin mr-2" /> : <Play size={14} className="mr-2" />}
          {busy ? 'Orchestrating…' : 'Spawn & Execute'}
        </button>

        {result && (
          <div className="space-y-3 mt-2">
            <div className="flex items-center gap-2 text-sm font-bold text-ink1">
              <CheckCircle2 size={16} className="text-emerald-400" /> Result
              <span className="text-[10px] font-mono text-ink3 ml-auto">workflow: {result.workflow_id}</span>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {result.results.map((r) => {
                const agent = agents.find((a) => a.id === r.agent_id);
                return (
                  <div key={r.agent_id} className="flex items-start gap-2 p-3 rounded-lg bg-surface2 border border-border">
                    <span className="text-base flex-shrink-0">{agent?.icon || '🤖'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink1">{agent?.name || r.agent_id}</p>
                      <p className="text-[11px] text-ink3 mt-0.5">{r.result}</p>
                    </div>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full flex-shrink-0 ${r.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' : r.status === 'failed' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{r.status}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function AgentTeamPanel() {
  const { toast } = useApp();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string | null>(null);
  const [expandedDiv, setExpandedDiv] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSpawn, setShowSpawn] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [view, setView] = useState<'roster' | 'divisions' | 'roles'>('roster');

  const load = useCallback(async () => {
    try {
      const [agentsRes, divRes, dashRes, rolesRes] = await Promise.all([
        api.get('/api/agent-team?action=list'),
        api.get('/api/agent-team?action=divisions'),
        api.get('/api/agent-team?action=dashboard'),
        api.get('/api/agent-team?action=roles'),
      ]);
      setAgents(agentsRes.agents || []);
      setDivisions(divRes.divisions || []);
      setDashboard(dashRes);
      setRoles(rolesRes.roles || {});
    } catch (e: any) { toast(e.message, 'err'); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  /* Filtered agents */
  const filtered = useMemo(() => {
    let list = agents;
    if (selectedDivision) list = list.filter((a) => a.division === selectedDivision);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.capabilities.some((c) => c.includes(q)));
    }
    return list;
  }, [agents, search, selectedDivision]);

  const deleteAgent = async (id: string) => {
    if (!confirm('Delete this custom agent?')) return;
    try {
      await api.post('/api/agent-team', { action: 'delete', agent_id: id });
      setAgents((prev) => prev.filter((a) => a.id !== id));
      toast('Agent deleted', 'ok');
    } catch (e: any) { toast(e.message, 'err'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-ink3 text-sm">
        <Loader2 size={16} className="animate-spin" />
        <span>Loading agent team…</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-xl flex items-center gap-2">
            <Users className="text-accent" size={20} /> Agent Team
          </h1>
          <p className="text-xs text-ink3 mt-0.5">60+ specialized AI agents · 7 divisions · RBAC roles · subagent orchestration · custom agent builder</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSpawn(true)} className="btn btn-primary text-xs px-3 py-2">
            <Zap size={13} className="mr-1.5" /> Spawn
          </button>
          <button onClick={() => setShowCreate(true)} className="btn text-xs px-3 py-2 bg-surface2 border border-border hover:border-accent">
            <Plus size={13} className="mr-1.5" /> New Agent
          </button>
          <button onClick={load} className="btn btn-ghost !p-2" title="Refresh"><RefreshCcw size={14} /></button>
        </div>
      </div>

      {/* Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard icon={Users} label="Total Agents" value={dashboard.total_agents} color="bg-blue-500/15 text-blue-400" />
          <StatCard icon={Activity} label="Active" value={dashboard.active_agents} color="bg-emerald-500/15 text-emerald-400" />
          <StatCard icon={Bot} label="Custom" value={dashboard.custom_agents} color="bg-pink-500/15 text-pink-400" />
          <StatCard icon={Shield} label="RBAC Roles" value={dashboard.total_roles} color="bg-violet-500/15 text-violet-400" />
          <StatCard icon={GitMerge} label="Workflows" value={dashboard.active_workflows} color="bg-cyan-500/15 text-cyan-400" />
        </div>
      )}

      {/* View switcher + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5">
          {([['roster', 'Roster', Users], ['divisions', 'Divisions', Layers], ['roles', 'RBAC Roles', Shield]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setView(k as any)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-all ${view === k ? 'bg-surface shadow-sm text-accent' : 'text-ink3'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input className="input text-xs pl-8 w-full" placeholder="Search agents, capabilities…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Division filter chips (roster view) */}
      {view === 'roster' && (
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setSelectedDivision(null)}
            className={`text-[10px] font-mono px-2.5 py-1 rounded-full transition-all ${!selectedDivision ? 'bg-accent text-white' : 'bg-surface2 text-ink3 border border-border hover:border-accent'}`}>
            All ({agents.length})
          </button>
          {divisions.map((d) => {
            const c = DIV_COLORS[d.id] || DIV_COLORS.specialist;
            return (
              <button key={d.id} onClick={() => setSelectedDivision(selectedDivision === d.id ? null : d.id)}
                className={`text-[10px] font-mono px-2.5 py-1 rounded-full transition-all flex items-center gap-1 ${selectedDivision === d.id ? `${c.bg} ${c.text} border ${c.border}` : 'bg-surface2 text-ink3 border border-border hover:border-accent'}`}>
                {d.icon} {d.name.split(' ')[0]} ({d.count})
              </button>
            );
          })}
        </div>
      )}

      {/* ── Roster View ──────────────────────────────────────── */}
      {view === 'roster' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onClick={() => setSelectedAgent(agent)} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-12 text-ink3 text-sm">No agents match your search.</div>
          )}
        </div>
      )}

      {/* ── Divisions View ───────────────────────────────────── */}
      {view === 'divisions' && (
        <div className="space-y-3">
          {divisions.map((d) => (
            <DivisionCard key={d.id} div={d} expanded={expandedDiv === d.id} onToggle={() => setExpandedDiv(expandedDiv === d.id ? null : d.id)} />
          ))}
        </div>
      )}

      {/* ── RBAC Roles View ──────────────────────────────────── */}
      {view === 'roles' && (
        <div className="space-y-3">
          <p className="text-xs text-ink3">{Object.keys(roles).length} roles defined with hierarchical permission levels (10-100).</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(roles).sort(([, a], [, b]) => b.level - a.level).map(([name, role]) => (
              <div key={name} className="rounded-xl bg-surface2 border border-border p-3 hover:border-accent/40 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full ${role.level >= 80 ? 'bg-amber-500/15 text-amber-400' : role.level >= 50 ? 'bg-violet-500/15 text-violet-400' : role.level >= 30 ? 'bg-blue-500/15 text-blue-400' : 'bg-surface text-ink3 border border-border'}`}>
                    L{role.level}
                  </span>
                  <p className="text-xs font-bold text-ink1 font-mono">{name}</p>
                </div>
                <p className="text-[10px] text-ink3 mb-1.5">{role.description}</p>
                <div className="flex flex-wrap gap-1">
                  {role.permissions.slice(0, 4).map((p) => (
                    <span key={p} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border text-ink3">{p}</span>
                  ))}
                  {role.permissions.length > 4 && <span className="text-[8px] font-mono text-ink3">+{role.permissions.length - 4}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────── */}
      {selectedAgent && <AgentDetail agent={selectedAgent} onClose={() => setSelectedAgent(null)} />}
      {showCreate && <CreateAgentForm onCreated={(a) => setAgents((prev) => [...prev, a])} onClose={() => setShowCreate(false)} />}
      {showSpawn && <SpawnPanel agents={agents} onClose={() => setShowSpawn(false)} />}
    </div>
  );
}
