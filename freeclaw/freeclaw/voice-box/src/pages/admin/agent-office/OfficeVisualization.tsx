import { useMemo } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import type { Agent, AgentState, AgentActivation } from './types';
import { DIV_COLORS, ROOMS } from './constants';

/* ── Single agent desk ──────────────────────────────────────── */
function AgentDesk({ agent, state, selected, onClick, highlight, activation }: {
  agent: Agent;
  state: AgentState;
  selected: boolean;
  onClick: () => void;
  highlight: boolean;
  activation?: AgentActivation;
}) {
  const divColor = DIV_COLORS[agent.division] ?? DIV_COLORS.specialist ?? { bg: 'bg-surface2', text: 'text-ink2', border: 'border-border' };
  const isWorking = state.state === 'working';
  const isCompleted = state.state === 'completed';
  const isError = state.state === 'error';
  const isActive = activation?.active !== false;
  const isAutonomous = activation?.autonomous || false;

  return (
    <button
      onClick={onClick}
      className={`
        agent-desk relative flex flex-col items-center gap-1 p-2.5 rounded-xl border cursor-pointer
        transition-all duration-200
        ${!isActive ? 'opacity-40 grayscale' : ''}
        ${selected ? 'bg-accent-soft border-accent ring-1 ring-accent/30 scale-105' : 'bg-surface2/60 border-border hover:border-accent/50 hover:bg-surface2'}
        ${highlight ? 'ring-2 ring-accent/40' : ''}
      `}
      title={`${agent.name} — ${agent.role}\n${!isActive ? 'OFFLINE' : state.state === 'idle' ? 'Idle' : state.state === 'working' ? `Working: ${state.task?.slice(0, 60) || '...'}` : isCompleted ? 'Completed task' : 'Error'}${isAutonomous ? '\n⚡ Autonomous' : ''}`}
    >
      {/* Status indicator dot */}
      <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-surface transition-colors duration-300 ${
        !isActive ? 'bg-ink3/60' :
        isWorking ? 'bg-emerald-400 animate-pulse' :
        isCompleted ? 'bg-sky-400' :
        isError ? 'bg-red-400' :
        'bg-ink3/40'
      }`} />

      {/* Autonomous indicator */}
      {isAutonomous && isActive && (
        <div className="absolute -top-1 -left-1 w-3 h-3 rounded-full border-2 border-surface bg-violet-400 animate-pulse" title="Autonomous" />
      )}

      {/* Icon */}
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all duration-300 ${
        isWorking ? `${divColor.bg} animate-vbPulse` : divColor.bg
      }`}>
        {agent.icon}
      </div>

      {/* Name */}
      <p className={`text-[9px] font-bold text-center leading-tight truncate w-full transition-colors duration-200 ${
        highlight ? 'text-accent' : !isActive ? 'text-ink3' : 'text-ink1'
      }`}>{agent.name}</p>

      {/* Role */}
      <p className={`text-[8px] text-center leading-tight truncate w-full ${!isActive ? 'text-ink3/60' : 'text-ink3'}`}>{agent.role}</p>

      {/* Offline badge */}
      {!isActive && (
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-ink3/70 text-white text-[7px] px-2 py-0.5 rounded-full whitespace-nowrap font-mono shadow-sm">
          offline
        </div>
      )}

      {/* Working task indicator */}
      {isWorking && state.task && (
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-emerald-500/90 text-white text-[7px] px-2 py-0.5 rounded-full whitespace-nowrap font-mono max-w-[100px] truncate shadow-sm">
          working…
        </div>
      )}

      {/* Completed badge */}
      {isCompleted && (
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-sky-500/90 text-white text-[7px] px-2 py-0.5 rounded-full whitespace-nowrap font-mono shadow-sm">
          done ✓
        </div>
      )}

      {/* Error badge */}
      {isError && (
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-red-500/90 text-white text-[7px] px-2 py-0.5 rounded-full whitespace-nowrap font-mono shadow-sm">
          error
        </div>
      )}
    </button>
  );
}

/* ── Room component ──────────────────────────────────────────── */
function Room({ room, agents, agentStates, selectedAgentId, onSelect, searchQuery, activations }: {
  room: typeof ROOMS[number];
  agents: Agent[];
  agentStates: Record<string, AgentState>;
  selectedAgentId: string | null;
  onSelect: (a: Agent) => void;
  searchQuery: string;
  activations?: Record<string, AgentActivation>;
}) {
  const roomAgents = useMemo(() => {
    return agents.filter((a) => room.divisions.includes(a.division));
  }, [agents, room]);

  if (roomAgents.length === 0) return null;

  const workingCount = roomAgents.filter((a) => agentStates[a.id]?.state === 'working').length;

  return (
    <div className={`bg-surface rounded-xl border border-border p-3 transition-all duration-300 chat-msg-anim ${room.highlight ? 'ring-1 ring-accent/20' : ''}`}>
      {/* Room header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base">{room.icon}</span>
          <h3 className="text-[11px] font-bold text-ink1">{room.name}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {workingCount > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {workingCount} active
            </span>
          )}
          <span className="text-[9px] text-ink3 font-mono">{roomAgents.length}</span>
        </div>
      </div>

      {/* Agent desks grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5">
        {roomAgents.map((agent) => (
          <AgentDesk
            key={agent.id}
            agent={agent}
            state={agentStates[agent.id] || { agent_id: agent.id, state: 'idle', task: null, started_at: null, completed_at: null, progress: 0, result: null, updated_at: '' }}
            selected={selectedAgentId === agent.id}
            onClick={() => onSelect(agent)}
            highlight={searchQuery.length > 0 && (
              agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              agent.role.toLowerCase().includes(searchQuery.toLowerCase())
            )}
            activation={activations?.[agent.id]}
          />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   OFFICE VISUALIZATION — Real agent states from API
   ═══════════════════════════════════════════════════════════════ */
export default function OfficeVisualization({
  agents,
  agentStates,
  selectedAgentId,
  onSelectAgent,
  searchQuery,
  isConnected,
  activations,
}: {
  agents: Agent[];
  agentStates: Record<string, AgentState>;
  selectedAgentId: string | null;
  onSelectAgent: (a: Agent) => void;
  searchQuery: string;
  isConnected: boolean;
  activations?: Record<string, AgentActivation>;
}) {
  // Stats
  const stats = useMemo(() => {
    const working = Object.values(agentStates).filter((s) => s.state === 'working').length;
    const completed = Object.values(agentStates).filter((s) => s.state === 'completed').length;
    const error = Object.values(agentStates).filter((s) => s.state === 'error').length;
    const inactive = activations ? agents.filter((a) => activations[a.id]?.active === false).length : 0;
    const idle = agents.length - working - completed - error - inactive;
    return { working, completed, error, idle: Math.max(0, idle), inactive };
  }, [agentStates, agents, activations]);

  return (
    <div className="space-y-3">
      {/* Connection status + live stats bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-[10px] font-mono ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {isConnected ? 'Live' : 'Disconnected'}
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-ink3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> {stats.working} working
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-400" /> {stats.completed} done
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-ink3/40" /> {stats.idle} idle
            </span>
            {stats.inactive > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-ink3/20" /> {stats.inactive} offline
              </span>
            )}
            {stats.error > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-400" /> {stats.error} error
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-ink3 font-mono">{agents.length} agents</span>
      </div>

      {/* Rooms grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {ROOMS.map((room) => (
          <Room
            key={room.id}
            room={room}
            agents={agents}
            agentStates={agentStates}
            selectedAgentId={selectedAgentId}
            onSelect={onSelectAgent}
            searchQuery={searchQuery}
            activations={activations}
          />
        ))}
      </div>
    </div>
  );
}
