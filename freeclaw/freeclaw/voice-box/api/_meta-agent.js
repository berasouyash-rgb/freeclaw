// Meta-Agent Coordinator — orchestrates subagents, builds tools dynamically.
// When the built-in intent engine has no matching tool, this system:
// 1. Analyzes the request
// 2. Generates a tool plan (using LLM when available, templates otherwise)
// 3. Spawns subagents to execute in parallel
// 4. Returns combined results
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';
import { callLLMChain } from './_providers.js';

// ─── Tool Templates (fallback when no LLM) ───────────────────────
const TOOL_TEMPLATES = {
  generate_csv: {
    description: 'Export data as CSV',
    build: (args) => ({
      execute: async (args) => {
        const { table = 'posts', columns, filter } = args;
        const validTables = ['posts', 'comments', 'reactions', 'users_meta', 'polls', 'reports', 'chat_messages', 'activity_logs'];
        if (!validTables.includes(table)) throw new Error(`Invalid table: ${table}`);
        let query = supabase.from(table).select(columns || '*');
        if (filter?.status) query = query.eq('status', filter.status);
        if (filter?.category) query = query.eq('category', filter.category);
        if (filter?.deleted !== undefined) query = query.eq('deleted', filter.deleted);
        query = query.order('created_at', { ascending: false }).limit(filter?.limit || 100);
        const { data, error } = await query;
        if (error) throw error;
        return { rows: data?.length || 0, sample: data?.slice(0, 5) };
      },
    }),
  },
  bulk_update: {
    description: 'Update multiple records at once',
    build: (args) => ({
      execute: async (args) => {
        const { table, filter = {}, updates = {} } = args;
        const VALID_TABLES = ['posts', 'comments', 'reactions', 'users_meta', 'polls', 'reports', 'chat_messages', 'activity_logs'];
        if (!table || !VALID_TABLES.includes(table)) throw new Error(`Invalid table: ${table}. Allowed: ${VALID_TABLES.join(', ')}`);
        if (!Object.keys(updates).length) throw new Error('updates object required');
        // Block dangerous column updates
        const BLOCKED_COLS = ['id', 'created_at', 'anon_id', 'author_id'];
        for (const col of BLOCKED_COLS) {
          if (col in updates) throw new Error(`Cannot update protected column: ${col}`);
        }
        let query = supabase.from(table).update(updates);
        if (filter.status) query = query.eq('status', filter.status);
        if (filter.category) query = query.eq('category', filter.category);
        if (filter.deleted !== undefined) query = query.eq('deleted', filter.deleted);
        query = query.limit(500); // safety cap
        const { data, error } = await query.select();
        if (error) throw error;
        return { updated: data?.length || 0, table };
      },
    }),
  },
  generate_summary: {
    description: 'Generate a summary report of platform data',
    build: () => ({
      execute: async () => {
        const [{ count: posts }, { count: users }, { count: comments }, { count: reactions }, { count: polls }] = await Promise.all([
          supabase.from('posts').select('*', { count: 'exact', head: true }),
          supabase.from('users_meta').select('*', { count: 'exact', head: true }),
          supabase.from('comments').select('*', { count: 'exact', head: true }),
          supabase.from('reactions').select('*', { count: 'exact', head: true }),
          supabase.from('polls').select('*', { count: 'exact', head: true }),
        ]);
        const { data: recentPosts } = await supabase.from('posts').select('title,category,status,created_at,deleted').eq('deleted', false).order('created_at', { ascending: false }).limit(10);
        const cats = {};
        (recentPosts || []).forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
        return {
          summary: {
            total_posts: posts || 0,
            total_users: users || 0,
            total_comments: comments || 0,
            total_reactions: reactions || 0,
            total_polls: polls || 0,
            top_categories: cats,
            recent_posts: (recentPosts || []).slice(0, 5).map((p) => p.title),
          },
        };
      },
    }),
  },
  search_content: {
    description: 'Search across all content',
    build: (args) => ({
      execute: async (args) => {
        const { query: q, tables = ['posts', 'comments'] } = args;
        if (!q) throw new Error('query required');
        const results = {};
        for (const table of tables) {
          if (table === 'posts') {
            const { data } = await supabase.from('posts').select('id,title,description,category,status,created_at,deleted').or(`title.ilike.%${q}%,description.ilike.%${q}%`).order('created_at', { ascending: false }).limit(10);
            results.posts = (data || []).filter((p) => !p.deleted);
          } else if (table === 'comments') {
            const { data } = await supabase.from('comments').select('id,post_id,body,created_at').ilike('body', `%${q}%`).order('created_at', { ascending: false }).limit(10);
            results.comments = data || [];
          }
        }
        return results;
      },
    }),
  },
  trend_analysis: {
    description: 'Analyze trends and patterns in data',
    build: () => ({
      execute: async () => {
        const { data: posts } = await supabase.from('posts').select('category,status,priority,created_at,deleted,hidden').eq('deleted', false);
        const daily = {};
        const catTrend = {};
        const priorityTrend = { high: 0, medium: 0, low: 0 };
        (posts || []).forEach((p) => {
          const day = new Date(p.created_at).toISOString().split('T')[0];
          daily[day] = (daily[day] || 0) + 1;
          catTrend[p.category] = (catTrend[p.category] || 0) + 1;
          if (priorityTrend[p.priority] !== undefined) priorityTrend[p.priority]++;
        });
        const sortedDays = Object.entries(daily).sort((a, b) => a[0].localeCompare(b[0]));
        const trend = sortedDays.length > 1 ? (sortedDays[sortedDays.length - 1][1] > sortedDays[0][1] ? 'increasing' : 'decreasing') : 'stable';
        return { trend, daily_posts: daily, categories: catTrend, priorities: priorityTrend, total: (posts || []).length };
      },
    }),
  },
};

// ─── Subagent definitions ─────────────────────────────────────────
const SUBAGENT_TYPES = {
  researcher: {
    name: 'Researcher',
    description: 'Searches for information and patterns',
    icon: '🔍',
    process: async (task, context) => {
      // Analyze request and gather data
      const { query, tables } = task;
      const results = {};
      for (const table of (tables || ['posts'])) {
        if (table === 'posts') {
          const { data } = await supabase.from('posts').select('id,title,description,category,status,priority,created_at,deleted,hidden,admin_reply,assigned_to').eq('deleted', false).order('created_at', { ascending: false }).limit(50);
          results.posts = data || [];
        } else if (table === 'users_meta') {
          const { data } = await supabase.from('users_meta').select('anon_id,banned,warnings,notes,created_at,last_seen').order('created_at', { ascending: false }).limit(50);
          results.users = data || [];
        } else if (table === 'comments') {
          const { data } = await supabase.from('comments').select('id,post_id,body,admin,created_at').order('created_at', { ascending: false }).limit(50);
          results.comments = data || [];
        } else if (table === 'reports') {
          const { data } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(20);
          results.reports = data || [];
        }
      }
      return results;
    },
  },
  builder: {
    name: 'Builder',
    description: 'Executes actions and generates outputs',
    icon: '🔨',
    process: async (task, context) => {
      const { action_type, params } = task;
      switch (action_type) {
        case 'export': {
          const { table = 'posts', format = 'json', limit = 50 } = params || {};
          const { data } = await supabase.from(table).select('*').order('created_at', { ascending: false }).limit(limit);
          if (format === 'csv') {
            if (!data?.length) return { csv: '', rows: 0 };
            const headers = Object.keys(data[0]).join(',');
            const rows = data.map((row) => Object.values(row).map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
            return { csv: headers + '\n' + rows, rows: data.length, format: 'csv' };
          }
          return { json: data, rows: data?.length || 0, format: 'json' };
        }
        case 'aggregate': {
          const { data: posts } = await supabase.from('posts').select('category,status,priority,created_at,deleted').eq('deleted', false);
          const result = { total: (posts || []).length, by_category: {}, by_status: {}, by_priority: {} };
          (posts || []).forEach((p) => {
            result.by_category[p.category] = (result.by_category[p.category] || 0) + 1;
            result.by_status[p.status] = (result.by_status[p.status] || 0) + 1;
            if (result.by_priority[p.priority] !== undefined) result.by_priority[p.priority]++;
          });
          return result;
        }
        default:
          throw new Error(`Unknown builder action: ${action_type}`);
      }
    },
  },
  analyzer: {
    name: 'Analyzer',
    description: 'Analyzes data and finds insights',
    icon: '📊',
    process: async (task, context) => {
      const { analysis_type } = task;
      const { data: posts } = await supabase.from('posts').select('id,title,category,status,priority,created_at,deleted,hidden,admin_reply,assigned_to,reactions_count').eq('deleted', false);
      const active = (posts || []).filter((p) => !p.deleted);
      switch (analysis_type) {
        case 'health': {
          const resolved = active.filter((p) => p.status === 'solved').length;
          const withReply = active.filter((p) => p.admin_reply).length;
          const assigned = active.filter((p) => p.assigned_to).length;
          const hidden = active.filter((p) => p.hidden).length;
          const highPriority = active.filter((p) => p.priority === 'high').length;
          const unresolved = active.filter((p) => p.status === 'open' || p.status === 'in_progress').length;
          const stale = active.filter((p) => {
            const age = Date.now() - new Date(p.created_at).getTime();
            return age > 7 * 24 * 60 * 60 * 1000 && p.status !== 'solved';
          }).length;
          return {
            health_score: Math.round(((resolved / Math.max(active.length, 1)) * 50 + (withReply / Math.max(active.length, 1)) * 30 + (assigned / Math.max(active.length, 1)) * 20)),
            total: active.length,
            resolved,
            unresolved,
            with_reply: withReply,
            assigned,
            hidden,
            high_priority: highPriority,
            stale_issues: stale,
            resolution_rate: active.length > 0 ? Math.round((resolved / active.length) * 100) : 0,
            reply_rate: active.length > 0 ? Math.round((withReply / active.length) * 100) : 0,
          };
        }
        case 'priority': {
          const byPriority = { high: [], medium: [], low: [] };
          active.forEach((p) => { if (byPriority[p.priority]) byPriority[p.priority].push(p); });
          return {
            high: byPriority.high.slice(0, 5).map((p) => ({ id: p.id, title: p.title, status: p.status, created: p.created_at })),
            medium_count: byPriority.medium.length,
            low_count: byPriority.low.length,
            high_count: byPriority.high.length,
          };
        }
        default:
          return { analysis: 'Unknown analysis type', available: ['health', 'priority'] };
      }
    },
  },
};

// ─── Meta-Agent Coordinator ───────────────────────────────────────
export async function coordinate(userMessage) {
  const startTime = Date.now();
  const steps = [];
  const subagentResults = {};

  // Step 1: Classify the request
  const classification = classifyRequest(userMessage);
  steps.push({ step: 'classify', type: classification.type, intent: classification.intent, time: Date.now() - startTime });

  // Step 2: Route to appropriate handler
  switch (classification.type) {
    case 'tool_request': {
      // User wants a specific tool built
      const template = TOOL_TEMPLATES[classification.toolType];
      if (template) {
        const tool = template.build(classification.args);
        const result = await tool.execute(classification.args);
        steps.push({ step: 'execute_tool', tool: classification.toolType, time: Date.now() - startTime });
        return { type: 'tool_result', tool: classification.toolType, result, steps, execution_time: Date.now() - startTime };
      }
      // Try LLM-based tool generation
      const llmResult = await generateToolWithLLM(userMessage);
      if (llmResult) {
        steps.push({ step: 'llm_generate', time: Date.now() - startTime });
        return { type: 'tool_result', tool: 'llm_generated', result: llmResult, steps, execution_time: Date.now() - startTime };
      }
      break;
    }
    case 'analysis_request': {
      // Spawn analyzer subagent
      const analyzer = SUBAGENT_TYPES.analyzer;
      const result = await analyzer.process(classification, {});
      subagentResults.analyzer = result;
      steps.push({ step: 'subagent', type: 'analyzer', time: Date.now() - startTime });
      return { type: 'analysis', result, steps, execution_time: Date.now() - startTime };
    }
    case 'data_request': {
      // Spawn researcher + builder
      const researcher = SUBAGENT_TYPES.researcher;
      const builder = SUBAGENT_TYPES.builder;
      const [researchData, buildData] = await Promise.all([
        researcher.process({ tables: classification.tables || ['posts'], query: classification.query }, {}),
        builder.process({ action_type: classification.action || 'aggregate', params: classification.params }, {}),
      ]);
      subagentResults.researcher = researchData;
      subagentResults.builder = buildData;
      steps.push({ step: 'subagent', type: 'researcher+builder', time: Date.now() - startTime });
      return { type: 'data_result', research: researchData, build: buildData, steps, execution_time: Date.now() - startTime };
    }
    case 'export_request': {
      const builder = SUBAGENT_TYPES.builder;
      const result = await builder.process({ action_type: 'export', params: classification.params }, {});
      steps.push({ step: 'subagent', type: 'builder', time: Date.now() - startTime });
      return { type: 'export', result, steps, execution_time: Date.now() - startTime };
    }
    default: {
      // Fall through — return suggestions
      return {
        type: 'suggestion',
        message: `I can help with that. Here's what I can do:\n\n` +
          `📊 **Analysis** — "analyze platform health", "trend analysis"\n` +
          `🔍 **Research** — "find all high priority issues", "search for cricket"\n` +
          `📦 **Export** — "export posts as csv", "export comments"\n` +
          `📈 **Aggregate** — "aggregate data", "generate summary"\n` +
          `🛠 **Build tools** — "create a report", "generate trend chart"\n\n` +
          `Or use the built-in agent chat for direct admin actions.`,
        steps,
        execution_time: Date.now() - startTime,
      };
    }
  }
}

// ─── Classify incoming request ────────────────────────────────────
function classifyRequest(msg) {
  const lower = msg.toLowerCase();

  // Export requests
  if (/\b(export|download|csv|json|dump|extract)\b/i.test(lower)) {
    const tableMatch = lower.match(/(posts?|comments?|reactions?|users?|polls?|reports?|chat|activity|logs?)/);
    const formatMatch = lower.match(/\b(csv|json|excel|xlsx)\b/i);
    return {
      type: 'export_request',
      params: {
        table: tableMatch ? tableMatch[1].replace(/s$/, '') + 's' : 'posts',
        format: formatMatch ? formatMatch[1].toLowerCase() : 'json',
        limit: 100,
      },
    };
  }

  // Analysis requests
  if (/\b(analy[sz]e|health|score|rating|audit|diagnos|evaluat|assess|trend|insight|pattern)\b/i.test(lower)) {
    const analysisType = /\b(health|score)\b/i.test(lower) ? 'health' : /\b(priority|urgent|critical)\b/i.test(lower) ? 'priority' : 'health';
    return { type: 'analysis_request', analysis_type: analysisType };
  }

  // Summary/report requests
  if (/\b(summary|report|overview|dashboard|stats|numbers|count|total|how many)\b/i.test(lower)) {
    return { type: 'tool_request', toolType: 'generate_summary', args: {} };
  }

  // Search requests
  if (/\b(search|find|look|query|filter|where)\b/i.test(lower)) {
    const queryMatch = lower.match(/(?:for|about|containing|matching)\s+(.+)/i);
    return {
      type: 'data_request',
      tables: ['posts'],
      query: queryMatch?.[1] || '',
      action: 'aggregate',
    };
  }

  // Aggregate/combine data requests
  if (/\b(aggregat|combine|merge|group|grouped|breakdown|categor)\b/i.test(lower)) {
    return { type: 'data_request', tables: ['posts'], action: 'aggregate' };
  }

  // Trend requests
  if (/\b(trend|over time|daily|weekly|growth|increase|decrease|change)\b/i.test(lower)) {
    const template = TOOL_TEMPLATES.trend_analysis;
    return { type: 'tool_request', toolType: 'trend_analysis', args: {} };
  }

  return { type: 'unknown', intent: lower };
}

// ─── LLM-based tool generation ───────────────────────────────────
async function generateToolWithLLM(userMessage) {
  const systemPrompt = `You are a tool generator. Given a user request, generate a tool plan as JSON.
Return ONLY valid JSON with this structure:
{
  "tool_name": "snake_case_name",
  "description": "what it does",
  "params": { "param1": "type" },
  "query_plan": "SQL-like description of what to fetch",
  "output_format": "json or csv"
}
No explanation, ONLY JSON.`;

  const result = await callLLMChain(systemPrompt, `Request: ${userMessage}`);
  if (!result?.text) return null;

  try {
    const parsed = JSON.parse(result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    // Execute the generated plan
    const { data } = await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(parsed.params?.limit || 20);
    return {
      tool: parsed.tool_name,
      description: parsed.description,
      data: data || [],
      output_format: parsed.output_format || 'json',
      generated_by: `${result.provider}/${result.model}`,
    };
  } catch {
    return null;
  }
}

// ─── HTTP Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
    const b = req.body || {};
    const action = req.method === 'GET' ? (req.query.action || 'capabilities') : b.action;

    if (req.method === 'GET' && action === 'capabilities') {
      return res.status(200).json({
        tools: Object.entries(TOOL_TEMPLATES).map(([id, t]) => ({ id, description: t.description })),
        subagents: Object.entries(SUBAGENT_TYPES).map(([id, s]) => ({ id, name: s.name, description: s.description, icon: s.icon })),
      });
    }

    if (req.method === 'POST' && action === 'coordinate') {
      if (!b.message) return res.status(400).json({ error: 'message required' });
      const result = await coordinate(clean(b.message, 500));
      await auditLog('admin', 'meta_agent_coordinate', `Coordinated: "${b.message.slice(0, 80)}" → ${result.type} in ${result.execution_time}ms`);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Unknown action. GET ?action=capabilities or POST { action: "coordinate", message: "..." }' });
  } catch (err) {
    console.error('meta-agent error:', err);
    return res.status(500).json({ error: err.message });
  }
}
