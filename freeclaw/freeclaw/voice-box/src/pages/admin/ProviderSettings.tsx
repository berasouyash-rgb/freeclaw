import { useState, useEffect, useCallback } from 'react';
import { Key, RefreshCcw, Check, X, AlertTriangle, ChevronDown, ChevronUp, Zap, Star } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';

interface ProviderConfig {
  id: string;
  name: string;
  model: string;
  enabled: boolean;
  priority: number;
  is_default: boolean;
  status: 'untested' | 'ok' | 'failed';
  last_tested: string | null;
  key_masked: string;
  has_env_key: boolean;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d4a574',
  gemini: '#4285f4',
  nvidia: '#76b900',
  mistral: '#ff6f00',
  deepseek: '#4d6bfe',
  groq: '#f55036',
};

const DEFAULT_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4', 'claude-haiku-3.5'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  nvidia: ['meta/llama-3.1-70b-instruct', 'meta/llama-3.1-405b-instruct', 'mistralai/mistral-large-2-instruct', 'google/gemma-2-27b-it'],
  mistral: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
};

export default function ProviderSettings() {
  const { toast } = useApp();
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Per-provider edit state
  const [editKey, setEditKey] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editCustomModel, setEditCustomModel] = useState('');
  const [savingModel, setSavingModel] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/providers?action=list');
      setProviders(data);
    } catch (e: any) { toast(e.message, 'err'); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const testProvider = async (pid: string) => {
    setTesting(pid);
    try {
      const r = await api.post('/api/providers', { action: 'test_provider', provider: pid });
      if (r.success) {
        toast(`${providers[pid].name}: OK (${r.latency_ms}ms)`, 'ok');
      } else {
        toast(`${providers[pid].name}: Failed — ${r.error}`, 'err');
      }
      await load();
    } catch (e: any) { toast(e.message, 'err'); }
    setTesting(null);
  };

  const testAll = async () => {
    setTestingAll(true);
    try {
      const r = await api.post('/api/providers', { action: 'test_all' });
      const ok = Object.values(r).filter((v: any) => v.success).length;
      const total = Object.keys(r).length;
      toast(`Tested ${total} providers: ${ok} OK, ${total - ok} failed`, ok > 0 ? 'ok' : 'err');
      await load();
    } catch (e: any) { toast(e.message, 'err'); }
    setTestingAll(false);
  };

  const setDefault = async (pid: string) => {
    try {
      await api.post('/api/providers', { action: 'set_default', provider: pid });
      toast(`${providers[pid].name} set as default`, 'ok');
      await load();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const saveKey = async (pid: string) => {
    try {
      const config: any = {};
      if (editKey) config.key = editKey;
      config.enabled = true;
      await api.post('/api/providers', { action: 'update_provider', provider: pid, config });
      toast(`${providers[pid].name} key updated`, 'ok');
      setExpanded(null); setEditKey('');
      await load();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const saveModel = async (pid: string, model: string) => {
    setSavingModel(pid);
    try {
      await api.post('/api/providers', { action: 'update_provider', provider: pid, config: { model } });
      toast(`${providers[pid].name} → ${model}`, 'ok');
      await load();
    } catch (e: any) { toast(e.message, 'err'); }
    setSavingModel(null);
  };

  const toggleProvider = async (pid: string, enabled: boolean) => {
    try {
      await api.post('/api/providers', { action: 'update_provider', provider: pid, config: { enabled } });
      toast(`${providers[pid].name} ${enabled ? 'enabled' : 'disabled'}`, 'ok');
      await load();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const sorted = Object.values(providers).sort((a, b) => {
    // Default always first
    if (a.is_default && !b.is_default) return -1;
    if (!a.is_default && b.is_default) return 1;
    return a.priority - b.priority;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-semibold text-base flex items-center gap-2"><Key size={16} className="text-accent" /> API Providers</h2>
          <p className="text-[11px] text-ink3 mt-0.5">Configure AI providers for analysis and agent chat. Click ★ to set the default provider. Models are fully customizable. Failover chain: default → priority order.</p>
        </div>
        <button className="btn btn-ghost !text-xs" onClick={testAll} disabled={testingAll}>
          <Zap size={13} className={testingAll ? 'animate-pulse' : ''} /> {testingAll ? 'Testing…' : 'Test all'}
        </button>
      </div>

      {loading && <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}</div>}

      {!loading && sorted.map((p) => {
        const isExpanded = expanded === p.id;
        const suggestedModels = DEFAULT_MODELS[p.id] || [];

        return (
          <div key={p.id} className="card p-4" style={{ borderLeft: `3px solid ${p.is_default ? 'var(--vb-accent)' : PROVIDER_COLORS[p.id] || 'var(--vb-accent)'}` }}>
            <div className="flex items-center gap-3">
              {/* Default star */}
              <button
                className={`shrink-0 transition-colors ${p.is_default ? 'text-amber-400' : 'text-ink3 hover:text-amber-300'}`}
                onClick={() => setDefault(p.id)}
                title={p.is_default ? 'Default provider (click to change)' : 'Set as default provider'}
              >
                <Star size={18} fill={p.is_default ? 'currentColor' : 'none'} />
              </button>

              {/* Name + model */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold text-sm">{p.name}</span>
                  {p.is_default && (
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 uppercase tracking-wider">Default</span>
                  )}
                </div>

                {/* Model selector — always visible */}
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-ink3 shrink-0">Model:</span>
                  <select
                    className="input !text-[11px] !py-0.5 !px-1.5 !w-auto min-w-0 flex-1"
                    value={suggestedModels.includes(p.model) ? p.model : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') {
                        saveModel(p.id, e.target.value);
                      }
                    }}
                  >
                    {suggestedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                    <option value="__custom__">{p.model}</option>
                  </select>
                </div>

                {/* Key + status row */}
                <div className="flex items-center gap-2 mt-0.5">
                  {p.key_masked ? (
                    <span className="text-[10px] font-mono text-ink3">Key: {p.key_masked}</span>
                  ) : p.has_env_key ? (
                    <span className="text-[10px] font-mono text-good">Using env var</span>
                  ) : (
                    <span className="text-[10px] text-warn">No key configured</span>
                  )}
                  {p.status === 'ok' && <span className="text-[10px] text-good font-semibold">● OK</span>}
                  {p.status === 'failed' && <span className="text-[10px] text-bad font-semibold">● Failed</span>}
                  {p.status === 'untested' && <span className="text-[10px] text-ink3">● Untested</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button className="btn btn-ghost !p-1.5 !text-xs" onClick={() => testProvider(p.id)} disabled={testing === p.id} title="Test connection">
                  {testing === p.id ? <RefreshCcw size={13} className="animate-spin" /> : <Zap size={13} />}
                </button>
                <button className="btn btn-ghost !p-1.5 !text-xs" onClick={() => { setExpanded(isExpanded ? null : p.id); setEditKey(''); }} title="API key settings">
                  {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                <button
                  className={`btn !text-[10px] !px-2 !py-1 ${p.enabled ? 'btn-ghost text-warn' : 'btn-primary !bg-surface2 !text-ink2'}`}
                  onClick={() => toggleProvider(p.id, !p.enabled)}
                >
                  {p.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>

            {/* Expanded: API key + custom model */}
            {isExpanded && (
              <div className="mt-3 pt-3 border-t border-border space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-ink2 block mb-1">API Key</label>
                  <div className="flex gap-2">
                    <input type="password" className="input !text-xs flex-1" placeholder={p.key_masked || 'sk-...'} value={editKey} onChange={(e) => setEditKey(e.target.value)} />
                    {editKey && (
                      <button className="btn btn-primary !text-xs" onClick={() => saveKey(p.id)}>
                        <Check size={12} /> Save
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-ink2 block mb-1">Custom Model</label>
                  <div className="flex gap-2">
                    <input
                      className="input !text-xs flex-1"
                      placeholder="Enter any model ID..."
                      value={editCustomModel}
                      onChange={(e) => setEditCustomModel(e.target.value)}
                    />
                    <button
                      className="btn btn-primary !text-xs"
                      disabled={!editCustomModel || editCustomModel === p.model || savingModel === p.id}
                      onClick={() => { saveModel(p.id, editCustomModel); setEditCustomModel(''); }}
                    >
                      {savingModel === p.id ? <RefreshCcw size={12} className="animate-spin" /> : <Check size={12} />} Set
                    </button>
                  </div>
                  <p className="text-[10px] text-ink3 mt-1">Type any model ID from this provider — it will override the preset.</p>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-ink3">
                  {p.last_tested && <span>Last tested: {new Date(p.last_tested).toLocaleString()}</span>}
                  <span className="font-mono">Priority: {p.priority}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="rounded-xl px-4 py-3 text-[11px] text-ink3 flex items-start gap-2 bg-surface2">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          <strong>How it works:</strong> Click the ★ star to set the default provider (tried first). Disable providers you don't use. Models are fully customizable — pick from presets or enter any model ID. Keys are stored in your database (never sent to the browser). Env vars work as fallback. If no provider is configured, built-in heuristic engines keep all features functional.
        </span>
      </div>
    </div>
  );
}
