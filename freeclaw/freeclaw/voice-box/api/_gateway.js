// Voice Box v3 — API Gateway
// Centralized request handling, validation, rate limiting, and logging
import supabase from './_db-client.js';
import { cors, isAdmin, checkUser, clean, rateLimitResponse } from './_auth.js';
import { sanitizeError } from './_error.js';
import { setSecurityHeaders, securityCheck, sanitizeInput, recordError, cleanupAbuseTracker } from './_security.js';

// ─── Rate Limiting (per-endpoint) ──────────────────────────────
const _endpointRateLimits = new Map(); // key → { count, windowStart }

const RATE_LIMITS = {
  // User endpoints
  'POST:/api/v3/student/conversations': { windowMs: 60000, max: 5 }, // 5 per minute
  'POST:/api/v3/student/conversations/:id/messages': { windowMs: 60000, max: 30 }, // 30 per minute
  // Admin endpoints
  'POST:/api/v3/admin/conversations/:id/messages': { windowMs: 60000, max: 60 }, // 60 per minute
  'POST:/api/v3/admin/conversations/:id/assign': { windowMs: 300000, max: 10 }, // 10 per 5 min
  // AI endpoints
  'POST:/api/v3/ai/draft': { windowMs: 60000, max: 20 }, // 20 per minute
  'POST:/api/v3/ai/stream': { windowMs: 60000, max: 10 }, // 10 per minute
  // Tool endpoints
  'POST:/api/v3/tools/execute': { windowMs: 60000, max: 15 }, // 15 per minute
  'POST:/api/v3/tools/:id/approve': { windowMs: 300000, max: 20 }, // 20 per 5 min
  // Knowledge endpoints
  'POST:/api/v3/knowledge': { windowMs: 300000, max: 5 }, // 5 per 5 min
};

function getRateLimitKey(method, path) {
  // Normalize path: replace :id with generic pattern
  const normalized = path.replace(/\/[0-9a-f-]{36}/g, '/:id').replace(/\/[0-9]+/g, '/:id');
  return `${method}:${normalized}`;
}

function isRateLimited(method, path) {
  const key = getRateLimitKey(method, path);
  const limit = RATE_LIMITS[key];
  if (!limit) return false; // No rate limit defined = unlimited

  const now = Date.now();
  const state = _endpointRateLimits.get(key);

  if (state && (now - state.windowStart) < limit.windowMs) {
    if (state.count >= limit.max) return true;
    state.count++;
    return false;
  }

  // New window
  _endpointRateLimits.set(key, { count: 1, windowStart: now });

  // Prune stale entries (max 10000 keys)
  if (_endpointRateLimits.size > 10000) {
    for (const [k, v] of _endpointRateLimits) {
      if ((now - v.windowStart) > limit.windowMs) _endpointRateLimits.delete(k);
    }
  }

  return false;
}

// ─── Input Validation ──────────────────────────────────────────
const VALIDATORS = {
  conversationId: (v) => typeof v === 'string' && v.length > 0 && v.length <= 40,
  messageContent: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 5000,
  sender: (v) => ['user', 'admin', 'ai'].includes(v),
  status: (v) => ['active', 'waiting', 'resolved', 'archived'].includes(v),
  priority: (v) => ['low', 'normal', 'high', 'urgent'].includes(v),
  category: (v) => !v || ['bug', 'question', 'feedback', 'complaint', 'suggestion'].includes(v),
  sentiment: (v) => !v || ['positive', 'neutral', 'negative', 'critical'].includes(v),
  agentId: (v) => typeof v === 'string' && v.length > 0 && v.length <= 50,
  toolName: (v) => typeof v === 'string' && v.length > 0 && v.length <= 100,
  approvalAction: (v) => ['approve', 'reject'].includes(v),
};

function validate(body, rules) {
  const errors = [];
  for (const [field, validator] of Object.entries(rules)) {
    if (!validator(body[field])) {
      errors.push(`Invalid ${field}`);
    }
  }
  return errors.length > 0 ? errors : null;
}

// ─── Request Logging ───────────────────────────────────────────
async function logRequest(req, res, startTime) {
  const duration = Date.now() - startTime;
  const log = {
    method: req.method,
    path: req.url?.split('?')[0],
    status: res.statusCode,
    duration_ms: duration,
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown',
    user_agent: req.headers['user-agent']?.slice(0, 200) || 'unknown',
    timestamp: new Date().toISOString(),
  };

  // Log slow requests (>3s) and errors (4xx, 5xx)
  if (duration > 3000 || res.statusCode >= 400) {
    try {
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_id: 'gateway',
        action: 'request_log',
        resource_type: 'http',
        resource_id: log.path,
        details: log,
        ip_address: log.ip,
        user_agent: log.user_agent,
      });
    } catch { /* non-fatal */ }
  }
}

// ─── Gateway Middleware ────────────────────────────────────────
export function createGateway(handler) {
  return async function gatewayHandler(req, res) {
    const startTime = Date.now();
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

    try {
      // 1. CORS + Security headers
      cors(res, req);
      setSecurityHeaders(res);
      if (req.method === 'OPTIONS') return res.status(204).end();

      // 2. Security checks (abuse prevention, request size)
      const secCheck = securityCheck(req);
      if (!secCheck.ok) {
        if (secCheck.retryAfter) {
          res.setHeader('Retry-After', String(secCheck.retryAfter));
        }
        return res.status(secCheck.status).json({ error: secCheck.error });
      }

      // 3. Rate limiting
      if (isRateLimited(req.method, req.url?.split('?')[0] || '')) {
        return rateLimitResponse(res, 60, 'Rate limit exceeded');
      }

      // 4. Input sanitization (deep clean of all string fields)
      if (req.body && typeof req.body === 'object') {
        req.body = sanitizeInput(req.body);
      }

      // 5. Execute handler
      await handler(req, res);

      // 6. Log request
      await logRequest(req, res, startTime);
    } catch (error) {
      // Track errors for abuse detection
      recordError(ip);

      // 7. Global error handler
      console.error(`[gateway] Error: ${error.message}`, error.stack?.slice(0, 500));
      return sanitizeError(res, error, 'gateway');

      // Log error
      await logRequest(req, { statusCode: sanitized.status || 500 }, startTime);
    }
  };
}

// ─── Permission Checks ─────────────────────────────────────────
export async function requireAdmin(req) {
  if (!(await isAdmin(req))) {
    throw new Error('Unauthorized: Admin access required');
  }
}

export async function requireUser(req, threadId) {
  const gate = await checkUser(threadId);
  if (!gate.ok) {
    throw new Error(`Forbidden: ${gate.error}`);
  }
  return gate.meta;
}

// ─── Export helpers ─────────────────────────────────────────────
export { validate, VALIDATORS, RATE_LIMITS };
