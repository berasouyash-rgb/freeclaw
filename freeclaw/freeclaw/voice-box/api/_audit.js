// ─── V3 Enterprise Audit Logging ─────────────────────────────────
// Centralized audit trail for all system actions with structured logging,
// retention management, and compliance support.
import supabase from './_db-client.js';

// ─── Log Levels ──────────────────────────────────────────────────
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4,
};

// ─── Core Audit Logger ───────────────────────────────────────────
export async function auditLog({
  action,
  actorType = 'user',
  actorId = null,
  resourceType = null,
  resourceId = null,
  details = {},
  ipAddress = null,
  userAgent = null,
}) {
  try {
    const entry = {
      action,
      actor_type: actorType,
      actor_id: actorId,
      resource_type: resourceType,
      resource_id: resourceId,
      details: typeof details === 'string' ? { message: details } : details,
      ip_address: ipAddress,
      user_agent: userAgent,
      timestamp: new Date().toISOString(),
    };

    const { error } = await supabase.from('audit_logs').insert(entry);
    if (error) {
      console.error('[AUDIT] Failed to write audit log:', error.message);
    }
    return entry;
  } catch (err) {
    console.error('[AUDIT] Audit log error:', err.message);
    return null;
  }
}

// ─── Convenience Loggers ─────────────────────────────────────────
export const log = {
  // User actions
  userAction: (action, userId, details = {}) =>
    auditLog({
      action,
      actorType: 'user',
      actorId: userId,
      resourceType: 'user_action',
      details,
    }),

  // Admin actions
  adminAction: (action, adminId, details = {}) =>
    auditLog({
      action,
      actorType: 'admin',
      actorId: adminId,
      resourceType: 'admin_action',
      details,
    }),

  // AI actions
  aiAction: (action, sessionId, details = {}) =>
    auditLog({
      action,
      actorType: 'ai',
      actorId: sessionId,
      resourceType: 'ai_action',
      details,
    }),

  // Tool execution
  toolExecution: (toolName, input, result, sessionId) =>
    auditLog({
      action: `tool.${toolName}`,
      actorType: 'ai',
      actorId: sessionId,
      resourceType: 'tool_execution',
      details: { tool: toolName, input, result },
    }),

  // Tool approval
  toolApproval: (toolCallId, approverId, action, reason = null) =>
    auditLog({
      action: `tool_approval.${action}`,
      actorType: 'admin',
      actorId: approverId,
      resourceType: 'tool_approval',
      resourceId: toolCallId,
      details: { action, reason },
    }),

  // Conversation events
  conversation: (event, conversationId, details = {}) =>
    auditLog({
      action: `conversation.${event}`,
      actorType: 'system',
      resourceType: 'conversation',
      resourceId: conversationId,
      details,
    }),

  // Authentication events
  auth: (event, userId, details = {}) =>
    auditLog({
      action: `auth.${event}`,
      actorType: 'user',
      actorId: userId,
      resourceType: 'authentication',
      details,
    }),

  // System events
  system: (event, details = {}) =>
    auditLog({
      action: `system.${event}`,
      actorType: 'system',
      resourceType: 'system',
      details,
    }),

  // Errors
  error: (action, error, context = {}) =>
    auditLog({
      action,
      details: { ...context, level: 'ERROR', status: 'error', errorMessage: error.message || String(error) },
    }),

  // Security events
  security: (event, details = {}) =>
    auditLog({
      action: `security.${event}`,
      actorType: 'system',
      resourceType: 'security',
      details: { ...details, level: 'WARN' },
    }),
};

// ─── Query Audit Logs ────────────────────────────────────────────
export async function queryAuditLogs({
  action,
  actorType,
  actorId,
  resourceType,
  resourceId,
  startDate,
  endDate,
  level,
  limit = 100,
  offset = 0,
}) {
  let query = supabase
    .from('audit_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1);

  if (action) query = query.ilike('action', `%${action}%`);
  if (actorType) query = query.eq('actor_type', actorType);
  if (actorId) query = query.eq('actor_id', actorId);
  if (resourceType) query = query.eq('resource_type', resourceType);
  if (resourceId) query = query.eq('resource_id', resourceId);
  if (level) query = query.eq('level', level);
  if (startDate) query = query.gte('timestamp', startDate);
  if (endDate) query = query.lte('timestamp', endDate);

  const { data, error } = await query;
  if (error) {
    console.error('[AUDIT] Query error:', error.message);
    return [];
  }
  return data || [];
}

// ─── Get Audit Statistics ────────────────────────────────────────
export async function getAuditStats(startDate, endDate) {
  const { data, error } = await supabase
    .rpc('get_audit_stats', {
      start_date: startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      end_date: endDate || new Date().toISOString(),
    });

  if (error) {
    console.error('[AUDIT] Stats error:', error.message);
    return null;
  }
  return data;
}

// ─── Retention Management ────────────────────────────────────────
export async function cleanupOldAuditLogs(retentionDays = 90) {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('audit_logs')
    .delete()
    .lt('timestamp', cutoffDate);

  if (error) {
    console.error('[AUDIT] Cleanup error:', error.message);
    return 0;
  }

  log.system('audit_cleanup', { deleted: count, cutoff: cutoffDate });
  return count || 0;
}

// ─── Export for API endpoints ────────────────────────────────────
export default {
  auditLog,
  log,
  queryAuditLogs,
  getAuditStats,
  cleanupOldAuditLogs,
  LOG_LEVELS,
};
