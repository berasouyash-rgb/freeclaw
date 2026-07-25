// Shared helpers for Voice Box API routes (underscore prefix = not exposed as a route)
import supabase from './_db-client.js';

// ─── isAdmin() cache: avoid DB query on every request ─────────────
const _adminTokenCache = new Map(); // token → { valid: boolean, expiresAt: number }
const ADMIN_CACHE_TTL_MS = 30_000; // 30 seconds

// ─── Rate limit state: persists across warm invocations ───────────
// Maps key → { count: number, windowStart: number }
const _rateLimitState = new Map();

// Allowed origins for CORS — production domain + Vercel preview + localhost dev
const ALLOWED_ORIGINS = [
  'https://voice-box-psi.vercel.app',
  'https://voice-box-ballyvisiontutorial-hues-projects.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
];

export function cors(res, req) {
  const origin = req?.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  // FIX-#4: Cache preflight responses for 24h to reduce OPTIONS roundtrips
  res.setHeader('Access-Control-Max-Age', '86400');
  // FIX-#6: X-Request-Id for distributed request tracing
  const requestId = req?.headers?.['x-request-id'] || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('X-Request-Id', requestId);
}

/** Verify admin session token from x-admin-token header (uses 30s cache to avoid DB on every request) */
export async function isAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  const now = Date.now();
  const cached = _adminTokenCache.get(token);
  if (cached && cached.expiresAt > now) return cached.valid;
  const { data } = await supabase.from('settings').select('value').eq('key', 'admin_sessions').maybeSingle();
  const tokens = data?.value?.tokens || [];
  const valid = tokens.some((s) => s.t === token && s.exp > now);
  _adminTokenCache.set(token, { valid, expiresAt: now + ADMIN_CACHE_TTL_MS });
  return valid;
}

/** Check whether an anonymous user is allowed to write (not banned / suspended) */
export async function checkUser(authorId) {
  if (!authorId || typeof authorId !== 'string' || authorId.length > 40) {
    return { ok: false, error: 'Missing or invalid anonymous ID.' };
  }
  // Case-insensitive: IDs are stored lowercase; normalize incoming values
  const id = authorId.toLowerCase();
  const { data } = await supabase.from('users_meta').select('*').eq('anon_id', id).maybeSingle();
  if (data?.banned) return { ok: false, error: 'This anonymous ID has been permanently banned.' };
  if (data?.suspended_until && new Date(data.suspended_until) > new Date()) {
    return { ok: false, error: `This anonymous ID is suspended until ${new Date(data.suspended_until).toLocaleDateString()}.` };
  }
  return { ok: true, meta: data };
}

/** Ensure a users_meta row exists for an anonymous id */
export async function ensureUser(authorId) {
  try {
    const id = String(authorId).toLowerCase();
    const { data } = await supabase.from('users_meta').select('anon_id').eq('anon_id', id).maybeSingle();
    if (!data) await supabase.from('users_meta').insert({ anon_id: id, warnings: [], last_seen: new Date().toISOString() });
  } catch { /* non-fatal */ }
}

/** Append to the audit / activity log */
export async function auditLog(actor, action, detail) {
  try {
    await supabase.from('activity_logs').insert({ actor, action, detail: String(detail || '').slice(0, 500) });
  } catch { /* non-fatal */ }
}

/** Basic server-side text sanitation: strip control chars + trim + cap length */
export function clean(str, max = 2000) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

const PROFANITY = [
  'fuck', 'fucking', 'fucked', 'fucker', 'fucks', 'motherfucker',
  'shit', 'shitting', 'shitty', 'bullshit', 'dipshit',
  'bitch', 'bitches', 'bitchy',
  'asshole', 'assholes', 'arsehole',
  'bastard', 'bastards',
  'cunt', 'cunts', 'twat',
  'dick', 'dicks', 'dickhead', 'dickheads',
  'slut', 'sluts',
  'whore', 'whores',
  'cock', 'cocks', 'prick',
  'pussy', 'pussies',
  'wanker', 'wankers',
  'tosser', 'tossers',
  'retard', 'retarded', 'retards',
  'bollocks',
];

const SLURS = [
  'nigger', 'nigga', 'niggas', 'niggers',
  'faggot', 'faggots', 'fag', 'fags',
  'kike', 'kikes',
  'spic', 'spics',
  'chink', 'chinks',
  'wetback', 'wetbacks',
  'beaner', 'beaners',
  'tranny', 'trannies',
  'dyke', 'dykes',
  'paki', 'pakis',
  'nazi', 'nazis',
  'coon', 'coons',
  'gook', 'gooks',
  'towelhead', 'raghead',
];

const DANGEROUS = [
  { pattern: /kill\s+(?:my\s+)?self|suicide|suicidal|end\s+(?:my\s+)?life|want\s+to\s+die|going\s+to\s+kill|overdose/i, severity: 'critical' },
  { pattern: /kill\s+you|gonna\s+kill|going\s+to\s+kill|murder\s+you|shoot\s+you|stab\s+you|beat\s+you\s+up|burn\s+(?:the\s+)?school|bomb\s+(?:the\s+)?school/i, severity: 'critical' },
  { pattern: /bring(?:ing)?\s+(?:a\s+)?(?:gun|knife|weapon|blade|bomb|explosive)/i, severity: 'high' },
  { pattern: /buying|selling|trafficking|deal(?:ing)?\s+(?:in\s+)?(?:drugs|cocaine|heroin|meth|weed|marijuana|lsd|ecstasy|xanax|fentanyl)/i, severity: 'high' },
  { pattern: /blackmail|extort|extortion|pay\s+(?:me|us)\s+or|i(?:'ll| will)\s+(?:post|share|send|upload|expose)\s+(?:your|the)\s+(?:photos?|pics?|pictures?|videos?|nudes?|secrets?)/i, severity: 'critical' },
  { pattern: /if\s+you\s+(?:don(?:'t|t)?|do\s+not)\s+(?:pay|give|send|do)\s+\w+.*?(?:i(?:'ll| will)|gonna|going\s+to)\s+(?:expose|share|post|leak|send)/i, severity: 'critical' },
  { pattern: /dox(?:ing|ed)?|doxx(?:ing|ed)?|releasing?\s+(?:your|their|the)\s+(?:address|phone|real\s+name|info)/i, severity: 'high' },
];

const SPAM_PATTERNS = [
  { pattern: /buy\s+now|click\s+here|free\s+money|easy\s+cash|earn\s+\$|make\s+\$\d|limited\s+time\s+offer|act\s+now|congratulations\s+you(?:'ve| have)\s+won/i, severity: 'medium' },
  { pattern: /(.)\1{5,}/, severity: 'low' },
];

// FIX-#5: Reusable 429 response with Retry-After header
export function rateLimitResponse(res, retryAfterSeconds = 60, message = 'Too many requests') {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({ error: message, retry_after: retryAfterSeconds });
}

/** Check content for moderation issues. Returns { safe, flags, maskedText } */
export function moderateContent(text) {
  const flags = [];
  let masked = text;

  // Profanity
  for (const w of PROFANITY) {
    const regex = new RegExp(`\\b${w}\\b`, 'gi');
    if (regex.test(text)) {
      flags.push({ category: 'profanity', word: w, severity: 'high' });
      masked = masked.replace(regex, (m) => m[0] + '*'.repeat(m.length - 1));
    }
  }

  // Slurs
  for (const w of SLURS) {
    const regex = new RegExp(`\\b${w}\\b`, 'gi');
    if (regex.test(masked)) {
      flags.push({ category: 'hate_speech', word: w, severity: 'critical' });
      masked = masked.replace(regex, (m) => m[0] + '*'.repeat(m.length - 1));
    }
  }

  // Dangerous content (self-harm, violence, threats, weapons, drugs, blackmail, doxxing)
  for (const { pattern, severity } of DANGEROUS) {
    if (pattern.test(masked)) {
      flags.push({ category: 'dangerous', word: '[pattern]', severity });
    }
  }

  // Spam patterns
  for (const { pattern, severity } of SPAM_PATTERNS) {
    if (pattern.test(masked)) {
      flags.push({ category: 'spam', word: '[pattern]', severity });
    }
  }

  // Repeated words (e.g. "bad bad bad bad")
  const words = masked.toLowerCase().split(/\s+/);
  let repeatCount = 1;
  for (let i = 1; i <= words.length; i++) {
    if (i < words.length && words[i] === words[i - 1] && words[i].length > 2) {
      repeatCount++;
    } else {
      if (repeatCount >= 4) {
        flags.push({ category: 'spam', word: words[i - 1], severity: 'medium' });
      }
      repeatCount = 1;
    }
  }

  // PII (email / phone)
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/.test(masked)) {
    flags.push({ category: 'privacy', word: '[email]', severity: 'medium' });
  }

  return {
    safe: !flags.some(f => f.severity === 'critical' || f.severity === 'high'),
    flags,
    maskedText: masked,
  };
}

/** Backward-compatible: mask profanity only */
export function maskProfanity(text) {
  return moderateContent(text).maskedText;
}

/** Persistent rate limit: max `limit` writes by author in table within `seconds` (survives warm invocations) */
export async function rateLimited(table, authorId, seconds, limit) {
  const key = `${table}:${authorId}`;
  const now = Date.now();
  const windowMs = seconds * 1000;
  const state = _rateLimitState.get(key);
  if (state && (now - state.windowStart) < windowMs) {
    if (state.count >= limit) return true;
    state.count++;
    return false;
  }
  // New window — do a real DB count and seed the in-memory counter
  const since = new Date(now - windowMs).toISOString();
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true })
    .eq('author_id', authorId).gte('created_at', since);
  const currentCount = count || 0;
  _rateLimitState.set(key, { count: currentCount + 1, windowStart: now });
  // Prune stale entries periodically (max 5000 keys)
  if (_rateLimitState.size > 5000) {
    for (const [k, v] of _rateLimitState) {
      if ((now - v.windowStart) > windowMs) _rateLimitState.delete(k);
    }
  }
  return currentCount >= limit;
}
