// ─── Proactive Suggestion Detection ───────────────────────────────
// Detects stale reports, duplicates, trends, and user patterns.
// Generates actionable suggestions for the admin assistant.
//
// Architecture:
//   1. Stale Report Detection: finds reports open too long without action
//   2. Duplicate Detection: identifies similar posts that may be duplicates
//   3. Trend Detection: spots rising categories or topics
//   4. Pattern Detection: learns from admin behavior patterns
//   5. Suggestion Generation: creates actionable suggestions
//
// Usage:
//   import { detectSuggestions, getStoredSuggestions, dismissSuggestion } from './_proactive.js';
//   const suggestions = await detectSuggestions({ page: 'reports', filters: {} });

import supabase from './_db-client.js';

// ─── Constants ────────────────────────────────────────────────────
const STALE_THRESHOLD_DAYS = 7; // Reports open > 7 days are stale
const DUPLICATE_SIMILARITY_THRESHOLD = 0.7; // 70% word overlap = potential duplicate
const TREND_MIN_POSTS = 5; // Minimum posts in a category to detect trend
const MAX_SUGGESTIONS = 10;

// ─── Stale Report Detection ──────────────────────────────────────
// Finds reports that have been open too long without resolution.
async function detectStaleReports() {
  try {
    const threshold = new Date(Date.now() - STALE_THRESHOLD_DAYS * 86400000).toISOString();

    const { data, error } = await supabase.from('reports')
      .select('id, reason, status, created_at, post_id')
      .in('status', ['pending', 'open'])
      .lt('created_at', threshold)
      .order('created_at', { ascending: true })
      .limit(20);

    if (error) {
      console.warn('[PROACTIVE] Stale report detection failed:', error.message);
      return [];
    }

    return (data || []).map(report => ({
      type: 'stale_report',
      title: `Report ${report.id.slice(0, 8)} has been open for ${Math.floor((Date.now() - new Date(report.created_at).getTime()) / 86400000)} days`,
      description: `Reason: ${report.reason || 'No reason provided'}. Consider reviewing and resolving this report.`,
      targetId: report.id,
      targetType: 'report',
      confidence: 0.9,
      reasoning: `Report has been in '${report.status}' status for more than ${STALE_THRESHOLD_DAYS} days`,
      priority: 'medium',
      suggestedActions: ['review_report', 'resolve_report', 'dismiss_report'],
    }));
  } catch (err) {
    console.warn('[PROACTIVE] Stale report detection error:', err.message);
    return [];
  }
}

// ─── Duplicate Detection ─────────────────────────────────────────
// Identifies posts that may be duplicates based on title/content similarity.
async function detectDuplicates() {
  try {
    // Get recent posts (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: recentPosts, error } = await supabase.from('posts')
      .select('id, title, description, category, status, created_at')
      .eq('deleted', false)
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !recentPosts || recentPosts.length < 2) {
      return [];
    }

    const duplicates = [];

    // Compare each pair
    for (let i = 0; i < recentPosts.length; i++) {
      for (let j = i + 1; j < recentPosts.length; j++) {
        const a = recentPosts[i];
        const b = recentPosts[j];

        // Skip if same category doesn't match (different topics unlikely to be dupes)
        if (a.category !== b.category) continue;

        const similarity = computeSimpleSimilarity(
          `${a.title} ${a.description || ''}`,
          `${b.title} ${b.description || ''}`
        );

        if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
          duplicates.push({
            type: 'duplicate',
            title: `Potential duplicate detected`,
            description: `Posts "${a.title.slice(0, 50)}" and "${b.title.slice(0, 50)}" are ${Math.round(similarity * 100)}% similar`,
            targetId: a.id,
            targetType: 'post',
            relatedId: b.id,
            confidence: similarity,
            reasoning: `Title and content similarity: ${Math.round(similarity * 100)}%`,
            priority: 'low',
            suggestedActions: ['merge_posts', 'dismiss_suggestion'],
          });
        }
      }
    }

    return duplicates.slice(0, 5); // Limit to top 5
  } catch (err) {
    console.warn('[PROACTIVE] Duplicate detection error:', err.message);
    return [];
  }
}

// ─── Trend Detection ─────────────────────────────────────────────
// Spots rising categories or topics in recent posts.
async function detectTrends() {
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    // Count posts this week by category
    const { data: thisWeek, error: err1 } = await supabase.from('posts')
      .select('category')
      .eq('deleted', false)
      .gte('created_at', weekAgo);

    // Count posts last week by category
    const { data: lastWeek, error: err2 } = await supabase.from('posts')
      .select('category')
      .eq('deleted', false)
      .gte('created_at', twoWeeksAgo)
      .lt('created_at', weekAgo);

    if (err1 || err2) return [];

    // Count by category
    const thisWeekCounts = {};
    const lastWeekCounts = {};
    (thisWeek || []).forEach(p => { thisWeekCounts[p.category] = (thisWeekCounts[p.category] || 0) + 1; });
    (lastWeek || []).forEach(p => { lastWeekCounts[p.category] = (lastWeekCounts[p.category] || 0) + 1; });

    const trends = [];

    for (const [category, count] of Object.entries(thisWeekCounts)) {
      const prevCount = lastWeekCounts[category] || 0;
      if (count >= TREND_MIN_POSTS && prevCount > 0) {
        const growth = ((count - prevCount) / prevCount) * 100;
        if (growth >= 50) { // 50%+ growth
          trends.push({
            type: 'trend',
            title: `Rising trend in "${category}"`,
            description: `Posts in "${category}" increased ${Math.round(growth)}% this week (${count} vs ${prevCount} last week)`,
            targetId: null,
            targetType: 'category',
            confidence: 0.7,
            reasoning: `${Math.round(growth)}% week-over-week growth in ${category}`,
            priority: 'medium',
            suggestedActions: ['view_category', 'analyze_trend', 'dismiss_suggestion'],
          });
        }
      }
    }

    return trends.slice(0, 3);
  } catch (err) {
    console.warn('[PROACTIVE] Trend detection error:', err.message);
    return [];
  }
}

// ─── Pattern Detection ───────────────────────────────────────────
// Learns from admin behavior patterns to suggest actions.
async function detectPatterns(adminId) {
  try {
    // Get recent admin actions from audit logs
    const { data: recentActions, error } = await supabase.from('audit_logs')
      .select('action, resource_type, details, created_at')
      .eq('actor_id', adminId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !recentActions || recentActions.length < 3) {
      return [];
    }

    // Analyze patterns
    const actionCounts = {};
    recentActions.forEach(a => {
      actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
    });

    const patterns = [];

    // Pattern: Admin frequently resolves reports → suggest batch resolution
    const resolveCount = (actionCounts['report.resolve'] || 0) + (actionCounts['report.close'] || 0);
    if (resolveCount >= 3) {
      patterns.push({
        type: 'pattern',
        title: 'Batch resolution available',
        description: `You've resolved ${resolveCount} reports recently. Would you like to batch-resolve similar pending reports?`,
        targetId: null,
        targetType: 'reports',
        confidence: 0.8,
        reasoning: `Admin has resolved ${resolveCount} reports in recent sessions`,
        priority: 'low',
        suggestedActions: ['batch_resolve', 'dismiss_suggestion'],
      });
    }

    // Pattern: Admin frequently summarizes → suggest auto-summary
    const summaryCount = actionCounts['ai.summarize'] || 0;
    if (summaryCount >= 2) {
      patterns.push({
        type: 'pattern',
        title: 'Auto-summary available',
        description: `You've generated ${summaryCount} summaries recently. Enable auto-summary for new posts?`,
        targetId: null,
        targetType: 'settings',
        confidence: 0.7,
        reasoning: `Admin has used summarize ${summaryCount} times recently`,
        priority: 'low',
        suggestedActions: ['enable_auto_summary', 'dismiss_suggestion'],
      });
    }

    return patterns.slice(0, 3);
  } catch (err) {
    console.warn('[PROACTIVE] Pattern detection error:', err.message);
    return [];
  }
}

// ─── Main Detection Function ──────────────────────────────────────
// Runs all detection methods and returns combined suggestions.
export async function detectSuggestions(options = {}) {
  const { page = null, filters = {}, adminId = 'admin' } = options;
  const startTime = Date.now();

  // Run all detections in parallel
  const [staleReports, duplicates, trends, patterns] = await Promise.all([
    detectStaleReports(),
    detectDuplicates(),
    detectTrends(),
    detectPatterns(adminId),
  ]);

  // Combine and deduplicate
  const allSuggestions = [...staleReports, ...duplicates, ...trends, ...patterns];

  // Filter by page context if provided
  let filtered = allSuggestions;
  if (page) {
    // Boost relevance for suggestions related to current page
    filtered = allSuggestions.map(s => ({
      ...s,
      relevance: s.targetType === page || (page === 'reports' && s.type === 'stale_report') ? 'high' : 'normal',
    }));
    // Sort: high relevance first
    filtered.sort((a, b) => (a.relevance === 'high' ? -1 : 1));
  }

  // Limit results
  const limited = filtered.slice(0, MAX_SUGGESTIONS);

  // Store suggestions in agent_suggestions table
  for (const suggestion of limited) {
    try {
      await supabase.from('agent_suggestions').upsert({
        kind: suggestion.type,
        target_id: suggestion.targetId || null,
        target_type: suggestion.targetType || 'general',
        title: suggestion.title,
        content: {
          description: suggestion.description,
          relatedId: suggestion.relatedId || null,
          suggestedActions: suggestion.suggestedActions,
          pageContext: page,
          filters,
        },
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
        critical: suggestion.priority === 'high',
        status: 'pending',
      }, { onConflict: 'kind,target_id' });
    } catch { /* non-critical */ }
  }

  const latencyMs = Date.now() - startTime;
  console.log(`[PROACTIVE] Detected ${limited.length} suggestions in ${latencyMs}ms`);

  return {
    suggestions: limited,
    count: limited.length,
    latencyMs,
    detectedAt: new Date().toISOString(),
  };
}

// ─── Get Stored Suggestions ──────────────────────────────────────
// Retrieves previously stored suggestions (for display without re-detection).
export async function getStoredSuggestions(options = {}) {
  const { status = 'pending', limit = 10 } = options;

  try {
    const { data, error } = await supabase.from('agent_suggestions')
      .select('*')
      .eq('status', status)
      .order('confidence', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[PROACTIVE] Get suggestions failed:', error.message);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      type: row.kind,
      title: row.title,
      description: row.content?.description || '',
      targetId: row.target_id,
      targetType: row.target_type,
      confidence: row.confidence,
      reasoning: row.reasoning,
      critical: row.critical,
      status: row.status,
      suggestedActions: row.content?.suggestedActions || [],
      createdAt: row.created_at,
    }));
  } catch (err) {
    console.warn('[PROACTIVE] Get suggestions error:', err.message);
    return [];
  }
}

// ─── Dismiss Suggestion ──────────────────────────────────────────
// Marks a suggestion as dismissed/resolved.
export async function dismissSuggestion(suggestionId, outcome = 'dismissed') {
  if (!suggestionId) return { error: 'Missing suggestion ID' };

  try {
    const { error } = await supabase.from('agent_suggestions')
      .update({
        status: outcome,
        outcome,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (error) {
      return { error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Simple Similarity ───────────────────────────────────────────
function computeSimpleSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  const normalize = (t) => t.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));
  if (words1.size === 0 || words2.size === 0) return 0;
  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }
  const union = new Set([...words1, ...words2]).size;
  return union > 0 ? overlap / union : 0;
}

// ─── HTTP Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Support both GET (query params) and POST (body)
    const params = req.method === 'GET' ? (req.query || {}) : (req.body || {});
    const { action = 'detect' } = params;

    if (action === 'detect') {
      const { page, filters, adminId } = params;
      const result = await detectSuggestions({ page, filters, adminId });
      return res.status(200).json(result);
    }

    if (action === 'list') {
      const { status, limit } = params;
      const suggestions = await getStoredSuggestions({ status, limit });
      return res.status(200).json({ suggestions });
    }

    if (action === 'dismiss') {
      const { id, outcome } = params;
      if (!id) return res.status(400).json({ error: 'Missing suggestion ID' });
      const result = await dismissSuggestion(id, outcome);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Unknown action. Use: detect, list, dismiss' });
  } catch (err) {
    console.error('[PROACTIVE] Handler error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
