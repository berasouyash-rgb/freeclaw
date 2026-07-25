// AI Conversation Assistant — auto-reply when admin is offline, emotional flagging.
// POST /api/conversation-assist { thread_id, message }  →  AI auto-reply or flag
// GET  /api/conversation-assist?thread_id=X           →  check if auto-reply is active
// NO templates — every reply comes directly from the external LLM model
import supabase from './_db-client.js';
import { cors, auditLog, clean } from './_auth.js';
import { callLLMChain } from './_providers.js';

const EMOTIONAL_KEYWORDS = {
  distressed: ['suicide', 'kill myself', 'end my life', 'can\'t go on', 'no reason to live', 'self harm', 'hurt myself'],
  angry: ['furious', 'enraged', 'livid', 'outraged', 'disgusted', 'hate this school', 'worst ever', 'unacceptable'],
  anxious: ['scared', 'terrified', 'anxious', 'worried sick', 'panic', 'stressed', 'overwhelmed'],
  sad: ['depressed', 'hopeless', 'worthless', 'nobody cares', 'alone', 'lonely', 'cry'],
};

function detectEmotion(text) {
  const lower = text.toLowerCase();
  for (const [emotion, keywords] of Object.entries(EMOTIONAL_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return emotion;
  }
  return null;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

function getEmotionMeta(emotion) {
  switch (emotion) {
    case 'distressed': return { priority: 'immediate', escalate: true, flags: ['emotional_distress', 'requires_immediate_attention'] };
    case 'angry': return { priority: 'high', escalate: false, flags: ['emotional_elevated'] };
    case 'anxious': case 'sad': return { priority: 'medium', escalate: false, flags: ['emotional_mild'] };
    default: return { priority: 'low', escalate: false, flags: ['auto_reply'] };
  }
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // GET: check auto-reply status
    if (req.method === 'GET') {
      const threadId = req.query.thread_id;
      const { data } = await supabase.from('settings').select('value').eq('key', `conversation_assist:${threadId || 'global'}`).maybeSingle();
      return res.status(200).json({ active: data?.value?.active ?? true, settings: data?.value || {} });
    }

    // POST: process message
    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.thread_id || !b.message) return res.status(400).json({ error: 'thread_id and message required' });

      const message = clean(b.message, 2000);
      const emotion = detectEmotion(message);
      const meta = getEmotionMeta(emotion);

      // Check if admin is online (had activity in last 10 minutes)
      let adminOnline = false;
      try {
        const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
        const { data: thread } = await supabase.from('chat_threads').select('updated_at').eq('id', b.thread_id).maybeSingle();
        adminOnline = thread && new Date(thread.updated_at) > new Date(tenMinAgo);
      } catch { /* assume offline */ }

      // Only auto-reply if admin is offline or escalation is needed
      const shouldReply = !adminOnline || meta.escalate;

      // All replies come from the LLM — no templates
      let finalReply = null;
      let provider = 'none';
      if (shouldReply) {
        const systemPrompt = emotion === 'distressed'
          ? 'You are a trained school counselor. A student is in crisis. Respond with empathy, validate their feelings, and provide crisis resources. Keep under 100 words. Never dismiss their pain.'
          : 'You are a helpful school support assistant. Be empathetic, supportive, and professional. Keep replies under 100 words. Never dismiss concerns.';

        try {
          const result = await withTimeout(callLLMChain(
            systemPrompt,
            `A student wrote: "${message.slice(0, 800)}"\n\nProvide a direct, empathetic response.`,
          ), 20000);
          if (result?.text && result.text.length > 10) {
            finalReply = result.text.trim();
            provider = `${result.provider}:${result.model}`;
          }
        } catch (e) {
          console.error('[conversation-assist] LLM call failed:', e.message);
        }
      }

      // Store the auto-reply decision
      await supabase.from('settings').upsert(
        {
          key: `conversation_assist:${b.thread_id}`,
          value: {
            last_message: message.slice(0, 200),
            emotion,
            auto_reply_sent: shouldReply && !!finalReply,
            reply: finalReply,
            admin_online: adminOnline,
            priority: meta.priority,
            escalate: meta.escalate,
            flags: meta.flags,
            processed_at: new Date().toISOString(),
          },
        },
        { onConflict: 'key' },
      );

      // If escalation needed, add to notifications for admins
      if (meta.escalate) {
        const { data: existingNotifs } = await supabase.from('settings').select('value').eq('key', 'notifications:admin').maybeSingle();
        const notifs = existingNotifs?.value?.notifications || [];
        notifs.unshift({
          id: `notif_${Date.now().toString(36)}`,
          type: 'escalation',
          title: `⚠️ Urgent: Student emotional distress detected`,
          body: `Thread ${b.thread_id}: Student message requires immediate attention (content truncated for privacy)`,
          post_id: null,
          thread_id: b.thread_id,
          read: false,
          created_at: new Date().toISOString(),
        });
        await supabase.from('settings').upsert(
          { key: 'notifications:admin', value: { notifications: notifs.slice(0, 100), updated_at: new Date().toISOString() } },
          { onConflict: 'key' },
        );
      }

      // Audit trail: truncate message to avoid logging full PII
      const auditSnippet = message.slice(0, 40).replace(/[^\w\s]/g, '') + (message.length > 40 ? '...' : '');
      await auditLog('system', 'conversation_assist', `Processed message in thread ${b.thread_id}: emotion=${emotion || 'none'}, auto_reply=${shouldReply && !!finalReply}, snippet="${auditSnippet}"`);

      return res.status(200).json({
        emotion,
        auto_reply: finalReply,
        admin_online: adminOnline,
        priority: meta.priority,
        escalate: meta.escalate,
        flags: meta.flags,
        provider,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('conversation-assist error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
