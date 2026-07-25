// ─── V3 Security Status Endpoint ────────────────────────────────
// GET /api/v3/security — Security posture dashboard for admins.
import { cors, isAdmin } from '../_auth.js';
import { sanitizeError } from '../_error.js';
import { detectPromptInjection, ABUSE_LIMITS } from '../_security.js';
import { circuits, getAllCircuitStatus } from '../_reliability.js';
import { getSystemHealth, checkDatabaseHealth, checkProviderHealth, getMetrics, getErrorSummary } from '../_observability.js';
import { cacheStats } from '../_cache.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const action = req.query?.action || 'status';

    switch (action) {
      case 'status': {
        // Full security posture
        const [dbHealth, providerHealth] = await Promise.all([
          checkDatabaseHealth(),
          checkProviderHealth(),
        ]);

        return res.status(200).json({
          security: {
            csp: 'enabled',
            hsts: 'enabled',
            xss_protection: 'enabled',
            frame_deny: 'enabled',
            rate_limiting: 'enabled',
            abuse_prevention: 'enabled',
            prompt_injection_detection: 'enabled',
            input_sanitization: 'enabled',
            request_size_limits: true,
            abuse_limits: ABUSE_LIMITS,
          },
          health: {
            database: dbHealth,
            providers: providerHealth,
          },
          circuits: getAllCircuitStatus(),
          performance: getMetrics(),
          cache: cacheStats(),
          errors: getErrorSummary(10),
          system: getSystemHealth(),
          timestamp: new Date().toISOString(),
        });
      }

      case 'test-injection': {
        // Test prompt injection detection
        const testText = req.body?.text || '';
        const result = detectPromptInjection(testText);
        return res.status(200).json({
          input: testText.slice(0, 200),
          detection: result,
          timestamp: new Date().toISOString(),
        });
      }

      case 'circuits': {
        // Circuit breaker status
        return res.status(200).json({
          circuits: getAllCircuitStatus(),
          timestamp: new Date().toISOString(),
        });
      }

      case 'metrics': {
        // Performance metrics
        return res.status(200).json({
          metrics: getMetrics(),
          timestamp: new Date().toISOString(),
        });
      }

      case 'errors': {
        // Error summary
        return res.status(200).json({
          errors: getErrorSummary(50),
          timestamp: new Date().toISOString(),
        });
      }

      case 'health': {
        // System health
        const [db, providers] = await Promise.all([
          checkDatabaseHealth(),
          checkProviderHealth(),
        ]);
        return res.status(200).json({
          database: db,
          providers: providers,
          system: getSystemHealth(),
          timestamp: new Date().toISOString(),
        });
      }

      case 'cache': {
        // Cache statistics
        return res.status(200).json({
          cache: cacheStats(),
          timestamp: new Date().toISOString(),
        });
      }

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    return sanitizeError(res, err, 'v3/security');
  }
}
