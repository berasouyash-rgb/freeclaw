// ─── V3 Production Monitoring Dashboard ──────────────────────────
// GET /api/v3/monitoring — Consolidated production monitoring.
// Provides uptime, latency percentiles, error rates, alert conditions,
// and external monitoring hooks.
import { cors, isAdmin } from '../_auth.js';
import { sanitizeError } from '../_error.js';
import { getSystemHealth, checkDatabaseHealth, checkProviderHealth, getMetrics, getErrorSummary, logger } from '../_observability.js';
import { getAllCircuitStatus } from '../_reliability.js';
import { cacheStats } from '../_cache.js';

// ─── Uptime Tracker ──────────────────────────────────────────────
const _startTime = Date.now();
let _totalRequests = 0;
let _totalErrors = 0;
let _statusCodes = {}; // code → count
const _recentRequests = []; // { timestamp, duration, status, path }

/**
 * Record a request for monitoring purposes.
 */
export function recordRequest(duration, statusCode, path = 'unknown') {
  _totalRequests++;
  if (statusCode >= 400) _totalErrors++;
  _statusCodes[statusCode] = (_statusCodes[statusCode] || 0) + 1;

  _recentRequests.push({
    timestamp: Date.now(),
    duration,
    status: statusCode,
    path: path.split('?')[0],
  });

  // Keep only last 1000 requests
  if (_recentRequests.length > 1000) {
    _recentRequests.splice(0, _recentRequests.length - 1000);
  }
}

// ─── Latency Percentile Calculator ───────────────────────────────
function calculatePercentiles(values) {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const len = sorted.length;
  return {
    p50: sorted[Math.floor(len * 0.5)] || 0,
    p95: sorted[Math.floor(len * 0.95)] || 0,
    p99: sorted[Math.floor(len * 0.99)] || 0,
    max: sorted[len - 1] || 0,
    min: sorted[0] || 0,
    count: len,
  };
}

/**
 * Get latency percentiles from recent requests.
 */
function getLatencyPercentiles() {
  const durations = _recentRequests.map((r) => r.duration);
  return calculatePercentiles(durations);
}

/**
 * Get error rate breakdown.
 */
function getErrorRateBreakdown() {
  const now = Date.now();
  const lastMinute = _recentRequests.filter((r) => now - r.timestamp < 60000);
  const lastHour = _recentRequests.filter((r) => now - r.timestamp < 3600000);
  const lastDay = _recentRequests.filter((r) => now - r.timestamp < 86400000);

  const errorRate = (requests) => {
    if (requests.length === 0) return 0;
    const errors = requests.filter((r) => r.status >= 400).length;
    return parseFloat((errors / requests.length * 100).toFixed(2));
  };

  return {
    last_minute: { total: lastMinute.length, errors: lastMinute.filter((r) => r.status >= 400).length, error_rate: errorRate(lastMinute) },
    last_hour: { total: lastHour.length, errors: lastHour.filter((r) => r.status >= 400).length, error_rate: errorRate(lastHour) },
    last_day: { total: lastDay.length, errors: lastDay.filter((r) => r.status >= 400).length, error_rate: errorRate(lastDay) },
  };
}

/**
 * Get status code distribution.
 */
function getStatusDistribution() {
  const dist = {};
  for (const [code, count] of Object.entries(_statusCodes)) {
    const group = `${Math.floor(code / 100)}xx`;
    dist[group] = (dist[group] || 0) + count;
  }
  dist.total = _totalRequests;
  return dist;
}

// ─── Alert Conditions ────────────────────────────────────────────
const ALERT_THRESHOLDS = {
  error_rate_critical: 10, // % — critical if >10% errors
  error_rate_warning: 5,  // % — warning if >5% errors
  latency_p95_warning: 5000,  // ms — warning if p95 > 5s
  latency_p95_critical: 10000, // ms — critical if p95 > 10s
  db_latency_warning: 500,   // ms — warning if DB latency > 500ms
  db_latency_critical: 2000, // ms — critical if DB latency > 2s
  circuit_open_warning: 1,   // count — warning if any circuit is open
  uptime_minimum: 300,       // seconds — warn if uptime < 5 min (likely frequent restarts)
};

function evaluateAlerts(metrics) {
  const alerts = [];

  // Error rate alerts
  const errorRate = metrics.error_rate?.last_hour?.error_rate || 0;
  if (errorRate >= ALERT_THRESHOLDS.error_rate_critical) {
    alerts.push({ level: 'critical', category: 'error_rate', message: `Error rate ${errorRate}% exceeds critical threshold (${ALERT_THRESHOLDS.error_rate_critical}%)` });
  } else if (errorRate >= ALERT_THRESHOLDS.error_rate_warning) {
    alerts.push({ level: 'warning', category: 'error_rate', message: `Error rate ${errorRate}% exceeds warning threshold (${ALERT_THRESHOLDS.error_rate_warning}%)` });
  }

  // Latency alerts
  const p95 = metrics.latency?.p95 || 0;
  if (p95 >= ALERT_THRESHOLDS.latency_p95_critical) {
    alerts.push({ level: 'critical', category: 'latency', message: `P95 latency ${p95}ms exceeds critical threshold (${ALERT_THRESHOLDS.latency_p95_critical}ms)` });
  } else if (p95 >= ALERT_THRESHOLDS.latency_p95_warning) {
    alerts.push({ level: 'warning', category: 'latency', message: `P95 latency ${p95}ms exceeds warning threshold (${ALERT_THRESHOLDS.latency_p95_warning}ms)` });
  }

  // DB latency alerts
  const dbLatency = metrics.database?.latency_ms || 0;
  if (dbLatency >= ALERT_THRESHOLDS.db_latency_critical) {
    alerts.push({ level: 'critical', category: 'database', message: `DB latency ${dbLatency}ms exceeds critical threshold (${ALERT_THRESHOLDS.db_latency_critical}ms)` });
  } else if (dbLatency >= ALERT_THRESHOLDS.db_latency_warning) {
    alerts.push({ level: 'warning', category: 'database', message: `DB latency ${dbLatency}ms exceeds warning threshold (${ALERT_THRESHOLDS.db_latency_warning}ms)` });
  }

  // Circuit breaker alerts
  const circuits = metrics.circuits || {};
  const openCircuits = Object.values(circuits).filter((c) => c.state === 'open');
  if (openCircuits.length >= ALERT_THRESHOLDS.circuit_open_warning) {
    alerts.push({ level: 'warning', category: 'circuit_breaker', message: `${openCircuits.length} circuit breaker(s) open: ${openCircuits.map((c) => c.name).join(', ')}` });
  }

  // Uptime alerts
  const uptimeSeconds = metrics.uptime || 0;
  if (uptimeSeconds > 0 && uptimeSeconds < ALERT_THRESHOLDS.uptime_minimum) {
    alerts.push({ level: 'info', category: 'uptime', message: `Instance uptime ${uptimeSeconds}s — likely recently restarted` });
  }

  return alerts;
}

// ─── Handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const action = req.query?.action || 'dashboard';

    switch (action) {
      case 'dashboard': {
        // Full monitoring dashboard
        const [dbHealth, providerHealth] = await Promise.all([
          checkDatabaseHealth(),
          checkProviderHealth(),
        ]);

        const systemHealth = getSystemHealth();
        const metrics = getMetrics();
        const circuits = getAllCircuitStatus();
        const cacheInfo = cacheStats();
        const latency = getLatencyPercentiles();
        const errorRate = getErrorRateBreakdown();
        const statusDist = getStatusDistribution();

        const monitoringData = {
          uptime: {
            seconds: Math.round((Date.now() - _startTime) / 1000),
            started_at: new Date(_startTime).toISOString(),
            human_readable: formatUptime(Date.now() - _startTime),
          },
          requests: {
            total: _totalRequests,
            errors: _totalErrors,
            success_rate: _totalRequests > 0
              ? (((_totalRequests - _totalErrors) / _totalRequests) * 100).toFixed(2) + '%'
              : '100%',
            recent: _recentRequests.length,
          },
          latency,
          error_rate: errorRate,
          status_distribution: statusDist,
          health: {
            database: dbHealth,
            providers: providerHealth,
            system: systemHealth,
          },
          circuits,
          cache: cacheInfo,
          performance_metrics: metrics,
          alert_thresholds: ALERT_THRESHOLDS,
          alerts: evaluateAlerts({
            error_rate: errorRate,
            latency,
            database: dbHealth,
            circuits,
            uptime: systemHealth.uptime_seconds,
          }),
          version: '3.0.0',
          timestamp: new Date().toISOString(),
        };

        return res.status(200).json(monitoringData);
      }

      case 'health': {
        // Quick health check (lightweight, for external monitors)
        const [dbHealth, providerHealth] = await Promise.all([
          checkDatabaseHealth(),
          checkProviderHealth(),
        ]);

        const allHealthy = dbHealth.status === 'ok' && providerHealth.status !== 'error';
        return res.status(allHealthy ? 200 : 503).json({
          status: allHealthy ? 'healthy' : 'degraded',
          database: dbHealth.status,
          providers: providerHealth.status,
          uptime: Math.round((Date.now() - _startTime) / 1000),
          timestamp: new Date().toISOString(),
        });
      }

      case 'alerts': {
        // Current alerts only
        const [dbHealth] = await Promise.all([checkDatabaseHealth()]);
        const systemHealth = getSystemHealth();
        const errorRate = getErrorRateBreakdown();
        const latency = getLatencyPercentiles();
        const circuits = getAllCircuitStatus();

        const alerts = evaluateAlerts({
          error_rate: errorRate,
          latency,
          database: dbHealth,
          circuits,
          uptime: systemHealth.uptime_seconds,
        });

        return res.status(200).json({
          alerts,
          alert_count: alerts.length,
          has_critical: alerts.some((a) => a.level === 'critical'),
          has_warning: alerts.some((a) => a.level === 'warning'),
          timestamp: new Date().toISOString(),
        });
      }

      case 'latency': {
        // Latency breakdown
        return res.status(200).json({
          latency: getLatencyPercentiles(),
          recent_requests: _recentRequests.slice(-50).map((r) => ({
            timestamp: new Date(r.timestamp).toISOString(),
            duration_ms: r.duration,
            status: r.status,
            path: r.path,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      case 'errors': {
        // Error details
        const errorSummary = getErrorSummary(50);
        const breakdown = getErrorRateBreakdown();
        return res.status(200).json({
          error_rate: breakdown,
          errors: errorSummary,
          total_errors: _totalErrors,
          timestamp: new Date().toISOString(),
        });
      }

      case 'readiness': {
        // Readiness probe for load balancers
        const { status } = await checkDatabaseHealth();
        return res.status(status === 'ok' ? 200 : 503).json({
          ready: status === 'ok',
          timestamp: new Date().toISOString(),
        });
      }

      case 'liveness': {
        // Liveness probe — always 200 if process is running
        return res.status(200).json({
          alive: true,
          uptime: Math.round((Date.now() - _startTime) / 1000),
          pid: process.pid,
          timestamp: new Date().toISOString(),
        });
      }

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    return sanitizeError(res, err, 'v3/monitoring');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
