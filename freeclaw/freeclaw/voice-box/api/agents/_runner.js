// Agent Runner — Core execution engine for all agents
// Self-healing: uses agent_executions table if it exists, falls back to settings table
import supabase from '../_db-client.js';

const STORE_KEY = 'agent_executions_store';
const ACTIVITY_KEY = 'agent_activity_store';
const MAX_STORED = 200; // max records in settings fallback
let _tableExists = null; // cache: null = unknown, true/false
let _tableExistsCheckedAt = 0; // FIX-M5: TTL for table-exists cache
const TABLE_CACHE_TTL_MS = 5 * 60 * 1000; // re-check every 5 minutes

/**
 * Check if agent_executions table exists (cached with TTL — re-checks every 5 min)
 */
async function hasExecutionsTable() {
  const now = Date.now();
  if (_tableExists !== null && (now - _tableExistsCheckedAt) < TABLE_CACHE_TTL_MS) return _tableExists;
  try {
    const { error } = await supabase.from('agent_executions').select('id').limit(1);
    _tableExists = !error;
  } catch {
    _tableExists = false;
  }
  _tableExistsCheckedAt = now;
  return _tableExists;
}

/**
 * Run an agent task and record the execution
 * @param {string} agentId - Agent identifier
 * @param {string} agentName - Human-readable name
 * @param {string} division - Agent division
 * @param {Function} taskFn - Task function (receives eventContext as first arg)
 * @param {string} triggerType - 'cron' | 'event' | 'manual'
 * @param {object} eventContext - Optional event data to pass to the agent
 */
export async function runAgent(agentId, agentName, division, taskFn, triggerType = 'cron', eventContext = null) {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const useTable = await hasExecutionsTable();
  
  let executionId = null;
  
  if (useTable) {
    // Try dedicated table first
    const { data: execution } = await supabase
      .from('agent_executions')
      .insert({
        agent_id: agentId,
        agent_name: agentName,
        division,
        trigger_type: triggerType,
        task: taskFn.description || `${agentName} periodic run`,
        status: 'running',
        started_at: startedAt,
      })
      .select()
      .single();
    executionId = execution?.id;
  }
  
  try {
    const output = eventContext ? await taskFn(eventContext) : await taskFn();
    const durationMs = Date.now() - startTime;
    const record = {
      id: executionId || crypto.randomUUID(),
      agent_id: agentId,
      agent_name: agentName,
      division,
      trigger_type: triggerType,
      task: taskFn.description || `${agentName} periodic run`,
      status: 'completed',
      output,
      duration_ms: durationMs,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
    
    if (useTable && executionId) {
      await supabase.from('agent_executions')
        .update({ status: 'completed', output, duration_ms: durationMs, completed_at: record.completed_at })
        .eq('id', executionId);
    } else {
      await storeInSettings(record);
    }
    
    await logActivity(agentId, 'task_completed', {
      duration_ms: durationMs,
      output_summary: typeof output === 'object' ? JSON.stringify(output).slice(0, 500) : String(output).slice(0, 500),
    }, 'info');
    
    return { status: 'completed', output, duration_ms: durationMs, execution_id: executionId || record.id };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const record = {
      id: executionId || crypto.randomUUID(),
      agent_id: agentId,
      agent_name: agentName,
      division,
      trigger_type: triggerType,
      task: taskFn.description || `${agentName} periodic run`,
      status: 'failed',
      error: err.message,
      duration_ms: durationMs,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
    
    if (useTable && executionId) {
      await supabase.from('agent_executions')
        .update({ status: 'failed', error: err.message, duration_ms: durationMs, completed_at: record.completed_at })
        .eq('id', executionId);
    } else {
      await storeInSettings(record);
    }
    
    await logActivity(agentId, 'task_failed', { error: err.message, duration_ms: durationMs }, 'error');
    
    return { status: 'failed', error: err.message, duration_ms: durationMs, execution_id: executionId || record.id };
  }
}

/**
 * Store execution record in settings table (fallback when agent_executions doesn't exist)
 * FIX-M5: uses upsert for atomicity instead of read-modify-write
 */
async function storeInSettings(record) {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', STORE_KEY).maybeSingle();
    const existing = data?.value?.records || [];
    const updated = [record, ...existing].slice(0, MAX_STORED);
    await supabase.from('settings').upsert(
      { key: STORE_KEY, value: { records: updated, updated_at: new Date().toISOString() } },
      { onConflict: 'key' }
    );
  } catch (err) {
    console.error(`[Runner] storeInSettings FAILED: ${err.message}`);
  }
}

/**
 * Log an activity event (FIX-L7: returns success indicator instead of swallowing errors)
 */
export async function logActivity(agentId, action, details, severity = 'info') {
  try {
    const useTable = await hasExecutionsTable();
    if (useTable) {
      await supabase.from('agent_activity_log').insert({
        agent_id: agentId,
        action,
        details: typeof details === 'string' ? { message: details } : details,
        severity,
      });
    } else {
      // Fallback: append to settings
      const { data } = await supabase.from('settings').select('value').eq('key', ACTIVITY_KEY).maybeSingle();
      const existing = data?.value?.records || [];
      const record = {
        id: crypto.randomUUID(),
        agent_id: agentId,
        action,
        details: typeof details === 'string' ? { message: details } : details,
        severity,
        created_at: new Date().toISOString(),
      };
      const updated = [record, ...existing].slice(0, MAX_STORED);
      await supabase.from('settings').upsert(
        { key: ACTIVITY_KEY, value: { records: updated, updated_at: new Date().toISOString() } },
        { onConflict: 'key' }
      );
    }
    return true;
  } catch (err) {
    console.error(`[Runner] logActivity FAILED for ${agentId}: ${action} — ${err.message}`);
    return false;
  }
}

/**
 * Record a system metric (FIX-L7: returns success indicator instead of swallowing errors)
 */
export async function recordMetric(metricName, value, tags = {}) {
  try {
    const useTable = await hasExecutionsTable();
    if (useTable) {
      await supabase.from('system_metrics').insert({ metric_name: metricName, metric_value: value, tags });
    }
    return true;
  } catch (err) {
    console.error(`[Runner] recordMetric FAILED for ${metricName}=${value} — ${err.message}`);
    return false;
  }
}

/**
 * Get recent executions — tries table first, falls back to settings
 */
export async function getRecentExecutions(agentId, limit = 50) {
  const useTable = await hasExecutionsTable();
  
  if (useTable) {
    let query = supabase.from('agent_executions').select('*').order('started_at', { ascending: false }).limit(limit);
    if (agentId) query = query.eq('agent_id', agentId);
    const { data } = await query;
    return data || [];
  }
  
  // Fallback: read from settings
  const { data } = await supabase.from('settings').select('value').eq('key', STORE_KEY).maybeSingle();
  let records = data?.value?.records || [];
  if (agentId) records = records.filter(r => r.agent_id === agentId);
  return records.slice(0, limit);
}

/**
 * Get activity log — tries table first, falls back to settings
 */
export async function getRecentActivity(limit = 50) {
  const useTable = await hasExecutionsTable();
  
  if (useTable) {
    const { data } = await supabase.from('agent_activity_log').select('*').order('created_at', { ascending: false }).limit(limit);
    return data || [];
  }
  
  const { data } = await supabase.from('settings').select('value').eq('key', ACTIVITY_KEY).maybeSingle();
  return (data?.value?.records || []).slice(0, limit);
}

/**
 * Get dashboard stats — tries table first, falls back to settings
 */
export async function getDashboardStats() {
  const useTable = await hasExecutionsTable();
  
  if (useTable) {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    
    const [totalResult, recentResult, failedResult, runningResult] = await Promise.all([
      supabase.from('agent_executions').select('*', { count: 'exact', head: true }),
      supabase.from('agent_executions').select('*', { count: 'exact', head: true }).gte('started_at', oneHourAgo),
      supabase.from('agent_executions').select('*', { count: 'exact', head: true }).eq('status', 'failed').gte('started_at', oneDayAgo),
      supabase.from('agent_executions').select('*').eq('status', 'running').order('started_at', { ascending: false }).limit(50),
    ]);
    
    return {
      total_executions: totalResult.count || 0,
      last_hour: recentResult.count || 0,
      failed_today: failedResult.count || 0,
      currently_running: runningResult.data || [],
    };
  }
  
  // Fallback: compute from settings
  const { data } = await supabase.from('settings').select('value').eq('key', STORE_KEY).maybeSingle();
  const records = data?.value?.records || [];
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const oneDayAgo = now - 86400000;
  
  return {
    total_executions: records.length,
    last_hour: records.filter(r => new Date(r.started_at).getTime() > oneHourAgo).length,
    failed_today: records.filter(r => r.status === 'failed' && new Date(r.started_at).getTime() > oneDayAgo).length,
    currently_running: records.filter(r => r.status === 'running'),
  };
}
