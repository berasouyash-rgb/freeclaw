// Anonymous comments with nested replies
import supabase from './_db-client.js';
import { cors, isAdmin, checkUser, ensureUser, auditLog, clean, maskProfanity, rateLimited } from './_auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const { post_id, all, author, viewer } = req.query;
      const admin = all === '1' ? await isAdmin(req) : false;
      let q = supabase.from('comments').select('*').order('created_at', { ascending: true });
      if (post_id) q = q.eq('post_id', post_id);
      if (author) q = q.eq('author_id', clean(author, 40));
      if (!admin) q = q.eq('hidden', false);
      if (!post_id && !author) q = q.limit(500).order('created_at', { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      // Mask author IDs (bearer-token semantics) except for admin/owner
      const v = clean(viewer, 40);
      const masked = (data || []).map((c) => {
        const is_mine = !!v && c.author_id === v;
        return { ...c, is_mine, author_id: admin || is_mine || author || c.author_id === 'ADMIN' ? c.author_id : c.author_id.slice(0, 9) + '…' };
      });
      return res.status(200).json(masked);
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const author_id = clean(b.author_id, 40);
      const is_admin_msg = b.is_admin === true && (await isAdmin(req));
      if (!is_admin_msg) {
        const gate = await checkUser(author_id);
        if (!gate.ok) return res.status(403).json({ error: gate.error });
        if (await rateLimited('comments', author_id, 30, 5)) {
          return res.status(429).json({ error: 'Too many comments — please wait a moment.' });
        }
      }
      const body = maskProfanity(clean(b.body, 500));
      if (body.length < 2) return res.status(400).json({ error: 'Comment is too short.' });
      // Respect locked posts
      const { data: post } = await supabase.from('posts').select('locked').eq('id', b.post_id).maybeSingle();
      if (post?.locked && !is_admin_msg) return res.status(403).json({ error: 'Comments are locked on this post.' });
      const row = {
        id: `cmt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        post_id: clean(b.post_id, 60),
        parent_id: b.parent_id ? clean(b.parent_id, 60) : null,
        author_id: is_admin_msg ? 'ADMIN' : author_id,
        body, is_admin: !!is_admin_msg,
      };
      const { data, error } = await supabase.from('comments').insert(row).select().single();
      if (error) throw error;
      if (!is_admin_msg) await ensureUser(author_id);
      // Activity resets the auto-deletion countdown on solved/archived posts
      await supabase.from('posts').update({ updated_at: new Date().toISOString() }).eq('id', row.post_id);
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const b = req.body || {};
      const { data: cmt } = await supabase.from('comments').select('*').eq('id', b.id).maybeSingle();
      if (!cmt) return res.status(404).json({ error: 'Comment not found' });
      const admin = await isAdmin(req);
      const isOwner = b.author_id && b.author_id === cmt.author_id;
      if (!isOwner && !admin) return res.status(403).json({ error: 'Not authorized' });
      const patch = {};
      if (b.body !== undefined) { patch.body = maskProfanity(clean(b.body, 500)); patch.edited = true; }
      if (typeof b.deleted === 'boolean') patch.deleted = b.deleted;
      if (admin && typeof b.hidden === 'boolean') patch.hidden = b.hidden;
      const { data, error } = await supabase.from('comments').update(patch).eq('id', b.id).select().single();
      if (error) throw error;
      if (admin && !isOwner) await auditLog('admin', 'moderate_comment', b.id);
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const { error } = await supabase.from('comments').delete().eq('id', req.body?.id);
      if (error) throw error;
      await auditLog('admin', 'hard_delete_comment', req.body?.id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('comments API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
