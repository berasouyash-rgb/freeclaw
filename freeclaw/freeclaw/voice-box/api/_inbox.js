// Unified Inbox — AI-powered anonymous messaging with emotional routing & admin handoff
// POST /api/inbox — user sends message → instant AI reply, emotional routing, admin notification
// GET  /api/inbox?threads=1 — admin: all threads with AI summaries and handoff state
// GET  /api/inbox?thread_id=X — messages for a specific thread
// POST /api/inbox { action: 'takeover', thread_id } — admin takes over from AI
// POST /api/inbox { action: 'release', thread_id } — admin releases back to AI
// POST /api/inbox { action: 'transfer_emotional', thread_id } — route to emotional agent
import supabase from './_db-client.js';
import { cors, isAdmin, checkUser, clean, maskProfanity, auditLog, rateLimited, rateLimitResponse } from './_auth.js';
import { callLLMChain } from './_providers.js';
import { emitEvent, EVENT_TYPES } from './_events.js';
import { sanitizeError } from './_error.js';

// ─── Agent Definitions ─────────────────────────────────────────
const AGENTS = {
  general: {
    name: 'General Assistant',
    system: `You are a friendly, helpful school support assistant for an anonymous feedback platform called Voice Box. Students can post anonymously about issues they face at school. You respond to chat messages helpfully and empathetically. Keep replies concise (under 80 words). Be warm but professional. You have access to platform data — use it when relevant. Never dismiss concerns. Never ask for personal information.`,
    emoji: '🤖',
  },
  emotional: {
    name: 'Emotional Support Agent',
    system: `You are a trained emotional support counselor for students at a school. You respond to students who are experiencing emotional distress, anger, anxiety, sadness, or other difficult emotions. 

CRITICAL RULES:
- Be warm, empathetic, and validating. Never dismiss feelings.
- Use reflective listening: "I hear that you're feeling..."
- Do NOT try to solve the problem immediately — first acknowledge the emotion.
- If there's any mention of self-harm or harm to others, immediately provide crisis resources.
- Suggest speaking to a school counselor or trusted adult.
- Keep replies under 100 words.
- Use a gentle, supportive tone.
- You can check in on the student's wellbeing: "How are you feeling right now?"
- Never say "just calm down" or minimize their experience.`,
    emoji: '💙',
  },
  handoff: {
    name: 'Admin Handoff',
    system: `You are transitioning this conversation from AI to a human admin. Acknowledge the handoff warmly and let the student know a real person is now available. Keep it brief and reassuring.`,
    emoji: '👤',
  },
};

// ─── Emotion Detection (LLM-enhanced) ──────────────────────────
const EMOTION_KEYWORDS = {
  critical: ['suicide', 'kill myself', 'end my life', 'self harm', 'hurt myself', 'want to die', "can't go on", 'no reason to live', 'ending it all'],
  distress: ['furious', 'enraged', 'livid', 'disgusted', 'hate this', 'worst ever', 'unacceptable', 'rage', 'furious'],
  anxious: ['scared', 'terrified', 'anxious', 'worried sick', 'panic', 'stressed', 'overwhelmed', 'nervous', 'cant breathe'],
  sad: ['depressed', 'hopeless', 'worthless', 'nobody cares', 'alone', 'lonely', 'cry', 'tears', 'broken'],
  positive: ['thank', 'resolved', 'solved', 'happy', 'great', 'appreciate', 'grateful'],
};

function keywordDetect(text) {
  const lower = text.toLowerCase();
  for (const [level, words] of Object.entries(EMOTION_KEYWORDS)) {
    if (words.some((w) => lower.includes(w))) return level;
  }
  return null;
}

async function classifyEmotion(text) {
  // Quick keyword check first (fast path)
  const quick = keywordDetect(text);
  if (quick === 'critical') return { level: 'critical', emotion: 'critical_distress', agent: 'emotional' };
  if (quick === 'distress') return { level: 'distress', emotion: 'anger', agent: 'emotional' };
  if (quick) return { level: quick, emotion: quick, agent: quick === 'positive' ? 'general' : 'emotional' };

  // LLM classification for nuanced detection (when keywords don't match)
  try {
    const result = await callLLMChain(
      `Classify the emotional tone of this student message. Reply with ONLY a JSON object:
{"level": "none|mild|moderate|high|critical", "emotion": "none|frustrated|anxious|sad|angry|positive|neutral", "agent": "general|emotional"}
- "emotional" agent for: sadness, anxiety, anger, distress, frustration
- "general" agent for: questions, feedback, positive messages, neutral
- "critical" level always → "emotional" agent`,
      `Student message: "${text.slice(0, 500)}"`,
    );
    if (result?.text) {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { level: parsed.level || 'none', emotion: parsed.emotion || 'neutral', agent: parsed.agent || 'general' };
      }
    }
  } catch { /* fall through to default */ }

  return { level: 'none', emotion: 'neutral', agent: 'general' };
}

// ─── Admin Online Detection ────────────────────────────────────
async function isAdminOnline() {
  try {
    // Check if any admin activity in last 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    const { data } = await supabase.from('settings').select('value').eq('key', 'admin_sessions').maybeSingle();
    const sessions = data?.value?.tokens || [];
    const active = sessions.filter((t) => t.exp > Date.now());
    return active.length > 0;
  } catch { return false; }
}

// ─── Thread State Management ───────────────────────────────────
async function getThreadState(threadId) {
  const { data } = await supabase.from('settings').select('value').eq('key', `inbox_state:${threadId}`).maybeSingle();
  return data?.value || { agent: 'general', handoff: false, emotion_history: [], message_count: 0 };
}

async function setThreadState(threadId, state) {
  await supabase.from('settings').upsert(
    { key: `inbox_state:${threadId}`, value: { ...state, updated_at: new Date().toISOString() } },
    { onConflict: 'key' },
  );
}

// ─── AI Reply Generation ───────────────────────────────────────
// NO templates — every reply comes directly from the external LLM model

// Promise with timeout wrapper
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function generateReply(message, threadState, emotion, adminOnline) {
  // Admin explicitly took over: AI stays quiet
  if (threadState.handoff) {
    return { reply: null, agent: threadState.agent, handoff: true };
  }

  // AI ALWAYS replies to every message — admin can take over later if needed
  const useEmotional = emotion.agent === 'emotional' || emotion.level === 'critical';
  const agentDef = useEmotional ? AGENTS.emotional : AGENTS.general;

  const historyContext = threadState.recent_messages?.length
    ? `\n\nRecent conversation:\n${threadState.recent_messages.slice(-5).map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : '';

  const emotionContext = `\n\nEmotion detected: ${emotion.emotion} (${emotion.level})`;
  const crisisNote = emotion.level === 'critical'
    ? '\n\nURGENT: This student may be in crisis. Respond with empathy and provide crisis resources. Keep under 100 words.'
    : '';

  try {
    const result = await withTimeout(callLLMChain(
      agentDef.system + emotionContext + crisisNote + historyContext,
      `A student says: "${message.slice(0, 800)}"\n\nRespond directly to the student.`,
    ), 25000);

    if (result?.text && result.text.length > 10) {
      return {
        reply: result.text.trim(),
        agent: useEmotional ? 'emotional' : 'general',
        handoff: false,
        escalate: emotion.level === 'critical',
      };
    }
  } catch (e) {
    console.error('[inbox] LLM call failed:', e.message);
  }

  // Graceful offline fallback — give the student a helpful message instead of silence
  const offlineReply = useEmotional
    ? "I'm having trouble connecting right now, but I want you to know your feelings matter. A team member will be with you soon. 💙"
    : "I'm experiencing a brief connection issue. Your message has been saved and I'll respond shortly. Thank you for your patience. 🤖";
  return { reply: offlineReply, agent: useEmotional ? 'emotional' : 'general', handoff: false, escalate: emotion.level === 'critical' };
}

// ─── Admin Notification ────────────────────────────────────────
async function notifyAdmin(threadId, message, emotion, agent) {
  try {
    const { data: existing } = await supabase.from('settings').select('value').eq('key', 'notifications:admin').maybeSingle();
    const notifs = existing?.value?.notifications || [];
    const levelLabel = emotion.level === 'critical' ? '🔴 CRITICAL' : emotion.level === 'high' ? '🟠 HIGH' : emotion.level === 'moderate' ? '🟡 MODERATE' : '🟢 LOW';

    notifs.unshift({
      id: `inbox_${Date.now().toString(36)}`,
      type: emotion.level === 'critical' ? 'escalation' : 'inbox_message',
      title: `${levelLabel}: Student message needs attention`,
      body: `"${message.slice(0, 120)}" — Emotion: ${emotion.emotion}, AI: ${agent}`,
      thread_id: threadId,
      read: false,
      created_at: new Date().toISOString(),
    });
    await supabase.from('settings').upsert(
      { key: 'notifications:admin', value: { notifications: notifs.slice(0, 100), updated_at: new Date().toISOString() } },
      { onConflict: 'key' },
    );
  } catch (e) { console.error('notifyAdmin error:', e.message); }
}

// ─── Agent Operations Center helpers ───────────────────────────
async function getThreadMessages(threadId, limit = 30) {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', 'asc')
    .limit(limit);
  return data || [];
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function triageThread(threadId) {
  const msgs = await getThreadMessages(threadId, 20);
  if (!msgs.length) return { priority: 'low', emotion: 'neutral', topic: 'empty', suggested_action: 'monitor' };
  const convo = msgs.map((m) => `${m.sender}: ${m.body}`).join('\n');
  const result = await withTimeout(callLLMChain(
    `You are a triage supervisor for a school anonymous-feedback platform. Analyze the conversation and return ONLY a JSON object:
{"priority":"low|medium|high|urgent","emotion":"neutral|frustrated|anxious|sad|angry|positive","topic":"short topic (max 4 words)","suggested_action":"one of: monitor|reply_empathy|reply_info|escalate_human|route_emotional|close"}
Critical/self-harm emotion → escalate_human or route_emotional.`,
    `Conversation:\n${convo.slice(0, 1500)}`,
  ), 20000);
  const parsed = result?.text ? extractJson(result.text) : null;
  const triage = parsed || { priority: 'low', emotion: 'neutral', topic: 'unknown', suggested_action: 'monitor' };
  const state = await getThreadState(threadId);
  state.triage = { ...triage, at: new Date().toISOString() };
  await setThreadState(threadId, state);
  return triage;
}

async function draftReplyForThread(threadId) {
  const msgs = await getThreadMessages(threadId, 20);
  if (!msgs.length) return { reply: '' };
  const convo = msgs.map((m) => `${m.sender}: ${m.body}`).join('\n');
  const result = await withTimeout(callLLMChain(
    `You are a school admin drafting a reply to a student on an anonymous feedback platform. Write a concise, warm, professional admin reply (under 90 words). Address the student's actual concern. Return ONLY the reply text — no quotes, no preamble.`,
    `Conversation:\n${convo.slice(0, 1500)}`,
  ), 20000);
  return { reply: result?.text?.trim() || '' };
}

async function summarizeThread(threadId) {
  const msgs = await getThreadMessages(threadId, 30);
  if (!msgs.length) return { summary: '', entities: [], resolution_state: 'open' };
  const convo = msgs.map((m) => `${m.sender}: ${m.body}`).join('\n');
  const result = await withTimeout(callLLMChain(
    `Summarize this support conversation. Return ONLY JSON:
{"summary":"2-3 sentence summary","entities":["key people/places/topics"],"resolution_state":"open|in_progress|resolved"}
Be factual, under 60 words total.`,
    `Conversation:\n${convo.slice(0, 1800)}`,
  ), 20000);
  return result?.text ? (extractJson(result.text) || { summary: '', entities: [], resolution_state: 'open' }) : { summary: '', entities: [], resolution_state: 'open' };
}

async function applyBulkAction(ids, action) {
  const results = [];
  for (const tid of ids || []) {
    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(tid)) continue;
    const state = await getThreadState(tid);
    if (action === 'close') {
      await supabase.from('chat_threads').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('thread_id', tid);
    } else if (action === 'release') {
      state.handoff = false; state.agent = 'general';
    } else if (action === 'takeover') {
      state.handoff = true; state.agent = 'admin';
    } else if (action === 'route_emotional') {
      state.agent = 'emotional'; state.handoff = false;
    } else { continue; }
    await setThreadState(tid, state);
    results.push({ thread_id: tid, ok: true });
  }
  return { processed: results.length, results };
}

async function getInsights() {
  const { data: msgs } = await supabase
    .from('chat_messages')
    .select('body,created_at,sender')
    .order('created_at', 'desc')
    .limit(200);
  const rows = msgs || [];
  const days = 7;
  const byDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    byDay.push({ date: d.toISOString().slice(0, 10), count: 0 });
  }
  for (const m of rows) {
    const key = (m.created_at || '').slice(0, 10);
    const slot = byDay.find((b) => b.date === key);
    if (slot) slot.count++;
  }
  const text = rows.map((r) => (r.body || '')).join(' ').toLowerCase();
  const watch = ['pothole', 'road', 'bully', 'mental', 'teacher', 'wifi', 'library', 'bus', 'water', 'grade', 'food', 'bathroom'];
  const topics = {};
  for (const w of watch) {
    const c = (text.match(new RegExp(w, 'g')) || []).length;
    if (c >= 2) topics[w] = c;
  }
  const insights = Object.entries(topics)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w, c]) => `"${w}" mentioned ${c}× in recent messages`);
  return { trend: byDay, insights, total_recent: rows.length };
}

// ─── HTTP Handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // ── GET: admin views all threads ──────────────────────────
    if (req.method === 'GET') {
      const { thread_id, threads, insights } = req.query;

      // Admin: aggregate insights + sentiment trend
      if (insights === '1') {
        if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
        const data = await getInsights();
        return res.status(200).json(data);
      }

      // Admin: list all threads with summaries
      if (threads === '1') {
        if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

        // OPTIMIZED: Get threads first, then only last message per thread
        const { data: dbThreads } = await supabase
          .from('chat_threads')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(50);

        if (!dbThreads?.length) return res.status(200).json([]);

        // Get inbox states for visible threads only
        const threadIds = dbThreads.map((t) => t.thread_id);
        const states = {};
        const { data: stateRows } = await supabase
          .from('settings')
          .select('key,value')
          .like('key', 'inbox_state:%');
        for (const row of stateRows || []) {
          const tid = row.key.replace('inbox_state:', '');
          if (threadIds.includes(tid)) states[tid] = row.value;
        }

        // Get last message + unread count for each thread (batch query)
        const threadMsgCounts = {};
        const threadLastMsg = {};
        const { data: recentMsgs } = await supabase
          .from('chat_messages')
          .select('thread_id,sender,read,body,created_at')
          .in('thread_id', threadIds)
          .order('created_at', { ascending: false })
          .limit(200);

        for (const m of recentMsgs || []) {
          if (!threadMsgCounts[m.thread_id]) {
            threadMsgCounts[m.thread_id] = { total: 0, unread: 0 };
            threadLastMsg[m.thread_id] = m;
          }
          threadMsgCounts[m.thread_id].total++;
          if (m.sender === 'user' && !m.read) threadMsgCounts[m.thread_id].unread++;
        }

        const enriched = dbThreads.map((th) => {
          const state = states[th.thread_id] || {};
          const counts = threadMsgCounts[th.thread_id] || { total: 0, unread: 0 };
          return {
            ...th,
            last_message: threadLastMsg[th.thread_id]?.body || '',
            last_sender: threadLastMsg[th.thread_id]?.sender || '',
            last_at: threadLastMsg[th.thread_id]?.created_at || th.updated_at,
            unread: counts.unread,
            ai_agent: state.agent || 'general',
            handoff: state.handoff || false,
            emotion: state.emotion_history?.[state.emotion_history.length - 1] || null,
            triage: state.triage || null,
            status: th.status || 'open',
            message_count: counts.total,
          };
        });

        return res.status(200).json(enriched);
      }

      // Get messages for a specific thread (limit to last 100 for performance)
      if (thread_id) {
        const limit = Math.min(parseInt(req.query.limit) || 100, 200);
        const [{ data: msgs, error }, { data: thread }] = await Promise.all([
          supabase.from('chat_messages').select('*').eq('thread_id', thread_id).order('created_at', 'asc').limit(limit),
          supabase.from('chat_threads').select('*').eq('thread_id', thread_id).maybeSingle(),
        ]);
        if (error) throw error;

        // Get thread state
        const state = await getThreadState(thread_id);

        return res.status(200).json({ messages: msgs || [], thread: thread || null, state });
      }

      return res.status(400).json({ error: 'Missing thread_id or threads=1' });
    }

    // ── POST: user sends message or admin action ──────────────
    if (req.method === 'POST') {
      const b = req.body || {};
      
      // Admin-only actions that don't need thread_id
      const admin = await isAdmin(req);
      
      // ── Cleanup test threads (no thread_id needed) ─────────
      if (admin && b.action === 'cleanup_threads') {
        const patterns = b.patterns || ['test', 'dbg', 'e2e', 'smoke', 'health-', 'thread_debug', 'thread_crit', 'thread_anx', 'thread_neu', 'inbox-test', 'inbox-e2e', 'lt_', 'live_test_', 'pos-test', 'crit-test', 'ai-test', 'anon_test', 'stress_chat', 'fulltest'];
        
        // Get all threads
        const { data: allThreads } = await supabase.from('chat_threads').select('thread_id');
        const matchThreads = (allThreads || []).filter((t) => 
          patterns.some((p) => t.thread_id.toLowerCase().includes(p.toLowerCase()))
        );
        
        if (matchThreads.length === 0) {
          return res.status(200).json({ ok: true, deleted: 0, message: 'No matching threads found' });
        }
        
        let deleted = 0;
        for (const t of matchThreads) {
          await supabase.from('chat_messages').delete().eq('thread_id', t.thread_id);
          await supabase.from('chat_threads').delete().eq('thread_id', t.thread_id);
          await supabase.from('settings').delete().eq('key', `inbox_state:${t.thread_id}`);
          deleted++;
        }
        
        await auditLog('admin', 'inbox_cleanup', `Cleaned up ${deleted} test threads`);
        return res.status(200).json({ ok: true, deleted, threads: matchThreads.map((t) => t.thread_id) });
      }
      
      // ── Deduplicate messages in a thread ────────────────────
      if (admin && b.action === 'dedup_messages') {
        const threadId = clean(b.thread_id, 40);
        if (!threadId) return res.status(400).json({ error: 'Missing thread_id' });
        
        // Fetch all messages for this thread
        const { data: allMsgs } = await supabase
          .from('chat_messages')
          .select('id, sender, body, created_at')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: true });
        
        if (!allMsgs || allMsgs.length === 0) {
          return res.status(200).json({ ok: true, removed: 0, message: 'No messages found' });
        }
        
        // Find duplicates: same sender + body + within 2 seconds of each other
        const toDelete = new Set();
        for (let i = 0; i < allMsgs.length; i++) {
          if (toDelete.has(allMsgs[i].id)) continue;
          for (let j = i + 1; j < allMsgs.length; j++) {
            if (toDelete.has(allMsgs[j].id)) continue;
            const timeDiff = Math.abs(new Date(allMsgs[i].created_at).getTime() - new Date(allMsgs[j].created_at).getTime());
            if (allMsgs[i].sender === allMsgs[j].sender && 
                allMsgs[i].body === allMsgs[j].body && 
                timeDiff < 10000) {
              toDelete.add(allMsgs[j].id); // Keep first, delete duplicate
            }
          }
        }
        
        if (toDelete.size > 0) {
          const ids = [...toDelete];
          // Delete in batches of 100
          for (let k = 0; k < ids.length; k += 100) {
            await supabase.from('chat_messages').delete().in('id', ids.slice(k, k + 100));
          }
        }
        
        await auditLog('admin', 'inbox_dedup', `Deduped ${toDelete.size} duplicate messages in ${threadId}`);
        return res.status(200).json({ ok: true, removed: toDelete.size, total: allMsgs.length });
      }
      
      // ── Deduplicate ALL threads ────────────────────────────
      if (admin && b.action === 'dedup_all') {
        const { data: allThreads } = await supabase.from('chat_threads').select('thread_id');
        let totalRemoved = 0;
        
        for (const t of (allThreads || [])) {
          const { data: allMsgs } = await supabase
            .from('chat_messages')
            .select('id, sender, body, created_at')
            .eq('thread_id', t.thread_id)
            .order('created_at', { ascending: true });
          
          if (!allMsgs || allMsgs.length < 2) continue;
          
          const toDelete = new Set();
          for (let i = 0; i < allMsgs.length; i++) {
            if (toDelete.has(allMsgs[i].id)) continue;
            for (let j = i + 1; j < allMsgs.length; j++) {
              if (toDelete.has(allMsgs[j].id)) continue;
              const timeDiff = Math.abs(new Date(allMsgs[i].created_at).getTime() - new Date(allMsgs[j].created_at).getTime());
              if (allMsgs[i].sender === allMsgs[j].sender && 
                  allMsgs[i].body === allMsgs[j].body && 
                  timeDiff < 10000) {
                toDelete.add(allMsgs[j].id);
              }
            }
          }
          
          if (toDelete.size > 0) {
            const ids = [...toDelete];
            for (let k = 0; k < ids.length; k += 100) {
              await supabase.from('chat_messages').delete().in('id', ids.slice(k, k + 100));
            }
            totalRemoved += toDelete.size;
          }
        }
        
        await auditLog('admin', 'inbox_dedup_all', `Deduped ${totalRemoved} duplicate messages across all threads`);
        return res.status(200).json({ ok: true, removed: totalRemoved });
      }
      
      // Thread-specific actions below
      const threadId = clean(b.thread_id, 40);
      if (!threadId) return res.status(400).json({ error: 'Missing thread_id' });
      // FIX-M2: validate thread_id format — alphanumeric, hyphens, underscores only, 3-40 chars
      if (!/^[a-zA-Z0-9_-]{3,40}$/.test(threadId)) return res.status(400).json({ error: 'Invalid thread_id format' });

      // ── Admin actions ────────────────────────────────────
      if (admin && b.action === 'takeover') {
        const state = await getThreadState(threadId);
        state.handoff = true;
        state.agent = 'admin';
        state.handoff_at = new Date().toISOString();
        await setThreadState(threadId, state);

        // Send handoff message to user
        const handoffMsg = "A team member has joined the conversation and will assist you directly. 👤";
        await supabase.from('chat_messages').insert({
          thread_id: threadId, sender: 'admin', body: handoffMsg,
        });

        await auditLog('admin', 'inbox_takeover', `Admin took over thread ${threadId}`);
        return res.status(200).json({ ok: true, state });
      }

      if (admin && b.action === 'release') {
        const state = await getThreadState(threadId);
        state.handoff = false;
        state.agent = 'general';
        state.released_at = new Date().toISOString();
        await setThreadState(threadId, state);
        await auditLog('admin', 'inbox_release', `Admin released thread ${threadId}`);
        return res.status(200).json({ ok: true, state });
      }

      if (admin && b.action === 'transfer_emotional') {
        const state = await getThreadState(threadId);
        state.agent = 'emotional';
        state.handoff = false;
        state.transfer_reason = b.reason || 'emotional_support_needed';
        await setThreadState(threadId, state);
        await auditLog('admin', 'inbox_transfer', `Thread ${threadId} transferred to emotional agent: ${b.reason}`);
        return res.status(200).json({ ok: true, state });
      }

      // ── Agent Operations Center actions ────────────────────
      if (admin && b.action === 'triage') {
        const triage = await triageThread(threadId);
        return res.status(200).json({ ok: true, triage });
      }

      if (admin && b.action === 'draft_reply') {
        const { reply } = await draftReplyForThread(threadId);
        return res.status(200).json({ ok: true, reply });
      }

      if (admin && b.action === 'summary') {
        const summary = await summarizeThread(threadId);
        return res.status(200).json({ ok: true, ...summary });
      }

      if (admin && b.action === 'bulk_action') {
        const ids = Array.isArray(b.thread_ids) ? b.thread_ids : [];
        const result = await applyBulkAction(ids, b.bulk_action || b.operation);
        await auditLog('admin', 'inbox_bulk', `Bulk ${b.bulk_action || b.operation} on ${result.processed} threads`);
        return res.status(200).json({ ok: true, ...result });
      }

      if (admin && b.action === 'admin_reply') {
        const body = String(b.body || '').slice(0, 4000).trim();
        if (!body) return res.status(400).json({ error: 'Empty reply' });
        const { data: ins } = await supabase.from('chat_messages').insert({
          thread_id: threadId,
          sender: 'admin',
          body,
          read: true,
          created_at: new Date().toISOString(),
        }).select().single();
        const state = await getThreadState(threadId);
        state.handoff = true;
        state.agent = 'admin';
        await setThreadState(threadId, state);
        await supabase.from('chat_threads').update({ updated_at: new Date().toISOString(), status: b.close ? 'closed' : 'open' }).eq('thread_id', threadId);
        await supabase.from('chat_messages').update({ read: true }).eq('thread_id', threadId).eq('sender', 'user');
        await auditLog('admin', 'inbox_reply', `Admin replied to ${threadId}`);
        return res.status(200).json({ ok: true, message: ins });
      }

      // ── Create task for agent ────────────────────────────
      if (admin && b.action === 'create_task') {
        const taskBody = String(b.body || '').slice(0, 2000).trim();
        const agentId = String(b.agent_id || '').trim();
        const priority = String(b.priority || 'medium').trim();
        if (!taskBody) return res.status(400).json({ error: 'Task description required' });
        
        // Create task in agent_tasks table
        const { data: task, error: taskErr } = await supabase.from('agent_tasks').insert({
          thread_id: threadId,
          agent_id: agentId || null,
          task: taskBody,
          priority,
          status: 'pending',
          created_by: 'admin',
          created_at: new Date().toISOString(),
        }).select().single();
        if (taskErr) throw taskErr;
        
        // Add system message to thread about the task
        await supabase.from('chat_messages').insert({
          thread_id: threadId,
          sender: 'system',
          body: `📋 Task created: "${taskBody.slice(0, 100)}" — Assigned to: ${agentId || 'auto-assign'}`,
          read: true,
          created_at: new Date().toISOString(),
        });
        
        await auditLog('admin', 'inbox_task', `Task created for ${threadId}: ${taskBody.slice(0, 50)}`);
        return res.status(201).json({ ok: true, task });
      }

      // ── Send message to agent ─────────────────────────────
      if (admin && b.action === 'send_to_agent') {
        const agentId = String(b.agent_id || '').trim();
        const msgBody = String(b.body || '').slice(0, 2000).trim();
        if (!agentId || !msgBody) return res.status(400).json({ error: 'agent_id and body required' });
        
        // Create agent task with the message
        const { data: task } = await supabase.from('agent_tasks').insert({
          thread_id: threadId,
          agent_id: agentId,
          task: msgBody,
          priority: 'high',
          status: 'pending',
          created_by: 'admin',
          created_at: new Date().toISOString(),
        }).select().single();
        
        // Add system message
        await supabase.from('chat_messages').insert({
          thread_id: threadId,
          sender: 'system',
          body: `🤖 Message sent to agent: ${agentId}`,
          read: true,
          created_at: new Date().toISOString(),
        });
        
        await auditLog('admin', 'inbox_agent_msg', `Message sent to ${agentId} for ${threadId}`);
        return res.status(200).json({ ok: true, task });
      }

      // ── User sends message ─────────────────────────────
      if (!admin) {
        const gate = await checkUser(threadId);
        if (!gate.ok) return res.status(403).json({ error: gate.error });
        if (await rateLimited('chat_messages', threadId, 60, 10)) {
          return rateLimitResponse(res, 60, 'Slow down — max 10 messages per minute.');
        }
      }

      const body = maskProfanity(clean(b.body, 2000));
      if (!body && !b.attachment_url) return res.status(400).json({ error: 'Empty message' });

      // Server-side dedup: check for same sender+body within 10s window
      const tenSecsAgo = new Date(Date.now() - 10000).toISOString();
      const { data: recentDup } = await supabase
        .from('chat_messages')
        .select('id, body, created_at, sender')
        .eq('thread_id', threadId)
        .eq('sender', admin ? 'admin' : 'user')
        .eq('body', body)
        .gte('created_at', tenSecsAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentDup) {
        // Duplicate found — return existing message, skip insert + AI reply
        console.log(`[inbox] Dedup: blocked duplicate message in ${threadId} (id=${recentDup.id})`);
        return res.status(201).json({
          message: recentDup,
          auto_reply: null,
          emotion: { level: 'none', emotion: 'none' },
          agent: 'admin',
          handoff: false,
          admin_online: false,
          escalate: false,
          dedup: true,
        });
      }

      // 1. Save user message
      const { data: savedMsg, error: saveErr } = await supabase.from('chat_messages').insert({
        thread_id: threadId,
        sender: admin ? 'admin' : 'user',
        body,
        attachment_url: clean(b.attachment_url, 500) || null,
      }).select().single();
      if (saveErr) throw saveErr;

      // Ensure thread exists
      const { data: existingThread } = await supabase.from('chat_threads').select('thread_id').eq('thread_id', threadId).maybeSingle();
      const now = new Date().toISOString();
      if (existingThread) {
        await supabase.from('chat_threads').update({ updated_at: now, status: 'open' }).eq('thread_id', threadId);
      } else {
        await supabase.from('chat_threads').insert({ thread_id: threadId, status: 'open', updated_at: now });
      }

      // If admin is sending, just save and return
      if (admin) {
        return res.status(201).json({ message: savedMsg, auto_reply: null, emotion: null });
      }

      // 2. Generate AI reply with timeout (must complete before response)
      let emotion = { level: 'none', emotion: 'none', agent: 'default' };
      let replyResult = { reply: null, agent: 'default', handoff: false };

      try {
        // Run emotion + reply with 35s total timeout (Vercel has 60s max)
        const aiWork = (async () => {
          const [emo, threadState] = await Promise.all([
            classifyEmotion(body),
            getThreadState(threadId),
          ]);
          threadState.message_count = (threadState.message_count || 0) + 1;
          if (!threadState.emotion_history) threadState.emotion_history = [];
          if (emo.level !== 'none') {
            threadState.emotion_history.push({ emotion: emo.emotion, level: emo.emotion, at: now });
            if (threadState.emotion_history.length > 20) threadState.emotion_history = threadState.emotion_history.slice(-20);
          }
          if (!threadState.recent_messages) threadState.recent_messages = [];
          threadState.recent_messages.push({ role: 'user', content: body.slice(0, 200) });
          if (threadState.recent_messages.length > 10) threadState.recent_messages = threadState.recent_messages.slice(-10);
          const adminOnline = await isAdminOnline();
          const reply = await generateReply(body, threadState, emo, adminOnline);
          return { emotion: emo, replyResult: reply, threadState };
        })();

        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('AI timeout')), 35000));
        const { emotion: emo, replyResult: rr, threadState } = await Promise.race([aiWork, timeout]);
        emotion = emo;
        replyResult = rr;

        // Update thread state
        threadState.agent = replyResult.agent || threadState.agent;
        if (replyResult.handoff !== undefined) threadState.handoff = replyResult.handoff;
        if (emotion.agent === 'emotional' && threadState.agent !== 'emotional') {
          threadState.agent = 'emotional';
          threadState.transfer_reason = emotion.emotion;
        }
        await setThreadState(threadId, threadState);

        // Save AI reply
        let aiReply = null;
        if (replyResult.reply) {
          const { data: aiMsg } = await supabase.from('chat_messages').insert({
            thread_id: threadId, sender: 'ai', body: replyResult.reply,
          }).select().single();
          aiReply = aiMsg;
          threadState.recent_messages.push({ role: 'assistant', content: replyResult.reply.slice(0, 200) });
          if (threadState.recent_messages.length > 10) threadState.recent_messages = threadState.recent_messages.slice(-10);
          await setThreadState(threadId, threadState);
        }

        // Notify admin if needed
        if (replyResult.notifyAdmin || replyResult.escalate || emotion.level === 'critical' || emotion.level === 'high') {
          await notifyAdmin(threadId, body, emotion, replyResult.agent);
        }

        await auditLog('user', 'inbox_message', `Thread ${threadId}: emotion=${emotion.emotion}(${emotion.level}), agent=${replyResult.agent}, reply=${!!replyResult.reply}`);
        emitEvent(EVENT_TYPES.INBOX_MESSAGE, { thread_id: threadId, sender: 'user', emotion: emotion.emotion, level: emotion.level }).catch(() => {});

        return res.status(201).json({
          message: savedMsg,
          auto_reply: aiReply,
          emotion: { level: emotion.level, emotion: emotion.emotion },
          agent: replyResult.agent,
          handoff: replyResult.handoff || false,
          admin_online: false,
          escalate: replyResult.escalate || false,
        });
      } catch (aiErr) {
        console.error('[inbox] AI generation failed/timed out:', aiErr.message);
        await auditLog('user', 'inbox_ai_error', `Thread ${threadId}: ${aiErr.message}`);

        // Save a fallback offline message so user sees a reply instead of blank
        let fallbackReply = null;
        try {
          const fallbackText = 'Thank you for your message. Our team is currently away but will get back to you shortly. Please leave your message and we will respond as soon as possible.';
          const { data: fallbackMsg } = await supabase.from('chat_messages').insert({
            thread_id: threadId,
            sender: 'ai',
            content: fallbackText,
            metadata: { agent: 'default', offline_fallback: true, error: aiErr.message },
          }).select().single();
          fallbackReply = fallbackMsg || { content: fallbackText };
        } catch (fallbackErr) {
          console.error('[inbox] Fallback message save failed:', fallbackErr.message);
        }

        return res.status(201).json({
          message: savedMsg,
          auto_reply: fallbackReply,
          emotion: { level: 'none', emotion: 'error' },
          agent: 'default',
          handoff: false,
          admin_online: false,
          escalate: false,
          ai_error: aiErr.message,
        });
      }
    }

    // ── PUT: mark read, set status ────────────────────────────
    if (req.method === 'PUT') {
      const b = req.body || {};
      const admin = await isAdmin(req);

      if (b.action === 'mark_read') {
        if (!b.thread_id) return res.status(400).json({ error: 'Missing thread_id' });
        const senderToMark = admin && b.as === 'admin' ? 'user' : 'admin';
        let markQ = supabase.from('chat_messages').update({ read: true }).eq('thread_id', b.thread_id).eq('sender', senderToMark);
        if (!admin) markQ = markQ.eq('thread_id', clean(b.thread_id, 40));
        await markQ;
        return res.status(200).json({ ok: true });
      }

      if (b.action === 'set_status') {
        if (!admin) return res.status(403).json({ error: 'Admin only' });
        await supabase.from('chat_threads').update({
          status: b.status === 'closed' ? 'closed' : 'open',
          updated_at: new Date().toISOString(),
        }).eq('thread_id', b.thread_id);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return sanitizeError(res, err, 'inbox');
  }
}
