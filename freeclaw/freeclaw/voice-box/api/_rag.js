// ─── RAG Integration ──────────────────────────────────────────────
// Retrieval-Augmented Generation for the knowledge base.
// Provides semantic search, context injection, and citation tracking.
//
// Architecture:
//   1. Knowledge Base Ingestion: index articles with embeddings
//   2. Semantic Search: find relevant KB entries for a query
//   3. Context Injection: inject KB content into LLM prompts
//   4. Citation Tracking: link AI answers to KB sources
//   5. Usage Analytics: track which KB entries are used
//
// Usage:
//   import { retrieveContext, buildRAGPrompt, searchKB } from './_rag.js';
//   const context = await retrieveContext('How do I reset my password?');
//   const prompt = buildRAGPrompt(query, context);

import supabase from './_db-client.js';

// ─── Constants ────────────────────────────────────────────────────
const MAX_CONTEXT_LENGTH = 4000;
const MAX_CITATIONS = 5;
const SIMILARITY_THRESHOLD = 0.3;

// ─── Text Normalization ───────────────────────────────────────────
function normalizeText(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, '').trim();
}

// ─── Simple Text Similarity ───────────────────────────────────────
// Word-overlap similarity for when pgvector isn't available.
function textSimilarity(query, content) {
  if (!query || !content) return 0;

  const qWords = new Set(normalizeText(query).split(/\s+/).filter(w => w.length > 2));
  const cWords = new Set(normalizeText(content).split(/\s+/).filter(w => w.length > 2));

  if (qWords.size === 0 || cWords.size === 0) return 0;

  let overlap = 0;
  for (const word of qWords) {
    if (cWords.has(word)) overlap++;
  }

  return overlap / Math.max(qWords.size, cWords.size);
}

// ─── Knowledge Base Search ────────────────────────────────────────
// Searches the KB using text similarity (falls back from vector search).
export async function searchKB(query, options = {}) {
  const { category, limit = 10, minConfidence = 0.5 } = options;

  try {
    // Try full-text search with ILIKE
    let q = supabase.from('knowledge_base')
      .select('id, title, content, category, tags, confidence, source, last_verified, usage_count')
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .order('confidence', { ascending: false })
      .limit(limit * 2); // Fetch extra for filtering

    if (category) {
      q = q.eq('category', category);
    }

    const { data, error } = await q;
    if (error) {
      console.warn('[RAG] KB search error:', error.message);
      return [];
    }

    // Score and filter results
    const scored = (data || [])
      .map(kb => ({
        ...kb,
        similarity: textSimilarity(query, kb.content),
      }))
      .filter(kb => kb.similarity >= SIMILARITY_THRESHOLD && kb.confidence >= minConfidence)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    // Update usage counts (non-critical)
    if (scored.length > 0) {
      try {
        const ids = scored.map(s => s.id);
        await supabase.from('knowledge_base')
          .update({ usage_count: supabase.raw('usage_count + 1') })
          .in('id', ids);
      } catch { /* non-critical */ }
    }

    return scored;
  } catch (err) {
    console.warn('[RAG] Search failed:', err.message);
    return [];
  }
}

// ─── Context Retrieval ────────────────────────────────────────────
// Retrieves relevant context from the KB for a query.
export async function retrieveContext(query, options = {}) {
  const { category, maxLength = MAX_CONTEXT_LENGTH } = options;

  const results = await searchKB(query, { category, limit: 5 });

  if (results.length === 0) {
    return {
      context: '',
      citations: [],
      hasRelevantContent: false,
    };
  }

  // Build context string
  let context = '';
  const citations = [];

  for (const kb of results) {
    const entry = `\n\n**${kb.title}** (${kb.category || 'general'}):\n${kb.content}`;
    if (context.length + entry.length <= maxLength) {
      context += entry;
      citations.push({
        id: kb.id,
        title: kb.title,
        category: kb.category,
        confidence: kb.confidence,
        source: kb.source,
      });
    }
  }

  return {
    context: context.trim(),
    citations,
    hasRelevantContent: true,
    totalMatches: results.length,
  };
}

// ─── RAG Prompt Builder ───────────────────────────────────────────
// Builds a RAG-enhanced prompt with retrieved context.
export function buildRAGPrompt(query, retrievedContext) {
  const { context, citations } = retrievedContext;

  if (!context) {
    return {
      systemPrompt: '',
      userPrompt: query,
      citations: [],
    };
  }

  const systemPrompt = `You are a helpful assistant for Voice Box, a school communication platform.
You have access to the following knowledge base entries that may be relevant to the user's question:

${context}

Instructions:
- Use the knowledge base entries above to answer the user's question when relevant.
- Always cite your sources when using information from the knowledge base.
- If the knowledge base doesn't contain relevant information, say so and offer alternative help.
- Be accurate, helpful, and professional.`;

  const userPrompt = query;

  return {
    systemPrompt,
    userPrompt,
    citations,
  };
}

// ─── Citation Formatter ───────────────────────────────────────────
// Formats citations for display in AI responses.
export function formatCitations(citations) {
  if (!citations || citations.length === 0) return '';

  const lines = citations.map((cite, i) =>
    `[${i + 1}] ${cite.title} (${cite.category || 'general'}) — Confidence: ${(cite.confidence * 100).toFixed(0)}%`
  );

  return `\n\n**Sources:**\n${lines.join('\n')}`;
}

// ─── Answer with Citations ────────────────────────────────────────
// Appends citations to an AI answer.
export function appendCitations(answer, citations) {
  if (!citations || citations.length === 0) return answer;
  return answer + formatCitations(citations);
}

// ─── KB Analytics ─────────────────────────────────────────────────
// Returns analytics about knowledge base usage.
export async function getKBAnalytics() {
  try {
    const { data: total, error: e1 } = await supabase.from('knowledge_base')
      .select('id', { count: 'exact', head: true });

    const { data: published, error: e2 } = await supabase.from('knowledge_base')
      .select('id', { count: 'exact', head: true });

    const { data: topUsed, error: e3 } = await supabase.from('knowledge_base')
      .select('id, title, category, usage_count')
      .order('usage_count', { ascending: false })
      .limit(10);

    const { data: categories, error: e4 } = await supabase.from('knowledge_base')
      .select('category');

    // Count by category
    const categoryCounts = {};
    if (categories) {
      for (const row of categories) {
        const cat = row.category || 'uncategorized';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
    }

    return {
      total: total?.length || 0,
      published: published?.length || 0,
      topUsed: topUsed || [],
      categories: categoryCounts,
    };
  } catch (err) {
    console.warn('[RAG] Analytics failed:', err.message);
    return { total: 0, published: 0, topUsed: [], categories: {} };
  }
}

export default {
  searchKB,
  retrieveContext,
  buildRAGPrompt,
  formatCitations,
  appendCitations,
  getKBAnalytics,
};
