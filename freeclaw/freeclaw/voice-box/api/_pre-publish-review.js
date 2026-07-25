// Pre-Publish Review Queue — admin endpoint for high-risk content awaiting review.
//
// GET  /api/pre-publish/review          → list pending review items
// POST /api/pre-publish/review          → take action on a review item
//   { key, action: 'approve'|'reject'|'keep_private'|'ban' }

import supabase from './_db-client.js';
import { cors, isAdmin, auditLog } from './_auth.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!(await isAdmin(req))) {
    return res.status(403).json({ error: 'Admin only' });
  }

  if (req.method === 'GET') {
    try {
      const { data } = await supabase.from('settings')
        .select('key, value')
        .like('key', 'pre_publish_review:%')
        .order('key', { ascending: false });

      const items = (data || []).map((row) => ({
        key: row.key,
        ...row.value,
      }));

      return res.status(200).json({ items, total: items.length });
    } catch (err) {
      console.error('review-queue GET error:', err);
      return res.status(500).json({ error: 'Failed to load review queue' });
    }
  }

  if (req.method === 'POST') {
    const { key, action } = req.body || {};
    if (!key || !action) return res.status(400).json({ error: 'key and action required' });

    const validActions = ['approve', 'reject', 'keep_private', 'ban'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
    }

    try {
      // Get the review item
      const { data: row } = await supabase.from('settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (!row) return res.status(404).json({ error: 'Review item not found' });

      const item = row.value;

      if (action === 'approve') {
        // Create the post from the review item
        const postData = {
          type: item.content_type === 'poll' ? 'suggestion' : (item.content_type || 'problem'),
          title: item.title || 'Untitled',
          description: item.description || item.body || '',
          category: item.category || 'Other',
          priority: item.priority || 'medium',
          author_id: item.author_id || 'anonymous',
          status: 'open',
          image_url: null,
          tags: [],
        };
        const { error: postErr } = await supabase.from('posts').insert(postData);
        if (postErr) throw postErr;
        await auditLog(item.author_id || 'anonymous', 'pre_publish_approved', `Admin approved high-risk content from review queue`, 'admin');
      } else if (action === 'reject') {
        await auditLog(item.author_id || 'anonymous', 'pre_publish_rejected', `Admin rejected high-risk content`, 'admin');
      } else if (action === 'keep_private') {
        // Update status to indicate private/visible only to admin
        await supabase.from('settings').update({
          value: { ...item, status: 'kept_private', reviewed_by: 'admin', reviewed_at: new Date().toISOString() }
        }).eq('key', key);
        await auditLog(item.author_id || 'anonymous', 'pre_publish_kept_private', `Admin kept content private`, 'admin');
      } else if (action === 'ban') {
        // Ban the author
        await supabase.from('users_meta').upsert({
          anon_id: item.author_id,
          banned: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'anon_id' });
        await auditLog(item.author_id || 'anonymous', 'pre_publish_banned', `Admin banned user for high-risk content`, 'admin');
      }

      // Remove from review queue
      await supabase.from('settings').delete().eq('key', key);

      return res.status(200).json({ ok: true, action, key });
    } catch (err) {
      console.error('review-queue POST error:', err);
      return res.status(500).json({ error: 'Failed to process review action' });
    }
  }

  return res.status(405).json({ error: 'GET or POST only' });
}
