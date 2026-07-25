// Event consumption API — event-triggered agents consume events here.
// GET /api/event-agents?action=events — recent events for dashboard
// GET /api/event-agents?action=stats — event statistics
// POST /api/event-agents { action: 'trigger', event_type } — manually trigger agents for an event type
// POST /api/event-agents { action: 'replay', event_type, count } — replay recent events of a type
import { cors, isAdmin, rateLimited, rateLimitResponse } from './_auth.js';
import { getRecentEvents, getEventStats, emitEvent, EVENT_TYPES, EVENT_AGENT_MAP } from './_events.js';
import { runAgent } from './agents/_runner.js';
import { setAgentState } from './_agent-team.js';
import { sanitizeError } from './_error.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const b = req.method === 'GET' ? {} : (req.body || {});
    const action = req.method === 'GET' ? (req.query.action || 'events') : b.action;

    // GET events — recent events for dashboard
    if (req.method === 'GET' && action === 'events') {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const type = req.query.type || null;
      const events = await getRecentEvents(limit, type);
      return res.status(200).json({ events, count: events.length });
    }

    // GET stats — event statistics for dashboard
    if (req.method === 'GET' && action === 'stats') {
      const stats = await getEventStats();
      return res.status(200).json(stats);
    }

    // GET types — available event types and their agent mappings
    if (req.method === 'GET' && action === 'types') {
      const types = Object.entries(EVENT_AGENT_MAP).map(([type, agents]) => ({
        type,
        agents,
        agentCount: agents.length,
      }));
      return res.status(200).json({ types, total: types.length });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // POST trigger — manually trigger agents for an event type
    if (action === 'trigger') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      if (await rateLimited('evt_trigger', req.headers['x-admin-token'] || 'anon', 300, 10)) {
        return rateLimitResponse(res, 300, 'Too many requests — please wait a moment.');
      }
      const { event_type } = b;
      if (!event_type || !EVENT_AGENT_MAP[event_type]) {
        return res.status(400).json({ error: `Invalid event_type. Valid: ${Object.keys(EVENT_AGENT_MAP).join(', ')}` });
      }

      const agentIds = EVENT_AGENT_MAP[event_type];
      const results = await Promise.allSettled(
        agentIds.map(async (id) => {
          setAgentState(id, 'working', `Manual trigger: ${event_type}`);
          try {
            const r = await runAgent(id, { event_type, triggered_by: 'manual_trigger' });
            setAgentState(id, r.status === 'completed' ? 'completed' : 'error', `Trigger: ${event_type}`, r);
            return r;
          } catch (e) {
            setAgentState(id, 'error', `Trigger: ${event_type}`, { error: e.message });
            throw e;
          }
        })
      );

      return res.status(200).json({
        event_type,
        triggered: agentIds.length,
        succeeded: results.filter((r) => r.status === 'fulfilled').length,
        failed: results.filter((r) => r.status === 'rejected').length,
        agents: agentIds,
      });
    }

    // POST replay — replay recent events of a type (re-trigger all agents)
    if (action === 'replay') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      if (await rateLimited('evt_replay', req.headers['x-admin-token'] || 'anon', 300, 5)) {
        return rateLimitResponse(res, 300, 'Too many requests — please wait a moment.');
      }
      const { event_type, count = 5 } = b;
      if (!event_type) return res.status(400).json({ error: 'event_type required' });

      const events = await getRecentEvents(count, event_type);
      if (!events.length) return res.status(200).json({ message: 'No events found', replayed: 0 });

      const agentIds = EVENT_AGENT_MAP[event_type] || [];
      let totalTriggers = 0;

      for (const event of events) {
        for (const agentId of agentIds) {
          setAgentState(agentId, 'working', `Replay: ${event.type}`);
          runAgent(agentId, { event_type: event.type, event_data: event.data, triggered_by: 'replay' })
            .then((r) => setAgentState(agentId, r.status === 'completed' ? 'completed' : 'error', `Replay: ${event.type}`, r))
            .catch((e) => setAgentState(agentId, 'error', `Replay: ${event.type}`, { error: e.message }));
          totalTriggers++;
        }
      }

      return res.status(200).json({
        event_type,
        events_replayed: events.length,
        total_triggers: totalTriggers,
        agents_per_event: agentIds.length,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return sanitizeError(res, err, 'event-agents');
  }
}
