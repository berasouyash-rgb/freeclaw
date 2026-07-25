// ─── Long-Term Memory ─────────────────────────────────────────────
// Agent learning system with user preferences, conversation context,
// learned facts, and experience storage.
//
// Architecture:
//   1. Memory Types: user_preferences, conversation_context, learned_facts, experience
//   2. Memory Storage: persists to agent_memory table with confidence scoring
//   3. Memory Retrieval: retrieves relevant memories for context
//   4. Memory Consolidation: merges similar memories, updates confidence
//   5. Memory Expiration: optional TTL for temporary memories
//
// Usage:
//   import { storeMemory, retrieveMemories, consolidateMemories } from './_memory.js';
//   await storeMemory('general', 'user_preferences', { theme: 'dark' });
//   const memories = await retrieveMemories('general', { type: 'user_preferences' });

import supabase from './_db-client.js';

// ─── Constants ────────────────────────────────────────────────────
export const MEMORY_TYPES = ['user_preferences', 'conversation_context', 'learned_facts', 'experience'];
const MAX_MEMORIES_PER_AGENT = 1000;
const MAX_MEMORY_CONTENT_SIZE = 10000;
const DEFAULT_CONFIDENCE = 0.8;
const CONSOLIDATION_THRESHOLD = 0.9; // Similarity threshold for merging

// ─── Memory Storage ───────────────────────────────────────────────
// Stores a memory for an agent.
export async function storeMemory(agentId, memoryType, content, options = {}) {
  const { confidence = DEFAULT_CONFIDENCE, ttl = null, source = 'system' } = options;

  // Validate memory type
  if (!MEMORY_TYPES.includes(memoryType)) {
    return { error: `Invalid memory type: ${memoryType}. Must be one of: ${MEMORY_TYPES.join(', ')}` };
  }

  // Validate content size
  const contentStr = JSON.stringify(content);
  if (contentStr.length > MAX_MEMORY_CONTENT_SIZE) {
    return { error: `Memory content too large: ${contentStr.length} bytes (max ${MAX_MEMORY_CONTENT_SIZE})` };
  }

  // Check memory limit for agent
  const { count } = await supabase.from('agent_memory')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agentId);

  if (count >= MAX_MEMORIES_PER_AGENT) {
    // Delete oldest memories of this type to make room
    await supabase.from('agent_memory')
      .delete()
      .eq('agent_id', agentId)
      .eq('memory_type', memoryType)
      .order('created_at', { ascending: true })
      .limit(10);
  }

  // Calculate expiration if TTL provided
  let expiresAt = null;
  if (ttl) {
    expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  }

  // Store memory
  const row = {
    agent_id: agentId,
    memory_type: memoryType,
    content: content,
    confidence: confidence,
    source: source,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from('agent_memory').insert(row).select().single();

  if (error) {
    return { error: error.message };
  }

  return { ok: true, memory: data };
}

// ─── Memory Retrieval ─────────────────────────────────────────────
// Retrieves memories for an agent with optional filtering.
export async function retrieveMemories(agentId, options = {}) {
  const { type, limit = 50, minConfidence = 0.5, includeExpired = false } = options;

  let query = supabase.from('agent_memory')
    .select('*')
    .eq('agent_id', agentId)
    .gte('confidence', minConfidence)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (type) {
    query = query.eq('memory_type', type);
  }

  if (!includeExpired) {
    query = query.or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());
  }

  const { data, error } = await query;

  if (error) {
    console.error('Memory retrieval error:', error.message);
    return [];
  }

  return data || [];
}

// ─── Memory Search ────────────────────────────────────────────────
// Simple text search across memories.
export async function searchMemories(agentId, query, options = {}) {
  const { type, limit = 10 } = options;

  let q = supabase.from('agent_memory')
    .select('*')
    .eq('agent_id', agentId)
    .limit(limit);

  if (type) {
    q = q.eq('memory_type', type);
  }

  // Use text search on content
  q = q.textSearch('content', query, { type: 'websearch', config: 'english' });

  const { data, error } = await q;

  if (error) {
    // Fallback: retrieve all and filter in-memory
    const all = await retrieveMemories(agentId, { type, limit: 200 });
    const qLower = query.toLowerCase();
    return all.filter(m => {
      const text = JSON.stringify(m.content).toLowerCase();
      return text.includes(qLower);
    }).slice(0, limit);
  }

  return data || [];
}

// ─── Memory Update ────────────────────────────────────────────────
// Updates a specific memory.
export async function updateMemory(memoryId, updates) {
  const { data, error } = await supabase.from('agent_memory')
    .update(updates)
    .eq('id', memoryId)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  return { ok: true, memory: data };
}

// ─── Memory Delete ────────────────────────────────────────────────
// Deletes a specific memory.
export async function deleteMemory(memoryId) {
  const { error } = await supabase.from('agent_memory')
    .delete()
    .eq('id', memoryId);

  if (error) {
    return { error: error.message };
  }

  return { ok: true };
}

// ─── Clear Agent Memories ─────────────────────────────────────────
// Removes all memories for an agent, optionally filtered by type.
export async function clearAgentMemories(agentId, type = null) {
  let q = supabase.from('agent_memory').delete().eq('agent_id', agentId);
  if (type) {
    q = q.eq('memory_type', type);
  }

  const { error } = await q;

  if (error) {
    return { error: error.message };
  }

  return { ok: true };
}

// ─── Memory Consolidation ─────────────────────────────────────────
// Merges similar memories and updates confidence scores.
export async function consolidateMemories(agentId, type = null) {
  const memories = await retrieveMemories(agentId, { type, limit: 200 });

  if (memories.length < 2) {
    return { consolidated: 0 };
  }

  let consolidated = 0;

  // Group by memory type
  const groups = {};
  for (const mem of memories) {
    const key = mem.memory_type;
    if (!groups[key]) groups[key] = [];
    groups[key].push(mem);
  }

  for (const [, group] of Object.entries(groups)) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const similarity = contentSimilarity(group[i].content, group[j].content);
        if (similarity >= CONSOLIDATION_THRESHOLD) {
          // Merge: keep the one with higher confidence, update access count
          const keep = group[i].confidence >= group[j].confidence ? group[i] : group[j];
          const remove = keep === group[i] ? group[j] : group[i];

          // Update kept memory with combined access count
          await updateMemory(keep.id, {
            confidence: Math.min(1.0, Math.max(keep.confidence, remove.confidence) + 0.05),
            access_count: (keep.access_count || 0) + (remove.access_count || 0),
          });

          // Delete the duplicate
          await deleteMemory(remove.id);
          consolidated++;
        }
      }
    }
  }

  return { consolidated };
}

// ─── Build Memory Context ─────────────────────────────────────────
// Builds a context string from agent memories for LLM prompts.
export async function buildMemoryContext(agentId, options = {}) {
  const { maxTokens = 2000 } = options;

  const memories = await retrieveMemories(agentId, {
    limit: 50,
    minConfidence: 0.3,
  });

  if (memories.length === 0) {
    return '';
  }

  const lines = ['[Agent Memory]'];

  for (const mem of memories) {
    const content = typeof mem.content === 'string' ? mem.content : JSON.stringify(mem.content);
    const typeLabel = mem.memory_type.replace(/_/g, ' ');
    lines.push(`- [${typeLabel}] ${content}`);
  }

  const context = lines.join('\n');

  // Truncate to approximate token limit (1 token ≈ 4 chars)
  const maxChars = maxTokens * 4;
  if (context.length > maxChars) {
    return context.slice(0, maxChars) + '...';
  }

  return context;
}

// ─── Memory Analytics ─────────────────────────────────────────────
// Returns usage analytics for agent memory.
export async function getMemoryAnalytics(agentId) {
  const { data, error } = await supabase.from('agent_memory')
    .select('memory_type, confidence')
    .eq('agent_id', agentId);

  if (error) {
    return { agent_id: agentId, total_memories: 0, by_type: {}, avg_confidence: 0 };
  }

  const byType = {};
  let totalConf = 0;

  for (const mem of (data || [])) {
    byType[mem.memory_type] = (byType[mem.memory_type] || 0) + 1;
    totalConf += mem.confidence || 0;
  }

  return {
    agent_id: agentId,
    total_memories: (data || []).length,
    by_type: byType,
    avg_confidence: (data || []).length ? totalConf / (data || []).length : 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────
function contentSimilarity(a, b) {
  const strA = typeof a === 'string' ? a : JSON.stringify(a);
  const strB = typeof b === 'string' ? b : JSON.stringify(b);
  if (!strA || !strB) return 0;
  if (strA === strB) return 1;

  const wordsA = new Set(strA.toLowerCase().split(/\s+/));
  const wordsB = new Set(strB.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

export default {
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
};
