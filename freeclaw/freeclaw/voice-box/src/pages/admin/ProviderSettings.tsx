import { useState, useEffect, useCallback, useMemo } from 'react';
import { Key, RefreshCcw, Check, X, AlertTriangle, ChevronDown, ChevronRight, Zap, Star, Search } from 'lucide-react';
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
  compat?: string;
  note?: string;
}

interface CategoryInfo {
  categories: Record<string, string[]>;
  names: Record<string, string>;
  total: number;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d4a574',
  gemini: '#4285f4',
  nvidia: '#76b900',
  mistral: '#ff6f00',
  deepseek: '#4d6bfe',
  groq: '#f55036',
  xai: '#ffffff',
  cohere: '#39594D',
  perplexity: '#20B8CD',
  together: '#8B5CF6',
  fireworks: '#FF6B35',
  openrouter: '#6366f1',
  cerebras: '#FF5722',
};

const DEFAULT_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4', 'claude-haiku-3.5'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  nvidia: ['meta/llama-3.1-70b-instruct', 'meta/llama-3.1-405b-instruct', 'mistralai/mistral-large-2-instruct', 'google/gemma-2-27b-it'],
  mistral: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  xai: ['grok-3', 'grok-2'],
};

// Category icons and accent colors
const CATEGORY_STYLES: Record<string, { icon: string; accent: string; bg: string }> = {
  major:       { icon: '⭐', accent: 'text-amber-400', bg: 'bg-amber-400/10' },
  chinese:     { icon: '🇨🇳', accent: 'text-red-400', bg: 'bg-red-400/10' },
  cloud:       { icon: '☁️', accent: 'text-blue-400', bg: 'bg-blue-400/10' },
  inference:   { icon: '⚡', accent: 'text-purple-400', bg: 'bg-purple-400/10' },
  ecosystem_302: { icon: '🌐', accent: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  selfhosted:  { icon: '🖥️', accent: 'text-green-400', bg: 'bg-green-400/10' },
  other:       { icon: '🔧', accent: 'text-slate-400', bg: 'bg-slate-400/10' },
};

export default function ProviderSettings() {
  const { toast } = useApp();
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [categoryInfo, setCategoryInfo] = useState<CategoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set(['major']));
  const [searchQuery, setSearchQuery] = useState('');
  // Per-provider edit state
  const [editKey, setEditKey] = useState('');
  const [_editModel, _setEditModel] = useState('');
  const [editCustomModel, setEditCustomModel] = useState('');
  const [savingModel, setSavingModel] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        api.get<Record<string, ProviderConfig>>('/api/providers?action=list'),
        api.get<CategoryInfo>('/api/providers?action=categories'),
      ]);
      setProviders(p);
      setCategoryInfo(c);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const testProvider = async (pid: string) => {
    setTesting(pid);
    try {
      const r = await api.post<{ success: boolean; latency_ms?: number; error?: string }>('/api/providers', { action: 'test_provider', provider: pid });
      const pName = providers[pid]?.name ?? pid;
      if (r.success) {
        toast(`${pName}: OK (${r.latency_ms}ms)`, 'ok');
      } else {
        toast(`${pName}: Failed — ${r.error}`, 'err');
      }
      await load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
    setTesting(null);
  };

  const testAll = async () => {
    setTestingAll(true);
    try {
      const r = await api.post<Record<string, { success: boolean }>>('/api/providers', { action: 'test_all' });
      const ok = Object.values(r).filter((v) => v.success).length;
      const total = Object.keys(r).length;
      toast(`Tested ${total} providers: ${ok} OK, ${total - ok} failed`, ok > 0 ? 'ok' : 'err');
      await load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
    setTestingAll(false);
  };

  const setDefault = async (pid: string) => {
    try {
      await api.post('/api/providers', { action: 'set_default', provider: pid });
      toast(`${providers[pid]?.name ?? pid} set as default`, 'ok');
      await load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
  };

  const saveKey = async (pid: string) => {
    try {
      const config: Record<string, unknown> = {};
      if (editKey) config.key = editKey;
      config.enabled = true;
      await api.post('/api/providers', { action: 'update_provider', provider: pid, config });
      toast(`${providers[pid]?.name ?? pid} key updated`, 'ok');
      setExpanded(null); setEditKey('');
      await load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
  };

  const saveModel = async (pid: string, model: string) => {
    setSavingModel(pid);
    try {
      await api.post('/api/providers', { action: 'update_provider', provider: pid, config: { model } });
      toast(`${providers[pid]?.name ?? pid} → ${model}`, 'ok');
      await load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
    setSavingModel(null);
  };

  const toggleProvider = async (pid: string, enabled: boolean) => {
    try {
      await api.post('/api/providers', { action: 'update_provider', provider: pid, config: { enabled } });
      toast(`${providers[pid]?.name ?? pid} ${enabled ? 'enabled' : 'disabled'}`, 'ok');
      await load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  /* Group providers by category, with search filter */
  const groupedProviders = useMemo(() => {
    if (!categoryInfo) return [];
    const q = searchQuery.toLowerCase();
    const groups: { cat: string; name: string; style: typeof CATEGORY_STYLES.major; items: ProviderConfig[]; enabledCount: number }[] = [];

    for (const [cat, ids] of Object.entries(categoryInfo.categories)) {
      const items = ids
        .filter((id) => providers[id])
        .map((id) => providers[id]!)
        .filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.includes(q) || p.model.toLowerCase().includes(q))
        .sort((a, b) => (a.is_default ? -1 : b.is_default ? 1 : a.priority - b.priority));
      if (items.length > 0) {
        groups.push({
          cat,
          name: categoryInfo.names[cat] ?? cat,
          style: CATEGORY_STYLES[cat] ?? CATEGORY_STYLES.other ?? { icon: '🔧', accent: 'text-ink3', bg: 'bg-surface2' },
          items,
          enabledCount: items.filter((i) => i.enabled).length,
        });
      }
    }
    return groups;
  }, [providers, categoryInfo, searchQuery]);

  /* Flat sorted for search mode */
  const flatSorted = useMemo(() => {
    if (!searchQuery) return null;
    return Object.values(providers)
      .filter((p) => {
        const q = searchQuery.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.id.includes(q) || p.model.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.is_default ? -1 : b.is_default ? 1 : a.priority - b.priority));
  }, [providers, searchQuery]);

  const renderProvider = (p: ProviderConfig) => {
    const isExpanded = expanded === p.id;
    const suggestedModels = DEFAULT_MODELS[p.id] || [];

    return (
      <div key={p.id} className="rounded-xl border border-border/60 bg-surface/50 hover:bg-surface2/50 transition-all duration-200 overflow-hidden" style={{ borderLeft: `3px solid ${p.is_default ? 'var(--vb-accent)' : PROVIDER_COLORS[p.id] || 'var(--vb-border)'}` }}>
        <div className="p-3 flex items-center gap-2.5">
          {/* Default star */}
          <button
            className={`shrink-0 transition-colors ${p.is_default ? 'text-amber-400' : 'text-ink3 hover:text-amber-300'}`}
            onClick={() => setDefault(p.id)}
            title={p.is_default ? 'Default provider' : 'Set as default'}
          >
            <Star size={15} fill={p.is_default ? 'currentColor' : 'none'} />
          </button>

          {/* Name + model */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[13px] text-ink truncate">{p.name}</span>
              {p.is_default && (
                <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 uppercase tracking-wider">Default</span>
              )}
              {p.note && (
                <span className="text-[8px] font-mono text-ink3/60 truncate max-w-[120px]" title={p.note}>SDK required</span>
              )}
            </div>
            {/* Model selector */}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-ink3 shrink-0">Model:</span>
              <select
                className="input !text-[10px] !py-0.5 !px-1 !w-auto min-w-0 flex-1 !bg-surface2/60"
                value={suggestedModels.includes(p.model) ? p.model : '__custom__'}
                onChange={(e) => {
                  if (e.target.value !== '__custom__') saveModel(p.id, e.target.value);
                }}
              >
                {suggestedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="__custom__">{p.model}</option>
              </select>
            </div>
            {/* Key + status */}
            <div className="flex items-center gap-2 mt-0.5">
              {p.key_masked ? (
                <span className="text-[10px] font-mono text-ink3">Key: {p.key_masked}</span>
              ) : p.has_env_key ? (
                <span className="text-[10px] font-mono text-good">Env var</span>
              ) : (
                <span className="text-[10px] text-warn">No key</span>
              )}
              {p.status === 'ok' && <span className="text-[9px] text-good font-semibold">● OK</span>}
              {p.status === 'failed' && <span className="text-[9px] text-bad font-semibold">● Failed</span>}
              {p.status === 'untested' && <span className="text-[9px] text-ink3/50">● Untested</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button className="btn btn-ghost !p-1 !text-xs" onClick={() => testProvider(p.id)} disabled={testing === p.id} title="Test">
              {testing === p.id ? <RefreshCcw size={12} className="animate-spin" /> : <Zap size={12} />}
            </button>
            <button className="btn btn-ghost !p-1 !text-xs" onClick={() => { setExpanded(isExpanded ? null : p.id); setEditKey(''); }} title="Settings">
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            <button
              className={`btn !text-[9px] !px-1.5 !py-0.5 ${p.enabled ? 'btn-ghost text-warn' : 'btn-primary !bg-surface2 !text-ink2'}`}
              onClick={() => toggleProvider(p.id, !p.enabled)}
            >
              {p.enabled ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        {/* Expanded: API key + custom model */}
        {isExpanded && (
          <div className="px-3 pb-3 pt-2 border-t border-border/40 space-y-2.5">
            <div>
              <label className="text-[10px] font-semibold text-ink2 block mb-0.5">API Key</label>
              <div className="flex gap-1.5">
                <input type="password" className="input !text-[10px] !py-1 flex-1" placeholder={p.key_masked || 'sk-...'} value={editKey} onChange={(e) => setEditKey(e.target.value)} />
                {editKey && (
                  <button className="btn btn-primary !text-[10px] !py-1" onClick={() => saveKey(p.id)}>
                    <Check size={10} /> Save
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-ink2 block mb-0.5">Custom Model</label>
              <div className="flex gap-1.5">
                <input
                  className="input !text-[10px] !py-1 flex-1"
                  placeholder="Any model ID..."
                  value={editCustomModel}
                  onChange={(e) => setEditCustomModel(e.target.value)}
                />
                <button
                  className="btn btn-primary !text-[10px] !py-1"
                  disabled={!editCustomModel || editCustomModel === p.model || savingModel === p.id}
                  onClick={() => { saveModel(p.id, editCustomModel); setEditCustomModel(''); }}
                >
                  {savingModel === p.id ? <RefreshCcw size={10} className="animate-spin" /> : <Check size={10} />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[9px] text-ink3">
              {p.last_tested && <span>Tested: {new Date(p.last_tested).toLocaleString()}</span>}
              <span className="font-mono">Priority: {p.priority}</span>
              {p.compat && <span className="font-mono">Compat: {p.compat}</span>}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-semibold text-base flex items-center gap-2">
            <Key size={16} className="text-accent" /> API Providers
            <span className="text-[10px] font-mono text-ink3 font-normal ml-1">{categoryInfo?.total || Object.keys(providers).length}</span>
          </h2>
          <p className="text-[11px] text-ink3 mt-0.5">
            Failover chain: default → priority order. Click ★ for default.
          </p>
        </div>
        <button className="btn btn-ghost !text-xs" onClick={testAll} disabled={testingAll}>
          <Zap size={13} className={testingAll ? 'animate-pulse' : ''} /> {testingAll ? 'Testing…' : 'Test all'}
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
        <input
          className="input !text-xs !py-2 !pl-8 w-full"
          placeholder={`Search ${categoryInfo?.total || '…'} providers…`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink" onClick={() => setSearchQuery('')}>
            <X size={12} />
          </button>
        )}
      </div>

      {loading && <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}</div>}

      {/* Search results — flat list */}
      {!loading && flatSorted && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-ink3 font-mono">{flatSorted.length} results</p>
          {flatSorted.map(renderProvider)}
          {flatSorted.length === 0 && (
            <p className="text-xs text-ink3 text-center py-4">No providers match "{searchQuery}"</p>
          )}
        </div>
      )}

      {/* Categorized view */}
      {!loading && !flatSorted && groupedProviders.map(({ cat, name, style, items, enabledCount }) => {
        const isOpen = expandedCategories.has(cat);
        return (
          <div key={cat} className="rounded-xl border border-border/40 overflow-hidden">
            {/* Category header */}
            <button
              className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-surface2/30 transition-colors"
              onClick={() => toggleCategory(cat)}
            >
              <span className="text-sm">{style?.icon ?? '🔧'}</span>
              <span className="font-display font-semibold text-[13px] text-ink flex-1">{name}</span>
              <span className="text-[9px] font-mono text-ink3">{enabledCount}/{items.length} active</span>
              {isOpen ? <ChevronDown size={14} className="text-ink3" /> : <ChevronRight size={14} className="text-ink3" />}
            </button>
            {/* Provider list */}
            {isOpen && (
              <div className="px-2 pb-2 space-y-1">
                {items.map(renderProvider)}
              </div>
            )}
          </div>
        );
      })}

      {/* Info footer */}
      <div className="rounded-xl px-4 py-3 text-[11px] text-ink3 flex items-start gap-2 bg-surface2/50">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          <strong>How it works:</strong> ★ sets default (tried first). DB keys override env vars. Failover chains through all enabled providers automatically. SDK-only providers (Bedrock, Azure, Vertex) need external setup.
        </span>
      </div>
    </div>
  );
}
