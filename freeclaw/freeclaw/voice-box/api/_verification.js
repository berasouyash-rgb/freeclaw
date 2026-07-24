// ─── Verification Engine ──────────────────────────────────────────
// Verifies AI responses against the knowledge base before delivery.
// Provides confidence scoring, citation tracking, and fact-checking.
//
// Architecture:
//   1. Knowledge Base Lookup: find relevant KB entries for a query
//   2. Answer Verification: compare AI answer against KB content
//   3. Confidence Scoring: score based on KB match, source quality, recency
//   4. Citation Tracking: extract and link sources from KB
//   5. Uncertainty Detection: flag answers with low confidence
//   6. Before/After Evidence: collect resource state changes for audit trail
//
// Usage:
//   import { verifyAnswer, scoreConfidence, detectUncertainty, collectBeforeAfter } from './_verification.js';
//   const verification = await verifyAnswer(query, aiAnswer, { agentId: 'general' });
//   const evidence = await collectBeforeAfter('posts', postId, 'update_post_status', params, actionFn);

import supabase from './_db-client.js';

// ─── Constants ────────────────────────────────────────────────────
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.5;
const LOW_CONFIDENCE_THRESHOLD = 0.3;
const MAX_KB_RESULTS = 10;
const MIN_CONTENT_LENGTH = 20;

// ─── Knowledge Base Search ────────────────────────────────────────
// Searches the knowledge base for relevant entries using text matching.
// Falls back to simple ILIKE when pgvector isn't available.
async function searchKnowledgeBase(query, options = {}) {
  const { category, limit = MAX_KB_RESULTS } = options;

  try {
    // Try full-text search first
    let q = supabase.from('knowledge_base')
      .select('id, title, content, category, tags, confidence, source, last_verified')
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .order('confidence', { ascending: false })
      .limit(limit);

    if (category) {
      q = q.eq('category', category);
    }

    const { data, error } = await q;
    if (error) {
      console.warn('[VERIFICATION] KB search error:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('[VERIFICATION] KB search failed:', err.message);
    return [];
  }
}

// ─── Content Similarity ───────────────────────────────────────────
// Simple word-overlap similarity between two texts.
// Returns a score between 0 and 1.
function computeSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;

  const normalize = (t) => t.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));

  if (words1.size === 0 || words2.size === 0) return 0;

  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }

  // Jaccard-like coefficient
  const union = new Set([...words1, ...words2]).size;
  return union > 0 ? overlap / union : 0;
}

// ─── Key Phrase Extraction ────────────────────────────────────────
// Extracts key phrases from text for matching.
function extractKeyPhrases(text) {
  if (!text) return [];

  // Remove common stop words
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
    'who', 'whom', 'when', 'where', 'why', 'how', 'not', 'no', 'nor',
    'so', 'too', 'very', 'just', 'about', 'above', 'after', 'again',
    'all', 'also', 'any', 'because', 'before', 'between', 'both',
    'each', 'few', 'more', 'most', 'other', 'some', 'such', 'than',
    'into', 'through', 'during', 'out', 'up', 'down', 'off', 'over',
    'under', 'further', 'then', 'once', 'here', 'there', 'only', 'own',
    'same', 's', 't', 'don', 'now',
  ]);

  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Extract 2-grams and 3-grams as key phrases
  const phrases = [];
  for (let i = 0; i < words.length; i++) {
    phrases.push(words[i]);
    if (i < words.length - 1) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }
    if (i < words.length - 2) {
      phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }

  return phrases;
}

// ─── Confidence Scoring ───────────────────────────────────────────
// Scores confidence based on multiple factors:
//   - KB match quality (similarity)
//   - Source reliability (confidence field)
//   - Recency (last_verified)
//   - Usage frequency (usage_count)
function scoreConfidence(query, aiAnswer, kbResults) {
  if (!kbResults || kbResults.length === 0) {
    return {
      score: 0.2,
      factors: {
        kbMatch: 0,
        sourceReliability: 0,
        recency: 0,
        usageFrequency: 0,
      },
      level: 'low',
    };
  }

  // Find best matching KB entry
  let bestMatch = 0;
  let bestSourceConfidence = 0;
  let bestRecency = 0;
  let totalUsage = 0;

  for (const kb of kbResults) {
    const similarity = computeSimilarity(aiAnswer, kb.content);
    if (similarity > bestMatch) bestMatch = similarity;
    if (kb.confidence > bestSourceConfidence) bestSourceConfidence = kb.confidence;

    // Recency score (newer = better)
    if (kb.last_verified) {
      const daysSinceVerified = (Date.now() - new Date(kb.last_verified).getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - (daysSinceVerified / 365)); // Decay over 1 year
      if (recencyScore > bestRecency) bestRecency = recencyScore;
    }

    totalUsage += kb.usage_count || 0;
  }

  // Usage frequency score (logarithmic)
  const usageScore = Math.min(1, Math.log10(totalUsage + 1) / 3);

  // Weighted average
  const score = (
    bestMatch * 0.4 +
    bestSourceConfidence * 0.3 +
    bestRecency * 0.2 +
    usageScore * 0.1
  );

  // Determine level
  let level = 'low';
  if (score >= HIGH_CONFIDENCE_THRESHOLD) level = 'high';
  else if (score >= MEDIUM_CONFIDENCE_THRESHOLD) level = 'medium';
  else if (score >= LOW_CONFIDENCE_THRESHOLD) level = 'low';

  return {
    score: Math.round(score * 100) / 100,
    factors: {
      kbMatch: Math.round(bestMatch * 100) / 100,
      sourceReliability: Math.round(bestSourceConfidence * 100) / 100,
      recency: Math.round(bestRecency * 100) / 100,
      usageFrequency: Math.round(usageScore * 100) / 100,
    },
    level,
  };
}

// ─── Citation Extraction ──────────────────────────────────────────
// Extracts citations from KB results for the AI answer.
function extractCitations(kbResults) {
  return kbResults
    .filter(kb => kb.content && kb.content.length > MIN_CONTENT_LENGTH)
    .map(kb => ({
      id: kb.id,
      title: kb.title,
      category: kb.category,
      confidence: kb.confidence,
      source: kb.source,
      excerpt: kb.content.slice(0, 200) + (kb.content.length > 200 ? '...' : ''),
    }));
}

// ─── Uncertainty Detection ────────────────────────────────────────
// Detects if the AI answer contains uncertainty markers.
function detectUncertainty(aiAnswer) {
  const markers = [
    /\bI'm not sure\b/i,
    /\bI don't know\b/i,
    /\bI'm uncertain\b/i,
    /\bI think maybe\b/i,
    /\bpossibly\b/i,
    /\bperhaps\b/i,
    /\bit depends\b/i,
    /\bI'm not certain\b/i,
    /\bI can't confirm\b/i,
    /\bI'm not confident\b/i,
    /\bthis might be wrong\b/i,
    /\bI'm guessing\b/i,
    /\bI'm not 100%\b/i,
    /\bcorrect me if I'm wrong\b/i,
    /\bas far as I know\b/i,
    /\bto the best of my knowledge\b/i,
    /\bI believe so\b/i,
    /\bprobably\b/i,
    /\balmost certainly\b/i,
    /\bI would say\b/i,
    /\bI assume\b/i,
    /\bsome sources suggest\b/i,
    /\bit appears that\b/i,
    /\bI'm not entirely sure\b/i,
  ];

  const found = [];
  for (const marker of markers) {
    const match = aiAnswer.match(marker);
    if (match) {
      found.push(match[0]);
    }
  }

  return {
    uncertain: found.length > 0,
    markers: found,
    count: found.length,
  };
}

// ─── Main Verification Function ───────────────────────────────────
export async function verifyAnswer(query, aiAnswer, options = {}) {
  const { agentId = 'general', category } = options;
  const startTime = Date.now();

  // 1. Search knowledge base
  const kbResults = await searchKnowledgeBase(query, { category });

  // 2. Score confidence
  const confidence = scoreConfidence(query, aiAnswer, kbResults);

  // 3. Extract citations
  const citations = extractCitations(kbResults);

  // 4. Detect uncertainty
  const uncertainty = detectUncertainty(aiAnswer);

  // 5. Determine verification status
  let status = 'verified';
  if (confidence.level === 'low') status = 'unverified';
  else if (confidence.level === 'medium') status = 'partially_verified';
  if (uncertainty.uncertain) status = 'uncertain';

  // 6. Build verification result
  const result = {
    status,
    confidence,
    citations,
    uncertainty,
    kbMatches: kbResults.length,
    latency_ms: Date.now() - startTime,
  };

  // 7. Log verification (non-critical)
  try {
    await supabase.from('audit_logs').insert({
      action: 'verification.complete',
      resource_type: 'ai_answer',
      resource_id: agentId,
      details: {
        query: query.slice(0, 200),
        status: result.status,
        confidence: result.confidence.score,
        citations: result.citations.length,
      },
    });
  } catch { /* non-critical */ }

  return result;
}

// ─── Batch Verification ───────────────────────────────────────────
export async function verifyAnswers(queries, options = {}) {
  const results = [];
  for (const { query, answer } of queries) {
    const verification = await verifyAnswer(query, answer, options);
    results.push({ query, answer, verification });
  }
  return results;
}

// ─── Verification Summary ─────────────────────────────────────────
export function buildVerificationSummary(verification) {
  const { status, confidence, citations, uncertainty } = verification;

  let summary = `**Verification: ${status.toUpperCase()}**\n`;
  summary += `Confidence: ${(confidence.score * 100).toFixed(0)}% (${confidence.level})\n`;

  if (citations.length > 0) {
    summary += `Sources: ${citations.length} found\n`;
    for (const cite of citations.slice(0, 3)) {
      summary += `  - ${cite.title} (${cite.category})\n`;
    }
  }

  if (uncertainty.uncertain) {
    summary += `Uncertainty markers: ${uncertainty.count}\n`;
  }

  return summary;
}

// ─── Before/After Evidence Collection ─────────────────────────────
// Collects before-state of affected resources, executes action, then
// collects after-state for complete audit trail.
// Used by tool execution to provide verifiable evidence.

/**
 * Collect before-state of a resource before modification.
 * @param {string} table - Supabase table name
 * @param {string} resourceId - Row ID to snapshot
 * @returns {object} Before-state snapshot or null if not found
 */
export async function collectBefore(table, resourceId) {
  if (!table || !resourceId) return null;

  try {
    const { data, error } = await supabase.from(table)
      .select('*')
      .eq('id', resourceId)
      .single();

    if (error) {
      console.warn(`[VERIFICATION] collectBefore failed for ${table}/${resourceId}:`, error.message);
      return null;
    }

    return {
      table,
      resourceId,
      snapshot: data,
      collectedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[VERIFICATION] collectBefore error:`, err.message);
    return null;
  }
}

/**
 * Collect after-state of a resource after modification.
 * Returns a diff between before and after states.
 * @param {string} table - Supabase table table
 * @param {string} resourceId - Row ID to snapshot
 * @param {object} beforeState - The before-state from collectBefore
 * @returns {object} After-state with diff
 */
export async function collectAfter(table, resourceId, beforeState) {
  if (!table || !resourceId) return null;

  try {
    const { data, error } = await supabase.from(table)
      .select('*')
      .eq('id', resourceId)
      .single();

    if (error) {
      console.warn(`[VERIFICATION] collectAfter failed for ${table}/${resourceId}:`, error.message);
      return null;
    }

    // Compute diff
    const diff = computeDiff(beforeState?.snapshot || {}, data);

    return {
      table,
      resourceId,
      snapshot: data,
      diff,
      collectedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[VERIFICATION] collectAfter error:`, err.message);
    return null;
  }
}

/**
 * Compute a simple diff between two objects.
 * Returns changed fields with before/after values.
 */
export function computeDiff(before, after) {
  if (!before || !after) return { changed: false, fields: [] };

  const changes = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const beforeVal = before[key];
    const afterVal = after[key];

    // Skip internal fields and timestamps
    if (key === 'updated_at' || key === 'created_at' || key === '__proto__') continue;

    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      changes.push({
        field: key,
        before: beforeVal,
        after: afterVal,
      });
    }
  }

  return {
    changed: changes.length > 0,
    fields: changes,
    changeCount: changes.length,
  };
}

/**
 * Collect before/after evidence for a tool execution.
 * Complete audit trail: before-state -> action -> after-state -> diff.
 * @param {string} table - Table being modified
 * @param {string} resourceId - Row being modified
 * @param {string} toolName - Tool performing the modification
 * @param {object} params - Tool parameters
 * @param {Function} executeAction - The actual modification function
 * @returns {object} Evidence with before, after, diff, and action details
 */
export async function collectBeforeAfter(table, resourceId, toolName, params, executeAction) {
  const startTime = Date.now();

  // 1. Collect before state
  const before = await collectBefore(table, resourceId);

  // 2. Execute the action
  let actionResult = null;
  let actionError = null;
  try {
    actionResult = await executeAction();
  } catch (err) {
    actionError = err.message || 'Action execution failed';
  }

  // 3. Collect after state (only if action succeeded)
  let after = null;
  let diff = null;
  if (!actionError && resourceId) {
    after = await collectAfter(table, resourceId, before);
    diff = after?.diff || null;
  }

  // 4. Build evidence object
  return {
    toolName,
    table,
    resourceId,
    before: before?.snapshot || null,
    after: after?.snapshot || null,
    diff,
    actionResult,
    actionError,
    params,
    executionTime: Date.now() - startTime,
    timestamp: new Date().toISOString(),
    hasChanges: diff?.changed || false,
    changeCount: diff?.changeCount || 0,
  };
}

// ─── Export for Tests ─────────────────────────────────────────────
export {
  computeSimilarity,
  extractKeyPhrases,
  searchKnowledgeBase,
};

export default {
  verifyAnswer,
  verifyAnswers,
  scoreConfidence,
  detectUncertainty,
  extractCitations,
  buildVerificationSummary,
  computeSimilarity,
  extractKeyPhrases,
  searchKnowledgeBase,
  collectBefore,
  collectAfter,
  collectBeforeAfter,
  computeDiff,
};
