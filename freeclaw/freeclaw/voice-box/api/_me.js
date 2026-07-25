// Account status check for the caller's own anonymous ID (no personal data involved)
import supabase from './_db-client.js';
import { cors, clean, rateLimitResponse } from './_auth.js';
import { sanitizeError } from './_error.js';

/* ── IP-based rate limiting (prevent enumeration) ────────── */
const hits = new Map();
const WINDOW = 60_000; // 1 minute
const LIMIT = 30;      // 30 req/min per IP (generous — this endpoint is called by every page load)

function isRateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > WINDOW) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > LIMIT;
}

// Periodic cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) {
    if (now - v.start > WINDOW * 2) hits.delete(k);
  }
}, 300_000).unref();

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip)) return rateLimitResponse(res, 60, 'Too many requests');

  try {
    const anonId = clean(req.query.anon_id, 40);
    if (!anonId) return res.status(400).json({ error: 'Missing anon_id' });
    const { data } = await supabase.from('users_meta')
      .select('banned,suspended_until,strikes,warnings')
      .eq('anon_id', anonId).maybeSingle();
    const suspended = data?.suspended_until && new Date(data.suspended_until) > new Date();
    return res.status(200).json({
      banned: !!data?.banned,
      suspended: !!suspended,
      suspended_until: suspended ? data.suspended_until : null,
      strikes: data?.strikes || 0,
      warnings: data?.warnings || [],
    });
  } catch (err) {
    return sanitizeError(res, err, 'me');
  }
}
