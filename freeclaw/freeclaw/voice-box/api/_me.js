// Account status check for the caller's own anonymous ID (no personal data involved)
import supabase from './_db-client.js';
import { cors, clean } from './_auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const anonId = clean(req.query.anon_id, 40);
    if (!anonId) return res.status(400).json({ error: 'Missing anon_id' });
    const { data } = await supabase.from('users_meta')
      .select('banned,suspended_until,strikes,warnings')
      .eq('anon_id', anonId).maybeSingle();
    const suspended = data?.suspended_until && new Date(data.suspended_until) > new Date();
    return res.status(200).json({
      banned: !!data?.banned,
      suspended: !!suspended,
      suspended_until: suspended ? data.suspended_until : null,
      strikes: data?.strikes || 0,
      warnings: data?.warnings || [],
    });
  } catch (err) {
    console.error('me API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
