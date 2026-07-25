import { useState, useEffect, useCallback } from 'react';
import { Bot, RefreshCcw, Check, X, ShieldAlert, ArrowRight, Clock, GitMerge, MessageSquare, Flag, Activity } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { timeAgo } from '../../lib/utils';
import { safeStringify } from '../../lib/utils';
import { Modal } from '../../components/ui';
import AgentChat from './AgentChat';
import type { LucideIcon } from 'lucide-react';

interface AgentSuggestion {
  id: number;
  kind: string;
  title: string;
  reasoning: string;
  content?: Record<string, string>;
  critical?: boolean;
  status: 'pending' | 'approved' | 'dismissed';
  confidence?: number;
  outcome?: string;
  created_at: string;
}

const KIND_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  status_change: { label: 'Status change', icon: Activity, color: 'var(--vb-accent)' },
  solved_confirm: { label: 'Confirm solved', icon: Check, color: 'var(--vb-good)' },
  escalation: { label: 'Escalation', icon: Flag, color: 'var(--vb-bad)' },
  reply: { label: 'Reply draft', icon: MessageSquare, color: 'var(--vb-good)' },
  merge: { label: 'Merge duplicate', icon: GitMerge, color: 'var(--vb-warn)' },
};

export default function AgentPanel() {
  const { toast } = useApp();
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<AgentSuggestion | null>(null);
  const [editText, setEditText] = useState('');
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [mode, setMode] = useState<'chat' | 'suggestions'>('chat');

  const load = useCallback(async () => {
    try { setSuggestions(await api.get<Record<string, unknown>[]>('/api/agent')); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to load', 'err'); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ created?: number }>('/api/agent', { action: 'generate' });
      toast(r.created ? `${r.created} new suggestion(s) drafted` : 'No new suggestions — everything looks handled', 'ok');
      await load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Generate failed', 'err'); }
    setBusy(false);
  };

  const dismiss = async (id: number) => {
    try { await api.put<unknown>('/api/agent', { id, action: 'dismiss' }); load(); toast('Dismissed', 'ok'); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Dismiss failed', 'err'); }
  };

  const approve = async (sug: AgentSuggestion, confirmed = false, edited?: string) => {
    if (sug.critical && !confirmed) { setConfirming(sug); setEditText(sug.content?.to || sug.content?.reply || ''); return; }
    try {
      await api.put<unknown>('/api/agent', { id: sug.id, action: 'approve', confirmed: true, edited_text: edited });
      setConfirming(null); load();
      toast('Approved and applied ✅', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Approve failed', 'err'); }
  };

  const pending = suggestions.filter((s) => s.status === 'pending');
  const history = suggestions.filter((s) => s.status !== 'pending');
  const shown = tab === 'pending' ? pending : history;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display font-bold text-xl flex items-center gap-2"><Bot className="text-accent" size={20} /> AI Agent</h1>
          <p className="text-xs text-ink3 mt-0.5">Natural language chat for quick questions, plus an approval pipeline for bulk actions. Destructive operations always require your confirmation.</p>
        </div>
      </div>

      {/* Mode switcher */}
      <div className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5">
        {([['chat', 'Chat'], ['suggestions', 'Suggestions']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setMode(k)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${mode === k ? 'bg-surface shadow-sm text-accent' : 'text-ink3'}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'chat' && <AgentChat />}

      {mode === 'suggestions' && (<>
        <div className="flex items-center justify-end flex-wrap gap-2">
          <button className="btn btn-primary !text-xs" onClick={generate} disabled={busy}>
            <RefreshCcw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'Drafting…' : 'Generate suggestions'}
          </button>
        </div>

        <div className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5">
          {(['pending', 'history'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${tab === t ? 'bg-surface shadow-sm text-accent' : 'text-ink3'}`}>
              {t} ({t === 'pending' ? pending.length : history.length})
            </button>
          ))}
        </div>

      {loading && <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}</div>}

      {!loading && shown.length === 0 && (
        <div className="card p-10 text-center">
          <Bot size={28} className="mx-auto text-ink3 mb-2" />
          <p className="font-display font-semibold text-sm">{tab === 'pending' ? 'No pending suggestions' : 'No history yet'}</p>
          <p className="text-xs text-ink3 mt-1">{tab === 'pending' ? 'Click "Generate suggestions" to have the agent review current posts.' : 'Approved and dismissed suggestions will appear here.'}</p>
        </div>
      )}

      <div className="space-y-3">
        {shown.map((s) => {
          const meta = KIND_META[s.kind] ?? KIND_META.status_change ?? { icon: Bot, label: 'Unknown', color: '#888' };
          const Icon = meta.icon;
          const p = s.content || {};
          return (
            <div key={s.id} className={`card p-4 vb-rise ${s.status !== 'pending' ? 'opacity-70' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="chip !text-[10px]" style={{ color: meta.color, borderColor: meta.color + '44' }}><Icon size={11} /> {meta.label}</span>
                {s.critical && <span className="chip !text-[10px]" style={{ color: 'var(--vb-bad)', borderColor: 'rgba(220,75,75,0.3)' }}><ShieldAlert size={11} /> Critical — needs 2-step confirm</span>}
                {s.status !== 'pending' && <span className={`chip !text-[10px] capitalize ${s.status === 'approved' ? '!text-good' : ''}`}>{s.status}</span>}
                <span className="ml-auto text-[10px] text-ink3 flex items-center gap-1"><Clock size={10} /> {timeAgo(s.created_at)}</span>
              </div>

              <p className="text-sm font-medium mb-2">{s.title}</p>

              {/* Exact visual diff */}
              <div className="rounded-xl bg-surface2 p-3 mb-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-1 rounded-lg text-xs font-mono line-through" style={{ background: 'rgba(220,75,75,0.1)', color: 'var(--vb-bad)' }}>
                    {String(p.from || '(current)').slice(0, 60) || '(empty)'}
                  </span>
                  <ArrowRight size={13} className="text-ink3 shrink-0" />
                  <span className="px-2 py-1 rounded-lg text-xs font-mono" style={{ background: 'rgba(22,160,106,0.1)', color: 'var(--vb-good)' }}>
                    {String(p.to || p.status || p.reply || safeStringify(p)).slice(0, 120)}
                  </span>
                </div>
                {s.kind === 'merge' && p.keep_title && <p className="text-[11px] text-ink3 mt-1.5">→ merges into “{p.keep_title}”</p>}
              </div>

              <p className="text-xs text-ink2 leading-relaxed mb-3">💭 {s.reasoning} {typeof s.confidence === 'number' && <span className="text-ink3">· confidence {Math.round(s.confidence * 100)}%</span>}</p>

              {s.outcome && s.status !== 'pending' && (
                <p className="text-[11px] text-ink3 italic mb-2">📋 {s.outcome}</p>
              )}

              {s.status === 'pending' && (
                <div className="flex gap-2">
                  <button className="btn !text-xs !py-1.5" style={{ background: 'rgba(22,160,106,0.12)', color: 'var(--vb-good)' }} onClick={() => approve(s)}>
                    <Check size={13} /> {s.critical ? 'Review & approve…' : 'Approve & apply'}
                  </button>
                  <button className="btn btn-ghost !text-xs !py-1.5" onClick={() => dismiss(s.id)}><X size={13} /> Dismiss</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>)}

      {/* Second-step confirmation for critical suggestions */}
      <Modal open={!!confirming} onClose={() => setConfirming(null)} title="⚠️ Critical suggestion — confirm">
        {confirming && (
          <>
            <p className="text-sm text-ink2 leading-relaxed mb-3">{confirming.reasoning}</p>
            {confirming.kind === 'reply' && (
              <>
                <label className="text-xs font-semibold text-ink2 block mb-1.5">Edit reply before applying (optional)</label>
                <textarea className="input min-h-20 text-sm mb-3" value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={1000} />
              </>
            )}
            <div className="rounded-xl p-3 text-xs mb-4" style={{ background: 'rgba(220,75,75,0.08)', border: '1px solid rgba(220,75,75,0.25)', color: 'var(--vb-bad)' }}>
              This is flagged as a critical / safety-related change. Confirming will apply it immediately and record it permanently in the audit log.
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn btn-ghost" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="btn" style={{ background: 'var(--vb-bad)', color: '#fff' }} onClick={() => approve(confirming, true, editText)}>
                <Check size={14} /> Confirm & apply
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
