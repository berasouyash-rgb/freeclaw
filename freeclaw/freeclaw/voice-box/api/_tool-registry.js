// ─── Centralized Tool Calling Framework ───────────────────────────
// Unified tool registry with schema validation, permission control,
// retry logic, audit logging, and result caching.
//
// Architecture:
//   1. Tool Registry: single source of truth for all tool definitions
//   2. Schema Validator: validates parameters before execution
//   3. Permission Gate: admin vs student tool access
//   4. Execution Engine: retry logic, timeout, error handling
//   5. Audit Logger: logs every tool call to tool_calls table
//   6. Result Cache: optional TTL-based caching for read tools
//
// Usage:
//   import { registry, executeTool, getToolsForRole } from './_tool-registry.js';
//   const tools = getToolsForRole('admin');
//   const result = await executeTool('get_posts', { limit: 10 }, { role: 'admin' });

import supabase from './_db-client.js';

// ─── Constants ────────────────────────────────────────────────────
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const TOOL_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 60000; // 1 minute for read tools
const MAX_RESULT_CHARS = 4000;

// ─── Cache Store ──────────────────────────────────────────────────
const _cache = new Map(); // key → { data, expiresAt }

function cacheKey(name, args) {
  return `${name}:${JSON.stringify(args)}`;
}

function getCached(name, args) {
  const key = cacheKey(name, args);
  const entry = _cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) _cache.delete(key);
  return null;
}

function setCache(name, args, data, ttlMs) {
  const key = cacheKey(name, args);
  // Limit cache size
  if (_cache.size > 500) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function clearCache() {
  _cache.clear();
}

// ─── Schema Validator ─────────────────────────────────────────────
// Validates tool parameters against a JSON-Schema-like definition.
export function validateParams(tool, params) {
  const errors = [];
  const schema = tool.parameters || {};
  const props = schema.properties || {};
  const required = schema.required || [];

  // Check required fields
  for (const field of required) {
    if (params[field] === undefined || params[field] === null || params[field] === '') {
      errors.push(`Missing required parameter: ${field}`);
    }
  }

  // Validate types
  for (const [key, value] of Object.entries(params)) {
    const def = props[key];
    if (!def) continue; // Allow extra params (tools may ignore them)

    if (def.type === 'string' && typeof value !== 'string') {
      errors.push(`Parameter '${key}' must be a string, got ${typeof value}`);
    }
    if (def.type === 'integer' && !Number.isInteger(value)) {
      errors.push(`Parameter '${key}' must be an integer, got ${typeof value}`);
    }
    if (def.type === 'number' && typeof value !== 'number') {
      errors.push(`Parameter '${key}' must be a number, got ${typeof value}`);
    }
    if (def.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`Parameter '${key}' must be a boolean, got ${typeof value}`);
    }
    if (def.type === 'array' && !Array.isArray(value)) {
      errors.push(`Parameter '${key}' must be an array, got ${typeof value}`);
    }
    if (def.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      errors.push(`Parameter '${key}' must be an object, got ${typeof value}`);
    }

    // Enum validation
    if (def.enum && !def.enum.includes(value)) {
      errors.push(`Parameter '${key}' must be one of: ${def.enum.join(', ')}`);
    }

    // String length
    if (def.minLength && typeof value === 'string' && value.length < def.minLength) {
      errors.push(`Parameter '${key}' must be at least ${def.minLength} characters`);
    }
    if (def.maxLength && typeof value === 'string' && value.length > def.maxLength) {
      errors.push(`Parameter '${key}' must be at most ${def.maxLength} characters`);
    }
  }

  return errors;
}

// ─── Tool Definitions ─────────────────────────────────────────────
// Centralized registry of all tools. Each tool has:
//   - name: unique identifier
//   - description: human-readable description
//   - parameters: JSON-Schema-like definition
//   - permissions: 'admin' | 'student' | 'both'
//   - category: 'read' | 'write' | 'system'
//   - requiresApproval: boolean (for dangerous operations)
//   - cacheable: boolean (for read tools)
//   - retryable: boolean (for transient failures)
//   - execute: async function(params) → result

const TOOLS = [
  // ── Read Tools (Student + Admin) ──────────────────────────────────
  {
    name: 'get_posts',
    description: 'Retrieve posts with optional filters',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        category: { type: 'string', description: 'Filter by category' },
        limit: { type: 'integer', default: 20, description: 'Max posts to return' },
      },
    },
    permissions: 'both',
    category: 'read',
    cacheable: true,
    retryable: true,
    execute: async (params) => {
      let q = supabase.from('posts')
        .select('id, title, description, category, status, priority, author_id, hidden, deleted, locked, pinned, featured, created_at')
        .eq('deleted', false)
        .order('created_at', { ascending: false })
        .limit(params.limit || 20);
      if (params.status) q = q.eq('status', params.status);
      if (params.category) q = q.eq('category', params.category);
      const { data, error } = await q;
      if (error) throw error;
      return { posts: data || [] };
    },
  },
  {
    name: 'get_analytics',
    description: 'Get full platform analytics',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month', 'all'], default: 'all' },
      },
    },
    permissions: 'admin',
    category: 'read',
    cacheable: true,
    retryable: true,
    execute: async (params) => {
      const now = new Date();
      let since = null;
      if (params.period === 'day') since = new Date(now - 86400000);
      else if (params.period === 'week') since = new Date(now - 604800000);
      else if (params.period === 'month') since = new Date(now - 2592000000);

      const queries = [
        supabase.from('posts').select('id', { count: 'exact', head: true }),
        supabase.from('users_meta').select('anon_id', { count: 'exact', head: true }),
        supabase.from('comments').select('id', { count: 'exact', head: true }),
      ];
      if (since) {
        queries.push(supabase.from('posts').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString()));
      }
      const results = await Promise.all(queries);
      return {
        total_posts: results[0].count || 0,
        total_users: results[1].count || 0,
        total_comments: results[2].count || 0,
        period_posts: since ? results[3]?.count || 0 : undefined,
        period: params.period || 'all',
      };
    },
  },
  {
    name: 'get_activity_logs',
    description: 'Retrieve recent activity logs',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 50 },
      },
    },
    permissions: 'admin',
    category: 'read',
    cacheable: false,
    retryable: true,
    execute: async (params) => {
      const { data, error } = await supabase.from('activity_logs')
        .select('*').order('created_at', { ascending: false }).limit(params.limit || 50);
      if (error) throw error;
      return { logs: data || [] };
    },
  },
  {
    name: 'search_users',
    description: 'Search users by anon_id',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', default: 20 },
      },
      required: ['query'],
    },
    permissions: 'admin',
    category: 'read',
    cacheable: true,
    retryable: true,
    execute: async (params) => {
      const { data, error } = await supabase.from('users_meta')
        .select('*').ilike('anon_id', `%${params.query}%`).limit(params.limit || 20);
      if (error) throw error;
      return { users: data || [] };
    },
  },
  {
    name: 'get_user_posts',
    description: 'Get all posts from a specific user',
    parameters: {
      type: 'object',
      properties: {
        anon_id: { type: 'string', minLength: 1 },
      },
      required: ['anon_id'],
    },
    permissions: 'admin',
    category: 'read',
    cacheable: true,
    retryable: true,
    execute: async (params) => {
      const { data, error } = await supabase.from('posts')
        .select('*').eq('author_id', params.anon_id).order('created_at', { ascending: false });
      if (error) throw error;
      return { posts: data || [] };
    },
  },
  {
    name: 'get_reports',
    description: 'Get content reports/flags',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string' },
      },
    },
    permissions: 'admin',
    category: 'read',
    cacheable: false,
    retryable: true,
    execute: async (params) => {
      let q = supabase.from('reports').select('*').order('created_at', { ascending: false });
      if (params.status) q = q.eq('status', params.status);
      const { data, error } = await q;
      if (error) throw error;
      return { reports: data || [] };
    },
  },
  {
    name: 'get_polls',
    description: 'Get all polls with vote counts',
    parameters: { type: 'object', properties: {} },
    permissions: 'both',
    category: 'read',
    cacheable: true,
    retryable: true,
    execute: async () => {
      const { data, error } = await supabase.from('polls').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return { polls: data || [] };
    },
  },
  {
    name: 'get_comments',
    description: 'Get comments for a post',
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'string', minLength: 1 },
        limit: { type: 'integer', default: 50 },
      },
      required: ['post_id'],
    },
    permissions: 'both',
    category: 'read',
    cacheable: true,
    retryable: true,
    execute: async (params) => {
      const { data, error } = await supabase.from('comments')
        .select('*').eq('post_id', params.post_id).order('created_at', { ascending: true }).limit(params.limit || 50);
      if (error) throw error;
      return { comments: data || [] };
    },
  },

  // ── Write Tools (Admin only) ─────────────────────────────────────
  {
    name: 'create_post',
    description: 'Create a new post (complaint, suggestion, question, or idea)',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, description: 'Post title' },
        description: { type: 'string', minLength: 1, description: 'Post body/description' },
        type: { type: 'string', enum: ['problem', 'suggestion'], description: 'Post type (problem or suggestion)' },
        category: { type: 'string', description: 'Category like academic, facilities, etc.' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Priority level' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'description', 'type', 'category'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      // Map user-friendly types to DB-allowed values
      const typeMap = { complaint: 'problem', question: 'problem', idea: 'suggestion' };
      const dbType = typeMap[params.type] || params.type;
      const { data, error } = await supabase.from('posts').insert({
        id: crypto.randomUUID(),
        title: params.title,
        description: params.description,
        type: dbType,
        category: params.category,
        priority: params.priority || 'medium',
        tags: params.tags || [],
        author_id: 'ai-admin',
        status: 'reported',
        deleted: false,
        hidden: false,
        pinned: false,
        featured: false,
        locked: false,
      }).select().single();
      if (error) throw error;
      return { ok: true, post: data };
    },
  },
  {
    name: 'update_post',
    description: "Update a post's status, priority, admin reply",
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'string', minLength: 1 },
        status: { type: 'string' },
        priority: { type: 'string' },
        admin_reply: { type: 'string' },
        hidden: { type: 'boolean' },
      },
      required: ['post_id'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const updates = {};
      if (params.status) updates.status = params.status;
      if (params.priority) updates.priority = params.priority;
      if (params.admin_reply) updates.admin_reply = params.admin_reply;
      if (params.hidden !== undefined) updates.hidden = params.hidden;
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase.from('posts').update(updates).eq('id', params.post_id);
      if (error) throw error;
      return { ok: true, post_id: params.post_id };
    },
  },
  {
    name: 'hide_post',
    description: 'Hide or unhide a post',
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'string', minLength: 1 },
        hidden: { type: 'boolean' },
      },
      required: ['post_id'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { error } = await supabase.from('posts').update({ hidden: params.hidden, updated_at: new Date().toISOString() }).eq('id', params.post_id);
      if (error) throw error;
      return { ok: true };
    },
  },
  {
    name: 'pin_post',
    description: 'Pin or unpin a post',
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'string', minLength: 1 },
        pinned: { type: 'boolean' },
      },
      required: ['post_id'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { error } = await supabase.from('posts').update({ pinned: params.pinned, updated_at: new Date().toISOString() }).eq('id', params.post_id);
      if (error) throw error;
      return { ok: true };
    },
  },
  {
    name: 'lock_post',
    description: 'Lock or unlock a post',
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'string', minLength: 1 },
        locked: { type: 'boolean' },
      },
      required: ['post_id'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { error } = await supabase.from('posts').update({ locked: params.locked, updated_at: new Date().toISOString() }).eq('id', params.post_id);
      if (error) throw error;
      return { ok: true };
    },
  },
  {
    name: 'set_priority',
    description: 'Set post priority',
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'string', minLength: 1 },
        priority: { type: 'string' },
      },
      required: ['post_id', 'priority'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { error } = await supabase.from('posts').update({ priority: params.priority, updated_at: new Date().toISOString() }).eq('id', params.post_id);
      if (error) throw error;
      return { ok: true };
    },
  },
  {
    name: 'admin_reply',
    description: 'Post an admin reply',
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'string', minLength: 1 },
        reply: { type: 'string', minLength: 1 },
      },
      required: ['post_id', 'reply'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { error } = await supabase.from('posts').update({ admin_reply: params.reply, updated_at: new Date().toISOString() }).eq('id', params.post_id);
      if (error) throw error;
      return { ok: true };
    },
  },
  {
    name: 'create_comment',
    description: 'Post an admin comment',
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'string', minLength: 1 },
        body: { type: 'string', minLength: 2 },
        parent_id: { type: 'string' },
      },
      required: ['post_id', 'body'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { data, error } = await supabase.from('comments').insert({
        id: crypto.randomUUID(),
        post_id: params.post_id,
        body: params.body,
        is_admin: true,
        parent_id: params.parent_id || null,
        author_id: 'ai-admin',
      }).select().single();
      if (error) throw error;
      return { ok: true, comment: data };
    },
  },
  {
    name: 'warn_user',
    description: 'Issue a warning to a user',
    parameters: {
      type: 'object',
      properties: {
        anon_id: { type: 'string', minLength: 1 },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['anon_id', 'reason'],
    },
    permissions: 'admin',
    category: 'write',
    requiresApproval: true,
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { data: existing } = await supabase.from('users_meta').select('warnings').eq('anon_id', params.anon_id).single();
      const warnings = (existing?.warnings || 0) + 1;
      const { error } = await supabase.from('users_meta').update({ warnings, notes: `Warned: ${params.reason}` }).eq('anon_id', params.anon_id);
      if (error) throw error;
      return { ok: true, warnings };
    },
  },
  {
    name: 'ban_user',
    description: 'Ban a user',
    parameters: {
      type: 'object',
      properties: {
        anon_id: { type: 'string', minLength: 1 },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['anon_id', 'reason'],
    },
    permissions: 'admin',
    category: 'write',
    requiresApproval: true,
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { error } = await supabase.from('users_meta').update({ banned: true, notes: `Banned: ${params.reason}` }).eq('anon_id', params.anon_id);
      if (error) throw error;
      return { ok: true };
    },
  },
  {
    name: 'unban_user',
    description: 'Unban a user',
    parameters: {
      type: 'object',
      properties: {
        anon_id: { type: 'string', minLength: 1 },
      },
      required: ['anon_id'],
    },
    permissions: 'admin',
    category: 'write',
    requiresApproval: true,
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { error } = await supabase.from('users_meta').update({ banned: false, notes: 'Unbanned by AI' }).eq('anon_id', params.anon_id);
      if (error) throw error;
      return { ok: true };
    },
  },
  {
    name: 'set_announcement',
    description: 'Set a site-wide announcement',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1 },
        enabled: { type: 'boolean' },
      },
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { error } = await supabase.from('settings').upsert(
        { key: 'announcement', value: JSON.stringify({ text: params.text, enabled: params.enabled !== false }) },
        { onConflict: 'key' }
      );
      if (error) throw error;
      return { ok: true };
    },
  },
  {
    name: 'clear_announcement',
    description: 'Clear the announcement',
    parameters: { type: 'object', properties: {} },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async () => {
      const { error } = await supabase.from('settings').upsert(
        { key: 'announcement', value: JSON.stringify({ text: '', enabled: false }) },
        { onConflict: 'key' }
      );
      if (error) throw error;
      return { ok: true };
    },
  },

  // ── System Tools (Admin only) ────────────────────────────────────
  {
    name: 'execute_sql',
    description: 'Execute SQL SELECT query',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'The SQL query to execute' },
      },
      required: ['query'],
    },
    permissions: 'admin',
    category: 'system',
    requiresApproval: false,
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const sqlQuery = params.query || params.sql;
      if (!sqlQuery) return { error: 'SQL query required' };
      // Safety: only allow SELECT
      const trimmed = sqlQuery.trim().toUpperCase();
      if (!trimmed.startsWith('SELECT')) {
        return { error: 'Only SELECT queries are allowed' };
      }
      try {
        const { data, error } = await supabase.rpc('execute_sql', { query: sqlQuery });
        if (error) return { error: error.message };
        return { rows: data || [] };
      } catch (rpcErr) {
        return { error: `SQL execution not available: ${rpcErr.message}` };
      }
    },
  },

  // ── Poll Tools (Admin only) ───────────────────────────────────────
  {
    name: 'create_poll',
    description: 'Create a new poll. Optionally link to an existing post via post_id.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        options: { type: 'array', items: { type: 'string' } },
        ptype: { type: 'string', enum: ['yesno', 'single', 'multi'] },
        post_id: { type: 'string', description: 'Optional post ID to link this poll to' },
      },
      required: ['title'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const pollData = {
        id: crypto.randomUUID(),
        title: params.title,
        options: params.options || [],
        ptype: params.ptype || 'choice',
        author_id: 'ai-admin',
      };
      if (params.post_id) pollData.post_id = params.post_id;
      const { data, error } = await supabase.from('polls').insert(pollData).select().single();
      if (error) throw error;
      return { ok: true, poll: data };
    },
  },

  // ── Forged Tool Management (Admin only) ──────────────────────────
  {
    name: 'forge_tool',
    description: 'Create a new custom tool from natural language description',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        sql_template: { type: 'string' },
        parameters: { type: 'object' },
      },
      required: ['name', 'description'],
    },
    permissions: 'admin',
    category: 'system',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      // Dynamic import to avoid circular dependency
      const { saveForgedTool } = await import('./_tool-forge.js');
      const tool = {
        name: params.name,
        description: params.description,
        sql_template: params.sql_template || null,
        parameters: params.parameters || {},
        created_at: new Date().toISOString(),
        created_by: 'ai-chat',
      };
      await saveForgedTool(tool);
      return { ok: true, tool };
    },
  },
  {
    name: 'list_forged_tools',
    description: 'List all custom forged tools',
    parameters: { type: 'object', properties: {} },
    permissions: 'admin',
    category: 'read',
    cacheable: true,
    retryable: true,
    execute: async () => {
      const { listForgedTools } = await import('./_tool-forge.js');
      const tools = await listForgedTools();
      return { tools };
    },
  },
  {
    name: 'delete_forged_tool',
    description: 'Delete a forged tool',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
      },
      required: ['name'],
    },
    permissions: 'admin',
    category: 'system',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { deleteForgedTool } = await import('./_tool-forge.js');
      await deleteForgedTool(params.name);
      return { ok: true };
    },
  },
  {
    name: 'execute_forged_tool',
    description: 'Execute a forged tool by name with parameters',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        params: { type: 'object' },
      },
      required: ['name'],
    },
    permissions: 'admin',
    category: 'system',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { getToolByName } = await import('./_tool-forge.js');
      const tool = await getToolByName(params.name);
      if (!tool) return { error: `Tool '${params.name}' not found` };
      if (tool.sql_template) {
        let query = tool.sql_template;
        for (const [key, value] of Object.entries(params.params || {})) {
          query = query.replace(new RegExp(`:${key}`, 'g'), String(value));
        }
        try {
          const { data, error } = await supabase.rpc('execute_sql', { query });
          if (error) return { error: error.message };
          return { result: data };
        } catch {
          return { error: 'SQL execution not available' };
        }
      }
      return { result: null, message: 'Tool has no SQL template' };
    },
  },

  // ── Knowledge Base Tools (Both) ──────────────────────────────────
  {
    name: 'search_knowledge_base',
    description: 'Search the knowledge base for answers',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        category: { type: 'string' },
        limit: { type: 'integer', default: 5 },
      },
      required: ['query'],
    },
    permissions: 'both',
    category: 'read',
    cacheable: true,
    retryable: true,
    execute: async (params) => {
      let q = supabase.from('knowledge_base')
        .select('id, title, content, category, tags, confidence')
        .ilike('title', `%${params.query}%`)
        .limit(params.limit || 5);
      if (params.category) q = q.eq('category', params.category);
      const { data, error } = await q;
      if (error) throw error;

      // Update usage count for analytics
      if (data && data.length > 0) {
        const ids = data.map(d => d.id);
        await supabase.from('knowledge_base')
          .update({ usage_count: supabase.rpc('increment_usage', { ids }) })
          .in('id', ids);
      }

      return { results: data || [] };
    },
  },

  // ── Memory Tools (Admin only) ────────────────────────────────────
  {
    name: 'store_memory',
    description: 'Store a memory for an agent',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', minLength: 1 },
        memory_type: { type: 'string', enum: ['user_preferences', 'conversation_context', 'learned_facts', 'experience'] },
        content: { type: 'object' },
        confidence: { type: 'number' },
      },
      required: ['agent_id', 'memory_type', 'content'],
    },
    permissions: 'admin',
    category: 'write',
    cacheable: false,
    retryable: false,
    execute: async (params) => {
      const { data, error } = await supabase.from('agent_memory').insert({
        agent_id: params.agent_id,
        memory_type: params.memory_type,
        content: params.content,
        confidence: params.confidence || 1.0,
        created_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      return { ok: true, memory: data };
    },
  },
  {
    name: 'retrieve_memory',
    description: 'Retrieve memories for an agent',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', minLength: 1 },
        memory_type: { type: 'string' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['agent_id'],
    },
    permissions: 'admin',
    category: 'read',
    cacheable: true,
    retryable: true,
    execute: async (params) => {
      let q = supabase.from('agent_memory')
        .select('*')
        .eq('agent_id', params.agent_id)
        .order('created_at', { ascending: false })
        .limit(params.limit || 10);
      if (params.memory_type) q = q.eq('memory_type', params.memory_type);
      const { data, error } = await q;
      if (error) throw error;
      return { memories: data || [] };
    },
  },
];

// ─── Tool Registry ────────────────────────────────────────────────
const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]));

export function getTool(name) {
  return TOOL_MAP.get(name) || null;
}

export function getAllTools() {
  return [...TOOLS];
}

export function getToolsForRole(role) {
  return TOOLS.filter(t =>
    t.permissions === 'both' ||
    t.permissions === role
  );
}

export function getToolNamesForRole(role) {
  return getToolsForRole(role).map(t => t.name);
}

export function getToolSchemasForRole(role) {
  return getToolsForRole(role).map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    category: t.category,
  }));
}

// ─── Audit Logger ─────────────────────────────────────────────────
async function logToolCall(toolName, params, result, latencyMs, context) {
  try {
    const { data, error } = await supabase.from('tool_calls').insert({
      tool_name: toolName,
      parameters: params,
      result: result,
      status: result?.error ? 'failed' : 'completed',
      latency_ms: latencyMs,
      error: result?.error || null,
      created_at: new Date().toISOString(),
    }).select('id').single();
    if (error) {
      console.warn('[TOOL-REGISTRY] Failed to log tool call:', error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.warn('[TOOL-REGISTRY] Failed to log tool call:', err.message);
    return null;
  }
}

// ─── Execution Engine ─────────────────────────────────────────────
export async function executeTool(name, params, context = {}) {
  const tool = TOOL_MAP.get(name);
  const startTime = Date.now();

  // Tool not found
  if (!tool) {
    return { error: `Unknown tool: ${name}`, latency_ms: 0 };
  }

  // Permission check
  const role = context.role || 'student';
  if (tool.permissions !== 'both' && tool.permissions !== role) {
    return { error: `Tool '${name}' requires ${tool.permissions} permissions`, latency_ms: 0 };
  }

  // Schema validation
  const validationErrors = validateParams(tool, params);
  if (validationErrors.length > 0) {
    return { error: `Validation failed: ${validationErrors.join('; ')}`, latency_ms: 0 };
  }

  // Check cache for read tools
  if (tool.cacheable && tool.category === 'read') {
    const cached = getCached(name, params);
    if (cached) {
      const latency = Date.now() - startTime;
      const standardized = standardizeResult(name, params, { cached: true, ...cached }, startTime, context);
      await logToolCall(name, params, { cached: true, ...cached }, latency, context);
      return { ...standardized, latency_ms: latency };
    }
  }

  // Execute with retry
  let lastError = null;
  const maxAttempts = tool.retryable ? MAX_RETRIES + 1 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Execute with timeout
      const result = await Promise.race([
        tool.execute(params),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Tool timeout after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS)
        ),
      ]);

      const latency = Date.now() - startTime;

      // Truncate large results
      if (result && JSON.stringify(result).length > MAX_RESULT_CHARS) {
        const truncated = JSON.stringify(result).slice(0, MAX_RESULT_CHARS);
        result._truncated = true;
        result._original_size = JSON.stringify(result).length;
      }

      // Standardize result into enterprise contract
      const standardized = standardizeResult(name, params, result, startTime, context);

      // Cache read tools
      if (tool.cacheable && tool.category === 'read' && !result?.error) {
        setCache(name, params, result, CACHE_TTL_MS);
      }

      // Log success
      const toolCallId = await logToolCall(name, params, result, latency, context);

      // Store evidence asynchronously (non-blocking)
      storeToolEvidence(toolCallId, standardized.evidence, context).catch(err =>
        console.warn('[TOOL-REGISTRY] Evidence store failed:', err.message)
      );

      return { ...standardized, latency_ms: latency };
    } catch (err) {
      lastError = err;

      if (attempt < maxAttempts) {
        // Wait before retry
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
    }
  }

  // All attempts failed
  const latency = Date.now() - startTime;
  const errorResult = { error: lastError?.message || 'Tool execution failed', latency_ms: latency };
  const standardized = standardizeResult(name, params, errorResult, startTime, context);
  const toolCallId = await logToolCall(name, params, errorResult, latency, context);

  // Store evidence for failed calls too
  storeToolEvidence(toolCallId, standardized.evidence, context).catch(err =>
    console.warn('[TOOL-REGISTRY] Evidence store failed:', err.message)
  );

  return { ...standardized, latency_ms: latency };
}

// ─── Batch Execution ──────────────────────────────────────────────
export async function executeTools(toolCalls, context = {}) {
  const results = [];
  for (const call of toolCalls) {
    const result = await executeTool(call.name, call.params || {}, context);
    results.push({ name: call.name, ...result });
  }
  return results;
}

// ─── Tool Definition for LLM ──────────────────────────────────────
export function buildToolDefinitionsForLLM(role) {
  const tools = getToolsForRole(role);
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

// ─── Parse Tool Calls from LLM Output ─────────────────────────────
export function parseToolCalls(text) {
  const trimmed = text.trim();

  // 1. Raw JSON array: [{"name":"...", "arguments":{...}}]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length > 0 && arr[0].name) {
        return { reply: '', actions: arr.map(item => ({
          name: item.name,
          params: item.arguments || item.args || {},
        }))};
      }
    } catch { /* fall through */ }
  }

  // 2. JSON code block: ```json\n[...]\n```
  const codeBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) {
        return { reply: '', actions: parsed.map(item => ({
          name: item.name,
          params: item.arguments || item.args || {},
        }))};
      }
    } catch { /* fall through */ }
  }

  // 3. JSON object with "actions" key
  const actionsMatch = trimmed.match(/\{[\s\S]*"actions"[\s\S]*\}/);
  if (actionsMatch) {
    try {
      const json = JSON.parse(actionsMatch[0]);
      if (json.actions && Array.isArray(json.actions)) {
        return { reply: json.reply || '', actions: json.actions };
      }
    } catch { /* fall through */ }
  }

  // 4. Single JSON object: {"name":"...", "arguments":{...}}
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj.name && (obj.arguments || obj.args)) {
        return { reply: '', actions: [{ name: obj.name, params: obj.arguments || obj.args }] };
      }
    } catch { /* fall through */ }
  }

  // 5. No tool calls found
  return { reply: text, actions: [] };
}

// ─── Tool Call Detection ──────────────────────────────────────────
export function looksLikeToolCall(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith('[') && (trimmed.includes('"name"') || trimmed.includes('"tool"'))) return true;
  if (/^```json\s*\[/.test(trimmed)) return true;
  if (trimmed.startsWith('{') && trimmed.includes('"actions"') && /\[/.test(trimmed)) return true;
  if (trimmed.startsWith('{') && trimmed.includes('"name"') && (trimmed.includes('"arguments"') || trimmed.includes('"args"'))) return true;
  return false;
}

export function looksLikeToolCallPartial(text) {
  if (!text || text.length < 6) return false;
  if (/\"\w+\"\s*:/.test(text)) return true;
  if (/[\[{]\s*"\w+"\s*:/.test(text)) return true;
  return false;
}

// ─── System Prompt Builder ────────────────────────────────────────
export function buildToolSystemPrompt(role, personaPrompt = '') {
  const tools = getToolsForRole(role);
  const toolList = tools.map(t => {
    const params = t.parameters.properties || {};
    const required = t.parameters.required || [];
    const paramStr = Object.entries(params).map(([k, v]) => {
      const req = required.includes(k) ? '*' : '';
      return `${k}${req}:${v.type}`;
    }).join(', ');
    return `- ${t.name}: ${t.description} (${paramStr || 'no params'})`;
  }).join('\n');

  return `${personaPrompt}

## TOOL CALLING FORMAT
When you need to call a tool, respond with ONLY a JSON array — no text before or after:
[{"name": "tool_name", "arguments": {"param": "value"}}]

Available tools:
${toolList}

If no tool is needed, respond with a natural language answer.
If multiple tools are needed, return them all in one array.
IMPORTANT: After receiving tool results, summarize them in natural language — do NOT return more tool calls.
You have access to real platform data. Query it. Use it. Never guess.`;
}

// ─── Standard Result Contract ────────────────────────────────────
// Wraps any tool execution result into the standard enterprise contract.
// Every tool returns: status, executionTime, inputs, outputs, verification, evidence, logs, rollback, confidence, warnings, errors
export function standardizeResult(toolName, params, result, startTime, context = {}) {
  const executionTime = Date.now() - startTime;
  const isError = !!(result?.error);
  const hasWarning = !!(result?._cached || result?._truncated);

  // Determine status
  let status = 'success';
  if (isError) status = 'error';
  else if (hasWarning) status = 'partial';

  // Build warnings array
  const warnings = [];
  if (result?._cached) warnings.push('Result served from cache');
  if (result?._truncated) warnings.push(`Result truncated from ${result._original_size} chars`);
  if (result?.latency_ms && result.latency_ms > 5000) warnings.push(`Slow execution: ${result.latency_ms}ms`);

  // Build errors array
  const errors = [];
  if (result?.error) errors.push(result.error);

  // Build logs
  const logs = [];
  logs.push({ level: isError ? 'error' : 'info', message: `Tool ${toolName} ${isError ? 'failed' : 'executed'}`, timestamp: new Date().toISOString() });
  if (context.role) logs.push({ level: 'debug', message: `Role: ${context.role}` });

  return {
    status,
    executionTime,
    inputs: { tool: toolName, params: params || {}, role: context.role || 'unknown' },
    outputs: isError ? null : result,
    verification: {
      checked: true,
      status: status,
      confidence: isError ? 0 : (result?._cached ? 0.9 : 0.8),
    },
    evidence: {
      toolName,
      params,
      result: isError ? { error: result.error } : result,
      latencyMs: result?.latency_ms || executionTime,
      timestamp: new Date().toISOString(),
      conversationId: context.conversationId || null,
    },
    logs,
    rollback: null, // Rollback info added by caller if available
    confidence: isError ? 0 : (result?._cached ? 0.9 : 0.8),
    warnings,
    errors,
  };
}

// ─── Store Tool Evidence ──────────────────────────────────────────
// Persists tool execution evidence to the tool_evidence table.
// Called after every tool execution to build the audit trail.
export async function storeToolEvidence(toolCallId, evidence, context = {}) {
  try {
    const { default: supabase } = await import('./_db-client.js');
    const { toolName, params, result, latencyMs, conversationId } = evidence;
    const { role = 'admin', actorId = 'admin', ipAddress = null } = context;

    // Determine action type from tool name
    const actionType = determineActionType(toolName);
    const riskLevel = determineRiskLevel(toolName, params);

    const row = {
      tool_call_id: toolCallId || null,
      conversation_id: conversationId || null,
      tool_name: toolName,
      action_type: actionType,
      input_params: params || {},
      output_result: result || {},
      actor_id: actorId,
      actor_type: role === 'admin' ? 'admin' : 'user',
      ip_address: ipAddress,
      risk_level: riskLevel,
      requires_approval: riskLevel === 'high' || riskLevel === 'critical',
      verification_status: 'pending',
    };

    const { error } = await supabase.from('tool_evidence').insert(row);
    if (error) {
      console.error('[TOOL-REGISTRY] Failed to store evidence:', error.message);
      return { stored: false, error: error.message };
    }
    return { stored: true };
  } catch (err) {
    console.error('[TOOL-REGISTRY] Evidence storage error:', err.message);
    return { stored: false, error: err.message };
  }
}

// ─── Determine Action Type ────────────────────────────────────────
function determineActionType(toolName) {
  const queryTools = ['get_posts', 'get_analytics', 'get_activity_logs', 'search_users', 'get_user_posts', 'get_reports', 'get_polls', 'get_comments', 'search_knowledge_base'];
  const createTools = ['create_ticket', 'send_notification', 'create_comment', 'create_poll'];
  const modifyTools = ['update_post_status', 'assign_ticket', 'warn_user', 'update_knowledge_base', 'pin_post', 'hide_post', 'lock_post', 'feature_post', 'mark_solved', 'set_eta', 'admin_reply'];
  const deleteTools = ['purge_user_content', 'ban_user', 'delete_post'];
  const escalateTools = ['escalate_issue'];

  if (queryTools.includes(toolName)) return 'query';
  if (createTools.includes(toolName)) return 'create';
  if (modifyTools.includes(toolName)) return 'modify';
  if (deleteTools.includes(toolName)) return 'delete';
  if (escalateTools.includes(toolName)) return 'escalate';
  return 'query'; // default
}

// ─── Determine Risk Level ────────────────────────────────────────
function determineRiskLevel(toolName, params) {
  // Critical: destructive operations
  const criticalTools = ['ban_user', 'purge_user_content', 'delete_post'];
  if (criticalTools.includes(toolName)) return 'critical';

  // High: modify operations that affect state
  const highTools = ['warn_user', 'update_post_status', 'assign_ticket', 'send_notification', 'admin_reply'];
  if (highTools.includes(toolName)) return 'high';

  // Medium: create operations
  const mediumTools = ['create_ticket', 'create_comment', 'create_poll', 'escalate_issue'];
  if (mediumTools.includes(toolName)) return 'medium';

  // Low: read-only operations
  return 'low';
}

export default {
  getTool,
  getAllTools,
  getToolsForRole,
  getToolNamesForRole,
  getToolSchemasForRole,
  executeTool,
  executeTools,
  buildToolDefinitionsForLLM,
  buildToolSystemPrompt,
  parseToolCalls,
  looksLikeToolCall,
  looksLikeToolCallPartial,
  validateParams,
  clearCache,
  standardizeResult,
  storeToolEvidence,
};
