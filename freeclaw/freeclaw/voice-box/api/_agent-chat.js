// Admin Agent Chat — natural language interface for managing Voice Box.
// Uses LLM function calling to plan actions; admin approves before execution.
// All actions are audited. Destructive actions require explicit confirmation.
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';
import { callLLMChain } from './_providers.js';

const TOOL_DEFS = [
  { name: 'get_posts', description: 'Retrieve posts with optional filters', parameters: { type: 'object', properties: { status: { type: 'string' }, category: { type: 'string' }, limit: { type: 'integer', default: 20 } } } },
  { name: 'update_post', description: "Update a post's status, priority, or content", parameters: { type: 'object', properties: { post_id: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string' }, admin_reply: { type: 'string' }, hidden: { type: 'boolean' } }, required: ['post_id'] } },
  { name: 'delete_post', description: 'Soft-delete a post', parameters: { type: 'object', properties: { post_id: { type: 'string' }, reason: { type: 'string' } }, required: ['post_id', 'reason'] } },
  { name: 'warn_user', description: 'Issue a warning to an anonymous user', parameters: { type: 'object', properties: { anon_id: { type: 'string' }, reason: { type: 'string' } }, required: ['anon_id', 'reason'] } },
  { name: 'ban_user', description: 'Ban an anonymous user (prevents posting)', parameters: { type: 'object', properties: { anon_id: { type: 'string' }, reason: { type: 'string' } }, required: ['anon_id', 'reason'] } },
  { name: 'get_user_posts', description: 'Get all posts from a specific anonymous user', parameters: { type: 'object', properties: { anon_id: { type: 'string' } }, required: ['anon_id'] } },
  { name: 'create_poll', description: 'Create a new poll', parameters: { type: 'object', properties: { title: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, ptype: { type: 'string', enum: ['yesno', 'choice', 'rating'] } }, required: ['title'] } },
  { name: 'close_poll', description: 'Close a poll to new votes', parameters: { type: 'object', properties: { poll_id: { type: 'integer' } }, required: ['poll_id'] } },
  { name: 'get_analytics', description: 'Get platform analytics', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['day', 'week', 'month', 'all'] } } } },
  { name: 'get_activity_logs', description: 'Retrieve recent activity logs', parameters: { type: 'object', properties: { limit: { type: 'integer', default: 50 } } } },
  { name: 'set_announcement', description: 'Set or clear a site-wide announcement', parameters: { type: 'object', properties: { text: { type: 'string' }, enabled: { type: 'boolean' } } } },
];

const SYSTEM_PROMPT = `You are the Voice Box admin agent. You help school administrators manage their anonymous feedback platform.

CAPABILITIES:
- View, edit, hide, delete posts
- Warn or ban anonymous users
- Create and manage polls
- Generate analytics reports
- View activity logs
- Post announcements

RULES:
1. ALWAYS describe what you want to do before suggesting actions
2. NEVER auto-execute destructive actions (delete, ban)
3. Group related actions together when possible
4. Explain WHY you're recommending each action
5. Be concise — administrators are busy

When you want to perform actions, respond with a JSON block like:
\`\`\`json
{
  "reply": "Brief explanation of what you found and recommend",
  "actions": [
    { "tool": "tool_name", "args": { ... }, "reason": "Why this action" }
  ]
}
\`\`\`

If no actions are needed, just reply normally.`;

// ─── Execute a single tool call against the database ──────────────
async function executeTool(toolName, args) {
  switch (toolName) {
    case 'get_posts': {
      let q = supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(args.limit || 20);
      if (args.status) q = q.eq('status', args.status);
      if (args.category) q = q.eq('category', args.category);
      const { data } = await q;
      return data || [];
    }
    case 'update_post': {
      const patch = {};
      if (args.status) { patch.status = args.status; patch.updated_at = new Date().toISOString(); }
      if (args.priority) patch.priority = args.priority;
      if (args.admin_reply !== undefined) patch.admin_reply = clean(args.admin_reply, 1000);
      if (typeof args.hidden === 'boolean') patch.hidden = args.hidden;
      const { data, error } = await supabase.from('posts').update(patch).eq('id', args.post_id).select().single();
      if (error) throw error;
      return data;
    }
    case 'delete_post': {
      const { data, error } = await supabase.from('posts').update({ deleted: true, deleted_reason: clean(args.reason, 500), updated_at: new Date().toISOString() }).eq('id', args.post_id).select().single();
      if (error) throw error;
      return data;
    }
    case 'warn_user': {
      const { data: existing } = await supabase.from('users_meta').select('warnings,strikes').eq('anon_id', args.anon_id.toLowerCase()).maybeSingle();
      const warnings = [...(existing?.warnings || []), { text: clean(args.reason, 300), at: new Date().toISOString() }];
      const { error } = await supabase.from('users_meta').update({ warnings, strikes: (existing?.strikes || 0) + 1 }).eq('anon_id', args.anon_id.toLowerCase());
      if (error) throw error;
      return { warned: true, anon_id: args.anon_id, total_warnings: warnings.length };
    }
    case 'ban_user': {
      const { error } = await supabase.from('users_meta').update({ banned: true, ban_reason: clean(args.reason, 500) }).eq('anon_id', args.anon_id.toLowerCase());
      if (error) throw error;
      return { banned: true, anon_id: args.anon_id };
    }
    case 'get_user_posts': {
      const { data } = await supabase.from('posts').select('*').eq('author_id', args.anon_id.toLowerCase()).order('created_at', { ascending: false });
      return data || [];
    }
    case 'create_poll': {
      const { data, error } = await supabase.from('polls').insert({
        title: clean(args.title, 200),
        options: args.options || ['Yes', 'No'],
        ptype: args.ptype || 'yesno',
        author_id: 'ADMIN',
      }).select().single();
      if (error) throw error;
      return data;
    }
    case 'close_poll': {
      const { error } = await supabase.from('polls').update({ archived: true }).eq('id', args.poll_id);
      if (error) throw error;
      return { closed: true, poll_id: args.poll_id };
    }
    case 'get_analytics': {
      const [{ data: posts }, { data: users }, { data: comments }, { data: reactions }, { data: polls }] = await Promise.all([
        supabase.from('posts').select('id,category,status,created_at'),
        supabase.from('users_meta').select('anon_id,created_at'),
        supabase.from('comments').select('id,created_at'),
        supabase.from('reactions').select('id,kind'),
        supabase.from('polls').select('id,title,total_votes'),
      ]);
      const cats = {};
      (posts || []).forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
      const statuses = {};
      (posts || []).forEach((p) => { statuses[p.status] = (statuses[p.status] || 0) + 1; });
      return {
        posts: (posts || []).length,
        users: (users || []).length,
        comments: (comments || []).length,
        reactions: (reactions || []).length,
        polls: (polls || []).length,
        categories: cats,
        statuses,
      };
    }
    case 'get_activity_logs': {
      const { data } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(args.limit || 50);
      return data || [];
    }
    case 'set_announcement': {
      const value = { text: clean(args.text, 500), enabled: !!args.enabled, updated_at: new Date().toISOString() };
      const { data: existing } = await supabase.from('settings').select('key').eq('key', 'announcement').maybeSingle();
      if (existing) await supabase.from('settings').update({ value }).eq('key', 'announcement');
      else await supabase.from('settings').insert({ key: 'announcement', value });
      return { ok: true };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ─── Parse LLM response for actions ──────────────────────────────
function parseAgentResponse(text) {
  // Try to extract JSON block from response
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*"actions"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (json.actions && Array.isArray(json.actions)) {
        return { reply: json.reply || text, actions: json.actions };
      }
    } catch { /* fall through */ }
  }
  return { reply: text, actions: [] };
}

// ─── HTTP Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const b = req.body || {};
    const action = req.method === 'GET' ? req.query.action : b.action;

    // chat — send message, get response with proposed actions
    if (action === 'chat') {
      const { message, session_id } = b;
      if (!message) return res.status(400).json({ error: 'Message required' });
      const sid = clean(session_id, 60) || `s_${Date.now()}`;

      // Load conversation history
      const { data: history } = await supabase.from('agent_conversations')
        .select('role,content')
        .eq('session_id', sid)
        .order('created_at', { ascending: true })
        .limit(40);

      // Get fresh analytics context for the LLM
      const [{ count: postCount }, { count: userCount }] = await Promise.all([
        supabase.from('posts').select('*', { count: 'exact', head: true }),
        supabase.from('users_meta').select('*', { count: 'exact', head: true }),
      ]);

      const contextMsg = `[Current platform state: ${postCount || 0} posts, ${userCount || 0} registered users. Current time: ${new Date().toISOString()}]`;

      const messages = [
        ...(history || []).map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: message },
      ];

      // Call LLM with tool definitions
      const systemWithTools = SYSTEM_PROMPT + `\n\nAvailable tools:\n${JSON.stringify(TOOL_DEFS, null, 2)}\n\n${contextMsg}`;

      const llmResult = await callLLMChain(systemWithTools, '', messages);

      if (!llmResult) {
        return res.status(200).json({
          reply: "I couldn't connect to an AI provider. Please configure an API key in Settings → Provider Settings.",
          actions: [],
          session_id: sid,
          provider: 'none',
        });
      }

      const parsed = parseAgentResponse(llmResult.text);

      // Save user message
      await supabase.from('agent_conversations').insert({
        session_id: sid, role: 'user', content: message,
      });
      // Save assistant response
      await supabase.from('agent_conversations').insert({
        session_id: sid, role: 'assistant', content: parsed.reply,
        actions: parsed.actions,
      });

      await auditLog('admin', 'agent_chat', `Message: "${message.slice(0, 80)}" → ${parsed.actions.length} action(s) proposed`);

      return res.status(200).json({
        reply: parsed.reply,
        actions: parsed.actions.map((a, i) => ({
          id: `act_${Date.now()}_${i}`,
          tool: a.tool,
          args: a.args,
          reason: a.reason || '',
          destructive: ['delete_post', 'ban_user'].includes(a.tool),
        })),
        requires_approval: parsed.actions.some((a) => ['delete_post', 'ban_user'].includes(a.tool)),
        session_id: sid,
        provider: llmResult.provider,
        model: llmResult.model,
      });
    }

    // execute — run approved actions
    if (action === 'execute') {
      const { actions: actionList, session_id } = b;
      if (!Array.isArray(actionList) || !actionList.length) return res.status(400).json({ error: 'No actions to execute' });

      const results = [];
      for (const act of actionList) {
        try {
          const result = await executeTool(act.tool, act.args || {});
          results.push({ id: act.id, success: true, result });
          await auditLog('admin', `agent_execute_${act.tool}`, `Executed ${act.tool}(${JSON.stringify(act.args).slice(0, 120)}) → OK`);
        } catch (e) {
          results.push({ id: act.id, success: false, error: e.message });
          await auditLog('admin', `agent_execute_${act.tool}_FAIL`, `Failed ${act.tool}: ${e.message}`);
        }
      }

      // Save execution result in conversation
      if (session_id) {
        const summary = results.map((r) => `${r.id}: ${r.success ? 'OK' : r.error}`).join('; ');
        await supabase.from('agent_conversations').insert({
          session_id: clean(session_id, 60),
          role: 'system',
          content: `Actions executed: ${summary}`,
        });
      }

      return res.status(200).json({ results });
    }

    // history — get conversation history
    if (action === 'history') {
      const sid = clean(b.session_id || req.query.session_id || '', 60);
      if (!sid) return res.status(400).json({ error: 'session_id required' });
      const { data } = await supabase.from('agent_conversations')
        .select('*')
        .eq('session_id', sid)
        .order('created_at', { ascending: true })
        .limit(100);
      return res.status(200).json(data || []);
    }

    // sessions — list recent sessions
    if (action === 'sessions') {
      const { data } = await supabase.rpc ? { data: null } : { data: null };
      // Workaround: get unique session_ids from recent conversations
      const { data: rows } = await supabase.from('agent_conversations')
        .select('session_id, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      const sessions = {};
      (rows || []).forEach((r) => {
        if (!sessions[r.session_id]) sessions[r.session_id] = { session_id: r.session_id, last_message: r.created_at };
      });
      return res.status(200).json(Object.values(sessions).slice(0, 20));
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('agent-chat API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
