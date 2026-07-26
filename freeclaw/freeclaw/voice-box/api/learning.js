// ═══════════════════════════════════════════════════════════════════
// LEARNING API — Self-evolution endpoints
// ═══════════════════════════════════════════════════════════════════
import { cors, isAdmin, auditLog, clean } from './_auth.js';
import { sanitizeError } from './_error.js';
import {
  recordTaskOutcome,
  recordTaskOutcomes,
  getLearningRecords,
  analyzePatterns,
  triggerReflection,
  getInsights,
  applyInsights,
  sharePattern,
  queryKnowledge,
  decayOldKnowledge,
  recordAdminFeedback,
  getFeedbackStats,
  getLearningStats,
  adjustThreshold,
  rewritePrompt,
  requestAgentSpawn,
  getSpawnRequests,
  getAgentConfig,
} from './_learning-engine.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const b = req.body || {};
    const action = req.method === 'GET' ? req.query.action : b.action;

    // ── GET: Stats, records, insights, knowledge, feedback ─────
    if (req.method === 'GET') {
      if (action === 'stats' || !action) {
        const stats = await getLearningStats();
        return res.status(200).json(stats);
      }

      if (action === 'records') {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const records = await getLearningRecords(req.query.agent_id || null, req.query.division || null, limit);
        return res.status(200).json({ records, total: records.length });
      }

      if (action === 'patterns') {
        const patterns = await analyzePatterns(req.query.agent_id || null, req.query.division || null);
        return res.status(200).json(patterns);
      }

      if (action === 'insights') {
        const insights = await getInsights(req.query.agent_id || null, req.query.division || null);
        return res.status(200).json({ insights, total: insights.length });
      }

      if (action === 'knowledge') {
        const knowledge = await queryKnowledge(req.query.division || 'content', req.query.task_type || null);
        return res.status(200).json({ knowledge, total: knowledge.length });
      }

      if (action === 'feedback') {
        const stats = await getFeedbackStats(req.query.agent_id || null);
        return res.status(200).json(stats);
      }

      if (action === 'config') {
        if (!req.query.agent_id) return res.status(400).json({ error: 'agent_id required' });
        const config = await getAgentConfig(req.query.agent_id);
        return res.status(200).json({ agent_id: req.query.agent_id, config });
      }

      if (action === 'spawnRequests') {
        const requests = await getSpawnRequests();
        return res.status(200).json({ requests, total: requests.length });
      }
    }

    // ── POST: Record outcomes, reflect, share, feedback, config ─
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    if (action === 'recordOutcome') {
      if (!b.agent_id) return res.status(400).json({ error: 'agent_id required' });
      const ok = await recordTaskOutcome(b.agent_id, b.division, b.task_type, b.outcome, b.metrics || {});
      return res.status(200).json({ ok, agent_id: b.agent_id });
    }

    if (action === 'batchRecord') {
      if (!Array.isArray(b.outcomes)) return res.status(400).json({ error: 'outcomes array required' });
      const saved = await recordTaskOutcomes(b.outcomes);
      return res.status(200).json({ ok: true, saved, total: b.outcomes.length });
    }

    if (action === 'reflect') {
      if (!b.agent_id) return res.status(400).json({ error: 'agent_id required' });
      const result = await triggerReflection(b.agent_id, b.division, b.reason || 'admin_request', b.context || '');
      await auditLog('admin', 'learning_reflect', `Triggered reflection for ${b.agent_id}: ${result.triggered ? 'success' : result.reason}`);
      return res.status(200).json(result);
    }

    if (action === 'applyInsights') {
      if (!b.agent_id) return res.status(400).json({ error: 'agent_id required' });
      const result = await applyInsights(b.agent_id);
      await auditLog('admin', 'learning_apply', `Applied ${result.applied} insights for ${b.agent_id}`);
      return res.status(200).json(result);
    }

    if (action === 'sharePattern') {
      if (!b.agent_id || !b.division) return res.status(400).json({ error: 'agent_id and division required' });
      const ok = await sharePattern(b.agent_id, b.division, b.pattern || {});
      return res.status(200).json({ ok });
    }

    if (action === 'decay') {
      const result = await decayOldKnowledge();
      return res.status(200).json(result);
    }

    if (action === 'feedback') {
      if (!b.agent_id) return res.status(400).json({ error: 'agent_id required' });
      const ok = await recordAdminFeedback(b.agent_id, b.report_id, b.rating, b.comment || '');
      await auditLog('admin', 'learning_feedback', `Admin feedback on ${b.agent_id}: ${b.rating}`);
      return res.status(200).json({ ok });
    }

    if (action === 'adjustThreshold') {
      if (!b.agent_id || !b.metric) return res.status(400).json({ error: 'agent_id and metric required' });
      const ok = await adjustThreshold(b.agent_id, b.metric, b.value);
      await auditLog('admin', 'learning_threshold', `Adjusted ${b.metric} for ${b.agent_id} to ${b.value}`);
      return res.status(200).json({ ok });
    }

    if (action === 'rewritePrompt') {
      if (!b.agent_id || !b.prompt) return res.status(400).json({ error: 'agent_id and prompt required' });
      const ok = await rewritePrompt(b.agent_id, clean(b.prompt, 2000));
      await auditLog('admin', 'learning_prompt', `Rewrote prompt for ${b.agent_id}`);
      return res.status(200).json({ ok });
    }

    if (action === 'requestSpawn') {
      if (!b.division || !b.reason) return res.status(400).json({ error: 'division and reason required' });
      const result = await requestAgentSpawn(b.division, b.reason, b.capabilities || [], 'admin');
      await auditLog('admin', 'learning_spawn', `Spawn request for ${b.division}: ${b.reason}`);
      return res.status(200).json(result);
    }

    return res.status(400).json({
      error: 'Unknown action. GET: stats, records, patterns, insights, knowledge, feedback, config, spawnRequests. POST: recordOutcome, batchRecord, reflect, applyInsights, sharePattern, decay, feedback, adjustThreshold, rewritePrompt, requestSpawn',
    });
  } catch (err) {
    return sanitizeError(res, err, 'learning');
  }
}
