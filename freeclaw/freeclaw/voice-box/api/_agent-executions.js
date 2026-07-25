// Agent Executions API — serves real execution data to the dashboard
// Self-healing: uses runner functions that fall back to settings table
import { cors, isAdmin } from './_auth.js';
import { getRecentExecutions, getRecentActivity, getDashboardStats } from './agents/_runner.js';
import { sanitizeError } from './_error.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const action = req.method === 'GET' ? req.query.action : req.body?.action;

    // List recent executions
    if (action === 'list' || (!action && req.method === 'GET')) {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const agentId = req.query.agent_id || null;
      const executions = await getRecentExecutions(agentId, limit);
      return res.status(200).json({ executions, total: executions.length });
    }

    // Get activity log
    if (action === 'activity') {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const activities = await getRecentActivity(limit);
      return res.status(200).json({ activities, total: activities.length });
    }

    // Get dashboard stats
    if (action === 'stats') {
      const stats = await getDashboardStats();
      return res.status(200).json(stats);
    }

    // Get single execution detail
    if (action === 'get') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const executions = await getRecentExecutions(null, 200);
      const execution = executions.find(e => e.id === id);
      if (!execution) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ execution });
    }

    return res.status(400).json({ error: 'Unknown action. Actions: list, activity, stats, get' });
  } catch (err) {
    return sanitizeError(res, err, 'agent-executions');
  }
}
