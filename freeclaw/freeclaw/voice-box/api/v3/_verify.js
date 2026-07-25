// ─── V3 Verification Endpoint ─────────────────────────────────────
// Enterprise answer verification with confidence scoring,
// citation tracking, and uncertainty detection.
//
// POST /api/v3/verify — verify an AI answer
// GET  /api/v3/verify — verification status

import { cors, isAdmin } from '../_auth.js';
import { sanitizeError } from '../_error.js';
import {
  verifyAnswer,
  verifyAnswers,
  buildVerificationSummary,
} from '../_verification.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const body = req.body || {};

    // ── Verify a single answer ───────────────────────────────────
    if (req.method === 'POST' && body.query && body.answer) {
      const verification = await verifyAnswer(body.query, body.answer, {
        agentId: body.agent_id || 'general',
        category: body.category,
      });

      return res.status(200).json({
        query: body.query,
        answer: body.answer,
        verification,
        summary: buildVerificationSummary(verification),
      });
    }

    // ── Batch verify multiple answers ────────────────────────────
    if (req.method === 'POST' && Array.isArray(body.queries)) {
      if (body.queries.length > 20) {
        return res.status(400).json({ error: 'Maximum 20 queries per batch' });
      }

      const results = await verifyAnswers(body.queries, {
        agentId: body.agent_id || 'general',
        category: body.category,
      });

      return res.status(200).json({ results });
    }

    // ── GET: verification status ──────────────────────────────────
    if (req.method === 'GET') {
      return res.status(200).json({
        service: 'verification-engine',
        status: 'operational',
        thresholds: {
          high: 0.8,
          medium: 0.5,
          low: 0.3,
        },
      });
    }

    return res.status(400).json({ error: 'Invalid request. Provide query + answer, or queries array.' });

  } catch (err) {
    console.error('[V3-VERIFY] Error:', err.message);
    sanitizeError(res, err, 'v3-verify');
  }
}
