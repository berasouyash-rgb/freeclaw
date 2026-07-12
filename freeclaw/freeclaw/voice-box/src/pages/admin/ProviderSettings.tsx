import { useState, useEffect, useCallback } from 'react';
import { Key, RefreshCcw, Check, X, AlertTriangle, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';

interface ProviderConfig {
  id: string;
  name: string;
  model: string;
  enabled: boolean;
  priority: number;
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

export default function ProviderSettings() {
  const { toast } = useApp();
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editModel, setEditModel] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const saveProvider = async (pid: string) => {
    try {
      const config: any = { model: editModel };
      if (editKey) config.key = editKey;
      config.enabled = true;
      await api.post('/api/providers', { action: 'update_provider', provider: pid, config });
      toast(`${providers[pid].name} updated`, 'ok');
      setEditing(null); setEditKey(''); setEditModel('');
      await load();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const toggleProvider = async (pid: string, enabled: boolean) => {
    try {
      await api.post('/api/providers', { action: 'update_provider', provider: pid, config: { enabled } });
      toast(`${providers[pid].name} ${enabled ? 'enabled' : 'disabled'}`, 'ok');
      await load();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const sorted = Object.values(providers).sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-semibold text-base flex items-center gap-2"><Key size={16} className="text-accent" /> API Providers</h2>
          <p className="text-[11px] text-ink3 mt-0.5">Configure AI providers for analysis and agent chat. Tried in priority order — if one fails, the next is used automatically. Env vars work as fallback.</p>
        </div>
        <button className="btn btn-ghost !text-xs" onClick={testAll} disabled={testingAll}>
          <Zap size={13} className={testingAll ? 'animate-pulse' : ''} /> {testingAll ? 'Testing…' : 'Test all'}
        </button>
      </div>

      {loading && <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}</div>}

      {!loading && sorted.map((p) => (
        <div key={p.id} className="card p-4" style={{ borderLeft: `3px solid ${PROVIDER_COLORS[p.id] || 'var(--vb-accent)'}` }}>
          <div className="flex items-center gap-3">
            {/* Priority number */}
            <div className="w-7 h-7 rounded-lg bg-surface2 grid place-items-center text-[11px] font-mono font-bold text-ink3 shrink-0">
              {p.priority}
            </div>

            {/* Name + model */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display font-semibold text-sm">{p.name}</span>
                <span className="text-[10px] font-mono text-ink3 px-1.5 py-0.5 rounded bg-surface2">{p.model}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {p.key_masked ? (
                  <span className="text-[10px] font-mono text-ink3">Key: {p.key_masked}</span>
                ) : p.has_env_key ? (
                  <span className="text-[10px] font-mono text-good">Using env var</span>
                ) : (
                  <span className="text-[10px] text-ink3">No key configured</span>
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
              <button className="btn btn-ghost !p-1.5 !text-xs" onClick={() => { setExpanded(expanded === p.id ? null : p.id); }} title="Configure">
                {expanded === p.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              <button
                className={`btn !text-[10px] !px-2 !py-1 ${p.enabled ? 'btn-ghost text-warn' : 'btn-primary !bg-surface2 !text-ink2'}`}
                onClick={() => toggleProvider(p.id, !p.enabled)}
              >
                {p.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>

          {/* Expanded config */}
          {expanded === p.id && (
            <div className="mt-3 pt-3 border-t border-border space-y-3">
              {editing === p.id ? (
                <>
                  <div>
                    <label className="text-[11px] font-semibold text-ink2 block mb-1">API Key</label>
                    <input type="password" className="input !text-xs" placeholder={p.key_masked || 'sk-...'} value={editKey} onChange={(e) => setEditKey(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-ink2 block mb-1">Model</label>
                    <input className="input !text-xs" value={editModel} onChange={(e) => setEditModel(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary !text-xs" onClick={() => saveProvider(p.id)}>Save</button>
                    <button className="btn btn-ghost !text-xs" onClick={() => { setEditing(null); setEditKey(''); }}>Cancel</button>
                  </div>
                </>
              ) : (
                <div className="flex gap-2">
                  <button className="btn btn-ghost !text-xs" onClick={() => { setEditing(p.id); setEditModel(p.model); setEditKey(''); }}>Edit key / model</button>
                  {p.last_tested && <span className="text-[10px] text-ink3 self-center">Last tested: {new Date(p.last_tested).toLocaleString()}</span>}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="rounded-xl px-4 py-3 text-[11px] text-ink3 flex items-start gap-2 bg-surface2">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>API keys are stored in your database and never sent to the browser. If no DB key is configured, environment variables are used as fallback. If neither exists, built-in heuristic engines keep all features functional.</span>
      </div>
    </div>
  );
}
