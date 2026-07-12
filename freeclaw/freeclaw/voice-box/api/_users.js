// Anonymous account registration + heartbeat + own-status check
// Called on app load so every live browser shows up in admin immediately,
// and so banned/suspended users see their status.
import supabase from './_db-client.js';
import { cors, clean } from './_auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const anon_id = clean(req.body?.anon_id, 40).toLowerCase();
    if (!anon_id || !anon_id.startsWith('anon_')) return res.status(400).json({ error: 'Invalid anonymous ID' });

    const { data: existing } = await supabase.from('users_meta').select('*').eq('anon_id', anon_id).maybeSingle();

    if (!existing) {
      const { error: insErr } = await supabase.from('users_meta').insert({ anon_id, warnings: [] });
      if (insErr) console.error('users_meta insert failed:', insErr.message);
    }

    const meta = existing || { banned: false, suspended_until: null, strikes: 0, warnings: [] };
    const suspended = meta.suspended_until && new Date(meta.suspended_until) > new Date();
    return res.status(200).json({
      ok: true,
      banned: !!meta.banned,
      suspended: !!suspended,
      suspended_until: suspended ? meta.suspended_until : null,
      strikes: meta.strikes || 0,
      warning_count: (meta.warnings || []).length,
      latest_warning: (meta.warnings || []).slice(-1)[0]?.text || null,
    });
  } catch (err) {
    console.error('users API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
