// Multi-provider API key management with failover chain.
// Keys stored in DB (settings.api_providers) with env vars as fallback.
// Priority: DB keys → env vars → heuristic fallback.
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';

// ─── Provider Registry ────────────────────────────────────────────
const PROVIDER_DEFS = {
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    buildHeaders: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, messages) => ({ model, max_tokens: 2048, temperature: 0.2, messages }),
    parseResponse: (data) => data?.choices?.[0]?.message?.content,
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    buildHeaders: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }),
    buildBody: (model, messages) => {
      const sys = messages.find((m) => m.role === 'system');
      const user = messages.filter((m) => m.role !== 'system');
      return { model, max_tokens: 2048, ...(sys ? { system: sys.content } : {}), messages: user };
    },
    parseResponse: (data) => data?.content?.[0]?.text,
    envKey: 'ANTHROPIC_API_KEY',
  },
  gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-2.5-pro',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    buildHeaders: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, messages) => ({ model, max_tokens: 2048, temperature: 0.2, messages }),
    parseResponse: (data) => data?.choices?.[0]?.message?.content,
    envKey: 'GEMINI_API_KEY',
  },
  nvidia: {
    name: 'NVIDIA NIM',
    defaultModel: 'meta/llama-3.1-70b-instruct',
    baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    buildHeaders: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, messages) => ({ model, max_tokens: 2048, temperature: 0.2, messages }),
    parseResponse: (data) => data?.choices?.[0]?.message?.content,
    envKey: 'NVIDIA_API_KEY',
  },
  mistral: {
    name: 'Mistral',
    defaultModel: 'mistral-large-latest',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    buildHeaders: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, messages) => ({ model, max_tokens: 2048, temperature: 0.2, messages }),
    parseResponse: (data) => data?.choices?.[0]?.message?.content,
    envKey: 'MISTRAL_API_KEY',
  },
  deepseek: {
    name: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    buildHeaders: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, messages) => ({ model, max_tokens: 2048, temperature: 0.2, messages }),
    parseResponse: (data) => data?.choices?.[0]?.message?.content,
    envKey: 'DEEPSEEK_API_KEY',
  },
  groq: {
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    buildHeaders: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, messages) => ({ model, max_tokens: 2048, temperature: 0.2, messages }),
    parseResponse: (data) => data?.choices?.[0]?.message?.content,
    envKey: 'GROQ_API_KEY',
  },
};

// ─── DB helpers ───────────────────────────────────────────────────
async function getProviders() {
  const { data } = await supabase.from('settings').select('value').eq('key', 'api_providers').maybeSingle();
  return data?.value || {};
}

async function saveProviders(providers) {
  const { data } = await supabase.from('settings').select('key').eq('key', 'api_providers').maybeSingle();
  if (data) await supabase.from('settings').update({ value: providers }).eq('key', 'api_providers');
  else await supabase.from('settings').insert({ key: 'api_providers', value: providers });
}

// ─── Mask key for frontend display ────────────────────────────────
function maskKey(key) {
  if (!key || key.length < 8) return '';
  return '••••••' + key.slice(-4);
}

// ─── Build priority-ordered chain from DB + env vars ──────────────
async function buildChain() {
  const db = await getProviders();
  const chain = [];
  // DB-configured providers first (sorted by priority)
  const dbEntries = Object.entries(db)
    .filter(([id, cfg]) => cfg.enabled && cfg.key)
    .sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
  for (const [id, cfg] of dbEntries) {
    const def = PROVIDER_DEFS[id];
    if (!def) continue;
    chain.push({ id, ...def, key: cfg.key, model: cfg.model || def.defaultModel });
  }
  // Env var fallbacks (only if not already added from DB)
  const dbIds = new Set(dbEntries.map(([id]) => id));
  for (const [id, def] of Object.entries(PROVIDER_DEFS)) {
    if (dbIds.has(id)) continue;
    const key = process.env[def.envKey];
    if (key) chain.push({ id, ...def, key, model: def.defaultModel });
  }
  return chain;
}

// ─── Call one provider ────────────────────────────────────────────
async function callProvider(provider, messages, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: provider.buildHeaders(provider.key),
      body: JSON.stringify(provider.buildBody(provider.model, messages)),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, error: `HTTP ${resp.status}: ${err.slice(0, 200)}` };
    }
    const data = await resp.json();
    const text = provider.parseResponse(data);
    if (!text) return { ok: false, error: 'Empty response from provider' };
    return { ok: true, text, provider: provider.id, model: provider.model };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Failover chain call ─────────────────────────────────────────
export async function callLLMChain(system, user, extraMessages = []) {
  const chain = await buildChain();
  const messages = [
    { role: 'system', content: system },
    ...extraMessages,
    { role: 'user', content: user },
  ];
  for (const provider of chain) {
    const result = await callProvider(provider, messages);
    if (result.ok) {
      return { provider: result.provider, model: result.model, text: result.text };
    }
    console.warn(`Provider ${provider.id} failed:`, result.error);
  }
  return null; // all failed → caller should use heuristic
}

// ─── HTTP Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const b = req.body || {};
    const action = req.method === 'GET' ? (req.query.action || 'list') : b.action;

    // GET /api/providers?action=list → return all providers (keys masked)
    if (req.method === 'GET' && action === 'list') {
      const db = await getProviders();
      const result = {};
      for (const [id, def] of Object.entries(PROVIDER_DEFS)) {
        const cfg = db[id] || {};
        result[id] = {
          id,
          name: def.name,
          model: cfg.model || def.defaultModel,
          enabled: !!cfg.enabled,
          priority: cfg.priority || Object.keys(PROVIDER_DEFS).indexOf(id) + 1,
          status: cfg.status || 'untested',
          last_tested: cfg.last_tested || null,
          key_masked: cfg.key ? maskKey(cfg.key) : (process.env[def.envKey] ? maskKey(process.env[def.envKey]) : ''),
          has_env_key: !!process.env[def.envKey],
        };
      }
      return res.status(200).json(result);
    }

    // POST /api/providers → update, test, reorder
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // update_provider
    if (action === 'update_provider') {
      const { provider: pid, config } = b;
      if (!pid || !PROVIDER_DEFS[pid]) return res.status(400).json({ error: 'Invalid provider' });
      const db = await getProviders();
      db[pid] = { ...(db[pid] || {}), ...config };
      // If key changed, reset status
      if (config.key !== undefined) db[pid].status = 'untested';
      await saveProviders(db);
      await auditLog('admin', 'update_provider', `Updated provider ${pid}`);
      return res.status(200).json({ ok: true });
    }

    // test_provider
    if (action === 'test_provider') {
      const { provider: pid } = b;
      if (!pid || !PROVIDER_DEFS[pid]) return res.status(400).json({ error: 'Invalid provider' });
      const def = PROVIDER_DEFS[pid];
      const db = await getProviders();
      const cfg = db[pid] || {};
      const key = cfg.key || process.env[def.envKey];
      if (!key) return res.status(400).json({ error: 'No API key configured for this provider' });

      const provider = { id: pid, ...def, key, model: cfg.model || def.defaultModel };
      const start = Date.now();
      const result = await callProvider(provider, [
        { role: 'system', content: 'You are a test endpoint. Respond with ONLY valid JSON.' },
        { role: 'user', content: 'Say "hello" by responding with exactly: {"response":"hello"}' },
      ], 10000);
      const latency = Date.now() - start;

      // Update status in DB
      db[pid] = { ...(db[pid] || {}), status: result.ok ? 'ok' : 'failed', last_tested: new Date().toISOString() };
      await saveProviders(db);

      return res.status(200).json({
        success: result.ok,
        latency_ms: latency,
        model: provider.model,
        error: result.ok ? undefined : result.error,
      });
    }

    // test_all
    if (action === 'test_all') {
      const db = await getProviders();
      const results = {};
      for (const [pid, def] of Object.entries(PROVIDER_DEFS)) {
        const cfg = db[pid] || {};
        const key = cfg.key || process.env[def.envKey];
        if (!key) { results[pid] = { success: false, error: 'No API key' }; continue; }
        const provider = { id: pid, ...def, key, model: cfg.model || def.defaultModel };
        const start = Date.now();
        const result = await callProvider(provider, [
          { role: 'system', content: 'You are a test endpoint. Respond with ONLY valid JSON.' },
          { role: 'user', content: 'Say "hello" by responding with exactly: {"response":"hello"}' },
        ], 10000);
        results[pid] = { success: result.ok, latency_ms: Date.now() - start, model: provider.model, error: result.ok ? undefined : result.error };
        db[pid] = { ...(db[pid] || {}), status: result.ok ? 'ok' : 'failed', last_tested: new Date().toISOString() };
      }
      await saveProviders(db);
      await auditLog('admin', 'test_all_providers', `Tested all providers`);
      return res.status(200).json(results);
    }

    // reorder_providers
    if (action === 'reorder_providers') {
      const { order } = b;
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of provider IDs' });
      const db = await getProviders();
      order.forEach((pid, i) => {
        if (db[pid]) db[pid].priority = i + 1;
      });
      await saveProviders(db);
      await auditLog('admin', 'reorder_providers', `New order: ${order.join(', ')}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('providers API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
