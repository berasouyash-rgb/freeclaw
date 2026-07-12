// Report queue for moderation
import supabase from './_db-client.js';
import { cors, isAdmin, checkUser, auditLog, clean } from './_auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const { data, error } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const author_id = clean(b.author_id, 40);
      const gate = await checkUser(author_id);
      if (!gate.ok) return res.status(403).json({ error: gate.error });
      const row = {
        target_id: clean(b.target_id, 60),
        target_type: ['post', 'comment', 'poll'].includes(b.target_type) ? b.target_type : 'post',
        reason: clean(b.reason, 300) || 'No reason given',
        author_id,
      };
      if (!row.target_id) return res.status(400).json({ error: 'Missing target' });
      const { data, error } = await supabase.from('reports').insert(row).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const b = req.body || {};
      const { data, error } = await supabase.from('reports').update({ status: clean(b.status, 20) || 'resolved' }).eq('id', b.id).select().single();
      if (error) throw error;
      await auditLog('admin', 'resolve_report', String(b.id));
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('reports API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
