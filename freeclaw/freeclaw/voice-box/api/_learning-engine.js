// ═══════════════════════════════════════════════════════════════════
// LEARNING ENGINE — Self-evolving agent intelligence
// ═══════════════════════════════════════════════════════════════════
// 5 subsystems:
//   A. Feedback Loops      — zero-cost, every task
//   B. LLM Reflection      — cost-controlled, failure-triggered
//   C. Knowledge Sharing   — cross-agent within divisions
//   D. Admin Feedback      — human-in-the-loop learning weights
//   E. Self-Modification   — threshold adjust, prompt rewrite, spawn
//
// Tables: agent_learning, agent_insights, agent_knowledge,
//         admin_feedback, agent_config
// ═══════════════════════════════════════════════════════════════════
import supabase from './_db-client.js';
import { callLLMChain } from './_providers.js';

// ─── Constants ───────────────────────────────────────────────────
const REFLECTION_COOLDOWN_MS = 3600000; // 1 hour between reflections per agent
const MAX_FAILURES_BEFORE_REFLECTION = 3;
const KNOWLEDGE_DECAY_DAYS = 30;
const INSIGHT_CONFIDENCE_THRESHOLD = 0.6;
const MAX_INSIGHTS_PER_AGENT = 20;

// In-memory cooldown tracker (resets on cold start — acceptable)
const _reflectionCooldown = new Map(); // agentId → last reflection timestamp

// ═══════════════════════════════════════════════════════════════════
// A. FEEDBACK LOOP ENGINE — Record every task outcome
// ═══════════════════════════════════════════════════════════════════

/**
 * Record the outcome of an agent task. Zero-cost, called on every task.
 * @param {string} agentId
 * @param {string} division
 * @param {string} taskType - e.g. 'content_moderation', 'user_scan', 'security_check'
 * @param {'success'|'failure'|'partial'} outcome
 * @param {object} metrics - { duration_ms, accuracy, confidence, items_processed, error_type }
 */
export async function recordTaskOutcome(agentId, division, taskType, outcome, metrics = {}) {
  try {
    const row = {
      agent_id: agentId,
      division: division || 'unknown',
      task_type: taskType || 'general',
      outcome: outcome || 'success',
      metrics: typeof metrics === 'object' ? metrics : {},
      duration_ms: metrics.duration_ms || 0,
      confidence: metrics.confidence || (outcome === 'success' ? 0.8 : outcome === 'failure' ? 0.3 : 0.5),
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('agent_learning').insert(row);
    if (error) {
      console.error('[learning-engine] recordTaskOutcome insert error:', error.message);
      return false;
    }

    // Auto-trigger LLM reflection if failure threshold reached
    if (outcome === 'failure') {
      await checkReflectionTrigger(agentId, division, taskType);
    }

    return true;
  } catch (err) {
    console.error('[learning-engine] recordTaskOutcome failed:', err.message);
    return false;
  }
}

/**
 * Batch record multiple task outcomes (for cron runs that process many agents).
 */
export async function recordTaskOutcomes(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return 0;
  let saved = 0;
  for (const o of outcomes) {
    const ok = await recordTaskOutcome(o.agentId, o.division, o.taskType, o.outcome, o.metrics);
    if (ok) saved++;
  }
  return saved;
}

/**
 * Get recent learning records for an agent or division.
 */
export async function getLearningRecords(agentId = null, division = null, limit = 50) {
  try {
    let query = supabase
      .from('agent_learning')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 200));

    if (agentId) query = query.eq('agent_id', agentId);
    if (division) query = query.eq('division', division);

    const { data, error } = await query;
    if (error) { console.error('[learning-engine] getLearningRecords error:', error.message); return []; }
    return data || [];
  } catch { return []; }
}

/**
 * Analyze patterns across learning records — detects declining performance,
 * recurring failures, and strong task types.
 */
export async function analyzePatterns(agentId = null, division = null) {
  const records = await getLearningRecords(agentId, division, 200);
  if (records.length < 5) return { patterns: [], summary: 'Insufficient data for pattern analysis' };

  const patterns = [];

  // Group by task_type
  const byTaskType = {};
  records.forEach(r => {
    if (!byTaskType[r.task_type]) byTaskType[r.task_type] = [];
    byTaskType[r.task_type].push(r);
  });

  for (const [taskType, taskRecords] of Object.entries(byTaskType)) {
    const failures = taskRecords.filter(r => r.outcome === 'failure');
    const successes = taskRecords.filter(r => r.outcome === 'success');
    const failureRate = failures.length / taskRecords.length;

    if (failureRate > 0.5 && failures.length >= 3) {
      patterns.push({
        type: 'high_failure_rate',
        task_type: taskType,
        failure_rate: Math.round(failureRate * 100),
        sample_size: taskRecords.length,
        confidence: Math.min(0.9, 0.5 + (failures.length * 0.05)),
        recommendation: `Agent has ${Math.round(failureRate * 100)}% failure rate on "${taskType}" — consider prompt rewrite or threshold adjustment`,
      });
    }

    if (successes.length >= 5) {
      const avgConfidence = successes.reduce((sum, r) => sum + (r.confidence || 0), 0) / successes.length;
      if (avgConfidence > 0.7) {
        patterns.push({
          type: 'strong_performance',
          task_type: taskType,
          success_rate: Math.round((successes.length / taskRecords.length) * 100),
          avg_confidence: Math.round(avgConfidence * 100) / 100,
          sample_size: taskRecords.length,
          confidence: 0.8,
          recommendation: `Agent excels at "${taskType}" — consider sharing this knowledge with division peers`,
        });
      }
    }
  }

  // Detect declining performance (recent 10 vs previous 10)
  if (records.length >= 20) {
    const recent = records.slice(0, 10);
    const previous = records.slice(10, 20);
    const recentSuccess = recent.filter(r => r.outcome === 'success').length / recent.length;
    const prevSuccess = previous.filter(r => r.outcome === 'success').length / previous.length;

    if (prevSuccess - recentSuccess > 0.2) {
      patterns.push({
        type: 'declining_performance',
        recent_success_rate: Math.round(recentSuccess * 100),
        previous_success_rate: Math.round(prevSuccess * 100),
        decline_pct: Math.round((prevSuccess - recentSuccess) * 100),
        confidence: 0.75,
        recommendation: `Performance dropped ${Math.round((prevSuccess - recentSuccess) * 100)}% — investigate environmental changes or data drift`,
      });
    }
  }

  return {
    patterns,
    summary: patterns.length > 0
      ? `Found ${patterns.length} pattern(s): ${patterns.map(p => p.type).join(', ')}`
      : 'No significant patterns detected',
    analyzed_at: new Date().toISOString(),
    sample_size: records.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// B. LLM REFLECTION SYSTEM — Deep analysis on failures
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if we should trigger an LLM reflection for this agent.
 * Triggers on: 3+ failures on same task type, or cooldown expired + admin request.
 */
async function checkReflectionTrigger(agentId, division, taskType) {
  const cooldownKey = `${agentId}:${taskType}`;
  const lastReflection = _reflectionCooldown.get(cooldownKey) || 0;

  if (Date.now() - lastReflection < REFLECTION_COOLDOWN_MS) return;

  // Count recent failures for this agent + task type
  try {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: recentFailures } = await supabase
      .from('agent_learning')
      .select('id')
      .eq('agent_id', agentId)
      .eq('task_type', taskType)
      .eq('outcome', 'failure')
      .gte('created_at', oneHourAgo);

    if ((recentFailures || []).length >= MAX_FAILURES_BEFORE_REFLECTION) {
      await triggerReflection(agentId, division, 'failure_cluster', taskType);
    }
  } catch (err) {
    console.error('[learning-engine] reflection trigger check failed:', err.message);
  }
}

/**
 * Trigger an LLM reflection session. Analyzes failures and generates actionable insights.
 * Cost-controlled: max 1 per agent per hour, uses lightweight model when possible.
 */
export async function triggerReflection(agentId, division, reason = 'admin_request', context = '') {
  const cooldownKey = `${agentId}:${context || 'global'}`;
  const lastReflection = _reflectionCooldown.get(cooldownKey) || 0;

  if (Date.now() - lastReflection < REFLECTION_COOLDOWN_MS && reason !== 'admin_request') {
    return { triggered: false, reason: 'cooldown' };
  }

  _reflectionCooldown.set(cooldownKey, Date.now());

  try {
    // Gather recent learning data
    const recentRecords = await getLearningRecords(agentId, null, 30);
    const failureRecords = recentRecords.filter(r => r.outcome === 'failure');
    const successRecords = recentRecords.filter(r => r.outcome === 'success');

    if (recentRecords.length < 3) {
      return { triggered: false, reason: 'insufficient_data' };
    }

    // Build LLM prompt
    const systemPrompt = `You are a learning analyst for an AI agent system called Voice Box. Analyze agent performance data and generate actionable insights.

Agent ID: ${agentId}
Division: ${division}
Reflection reason: ${reason}
Context: ${context || 'General review'}

Respond with JSON: { "insights": [{ "type": "string", "description": "string", "confidence": 0-1, "action": "string", "priority": "low|medium|high" }], "summary": "string" }
Only include actionable insights with confidence > 0.5. Max 3 insights.`;

    const dataSummary = JSON.stringify({
      total_tasks: recentRecords.length,
      failures: failureRecords.length,
      successes: successRecords.length,
      failure_tasks: failureRecords.map(r => ({ task: r.task_type, metrics: r.metrics, created: r.created_at })).slice(0, 10),
      success_tasks: successRecords.map(r => ({ task: r.task_type, confidence: r.confidence })).slice(0, 10),
    }).slice(0, 3000);

    const userPrompt = `Agent performance data:\n${dataSummary}\n\nAnalyze and provide insights. Focus on: why failures happen, what the agent does well, and specific improvements.`;

    const llmResult = await callLLMChain(systemPrompt, userPrompt);
    const text = llmResult?.text || (typeof llmResult === 'string' ? llmResult : '');

    let parsed = { insights: [], summary: 'Unable to parse LLM response' };
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = { insights: [], summary: text.slice(0, 500) || 'Non-JSON response' };
    }

    // Filter by confidence threshold
    const validInsights = (parsed.insights || []).filter(i => i.confidence >= INSIGHT_CONFIDENCE_THRESHOLD);

    // Save insights to DB
    for (const insight of validInsights.slice(0, 3)) {
      await supabase.from('agent_insights').insert({
        agent_id: agentId,
        division: division || 'unknown',
        insight_type: insight.type || 'analysis',
        description: insight.description || '',
        confidence: insight.confidence || 0.5,
        action: insight.action || 'none',
        priority: insight.priority || 'medium',
        source: reason,
        context: context || null,
        applied: false,
        created_at: new Date().toISOString(),
      });
    }

    return {
      triggered: true,
      insights_count: validInsights.length,
      insights: validInsights,
      summary: parsed.summary,
      model: llmResult?.model || 'unknown',
      reason,
    };
  } catch (err) {
    console.error('[learning-engine] triggerReflection failed:', err.message);
    return { triggered: false, reason: 'error', error: err.message };
  }
}

/**
 * Get all insights for an agent or division.
 */
export async function getInsights(agentId = null, division = null, limit = 50) {
  try {
    let query = supabase
      .from('agent_insights')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));

    if (agentId) query = query.eq('agent_id', agentId);
    if (division) query = query.eq('division', division);

    const { data, error } = await query;
    if (error) { console.error('[learning-engine] getInsights error:', error.message); return []; }
    return data || [];
  } catch { return []; }
}

/**
 * Apply unapplied insights — updates agent_config with prompt rewrites or threshold changes.
 */
export async function applyInsights(agentId) {
  const insights = await getInsights(agentId);
  const unapplied = insights.filter(i => !i.applied && i.confidence >= 0.7);
  if (unapplied.length === 0) return { applied: 0 };

  let appliedCount = 0;
  for (const insight of unapplied) {
    try {
      if (insight.insight_type === 'prompt_rewrite' && insight.action) {
        await upsertAgentConfig(agentId, 'prompt_override', insight.action, 'insight');
        appliedCount++;
      } else if (insight.insight_type === 'threshold_adjust' && insight.action) {
        // Parse action like "increase_confidence_to_0.8"
        const match = insight.action.match(/(\w+)_to_([\d.]+)/);
        if (match) {
          await upsertAgentConfig(agentId, `threshold_${match[1]}`, parseFloat(match[2]), 'insight');
          appliedCount++;
        }
      }

      // Mark as applied
      await supabase.from('agent_insights').update({ applied: true, applied_at: new Date().toISOString() }).eq('id', insight.id);
    } catch (err) {
      console.error('[learning-engine] Failed to apply insight:', insight.id, err.message);
    }
  }

  return { applied: appliedCount };
}

// ═══════════════════════════════════════════════════════════════════
// C. CROSS-AGENT KNOWLEDGE SHARING — Within divisions
// ═══════════════════════════════════════════════════════════════════

/**
 * Share a pattern/discovery with the division's knowledge base.
 */
export async function sharePattern(agentId, division, pattern) {
  try {
    const row = {
      agent_id: agentId,
      division: division || 'unknown',
      pattern_type: pattern.type || 'discovery',
      description: pattern.description || '',
      confidence: pattern.confidence || 0.5,
      context: pattern.context || {},
      task_type: pattern.task_type || 'general',
      tags: pattern.tags || [],
      share_level: pattern.share_level || 'division', // 'division' | 'platform'
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + KNOWLEDGE_DECAY_DAYS * 86400000).toISOString(),
    };

    const { error } = await supabase.from('agent_knowledge').insert(row);
    if (error) { console.error('[learning-engine] sharePattern error:', error.message); return false; }
    return true;
  } catch (err) {
    console.error('[learning-engine] sharePattern failed:', err.message);
    return false;
  }
}

/**
 * Query knowledge relevant to a task type within a division.
 */
export async function queryKnowledge(division, taskType = null, limit = 20) {
  try {
    let query = supabase
      .from('agent_knowledge')
      .select('*')
      .eq('division', division)
      .gt('expires_at', new Date().toISOString())
      .order('confidence', { ascending: false })
      .limit(Math.min(limit, 50));

    if (taskType) query = query.eq('task_type', taskType);

    const { data, error } = await query;
    if (error) { console.error('[learning-engine] queryKnowledge error:', error.message); return []; }
    return data || [];
  } catch { return []; }
}

/**
 * Decay old knowledge — reduce confidence of old patterns, remove expired ones.
 */
export async function decayOldKnowledge() {
  try {
    // Delete expired knowledge
    const { error: delErr } = await supabase
      .from('agent_knowledge')
      .delete()
      .lt('expires_at', new Date().toISOString());

    // Reduce confidence of old records (older than 14 days)
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data: oldRecords } = await supabase
      .from('agent_knowledge')
      .select('id, confidence')
      .lt('created_at', twoWeeksAgo)
      .gt('confidence', 0.1);

    if (oldRecords && oldRecords.length > 0) {
      for (const record of oldRecords) {
        const newConfidence = Math.max(0.1, record.confidence * 0.9);
        await supabase.from('agent_knowledge').update({ confidence: newConfidence }).eq('id', record.id);
      }
    }

    return { cleaned: true, decayed: (oldRecords || []).length };
  } catch (err) {
    console.error('[learning-engine] decayOldKnowledge failed:', err.message);
    return { cleaned: false };
  }
}

// ═══════════════════════════════════════════════════════════════════
// D. ADMIN FEEDBACK — Human-in-the-loop learning
// ═══════════════════════════════════════════════════════════════════

/**
 * Record admin feedback on an agent or report.
 */
export async function recordAdminFeedback(agentId, reportId, rating, comment = '', adminId = 'admin') {
  try {
    const row = {
      agent_id: agentId,
      report_id: reportId || null,
      rating: typeof rating === 'number' ? rating : (rating === 'thumbs_up' ? 1 : rating === 'thumbs_down' ? -1 : 0),
      rating_label: typeof rating === 'number' ? (rating > 0 ? 'positive' : rating < 0 ? 'negative' : 'neutral') : rating,
      comment: comment || '',
      admin_id: adminId,
      weight: calculateFeedbackWeight(rating),
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('admin_feedback').insert(row);
    if (error) { console.error('[learning-engine] recordAdminFeedback error:', error.message); return false; }

    // Also update agent_learning records with admin influence
    if (reportId) {
      await applyFeedbackToLearning(agentId, row.rating, row.weight);
    }

    return true;
  } catch (err) {
    console.error('[learning-engine] recordAdminFeedback failed:', err.message);
    return false;
  }
}

/**
 * Calculate learning weight from admin feedback.
 * Recent feedback matters more; consistent feedback amplifies.
 */
function calculateFeedbackWeight(rating) {
  const base = typeof rating === 'number' ? Math.abs(rating) : (rating === 'thumbs_up' ? 1 : 0.5);
  return Math.min(2.0, base * 1.0); // max weight 2.0
}

/**
 * Apply admin feedback weight to recent learning records.
 */
async function applyFeedbackToLearning(agentId, rating, weight) {
  try {
    // Get last 10 learning records for this agent
    const { data: records } = await supabase
      .from('agent_learning')
      .select('id, confidence')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!records || records.length === 0) return;

    // Boost or reduce confidence based on feedback
    const adjustment = rating > 0 ? 0.05 * weight : -0.05 * weight;
    for (const record of records) {
      const newConfidence = Math.max(0, Math.min(1, (record.confidence || 0.5) + adjustment));
      await supabase.from('agent_learning').update({ confidence: newConfidence }).eq('id', record.id);
    }
  } catch (err) {
    console.error('[learning-engine] applyFeedbackToLearning failed:', err.message);
  }
}

/**
 * Get admin feedback stats for an agent or all agents.
 */
export async function getFeedbackStats(agentId = null) {
  try {
    let query = supabase.from('admin_feedback').select('*').order('created_at', { ascending: false }).limit(200);
    if (agentId) query = query.eq('agent_id', agentId);

    const { data, error } = await query;
    if (error) { console.error('[learning-engine] getFeedbackStats error:', error.message); return { total: 0, positive: 0, negative: 0, avg_weight: 0 }; }

    const records = data || [];
    const positive = records.filter(r => r.rating > 0).length;
    const negative = records.filter(r => r.rating < 0).length;
    const avgWeight = records.length > 0 ? records.reduce((s, r) => s + (r.weight || 0), 0) / records.length : 0;

    return {
      total: records.length,
      positive,
      negative,
      neutral: records.length - positive - negative,
      avg_weight: Math.round(avgWeight * 100) / 100,
      positive_rate: records.length > 0 ? Math.round((positive / records.length) * 100) : 0,
      recent: records.slice(0, 10),
    };
  } catch { return { total: 0, positive: 0, negative: 0, avg_weight: 0, positive_rate: 0 }; }
}

// ═══════════════════════════════════════════════════════════════════
// E. SELF-MODIFICATION ENGINE — Thresholds, prompts, spawning
// ═══════════════════════════════════════════════════════════════════

/**
 * Upsert an agent configuration entry.
 */
export async function upsertAgentConfig(agentId, key, value, source = 'system') {
  try {
    const { error } = await supabase.from('agent_config').upsert(
      {
        agent_id: agentId,
        config_key: key,
        config_value: value,
        source: source,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'agent_id,config_key' }
    );
    if (error) { console.error('[learning-engine] upsertAgentConfig error:', error.message); return false; }
    return true;
  } catch (err) {
    console.error('[learning-engine] upsertAgentConfig failed:', err.message);
    return false;
  }
}

/**
 * Get all config for an agent.
 */
export async function getAgentConfig(agentId) {
  try {
    const { data, error } = await supabase
      .from('agent_config')
      .select('*')
      .eq('agent_id', agentId)
      .order('updated_at', { ascending: false });

    if (error) { console.error('[learning-engine] getAgentConfig error:', error.message); return {}; }
    const config = {};
    (data || []).forEach(r => { config[r.config_key] = r.config_value; });
    return config;
  } catch { return {}; }
}

/**
 * Adjust an agent's threshold (confidence, success_rate, etc.)
 */
export async function adjustThreshold(agentId, metric, newValue) {
  return upsertAgentConfig(agentId, `threshold_${metric}`, newValue, 'self_modify');
}

/**
 * Rewrite an agent's prompt based on learning insights.
 */
export async function rewritePrompt(agentId, newPrompt) {
  return upsertAgentConfig(agentId, 'prompt_override', newPrompt, 'self_modify');
}

/**
 * Request spawning of a new specialist agent (Level C self-modification).
 * Records the request — admin approval may be needed depending on config.
 */
export async function requestAgentSpawn(division, reason, requiredCapabilities = [], requestedBy = 'system') {
  try {
    const row = {
      agent_id: `spawn-request-${Date.now()}`,
      config_key: 'spawn_request',
      config_value: {
        division,
        reason,
        required_capabilities: requiredCapabilities,
        requested_by: requestedBy,
        status: 'pending',
        requested_at: new Date().toISOString(),
      },
      source: 'self_modify',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('agent_config').insert(row);
    if (error) { console.error('[learning-engine] requestAgentSpawn error:', error.message); return false; }

    return { requested: true, request_id: row.agent_id, division, reason };
  } catch (err) {
    console.error('[learning-engine] requestAgentSpawn failed:', err.message);
    return false;
  }
}

/**
 * Get all pending spawn requests.
 */
export async function getSpawnRequests() {
  try {
    const { data, error } = await supabase
      .from('agent_config')
      .select('*')
      .eq('config_key', 'spawn_request')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return [];
    return (data || []).filter(r => r.config_value?.status === 'pending');
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════════
// AGGREGATE STATS — Learning Dashboard data
// ═══════════════════════════════════════════════════════════════════

/**
 * Get comprehensive learning stats for the admin dashboard.
 */
export async function getLearningStats() {
  try {
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    // Learning records (24h)
    const { data: learning24h } = await supabase
      .from('agent_learning')
      .select('agent_id, division, outcome, confidence, task_type')
      .gte('created_at', oneDayAgo);

    // Insights (7 days)
    const { data: insightsWeek } = await supabase
      .from('agent_insights')
      .select('id, agent_id, insight_type, confidence, applied, priority')
      .gte('created_at', oneWeekAgo);

    // Knowledge base
    const { count: knowledgeCount } = await supabase
      .from('agent_knowledge')
      .select('id', { count: 'exact', head: true })
      .gt('expires_at', new Date().toISOString());

    // Admin feedback
    const { data: feedback24h } = await supabase
      .from('admin_feedback')
      .select('rating, weight')
      .gte('created_at', oneDayAgo);

    // Spawn requests
    const spawnRequests = await getSpawnRequests();

    const learning = learning24h || [];
    const insights = insightsWeek || [];
    const feedback = feedback24h || [];

    return {
      learning: {
        total_24h: learning.length,
        success: learning.filter(r => r.outcome === 'success').length,
        failure: learning.filter(r => r.outcome === 'failure').length,
        partial: learning.filter(r => r.outcome === 'partial').length,
        avg_confidence: learning.length > 0
          ? Math.round(learning.reduce((s, r) => s + (r.confidence || 0), 0) / learning.length * 100) / 100
          : 0,
        by_division: groupBy(learning, 'division'),
        by_task_type: groupBy(learning, 'task_type'),
      },
      insights: {
        total_7d: insights.length,
        applied: insights.filter(i => i.applied).length,
        pending: insights.filter(i => !i.applied).length,
        by_priority: groupBy(insights, 'priority'),
        by_type: groupBy(insights, 'insight_type'),
      },
      knowledge: {
        active_patterns: knowledgeCount || 0,
      },
      feedback: {
        total_24h: feedback.length,
        positive: feedback.filter(f => f.rating > 0).length,
        negative: feedback.filter(f => f.rating < 0).length,
        avg_weight: feedback.length > 0
          ? Math.round(feedback.reduce((s, f) => s + (f.weight || 0), 0) / feedback.length * 100) / 100
          : 0,
      },
      self_modification: {
        pending_spawn_requests: spawnRequests.length,
        spawn_requests: spawnRequests.map(r => r.config_value).slice(0, 5),
      },
      generated_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[learning-engine] getLearningStats failed:', err.message);
    return { learning: {}, insights: {}, knowledge: {}, feedback: {}, self_modification: {}, error: err.message };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function groupBy(arr, key) {
  const result = {};
  arr.forEach(item => {
    const val = item[key] || 'unknown';
    result[val] = (result[val] || 0) + 1;
  });
  return result;
}

// All functions above use inline `export async function` — no re-export block needed.
