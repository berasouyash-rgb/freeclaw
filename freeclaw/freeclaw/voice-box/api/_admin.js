// Admin auth (hashed password + session timeout), user management, logs, settings
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';
import crypto from 'crypto';

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
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const b = req.body || {};
    const action = req.method === 'GET' ? req.query.action : b.action;

    // ---------- AUTH ----------
    if (action === 'login') {
      const stored = await getSetting('admin_password');
      const hash = clean(b.password_hash, 128);
      if (!stored?.hash || stored.hash !== hash) {
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
      const { data } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(300);
      return res.status(200).json(data || []);
    }

    if (action === 'log') {
      await auditLog('admin', clean(b.log_action, 60), b.detail);
      return res.status(200).json({ ok: true });
    }

    // ---------- USER MANAGEMENT ----------
    if (action === 'users') {
      const { data: users } = await supabase.from('users_meta').select('*').order('created_at', { ascending: false }).limit(500);
      // attach activity counts
      const [{ data: posts }, { data: comments }, { data: reactions }] = await Promise.all([
        supabase.from('posts').select('author_id'),
        supabase.from('comments').select('author_id'),
        supabase.from('reactions').select('author_id'),
      ]);
      const count = (rows, id) => (rows || []).filter((r) => r.author_id === id).length;
      return res.status(200).json((users || []).map((u) => ({
        ...u,
        post_count: count(posts, u.anon_id),
        comment_count: count(comments, u.anon_id),
        reaction_count: count(reactions, u.anon_id),
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
    console.error('admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
