// Admin Agent Chat — works autonomously with built-in analytics engine.
// LLM enhances responses when available; built-in intent matcher handles everything.
// All destructive actions require approval. All actions audited.
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean, maskProfanity } from './_auth.js';
import { callLLMChain } from './_providers.js';

// ─── Built-in Intent Engine ───────────────────────────────────────
// Pattern-matches user intent and queries DB directly. No LLM needed.

const INTENTS = [
  // ── Conversational (no DB needed, no LLM needed) ──────────────
  {
    patterns: /\b(who are you|what are you|your name|introduce yourself)\b/i,
    handler: async () => ({
      reply: `🤖 **I'm the Voice Box Admin Agent** — your autonomous operations engine.\n\n` +
        `I have full access to the platform's database, users, posts, comments, polls, and analytics. ` +
        `I think in goals, not tools — tell me what you need and I'll figure out the best way to do it.\n\n` +
        `**Try me:** "show analytics", "find bullying posts", "who posted the most", "create a poll", "generate a report"`,
      actions: [],
    }),
  },
  {
    patterns: /\b(help|what can you|commands?|capabilities|options)\b/i,
    handler: async () => ({
      reply: `🤖 **Agent Chat — What I Can Do**\n\n` +
        `**Query & Analyze:**\n` +
        `• "show analytics" — full platform stats\n` +
        `• "category breakdown" — posts by category\n` +
        `• "trends this week" — activity trends\n` +
        `• "find [keyword]" — search posts\n\n` +
        `**Manage Content:**\n` +
        `• "hide [post id]" / "pin [post id]" / "lock [post id]"\n` +
        `• "set status [id] to solved" / "set priority [id] to high"\n` +
        `• "comment on [id]: your message"\n\n` +
        `**Manage Users:**\n` +
        `• "search user [name]" / "show top contributors"\n` +
        `• "warn [user]" / "ban [user]" / "unban [user]"\n\n` +
        `**Create & Generate:**\n` +
        `• "create poll: title | option1 | option2"\n` +
        `• "set announcement: your text"\n` +
        `• "generate presentation about [topic]"\n` +
        `• "generate HTML: [description]"\n\n` +
        `**Database:**\n` +
        `• "list tables" / "show table [name]"\n` +
        `• "run SQL: SELECT ..."\n\n` +
        `**Just ask naturally** — I'll figure out the best tool.`,
      actions: [],
    }),
  },
  {
    patterns: /\b(analytics?|stats?|dashboard|overview|summary|numbers?|count|how many|status|health|system)\b/i,
    handler: async () => {
      try {
        const [{ data: posts }, { data: users }, { data: comments }, { data: reactions }, { data: polls }, { data: chatThreads }] = await Promise.all([
          supabase.from('posts').select('id,category,status,created_at,deleted'),
          supabase.from('users_meta').select('anon_id,created_at,banned'),
          supabase.from('comments').select('id,created_at'),
          supabase.from('reactions').select('id,kind'),
          supabase.from('polls').select('id,title,archived'),
          supabase.from('chat_threads').select('id,created_at').catch(() => ({ data: [] })),
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
      } catch (e) {
        return { reply: `⚠️ Analytics query failed: ${e.message}. Check database connection.`, actions: [] };
      }
    },
  },
  {
    patterns: /\b(report|reported|flag|flagged|complaint|complaints)\b/i,
    handler: async () => {
      try {
        const { data } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(20);
        if (!data?.length) return { reply: '✅ No reports found. Platform is clean.', actions: [] };
        const list = data.map((r, i) => `${i + 1}. Post \`${r.post_id}\` — ${r.reason || 'no reason'} (${r.status || 'pending'})`).join('\n');
        return { reply: `🚨 **Reports** (${data.length})\n\n${list}`, actions: [] };
      } catch (e) {
        return { reply: `⚠️ Reports query failed: ${e.message}`, actions: [] };
      }
    },
  },
  {
    patterns: /\b(category|categor|by cat|per cat|breakdown)\b/i,
    handler: async () => {
      try {
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
      } catch (e) {
        return { reply: `⚠️ Category query failed: ${e.message}`, actions: [] };
      }
    },
  },
  {
    patterns: /\b(recent|latest|newest)\s*(posts?|content|feedback|items)?\b/i,
    handler: async () => {
      try {
        const { data } = await supabase.from('posts').select('id,title,category,status,created_at,deleted').order('created_at', { ascending: false }).limit(10);
        const active = (data || []).filter((p) => !p.deleted);
        if (!active.length) return { reply: 'No posts found.', actions: [] };
        const list = active.map((p, i) => `${i + 1}. **${p.title}** [${p.category}] — ${p.status} (${new Date(p.created_at).toLocaleDateString()})`).join('\n');
        return { reply: `📝 **Recent Posts** (last 10)\n\n${list}`, actions: [] };
      } catch (e) {
        return { reply: `⚠️ Recent posts query failed: ${e.message}`, actions: [] };
      }
    },
  },
  // ─── List hidden posts (MUST come before find-posts to avoid "show hidden posts" matching find) ──
  {
    patterns: /\b(list|show|view|see|display|what|all|are)\s*(?:are\s+)?(?:the\s*)?(?:all\s+)?(?:hidden|hidden posts?)\b|\bhidden\s+posts?\b/i,
    handler: async () => {
      try {
        const { data } = await supabase.from('posts').select('id,title,category,hidden,created_at').eq('hidden', true).order('created_at', { ascending: false });
        if (!data?.length) return { reply: 'No hidden posts.', actions: [] };
        const list = data.map((p, i) => `${i + 1}. **${p.title}** [${p.category}] — hidden`).join('\n');
        return { reply: `🫥 **Hidden Posts** (${data.length})\n\n${list}`, actions: [] };
      } catch (e) {
        return { reply: `⚠️ Hidden posts query failed: ${e.message}`, actions: [] };
      }
    },
  },
  // ─── Find posts by keyword ──────────────────────────────────────
  {
    patterns: /\b(find|search|look|show|get|where|which)\s*(?:is|are|the|post|posts?|about)?\s*(.+?)(?:\s*\?)?\s*$/i,
    handler: async (msg) => {
      try {
        const match = msg.match(/\b(find|search|look|show|get|where|which)\s*(?:is|are|the|post|posts?|about)?\s*(.+?)(?:\s*\?)?\s*$/i);
        const query = match?.[2]?.trim();
        if (!query || query.length < 2) return { reply: 'Usage: "find post cricket"', actions: [] };
        const { data } = await supabase.from('posts').select('id,title,category,status,description,created_at,deleted,hidden')
          .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
          .order('created_at', { ascending: false }).limit(10);
        const active = (data || []).filter((p) => !p.deleted);
        if (!active.length) return { reply: `No posts found matching "**${query}**".`, actions: [] };
        const list = active.map((p, i) => `${i + 1}. **${p.title}** [${p.category}] — \`${p.id}\`\n   ${p.status} · ${p.hidden ? 'hidden' : 'visible'} · ${new Date(p.created_at).toLocaleDateString()}`).join('\n');
        return {
          reply: `🔍 **Found ${active.length} post(s)** matching "**${query}**":\n\n${list}\n\nUse the post ID to take action (e.g., "comment on ${active[0].id}: we are working on this").`,
          actions: [],
        };
      } catch (e) {
        return { reply: `⚠️ Search failed: ${e.message}`, actions: [] };
      }
    },
  },
  // ─── Comment on ordinal post (first, latest, last, newest) ──────
  // Handles: "comment on the first post: Thank you for your post"
  //          "reply to the latest post: great work"
  //          "comment on the last post: we're on it"
  {
    patterns: /\b(comment|reply|message|respond|write|post|say|tell|note|update|send|leave|add|put)\b.*?\b(message|comment|note|reply|update|response)?\b.*?\b(first|latest|newest|last|recent|oldest|previous)\s+(?:post|article|feedback|item)?\s*[:\s]+(.+)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(comment|reply|message|respond|write|post|say|tell|note|update|send|leave|add|put)\b.*?\b(message|comment|note|reply|update|response)?\b.*?\b(first|latest|newest|last|recent|oldest|previous)\s+(?:post|article|feedback|item)?\s*[:\s]+(.+)/i);
      if (!match) return null;
      const ordinal = match[3]?.toLowerCase();
      const commentBody = match[4]?.trim();
      if (!commentBody || commentBody.length < 2) return null;

      // Fetch recent posts (enough to cover any ordinal)
      const { data } = await supabase.from('posts').select('id,title,category,status,locked,deleted,created_at')
        .order('created_at', { ascending: ordinal === 'oldest' }).limit(10);
      const active = (data || []).filter((p) => !p.deleted);
      if (!active.length) return { reply: 'No posts found on the platform.', actions: [] };

      // Resolve ordinal to index
      let idx = 0;
      if (ordinal === 'first' || ordinal === 'latest' || ordinal === 'newest' || ordinal === 'recent') idx = 0;
      else if (ordinal === 'last') idx = Math.max(0, active.length - 1);
      else if (ordinal === 'oldest') idx = active.length - 1;
      else idx = 0;

      const post = active[idx];
      if (!post) return { reply: `Could not resolve "${ordinal}" post — only ${active.length} posts exist.`, actions: [] };
      if (post.locked) return { reply: `Post "${post.title}" is locked — comments are disabled.`, actions: [] };

      return {
        reply: `💬 **Comment on Post**\n\nPost: **${post.title}** [${post.category}]\nStatus: ${post.status}\n\nMessage: "${commentBody}"\n\nClick Execute to post this comment as admin.`,
        actions: [{ tool: 'create_comment', args: { post_id: post.id, body: commentBody }, reason: `Comment on "${post.title}": ${commentBody.slice(0, 60)}`, destructive: false }],
      };
    },
  },
  // ─── Comment by post TITLE (natural language) ──────────────────
  // Handles: "send message in comment that we are working on this problem to The cricket ground"
  //          "comment on cricket ground: we are fixing this"
  //          "reply to the post about library hours: done!"
  //          "leave a note on announcement: updated"
  {
    patterns: /\b(send|write|leave|post|add|put)\b.*\b(message|comment|note|reply|update|response)\b/i,
    handler: async (msg) => {
      // Strategy: strip the leading verb+keyword, then split on the last "to/at/on" to get post title
      const stripped = msg.replace(/^\s*(send|write|leave|post|add|put)\b.*?\b(message|comment|note|reply|update|response)\b\s*/i, '').trim();
      // Remove filler words at the start
      const cleaned = stripped.replace(/^(?:in\s+(?:a\s+)?(?:message|comment|note|reply)\s+)?/i, '').trim();

      // Try colon syntax first: "on cricket ground: we are fixing this"
      const colonMatch = cleaned.match(/^(.+?):\s*(.+)$/);
      let commentBody, postQuery;
      if (colonMatch) {
        // With colon, the part before colon is the post reference, after is the message
        // But often the message is before the colon and the post is after
        // Heuristic: if there are spaces in both parts, assume "post: message" format
        postQuery = colonMatch[1].trim();
        commentBody = colonMatch[2].trim();
        // Strip filler words from the post query
        postQuery = postQuery.replace(/^(?:on|to|at|for|about|the|a)\s+/i, '').trim();
        postQuery = postQuery.replace(/\s+(?:post|article|feedback)$/i, '').trim();
      } else {
        // Split on last occurrence of to/on/at/for to separate body from post title
        // Use greedy matching to find the LAST preposition
        const splitMatch = cleaned.match(/^(.+)\b\s+(to|on|at|for)\s+(.+)$/i);
        if (splitMatch) {
          commentBody = splitMatch[1].replace(/^(that|saying|about|regarding|concerning)\s+/i, '').trim();
          postQuery = splitMatch[3].trim();
        } else {
          return null; // let next intent try
        }
      }
      if (!commentBody || !postQuery || commentBody.length < 2) return null;

      // Search for matching posts by title
      const { data } = await supabase.from('posts').select('id,title,category,status,locked,deleted')
        .or(`title.ilike.%${postQuery}%,description.ilike.%${postQuery}%`)
        .order('created_at', { ascending: false }).limit(5);
      const active = (data || []).filter((p) => !p.deleted);
      if (!active.length) return { reply: `No posts found matching "**${postQuery}**". Try "find ${postQuery}" to search, or use the post ID directly.`, actions: [] };
      if (active.length > 1) {
        const list = active.map((p, i) => `${i + 1}. **${p.title}** [${p.category}] — \`${p.id}\``).join('\n');
        return { reply: `🔍 Found ${active.length} posts matching "**${postQuery}**". Which one?\n\n${list}\n\nReply with the post ID or a more specific title.`, actions: [] };
      }
      const post = active[0];
      if (post.locked) return { reply: `Post "${post.title}" is locked — comments are disabled.`, actions: [] };
      return {
        reply: `💬 **Comment on Post**\n\nPost: **${post.title}** [${post.category}]\nStatus: ${post.status}\n\nMessage: "${commentBody}"\n\nClick Execute to post this comment as admin.`,
        actions: [{ tool: 'create_comment', args: { post_id: post.id, body: commentBody }, reason: `Comment on "${post.title}": ${commentBody.slice(0, 60)}`, destructive: false }],
      };
    },
  },
  // ─── Comment / reply / message on a post (by ID) ───────────────
  {
    patterns: /\b(comment|reply|message|respond|write|post|say|tell|note|update)\s*(?:on|to|in|under|for|about)?\s*(?:post\s*)?(\w{8,})\s*[:\s]+(.+)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(comment|reply|message|respond|write|post|say|tell|note|update)\s*(?:on|to|in|under|for|about)?\s*(?:post\s*)?(\w{8,})\s*[:\s]+(.+)/i);
      const postId = match?.[2];
      const commentBody = match?.[3]?.trim();
      if (!postId || !commentBody) return { reply: 'Usage: "comment on [post_id]: your message"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,category,status,locked').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found. Use "find [keyword]" to search for posts.`, actions: [] };
      if (post.locked) return { reply: `Post "${post.title}" is locked — comments are disabled.`, actions: [] };
      return {
        reply: `💬 **Comment on Post**\n\nPost: **${post.title}** [${post.category}]\nStatus: ${post.status}\n\nMessage: "${commentBody}"\n\nClick Execute to post this comment as admin.`,
        actions: [{ tool: 'create_comment', args: { post_id: postId, body: commentBody }, reason: `Comment on "${post.title}": ${commentBody.slice(0, 60)}`, destructive: false }],
      };
    },
  },
  // ─── Post status update ─────────────────────────────────────────
  {
    patterns: /\b(set|change|update|mark)\s*(?:post)?\s*(?:status)?\s*(\w{8,})\s*(?:to)?\s*(in_progress|in-progress|progress|solved|done|fixed|reported|reviewing|planned)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(set|change|update|mark)\s*(?:post)?\s*(?:status)?\s*(\w{8,})\s*(?:to)?\s*(in_progress|in-progress|progress|solved|done|fixed|reported|reviewing|planned)/i);
      const postId = match?.[2];
      let status = match?.[3]?.toLowerCase();
      if (status === 'in-progress' || status === 'progress') status = 'in_progress';
      if (status === 'done' || status === 'fixed') status = 'solved';
      if (!postId) return { reply: 'Usage: "set status [post_id] to in_progress"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,status').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      return {
        reply: `📋 **Update Status**\n\nPost: **${post.title}**\nCurrent: ${post.status}\nNew: ${status}\n\nClick Execute to update.`,
        actions: [{ tool: 'update_post', args: { post_id: postId, status }, reason: `Change "${post.title}" status to ${status}`, destructive: false }],
      };
    },
  },
  // ─── View post details ──────────────────────────────────────────
  {
    patterns: /\b(view|show|open|see|details?|info)\s*(?:post)?\s*(\w{8,})/i,
    handler: async (msg) => {
      const match = msg.match(/\b(view|show|open|see|details?|info)\s*(?:post)?\s*(\w{8,})/i);
      const postId = match?.[2];
      if (!postId) return { reply: 'Usage: "view post [id]"', actions: [] };
      const { data: post } = await supabase.from('posts').select('*').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      const { count } = await supabase.from('comments').select('*', { count: 'exact', head: true }).eq('post_id', postId);
      return {
        reply: `📄 **Post Details**\n\n` +
          `**Title:** ${post.title}\n` +
          `**Category:** ${post.category}\n` +
          `**Status:** ${post.status} · Priority: ${post.priority}\n` +
          `**Author:** \`${post.author_id}\`\n` +
          `**Created:** ${new Date(post.created_at).toLocaleString()}\n` +
          `**Comments:** ${count || 0}\n` +
          `**Reactions:** ${JSON.stringify(post.reactions || {})}\n` +
          `${post.description ? `\n**Description:** ${post.description.slice(0, 300)}` : ''}\n` +
          `${post.admin_reply ? `\n**Admin reply:** ${post.admin_reply}` : ''}`,
        actions: [],
      };
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
    patterns: /\b(create|make|new)\s*(?:a\s*)?(?:poll|survey|vote)\s*:?\s*(.+)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(create|make|new)\s*(?:a\s*)?(?:poll|survey|vote)\s*:?\s*(.+)/i);
      const title = match?.[2]?.trim();
      if (!title) return { reply: 'Usage: "create poll: [title]"', actions: [] };
      return {
        reply: `📊 **Create Poll**\n\nTitle: **${title}**\nOptions: Yes / No\nType: yesno\n\nClick Execute to create this poll.`,
        actions: [{ tool: 'create_poll', args: { title, options: ['Yes', 'No'], ptype: 'yesno' }, reason: `Create poll: ${title}`, destructive: false }],
      };
    },
  },
  {
    patterns: /\b(poll|polls?|vote|voting|survey|survey)\b/i,
    handler: async () => {
      const { data } = await supabase.from('polls').select('id,title,archived,created_at').order('created_at', { ascending: false });
      if (!data?.length) return { reply: 'No polls found.', actions: [] };
      const list = data.map((p, i) => `${i + 1}. **${p.title}** ${p.archived ? '(archived)' : '(active)'}`).join('\n');
      return { reply: `📊 **Polls** (${data.length})\n\n${list}`, actions: [] };
    },
  },
  // ─── Clear announcement (MUST come before general "announcement" intent) ──
  {
    patterns: /\b(clear|remove|delete|disable)\s*(?:the\s*)?(?:announcement|banner|notice)/i,
    handler: async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', 'announcement').maybeSingle();
      const ann = data?.value;
      if (!ann?.text || !ann?.enabled) return { reply: 'No active announcement to clear.', actions: [] };
      return {
        reply: `📢 **Clear Announcement**\n\nCurrent: "${ann.text}"\n\nClick Execute to remove this announcement.`,
        actions: [{ tool: 'clear_announcement', args: {}, reason: 'Clear site announcement', destructive: false }],
      };
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
  // ─── Hide/show post by ID (MUST come before "list hidden posts") ──
  {
    patterns: /\b(hide|show|unhide)\s*(?:the\s*)?(?:post)?\s*(\w{8,})/i,
    handler: async (msg) => {
      const match = msg.match(/\b(hide|show|unhide)\s*(?:the\s*)?(?:post)?\s*(\w{8,})/i);
      const postId = match?.[2];
      const action = match?.[1]?.toLowerCase();
      if (!postId) return { reply: 'Usage: "hide post [id]"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,category,hidden').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      const willHide = action === 'hide' || action === 'show';
      return {
        reply: `${post.hidden ? 'Post is already hidden' : 'Ready to hide'}: **${post.title}** [${post.category}]\n\nClick Execute to ${post.hidden ? 'unhide' : 'hide'} this post.`,
        actions: [{ tool: 'hide_post', args: { post_id: postId, hidden: willHide && !post.hidden }, reason: post.hidden ? `Unhide post: ${post.title}` : `Hide post: ${post.title}`, destructive: false }],
      };
    },
  },
  // ─── Set priority on a post ──────────────────────────────────────
  {
    patterns: /\b(set|change|make)\s*(?:the\s*)?(?:priority|urgency)\s*(?:of\s*)?(?:post)?\s*(\w{8,})\s*(?:to)?\s*(high|medium|low|critical|urgent)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(set|change|make)\s*(?:the\s*)?(?:priority|urgency)\s*(?:of\s*)?(?:post)?\s*(\w{8,})\s*(?:to)?\s*(high|medium|low|critical|urgent)/i);
      const postId = match?.[2]; const priority = match?.[3]?.toLowerCase();
      if (!postId) return { reply: 'Usage: "set priority [post_id] to high"', actions: [] };
      if (priority === 'critical' || priority === 'urgent') return { reply: 'Priority must be high, medium, or low.', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,priority').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      return {
        reply: `⬆️ **Set Priority**\n\nPost: **${post.title}**\nCurrent: ${post.priority}\nNew: ${priority}\n\nClick Execute to update.`,
        actions: [{ tool: 'set_priority', args: { post_id: postId, priority }, reason: `Set "${post.title}" priority to ${priority}`, destructive: false }],
      };
    },
  },
  // ─── Admin reply to a post ───────────────────────────────────────
  {
    patterns: /\b(reply|respond|answer)\s*(?:to)?\s*(?:post)?\s*(\w{8,})\s*[:\s]+(.+)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(reply|respond|answer)\s*(?:to)?\s*(?:post)?\s*(\w{8,})\s*[:\s]+(.+)/i);
      const postId = match?.[2]; const replyText = match?.[3]?.trim();
      if (!postId || !replyText) return { reply: 'Usage: "reply to [post_id]: your message"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,category,admin_reply').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      return {
        reply: `💬 **Admin Reply**\n\nPost: **${post.title}** [${post.category}]\n${post.admin_reply ? `Current reply: "${post.admin_reply.slice(0, 50)}…"` : 'No reply yet'}\n\nNew reply: "${replyText}"\n\nClick Execute to post.`,
        actions: [{ tool: 'admin_reply', args: { post_id: postId, reply: replyText }, reason: `Reply to "${post.title}": ${replyText.slice(0, 60)}`, destructive: false }],
      };
    },
  },
  // ─── Lock/unlock post ────────────────────────────────────────────
  {
    patterns: /\b(lock|unlock|disable|enable)\s*(?:comments?\s*(?:on|for)?)?\s*(?:post)?\s*(\w{8,})/i,
    handler: async (msg) => {
      const match = msg.match(/\b(lock|unlock|disable|enable)\s*(?:comments?\s*(?:on|for)?)?\s*(?:post)?\s*(\w{8,})/i);
      const postId = match?.[2]; const action = match?.[1]?.toLowerCase();
      if (!postId) return { reply: 'Usage: "lock post [id]"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,category,locked').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      const willLock = action === 'lock' || action === 'disable';
      return {
        reply: `🔒 **${post.locked ? 'Unlock' : 'Lock'} Post**\n\nPost: **${post.title}** [${post.category}]\nCurrent: ${post.locked ? 'Locked' : 'Unlocked'}\n\nClick Execute to ${post.locked ? 'unlock (enable comments)' : 'lock (disable comments)'}.`,
        actions: [{ tool: 'lock_post', args: { post_id: postId, locked: willLock && !post.locked }, reason: post.locked ? `Unlock comments on "${post.title}"` : `Lock comments on "${post.title}"`, destructive: false }],
      };
    },
  },
  // ─── Pin/unpin post ──────────────────────────────────────────────
  {
    patterns: /\b(pin|unpin)\s*(?:the\s*)?(?:post)?\s*(\w{8,})/i,
    handler: async (msg) => {
      const match = msg.match(/\b(pin|unpin)\s*(?:the\s*)?(?:post)?\s*(\w{8,})/i);
      const postId = match?.[2]; const action = match?.[1]?.toLowerCase();
      if (!postId) return { reply: 'Usage: "pin post [id]"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,category,pinned').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      return {
        reply: `📌 **${post.pinned ? 'Unpin' : 'Pin'} Post**\n\nPost: **${post.title}** [${post.category}]\nCurrent: ${post.pinned ? 'Pinned' : 'Not pinned'}\n\nClick Execute to ${post.pinned ? 'unpin' : 'pin to top'}.`,
        actions: [{ tool: 'pin_post', args: { post_id: postId, pinned: action === 'pin' && !post.pinned }, reason: post.pinned ? `Unpin "${post.title}"` : `Pin "${post.title}" to top`, destructive: false }],
      };
    },
  },
  // ─── Feature/unfeature post ──────────────────────────────────────
  {
    patterns: /\b(feature|unfeature)\s*(?:the\s*)?(?:post)?\s*(\w{8,})/i,
    handler: async (msg) => {
      const match = msg.match(/\b(feature|unfeature)\s*(?:the\s*)?(?:post)?\s*(\w{8,})/i);
      const postId = match?.[2]; const action = match?.[1]?.toLowerCase();
      if (!postId) return { reply: 'Usage: "feature post [id]"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,category,featured').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      return {
        reply: `⭐ **${post.featured ? 'Unfeature' : 'Feature'} Post**\n\nPost: **${post.title}** [${post.category}]\nCurrent: ${post.featured ? 'Featured' : 'Not featured'}\n\nClick Execute to ${post.featured ? 'remove from featured' : 'feature on homepage'}.`,
        actions: [{ tool: 'feature_post', args: { post_id: postId, featured: action === 'feature' && !post.featured }, reason: post.featured ? `Unfeature "${post.title}"` : `Feature "${post.title}"`, destructive: false }],
      };
    },
  },
  // ─── Search users ────────────────────────────────────────────────
  {
    patterns: /\b(search|find|look|who)\s*(?:is\s+)?(?:user|account|people|anonymous)\s*(.+)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(search|find|look|who)\s*(?:is\s+)?(?:user|account|people|anonymous)\s*(.+)/i);
      const query = match?.[2]?.trim();
      if (!query || query.length < 2) return { reply: 'Usage: "search user [anonymous_id or keyword]"', actions: [] };
      const { data } = await supabase.from('users_meta').select('*').or(`anon_id.ilike.%${query}%`).order('last_seen', { ascending: false }).limit(10);
      if (!data?.length) return { reply: `No users found matching "**${query}**".`, actions: [] };
      const list = data.map((u, i) => `${i + 1}. \`${u.anon_id}\` — ${u.banned ? '🔴 BANNED' : '🟢 Active'} · strikes: ${u.strikes || 0} · spam: ${u.spam_score || 0}`).join('\n');
      return { reply: `👤 **Users matching "${query}"**\n\n${list}`, actions: [] };
    },
  },
  // ─── Set ETA on post ────────────────────────────────────────────
  {
    patterns: /\b(set|change|update)\s*(?:the\s*)?(?:eta|deadline|estimate|timeframe)\s*(?:of\s*)?(?:post)?\s*(\w{8,})\s*(?:to)?\s*(.+)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(set|change|update)\s*(?:the\s*)?(?:eta|deadline|estimate|timeframe)\s*(?:of\s*)?(?:post)?\s*(\w{8,})\s*(?:to)?\s*(.+)/i);
      const postId = match?.[2]; const eta = match?.[3]?.trim();
      if (!postId || !eta) return { reply: 'Usage: "set eta [post_id] to end of march"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,eta').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      return {
        reply: `📅 **Set ETA**\n\nPost: **${post.title}**\nCurrent ETA: ${post.eta || 'none'}\nNew ETA: ${eta}\n\nClick Execute to update.`,
        actions: [{ tool: 'set_eta', args: { post_id: postId, eta }, reason: `Set ETA for "${post.title}" to ${eta}`, destructive: false }],
      };
    },
  },
  // ─── Assign post to moderator ────────────────────────────────────
  {
    patterns: /\b(assign|delegate|give)\s*(?:post)?\s*(\w{8,})\s*(?:to)?\s*(.+)/i,
    handler: async (msg) => {
      const match = msg.match(/\b(assign|delegate|give)\s*(?:post)?\s*(\w{8,})\s*(?:to)?\s*(.+)/i);
      const postId = match?.[2]; const assignee = match?.[3]?.trim();
      if (!postId || !assignee) return { reply: 'Usage: "assign [post_id] to [person]"', actions: [] };
      const { data: post } = await supabase.from('posts').select('id,title,assigned_to').eq('id', postId).maybeSingle();
      if (!post) return { reply: `Post \`${postId}\` not found.`, actions: [] };
      return {
        reply: `👤 **Assign Post**\n\nPost: **${post.title}**\nCurrent assignee: ${post.assigned_to || 'none'}\nNew assignee: ${assignee}\n\nClick Execute to assign.`,
        actions: [{ tool: 'assign_post', args: { post_id: postId, assigned_to: assignee }, reason: `Assign "${post.title}" to ${assignee}`, destructive: false }],
      };
    },
  },
  // ─── Create presentation / report / slide deck ─────────────────
  {
    patterns: /\b(make|create|build|generate|prepare)\b.*\b(presentation|report|slide|deck|slideshow|ppt|powerpoint)\b/i,
    handler: async (msg) => {
      const match = msg.match(/\b(make|create|build|generate|prepare)\b.*\b(presentation|report|slide|deck|slideshow|ppt|powerpoint)\b/i);
      // Extract topic from message
      let topic = 'Weekly Problems Report';
      const topicMatch = msg.match(/(?:on|about|for|of|regarding)\s+(?:this\s+)?(?:week|month|today|week'?s?|month'?s?)?\s*(.+?)$/i);
      if (topicMatch) topic = topicMatch[1].trim();
      else {
        const altMatch = msg.match(/(?:on|about|for|of)\s+(.+?)$/i);
        if (altMatch) topic = altMatch[1].trim();
      }
      // Detect period
      let period = 'week';
      if (/\b(month|monthly)\b/i.test(msg)) period = 'month';
      else if (/\b(today|daily|day)\b/i.test(msg)) period = 'day';
      else if (/\b(all|ever|everything|all time)\b/i.test(msg)) period = 'all';

      // First fetch the data to show preview
      const since = new Date();
      if (period === 'week') since.setDate(since.getDate() - 7);
      else if (period === 'month') since.setMonth(since.getMonth() - 1);
      else if (period === 'day') since.setDate(since.getDate() - 1);

      let query = supabase.from('posts').select('id,title,category,status,priority,created_at,deleted');
      if (period !== 'all') query = query.gte('created_at', since.toISOString());
      const { data: posts } = await query.order('created_at', { ascending: false });
      const active = (posts || []).filter((p) => !p.deleted);

      if (!active.length) {
        return { reply: `📊 No posts found for the selected period (${period}). Nothing to present.`, actions: [] };
      }

      // Build preview
      const cats = {};
      active.forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
      const periodLabel = period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : period === 'day' ? 'Today' : 'All Time';

      return {
        reply: `📊 **Presentation Generator**\n\n` +
          `**Topic:** ${topic}\n` +
          `**Period:** ${periodLabel}\n` +
          `**Data:** ${active.length} posts found\n` +
          `**Categories:** ${Object.entries(cats).map(([k, v]) => `${k} (${v})`).join(', ')}\n\n` +
          `Click Execute to generate a full HTML presentation with:\n` +
          `• Title slide with key stats\n` +
          `• Category & status breakdown charts\n` +
          `• Individual problem slides (up to 15)\n` +
          `• Action items summary\n` +
          `• Keyboard navigation (← → arrows)\n\n` +
          `The presentation will open in a new tab.`,
        actions: [{
          tool: 'create_presentation',
          args: { topic, period, post_ids: active.slice(0, 20).map((p) => p.id) },
          reason: `Generate presentation: ${topic} (${active.length} posts, ${periodLabel})`,
          destructive: false,
        }],
      };
    },
  },
  // ─── Greetings ─────────────────────────────────────────────────
  {
    patterns: /^(hi|hello|hey|yo|sup|good\s*(morning|afternoon|evening)|greetings|howdy|hola)\s*[!.?]*$/i,
    handler: async () => {
      // Pull quick stats for a personalized greeting
      const [{ count: posts }, { count: users }, { data: recent }] = await Promise.all([
        supabase.from('posts').select('*', { count: 'exact', head: true }),
        supabase.from('users_meta').select('*', { count: 'exact', head: true }),
        supabase.from('posts').select('id,title,status,created_at,deleted').eq('deleted', false).order('created_at', { ascending: false }).limit(3),
      ]);
      const recentList = (recent || []).map((p) => `  • **${p.title}** (${p.status})`).join('\n');
      const hour = new Date().getHours();
      const timeGreet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      return {
        reply: `${timeGreet}! 👋 I'm your Voice Box admin assistant.\n\n` +
          `**Quick snapshot:** ${posts || 0} posts from ${users || 0} users\n` +
          `${recentList ? `**Latest:**\n${recentList}\n\n` : ''}` +
          `What would you like to do? Try asking me to:\n` +
          `• Show analytics or trends\n` +
          `• Find or manage specific posts\n` +
          `• Check what needs your attention\n` +
          `• Or just ask me anything about the platform`,
        actions: [],
      };
    },
  },
  // ─── "What should I do" / priorities / urgency ────────────────
  {
    patterns: /\b(what\s+(should|can|do)\s+(I|we)|priorit|urgent|urgent|need.?attention|what.?s?\s+(important|critical|hot|pending)|which\s+(posts?|issues?|problems?)\s+(need|require| deserve))\b/i,
    handler: async () => {
      const { data: posts } = await supabase.from('posts').select('id,title,category,status,priority,created_at,deleted,hidden,reactions,comment_count')
        .eq('deleted', false).order('created_at', { ascending: false });
      const active = (posts || []).filter((p) => !p.hidden);
      if (!active.length) return { reply: '✅ No active posts right now. The platform is quiet.', actions: [] };

      const now = Date.now();
      const suggestions = [];

      // Critical: safety keywords + still open
      const urgentWords = /\b(urgent|danger|unsafe|injur|threat|bully|harass|emergency|fire|leak|assault|violence|abuse)\b/i;
      const safetyCats = ['Bullying', 'Security', 'Medical'];
      const critical = active.filter((p) => (p.status !== 'solved') && (urgentWords.test(p.title) || safetyCats.includes(p.category)));
      if (critical.length) {
        suggestions.push(`🔴 **Needs immediate attention** (${critical.length} safety-related posts):`);
        critical.slice(0, 3).forEach((p) => suggestions.push(`  • **${p.title}** [${p.category}] — ${p.status} (posted ${Math.round((now - +new Date(p.created_at)) / 3600000)}h ago)`));
      }

      // High engagement but unresolved
      const highEngagement = active.filter((p) => p.status !== 'solved' && p.status !== 'archived' && ((p.reactions?.support || 0) >= 3 || (p.comment_count || 0) >= 3));
      if (highEngagement.length) {
        suggestions.push(`\n🟡 **High community interest** (${highEngagement.length} posts with 3+ reactions/comments):`);
        highEngagement.slice(0, 3).forEach((p) => suggestions.push(`  • **${p.title}** — ${p.status}, ${(p.reactions?.support || 0)} supports, ${p.comment_count || 0} comments`));
      }

      // Old unresolved posts
      const stale = active.filter((p) => p.status === 'reported' && (now - +new Date(p.created_at)) > 7 * 86400000);
      if (stale.length) {
        suggestions.push(`\n🟠 **Stale reports** (${stale.length} posts over 7 days old):`);
        stale.slice(0, 3).forEach((p) => suggestions.push(`  • **${p.title}** — reported ${Math.round((now - +new Date(p.created_at)) / 86400000)} days ago`));
      }

      // Solved without admin reply
      const solvedNoReply = active.filter((p) => p.status === 'solved' && !p.admin_reply);
      if (solvedNoReply.length) {
        suggestions.push(`\n💬 **Closed-loop opportunity** (${solvedNoReply.length} solved posts without admin reply):`);
        solvedNoReply.slice(0, 2).forEach((p) => suggestions.push(`  • **${p.title}** — consider posting a reply to close the loop`));
      }

      if (!suggestions.length) {
        return { reply: '✅ Everything looks good! No urgent issues, no stale posts, no unresolved high-engagement items.\n\nTry "show analytics" for a full overview.', actions: [] };
      }

      return {
        reply: `🎯 **Here's what needs your attention:**\n\n${suggestions.join('\n')}\n\nTell me which one to tackle first, or say "help" to see all commands.`,
        actions: [],
      };
    },
  },
  // ─── Trends / "how are things going" ──────────────────────────
  {
    patterns: /\b(how(?:'?s| is| are)\s+(things?|everything|the\s+(platform|board|school|situation|board)|it going|status)|trend|trending|pattern|overall|how\s+are\s+we\s+doing)\b/i,
    handler: async () => {
      const since7d = new Date(); since7d.setDate(since7d.getDate() - 7);
      const since30d = new Date(); since30d.setDate(since30d.getDate() - 30);
      const [{ data: recent }, { data: older }, { data: allPosts }] = await Promise.all([
        supabase.from('posts').select('id,category,status,created_at,deleted').eq('deleted', false).gte('created_at', since7d.toISOString()),
        supabase.from('posts').select('id,category,status,created_at,deleted').eq('deleted', false).gte('created_at', since30d.toISOString()).lt('created_at', since7d.toISOString()),
        supabase.from('posts').select('id,status,deleted,hidden').eq('deleted', false),
      ]);
      const thisWeek = recent || [];
      const lastWeek = older || [];
      const totalActive = (allPosts || []).filter((p) => !p.hidden);

      const weekCats = {};
      thisWeek.forEach((p) => { weekCats[p.category] = (weekCats[p.category] || 0) + 1; });
      const topCat = Object.entries(weekCats).sort((a, b) => b[1] - a[1])[0];

      const weekStatus = {};
      thisWeek.forEach((p) => { weekStatus[p.status] = (weekStatus[p.status] || 0) + 1; });
      const solvedWeek = weekStatus.solved || 0;
      const reportedWeek = weekStatus.reported || 0;

      const trend = thisWeek.length > lastWeek.length ? '📈' : thisWeek.length < lastWeek.length ? '📉' : '➡️';
      const trendWord = thisWeek.length > lastWeek.length ? 'up' : thisWeek.length < lastWeek.length ? 'down' : 'steady';
      const pctChange = lastWeek.length > 0 ? Math.round(((thisWeek.length - lastWeek.length) / lastWeek.length) * 100) : 0;

      // Outstanding items
      const unresolved = totalActive.filter((p) => p.status !== 'solved' && p.status !== 'archived');

      return {
        reply: `${trend} **Platform Health — This Week vs Last Week**\n\n` +
          `**New posts this week:** ${thisWeek.length} (${trendWord} ${Math.abs(pctChange)}% from last week's ${lastWeek.length})\n` +
          `**Resolved this week:** ${solvedWeek}\n` +
          `**Reported this week:** ${reportedWeek}\n` +
          `**Outstanding:** ${unresolved.length} unresolved posts\n\n` +
          `${topCat ? `**Hot topic:** ${topCat[0]} (${topCat[1]} posts this week)\n` : ''}` +
          `**Total active:** ${totalActive.length} posts on the board\n\n` +
          `${unresolved.length > 10 ? `⚠️ You have ${unresolved.length} unresolved posts — say "what should I do" for priorities.` : '✅ Post volume is manageable.'}`,
        actions: [],
      };
    },
  },
  // ─── "What happened today" / time-based ───────────────────────
  {
    patterns: /\b(what\s+(happened|went|is happening|'s happening|is new|'s new|changed)\s*(today|this morning|this afternoon|this evening|lately|recently|since|since yesterday)?)\b/i,
    handler: async () => {
      const since = new Date(); since.setDate(since.getDate() - 1);
      const [{ data: newPosts }, { data: newComments }, { data: logs }] = await Promise.all([
        supabase.from('posts').select('id,title,category,status,created_at,deleted,author_id').eq('deleted', false).gte('created_at', since.toISOString()).order('created_at', { ascending: false }),
        supabase.from('comments').select('id,post_id,body,author_id,created_at,is_admin').gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(10),
        supabase.from('activity_logs').select('*').gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(10),
      ]);

      const lines = [`📋 **What happened in the last 24 hours:**\n`];

      if (newPosts?.length) {
        lines.push(`**New posts (${newPosts.length}):**`);
        newPosts.slice(0, 5).forEach((p) => lines.push(`  • **${p.title}** [${p.category}] — ${p.status}`));
        if (newPosts.length > 5) lines.push(`  ...and ${newPosts.length - 5} more`);
      } else {
        lines.push(`**No new posts** in the last 24 hours.`);
      }

      if (newComments?.length) {
        lines.push(`\n**New comments (${newComments.length}):**`);
        newComments.slice(0, 5).forEach((c) => lines.push(`  • ${c.is_admin ? '👤 Admin' : '💬 User'} on post \`${c.post_id.slice(0, 8)}\` — "${(c.body || '').slice(0, 60)}"`));
      }

      if (logs?.length) {
        const adminActions = logs.filter((l) => l.actor !== 'system');
        if (adminActions.length) {
          lines.push(`\n**Admin actions (${adminActions.length}):**`);
          adminActions.slice(0, 5).forEach((l) => lines.push(`  • [${l.actor}] ${l.action} — ${(l.detail || '').slice(0, 60)}`));
        }
      }

      if (lines.length === 1) lines.push(`Quiet day — nothing new in the last 24 hours.`);

      return { reply: lines.join('\n'), actions: [] };
    },
  },
  // ─── Opinions / recommendations / advice ──────────────────────
  {
    patterns: /\b(what do you think|recommend|suggestion|advice|best\s+(way|approach)|should I|opinion|your thoughts|what'?s?\s+your\s+take|any\s+(ideas?|suggestions?|tips?))\b/i,
    handler: async () => {
      const [{ data: posts }, { data: reports }, { data: users }] = await Promise.all([
        supabase.from('posts').select('id,title,category,status,priority,created_at,deleted,hidden,reactions,comment_count,admin_reply')
          .eq('deleted', false).order('created_at', { ascending: false }),
        supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(10),
        supabase.from('users_meta').select('anon_id,banned,strikes,spam_score,last_seen'),
      ]);

      const active = (posts || []).filter((p) => !p.hidden);
      const tips = [];

      // Unresolved high-priority
      const highPri = active.filter((p) => p.priority === 'high' && p.status !== 'solved');
      if (highPri.length) tips.push(`🔴 **Address ${highPri.length} high-priority post(s) first** — these have been flagged as important by the community.`);

      // Unreplied solved posts
      const unreplied = active.filter((p) => p.status === 'solved' && !p.admin_reply);
      if (unreplied.length) tips.push(`💬 **Reply to ${unreplied.length} solved post(s)** — quick "we fixed this" replies build community trust.`);

      // Stale reported posts
      const stale = active.filter((p) => p.status === 'reported' && (Date.now() - +new Date(p.created_at)) > 5 * 86400000);
      if (stale.length) tips.push(`⏰ **Triage ${stale.length} stale reported post(s)** — they've been waiting 5+ days without a status update.`);

      // Spam users
      const spamUsers = (users || []).filter((u) => !u.banned && (u.spam_score || 0) >= 3);
      if (spamUsers.length) tips.push(`🛡️ **Review ${spamUsers.length} flagged user(s)** — spam score is elevated. Consider warning or banning.`);

      // Pending reports
      if (reports?.length) tips.push(`🚨 **Review ${reports.length} pending report(s)** — flagged content needs moderation.`);

      // General engagement tip
      const totalPosts = active.length;
      const totalReplied = active.filter((p) => p.admin_reply).length;
      if (totalPosts > 0 && totalReplied / totalPosts < 0.3) {
        tips.push(`📊 **Your reply rate is ${Math.round((totalReplied / totalPosts) * 100)}%** — aim for 50%+ to show the community you're listening.`);
      }

      if (!tips.length) tips.push(`✅ **Platform is healthy** — no urgent recommendations. Keep up the good work!`);

      return {
        reply: `💡 **My recommendations:**\n\n${tips.join('\n\n')}\n\nTell me which one to help with.`,
        actions: [],
      };
    },
  },
  // ─── Thank you / acknowledgment ───────────────────────────────
  {
    patterns: /^(thanks?|thank you|ty|thx|good job|nice|great|perfect|awesome|cool|ok|okay|got it|understood|makes sense|noted)\s*[!.?]*$/i,
    handler: async () => ({
      reply: `You're welcome! Let me know if you need anything else — I'm here to help manage the board.\n\nQuick things I can do:\n• Show analytics or trends\n• Find and manage posts\n• Check what needs attention\n• Generate reports`,
      actions: [],
    }),
  },
  // ─── "Tell me about" / explain something ──────────────────────
  {
    patterns: /\b(tell me about|explain|what is|what are|how does|how do)\s+(.+?)(?:\s*\?)?\s*$/i,
    handler: async (msg) => {
      const match = msg.match(/\b(tell me about|explain|what is|what are|how does|how do)\s+(.+?)(?:\s*\?)?\s*$/i);
      const topic = match?.[2]?.trim().toLowerCase();
      if (!topic) return null;

      // Platform-specific knowledge
      const knowledge = {
        'voice box': 'Voice Box is an anonymous feedback platform for schools. Students can post problems, suggestions, and ideas. Admins review, respond, and track resolution. All posts are anonymous — users get a generated anonymous ID.',
        'anonymous': 'Users are identified by anonymous IDs (like `anon_xyz123`). Their identity is never revealed. Admins can see their post history and activity, but not their real name or email.',
        'posts': 'Posts are the core content — students submit problems, suggestions, or ideas. Each post has a category (e.g., Facilities, Academic), status (reported → verified → in_progress → solved), and priority level.',
        'categories': 'Posts are organized by category. Common categories include Facilities, Academic, Bullying, Security, Medical, and General. You can filter and analyze by category.',
        'status': 'Post lifecycle: Reported → Verified → In Progress → Waiting → Solved → Archived. The status shows where each post is in the resolution process.',
        'priority': 'Posts have three priority levels: High, Medium, Low. Safety-related posts (bullying, security, medical) should be High priority.',
        'polls': 'Polls let admins survey the student body. You can create yes/no polls, multiple-choice polls, or rating polls. Students vote anonymously.',
        'announcements': 'Announcements are site-wide messages shown to all users. Great for important updates, event notices, or policy changes.',
        'reactions': 'Students can react to posts with support, agree, or other reaction types. High-reaction posts indicate community interest and should be prioritized.',
        'comments': 'Both students and admins can comment on posts. Admin comments are marked with a special badge. Comments help communicate resolution status.',
        'reports': 'Reports are flags on posts that may violate guidelines. They need admin review. You can see reported posts with "show reports".',
        'banning': 'Banning prevents a user from posting. Use for persistent spam or harassment. You can unban later if needed. Warnings are lighter — they track behavior without blocking.',
      };

      // Try exact match first, then partial
      let answer = knowledge[topic];
      if (!answer) {
        const partial = Object.entries(knowledge).find(([k]) => topic.includes(k) || k.includes(topic));
        if (partial) answer = partial[1];
      }

      if (answer) return { reply: `📖 **${topic}**\n\n${answer}`, actions: [] };

      // Try to search posts about this topic
      const { data } = await supabase.from('posts').select('id,title,category,status')
        .or(`title.ilike.%${topic}%,description.ilike.%${topic}%`)
        .eq('deleted', false).order('created_at', { ascending: false }).limit(5);

      if (data?.length) {
        const list = data.map((p) => `  • **${p.title}** [${p.category}] — ${p.status}`).join('\n');
        return { reply: `🔍 I found ${data.length} post(s) related to "**${topic}**":\n\n${list}\n\nSay "view post [id]" for details, or "find ${topic}" for a full search.`, actions: [] };
      }

      return null; // let fallback handle it
    },
  },
  // ─── Help ──────────────────────────────────────────────────────
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
        `  • "Hidden posts" — posts hidden from public view\n` +
        `  • "Search user [query]" — find users by ID\n\n` +
        `**Actions (need your approval):**\n` +
        `  • "Hide post [id]" — hide/unhide a post\n` +
        `  • "Delete post [id]" — soft-delete a post\n` +
        `  • "Lock post [id]" — disable comments\n` +
        `  • "Pin post [id]" — pin to top\n` +
        `  • "Feature post [id]" — feature on homepage\n` +
        `  • "Set priority [id] to high" — change priority\n` +
        `  • "Set eta [id] to end of month" — set ETA\n` +
        `  • "Assign [id] to [person]" — assign moderator\n` +
        `  • "Reply to [id]: [text]" — admin reply\n` +
        `  • "Ban user [id]" — ban an anonymous user\n` +
        `  • "Warn user [id] for [reason]" — issue warning\n` +
        `  • "Create poll: [title]" — create a new poll\n` +
        `  • "Set announcement: [text]" — post announcement\n` +
        `  • "Clear announcement" — remove announcement\n` +
        `  • "Comment on [id]: [text]" or "comment on [title]: [text]" — admin comment\n` +
        `  • "Make presentation on this week's problems" — generate HTML slide deck\n\n` +
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
    patterns: /\b(unban|unblock|restore)\s*(user|account)?\s*(\w+)?/i,
    handler: async (msg) => {
      const match = msg.match(/\b(unban|unblock|restore)\s*(?:user|account)?\s*(\w+)/i);
      const anonId = match?.[2];
      if (!anonId) return { reply: 'Usage: "unban user [anonymous_id]"', actions: [] };
      const { data: user } = await supabase.from('users_meta').select('*').eq('anon_id', anonId.toLowerCase()).maybeSingle();
      if (!user) return { reply: `User \`${anonId}\` not found.`, actions: [] };
      if (!user.banned) return { reply: `User \`${anonId}\` is not banned.`, actions: [] };
      return {
        reply: `✅ **Unban User**\n\nUser: \`${anonId}\`\n\nReady to unban — click Execute to confirm.`,
        actions: [{ tool: 'unban_user', args: { anon_id: anonId }, reason: `Unban user ${anonId}` }],
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

// ─── Default fallback — context-aware smart response ──────────────
async function fallbackHandler(message, ctx = {}) {
  const { postCount = 0, userCount = 0, commentCount = 0, activePosts = [], recentActivity = [] } = ctx;

  // If we have context, give a smart response
  if (postCount > 0 || userCount > 0) {
    const unresolved = activePosts.filter((p) => p.status !== 'solved' && p.status !== 'archived');
    const urgentWords = /\b(urgent|danger|unsafe|injur|threat|bully|harass|emergency|fire|leak|abuse)\b/i;
    const urgent = activePosts.filter((p) => urgentWords.test(p.title));

    let guidance = '';
    if (urgent.length) {
      guidance += `⚠️ **${urgent.length} urgent safety-related posts detected.** Say "show urgent posts" to review them.\n\n`;
    }
    if (unresolved.length > 5) {
      guidance += `📊 **${unresolved.length} unresolved posts.** Say "what should I do" for priorities.\n\n`;
    }

    return {
      reply: `I understand you're asking about "${message.slice(0, 80)}".\n\n` +
        `**Platform snapshot:** ${postCount} posts, ${userCount} users, ${commentCount} comments\n\n` +
        guidance +
        `I can help you with:\n` +
        `• **Analytics** — "show analytics", "trends this week", "category breakdown"\n` +
        `• **Posts** — "find [keyword]", "show recent", "view post [id]"\n` +
        `• **Actions** — "hide [id]", "comment on [id]: message", "set status [id] to solved"\n` +
        `• **Users** — "show top contributors", "search user [name]", "ban [user]"\n` +
        `• **Reports** — "show reports", "pending reports"\n` +
        `• **Tools** — "create poll: title", "set announcement: text", "generate presentation"\n` +
        `• **Database** — "list tables", "show table posts", "run SQL: SELECT..."\n` +
        `• **Anything else** — just ask, I'll figure out the best tool`,
      actions: [],
    };
  }

  // No context available — basic fallback
  return {
    reply: `I'm processing your request: "${message.slice(0, 80)}".\n\n` +
      `Let me check what's available on the platform and get you the best answer.\n\n` +
      `Try asking about: analytics, posts, users, reports, polls, announcements, or say "help" for all commands.`,
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
      const { error } = await supabase.from('users_meta').update({ banned: true, notes: clean(args.reason, 500) }).eq('anon_id', args.anon_id.toLowerCase());
      if (error) throw error;
      return { banned: true, anon_id: args.anon_id };
    }
    case 'unban_user': {
      const { error } = await supabase.from('users_meta').update({ banned: false, notes: '' }).eq('anon_id', args.anon_id.toLowerCase());
      if (error) throw error;
      return { unbanned: true, anon_id: args.anon_id };
    }
    case 'get_user_posts': {
      const { data } = await supabase.from('posts').select('*').eq('author_id', args.anon_id.toLowerCase()).order('created_at', { ascending: false });
      return data || [];
    }
    case 'create_poll': {
      const pollId = `poll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { data, error } = await supabase.from('polls').insert({
        id: pollId,
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
        supabase.from('polls').select('id,title'),
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
    case 'create_comment': {
      const commentId = `cmt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const row = {
        id: commentId,
        post_id: clean(args.post_id, 60),
        parent_id: args.parent_id ? clean(args.parent_id, 60) : null,
        author_id: 'ADMIN',
        body: maskProfanity(clean(args.body, 500)),
        is_admin: true,
      };
      const { data, error } = await supabase.from('comments').insert(row).select().single();
      if (error) throw error;
      await supabase.from('posts').update({ updated_at: new Date().toISOString() }).eq('id', row.post_id);
      return { comment_id: commentId, post_id: row.post_id, body: row.body, created: true };
    }
    case 'hide_post': {
      const { data: hp, error: he } = await supabase.from('posts').update({ hidden: !!args.hidden, updated_at: new Date().toISOString() }).eq('id', args.post_id).select('id,title,hidden').single();
      if (he) throw he;
      return { post_id: hp.id, title: hp.title, hidden: hp.hidden };
    }
    case 'set_priority': {
      const { data: sp, error: se } = await supabase.from('posts').update({ priority: args.priority, updated_at: new Date().toISOString() }).eq('id', args.post_id).select('id,title,priority').single();
      if (se) throw se;
      return { post_id: sp.id, title: sp.title, priority: sp.priority };
    }
    case 'admin_reply': {
      const { data: ar, error: ae } = await supabase.from('posts').update({ admin_reply: maskProfanity(clean(args.reply, 1000)), updated_at: new Date().toISOString() }).eq('id', args.post_id).select('id,title,admin_reply').single();
      if (ae) throw ae;
      return { post_id: ar.id, title: ar.title, admin_reply: ar.admin_reply };
    }
    case 'lock_post': {
      const { data: lk, error: le } = await supabase.from('posts').update({ locked: !!args.locked, updated_at: new Date().toISOString() }).eq('id', args.post_id).select('id,title,locked').single();
      if (le) throw le;
      return { post_id: lk.id, title: lk.title, locked: lk.locked };
    }
    case 'pin_post': {
      const { data: pp, error: pe } = await supabase.from('posts').update({ pinned: !!args.pinned, updated_at: new Date().toISOString() }).eq('id', args.post_id).select('id,title,pinned').single();
      if (pe) throw pe;
      return { post_id: pp.id, title: pp.title, pinned: pp.pinned };
    }
    case 'feature_post': {
      const { data: fp, error: fe } = await supabase.from('posts').update({ featured: !!args.featured, updated_at: new Date().toISOString() }).eq('id', args.post_id).select('id,title,featured').single();
      if (fe) throw fe;
      return { post_id: fp.id, title: fp.title, featured: fp.featured };
    }
    case 'search_users': {
      const { data: su } = await supabase.from('users_meta').select('*').or(`anon_id.ilike.%${args.query}%`).order('last_seen', { ascending: false }).limit(args.limit || 20);
      return (su || []).map((u) => ({ anon_id: u.anon_id, banned: u.banned, strikes: u.strikes || 0, spam_score: u.spam_score || 0, last_seen: u.last_seen }));
    }
    case 'clear_announcement': {
      const { data: ca } = await supabase.from('settings').select('key').eq('key', 'announcement').maybeSingle();
      if (ca) await supabase.from('settings').update({ value: { text: '', enabled: false } }).eq('key', 'announcement');
      return { cleared: true };
    }
    case 'set_eta': {
      const { data: eta, error: etae } = await supabase.from('posts').update({ eta: clean(args.eta, 100), updated_at: new Date().toISOString() }).eq('id', args.post_id).select('id,title,eta').single();
      if (etae) throw etae;
      return { post_id: eta.id, title: eta.title, eta: eta.eta };
    }
    case 'assign_post': {
      const { data: ap, error: ape } = await supabase.from('posts').update({ assigned_to: clean(args.assigned_to, 100), updated_at: new Date().toISOString() }).eq('id', args.post_id).select('id,title,assigned_to').single();
      if (ape) throw ape;
      return { post_id: ap.id, title: ap.title, assigned_to: ap.assigned_to };
    }
    case 'create_presentation': {
      // Generate a self-contained HTML presentation from post data
      const topic = args.topic || 'Weekly Problems';
      const period = args.period || 'week';
      const postIds = args.post_ids || [];

      // Fetch posts based on period or specific IDs
      let posts;
      if (postIds.length > 0) {
        const { data } = await supabase.from('posts').select('id,title,category,status,priority,description,admin_reply,created_at,reactions,eta,assigned_to,locked,hidden,deleted,author_id')
          .in('id', postIds);
        posts = (data || []).filter((p) => !p.deleted);
      } else {
        const since = new Date();
        if (period === 'week') since.setDate(since.getDate() - 7);
        else if (period === 'month') since.setMonth(since.getMonth() - 1);
        else if (period === 'day') since.setDate(since.getDate() - 1);
        const { data } = await supabase.from('posts').select('id,title,category,status,priority,description,admin_reply,created_at,reactions,eta,assigned_to,locked,hidden,deleted,author_id')
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false });
        posts = (data || []).filter((p) => !p.deleted);
      }

      if (!posts?.length) {
        return { presentation_html: null, message: `No posts found for the selected period (${period}).`, post_count: 0 };
      }

      // Compute stats
      const total = posts.length;
      const cats = {};
      posts.forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
      const statuses = {};
      posts.forEach((p) => { statuses[p.status] = (statuses[p.status] || 0) + 1; });
      const priorities = { high: 0, medium: 0, low: 0 };
      posts.forEach((p) => { if (priorities[p.priority] !== undefined) priorities[p.priority]++; });
      const withReplies = posts.filter((p) => p.admin_reply).length;
      const openIssues = posts.filter((p) => p.status === 'open' || p.status === 'in_progress').length;
      const resolved = posts.filter((p) => p.status === 'solved').length;

      // Build HTML presentation
      const periodLabel = period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : period === 'day' ? 'Today' : 'All Time';
      const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      const escapeHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&amp;quot;');

      // Title slide
      const titleSlide = `
        <section class="slide slide-title" data-slide="1">
          <div class="slide-content">
            <div class="slide-badge">ADMIN REPORT</div>
            <h1>${escapeHtml(topic)}</h1>
            <p class="slide-subtitle">${periodLabel} · ${dateStr}</p>
            <div class="slide-stats-row">
              <div class="slide-stat-box"><span class="slide-stat-num">${total}</span><span class="slide-stat-label">Issues</span></div>
              <div class="slide-stat-box"><span class="slide-stat-num">${openIssues}</span><span class="slide-stat-label">Open</span></div>
              <div class="slide-stat-box"><span class="slide-stat-num">${resolved}</span><span class="slide-stat-label">Resolved</span></div>
              <div class="slide-stat-box"><span class="slide-stat-num">${withReplies}</span><span class="slide-stat-label">Replied</span></div>
            </div>
          </div>
        </section>`;

      // Overview slide
      const overviewSlide = `
        <section class="slide" data-slide="2">
          <div class="slide-content">
            <h2>Overview</h2>
            <div class="slide-grid-2">
              <div>
                <h3>By Category</h3>
                <div class="slide-bars">
                  ${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
                    const pct = Math.round((count / total) * 100);
                    return `<div class="slide-bar-row"><span class="slide-bar-label">${escapeHtml(cat)}</span><div class="slide-bar-track"><div class="slide-bar-fill" style="width:${pct}%"></div></div><span class="slide-bar-val">${count}</span></div>`;
                  }).join('')}
                </div>
              </div>
              <div>
                <h3>By Status</h3>
                <div class="slide-bars">
                  ${Object.entries(statuses).sort((a, b) => b[1] - a[1]).map(([st, count]) => {
                    const colors = { open: '#f59e0b', in_progress: '#3b82f6', solved: '#10b981', reported: '#ef4444', reviewing: '#8b5cf6', planned: '#6366f1' };
                    const pct = Math.round((count / total) * 100);
                    return `<div class="slide-bar-row"><span class="slide-bar-label">${escapeHtml(st)}</span><div class="slide-bar-track"><div class="slide-bar-fill" style="width:${pct}%;background:${colors[st] || '#666'}"></div></div><span class="slide-bar-val">${count}</span></div>`;
                  }).join('')}
                </div>
                <div style="margin-top:24px">
                  <h3>Priority</h3>
                  <div class="slide-priority-row">
                    <div class="slide-pri high">🔴 High: ${priorities.high}</div>
                    <div class="slide-pri medium">🟡 Medium: ${priorities.medium}</div>
                    <div class="slide-pri low">🟢 Low: ${priorities.low}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>`;

      // Individual problem slides (max 15)
      const problemSlides = posts.slice(0, 15).map((p, i) => {
        const statusColors = { open: '#f59e0b', in_progress: '#3b82f6', solved: '#10b981', reported: '#ef4444', reviewing: '#8b5cf6', planned: '#6366f1' };
        const priColors = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
        const reactions = p.reactions ? (typeof p.reactions === 'string' ? JSON.parse(p.reactions) : p.reactions) : {};
        const reactionCount = Object.values(reactions).reduce((a, b) => a + (Array.isArray(b) ? b.length : (b || 0)), 0);
        return `
        <section class="slide" data-slide="${i + 3}">
          <div class="slide-content">
            <div class="slide-problem-header">
              <span class="slide-problem-num">#${i + 1}</span>
              <span class="slide-status-badge" style="background:${statusColors[p.status] || '#666'}">${escapeHtml(p.status)}</span>
              <span class="slide-pri-badge" style="background:${priColors[p.priority] || '#666'}">${escapeHtml(p.priority)}</span>
            </div>
            <h2>${escapeHtml(p.title)}</h2>
            <p class="slide-category">📂 ${escapeHtml(p.category)}</p>
            ${p.description ? `<p class="slide-desc">${escapeHtml(p.description.slice(0, 300))}${p.description.length > 300 ? '...' : ''}</p>` : ''}
            <div class="slide-meta-row">
              <span>👍 ${reactionCount} reactions</span>
              <span>📅 ${new Date(p.created_at).toLocaleDateString()}</span>
              ${p.admin_reply ? `<span>💬 Admin replied</span>` : ''}
              ${p.assigned_to ? `<span>👤 ${escapeHtml(p.assigned_to)}</span>` : ''}
              ${p.eta ? `<span>📅 ETA: ${escapeHtml(p.eta)}</span>` : ''}
              ${p.locked ? `<span>🔒 Locked</span>` : ''}
            </div>
            ${p.admin_reply ? `<div class="slide-admin-reply"><strong>Admin Reply:</strong> ${escapeHtml(p.admin_reply)}</div>` : ''}
          </div>
        </section>`;
      }).join('');

      // Action items slide
      const actionItems = posts.filter((p) => p.status === 'open' || p.status === 'in_progress').slice(0, 10);
      const actionSlide = `
        <section class="slide" data-slide="${3 + problemSlides.length}">
          <div class="slide-content">
            <h2>Action Items</h2>
            <div class="slide-actions-list">
              ${actionItems.map((p, i) => `
                <div class="slide-action-item">
                  <span class="slide-action-num">${i + 1}</span>
                  <div>
                    <strong>${escapeHtml(p.title)}</strong>
                    <span class="slide-status-badge" style="background:${{ open: '#f59e0b', in_progress: '#3b82f6' }[p.status] || '#666'};font-size:11px;padding:2px 8px;margin-left:8px">${escapeHtml(p.status)}</span>
                    ${p.assigned_to ? `<span style="margin-left:8px;color:#888">→ ${escapeHtml(p.assigned_to)}</span>` : ''}
                  </div>
                </div>
              `).join('')}
              ${actionItems.length === 0 ? '<p style="color:#888">No pending action items</p>' : ''}
            </div>
          </div>
        </section>`;

      // Closing slide
      const closingSlide = `
        <section class="slide slide-closing" data-slide="${4 + problemSlides.length}">
          <div class="slide-content">
            <h1>Thank You</h1>
            <p class="slide-subtitle">Generated by Voice Box Admin Agent · ${dateStr}</p>
            <p style="color:#888;margin-top:16px">${total} issues analyzed · ${resolved} resolved · ${openIssues} remaining</p>
          </div>
        </section>`;

      const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(topic)} — ${periodLabel}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#f5f5f5;overflow:hidden;height:100vh}
.slide{display:none;width:100vw;height:100vh;justify-content:center;align-items:center;padding:48px 64px;position:relative}
.slide.active{display:flex}
.slide-content{max-width:1000px;width:100%;animation:fadeUp .5s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.slide-title{text-align:center}
.slide-title h1{font-size:clamp(2.5rem,5vw,4rem);font-weight:800;background:linear-gradient(135deg,#f59e0b,#ef4444,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:12px;line-height:1.1}
.slide-subtitle{font-size:1.2rem;color:#888}
.slide-badge{display:inline-block;background:#f59e0b;color:#000;font-size:.75rem;font-weight:700;padding:4px 12px;border-radius:999px;letter-spacing:.1em;margin-bottom:24px}
.slide-stats-row{display:flex;gap:24px;margin-top:40px;justify-content:center}
.slide-stat-box{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:20px 28px;text-align:center;min-width:120px}
.slide-stat-num{display:block;font-size:2.4rem;font-weight:800;color:#f59e0b}
.slide-stat-label{display:block;font-size:.8rem;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:.1em}
h2{font-size:2rem;font-weight:700;margin-bottom:24px}
h3{font-size:1rem;font-weight:600;color:#aaa;margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em}
.slide-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:48px}
.slide-bars{display:flex;flex-direction:column;gap:8px}
.slide-bar-row{display:flex;align-items:center;gap:12px}
.slide-bar-label{min-width:100px;font-size:.85rem;color:#ccc;text-transform:capitalize}
.slide-bar-track{flex:1;height:12px;background:rgba(255,255,255,.06);border-radius:6px;overflow:hidden}
.slide-bar-fill{height:100%;background:linear-gradient(90deg,#f59e0b,#ef4444);border-radius:6px;transition:width .8s ease}
.slide-bar-val{min-width:28px;text-align:right;font-weight:700;color:#f59e0b;font-size:.9rem}
.slide-priority-row{display:flex;gap:12px}
.slide-pri{padding:6px 14px;border-radius:8px;font-size:.85rem;font-weight:600;background:rgba(255,255,255,.05)}
.slide-problem-header{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.slide-problem-num{font-size:.8rem;color:#666;font-weight:700}
.slide-status-badge{font-size:.7rem;font-weight:700;padding:3px 10px;border-radius:999px;color:#fff;text-transform:uppercase;letter-spacing:.05em}
.slide-pri-badge{font-size:.7rem;font-weight:700;padding:3px 10px;border-radius:999px;color:#fff;text-transform:uppercase}
.slide-category{color:#888;font-size:.9rem;margin-bottom:16px}
.slide-desc{color:#ccc;line-height:1.7;margin-bottom:20px;font-size:1rem}
.slide-meta-row{display:flex;gap:20px;color:#888;font-size:.85rem;flex-wrap:wrap}
.slide-admin-reply{background:rgba(245,158,11,.08);border-left:3px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin-top:20px;color:#ddd;font-size:.9rem;line-height:1.6}
.slide-actions-list{display:flex;flex-direction:column;gap:12px}
.slide-action-item{display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,.04);border-radius:8px;border:1px solid rgba(255,255,255,.06)}
.slide-action-num{min-width:28px;height:28px;background:#f59e0b;color:#000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:800}
.slide-closing{text-align:center}
.slide-closing h1{font-size:3rem;font-weight:800;background:linear-gradient(135deg,#f59e0b,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.slide-nav{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:12px;z-index:100}
.slide-nav button{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:600;transition:all .2s}
.slide-nav button:hover{background:rgba(245,158,11,.2);border-color:#f59e0b}
.slide-counter{position:fixed;bottom:28px;right:32px;color:#555;font-size:.8rem;z-index:100}
@media(max-width:768px){.slide{padding:24px}.slide-grid-2{grid-template-columns:1fr}.slide-stats-row{flex-wrap:wrap}}
</style>
</head>
<body>
${titleSlide}
${overviewSlide}
${problemSlides}
${actionSlide}
${closingSlide}
<div class="slide-nav">
  <button onclick="prevSlide()">← Prev</button>
  <button onclick="nextSlide()">Next →</button>
</div>
<div class="slide-counter" id="slideCounter"></div>
<script>
let current=1;const total=document.querySelectorAll('.slide').length;
function showSlide(n){document.querySelectorAll('.slide').forEach(s=>s.classList.remove('active'));const s=document.querySelector('[data-slide="'+n+'"]');if(s)s.classList.add('active');document.getElementById('slideCounter').textContent=n+' / '+total}
function nextSlide(){if(current<total){current++;showSlide(current)}}
function prevSlide(){if(current>1){current--;showSlide(current)}}
document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' ')nextSlide();if(e.key==='ArrowLeft')prevSlide()});
showSlide(1);
</script>
</body></html>`;

      return {
        presentation_html: fullHtml,
        message: `Presentation generated: ${total} issues across ${Object.keys(cats).length} categories`,
        post_count: total,
        period,
        stats: { total, open: openIssues, resolved, with_replies: withReplies, categories: cats, statuses, priorities },
      };
    }
    // ── Database / SQL Tools ─────────────────────────────────────
    case 'execute_sql': {
      const query = (args.query || '').trim();
      if (!query) throw new Error('SQL query required');
      // Safety: only allow SELECT
      if (!/^\s*select\b/i.test(query)) throw new Error('Only SELECT queries allowed via execute_sql');
      const { data, error } = await supabase.rpc('exec_sql', { sql: query }).maybeSingle();
      if (error) {
        // Fallback: try direct query via settings table approach
        const { data: fallback, error: fbErr } = await supabase.from('posts').select('*').limit(1);
        if (fbErr) throw new Error(`SQL error: ${error.message}`);
        // If rpc doesn't exist, use a workaround: query each table
        return { error: `SQL rpc not available. Use specific tools or tell me what data you need.`, hint: 'Try get_posts, get_analytics, or list_tables instead.' };
      }
      return data;
    }
    case 'list_tables': {
      // Get table info by querying each known table's count
      const tables = ['posts', 'users_meta', 'comments', 'reactions', 'polls', 'activity_logs', 'settings', 'reports', 'agent_conversations'];
      const results = [];
      for (const t of tables) {
        try {
          const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
          results.push({ table: t, row_count: count || 0 });
        } catch { results.push({ table: t, row_count: 'error' }); }
      }
      return results;
    }
    case 'describe_table': {
      const table = args.table;
      if (!table) throw new Error('Table name required');
      // Get sample rows and count
      const [{ count }, { data: sample }] = await Promise.all([
        supabase.from(table).select('*', { count: 'exact', head: true }),
        supabase.from(table).select('*').limit(3),
      ]);
      const columns = sample?.length ? Object.keys(sample[0]) : [];
      return { table, row_count: count || 0, columns, sample_rows: sample || [] };
    }
    case 'generate_html': {
      // Store custom HTML in settings for retrieval
      const htmlId = `html_${Date.now().toString(36)}`;
      const htmlData = { id: htmlId, title: args.title, html: args.html, description: args.description, created_at: new Date().toISOString() };
      const { data: existing } = await supabase.from('settings').select('value').eq('key', 'generated_html').maybeSingle();
      const existingList = existing?.value?.items || [];
      existingList.push(htmlData);
      // Keep only last 50
      const trimmed = existingList.slice(-50);
      if (existing) await supabase.from('settings').update({ value: { items: trimmed } }).eq('key', 'generated_html');
      else await supabase.from('settings').insert({ key: 'generated_html', value: { items: trimmed } });
      return { html_id: htmlId, title: args.title, message: 'HTML content generated and stored' };
    }
    // ── Tool Management ─────────────────────────────────────────
    case 'create_tool': {
      const tool = { name: args.name, description: args.description, sql_template: args.sql_template, response_format: args.response_format, created_at: new Date().toISOString() };
      const { data: exTools } = await supabase.from('settings').select('value').eq('key', 'custom_tools').maybeSingle();
      const tools = exTools?.value?.tools || [];
      tools.push(tool);
      if (exTools) await supabase.from('settings').update({ value: { tools } }).eq('key', 'custom_tools');
      else await supabase.from('settings').insert({ key: 'custom_tools', value: { tools } });
      return { created: true, tool: tool.name, message: `Tool "${tool.name}" registered for future use` };
    }
    case 'list_tools': {
      const { data } = await supabase.from('settings').select('value').eq('key', 'custom_tools').maybeSingle();
      return data?.value?.tools || [];
    }
    // ── Data Retrieval Tools ────────────────────────────────────
    case 'get_reports': {
      let q = supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(50);
      if (args.status) q = q.eq('status', args.status);
      const { data } = await q;
      return data || [];
    }
    case 'get_polls': {
      let q = supabase.from('polls').select('*').order('created_at', { ascending: false });
      if (!args.include_archived) q = q.eq('archived', false);
      const { data } = await q;
      return data || [];
    }
    case 'get_settings': {
      const { data } = await supabase.from('settings').select('value').eq('key', args.key).maybeSingle();
      return data?.value || null;
    }
    default: {
      // Check if this is a custom tool registered in the DB
      const { data: customData } = await supabase.from('settings').select('value').eq('key', 'custom_tools').maybeSingle();
      const customTools = customData?.value?.tools || [];
      const match = customTools.find((t) => t.name === toolName);
      if (match && match.sql_template) {
        // Execute the custom tool's SQL template with arg substitution
        let sql = match.sql_template;
        for (const [k, v] of Object.entries(args)) {
          sql = sql.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), String(v));
        }
        const { data: result, error } = await supabase.rpc('exec_sql', { sql }).maybeSingle();
        if (error) throw new Error(`Custom tool "${toolName}" SQL error: ${error.message}`);
        return result || { message: `Custom tool "${toolName}" executed` };
      }
      throw new Error(`Unknown tool: ${toolName}`);
    }
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

      // Gather live platform context — wrapped in try/catch so DB errors don't crash the handler
      let postCount = 0, userCount = 0, commentCount = 0, reportCount = 0;
      let recentPosts = [], recentActivity = [];
      try {
        const counts = await Promise.all([
          supabase.from('posts').select('*', { count: 'exact', head: true }),
          supabase.from('users_meta').select('*', { count: 'exact', head: true }),
          supabase.from('comments').select('*', { count: 'exact', head: true }),
          supabase.from('reports').select('*', { count: 'exact', head: true }),
        ]);
        postCount = counts[0].count || 0;
        userCount = counts[1].count || 0;
        commentCount = counts[2].count || 0;
        reportCount = counts[3].count || 0;

        const lists = await Promise.all([
          supabase.from('posts').select('id,title,category,status,priority,created_at,deleted,hidden,reactions,comment_count').eq('deleted', false).order('created_at', { ascending: false }).limit(10),
          supabase.from('activity_logs').select('actor,action,detail,created_at').order('created_at', { ascending: false }).limit(5),
        ]);
        recentPosts = lists[0].data || [];
        recentActivity = lists[1].data || [];
      } catch (ctxErr) {
        console.error('Context gathering failed:', ctxErr.message);
        // Continue with zeros — intent engine can still work
      }

      // Build context snapshot for the LLM
      const activePosts = (recentPosts || []).filter((p) => !p.hidden);
      const postSummary = activePosts.slice(0, 10).map((p) => `  [${p.status}/${p.priority}] ${p.title} (${p.category}) — ${p.comment_count || 0} comments`).join('\n');
      const activitySummary = (recentActivity || []).map((l) => `  [${l.actor}] ${l.action}: ${(l.detail || '').slice(0, 80)}`).join('\n');

      const platformContext = `LIVE PLATFORM STATE:
Posts: ${postCount || 0} total | Users: ${userCount || 0} | Comments: ${commentCount || 0} | Pending reports: ${reportCount || 0}
Recent posts:
${postSummary || '  (none)'}
Recent activity:
${activitySummary || '  (none)'}
Current time: ${new Date().toISOString()}
Session: ${sid}`;

      // Build tool definitions for the LLM (built-in + custom from DB)
      let customTools = [];
      try {
        const { data: customToolsData } = await supabase.from('settings').select('value').eq('key', 'custom_tools').maybeSingle();
        customTools = customToolsData?.value?.tools || [];
      } catch (e) {
        console.warn('Failed to load custom tools:', e.message);
      }
      const builtInToolDefs = TOOL_DEFS.map((t) => `- ${t.name}: ${t.description}`).join('\n');
      const customToolDefs = customTools.length
        ? '\n\nCUSTOM TOOLS (created by you, use SQL templates below):\n' +
          customTools.map((t) => `- ${t.name}: ${t.description}\n  SQL: ${t.sql_template || 'N/A'}\n  Response: ${t.response_format || 'json'}`).join('\n')
        : '';
      const toolDefsText = builtInToolDefs + customToolDefs;

      // ── INTENT-FIRST: Built-in intents always run before LLM ────────
      // Intent handlers return structured { reply, actions } objects.
      // LLMs return natural language that rarely includes valid JSON actions.
      // Running intents first ensures action cards always appear in the UI.
      let reply = '';
      let actions = [];
      let providerUsed = 'builtin';
      let matched = false;

      for (const intent of INTENTS) {
        if (intent.patterns.test(message)) {
          try {
            const result = await intent.handler(message);
            if (result && result.reply) {
              reply = result.reply;
              actions = result.actions || [];
              matched = true;
              break;
            }
          } catch (e) {
            console.error(`Intent [${String(intent.patterns).slice(0, 60)}] failed for "${message.slice(0, 50)}":`, e.message);
            // Continue to next intent — don't let one handler's DB error kill the whole chain
          }
        }
      }

      // ── LLM fallback: only when no intent matched ───────────────
      // Handles open-ended questions, complex analysis, creative tasks,
      // and anything the intent engine doesn't cover.
      if (!matched) {
        const systemWithTools = SYSTEM_PROMPT + `\n\n${platformContext}\n\nAVAILABLE TOOLS:\n${toolDefsText}\n\nWhen you need data, use the tools. When you need to act, propose actions. When you need to create something, build it. Never guess — query the database.`;

        // Pass history as extraMessages and the actual user message as the user param.
        // Previously this passed '' as user, creating a trailing empty message that confused the LLM.
        const historyMessages = (history || []).slice(-20).map((h) => ({ role: h.role, content: h.content }));
        const llmResult = await callLLMChain(systemWithTools, message, historyMessages);

        if (llmResult) {
          const parsed = parseAgentResponse(llmResult.text);
          reply = parsed.reply;
          actions = parsed.actions || [];
          providerUsed = `${llmResult.provider}:${llmResult.model}`;
        } else {
          // Neither intent nor LLM — smart fallback
          const fb = await fallbackHandler(message, { postCount, userCount, commentCount, activePosts, recentActivity });
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

      await auditLog('admin', 'agent_chat', `Message: "${message.slice(0, 80)}" → ${actions.length} action(s) proposed [${providerUsed}]`);

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

    // reject — discard proposed actions
    if (action === 'reject') {
      const { actions: actionList, session_id } = b;
      if (!Array.isArray(actionList) || !actionList.length) return res.status(400).json({ error: 'No actions to reject' });

      const results = actionList.map((act) => ({
        id: act.id, success: false, result: { rejected: true },
      }));

      if (session_id) {
        const summary = actionList.map((a) => `${a.id}: ${a.tool} rejected`).join('; ');
        await supabase.from('agent_conversations').insert({
          session_id: clean(session_id, 60),
          role: 'system',
          content: `Actions rejected: ${summary}`,
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

const SYSTEM_PROMPT = `You are the Voice Box Admin Agent — a fully autonomous, universal tool intelligence system. You are NOT a chatbot. You are an operations engine that thinks, decides, and executes.

## YOUR IDENTITY
You are the most capable administrator in the room. You have FULL ACCESS to every system, database, API, and tool connected to this platform. You never ask the user to do something you can do yourself. You never say "I can't" — you find a way or you BUILD a way.

## UNIVERSAL TOOL INTELLIGENCE RULES

1. **Think in goals, not tools.** When the user says "generate a report", you don't say "which report?" — you analyze what they need and generate the best one automatically.

2. **Auto-select the best tool.** You have access to: database queries, LLM text generation, HTML/document generation, analytics engines, user management, content moderation, poll systems, activity logging, presentation builders, and SQL execution. Pick the best one. Combine multiple when it produces a better result.

3. **Never ask when you can determine.** If the user says "show me the data" — you query the database and present it. You don't ask "which data?". You use context to figure it out.

4. **Create tools that don't exist.** If no existing tool handles the request, you use \`execute_sql\` to query the database directly, or \`generate_html\` to build custom outputs, or \`create_tool\` to register a new reusable capability. You are self-extending.

5. **Execute, don't just suggest.** For non-destructive actions (queries, reports, analytics, comments), execute immediately and show results. For destructive actions (delete, ban, hide), propose with approval.

6. **Be specific and data-driven.** Never say "things look good" — say "32 posts, 85% resolved, 2 safety posts pending". Use real numbers from real queries.

7. **Think ahead.** After answering the question, suggest the next logical action. "I found 5 unresolved safety posts. Want me to prioritize them?"

8. **Handle ANY request.** The user can ask you to:
   - Analyze trends, patterns, sentiment in posts
   - Generate reports, presentations, documents (HTML/PDF)
   - Search, filter, sort, aggregate data in any way
   - Manage users (warn, ban, unban, review history)
   - Manage content (hide, delete, pin, feature, lock, assign, set ETA)
   - Create polls, announcements, comments
   - Run arbitrary SQL queries for custom analysis
   - Generate charts, graphs, diagrams as HTML
   - Cross-reference data across tables
   - Build custom dashboards on the fly
   - Export data in any format
   - Monitor activity in real-time
   - Create new tools and capabilities for future use

## RESPONSE FORMAT

Always respond with a JSON block:
\`\`\`json
{
  "reply": "Your response with real data, real analysis, real recommendations",
  "actions": [
    { "tool": "tool_name", "args": { ... }, "reason": "Why this action" }
  ]
}
\`\`\`

For pure information queries (no actions needed), just reply normally with the data.

## DATABASE SCHEMA
The platform uses Supabase (PostgreSQL). Key tables:
- posts: id, title, description, category, status, priority, author_id, reactions, comment_count, admin_reply, hidden, deleted, locked, pinned, featured, assigned_to, eta, created_at, updated_at
- users_meta: anon_id, banned, warnings, strikes, spam_score, notes, last_seen, created_at
- comments: id, post_id, parent_id, author_id, body, is_admin, created_at
- reactions: id, post_id, kind, author_id
- polls: id, title, options, ptype, total_votes, archived, author_id
- activity_logs: id, actor, action, detail, created_at
- settings: key, value (JSONB)
- reports: id, post_id, reason, status, created_at
- agent_conversations: id, session_id, role, content, actions, created_at

Categories: General, Facilities, Academic, Bullying, Security, Medical, Technology, Transport, Food, Staff, Events, Other
Statuses: reported, verified, in_progress, waiting, solved, archived
Priorities: high, medium, low

## CURRENT STATE
You always have access to live platform data. Query it. Use it. Never guess.`;

const TOOL_DEFS = [
  // ── Data Retrieval ──────────────────────────────────────────────
  { name: 'get_posts', description: 'Retrieve posts with optional filters (status, category, limit)', parameters: { type: 'object', properties: { status: { type: 'string' }, category: { type: 'string' }, limit: { type: 'integer', default: 20 }, include_deleted: { type: 'boolean' } } } },
  { name: 'get_analytics', description: 'Get full platform analytics (posts, users, comments, reactions, polls, categories, statuses)', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['day', 'week', 'month', 'all'] } } } },
  { name: 'get_activity_logs', description: 'Retrieve recent activity/audit logs', parameters: { type: 'object', properties: { limit: { type: 'integer', default: 50 } } } },
  { name: 'get_user_posts', description: 'Get all posts from a specific anonymous user', parameters: { type: 'object', properties: { anon_id: { type: 'string' } }, required: ['anon_id'] } },
  { name: 'search_users', description: 'Search users by anon_id', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', default: 20 } }, required: ['query'] } },
  { name: 'get_reports', description: 'Get all content reports/flags', parameters: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'get_polls', description: 'Get all polls with vote counts', parameters: { type: 'object', properties: { include_archived: { type: 'boolean' } } } },
  { name: 'get_settings', description: 'Read any platform setting by key', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  // ── Content Management ──────────────────────────────────────────
  { name: 'update_post', description: "Update a post's status, priority, admin reply, hidden state", parameters: { type: 'object', properties: { post_id: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string' }, admin_reply: { type: 'string' }, hidden: { type: 'boolean' } }, required: ['post_id'] } },
  { name: 'delete_post', description: 'Soft-delete a post', parameters: { type: 'object', properties: { post_id: { type: 'string' }, reason: { type: 'string' } }, required: ['post_id', 'reason'] } },
  { name: 'hide_post', description: 'Hide or unhide a post', parameters: { type: 'object', properties: { post_id: { type: 'string' }, hidden: { type: 'boolean' } }, required: ['post_id'] } },
  { name: 'pin_post', description: 'Pin or unpin a post', parameters: { type: 'object', properties: { post_id: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['post_id'] } },
  { name: 'feature_post', description: 'Feature or unfeature a post', parameters: { type: 'object', properties: { post_id: { type: 'string' }, featured: { type: 'boolean' } }, required: ['post_id'] } },
  { name: 'lock_post', description: 'Lock or unlock a post (prevents comments)', parameters: { type: 'object', properties: { post_id: { type: 'string' }, locked: { type: 'boolean' } }, required: ['post_id'] } },
  { name: 'set_priority', description: 'Set post priority (high/medium/low)', parameters: { type: 'object', properties: { post_id: { type: 'string' }, priority: { type: 'string' } }, required: ['post_id', 'priority'] } },
  { name: 'assign_post', description: 'Assign a post to a staff member', parameters: { type: 'object', properties: { post_id: { type: 'string' }, assigned_to: { type: 'string' } }, required: ['post_id', 'assigned_to'] } },
  { name: 'set_eta', description: 'Set ETA for post resolution', parameters: { type: 'object', properties: { post_id: { type: 'string' }, eta: { type: 'string' } }, required: ['post_id', 'eta'] } },
  { name: 'admin_reply', description: 'Post an admin reply on a post', parameters: { type: 'object', properties: { post_id: { type: 'string' }, reply: { type: 'string' } }, required: ['post_id', 'reply'] } },
  // ── Comments ────────────────────────────────────────────────────
  { name: 'create_comment', description: 'Post an admin comment on a post', parameters: { type: 'object', properties: { post_id: { type: 'string' }, body: { type: 'string' }, parent_id: { type: 'string' } }, required: ['post_id', 'body'] } },
  // ── User Management ─────────────────────────────────────────────
  { name: 'warn_user', description: 'Issue a warning to an anonymous user', parameters: { type: 'object', properties: { anon_id: { type: 'string' }, reason: { type: 'string' } }, required: ['anon_id', 'reason'] } },
  { name: 'ban_user', description: 'Ban an anonymous user (prevents posting)', parameters: { type: 'object', properties: { anon_id: { type: 'string' }, reason: { type: 'string' } }, required: ['anon_id', 'reason'] } },
  { name: 'unban_user', description: 'Unban an anonymous user', parameters: { type: 'object', properties: { anon_id: { type: 'string' } }, required: ['anon_id'] } },
  // ── Polls ───────────────────────────────────────────────────────
  { name: 'create_poll', description: 'Create a new poll (yesno/choice/rating)', parameters: { type: 'object', properties: { title: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, ptype: { type: 'string', enum: ['yesno', 'choice', 'rating'] } }, required: ['title'] } },
  { name: 'close_poll', description: 'Close a poll to new votes', parameters: { type: 'object', properties: { poll_id: { type: 'string' } }, required: ['poll_id'] } },
  // ── Announcements ───────────────────────────────────────────────
  { name: 'set_announcement', description: 'Set or update a site-wide announcement', parameters: { type: 'object', properties: { text: { type: 'string' }, enabled: { type: 'boolean' } } } },
  { name: 'clear_announcement', description: 'Clear the current announcement', parameters: { type: 'object', properties: {} } },
  // ── Reports & Documents ─────────────────────────────────────────
  { name: 'create_presentation', description: 'Generate a self-contained HTML slide presentation from post data', parameters: { type: 'object', properties: { topic: { type: 'string' }, period: { type: 'string', enum: ['day', 'week', 'month', 'all'] }, post_ids: { type: 'array', items: { type: 'string' } } }, required: ['topic'] } },
  { name: 'generate_html', description: 'Generate custom HTML content (charts, dashboards, diagrams, reports) using raw HTML/CSS/JS', parameters: { type: 'object', properties: { title: { type: 'string' }, html: { type: 'string', description: 'Full HTML content' }, description: { type: 'string' } }, required: ['title', 'html'] } },
  // ── Database / SQL ──────────────────────────────────────────────
  { name: 'execute_sql', description: 'Execute arbitrary SQL against the database for custom analysis. Use SELECT only. Returns rows.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'SQL SELECT query' } }, required: ['query'] } },
  { name: 'list_tables', description: 'List all tables in the database with row counts', parameters: { type: 'object', properties: {} } },
  { name: 'describe_table', description: 'Get column definitions and sample rows for a table', parameters: { type: 'object', properties: { table: { type: 'string' } }, required: ['table'] } },
  // ── Tool Management ─────────────────────────────────────────────
  { name: 'create_tool', description: 'Register a new reusable tool for future use. Store its name, description, SQL template, or handler logic.', parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, sql_template: { type: 'string', description: 'SQL template with :param placeholders' }, response_format: { type: 'string', description: 'How to format the response' } }, required: ['name', 'description'] } },
  { name: 'list_tools', description: 'List all registered custom tools', parameters: { type: 'object', properties: {} } },
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
