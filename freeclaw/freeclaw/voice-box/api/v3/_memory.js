// ─── V3 Memory Endpoint ───────────────────────────────────────────
// Enterprise long-term memory with user preferences,
// conversation context, learned facts, and experience storage.
//
// POST /api/v3/memory — store a memory
// POST /api/v3/memory — retrieve memories
// POST /api/v3/memory — search memories
// GET  /api/v3/memory — memory analytics

import { cors, isAdmin } from '../_auth.js';
import { sanitizeError } from '../_error.js';
import {
  storeMemory,
  retrieveMemories,
  searchMemories,
  updateMemory,
  deleteMemory,
  clearAgentMemories,
  consolidateMemories,
  buildMemoryContext,
  getMemoryAnalytics,
  MEMORY_TYPES,
} from '../_memory.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const body = req.body || {};

    // ── Store a memory ─────────────────────────────────────────────
    if (body.action === 'store' && body.agent_id && body.memory_type && body.content) {
      if (!MEMORY_TYPES.includes(body.memory_type)) {
        return res.status(400).json({ error: `Invalid memory type. Must be one of: ${MEMORY_TYPES.join(', ')}` });
      }

      const result = await storeMemory(body.agent_id, body.memory_type, body.content, {
        confidence: body.confidence,
        ttl: body.ttl,
        source: body.source || 'api',
      });

      if (result.error) {
        return res.status(400).json(result);
      }

      return res.status(201).json(result);
    }

    // ── Retrieve memories ──────────────────────────────────────────
    if (body.action === 'retrieve' && body.agent_id) {
      const memories = await retrieveMemories(body.agent_id, {
        type: body.memory_type,
        limit: body.limit || 50,
        minConfidence: body.min_confidence || 0.5,
      });

      return res.status(200).json({
        agent_id: body.agent_id,
        count: memories.length,
        memories,
      });
    }

    // ── Search memories ────────────────────────────────────────────
    if (body.action === 'search' && body.agent_id && body.query) {
      const memories = await searchMemories(body.agent_id, body.query, {
        type: body.memory_type,
        limit: body.limit || 10,
      });

      return res.status(200).json({
        agent_id: body.agent_id,
        query: body.query,
        count: memories.length,
        memories,
      });
    }

    // ── Build memory context ───────────────────────────────────────
    if (body.action === 'context' && body.agent_id) {
      const context = await buildMemoryContext(body.agent_id, {
        maxTokens: body.max_tokens || 2000,
      });

      return res.status(200).json({
        agent_id: body.agent_id,
        context,
        length: context.length,
      });
    }

    // ── Consolidate memories ───────────────────────────────────────
    if (body.action === 'consolidate' && body.agent_id) {
      const result = await consolidateMemories(body.agent_id, body.memory_type);

      return res.status(200).json({
        agent_id: body.agent_id,
        ...result,
      });
    }

    // ── Clear memories ─────────────────────────────────────────────
    if (body.action === 'clear' && body.agent_id) {
      const result = await clearAgentMemories(body.agent_id, body.memory_type);

      return res.status(200).json({
        agent_id: body.agent_id,
        ...result,
      });
    }

    // ── Update memory ──────────────────────────────────────────────
    if (body.action === 'update' && body.memory_id) {
      const updates = {};
      if (body.content) updates.content = body.content;
      if (body.confidence !== undefined) updates.confidence = body.confidence;
      if (body.ttl) updates.expires_at = new Date(Date.now() + body.ttl * 1000).toISOString();

      const result = await updateMemory(body.memory_id, updates);

      if (result.error) {
        return res.status(400).json(result);
      }

      return res.status(200).json(result);
    }

    // ── Delete memory ──────────────────────────────────────────────
    if (body.action === 'delete' && body.memory_id) {
      const result = await deleteMemory(body.memory_id);

      return res.status(200).json(result);
    }

    // ── GET: Memory analytics ──────────────────────────────────────
    if (req.method === 'GET') {
      const agentId = req.query.agent_id || 'general';
      const analytics = await getMemoryAnalytics(agentId);

      return res.status(200).json({
        service: 'memory-engine',
        status: 'operational',
        memory_types: MEMORY_TYPES,
        analytics,
      });
    }

    return res.status(400).json({ error: 'Invalid request. Provide action with required parameters.' });

  } catch (err) {
    console.error('[V3-MEMORY] Error:', err.message);
    sanitizeError(res, err, 'v3-memory');
  }
}
