// Anonymous account registration + heartbeat + own-status check
// Called on app load so every live browser shows up in admin immediately,
// and so banned/suspended users see their status.
import supabase from './_db-client.js';
import { cors, clean, rateLimitResponse } from './_auth.js';
import { sanitizeError } from './_error.js';

// Simple in-memory IP rate limiter: max `limit` requests per `windowMs`
const ipHits = new Map();
function ipRateLimited(ip, windowMs = 60000, limit = 10) {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.start > windowMs) {
    ipHits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > limit;
}
// Cleanup stale entries every 5 minutes
setInterval(() => { const cutoff = Date.now() - 120000; for (const [k, v] of ipHits) { if (v.start < cutoff) ipHits.delete(k); } }, 300000);

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Rate limit by IP: max 10 requests per 60s
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    if (ipRateLimited(clientIp)) {
      return rateLimitResponse(res, 60, 'Too many requests. Please try again later.');
    }

    const anon_id = clean(req.body?.anon_id, 40).toLowerCase();
    if (!anon_id || !anon_id.startsWith('anon_')) return res.status(400).json({ error: 'Invalid anonymous ID' });

    const { data: existing } = await supabase.from('users_meta').select('*').eq('anon_id', anon_id).maybeSingle();

    if (!existing) {
      const { error: insErr } = await supabase.from('users_meta').insert({ anon_id, warnings: [] });
      if (insErr) console.error('users_meta insert failed:', insErr.message);
    }

    const meta = existing || { banned: false, suspended_until: null, strikes: 0, warnings: [] };
    const suspended = meta.suspended_until && new Date(meta.suspended_until) > new Date();
    return res.status(200).json({
      ok: true,
      banned: !!meta.banned,
      suspended: !!suspended,
      suspended_until: suspended ? meta.suspended_until : null,
      strikes: meta.strikes || 0,
      warning_count: (meta.warnings || []).length,
      latest_warning: (meta.warnings || []).slice(-1)[0]?.text || null,
    });
  } catch (err) {
    return sanitizeError(res, err, 'users');
  }
}
