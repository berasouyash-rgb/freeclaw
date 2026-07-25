// Admin auth (hashed password + session timeout), user management, logs, settings
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';
import crypto from 'crypto';
import { sanitizeError } from './_error.js';

const SESSION_MS = 60 * 60 * 1000; // 60 minute session timeout

async function getSetting(key) {
  const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function setSetting(key, value) {
  const { data } = await supabase.from('settings').select('key').eq('key', key).maybeSingle();
  if (data) await supabase.from('settings').update({ value }).eq('key', key);
  else await supabase.from('settings').insert({ key, value });
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const b = req.body || {};
    const action = req.method === 'GET' ? req.query.action : b.action;

    // ---------- AUTH ----------
    if (action === 'login') {
      const stored = await getSetting('admin_password');
      const hash = clean(b.password_hash, 128);
      // Timing-safe comparison to prevent timing attacks on password hash
      let hashMatch = false;
      if (stored?.hash && hash && stored.hash.length === hash.length) {
        try {
          const storedBuf = Buffer.from(stored.hash, 'hex');
          const inputBuf = Buffer.from(hash, 'hex');
          if (storedBuf.length === inputBuf.length) {
            hashMatch = crypto.timingSafeEqual(storedBuf, inputBuf);
          }
        } catch { /* hex parse failure = no match */ }
      }
      if (!hashMatch) {
        await auditLog('system', 'failed_login', 'Bad password attempt');
        return res.status(401).json({ error: 'Incorrect password.' });
      }
      const token = crypto.randomBytes(24).toString('hex');
      const sessions = (await getSetting('admin_sessions')) || { tokens: [] };
      const now = Date.now();
      sessions.tokens = [...sessions.tokens.filter((t) => t.exp > now), { t: token, exp: now + SESSION_MS }].slice(-10);
      await setSetting('admin_sessions', sessions);
      await auditLog('admin', 'login', 'Admin signed in');
      return res.status(200).json({ token, expires_at: now + SESSION_MS });
    }

    if (action === 'verify') {
      return res.status(200).json({ valid: await isAdmin(req) });
    }

    if (action === 'logout') {
      const token = req.headers['x-admin-token'];
      const sessions = (await getSetting('admin_sessions')) || { tokens: [] };
      sessions.tokens = sessions.tokens.filter((t) => t.t !== token);
      await setSetting('admin_sessions', sessions);
      return res.status(200).json({ ok: true });
    }

    // ---------- everything below requires admin ----------
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    if (action === 'change_password') {
      const newHash = clean(b.new_hash, 128);
      if (!newHash || newHash.length < 32) return res.status(400).json({ error: 'Invalid hash' });
      await setSetting('admin_password', { hash: newHash });
      await auditLog('admin', 'change_password', 'Admin password updated');
      return res.status(200).json({ ok: true });
    }

    if (action === 'logs') {
      const { cursor, limit: limitParam, paginate } = req.query;
      const isPaginated = paginate === '1' || paginate === 'true';
      const PAGE_LIMIT = Math.min(parseInt(limitParam) || 30, 100);

      let q = supabase.from('activity_logs').select('*').order('created_at', { ascending: false });
      if (isPaginated) {
        if (cursor) q = q.lt('created_at', cursor);
        q = q.limit(PAGE_LIMIT + 1);
      } else {
        q = q.limit(300);
      }
      const { data, error } = await q;
      if (error) throw error;

      if (isPaginated) {
        const rows = data || [];
        const hasMore = rows.length > PAGE_LIMIT;
        const sliced = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
        const nextCursor = hasMore ? sliced[sliced.length - 1]?.created_at : null;
        const { count } = await supabase.from('activity_logs').select('id', { count: 'exact', head: true });
        return res.status(200).json({ data: sliced, nextCursor, total: count || 0 });
      }

      return res.status(200).json(data || []);
    }

    if (action === 'log') {
      await auditLog('admin', clean(b.log_action, 60), b.detail);
      return res.status(200).json({ ok: true });
    }

    // ---------- USER MANAGEMENT ----------
    if (action === 'users') {
      const { cursor, limit: limitParam, paginate } = b;
      const isPaginated = !!paginate;
      const PAGE_LIMIT = Math.min(parseInt(limitParam) || 30, 100);

      let q = supabase.from('users_meta').select('*').order('created_at', { ascending: false });
      if (isPaginated && cursor) q = q.lt('created_at', cursor);
      if (isPaginated) q = q.limit(PAGE_LIMIT + 1);
      else q = q.limit(500);
      const { data: users, error } = await q;
      if (error) throw error;

      const rows = users || [];

      if (isPaginated) {
        const hasMore = rows.length > PAGE_LIMIT;
        const sliced = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
        const nextCursor = hasMore ? sliced[sliced.length - 1]?.created_at : null;
        const anonIds = sliced.map((u) => u.anon_id);
        const [{ data: posts }, { data: comments }, { data: reactions }] = await Promise.all([
          supabase.from('posts').select('author_id').in('author_id', anonIds),
          supabase.from('comments').select('author_id').in('author_id', anonIds),
          supabase.from('reactions').select('author_id').in('author_id', anonIds),
        ]);
        const count = (rows2, id) => (rows2 || []).filter((r) => r.author_id === id).length;
        const { count: total } = await supabase.from('users_meta').select('anon_id', { count: 'exact', head: true });
        return res.status(200).json({
          data: sliced.map((u) => ({
            ...u,
            post_count: count(posts, u.anon_id),
            comment_count: count(comments, u.anon_id),
            reaction_count: count(reactions, u.anon_id),
          })),
          nextCursor,
          total: total || 0,
        });
      }

      // Non-paginated: fetch user counts per-user without loading all reactions/comments into memory
      const anonIds = (rows || []).map((u) => u.anon_id);
      const countForUser = async (table, ids) => {
        if (!ids.length) return {};
        // Batch count per user using select + groupby equivalent
        const { data } = await supabase.from(table).select('author_id').in('author_id', ids);
        const map = {};
        (data || []).forEach((r) => { map[r.author_id] = (map[r.author_id] || 0) + 1; });
        return map;
      };
      const [postCounts, commentCounts, reactionCounts] = await Promise.all([
        countForUser('posts', anonIds),
        countForUser('comments', anonIds),
        countForUser('reactions', anonIds),
      ]);
      return res.status(200).json((rows || []).map((u) => ({
        ...u,
        post_count: postCounts[u.anon_id] || 0,
        comment_count: commentCounts[u.anon_id] || 0,
        reaction_count: reactionCounts[u.anon_id] || 0,
      })));
    }

    if (action === 'user_detail') {
      const id = clean(b.anon_id, 40).toLowerCase();
      const [{ data: meta }, { data: posts }, { data: comments }, { data: reactions }, { data: reports }] = await Promise.all([
        supabase.from('users_meta').select('*').eq('anon_id', id).maybeSingle(),
        supabase.from('posts').select('*').eq('author_id', id).order('created_at', { ascending: false }),
        supabase.from('comments').select('*').eq('author_id', id).order('created_at', { ascending: false }),
        supabase.from('reactions').select('*').eq('author_id', id),
        supabase.from('reports').select('*').eq('author_id', id),
      ]);
      return res.status(200).json({ meta, posts: posts || [], comments: comments || [], reactions: reactions || [], reports: reports || [] });
    }

    if (action === 'update_user') {
      const id = clean(b.anon_id, 40).toLowerCase();
      const { data: existing } = await supabase.from('users_meta').select('anon_id,warnings,strikes').eq('anon_id', id).maybeSingle();
      if (!existing) await supabase.from('users_meta').insert({ anon_id: id, warnings: [] });
      const patch = {};
      if (b.warn) {
        patch.warnings = [...(existing?.warnings || []), { text: clean(b.warn, 300), at: new Date().toISOString() }];
        patch.strikes = (existing?.strikes || 0) + 1;
      }
      if (b.suspend_days !== undefined) {
        patch.suspended_until = b.suspend_days === 0 ? null : new Date(Date.now() + b.suspend_days * 86400000).toISOString();
      }
      if (typeof b.banned === 'boolean') patch.banned = b.banned;
      if (b.notes !== undefined) patch.notes = clean(b.notes, 2000);
      if (typeof b.spam_score === 'number') patch.spam_score = b.spam_score;
      if (typeof b.strikes === 'number') patch.strikes = b.strikes;
      const { data, error } = await supabase.from('users_meta').update(patch).eq('anon_id', id).select().single();
      if (error) throw error;
      await auditLog('admin', 'update_user', `${id}: ${Object.keys(patch).join(', ')}`);
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return sanitizeError(res, err, 'admin');
  }
}
