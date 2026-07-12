// Reaction toggles — positive-only voting (Support on problems, Upvote on ideas).
// One vote per anonymous browser per item; tapping again removes it.
import supabase from './_db-client.js';
import { cors, checkUser, clean } from './_auth.js';

// Normalize legacy/synonym kinds from older cached clients so nobody
// ever gets an "invalid reaction" error.
const NORMALIZE = {
  support: 'support', like: 'support', important: 'support', urgent: 'support',
  disagree: 'disagree', dislike: 'disagree', unsupport: 'disagree', unsupported: 'disagree',
  upvote: 'upvote',
  // Nuanced emotional reactions
  concerned: 'concerned', frustrated: 'frustrated', appreciate: 'appreciate',
};
const OPPOSITES = {}; // no opposing kinds — voting is positive-only

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const { author, target } = req.query;
      let q = supabase.from('reactions').select('*');
      if (author) q = q.eq('author_id', author);
      if (target) q = q.eq('target_id', target);
      const { data, error } = await q.limit(1000);
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const author_id = clean(b.author_id, 40);
      const kind = NORMALIZE[b.kind] || null;
      const target_id = clean(b.target_id, 60);
      const target_type = ['post', 'comment', 'suggestion'].includes(b.target_type) ? b.target_type : 'post';
      if (!kind || !target_id) return res.status(400).json({ error: 'Invalid reaction' });
      const gate = await checkUser(author_id);
      if (!gate.ok) return res.status(403).json({ error: gate.error });

      // Toggle: remove if exists, insert otherwise — and ALWAYS clear opposites
      const { data: existing } = await supabase.from('reactions').select('id')
        .eq('target_id', target_id).eq('author_id', author_id).eq('kind', kind).maybeSingle();

      if (existing) {
        await supabase.from('reactions').delete().eq('id', existing.id);
      } else {
        // Mutual exclusion: delete any opposing reactions by this user first
        const opposites = OPPOSITES[kind] || [];
        if (opposites.length) {
          await supabase.from('reactions').delete()
            .eq('target_id', target_id).eq('author_id', author_id).in('kind', opposites);
        }
        await supabase.from('reactions').insert({ target_id, target_type, author_id, kind });
      }

      // Activity resets the auto-deletion countdown
      if (target_type === 'post' || target_type === 'suggestion') {
        await supabase.from('posts').update({ updated_at: new Date().toISOString() }).eq('id', target_id);
      }

      // Return fresh counts AND the caller's own reactions so the UI stays in perfect sync
      const [{ data: rows }, { data: mineRows }] = await Promise.all([
        supabase.from('reactions').select('kind').eq('target_id', target_id),
        supabase.from('reactions').select('kind').eq('target_id', target_id).eq('author_id', author_id),
      ]);
      const counts = {};
      (rows || []).forEach((r) => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
      return res.status(200).json({ toggled: !existing, counts, mine: (mineRows || []).map((r) => r.kind) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('reactions API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
