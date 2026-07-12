// Admin Agent Chat — works autonomously with built-in analytics engine.
// LLM enhances responses when available; built-in intent matcher handles everything.
// All destructive actions require approval. All actions audited.
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';
import { callLLMChain } from './_providers.js';

// ─── Built-in Intent Engine ───────────────────────────────────────
// Pattern-matches user intent and queries DB directly. No LLM needed.

const INTENTS = [
  {
    patterns: /\b(analytics?|stats?|dashboard|overview|summary|numbers?|count|how many)\b/i,
    handler: async () => {
      const [{ data: posts }, { data: users }, { data: comments }, { data: reactions }, { data: polls }, { data: chatThreads }] = await Promise.all([
        supabase.from('posts').select('id,category,status,created_at,deleted'),
        supabase.from('users_meta').select('anon_id,created_at,banned'),
        supabase.from('comments').select('id,created_at'),
        supabase.from('reactions').select('id,kind'),
        supabase.from('polls').select('id,title,total_votes,archived'),
        supabase.from('chat_threads').select('id,created_at'),
      ]);
      const active = (posts || []).filter((p) => !p.deleted);
      const cats = {};
      active.forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
      const stats = {};
      active.forEach((p) => { stats[p.status] = (stats[p.status] || 0) + 1; });
      const bans = (users || []).filter((u) => u.banned).length;

      return {
        reply: `📊 **Platform Overview**\n\n` +
          `**Posts:** ${active.length} total (${(posts || []).length - active.length} deleted)\n` +
          `**Users:** ${(users || []).length} registered (${bans} banned)\n` +
          `**Comments:** ${(comments || []).length}\n` +
          `**Reactions:** ${(reactions || []).length}\n` +
          `**Polls:** ${(polls || []).length} (${(polls || []).filter((p) => p.archived).length} archived)\n` +
          `**Chat threads:** ${(chatThreads || []).length}\n\n` +
          `**By category:** ${Object.entries(cats).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}\n` +
          `**By status:** ${Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`,
        actions: [],
      };
    },
  },
  {
    patterns: /\b(recent|latest|new|posts?|show)\s*(posts?|content|feedback)?\b/i,
    handler: async () => {
      const { data } = await supabase.from('posts').select('id,title,category,status,created_at,deleted').order('created_at', { ascending: false }).limit(10);
      const active = (data || []).filter((p) => !p.deleted);
      if (!active.length) return { reply: 'No posts found.', actions: [] };
      const list = active.map((p, i) => `${i + 1}. **${p.title}** [${p.category}] — ${p.status} (${new Date(p.created_at).toLocaleDateString()})`).join('\n');
      return { reply: `📝 **Recent Posts** (last 10)\n\n${list}`, actions: [] };
    },
  },
  {
    patterns: /\b(report|reported|flag|flagged|complaint|complaints)\b/i,
    handler: async () => {
      const { data } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(20);
      if (!data?.length) return { reply: '✅ No reports found. Platform is clean.', actions: [] };
      const list = data.map((r, i) => `${i + 1}. Post \`${r.post_id}\` — ${r.reason || 'no reason'} (${r.status || 'pending'})`).join('\n');
      return { reply: `🚨 **Reports** (${data.length})\n\n${list}`, actions: [] };
    },
  },
  {
    patterns: /\b(analy|break|category|categor|by cat|per cat)\b/i,
    handler: async () => {
      const { data } = await supabase.from('posts').select('category,deleted').eq('deleted', false);
      const cats = {};
      (data || []).forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
      const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
      const total = (data || []).length;
      const bars = sorted.map(([cat, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const bar = '█'.repeat(Math.round(pct / 5));
        return `  ${cat.padEnd(12)} ${bar} ${count} (${pct}%)`;
      }).join('\n');
      return { reply: `📂 **Posts by Category**\n\n${bars || 'No posts yet'}`, actions: [] };
    },
  },
  {
    patterns: /\b(user|users?|who|people|contributors?)\b.*(post|author|writ|creat|count)/i,
    handler: async () => {
      const { data } = await supabase.from('posts').select('author_id,deleted').eq('deleted', false);
      const userCounts = {};
      (data || []).forEach((p) => { userCounts[p.author_id] = (userCounts[p.author_id] || 0) + 1; });
      const sorted = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!sorted.length) return { reply: 'No posts from users yet.', actions: [] };
      const list = sorted.map(([id, count], i) => `${i + 1}. \`${id}\` — ${count} post${count > 1 ? 's' : ''}`).join('\n');
      return { reply: `👥 **Top Contributors**\n\n${list}`, actions: [] };
    },
  },
  {
    patterns: /\b(activity|log|logs|recent action|audit|what happened|history)\b/i,
    handler: async () => {
      const { data } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(15);
      if (!data?.length) return { reply: 'No activity logs found.', actions: [] };
      const list = data.map((l) => `• [${l.actor}] ${l.action} — ${(l.detail || '').slice(0, 80)} (${new Date(l.created_at).toLocaleString()})`).join('\n');
      return { reply: `📋 **Recent Activity** (last 15)\n\n${list}`, actions: [] };
    },
  },
  {
    patterns: /\b(poll|polls?|vote|voting|survey|survey)\b/i,
    handler: async () => {
      const { data } = await supabase.from('polls').select('id,title,total_votes,archived,created_at').order('created_at', { ascending: false });
      if (!data?.length) return { reply: 'No polls found.', actions: [] };
      const list = data.map((p, i) => `${i + 1}. **${p.title}** — ${p.total_votes || 0} votes ${p.archived ? '(archived)' : '(active)'}`).join('\n');
      return { reply: `📊 **Polls** (${data.length})\n\n${list}`, actions: [] };
    },
  },
  {
    patterns: /\b(announcement|announce|banner|notice|message to all|broadcast)\b/i,
    handler: async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', 'announcement').maybeSingle();
      const ann = data?.value;
      if (!ann?.text) return { reply: '📢 No announcement is currently active.', actions: [] };
      return {
        reply: `📢 **Current Announcement**\n\n"${ann.text}"\n\nStatus: ${ann.enabled ? '✅ Active' : '⏸️ Disabled'}`,
        actions: [{
          tool: 'set_announcement',
          args: { text: ann.text, enabled: !ann.enabled },
          reason: ann.enabled ? 'Disable announcement' : 'Enable announcement',
          destructive: false,
        }],
      };
    },
  },
  {
    patterns: /\b(hide|hidden|hidden post|show hidden)\b/i,
    handler: async () => {
      const { data } = await supabase.from('posts').select('id,title,category,hidden,created_at').eq('hidden', true).order('created_at', { ascending: false });
      if (!data?.length) return { reply: 'No hidden posts.', actions: [] };
      const list = data.map((p, i) => `${i + 1}. **${p.title}** [${p.category}] — hidden`).join('\n');
      return { reply: `🫥 **Hidden Posts** (${data.length})\n\n${list}`, actions: [] };
    },
  },
  {
    patterns: /\b(help|what can you|commands?|capabilities|options)\b/i,
    handler: async () => ({
      reply: `🤖 **Agent Chat — What I Can Do**\n\n` +
        `**Analytics & Data:**\n` +
        `  • "Show analytics" — platform overview with numbers\n` +
        `  • "Recent posts" — latest 10 posts\n` +
        `  • "Show reports" — reported/flagged posts\n` +
        `  • "Posts by category" — breakdown chart\n` +
        `  • "User contributions" — who posts the most\n` +
        `  • "Activity logs" — recent admin actions\n` +
        `  • "Polls" — all polls and vote counts\n` +
        `  • "Announcements" — current site announcement\n` +
        `  • "Hidden posts" — posts hidden from public view\n\n` +
        `**Actions (need your approval):**\n` +
        `  • "Hide post [id]" — hide a post\n` +
        `  • "Delete post [id]" — soft-delete a post\n` +
        `  • "Ban user [id]" — ban an anonymous user\n` +
        `  • "Warn user [id] for [reason]" — issue warning\n` +
        `  • "Create poll: [title]" — create a new poll\n` +
        `  • "Set announcement: [text]" — post announcement\n\n` +
        `**Tip:** Just ask naturally — I'll understand.`,
      actions: [],
    }),
  },
  {
    patterns: /\b(ban|suspend|block)\s*(user|account)?\s*(\w+)?/i,
    handler: async (msg) => {
      const match = msg.match(/\b(ban|suspend|block)\s*(?:user|account)?\s*(\w+)/i);
      const anonId = match?.[2];
      if (!anonId) return { reply: 'Usage: "ban user [anonymous_id]"', actions: [] };
      const { data: user } = await supabase.from('users_meta').select('*').eq('anon_id', anonId.toLowerCase()).maybeSingle();
      if (!user) return { reply: `User \`${anonId}\` not found.`, actions: [] };
      if (user.banned) return { reply: `User \`${anonId}\` is already banned.`, actions: [] };
      return {
        reply: `⚠️ **Ban User**\n\nUser: \`${anonId}\`\nPosts: ${(await supabase.from('posts').select('*', { count: 'exact', head: true }).eq('author_id', anonId.toLowerCase())).count || 0}\nWarnings: ${user.warnings?.length || 0}\n\nReady to ban — click Execute to confirm.`,
        actions: [{ tool: 'ban_user', args: { anon_id: anonId, reason: 'Banned via admin agent' }, reason: `Ban user ${anonId}`, destructive: true }],
      };
    },
  },
  {
    patterns: /\b(warn|warning)\s*(user|account)?\s*(\w+)?(?:\s*(?:for|because|reason)[:\s]+(.+))?/i,
    handler: async (msg) => {
      const match = msg.match(/\b(warn|warning)\s*(?:user|account)?\s*(\w+)?(?:\s*(?:for|because|reason)[:\s]+(.+))?/i);
      const anonId = match?.[2];
      const reason = match?.[3] || 'Warning issued by admin';
      if (!anonId) return { reply: 'Usage: "warn user [id] for [reason]"', actions: [] };
      const { data: user } = await supabase.from('users_meta').select('warnings,strikes').eq('anon_id', anonId.toLowerCase()).maybeSingle();
      if (!user) return { reply: `User \`${anonId}\` not found.`, actions: [] };
      return {
        reply: `⚠️ **Warn User**\n\nUser: \`${anonId}\`\nPrevious warnings: ${user.warnings?.length || 0}\nReason: ${reason}\n\nClick Execute to issue the warning.`,
        actions: [{ tool: 'warn_user', args: { anon_id: anonId, reason }, reason: `Warn user ${anonId}: ${reason}`, destructive: false }],
      };
    },
  },
  {
    patterns: /\b(hide|remove)\s*(?:post)?\s*(\w{8,})/i,
    handler: async (msg) => {
      const match = msg.match(/\b(hide|remove)\s*(?:post)?\s*(\w{8,})/i);
      const postId = match?.[2];
      if (!postId) return { reply: 'Usage: "hide post [id]"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,category,hidden').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      return {
        reply: `${post.hidden ? 'Already hidden' : 'Ready to hide'}: **${post.title}** [${post.category}]\n\nClick Execute to ${post.hidden ? 'unhide' : 'hide'} this post.`,
        actions: [{ tool: 'update_post', args: { post_id: postId, hidden: !post.hidden }, reason: post.hidden ? `Unhide post` : `Hide post: ${post.title}`, destructive: false }],
      };
    },
  },
  {
    patterns: /\b(delete|remove)\s*(?:post)?\s*(\w{8,})/i,
    handler: async (msg) => {
      const match = msg.match(/\b(delete|remove)\s*(?:post)?\s*(\w{8,})/i);
      const postId = match?.[2];
      if (!postId) return { reply: 'Usage: "delete post [id]"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,category,deleted').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      if (post.deleted) return { reply: `Post \`${postId}\` is already deleted.`, actions: [] };
      return {
        reply: `🗑️ **Delete Post**\n\nTitle: **${post.title}**\nCategory: ${post.category}\n\n⚠️ This is a soft-delete — the post will be hidden but not removed from the database. Click Execute to confirm.`,
        actions: [{ tool: 'delete_post', args: { post_id: postId, reason: 'Deleted via admin agent' }, reason: `Delete post: ${post.title}`, destructive: true }],
      };
    },
  },
  {
    patterns: /\b(create|make|new)\s*(?:a\s*)?(?:poll|survey|vote)\s*:?\s*(.+)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(create|make|new)\s*(?:a\s*)?(?:poll|survey|vote)\s*:?\s*(.+)/i);
      const title = match?.[1]?.trim();
      if (!title) return { reply: 'Usage: "create poll: [title]"', actions: [] };
      return {
        reply: `📊 **Create Poll**\n\nTitle: **${title}**\nOptions: Yes / No\nType: yesno\n\nClick Execute to create this poll.`,
        actions: [{ tool: 'create_poll', args: { title, options: ['Yes', 'No'], ptype: 'yesno' }, reason: `Create poll: ${title}`, destructive: false }],
      };
    },
  },
  {
    patterns: /\b(set|post|update)\s*(?:a\s*)?(?:announcement|banner|notice)\s*:?\s*(.+)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(set|post|update)\s*(?:a\s*)?(?:announcement|banner|notice)\s*:?\s*(.+)/i);
      const text = match?.[1]?.trim();
      if (!text) return { reply: 'Usage: "set announcement: [text]"', actions: [] };
      return {
        reply: `📢 **Set Announcement**\n\nText: "${text}"\n\nClick Execute to post this announcement site-wide.`,
        actions: [{ tool: 'set_announcement', args: { text, enabled: true }, reason: `Set announcement: ${text.slice(0, 50)}`, destructive: false }],
      };
    },
  },
  {
    patterns: /\b(close|end|archive)\s*(?:the\s*)?(?:poll|survey)\s*(\d+)?/i,
    handler: async (msg) => {
      const match = msg.match(/\b(close|end|archive)\s*(?:the\s*)?(?:poll|survey)\s*(\d+)?/i);
      const pollId = match?.[1] ? parseInt(match[1]) : null;
      if (!pollId) {
        const { data } = await supabase.from('polls').select('id,title,archived').eq('archived', false);
        if (!data?.length) return { reply: 'No active polls to close.', actions: [] };
        const list = data.map((p) => `• ID ${p.id}: ${p.title}`).join('\n');
        return { reply: `Which poll to close?\n\n${list}\n\nUsage: "close poll [id]"`, actions: [] };
      }
      const { data: poll } = await supabase.from('polls').select('id,title,archived').eq('id', pollId).maybeSingle();
      if (!poll) return { reply: `Poll ${pollId} not found.`, actions: [] };
      if (poll.archived) return { reply: `Poll "${poll.title}" is already closed.`, actions: [] };
      return {
        reply: `📊 **Close Poll**\n\n"${poll.title}"\n\nClick Execute to archive this poll.`,
        actions: [{ tool: 'close_poll', args: { poll_id: pollId }, reason: `Close poll: ${poll.title}`, destructive: false }],
      };
    },
  },
];

// ─── Default fallback — query all data and present summary ────────
async function fallbackHandler(message) {
  // Try a general data pull
  const [{ count: posts }, { count: users }, { count: comments }] = await Promise.all([
    supabase.from('posts').select('*', { count: 'exact', head: true }),
    supabase.from('users_meta').select('*', { count: 'exact', head: true }),
    supabase.from('comments').select('*', { count: 'exact', head: true }),
  ]);

  return {
    reply: `I'm not sure what you mean by "${message.slice(0, 80)}".\n\n` +
      `**Current stats:** ${posts || 0} posts, ${users || 0} users, ${comments || 0} comments\n\n` +
      `Try asking about: analytics, posts, reports, polls, users, announcements, activity logs, or say "help" for all commands.`,
    actions: [],
  };
}

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
      return { posts: (posts || []).length, users: (users || []).length, comments: (comments || []).length, reactions: (reactions || []).length, polls: (polls || []).length, categories: cats, statuses };
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

// ─── HTTP Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const b = req.body || {};
    const action = req.method === 'GET' ? req.query.action : b.action;

    // chat — send message, get response with real data
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

      // Try built-in intent engine first
      let reply = '';
      let actions = [];
      let matched = false;

      for (const intent of INTENTS) {
        if (intent.patterns.test(message)) {
          const result = await intent.handler(message);
          reply = result.reply;
          actions = result.actions || [];
          matched = true;
          break;
        }
      }

      // If no intent matched, try LLM (if available via configured provider chain)
      let providerUsed = 'builtin';
      if (!matched) {
        const [{ count: postCount }, { count: userCount }] = await Promise.all([
          supabase.from('posts').select('*', { count: 'exact', head: true }),
          supabase.from('users_meta').select('*', { count: 'exact', head: true }),
        ]);

        const systemWithTools = SYSTEM_PROMPT + `\n\nAvailable tools:\n${JSON.stringify(TOOL_DEFS, null, 2)}\n\n[Platform state: ${postCount || 0} posts, ${userCount || 0} users. Time: ${new Date().toISOString()}]`;

        const messages = [
          ...(history || []).map((h) => ({ role: h.role, content: h.content })),
          { role: 'user', content: message },
        ];

        const llmResult = await callLLMChain(systemWithTools, '', messages);

        if (llmResult) {
          const parsed = parseAgentResponse(llmResult.text);
          reply = parsed.reply;
          actions = parsed.actions || [];
          providerUsed = `${llmResult.provider}:${llmResult.model}`;
        } else {
          // LLM unavailable — use fallback
          const fb = await fallbackHandler(message);
          reply = fb.reply;
          actions = fb.actions || [];
        }
      }

      // Save user message
      await supabase.from('agent_conversations').insert({
        session_id: sid, role: 'user', content: message,
      });
      // Save assistant response
      await supabase.from('agent_conversations').insert({
        session_id: sid, role: 'assistant', content: reply,
        actions: actions.length > 0 ? actions : undefined,
      });

      await auditLog('admin', 'agent_chat', `Message: "${message.slice(0, 80)}" → ${actions.length} action(s) proposed`);

      return res.status(200).json({
        reply,
        actions: actions.map((a, i) => ({
          id: `act_${Date.now()}_${i}`,
          tool: a.tool,
          args: a.args,
          reason: a.reason || '',
          destructive: ['delete_post', 'ban_user'].includes(a.tool),
        })),
        requires_approval: actions.some((a) => ['delete_post', 'ban_user'].includes(a.tool)),
        session_id: sid,
        provider: providerUsed,
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

function parseAgentResponse(text) {
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
