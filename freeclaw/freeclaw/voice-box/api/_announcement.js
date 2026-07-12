// Public announcement banner — set by admin, visible to everyone
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const { data } = await supabase.from('settings').select('value').eq('key', 'announcement').maybeSingle();
      return res.status(200).json(data?.value || null);
    }

    if (req.method === 'POST') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const b = req.body || {};
      const value = b.clear ? null : {
        text: clean(b.text, 300),
        kind: ['info', 'success', 'warning'].includes(b.kind) ? b.kind : 'info',
        at: new Date().toISOString(),
      };
      const { data: existing } = await supabase.from('settings').select('key').eq('key', 'announcement').maybeSingle();
      if (existing) await supabase.from('settings').update({ value }).eq('key', 'announcement');
      else await supabase.from('settings').insert({ key: 'announcement', value });
      await auditLog('admin', b.clear ? 'clear_announcement' : 'set_announcement', b.text || '');
      return res.status(200).json({ ok: true, value });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('announcement API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
