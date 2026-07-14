// Real-time AI writing assistance: category detection, tag suggestions,
// title improvement, and contextual chat replies. Uses Claude when
// ANTHROPIC_API_KEY is set; otherwise a fast keyword engine (always works).
import { cors, isAdmin, rateLimited } from './_auth.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

async function callClaude(system, user, maxTokens = 400) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: maxTokens,
        system: system + '\nRespond with STRICT valid JSON only.',
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return JSON.parse((data?.content?.[0]?.text || '').replace(/^```json?\s*/i, '').replace(/```\s*$/, ''));
  } catch { return null; }
}

// ---------- Fast keyword engine (no API key needed, <1ms) ----------
const CATEGORY_KEYWORDS = {
  Academics: ['exam', 'homework', 'assignment', 'syllabus', 'grade', 'marks', 'test', 'study', 'lesson', 'class', 'subject', 'teacher explains', 'curriculum'],
  Facilities: ['ac', 'air conditioning', 'fan', 'light', 'chair', 'desk', 'bench', 'door', 'window', 'roof', 'leak', 'broken', 'repair', 'building', 'wall', 'paint', 'projector', 'toilet', 'washroom', 'bathroom', 'water cooler', 'fountain'],
  Food: ['canteen', 'food', 'lunch', 'meal', 'menu', 'snack', 'cafeteria', 'hygiene food', 'taste', 'queue lunch', 'expensive food'],
  Bullying: ['bully', 'bullying', 'harass', 'threat', 'teasing', 'intimidat', 'ragging', 'mock', 'exclude', 'unsafe', 'scared'],
  Teachers: ['teacher', 'staff', 'professor', 'faculty', 'rude', 'favoritism', 'late to class', 'absent teacher', 'substitute'],
  Events: ['event', 'fest', 'club', 'competition', 'annual day', 'sports day', 'celebration', 'function', 'trip', 'excursion'],
  Transport: ['bus', 'transport', 'route', 'driver', 'pickup', 'drop', 'late bus', 'crowded bus', 'parking', 'cycle stand'],
  Sports: ['sports', 'gym', 'ground', 'football', 'cricket', 'basketball', 'equipment', 'coach', 'pe ', 'physical education', 'playground'],
  Technology: ['wifi', 'wi-fi', 'internet', 'computer', 'laptop', 'smartboard', 'network', 'lab computer', 'software', 'website', 'portal'],
  Library: ['library', 'book', 'reading', 'librarian', 'study space', 'quiet room'],
  Hostel: ['hostel', 'dorm', 'warden', 'room mate', 'mess', 'curfew', 'laundry'],
  Security: ['security', 'guard', 'gate', 'cctv', 'theft', 'stolen', 'stranger', 'id card', 'safety gate'],
  Cleanliness: ['clean', 'dirty', 'garbage', 'trash', 'dust', 'smell', 'sweep', 'hygiene', 'soap', 'sanitiz', 'washroom smell'],
  Medical: ['medical', 'nurse', 'first aid', 'sick', 'injury', 'health', 'medicine', 'infirmary', 'doctor'],
};

function keywordAssist(text) {
  const t = text.toLowerCase();
  const scores = {};
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of kws) if (t.includes(kw)) scores[cat] = (scores[cat] || 0) + (kw.length > 6 ? 2 : 1);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const category = ranked[0]?.[0] || null;
  const confidence = ranked[0] ? Math.min(0.95, 0.4 + ranked[0][1] * 0.12) : 0;

  // tags: pick matched keywords as tags
  const tags = [];
  if (category) {
    for (const kw of CATEGORY_KEYWORDS[category]) {
      if (t.includes(kw) && tags.length < 3) tags.push(kw.trim().replace(/\s+/g, '-'));
    }
  }

  // priority heuristics
  const urgent = /\b(urgent|danger|unsafe|injur|emergency|fire|threat|bully|harass|leak|broken glass)\b/i.test(text);
  const high = /\b(broken|not working|every ?day|weeks?|month|always|still)\b/i.test(text);
  const priority = urgent ? 'critical' : high ? 'high' : 'medium';

  return { engine: 'keyword', category, confidence, tags, priority };
}

const CHAT_TEMPLATES = [
  { match: /\b(thank|thanks|great|solved|fixed|works now)\b/i, reply: "You're welcome! Glad it's sorted. Reach out anytime — this stays anonymous. 🙌" },
  { match: /\b(when|how long|eta|update|status|progress)\b/i, reply: 'Let me check the latest status with the team and get back to you here shortly. Your report is being tracked.' },
  { match: /\b(urgent|danger|unsafe|scared|threat|bully|harass)\b/i, reply: 'Thank you for telling us — safety reports get top priority. This is being escalated to staff right now. If anyone is in immediate danger, please also alert the nearest teacher.' },
  { match: /\b(who|see|anonymous|identity|know me|trace)\b/i, reply: "We can only see your random anonymous ID — never your name, email, or device. It's completely safe to talk here." },
  { match: /\b(how|where|submit|report|post)\b/i, reply: 'You can submit anonymously from the "Submit" page — describe the problem, pick a category, and publish. No name needed.' },
  { match: /\?$/, reply: "Good question — I'm checking with the responsible staff member and will reply here as soon as I know more." },
];

function keywordChatReply(lastUserMessage) {
  for (const t of CHAT_TEMPLATES) if (t.match.test(lastUserMessage)) return t.reply;
  return 'Thanks for the message — could you share a bit more detail (where, when, how often)? That helps us act faster.';
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { task, text, messages } = req.body || {};

    // ---- Real-time submission assist (public, fast) ----
    if (task === 'suggest') {
      const input = String(text || '').slice(0, 800);
      if (input.trim().length < 8) return res.status(200).json({ engine: 'none', category: null, tags: [], priority: null });
      // Rate limit: max 30 suggestions per IP per 5 minutes
      if (await rateLimited('assist_suggest', req.headers['x-forwarded-for'] || 'anon', 300, 30)) {
        return res.status(429).json({ error: 'Too many requests — please wait a moment.' });
      }
      const fallback = keywordAssist(input);
      // Only call the LLM for longer text to keep latency low
      if (input.length > 60) {
        const ai = await callClaude(
          'You classify school feedback. Categories: Academics, Facilities, Food, Bullying, Teachers, Events, Transport, Sports, Technology, Library, Hostel, Security, Cleanliness, Medical, Other.',
          `Text: """${input}"""\nReturn JSON: {"category":string,"confidence":0-1,"tags":[max 3 short kebab-case strings],"priority":"low|medium|high|critical","improved_title":string(max 80 chars, clear and specific)}`,
          300
        );
        if (ai?.category) return res.status(200).json({ engine: MODEL, ...ai });
      }
      return res.status(200).json(fallback);
    }

    // ---- AI chat reply (admin side) ----
    if (task === 'chat_reply') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      // Rate limit: max 20 chat replies per admin per 5 minutes
      if (await rateLimited('assist_chat', req.headers['x-admin-token'] || 'anon', 300, 20)) {
        return res.status(429).json({ error: 'Too many requests — please wait a moment.' });
      }
      const history = (messages || []).slice(-8).map((m) => `${m.sender === 'admin' ? 'Admin' : 'Student'}: ${String(m.body || '').slice(0, 300)}`).join('\n');
      const lastUser = [...(messages || [])].reverse().find((m) => m.sender === 'user');
      const ai = await callClaude(
        'You are a kind, professional school admin replying to an anonymous student in a support chat. Keep replies short (1-3 sentences), warm, and actionable. Never ask for personal details.',
        `Conversation:\n${history}\n\nReturn JSON: {"reply": string}`,
        250
      );
      if (ai?.reply) return res.status(200).json({ engine: MODEL, reply: ai.reply });
      return res.status(200).json({ engine: 'keyword', reply: keywordChatReply(lastUser?.body || '') });
    }

    return res.status(400).json({ error: 'Unknown task' });
  } catch (err) {
    console.error('assist API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
