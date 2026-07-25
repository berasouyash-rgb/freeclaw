// Command Center API — unified conversations, messages, agent office
// Replaces old _chat.js and _inbox.js for admin use

import { cors } from './_auth.js';
import { callLLMChain } from './_providers.js';
import supabase from './_db-client.js';
import { AGENT_MAP, DIVISIONS } from './_agent-team.js';

// ─── Conversations ────────────────────────────────────────────

async function listConversations(req, res) {
  const { status = 'active', limit = 50, offset = 0 } = req.query;

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('status', status)
    .order('last_message_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ conversations: data || [] });
}

async function createConversation(req, res) {
  const { title, agent_id, created_by = 'admin' } = req.body;
  if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

  const { data, error } = await supabase
    .from('conversations')
    .insert({ title: title || 'New Chat', agent_id, created_by })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ conversation: data });
}

async function getConversationHistory(req, res) {
  const { limit = 50 } = req.query;

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, agent_id, status, last_message_at, created_at')
    .eq('status', 'active')
    .order('last_message_at', { ascending: false })
    .limit(Number(limit));

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ conversations: data || [] });
}

// ─── Messages ─────────────────────────────────────────────────

async function getMessages(req, res) {
  const { conversation_id, limit = 100, offset = 0 } = req.query;
  if (!conversation_id) return res.status(400).json({ error: 'conversation_id required' });

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: true })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ messages: data || [] });
}

async function sendMessage(req, res) {
  const { conversation_id, content, role = 'user' } = req.body;
  if (!conversation_id || !content) {
    return res.status(400).json({ error: 'conversation_id and content required' });
  }

  // Get conversation to find agent
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('agent_id')
    .eq('id', conversation_id)
    .single();

  if (convErr || !conv) return res.status(404).json({ error: 'Conversation not found' });

  // Look up real agent definition
  const agentDef = AGENT_MAP.get(conv.agent_id);
  const agentName = agentDef?.name || conv.agent_id;
  const agentRole = agentDef?.role || 'AI Assistant';
  const agentDesc = agentDef?.description || 'Helpful assistant';
  const agentCaps = agentDef?.capabilities || [];
  const agentDivision = agentDef?.division || 'general';
  const divisionInfo = DIVISIONS[agentDivision] || {};

  // Save user message
  const userMsg = {
    conversation_id,
    role,
    content,
    agent_id: conv.agent_id,
  };

  const { error: msgErr } = await supabase.from('messages').insert(userMsg);
  if (msgErr) return res.status(500).json({ error: msgErr.message });

  // Update conversation timestamp
  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversation_id);

  // Get recent messages for context (limit to 10 to avoid timeout)
  const { data: recentMsgs } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: false })
    .limit(10);

  const context = (recentMsgs || []).reverse();

  // Build real system prompt from agent definition
  const systemPrompt = `You are ${agentName}, the ${agentRole} in the Voice Box platform.
Division: ${divisionInfo.name || agentDivision} ${divisionInfo.icon || ''}
Description: ${agentDesc}
Capabilities: ${agentCaps.join(', ') || 'general assistance'}

You are a real AI agent with a specific role. Your platform tasks are PRE-EXECUTED before you respond — real database queries have already been run and the results are injected below as [REAL-TIME TASK RESULT].

CRITICAL RULES:
- NEVER generate SQL queries. NEVER output [QUERY] tags. The queries are already run for you.
- USE the provided task results directly in your response. The data is REAL.
- If no task result is provided, respond based on your role knowledge.
- Always identify yourself as ${agentName} and reference your role as ${agentRole}.
- Be specific, actionable, and reference the REAL data provided to you.
- Format your response as a clear status report or analysis, not raw queries.`;

  // Execute real tasks based on user message
  let taskResult = null;
  const lowerContent = content.toLowerCase();

  // Auto-detect task requests and execute them
  try {
    if (lowerContent.includes('show') && lowerContent.includes('post')) {
      const { data } = await supabase.from('posts').select('id, title, description, category, status, priority, created_at, deleted').eq('deleted', false).order('created_at', { ascending: false }).limit(5);
      taskResult = data?.length ? `Found ${data.length} recent posts:\n${data.map(p => `- [${p.category || 'General'}] "${p.title || 'Untitled'}" (Status: ${p.status}, Priority: ${p.priority || 'medium'}, ${new Date(p.created_at).toLocaleDateString()})`).join('\n')}` : 'No posts found.';
    } else if (lowerContent.includes('show') && lowerContent.includes('user')) {
      const { data } = await supabase.from('users_meta').select('id, display_name, created_at, role').order('created_at', { ascending: false }).limit(5);
      taskResult = data?.length ? `Found ${data.length} recent users:\n${data.map(u => `- ${u.display_name || 'Anonymous'} (Role: ${u.user_role || 'user'}, Joined: ${new Date(u.created_at).toLocaleDateString()})`).join('\n')}` : 'No users found.';
    } else if (lowerContent.includes('health') || lowerContent.includes('status') || lowerContent.includes('status report')) {
      // Comprehensive status report
      const [postsCount, usersCount, commentsCount, recentAgents, recentPosts] = await Promise.all([
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('deleted', false),
        supabase.from('users_meta').select('id', { count: 'exact', head: true }),
        supabase.from('comments').select('id', { count: 'exact', head: true }),
        supabase.from('agent_executions').select('agent_name, status, started_at').order('started_at', { ascending: false }).limit(15),
        supabase.from('posts').select('id, title, status, priority, category, created_at, deleted').eq('deleted', false).order('created_at', { ascending: false }).limit(5),
      ]);
      const agentStats = {};
      (recentAgents.data || []).forEach(e => {
        if (!agentStats[e.agent_name]) agentStats[e.agent_name] = { completed: 0, failed: 0, lastRun: e.started_at };
        if (e.status === 'completed') agentStats[e.agent_name].completed++;
        if (e.status === 'failed') agentStats[e.agent_name].failed++;
      });
      const activeAgents = Object.entries(agentStats).map(([name, s]) => `- ${name}: ${s.completed} completed, ${s.failed} failed (last: ${new Date(s.lastRun).toLocaleDateString()})`).join('\n');
      const postsList = (recentPosts.data || []).map(p => `- "${p.title || 'Untitled'}" [${p.category}] — ${p.status} (${new Date(p.created_at).toLocaleDateString()})`).join('\n');
      taskResult = `Platform Status Report:\n- Total Posts: ${postsCount.count || 0}\n- Total Users: ${usersCount.count || 0}\n- Total Comments: ${commentsCount.count || 0}\n- Agent System: Operational\n- Database: Connected\n\nRecent Posts:\n${postsList || 'No recent posts.'}\n\nRecent Agent Activity:\n${activeAgents || 'No recent agent activity.'}`;
    } else if (lowerContent.includes('report') || lowerContent.includes('summary')) {
      const [posts, comments, users, agents] = await Promise.all([
        supabase.from('posts').select('id', { count: 'exact', head: true }),
        supabase.from('comments').select('id', { count: 'exact', head: true }),
        supabase.from('users_meta').select('id', { count: 'exact', head: true }),
        supabase.from('agent_executions').select('status').limit(100),
      ]);
      const agentData = agents.data || [];
      const completed = agentData.filter(a => a.status === 'completed').length;
      const failed = agentData.filter(a => a.status === 'failed').length;
      taskResult = `Platform Summary:\n- Posts: ${posts.count || 0}\n- Comments: ${comments.count || 0}\n- Users: ${users.count || 0}\n- Agent Executions: ${agentData.length} total (${completed} completed, ${failed} failed)`;
    } else if (lowerContent.includes('agent') && (lowerContent.includes('status') || lowerContent.includes('list'))) {
      const { data } = await supabase.from('agent_executions').select('agent_name, status').order('started_at', { ascending: false }).limit(20);
      const agentStats = {};
      (data || []).forEach(e => {
        if (!agentStats[e.agent_name]) agentStats[e.agent_name] = { completed: 0, failed: 0 };
        if (e.status === 'completed') agentStats[e.agent_name].completed++;
        if (e.status === 'failed') agentStats[e.agent_name].failed++;
      });
      taskResult = `Agent Status Report:\n${Object.entries(agentStats).map(([name, s]) => `- ${name}: ${s.completed} completed, ${s.failed} failed`).join('\n') || 'No recent agent activity.'}`;
    } else if (lowerContent.includes('sentiment')) {
      const { data } = await supabase.from('posts').select('title, description, category, status, created_at, deleted').eq('deleted', false).order('created_at', { ascending: false }).limit(10);
      taskResult = `Sentiment Analysis (last 10 posts):\n${(data || []).map(p => `- [${p.category || 'General'}] "${(p.title || p.description || '').slice(0, 60)}..." (Status: ${p.status})`).join('\n') || 'No posts to analyze.'}`;
    } else if (lowerContent.includes('trend')) {
      const { data } = await supabase.from('posts').select('created_at').order('created_at', { ascending: false }).limit(30);
      const today = new Date().toDateString();
      const todayPosts = (data || []).filter(p => new Date(p.created_at).toDateString() === today).length;
      taskResult = `Trend Report:\n- Today: ${todayPosts} posts\n- Last 30 posts span: ${data?.length ? Math.ceil((new Date(data[0].created_at) - new Date(data[data.length-1].created_at)) / 86400000) : 0} days`;
    } else if (lowerContent.includes('pending') || lowerContent.includes('issue') || lowerContent.includes('problem') || lowerContent.includes('report')) {
      const { data: pendingPosts } = await supabase.from('posts').select('id, title, category, status, priority, created_at, deleted').eq('deleted', false).in('status', ['reported', 'in_progress']).order('created_at', { ascending: false }).limit(10);
      const byStatus = {};
      (pendingPosts || []).forEach(p => {
        if (!byStatus[p.status]) byStatus[p.status] = [];
        byStatus[p.status].push(p);
      });
      let pendingReport = `Pending Issues (${(pendingPosts || []).length} total):\n`;
      Object.entries(byStatus).forEach(([status, posts]) => {
        pendingReport += `\n[${status.toUpperCase()}] (${posts.length}):\n`;
        posts.forEach(p => {
          pendingReport += `- "${p.title || 'Untitled'}" [${p.category}] Priority: ${p.priority || 'medium'} (${new Date(p.created_at).toLocaleDateString()})\n`;
        });
      });
      if (!pendingPosts?.length) pendingReport += 'No pending issues found.';
      taskResult = pendingReport;
    }
  } catch (taskErr) {
    taskResult = `Task execution error: ${taskErr.message}`;
  }

  // Build context with task result
  const taskContext = taskResult ? `\n\n[REAL-TIME TASK RESULT]\n${taskResult}\n[END TASK RESULT]\n\nUse this real data in your response.` : '';

  // Generate AI response
  const fullSystem = systemPrompt + taskContext;

  try {
    const aiResult = await callLLMChain(fullSystem, content, context);

    if (!aiResult?.text) {
      console.error('callLLMChain returned null/empty for agent:', agentName, 'content:', content.slice(0, 50));
    }

    const aiContent = aiResult?.text || 'I was unable to generate a response.';

    // Save AI response
    const aiMsg = {
      conversation_id,
      role: 'assistant',
      content: aiContent,
      agent_id: conv.agent_id,
      metadata: JSON.stringify({
        provider: aiResult?.provider,
        model: aiResult?.model,
        agent_name: agentName,
        agent_role: agentRole,
        task_executed: !!taskResult,
      }),
    };

    const { error: aiMsgErr } = await supabase.from('messages').insert(aiMsg);
    if (aiMsgErr) console.error('Failed to save AI response:', aiMsgErr.message);

    // Update conversation timestamp again
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversation_id);

    return res.status(200).json({
      user_message: userMsg,
      ai_message: aiMsg,
    });
  } catch (err) {
    console.error('AI generation failed:', err.message);

    // Save error message
    const errorMsg = {
      conversation_id,
      role: 'assistant',
      content: `I encountered an error processing your request. Please try again. (Error: ${err.message})`,
      agent_id: conv.agent_id,
      metadata: JSON.stringify({ error: err.message }),
    };

    await supabase.from('messages').insert(errorMsg);

    return res.status(200).json({
      user_message: userMsg,
      ai_message: errorMsg,
    });
  }
}

// ─── Agent Office ─────────────────────────────────────────────

async function getAgentOffice(req, res) {
  // Get all agents with their stats from agent_executions (7-day window)
  const { data: agents, error: agentErr } = await supabase
    .from('agent_executions')
    .select('agent_name, status, started_at')
    .gte('started_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('started_at', { ascending: false });

  if (agentErr) console.error('Agent query error:', agentErr.message);

  // Aggregate stats per agent
  const agentMap = {};
  (agents || []).forEach(a => {
    if (!agentMap[a.agent_name]) {
      agentMap[a.agent_name] = {
        agent_id: a.agent_name,
        total_executions: 0,
        completed: 0,
        failed: 0,
        running: 0,
        last_activity: a.started_at,
        status: 'idle',
      };
    }
    const ag = agentMap[a.agent_name];
    ag.total_executions++;
    if (a.status === 'completed') ag.completed++;
    if (a.status === 'failed') ag.failed++;
    if (a.status === 'running') ag.running++;
    if (a.started_at > ag.last_activity) ag.last_activity = a.started_at;
  });

  // Set status based on recent activity
  Object.values(agentMap).forEach(ag => {
    if (ag.running > 0) ag.status = 'working';
    else if (ag.failed > 0 && ag.completed === 0) ag.status = 'error';
    else ag.status = 'idle';
  });

  // Enrich with agent definitions (name, icon, role, description, division)
  for (const [id, def] of AGENT_MAP) {
    if (!agentMap[def.name]) {
      // Agent has no executions yet — still show it
      agentMap[def.name] = {
        agent_id: def.name,
        total_executions: 0,
        completed: 0,
        failed: 0,
        running: 0,
        last_activity: null,
        status: 'idle',
      };
    }
    const ag = agentMap[def.name];
    ag.agent_id_real = id;
    ag.icon = def.icon;
    ag.role = def.role;
    ag.description = def.description;
    ag.division = def.division;
    ag.tier = def.tier;
  }

  // Get agent goals
  const { data: goals } = await supabase
    .from('agent_goals')
    .select('*')
    .in('status', ['pending', 'in_progress'])
    .order('priority', { ascending: true });

  // Merge goals into agents
  (goals || []).forEach(g => {
    const match = Object.values(agentMap).find(a => a.agent_id_real === g.agent_id || a.agent_id === g.agent_id);
    if (match) {
      match.current_goal = g.goal;
      match.goal_status = g.status;
      match.goal_id = g.id;
    }
  });

  const agentList = Object.values(agentMap).sort((a, b) => {
    if (a.status === 'working' && b.status !== 'working') return -1;
    if (b.status === 'working' && a.status !== 'working') return 1;
    return new Date(b.last_activity || 0) - new Date(a.last_activity || 0);
  });

  return res.status(200).json({ agents: agentList });
}

async function setAgentGoal(req, res) {
  const { agent_id, goal, priority = 3 } = req.body;
  if (!agent_id || !goal) return res.status(400).json({ error: 'agent_id and goal required' });

  // Complete any existing goals for this agent
  await supabase
    .from('agent_goals')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('agent_id', agent_id)
    .in('status', ['pending', 'in_progress']);

  // Create new goal
  const { data, error } = await supabase
    .from('agent_goals')
    .insert({ agent_id, goal, priority, status: 'in_progress' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ goal: data });
}

// ─── Admin Tabs ───────────────────────────────────────────────

async function getTabs(req, res) {
  const { data, error } = await supabase
    .from('admin_tabs')
    .select('*, conversations(id, title, agent_id)')
    .order('position', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ tabs: data || [] });
}

async function saveTabs(req, res) {
  const { tabs } = req.body;
  if (!Array.isArray(tabs)) return res.status(400).json({ error: 'tabs array required' });

  // Clear existing tabs
  await supabase.from('admin_tabs').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Insert new tabs
  const tabInserts = tabs.map((t, i) => ({
    conversation_id: t.conversation_id,
    position: i,
  }));

  if (tabInserts.length > 0) {
    const { error } = await supabase.from('admin_tabs').insert(tabInserts);
    if (error) return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true });
}

// ─── Handler ──────────────────────────────────────────────────

export default async function handler(req, res) {
  cors(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.method === 'GET' ? req.query : (req.body || {});

  try {
    switch (action) {
      // Conversations
      case 'conversations': return await listConversations(req, res);
      case 'conversation-create': return await createConversation(req, res);
      case 'conversation-history': return await getConversationHistory(req, res);

      // Messages
      case 'conversation-messages': return await getMessages(req, res);
      case 'conversation-send': return await sendMessage(req, res);

      // Agent Office
      case 'agent-office': return await getAgentOffice(req, res);
      case 'agent-office-goal': return await setAgentGoal(req, res);

      // Tabs
      case 'admin-tabs': {
        if (req.method === 'GET') return await getTabs(req, res);
        return await saveTabs(req, res);
      }

      default:
        return res.status(400).json({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('[command-center] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
