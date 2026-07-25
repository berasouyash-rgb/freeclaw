// AI Health Monitor — comprehensive platform health checks.
// GET /api/health  →  full health check with status for each subsystem
import supabase from './_db-client.js';
import { cors, isAdmin } from './_auth.js';
import { buildChain } from './_providers.js';
import { sanitizeError } from './_error.js';
import { getSystemHealth, checkDatabaseHealth, checkProviderHealth } from './_observability.js';
import { getAllCircuitStatus } from './_reliability.js';
import { cacheStats } from './_cache.js';

async function checkTable(tableName) {
  const start = Date.now();
  try {
    const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
    if (error) throw error;
    return { status: 'ok', count: count || 0, latency_ms: Date.now() - start };
  } catch (err) {
    return { status: 'error', error: String(err.message).replace(/(?:password|secret|token|key|credential)[^\s]*/gi, '[REDACTED]'), latency_ms: Date.now() - start };
  }
}

// FIX-#2: Cache LLM provider results for 60s to prevent cold-start race conditions
let _llmCache = null;
let _llmCacheExpiry = 0;
const LLM_CACHE_TTL_MS = 60_000;

async function checkLLMProviders() {
  const now = Date.now();
  if (_llmCache && _llmCacheExpiry > now) return _llmCache;

  // Check env vars directly
  const envKeys = [
    'NVIDIA_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
    'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY',
    'XAI_API_KEY', 'COHERE_API_KEY', 'TOGETHER_API_KEY', 'PERPLEXITY_API_KEY',
  ];
  const envAvailable = envKeys.filter((k) => !!process.env[k]).map((k) => k.replace('_API_KEY', '').toLowerCase());

  // Also check DB-stored providers via the provider chain
  let dbAvailable = [];
  try {
    const chain = await buildChain();
    dbAvailable = chain.map((p) => p.id);
  } catch { /* non-fatal — DB check may fail */ }

  // Merge both sources, deduplicate
  const available = [...new Set([...envAvailable, ...dbAvailable])];
  const result = { status: available.length > 0 ? 'ok' : 'degraded', available, count: available.length, env: envAvailable, db: dbAvailable };
  _llmCache = result;
  _llmCacheExpiry = now + LLM_CACHE_TTL_MS;
  return result;
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // Require admin auth — exposes internal metrics, DB latency, provider details
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const start = Date.now();

    // Run all checks in parallel
    const [dbCheck, postsCheck, commentsCheck, usersCheck, reportsCheck] = await Promise.all([
      (async () => {
        const t = Date.now();
        try {
          const { error } = await supabase.from('settings').select('key').limit(1);
          return { status: error ? 'error' : 'ok', latency_ms: Date.now() - t, error: error?.message };
        } catch (e) { return { status: 'error', latency_ms: Date.now() - t, error: e.message }; }
      })(),
      checkTable('posts'),
      checkTable('comments'),
      checkTable('users_meta'),
      checkTable('reports'),
    ]);

    const llmCheck = await checkLLMProviders();

    // Recent errors (from activity_logs)
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    let errorCount = 0;
    try {
      const { count } = await supabase.from('activity_logs').select('*', { count: 'exact', head: true })
        .gte('created_at', oneHourAgo).like('action', '%error%');
      errorCount = count || 0;
    } catch { /* non-fatal */ }

    const totalLatency = Date.now() - start;

    // Get system health, circuit status, and cache stats
    const systemHealth = getSystemHealth();
    const circuitStatus = getAllCircuitStatus();
    const cacheInfo = cacheStats();

    // Determine overall status
    const checks = { database: dbCheck, posts: postsCheck, comments: commentsCheck, users: usersCheck, reports: reportsCheck, llm_providers: llmCheck, errors: { status: errorCount < 10 ? 'ok' : 'warning', count_last_hour: errorCount } };
    const hasError = Object.values(checks).some((c) => c.status === 'error');
    const hasWarning = Object.values(checks).some((c) => c.status === 'warning' || c.status === 'degraded');
    const overallStatus = hasError ? 'unhealthy' : hasWarning ? 'degraded' : 'healthy';

    return res.status(200).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
      circuits: circuitStatus,
      cache: cacheInfo,
      system: systemHealth,
      response_time_ms: totalLatency,
      version: '3.0.0',
    });
  } catch (err) {
    return sanitizeError(res, err, 'health');
  }
}
