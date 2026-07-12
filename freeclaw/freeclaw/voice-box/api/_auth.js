// Shared helpers for Voice Box API routes (underscore prefix = not exposed as a route)
import supabase from './_db-client.js';

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
}

/** Verify admin session token from x-admin-token header */
export async function isAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  const { data } = await supabase.from('settings').select('value').eq('key', 'admin_sessions').maybeSingle();
  const tokens = data?.value?.tokens || [];
  const now = Date.now();
  return tokens.some((s) => s.t === token && s.exp > now);
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

const PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dickhead', 'slut', 'whore', 'nigger', 'faggot', 'retard'];

/** Very small profanity mask */
export function maskProfanity(text) {
  let out = text;
  for (const w of PROFANITY) {
    out = out.replace(new RegExp(`\\b${w}\\b`, 'gi'), (m) => m[0] + '*'.repeat(m.length - 1));
  }
  return out;
}

/** Simple rate limit: max `limit` rows by author in table within `seconds` */
export async function rateLimited(table, authorId, seconds, limit) {
  const since = new Date(Date.now() - seconds * 1000).toISOString();
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true })
    .eq('author_id', authorId).gte('created_at', since);
  return (count || 0) >= limit;
}
