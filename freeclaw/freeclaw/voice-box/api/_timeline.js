// Incident Timeline — tracks the full lifecycle of a complaint from creation to resolution.
// GET  /api/timeline?post_id=X  →  get timeline for a post
// POST /api/timeline { post_id, event_type, description, actor }  →  add timeline event
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';

function timelineKey(postId) { return `timeline:${postId}`; }

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const b = req.body || {};
    const postId = req.query.post_id || b.post_id;

    // GET: fetch timeline
    if (req.method === 'GET') {
      if (!postId) return res.status(400).json({ error: 'post_id required' });
      const { data } = await supabase.from('settings').select('value').eq('key', timelineKey(postId)).maybeSingle();
      return res.status(200).json({ timeline: data?.value?.events || [], post_id: postId });
    }

    // POST: add event
    if (req.method === 'POST') {
      const eventType = b.event_type || 'status_change';
      if (!postId) return res.status(400).json({ error: 'post_id required' });

      const event = {
        id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        event_type: eventType,
        description: clean(b.description || '', 500),
        actor: b.actor || 'system',
        metadata: b.metadata || {},
        timestamp: new Date().toISOString(),
      };

      const { data: existing } = await supabase.from('settings').select('value').eq('key', timelineKey(postId)).maybeSingle();
      const events = existing?.value?.events || [];
      events.push(event);

      await supabase.from('settings').upsert(
        { key: timelineKey(postId), value: { events, updated_at: new Date().toISOString() } },
        { onConflict: 'key' },
      );

      // Also update the post's status_history if it's a status change
      if (eventType === 'status_change' && b.new_status) {
        const { data: post } = await supabase.from('posts').select('status_history').eq('id', postId).maybeSingle();
        const history = post?.status_history || [];
        history.push({ from: b.old_status, to: b.new_status, at: event.timestamp, by: event.actor });
        await supabase.from('posts').update({ status_history: history, updated_at: event.timestamp }).eq('id', postId);
      }

      return res.status(201).json(event);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('timeline error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
