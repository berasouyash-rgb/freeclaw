/* ── Shared types for the Agent Team Office ───────────────────── */

export interface Agent {
  id: string;
  name: string;
  division: string;
  icon: string;
  role: string;
  description: string;
  permissions: string[];
  capabilities: string[];
  status: string;
  tier: string;
  custom?: boolean;
  created_at?: string;
}

export interface Division {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  agents: { id: string; name: string; icon: string }[];
  count: number;
}

export interface Dashboard {
  total_agents: number;
  active_agents: number;
  custom_agents: number;
  total_roles: number;
  active_workflows: number;
  division_counts: Record<string, number>;
  tier_counts: Record<string, number>;
  agent_states: { working: number; completed: number; error: number; idle: number };
  recent_results: number;
}

/* ── Real-time agent state from backend ──────────────────── */
export interface AgentState {
  agent_id: string;
  state: 'idle' | 'working' | 'completed' | 'error';
  task: string | null;
  started_at: string | null;
  completed_at: string | null;
  progress: number;
  result: any | null;
  updated_at: string;
}

/* ── Workflow result from backend ────────────────────────── */
export interface WorkflowResult {
  workflow_id: string;
  classification: { division: string; priority: string };
  agents_used: { id: string; name: string; icon: string; status: string }[];
  results: { agent_id: string; agent_name: string; icon: string; result: any }[];
  total_time_ms: number;
  created_at: string;
  completed_at: string;
  task: string;
}

export interface Role {
  id: string;
  name: string;
  level: number;
  permissions: string[];
  description: string;
}

/* ── Room layout definition ──────────────────────────────── */
export interface RoomDef {
  id: string;
  name: string;
  icon: string;
  divisions: string[];
  accent: string;
  span: 'sm' | 'md' | 'lg';
  highlight?: boolean;
}

/* ── Agent activation state (persisted) ──────────────────── */
export interface AgentActivation {
  id: string;
  name: string;
  icon: string;
  division: string;
  active: boolean;
  autonomous: boolean;
  activated_at: string | null;
  deactivated_at: string | null;
}

/* ── Agent activity types (kept for constants compat) ────── */
export type AgentActivity =
  | 'typing' | 'thinking' | 'reviewing' | 'monitoring'
  | 'debugging' | 'testing' | 'deploying' | 'reporting'
  | 'idle' | 'meeting' | 'celebrating' | 'reading';
