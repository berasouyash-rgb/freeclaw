// ─── V3 Enterprise Security Middleware ───────────────────────────
// CSP headers, prompt injection detection, abuse prevention,
// input sanitization, and request security validation.
import { log } from './_audit.js';

// ─── Content Security Policy ────────────────────────────────────
// Strict CSP for API responses — no inline scripts, no eval, no remote styles
const CSP_DIRECTIVES = [
  "default-src 'none'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function setSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP_DIRECTIVES);
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
}

// ─── Prompt Injection Detection ─────────────────────────────────
// Detect common prompt injection patterns in user messages
const INJECTION_PATTERNS = [
  // System prompt overrides
  /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|directives?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?)/i,
  /forget\s+(everything|all|your)\s+(you|were|have)\s+(been|told|taught|instructed)/i,

  // Role hijacking
  /you\s+are\s+now\s+(a|an|the)\s+(different|new|admin|root|super)/i,
  /act\s+as\s+if\s+you\s+(have|are|were)\s+(no|unlimited|full|admin)/i,
  /pretend\s+you\s+(are|have|can|were)\s+(a|an|the|unlimited)/i,
  /roleplay\s+as\s+(a|an|the)\s+(different|new)/i,

  // Data exfiltration attempts
  /output\s+(the|your|all)\s+(system\s+)?(prompt|instructions?|rules?|configuration)/i,
  /reveal\s+(the|your|all)\s+(system\s+)?(prompt|instructions?|rules?)/i,
  /what\s+(is|are)\s+your\s+(system\s+)?(prompt|instructions?|rules?|configuration)/i,
  /print\s+(the|your|all)\s+(system\s+)?(prompt|instructions?)/i,

  // Code injection
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on(error|load|click)\s*=/i,
  /eval\s*\(/i,
  /function\s*\(\s*\)\s*\{/i,

  // SQL injection hints in AI context
  /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER)\s+/i,
  /UNION\s+(ALL\s+)?SELECT/i,

  // Encoded/obfuscated attempts
  /\\x[0-9a-f]{2}/i,
  /&#\d{2,4};/i,
  /base64\s*,\s*[A-Za-z0-9+/=]{20,}/i,

  // Multi-language injection
  /ignorez?\s+(les\s+)?(instructions?|règles?|directives?)\s+(précédentes?|anterieures?)/i,
  /ignoriere\s+(alle\s+)?(vorherigen?\s+)?(Anweisungen?|Regeln?|Anleitungen?)/i,
];

/**
 * Detect prompt injection attempts in user input.
 * Returns { safe: boolean, reason: string, confidence: number }
 */
export function detectPromptInjection(text) {
  if (!text || typeof text !== 'string') return { safe: true, reason: null, confidence: 0 };

  const matches = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      matches.push(pattern.source.slice(0, 60));
    }
  }

  if (matches.length === 0) return { safe: true, reason: null, confidence: 0 };

  // Score based on number of patterns matched
  const confidence = Math.min(matches.length / 3, 1); // Max confidence at 3+ matches
  const isHighRisk = matches.length >= 2 || confidence >= 0.66;

  return {
    safe: !isHighRisk,
    reason: isHighRisk
      ? `Potential prompt injection detected (${matches.length} pattern(s) matched)`
      : 'Suspicious input pattern detected',
    confidence,
    patterns_matched: matches.length,
  };
}

// ─── Abuse Prevention ───────────────────────────────────────────
// Track request patterns per IP to detect abuse
const _abuseTracker = new Map(); // ip → { requests: [], blocked: boolean, blockedUntil: number }

export const ABUSE_LIMITS = {
  maxRequestsPerMinute: 120,
  maxRequestsPerHour: 2000,
  maxErrorsPerMinute: 20,
  blockDurationMs: 300_000, // 5 minutes
  maxRequestSize: 500_000, // 500KB
};

/**
 * Check if an IP is exhibiting abuse patterns.
 * Returns { allowed: boolean, reason: string, retryAfter: number }
 */
export function checkAbuse(ip) {
  if (!ip) return { allowed: true, reason: null, retryAfter: 0 };

  const now = Date.now();
  const tracker = _abuseTracker.get(ip);

  // Check if currently blocked
  if (tracker?.blocked && tracker.blockedUntil > now) {
    return {
      allowed: false,
      reason: 'IP temporarily blocked due to abuse',
      retryAfter: Math.ceil((tracker.blockedUntil - now) / 1000),
    };
  }

  // Initialize tracker
  if (!tracker || (now - (tracker.windowStart || 0)) > 3600000) {
    _abuseTracker.set(ip, {
      requests: [],
      errors: [],
      blocked: false,
      blockedUntil: 0,
      windowStart: now,
    });
  }

  const t = _abuseTracker.get(ip);
  t.requests.push(now);

  // Prune old entries (keep last hour only)
  t.requests = t.requests.filter((ts) => now - ts < 3600000);
  t.errors = t.errors.filter((ts) => now - ts < 3600000);

  // Check rate limits
  const lastMinute = t.requests.filter((ts) => now - ts < 60000).length;
  const lastHour = t.requests.length;

  if (lastMinute > ABUSE_LIMITS.maxRequestsPerMinute) {
    t.blocked = true;
    t.blockedUntil = now + ABUSE_LIMITS.blockDurationMs;
    log.security('rate_limit_abuse', { ip, requests_per_minute: lastMinute });
    return {
      allowed: false,
      reason: 'Rate limit exceeded',
      retryAfter: Math.ceil(ABUSE_LIMITS.blockDurationMs / 1000),
    };
  }

  if (lastHour > ABUSE_LIMITS.maxRequestsPerHour) {
    t.blocked = true;
    t.blockedUntil = now + ABUSE_LIMITS.blockDurationMs;
    log.security('hourly_limit_abuse', { ip, requests_per_hour: lastHour });
    return {
      allowed: false,
      reason: 'Hourly rate limit exceeded',
      retryAfter: Math.ceil(ABUSE_LIMITS.blockDurationMs / 1000),
    };
  }

  return { allowed: true, reason: null, retryAfter: 0 };
}

/**
 * Record an error for abuse tracking.
 */
export function recordError(ip) {
  if (!ip) return;
  const t = _abuseTracker.get(ip);
  if (!t) return;
  t.errors.push(Date.now());

  const lastMinute = t.errors.filter((ts) => Date.now() - ts < 60000).length;
  if (lastMinute > ABUSE_LIMITS.maxErrorsPerMinute) {
    t.blocked = true;
    t.blockedUntil = Date.now() + ABUSE_LIMITS.blockDurationMs;
    log.security('error_abuse', { ip, errors_per_minute: lastMinute });
  }
}

// ─── Input Sanitization ─────────────────────────────────────────
// Deep sanitization for nested objects
export function sanitizeInput(obj, maxDepth = 5, maxLength = 10000) {
  if (maxDepth <= 0) return '[truncated]';
  if (typeof obj === 'string') {
    // Strip control characters, null bytes, and excessive whitespace
    return obj
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s{10,}/g, ' ')
      .trim()
      .slice(0, maxLength);
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => sanitizeInput(v, maxDepth - 1, maxLength));
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip prototype pollution attempts
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      sanitized[key] = sanitizeInput(value, maxDepth - 1, maxLength);
    }
    return sanitized;
  }
  return obj;
}

// ─── Request Size Validation ────────────────────────────────────
export function validateRequestSize(req) {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > ABUSE_LIMITS.maxRequestSize) {
    return {
      valid: false,
      error: `Request too large (${contentLength} bytes, max ${ABUSE_LIMITS.maxRequestSize})`,
    };
  }
  return { valid: true };
}

// ─── Security Middleware for Gateway ────────────────────────────
/**
 * Comprehensive security check to run at the start of every request.
 * Returns { ok: boolean, status: number, error: string }
 */
export function securityCheck(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

  // 1. Check abuse patterns
  const abuseCheck = checkAbuse(ip);
  if (!abuseCheck.allowed) {
    return {
      ok: false,
      status: 429,
      error: abuseCheck.reason,
      retryAfter: abuseCheck.retryAfter,
    };
  }

  // 2. Check request size
  const sizeCheck = validateRequestSize(req);
  if (!sizeCheck.valid) {
    return {
      ok: false,
      status: 413,
      error: sizeCheck.error,
    };
  }

  return { ok: true };
}

// ─── Cleanup stale abuse tracking entries ────────────────────────
// Run periodically to prevent memory leak
let _lastCleanup = Date.now();
const CLEANUP_INTERVAL = 600000; // 10 minutes

export function cleanupAbuseTracker() {
  const now = Date.now();
  if (now - _lastCleanup < CLEANUP_INTERVAL) return;
  _lastCleanup = now;

  for (const [ip, tracker] of _abuseTracker) {
    // Remove entries older than 1 hour with no recent activity
    if (tracker.requests.length === 0 && (!tracker.blocked || tracker.blockedUntil < now)) {
      _abuseTracker.delete(ip);
    }
  }
}

// Run cleanup on module load
cleanupAbuseTracker();

// ─── Risk-Level Approval Mapping ─────────────────────────────────
// Maps tool risk levels to approval requirements.
// Used by the Admin Assistant to determine if an action needs approval.
const RISK_APPROVAL_MAP = {
  low: {
    requiresApproval: false,
    autoApprove: true,
    approvalTimeout: 0,
    notifyAdmin: false,
  },
  medium: {
    requiresApproval: false,
    autoApprove: true,
    approvalTimeout: 0,
    notifyAdmin: true, // Notify but don't block
  },
  high: {
    requiresApproval: true,
    autoApprove: false,
    approvalTimeout: 300_000, // 5 minutes
    notifyAdmin: true,
  },
  critical: {
    requiresApproval: true,
    autoApprove: false,
    approvalTimeout: 600_000, // 10 minutes
    notifyAdmin: true,
    requireMFA: false, // Future: require second factor
  },
};

/**
 * Determine approval requirements for a tool execution based on risk level.
 * @param {string} riskLevel - 'low', 'medium', 'high', 'critical'
 * @param {string} toolName - Tool being executed
 * @param {object} context - Additional context (actor, affected records, etc.)
 * @returns {object} Approval requirements
 */
export function getApprovalRequirements(riskLevel, toolName, context = {}) {
  const base = RISK_APPROVAL_MAP[riskLevel] || RISK_APPROVAL_MAP.low;

  // Override for specific tools regardless of risk level
  const alwaysRequireApproval = ['ban_user', 'purge_user_content', 'delete_post'];
  if (alwaysRequireApproval.includes(toolName)) {
    return {
      ...RISK_APPROVAL_MAP.critical,
      overrideReason: `Tool '${toolName}' always requires approval`,
    };
  }

  // Override: admin actions always notify
  if (context.actorType === 'admin') {
    return {
      ...base,
      notifyAdmin: true,
    };
  }

  return base;
}

/**
 * Create an approval request in the approvals table.
 * @param {object} params - { toolCallId, conversationId, requestedBy, reason, riskLevel }
 * @returns {object} { approvalId, status, timeoutAt }
 */
export async function createApprovalRequest(params) {
  const { toolCallId, conversationId, requestedBy, reason, riskLevel, toolName } = params;
  const requirements = getApprovalRequirements(riskLevel, toolName);

  if (!requirements.requiresApproval) {
    return { approvalId: null, status: 'auto_approved', timeoutAt: null };
  }

  try {
    const { default: supabase } = await import('./_db-client.js');
    const timeoutAt = new Date(Date.now() + requirements.approvalTimeout).toISOString();

    const { data, error } = await supabase.from('approvals').insert({
      tool_call_id: toolCallId || null,
      conversation_id: conversationId || null,
      requested_by: requestedBy || 'system',
      status: 'pending',
      reason: reason || `Risk level: ${riskLevel}`,
      timeout_at: timeoutAt,
    }).select().single();

    if (error) {
      console.error('[SECURITY] Failed to create approval request:', error.message);
      return { approvalId: null, status: 'error', error: error.message };
    }

    return {
      approvalId: data.id,
      status: 'pending',
      timeoutAt,
      notifyAdmin: requirements.notifyAdmin,
    };
  } catch (err) {
    console.error('[SECURITY] Approval request error:', err.message);
    return { approvalId: null, status: 'error', error: err.message };
  }
}

/**
 * Check if a pending approval exists for a tool call.
 * @param {string} toolCallId - The tool call ID to check
 * @returns {object} { exists, status, approvedBy, resolvedAt }
 */
export async function checkApprovalStatus(toolCallId) {
  if (!toolCallId) return { exists: false, status: null };

  try {
    const { default: supabase } = await import('./_db-client.js');
    const { data, error } = await supabase.from('approvals')
      .select('id, status, approved_by, resolved_at, timeout_at')
      .eq('tool_call_id', toolCallId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return { exists: false, status: null };

    // Check if timed out
    if (data.status === 'pending' && data.timeout_at && new Date(data.timeout_at) < new Date()) {
      return { exists: true, status: 'timed_out', approvedBy: null, resolvedAt: null };
    }

    return {
      exists: true,
      status: data.status,
      approvedBy: data.approved_by,
      resolvedAt: data.resolved_at,
    };
  } catch (err) {
    console.error('[SECURITY] Approval check error:', err.message);
    return { exists: false, status: null };
  }
}

export default {
  setSecurityHeaders,
  detectPromptInjection,
  checkAbuse,
  recordError,
  sanitizeInput,
  validateRequestSize,
  securityCheck,
  cleanupAbuseTracker,
  getApprovalRequirements,
  createApprovalRequest,
  checkApprovalStatus,
  CSP_DIRECTIVES,
  ABUSE_LIMITS,
  RISK_APPROVAL_MAP,
};
