// ─── V3 RAG Endpoint ──────────────────────────────────────────────
// Enterprise RAG integration with knowledge base search,
// context injection, and citation tracking.
//
// POST /api/v3/rag — search knowledge base
// POST /api/v3/rag — retrieve context for a query
// GET  /api/v3/rag — KB analytics

import { cors, isAdmin } from '../_auth.js';
import { sanitizeError } from '../_error.js';
import {
  searchKB,
  retrieveContext,
  buildRAGPrompt,
  appendCitations,
  getKBAnalytics,
} from '../_rag.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const body = req.body || {};

    // ── Search knowledge base ──────────────────────────────────────
    if (body.action === 'search' && body.query) {
      const results = await searchKB(body.query, {
        category: body.category,
        limit: body.limit || 10,
        minConfidence: body.min_confidence || 0.3,
      });

      return res.status(200).json({
        query: body.query,
        results,
        count: results.length,
      });
    }

    // ── Retrieve context for RAG ───────────────────────────────────
    if (body.action === 'retrieve' && body.query) {
      const context = await retrieveContext(body.query, {
        category: body.category,
        maxLength: body.max_length || 4000,
      });

      const prompt = buildRAGPrompt(body.query, context);

      return res.status(200).json({
        query: body.query,
        context: context.context,
        citations: context.citations,
        hasRelevantContent: context.hasRelevantContent,
        prompt: {
          system: prompt.systemPrompt.slice(0, 500) + '...',
          user: prompt.userPrompt,
        },
      });
    }

    // ── GET: KB analytics ──────────────────────────────────────────
    if (req.method === 'GET') {
      const analytics = await getKBAnalytics();
      return res.status(200).json({
        service: 'rag-engine',
        status: 'operational',
        analytics,
      });
    }

    return res.status(400).json({ error: 'Invalid request. Provide action (search/retrieve) with query.' });

  } catch (err) {
    console.error('[V3-RAG] Error:', err.message);
    sanitizeError(res, err, 'v3-rag');
  }
}
