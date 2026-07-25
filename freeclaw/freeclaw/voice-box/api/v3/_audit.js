// ─── V3 Audit Trail Endpoint ─────────────────────────────────────
// Query, filter, and export audit logs with admin authentication.
import { cors, isAdmin } from '../_auth.js';
import { sanitizeError } from '../_error.js';
import { queryAuditLogs, getAuditStats, cleanupOldAuditLogs } from '../_audit.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // Only admins can access audit logs
    if (!(await isAdmin(req))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { action } = req.method === 'GET' ? req.query : (req.body || {});

    // GET: Query audit logs
    if (req.method === 'GET' && (!action || action === 'list')) {
      const {
        action: filterAction,
        actor_type,
        actor_id,
        resource_type,
        resource_id,
        start_date,
        end_date,
        level,
        limit = 100,
        offset = 0,
      } = req.query;

      const logs = await queryAuditLogs({
        action: filterAction,
        actorType: actor_type,
        actorId: actor_id,
        resourceType: resource_type,
        resourceId: resource_id,
        startDate: start_date,
        endDate: end_date,
        level,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });

      return res.status(200).json({
        logs,
        count: logs.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
    }

    // GET: Get audit statistics
    if (req.method === 'GET' && action === 'stats') {
      const { start_date, end_date } = req.query;
      const stats = await getAuditStats(start_date, end_date);
      return res.status(200).json({ stats });
    }

    // POST: Cleanup old audit logs
    if (req.method === 'POST' && action === 'cleanup') {
      const { retention_days = 90 } = req.body || {};
      const deleted = await cleanupOldAuditLogs(parseInt(retention_days));
      return res.status(200).json({
        deleted,
        retention_days: parseInt(retention_days),
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[V3-AUDIT] Error:', err.message);
    sanitizeError(res, err, 'v3-audit');
  }
}
