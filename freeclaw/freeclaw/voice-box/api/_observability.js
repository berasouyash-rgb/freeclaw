// ─── V3 Enterprise Observability ────────────────────────────────
// Structured logging, request tracing, performance metrics,
// error tracking, and system health monitoring.
import supabase from './_db-client.js';

// ─── Log Levels ─────────────────────────────────────────────────
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, CRITICAL: 4 };
const currentLevel = LEVELS[process.env.LOG_LEVEL?.toUpperCase() || 'INFO'];

// ─── Structured Logger ──────────────────────────────────────────
function formatLog(level, category, message, data = {}) {
  return {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    ...data,
    env: process.env.VERCEL_ENV || 'development',
    region: process.env.VERCEL_REGION || 'local',
  };
}

export const logger = {
  debug: (cat, msg, data) => {
    if (currentLevel <= LEVELS.DEBUG) console.log(JSON.stringify(formatLog('DEBUG', cat, msg, data)));
  },
  info: (cat, msg, data) => {
    if (currentLevel <= LEVELS.INFO) console.log(JSON.stringify(formatLog('INFO', cat, msg, data)));
  },
  warn: (cat, msg, data) => {
    if (currentLevel <= LEVELS.WARN) console.warn(JSON.stringify(formatLog('WARN', cat, msg, data)));
  },
  error: (cat, msg, data) => {
    if (currentLevel <= LEVELS.ERROR) console.error(JSON.stringify(formatLog('ERROR', cat, msg, data)));
  },
  critical: (cat, msg, data) => {
    console.error(JSON.stringify(formatLog('CRITICAL', cat, msg, data)));
  },
};

// ─── Request Tracing ────────────────────────────────────────────
// Generate unique request ID for distributed tracing
export function generateRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Trace a request with timing, context, and error handling.
 * Usage: const trace = traceRequest(req, 'api_call'); ... trace.end(200);
 */
export function traceRequest(req, operation) {
  const requestId = req.headers?.['x-request-id'] || generateRequestId();
  const startTime = Date.now();
  const context = {
    requestId,
    operation,
    method: req.method,
    path: req.url?.split('?')[0],
    ip: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown',
    userAgent: req.headers?.['user-agent']?.slice(0, 200) || 'unknown',
    startTime,
  };

  logger.info(operation, 'request_started', {
    request_id: requestId,
    method: context.method,
    path: context.path,
    ip: context.ip,
  });

  return {
    requestId,
    context,
    end: (statusCode, extraData = {}) => {
      const duration = Date.now() - startTime;
      const logData = {
        request_id: requestId,
        duration_ms: duration,
        status_code: statusCode,
        ...extraData,
      };

      if (statusCode >= 500) {
        logger.error(operation, 'request_failed', logData);
      } else if (statusCode >= 400) {
        logger.warn(operation, 'request_error', logData);
      } else if (duration > 5000) {
        logger.warn(operation, 'slow_request', logData);
      } else {
        logger.info(operation, 'request_completed', logData);
      }

      return { duration, ...logData };
    },
  };
}

// ─── Performance Metrics Collector ──────────────────────────────
const _metrics = new Map(); // operation → { count, totalMs, maxMs, minMs, errors, lastReset }

/**
 * Record a performance metric for an operation.
 */
export function recordMetric(operation, durationMs, success = true) {
  const now = Date.now();
  const metric = _metrics.get(operation) || {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    minMs: Infinity,
    errors: 0,
    lastReset: now,
  };

  metric.count++;
  metric.totalMs += durationMs;
  metric.maxMs = Math.max(metric.maxMs, durationMs);
  metric.minMs = Math.min(metric.minMs, durationMs);
  if (!success) metric.errors++;

  // Reset metrics every hour
  if (now - metric.lastReset > 3600000) {
    metric.count = 1;
    metric.totalMs = durationMs;
    metric.maxMs = durationMs;
    metric.minMs = durationMs;
    metric.errors = success ? 0 : 1;
    metric.lastReset = now;
  }

  _metrics.set(operation, metric);
}

/**
 * Get aggregated performance metrics.
 */
export function getMetrics() {
  const result = {};
  for (const [op, m] of _metrics) {
    result[op] = {
      count: m.count,
      avg_ms: m.count > 0 ? Math.round(m.totalMs / m.count) : 0,
      max_ms: m.maxMs === Infinity ? 0 : m.maxMs,
      min_ms: m.minMs === Infinity ? 0 : m.minMs,
      error_rate: m.count > 0 ? (m.errors / m.count * 100).toFixed(1) + '%' : '0%',
      errors: m.errors,
    };
  }
  return result;
}

// ─── Error Tracker ──────────────────────────────────────────────
const _errorCounts = new Map(); // error_key → { count, lastSeen, samples }

/**
 * Track an error with deduplication and sampling.
 */
export function trackError(error, context = {}) {
  const key = `${error.name || 'Error'}:${error.message?.slice(0, 100) || 'unknown'}`;
  const entry = _errorCounts.get(key) || { count: 0, lastSeen: 0, samples: [] };

  entry.count++;
  entry.lastSeen = Date.now();
  if (entry.samples.length < 5) {
    entry.samples.push({
      message: error.message?.slice(0, 200),
      stack: error.stack?.slice(0, 500),
      context,
      timestamp: new Date().toISOString(),
    });
  }

  _errorCounts.set(key, entry);

  // Log high-severity errors to audit
  if (entry.count % 10 === 0 || entry.count === 1) {
    logger.error('error_tracker', 'error_occurred', {
      error_key: key,
      count: entry.count,
      context,
    });
  }
}

/**
 * Get error summary for monitoring.
 */
export function getErrorSummary(limit = 20) {
  return [..._errorCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([key, data]) => ({
      error: key,
      count: data.count,
      last_seen: new Date(data.lastSeen).toISOString(),
      sample: data.samples[data.samples.length - 1],
    }));
}

// ─── System Health Metrics ──────────────────────────────────────
/**
 * Collect system health metrics (memory, event loop, uptime).
 */
export function getSystemHealth() {
  const mem = process.memoryUsage();
  return {
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024),
      array_buffers_mb: Math.round((mem.arrayBuffers || 0) / 1024 / 1024),
    },
    uptime_seconds: Math.round(process.uptime()),
    pid: process.pid,
    node_version: process.version,
    platform: process.platform,
    env: process.env.VERCEL_ENV || 'development',
    region: process.env.VERCEL_REGION || 'unknown',
    timestamp: new Date().toISOString(),
  };
}

// ─── Database Health Check ──────────────────────────────────────
/**
 * Quick DB health check with latency measurement.
 */
export async function checkDatabaseHealth() {
  const start = Date.now();
  try {
    const { error } = await supabase.from('settings').select('key').limit(1);
    const latency = Date.now() - start;
    if (error) throw error;
    return { status: 'ok', latency_ms: latency };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - start, error: err.message };
  }
}

// ─── AI Provider Health Check ───────────────────────────────────
let _providerCache = null;
let _providerCacheExpiry = 0;

/**
 * Check AI provider availability (cached for 60s).
 */
export async function checkProviderHealth() {
  const now = Date.now();
  if (_providerCache && _providerCacheExpiry > now) return _providerCache;

  const envKeys = [
    'NVIDIA_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
    'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY',
  ];
  const available = envKeys.filter((k) => !!process.env[k]).map((k) => k.replace('_API_KEY', '').toLowerCase());

  const result = {
    status: available.length > 0 ? 'ok' : 'degraded',
    available,
    count: available.length,
  };

  _providerCache = result;
  _providerCacheExpiry = now + 60000;
  return result;
}

// ─── Cleanup ────────────────────────────────────────────────────
let _lastCleanup = Date.now();

export function cleanupMetrics() {
  const now = Date.now();
  if (now - _lastCleanup < 3600000) return; // Run hourly
  _lastCleanup = now;

  // Prune old error entries
  for (const [key, data] of _errorCounts) {
    if (now - data.lastSeen > 86400000) { // 24 hours
      _errorCounts.delete(key);
    }
  }
}

export default {
  logger,
  generateRequestId,
  traceRequest,
  recordMetric,
  getMetrics,
  trackError,
  getErrorSummary,
  getSystemHealth,
  checkDatabaseHealth,
  checkProviderHealth,
  cleanupMetrics,
};
