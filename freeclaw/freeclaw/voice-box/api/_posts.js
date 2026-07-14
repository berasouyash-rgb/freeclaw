// Problems + Suggestions API
import supabase from './_db-client.js';
import { cors, isAdmin, checkUser, ensureUser, auditLog, clean, maskProfanity, rateLimited } from './_auth.js';

const CATEGORIES = ['Academics','Facilities','Food','Bullying','Teachers','Events','Transport','Sports','Technology','Library','Hostel','Security','Cleanliness','Medical','Other'];
const STATUSES = ['reported','verified','in_progress','waiting','solved','archived'];

// Co-sign threshold: posts with this many supports are auto-flagged "ready for decision"
const READY_THRESHOLD = 10;
// Solved/archived posts are permanently deleted after 5 days of NO activity.
// Any reaction or comment bumps updated_at and resets the countdown.
const PURGE_MS = 5 * 24 * 60 * 60 * 1000;

/** Lazy sweep: permanently remove solved/archived posts inactive for 5+ days */
async function purgeExpired() {
  try {
    const cutoff = new Date(Date.now() - PURGE_MS).toISOString();
    const { data: expired } = await supabase.from('posts').select('id')
      .in('status', ['solved', 'archived']).lt('updated_at', cutoff).limit(20);
    if (expired?.length) {
      const ids = expired.map((p) => p.id);
      await Promise.all([
        supabase.from('posts').delete().in('id', ids),
        supabase.from('comments').delete().in('post_id', ids),
        supabase.from('reactions').delete().in('target_id', ids),
      ]);
    }
  } catch { /* sweep is best-effort */ }
}

async function attachCounts(posts) {
  const ids = posts.map((p) => p.id);
  if (!ids.length) return posts;
  const [{ data: reactions }, { data: comments }, { data: polls }] = await Promise.all([
    supabase.from('reactions').select('target_id,kind').in('target_id', ids),
    supabase.from('comments').select('post_id').in('post_id', ids).eq('deleted', false).eq('hidden', false),
    supabase.from('polls').select('id,post_id').in('post_id', ids),
  ]);
  const rMap = {}; const cMap = {}; const pMap = {};
  (reactions || []).forEach((r) => { rMap[r.target_id] = rMap[r.target_id] || {}; rMap[r.target_id][r.kind] = (rMap[r.target_id][r.kind] || 0) + 1; });
  (comments || []).forEach((c) => { cMap[c.post_id] = (cMap[c.post_id] || 0) + 1; });
  (polls || []).forEach((p) => { pMap[p.post_id] = p.id; });
  return posts.map((p) => {
    const reactions = rMap[p.id] || {};
    const isClosed = ['solved', 'archived'].includes(p.status);
    return {
      ...p, reactions, comment_count: cMap[p.id] || 0, linked_poll: pMap[p.id] || null,
      // Co-sign threshold auto-flag
      ready_for_decision: !isClosed && (reactions.support || 0) >= READY_THRESHOLD,
      ready_threshold: READY_THRESHOLD,
      // Countdown metadata for solved/archived posts (5-day auto-delete)
      purge_at: isClosed ? new Date(+new Date(p.updated_at || p.created_at) + PURGE_MS).toISOString() : null,
    };
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      await purgeExpired(); // lazy cleanup on every read
      const { id, ids, type, all, viewer, author, cursor, limit: limitParam, paginate } = req.query;
      const admin = all === '1' ? await isAdmin(req) : false;
      const isPaginated = paginate === '1' || paginate === 'true';
      const PAGE_LIMIT = Math.min(parseInt(limitParam) || 30, 100);

      let q = supabase.from('posts').select('*').order('created_at', { ascending: false });
      if (id) q = q.eq('id', id);
      else if (ids) q = q.in('id', String(ids).split(',').slice(0, 100));
      else if (author) q = q.eq('author_id', clean(author, 40)).eq('deleted', false).limit(200);
      else {
        if (type) q = q.eq('type', type);
        if (!admin) q = q.eq('hidden', false).eq('deleted', false);
        if (isPaginated) {
          // Cursor-based pagination: cursor is ISO timestamp of last item
          if (cursor) q = q.lt('created_at', cursor);
          q = q.limit(PAGE_LIMIT + 1); // fetch one extra to detect hasMore
        } else {
          q = q.limit(300);
        }
      }
      const { data, error } = await q;
      if (error) throw error;

      if (isPaginated) {
        const rows = data || [];
        const hasMore = rows.length > PAGE_LIMIT;
        const sliced = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
        const nextCursor = hasMore ? sliced[sliced.length - 1]?.created_at : null;
        const out = await attachCounts(sliced);
        const v = clean(viewer, 40);
        const masked = out.map((p) => {
          const is_mine = !!v && p.author_id === v;
          return { ...p, is_mine, author_id: admin || is_mine || author ? p.author_id : p.author_id.slice(0, 9) + '…' };
        });
        // Get total count (separate query, lightweight)
        let totalQ = supabase.from('posts').select('id', { count: 'exact', head: true });
        if (type) totalQ = totalQ.eq('type', type);
        if (!admin) totalQ = totalQ.eq('hidden', false).eq('deleted', false);
        const { count } = await totalQ;
        return res.status(200).json({ data: masked, nextCursor, total: count || 0 });
      }

      const out = await attachCounts(data || []);
      const v = clean(viewer, 40);
      const masked = out.map((p) => {
        const is_mine = !!v && p.author_id === v;
        return { ...p, is_mine, author_id: admin || is_mine || author ? p.author_id : p.author_id.slice(0, 9) + '…' };
      });
      return res.status(200).json(masked);
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const author_id = clean(b.author_id, 40);
      const gate = await checkUser(author_id);
      if (!gate.ok) return res.status(403).json({ error: gate.error });
      if (await rateLimited('posts', author_id, 60, 3)) {
        return res.status(429).json({ error: 'Slow down — you can post at most 3 times per minute.' });
      }
      const title = maskProfanity(clean(b.title, 120));
      const description = maskProfanity(clean(b.description, 500));
      if (title.length < 5) return res.status(400).json({ error: 'Title must be at least 5 characters.' });
      if (description.length < 10) return res.status(400).json({ error: 'Description must be at least 10 characters.' });
      const category = CATEGORIES.includes(b.category) ? b.category : 'Other';
      const type = b.type === 'suggestion' ? 'suggestion' : 'problem';
      const priority = ['low', 'medium', 'high', 'critical'].includes(b.priority) ? b.priority : 'medium';
      const tags = Array.isArray(b.tags) ? b.tags.slice(0, 6).map((t) => clean(t, 24)).filter(Boolean) : [];
      const post = {
        id: b.id || `${type === 'suggestion' ? 'sug' : 'post'}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        type, title, description, category, priority, tags,
        image_url: clean(b.image_url, 500) || null,
        author_id, status: 'reported', progress: 0,
        status_history: [{ status: 'reported', at: new Date().toISOString(), note: 'Submitted anonymously' }],
      };
      const { data, error } = await supabase.from('posts').insert(post).select().single();
      if (error) throw error;
      await ensureUser(author_id);
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const b = req.body || {};
      const { id } = b;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const { data: post } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
      if (!post) return res.status(404).json({ error: 'Post not found' });
      const admin = await isAdmin(req);
      const isOwner = b.author_id && b.author_id === post.author_id;

      const patch = {};
      if (isOwner || admin) {
        // Owner-permitted fields
        if (typeof b.deleted === 'boolean') patch.deleted = b.deleted; // soft delete + 30s restore
        if (b.title !== undefined) patch.title = maskProfanity(clean(b.title, 120));
        if (b.description !== undefined) patch.description = maskProfanity(clean(b.description, 500));
        if (b.tags !== undefined && Array.isArray(b.tags)) patch.tags = b.tags.slice(0, 6).map((t) => clean(t, 24));
      }
      if (admin) {
        if (b.status && STATUSES.includes(b.status)) {
          patch.status = b.status;
          const map = { reported: 5, verified: 20, in_progress: 50, waiting: 70, solved: 100, archived: 100 };
          patch.progress = map[b.status];
          patch.status_history = [...(post.status_history || []), { status: b.status, at: new Date().toISOString(), note: clean(b.status_note, 300) || null }];
        }
        for (const f of ['pinned', 'featured', 'hidden', 'locked']) if (typeof b[f] === 'boolean') patch[f] = b[f];
        if (b.admin_reply !== undefined) patch.admin_reply = clean(b.admin_reply, 1000);
        if (b.admin_notes !== undefined) patch.admin_notes = clean(b.admin_notes, 2000);
        if (b.ai_summary !== undefined) patch.ai_summary = clean(b.ai_summary, 2000);
        if (b.category !== undefined && CATEGORIES.includes(b.category)) patch.category = b.category;
        if (b.priority !== undefined) patch.priority = b.priority;
        if (b.eta !== undefined) patch.eta = clean(b.eta, 60);
        if (b.assigned_to !== undefined) patch.assigned_to = clean(b.assigned_to, 60);
        if (typeof b.progress === 'number') patch.progress = Math.max(0, Math.min(100, b.progress));
        if (b.merged_into !== undefined) patch.merged_into = clean(b.merged_into, 60);
        if (b.type !== undefined && ['problem', 'suggestion'].includes(b.type)) patch.type = b.type; // convert suggestion <-> project/problem
      }
      if (!isOwner && !admin) return res.status(403).json({ error: 'Not authorized' });
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
      patch.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from('posts').update(patch).eq('id', id).select().single();
      if (error) throw error;
      if (admin) await auditLog('admin', 'update_post', `${id}: ${Object.keys(patch).join(', ')}`);
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const { id } = req.body || {};
      // Clean up all related data in parallel: post, comments, reactions, linked polls
      await Promise.all([
        supabase.from('posts').delete().eq('id', id),
        supabase.from('comments').delete().eq('post_id', id),
        supabase.from('reactions').delete().eq('target_id', id),
        supabase.from('polls').delete().eq('post_id', id),
      ]);
      await auditLog('admin', 'hard_delete_post', id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('posts API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
