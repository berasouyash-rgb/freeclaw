// Audit Trail — immutable admin action logs.
// GET  /api/audit-trail?action=X&actor=X&from=ISO&to=ISO&limit=N&page=N  →  query audit logs
// GET  /api/audit-trail/stats  →  audit summary statistics
import supabase from './_db-client.js';
import { cors, isAdmin } from './_auth.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const action = req.query.action || req.query.filter_action;
    const actor = req.query.actor;
    const from = req.query.from;
    const to = req.query.to;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    // Stats mode
    if (req.query.action === 'stats') {
      const { data: logs } = await supabase.from('activity_logs').select('action, actor, created_at').order('created_at', { ascending: false }).limit(500);
      if (!logs) return res.status(200).json({ stats: {} });

      const byAction = {};
      const byActor = {};
      const byHour = {};
      logs.forEach((l) => {
        byAction[l.action] = (byAction[l.action] || 0) + 1;
        if (l.actor) byActor[l.actor] = (byActor[l.actor] || 0) + 1;
        const hour = new Date(l.created_at).getHours();
        byHour[hour] = (byHour[hour] || 0) + 1;
      });

      return res.status(200).json({
        total_entries: logs.length,
        by_action: byAction,
        by_actor: byActor,
        by_hour: byHour,
        most_common_action: Object.entries(byAction).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
        most_active_actor: Object.entries(byActor).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
      });
    }

    // Query mode
    let query = supabase.from('activity_logs').select('*').order('created_at', { ascending: false });

    if (action && action !== 'stats') query = query.eq('action', action);
    if (actor) query = query.eq('actor', actor);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    // Get total count
    const { count } = await query.select('*', { count: 'exact', head: true });

    // Paginate
    query = query.range(offset, offset + limit - 1);
    const { data: logs } = await query;

    return res.status(200).json({
      logs: logs || [],
      total: count || 0,
      page,
      pages: Math.ceil((count || 0) / limit),
      limit,
    });
  } catch (err) {
    console.error('audit-trail error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
