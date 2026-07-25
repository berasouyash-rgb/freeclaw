import { useState, useEffect } from 'react';
import { X, RefreshCcw, ChevronDown, ChevronRight, Zap, FileText, Download, Copy, Check } from 'lucide-react';
import { api } from '../../../lib/api';
import { safeStringify } from '../../../lib/utils';
import type { WorkflowResult } from './types';

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
function DownloadBtn({ data, filename }: { data: Record<string, unknown> | string; filename: string }) {
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

/* ── Result detail renderer ──────────────────────────────────── */
function ResultDetail({ result }: { result: WorkflowResult['results'][number]['result'] | null }) {
  if (!result) return <p className="text-xs text-ink3 italic">No data</p>;
  if (result.error) return <p className="text-xs text-red-400">Error: {result.error}</p>;

  const typeLabels: Record<string, { label: string; color: string }> = {
    analysis: { label: 'Analysis', color: 'text-blue-400 bg-blue-500/15' },
    moderation: { label: 'Moderation', color: 'text-amber-400 bg-amber-500/15' },
    security: { label: 'Security', color: 'text-red-400 bg-red-500/15' },
    analytics: { label: 'Analytics', color: 'text-violet-400 bg-violet-500/15' },
    tool_building: { label: 'Tool Build', color: 'text-cyan-400 bg-cyan-500/15' },
    agent_creation: { label: 'Agent Creation', color: 'text-pink-400 bg-pink-500/15' },
    platform_health: { label: 'Platform Health', color: 'text-emerald-400 bg-emerald-500/15' },
    resilience: { label: 'Resilience', color: 'text-orange-400 bg-orange-500/15' },
    api_health: { label: 'API Health', color: 'text-sky-400 bg-sky-500/15' },
    architecture: { label: 'Architecture', color: 'text-teal-400 bg-teal-500/15' },
    frontend_architecture: { label: 'Frontend Arch', color: 'text-purple-400 bg-purple-500/15' },
    database_architecture: { label: 'DB Architecture', color: 'text-green-400 bg-green-500/15' },
    infrastructure: { label: 'Infrastructure', color: 'text-slate-400 bg-slate-500/15' },
    qa_strategy: { label: 'QA Strategy', color: 'text-yellow-400 bg-yellow-500/15' },
    code_quality: { label: 'Code Quality', color: 'text-indigo-400 bg-indigo-500/15' },
    dev_assistance: { label: 'Dev Assist', color: 'text-cyan-400 bg-cyan-500/15' },
    codebase_health: { label: 'Codebase Health', color: 'text-lime-400 bg-lime-500/15' },
    generic: { label: 'Processed', color: 'text-ink3 bg-surface2' },
  };

  const typeInfo = typeLabels[result.type] ?? typeLabels.generic ?? { label: 'Processed', color: 'text-ink3 bg-surface2' };
  const data = result.data || {};
  const resultText = safeStringify(data, 2);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-bold ${typeInfo.color}`}>{typeInfo.label}</span>
        <span className="text-[10px] text-ink3">{result.agent}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <CopyBtn text={resultText} />
          <DownloadBtn data={data} filename={`${(result.agent || 'agent').toLowerCase().replace(/\s+/g, '-')}-output.json`} />
        </div>
      </div>
      <div className="bg-surface2/50 rounded-lg p-3 border border-border">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex items-start gap-2 py-1 border-b border-border/50 last:border-0">
            <span className="text-[10px] font-mono text-ink3 uppercase tracking-wider min-w-[80px] flex-shrink-0">{key}</span>
            <span className="text-[11px] text-ink1 font-mono break-all">
              {typeof value === 'object' ? safeStringify(value, 1) : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AGENT OUTPUT VIEWER
   Shows real workflow results from agent execution
   ═══════════════════════════════════════════════════════════════ */
export default function AgentOutput({ onClose }: { onClose: () => void }) {
  const [results, setResults] = useState<WorkflowResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailExpanded, setDetailExpanded] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.get<{ results?: WorkflowResult[] }>('/api/agent-team?action=results&limit=50');
      setResults(r.results || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Auto-refresh every 5s
  useEffect(() => {
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  // Download all results
  const downloadAll = () => {
    const json = safeStringify(results, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agent-outputs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col vb-pop">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <FileText size={16} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base">Agent Output</h3>
              <p className="text-[10px] text-ink3">{results.length} workflow results · real execution data</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {results.length > 0 && (
              <button onClick={downloadAll} className="btn btn-ghost !text-xs !py-1.5" title="Download all results">
                <Download size={13} /> Export All
              </button>
            )}
            <button onClick={load} className="p-2 rounded-lg hover:bg-surface2 transition-colors" title="Refresh">
              <RefreshCcw size={14} className="text-ink3" />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface2 transition-colors">
              <X size={14} className="text-ink3" />
            </button>
          </div>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && (
            <div className="text-center py-8 text-ink3 text-xs">Loading results…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="text-center py-12">
              <Zap size={32} className="text-ink3 mx-auto mb-3" />
              <p className="text-sm font-bold text-ink1">No workflow results yet</p>
              <p className="text-xs text-ink3 mt-1">Spawn agents from the Office tab to see real execution output here</p>
            </div>
          )}
          {results.map((wf) => (
            <div key={wf.workflow_id} className="bg-surface2 rounded-xl border border-border overflow-hidden chat-msg-anim">
              {/* Workflow header */}
              <button
                onClick={() => setExpanded(expanded === wf.workflow_id ? null : wf.workflow_id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface2/80 text-left transition-colors"
              >
                {expanded === wf.workflow_id ? <ChevronDown size={14} className="text-ink3" /> : <ChevronRight size={14} className="text-ink3" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-ink1 truncate">{wf.task}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${
                      wf.classification.priority === 'critical' ? 'bg-red-500/15 text-red-400' :
                      wf.classification.priority === 'high' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-sky-500/15 text-sky-400'
                    }`}>{wf.classification.priority}</span>
                    <span className="text-[9px] font-mono text-ink3">{wf.classification.division}</span>
                    <span className="text-[9px] text-ink3">·</span>
                    <span className="text-[9px] text-ink3">{wf.agents_used.length} agents</span>
                    <span className="text-[9px] text-ink3">·</span>
                    <span className="text-[9px] text-ink3">{wf.total_time_ms}ms</span>
                  </div>
                </div>
                <div className="flex -space-x-1.5 flex-shrink-0">
                  {wf.agents_used.slice(0, 5).map((a, i) => (
                    <span key={i} className="w-6 h-6 rounded-full bg-surface border border-border flex items-center justify-center text-[10px]">{a.icon}</span>
                  ))}
                  {wf.agents_used.length > 5 && (
                    <span className="w-6 h-6 rounded-full bg-surface border border-border flex items-center justify-center text-[8px] text-ink3">+{wf.agents_used.length - 5}</span>
                  )}
                </div>
                <CopyBtn text={safeStringify(wf, 2)} />
              </button>

              {/* Expanded results */}
              {expanded === wf.workflow_id && (
                <div className="px-4 pb-4 space-y-2 border-t border-border">
                  <p className="text-[10px] text-ink3 pt-2 font-mono">{new Date(wf.created_at).toLocaleString()}</p>
                  {wf.results.map((r, i) => (
                    <div key={i} className="bg-surface rounded-lg border border-border overflow-hidden chat-msg-anim">
                      <button
                        onClick={() => setDetailExpanded(detailExpanded === `${wf.workflow_id}_${i}` ? null : `${wf.workflow_id}_${i}`)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface2/50 text-left transition-colors"
                      >
                        <span className="text-sm">{r.icon}</span>
                        <span className="text-[11px] font-bold text-ink1 flex-1">{r.agent_name}</span>
                        {r.result?.error
                          ? <span className="text-[9px] font-mono text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded-full">error</span>
                          : <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded-full">done</span>
                        }
                        {detailExpanded === `${wf.workflow_id}_${i}` ? <ChevronDown size={12} className="text-ink3" /> : <ChevronRight size={12} className="text-ink3" />}
                      </button>
                      {detailExpanded === `${wf.workflow_id}_${i}` && (
                        <div className="px-3 pb-3 border-t border-border/50">
                          <ResultDetail result={r.result} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
