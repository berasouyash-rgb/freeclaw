import { X, Clock, CheckCircle2, AlertTriangle, Zap, Download, Copy, Check, Power, PowerOff } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { Agent, AgentState, AgentActivation } from './types';
import { DIV_COLORS, TIER_COLORS } from './constants';
import { safeStringify } from '../../../lib/utils';

/* ── Copy button ─────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };
  return (
    <button onClick={copy} className="p-1.5 rounded-md hover:bg-surface2 transition-colors" title="Copy">
      {copied ? <Check size={12} className="text-good" /> : <Copy size={12} className="text-ink3" />}
    </button>
  );
}

/* ── Download button ─────────────────────────────────────────── */
function DownloadBtn({ data, filename }: { data: any; filename: string }) {
  const download = () => {
    const json = typeof data === 'string' ? data : safeStringify(data, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <button onClick={download} className="p-1.5 rounded-md hover:bg-surface2 transition-colors" title="Download JSON">
      <Download size={12} className="text-ink3" />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   INSPECTOR PANEL — Real agent state from API
   Right sidebar showing agent detail, real task, real result
   ═══════════════════════════════════════════════════════════════ */
export default function InspectorPanel({
  agent,
  agentState,
  activation,
  onClose,
  onSpawn,
  onToggleActivation,
  onToggleAutonomous,
}: {
  agent: Agent | null;
  agentState: AgentState | null;
  activation?: AgentActivation | null;
  onClose: () => void;
  onSpawn: (agentId: string) => void;
  onToggleActivation?: (agentId: string, active: boolean) => void;
  onToggleAutonomous?: (agentId: string, autonomous: boolean) => void;
}) {
  // All hooks must be called before any early returns
  const colors = agent ? (DIV_COLORS[agent.division] ?? DIV_COLORS.specialist ?? { bg: 'bg-surface2', text: 'text-ink2', border: 'border-border' }) : { bg: 'bg-surface2', text: 'text-ink2', border: 'border-border' };
  const state = agentState;

  const isWorking = state?.state === 'working';
  const isCompleted = state?.state === 'completed';
  const isError = state?.state === 'error';
  const isIdle = !state || state.state === 'idle';
  const isActive = activation?.active !== false;
  const isAutonomous = activation?.autonomous || false;

  // Format result for display
  const resultText = useMemo(() => {
    if (!state?.result) return '';
    return typeof state.result === 'string' ? state.result : safeStringify(state.result, 2);
  }, [state?.result]);

  if (!agent) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-sm z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm md:hidden" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-sm bg-surface border-l border-border shadow-2xl flex flex-col panel-slide">
        {/* Header */}
        <div className={`px-5 py-4 border-b ${colors.border} ${colors.bg} flex items-center gap-3`}>
          <span className="text-3xl">{agent.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-ink1 truncate">{agent.name}</p>
            <p className="text-[11px] text-ink3 truncate">{agent.role}</p>
          </div>
          <div className="flex items-center gap-1">
            {resultText && (
              <>
                <CopyBtn text={resultText} />
                <DownloadBtn data={resultText} filename={`${agent.name.toLowerCase().replace(/\s+/g, '-')}-result.json`} />
              </>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface2 transition-colors">
              <X size={16} className="text-ink3" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Badges row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${TIER_COLORS[agent.tier] ?? 'text-ink3 bg-surface2'}`}>{agent.tier}</span>
            <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>{agent.division}</span>
            {/* Active/Offline badge */}
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full transition-colors duration-300 ${
              isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-ink3/15 text-ink3'
            }`}>
              {isActive ? '● Online' : '○ Offline'}
            </span>
            {/* Autonomous badge */}
            {isAutonomous && (
              <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400">
                ⚡ Autonomous
              </span>
            )}
            {/* Real state badge */}
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full transition-colors duration-300 ${
              isWorking ? 'bg-emerald-500/15 text-emerald-400' :
              isCompleted ? 'bg-sky-500/15 text-sky-400' :
              isError ? 'bg-red-500/15 text-red-400' :
              'bg-surface2 text-ink3'
            }`}>
              {isWorking ? '⚡ Working' : isCompleted ? '✓ Done' : isError ? '✕ Error' : '◦ Idle'}
            </span>
          </div>

          {/* Description */}
          <p className="text-[11px] text-ink2 leading-relaxed">{agent.description}</p>

          {/* Real-time state panel */}
          {state && !isIdle && (
            <div className="rounded-xl bg-surface2 border border-border p-4 space-y-3 chat-msg-anim">
              <p className="text-[9px] font-bold text-ink3 uppercase tracking-wider">Real-time Status</p>

              {/* Current task */}
              {state.task && (
                <div className="space-y-1.5">
                  <p className="text-[9px] text-ink3 uppercase tracking-wider">Current Task</p>
                  <div className="bg-surface rounded-lg p-2.5 border border-border">
                    <p className="text-[11px] text-ink1 font-mono leading-relaxed">{state.task}</p>
                  </div>
                </div>
              )}

              {/* Timing */}
              <div className="grid grid-cols-2 gap-2">
                {state.started_at && (
                  <div className="flex items-center gap-1.5">
                    <Clock size={11} className="text-ink3" />
                    <div>
                      <p className="text-[8px] text-ink3 uppercase">Started</p>
                      <p className="text-[10px] text-ink1 font-mono">{new Date(state.started_at).toLocaleTimeString()}</p>
                    </div>
                  </div>
                )}
                {state.completed_at && (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={11} className="text-ink3" />
                    <div>
                      <p className="text-[8px] text-ink3 uppercase">Completed</p>
                      <p className="text-[10px] text-ink1 font-mono">{new Date(state.completed_at).toLocaleTimeString()}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress bar */}
              {isWorking && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-ink3">
                    <span>Progress</span>
                    <span className="font-mono">{state.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all duration-700 ease-out"
                      style={{ width: `${state.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Result preview */}
              {isCompleted && state.result && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] text-ink3 uppercase tracking-wider">Result</p>
                    <div className="flex items-center gap-0.5">
                      <CopyBtn text={resultText} />
                      <DownloadBtn data={state.result} filename={`${agent.name.toLowerCase().replace(/\s+/g, '-')}-result.json`} />
                    </div>
                  </div>
                  <div className="bg-surface rounded-lg p-2.5 border border-border max-h-40 overflow-y-auto">
                    <pre className="text-[10px] text-ink1 font-mono whitespace-pre-wrap break-all leading-relaxed">
                      {resultText.slice(0, 500)}
                      {resultText.length > 500 && '\n… (truncated)'}
                    </pre>
                  </div>
                </div>
              )}

              {/* Error detail */}
              {isError && state.result && (
                <div className="space-y-1.5">
                  <p className="text-[9px] text-red-400 uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle size={10} /> Error
                  </p>
                  <div className="bg-red-500/5 rounded-lg p-2.5 border border-red-500/20">
                    <p className="text-[10px] text-red-400 font-mono leading-relaxed">{String(state.result)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Capabilities */}
          <div>
            <p className="text-[9px] font-bold text-ink3 uppercase tracking-wider mb-2">Capabilities</p>
            <div className="flex flex-wrap gap-1">
              {agent.capabilities.map((c) => (
                <span key={c} className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-surface2 border border-border text-ink2 hover:border-accent/50 transition-colors cursor-default">
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* Permissions */}
          <div>
            <p className="text-[9px] font-bold text-ink3 uppercase tracking-wider mb-2">Permissions</p>
            <div className="flex flex-wrap gap-1">
              {agent.permissions.map((p) => (
                <span key={p} className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-accent-soft text-accent border border-accent/20">
                  {p}
                </span>
              ))}
            </div>
          </div>

          {/* Activation Controls */}
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-[9px] font-bold text-ink3 uppercase tracking-wider">Controls</p>
            {/* Activate/Deactivate toggle */}
            <button
              onClick={() => onToggleActivation?.(agent.id, !isActive)}
              disabled={isWorking}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ${
                !isActive
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                  : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20'
              } ${isWorking ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isActive ? <><PowerOff size={14} /> Deactivate Agent</> : <><Power size={14} /> Activate Agent</>}
            </button>
            {/* Autonomous mode toggle */}
            {isActive && (
              <button
                onClick={() => onToggleAutonomous?.(agent.id, !isAutonomous)}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ${
                  isAutonomous
                    ? 'bg-violet-500 text-white hover:bg-violet-600'
                    : 'bg-violet-500/10 text-violet-400 border border-violet-500/30 hover:bg-violet-500/20'
                }`}
              >
                {isAutonomous ? <><Zap size={14} /> Disable Autonomous</> : <><Zap size={14} /> Enable Autonomous</>}
              </button>
            )}
          </div>

          {/* Spawn action */}
          <div className="pt-2 border-t border-border">
            <button
              onClick={() => onSpawn(agent.id)}
              disabled={isWorking}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ${
                isWorking
                  ? 'bg-surface2 text-ink3 cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent/90 hover:shadow-lg hover:shadow-accent/10'
              }`}
            >
              {isWorking ? (
                <>
                  <span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                  Running…
                </>
              ) : (
                <>
                  <Zap size={14} /> Spawn Agent
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
