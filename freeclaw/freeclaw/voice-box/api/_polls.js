// Poll system: standalone + complaint-linked, with live results
import supabase from './_db-client.js';
import { cors, isAdmin, checkUser, auditLog, clean, maskProfanity, rateLimited, rateLimitResponse } from './_auth.js';
import { sanitizeError } from './_error.js';

async function attachResults(polls) {
  const ids = polls.map((p) => p.id);
  if (!ids.length) return polls;
  const { data: votes } = await supabase.from('poll_votes').select('poll_id,choices').in('poll_id', ids);
  const map = {};
  (votes || []).forEach((v) => {
    map[v.poll_id] = map[v.poll_id] || { total: 0, counts: {} };
    map[v.poll_id].total += 1;
    (v.choices || []).forEach((c) => { map[v.poll_id].counts[c] = (map[v.poll_id].counts[c] || 0) + 1; });
  });
  return polls.map((p) => ({ ...p, total_votes: map[p.id]?.total || 0, vote_counts: map[p.id]?.counts || {} }));
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const { id, post_id, voter } = req.query;
      // Cache: 30s browser + CDN for poll listings
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=10');
      if (voter) {
        const { data } = await supabase.from('poll_votes').select('poll_id,choices').eq('author_id', voter);
        return res.status(200).json(data || []);
      }
      let q = supabase.from('polls').select('*').order('created_at', { ascending: false }).limit(200);
      if (id) q = q.eq('id', id);
      if (post_id) q = q.eq('post_id', post_id);
      const { data, error } = await q;
      if (error) throw error;

      // Validate linked posts still exist — clean orphaned post_id references
      const pollsWithLinks = (data || []).filter((p) => p.post_id);
      if (pollsWithLinks.length) {
        const postIds = [...new Set(pollsWithLinks.map((p) => p.post_id))];
        const { data: existingPosts } = await supabase.from('posts').select('id').in('id', postIds);
        const existingSet = new Set((existingPosts || []).map((p) => p.id));
        const orphans = pollsWithLinks.filter((p) => !existingSet.has(p.post_id));
        if (orphans.length) {
          // Clear orphaned post_id in background (non-blocking)
          Promise.all(orphans.map((p) => supabase.from('polls').update({ post_id: null }).eq('id', p.id)))
            .catch(() => {});
          // Also fix in-memory for this response
          orphans.forEach((p) => { p.post_id = null; });
        }
      }

      const results = await attachResults(data || []);
      // Mask author IDs — they are bearer tokens for poll deletion
      const v = clean(req.query.viewer, 40);
      const masked = results.map((p) => {
        const is_mine = !!v && p.author_id === v;
        return { ...p, is_mine, author_id: is_mine || p.author_id === 'ADMIN' ? p.author_id : (p.author_id || '').slice(0, 9) + '...' };
      });
      return res.status(200).json(masked);
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const author_id = clean(b.author_id, 40);

      if (b.action === 'vote') {
        const gate = await checkUser(author_id);
        if (!gate.ok) return res.status(403).json({ error: gate.error });
        const { data: poll } = await supabase.from('polls').select('*').eq('id', b.poll_id).maybeSingle();
        if (!poll) return res.status(404).json({ error: 'Poll not found' });
        if (poll.archived) return res.status(400).json({ error: 'Poll is archived.' });
        if (poll.expires_at && new Date(poll.expires_at) < new Date()) return res.status(400).json({ error: 'Poll has ended.' });
        const choices = (Array.isArray(b.choices) ? b.choices : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < (poll.options || []).length);
        if (!choices.length) return res.status(400).json({ error: 'Select at least one option.' });
        if (poll.ptype !== 'multi' && choices.length > 1) return res.status(400).json({ error: 'Only one choice allowed.' });
        const { data: existing } = await supabase.from('poll_votes').select('id').eq('poll_id', poll.id).eq('author_id', author_id).maybeSingle();
        if (existing) {
          await supabase.from('poll_votes').update({ choices }).eq('id', existing.id);
        } else {
          await supabase.from('poll_votes').insert({ poll_id: poll.id, author_id, choices });
        }
        const [withResults] = await attachResults([poll]);
        return res.status(200).json(withResults);
      }

      // Create poll
      const admin = await isAdmin(req);
      if (!admin) {
        const gate = await checkUser(author_id);
        if (!gate.ok) return res.status(403).json({ error: gate.error });
        if (await rateLimited('polls', author_id, 120, 2)) return rateLimitResponse(res, 120, 'Please wait before creating another poll.');
      }
      const title = maskProfanity(clean(b.title, 140));
      if (title.length < 5) return res.status(400).json({ error: 'Question must be at least 5 characters.' });
      const ptype = ['yesno', 'single', 'multi'].includes(b.ptype) ? b.ptype : 'yesno';
      let options = ptype === 'yesno' ? ['Yes', 'No'] : (Array.isArray(b.options) ? b.options.map((o) => clean(o, 60)).filter(Boolean) : []);
      if (ptype !== 'yesno' && (options.length < 2 || options.length > 10)) {
        return res.status(400).json({ error: 'Provide 2–10 options.' });
      }
      const row = {
        id: `poll_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        title, ptype, options,
        post_id: b.post_id ? clean(b.post_id, 60) : null,
        author_id: admin && !author_id ? 'ADMIN' : author_id,
        expires_at: b.expires_at || null,
      };
      const { data, error } = await supabase.from('polls').insert(row).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const b = req.body || {};
      const admin = await isAdmin(req);
      const { data: poll } = await supabase.from('polls').select('*').eq('id', b.id).maybeSingle();
      if (!poll) return res.status(404).json({ error: 'Poll not found' });
      const isOwner = b.author_id && b.author_id === poll.author_id;
      if (!admin && !isOwner) return res.status(403).json({ error: 'Not authorized' });
      const patch = {};
      if (typeof b.archived === 'boolean') patch.archived = b.archived;
      if (typeof b.deleted === 'boolean') patch.deleted = b.deleted;
      if (admin && b.expires_at !== undefined) patch.expires_at = b.expires_at;
      const { data, error } = await supabase.from('polls').update(patch).eq('id', b.id).select().single();
      if (error) throw error;
      if (admin) await auditLog('admin', 'update_poll', b.id);
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      await supabase.from('poll_votes').delete().eq('poll_id', req.body?.id);
      const { error } = await supabase.from('polls').delete().eq('id', req.body?.id);
      if (error) throw error;
      await auditLog('admin', 'delete_poll', req.body?.id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return sanitizeError(res, err, 'polls');
  }
}
