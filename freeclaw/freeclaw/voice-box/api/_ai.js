// AI Analysis — uses configurable provider chain from _providers.js.
// No hardcoded providers. Admin configures default + failover order in the UI.
// Built-in heuristic fallback when no provider is available.
import { cors, isAdmin } from './_auth.js';
import { callLLMChain } from './_providers.js';

function parseJson(text) {
  try {
    return JSON.parse(String(text || '').replace(/^```json?\s*/i, '').replace(/```\s*$/, ''));
  } catch { return null; }
}

/** Call LLM via the shared provider chain. Returns parsed JSON or null. */
async function callLLMJson(system, user) {
  const result = await callLLMChain(system + '\nRespond with STRICT valid JSON only. No markdown, no prose.', user);
  if (!result) return null;
  return { engine: `${result.provider}:${result.model}`, result: parseJson(result.text) };
}

// ---------- Deterministic heuristic fallback (no API key needed) ----------
function heuristicAnalysis(posts) {
  const urgentWords = /\b(urgent|danger|unsafe|injur|threat|bully|harass|broken|emergency|health|fire|leak|assault)\b/i;
  const scored = posts.map((p) => {
    const title = p.title || '';
    const desc = p.description || '';
    const support = p.reactions?.support || 0;
    const disagree = p.reactions?.disagree || 0;
    const comments = p.comment_count || 0;
    const ageDays = Math.max(0.2, (Date.now() - new Date(p.created_at).getTime()) / 86400000);
    const severity = { low: 1, medium: 2, high: 3, critical: 4 }[p.priority] || 2;
    const textUrgency = urgentWords.test(title + ' ' + desc) ? 2 : 0;
    const growth = (support + comments) / ageDays;
    const score = support * 3 + comments * 2 - disagree + severity * 3 + textUrgency * 4 + growth * 2;
    return {
      id: p.id, title, category: p.category,
      urgency_score: Math.min(100, Math.round(score * 2.2)),
      rank_score: Math.round(score * 10) / 10,
      support_ratio: support + disagree > 0 ? Math.round((support / (support + disagree)) * 100) : 100,
      flags: [
        ...(textUrgency ? ['urgency-keywords'] : []),
        ...(p.category === 'Bullying' || p.category === 'Security' || p.category === 'Medical' ? ['safety-risk'] : []),
        ...(disagree > support && disagree > 3 ? ['contested'] : []),
      ],
      recommended_action: severity >= 3 || textUrgency
        ? 'Verify immediately and escalate to staff'
        : comments > 4 ? 'High engagement — respond publicly' : 'Review within normal queue',
      confidence: 0.62,
    };
  }).sort((a, b) => b.rank_score - a.rank_score);

  const clusters = [];
  const used = new Set();
  const words = (t) => new Set(t.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
  for (let i = 0; i < posts.length; i++) {
    if (used.has(posts[i].id)) continue;
    const group = [posts[i].id];
    const wi = words((posts[i].title || '') + ' ' + (posts[i].description || ''));
    for (let j = i + 1; j < posts.length; j++) {
      if (used.has(posts[j].id)) continue;
      const wj = words((posts[j].title || '') + ' ' + (posts[j].description || ''));
      const overlap = [...wi].filter((w) => wj.has(w)).length;
      if ((posts[i].category === posts[j].category && overlap >= 3) || overlap >= 5) {
        group.push(posts[j].id); used.add(posts[j].id);
      }
    }
    if (group.length > 1) clusters.push({ topic: posts[i].title || 'Untitled', post_ids: group, count: group.length });
  }

  const catCount = {};
  posts.forEach((p) => { catCount[p.category] = (catCount[p.category] || 0) + 1; });
  const topCats = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return {
    engine: 'heuristic-fallback',
    generated_at: new Date().toISOString(),
    summary: `Analyzed ${posts.length} items. Top categories: ${topCats.map(([c, n]) => `${c} (${n})`).join(', ') || 'none'}. ${clusters.length} duplicate cluster(s) detected. ${scored.filter((s) => s.urgency_score > 70).length} item(s) flagged high urgency.`,
    ranked_issues: scored.slice(0, 15),
    duplicate_clusters: clusters,
    safety_alerts: scored.filter((s) => s.flags.includes('safety-risk')).map((s) => ({ id: s.id, title: s.title, reason: 'Category indicates potential safety concern' })),
    weekly_insights: {
      total: posts.length,
      high_urgency: scored.filter((s) => s.urgency_score > 70).length,
      trending_category: topCats[0]?.[0] || 'N/A',
      recommendation: 'Prioritize the top 3 ranked issues and publish status updates to maintain community trust.',
    },
  };
}

function heuristicModeration(text) {
  const bad = /\b(kill|hurt|attack|weapon|drugs|suicide)\b/i.test(text);
  const bully = /\b(loser|stupid|ugly|hate you|worthless|idiot)\b/i.test(text);
  const spam = /(http[s]?:\/\/|www\.|buy now|free money|click here)/i.test(text) || /(.)\1{6,}/.test(text);
  return {
    engine: 'heuristic-fallback',
    abuse: bad, bullying: bully, spam,
    safety_risk: bad,
    action: bad ? 'escalate' : bully || spam ? 'review' : 'allow',
    confidence: 0.55,
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { task, posts, text, poll } = req.body || {};

    if (task === 'moderate') {
      const ai = await callLLMJson(
        'You are a school-content moderator. Analyze the text for abuse, bullying, spam, and safety risks.',
        `Text: """${String(text || '').slice(0, 1500)}"""\nReturn JSON: {"abuse":bool,"bullying":bool,"spam":bool,"safety_risk":bool,"action":"allow|review|escalate","reason":string,"confidence":0-1}`
      );
      return res.status(200).json(ai && ai.result ? { engine: ai.engine, ...ai.result } : heuristicModeration(String(text || '')));
    }

    if (task === 'analyze') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const items = (posts || []).slice(0, 60).map((p) => ({
        id: p.id, title: p.title, description: (p.description || '').slice(0, 240),
        category: p.category, priority: p.priority, status: p.status,
        reactions: p.reactions, comments: p.comment_count, created_at: p.created_at,
      }));
      const ai = await callLLMJson(
        'You are an analyst for an anonymous school feedback platform. Cluster duplicates, detect urgency, rank issues using votes, support ratio, severity, recurrence, comment volume and growth rate. Detect abuse/spam/bullying/safety risks.',
        `Feedback items JSON:\n${JSON.stringify(items)}\n\nReturn JSON with keys: summary (string), ranked_issues (array of {id,title,category,urgency_score:0-100,rank_score,support_ratio,flags:[],recommended_action,confidence:0-1}), duplicate_clusters (array of {topic,post_ids,count}), safety_alerts (array of {id,title,reason}), weekly_insights ({total,high_urgency,trending_category,recommendation}).`
      );
      if (ai && ai.result) {
        // Validate LLM result — fall back to heuristic if summary is empty/undefined
        const result = ai.result;
        if (result.summary && typeof result.summary === 'string' && result.summary.trim().length > 10 && !result.summary.includes('undefined')) {
          return res.status(200).json({ engine: ai.engine, generated_at: new Date().toISOString(), ...result });
        }
      }
      return res.status(200).json(heuristicAnalysis(posts || []));
    }

    if (task === 'categorize') {
      const input = String(text || '').slice(0, 600).toLowerCase();
      const KEYWORDS = {
        Academics: ['exam', 'homework', 'class', 'lesson', 'grade', 'test', 'study', 'curriculum', 'syllabus', 'timetable'],
        Facilities: ['ac', 'air condition', 'chair', 'desk', 'window', 'door', 'roof', 'classroom', 'building', 'fan', 'light', 'broken', 'repair'],
        Food: ['canteen', 'food', 'lunch', 'meal', 'cafeteria', 'snack', 'menu', 'hungry', 'queue'],
        Bullying: ['bully', 'harass', 'threat', 'intimidat', 'mock', 'teas', 'corner', 'afraid', 'scared'],
        Teachers: ['teacher', 'staff', 'professor', 'lecture', 'unfair', 'favorit', 'shout'],
        Events: ['event', 'club', 'fest', 'competition', 'trip', 'excursion', 'celebration'],
        Transport: ['bus', 'transport', 'route', 'pickup', 'driver', 'late bus'],
        Sports: ['sport', 'gym', 'football', 'basketball', 'pe ', 'playground', 'field', 'court'],
        Technology: ['wifi', 'internet', 'computer', 'laptop', 'projector', 'network', 'password', 'printer'],
        Library: ['library', 'book', 'reading', 'study space', 'quiet'],
        Hostel: ['hostel', 'dorm', 'room', 'warden', 'bed'],
        Security: ['security', 'theft', 'stolen', 'guard', 'gate', 'stranger', 'unsafe', 'cctv'],
        Cleanliness: ['clean', 'dirty', 'trash', 'soap', 'toilet', 'bathroom', 'hygien', 'smell', 'garbage'],
        Medical: ['nurse', 'sick', 'injur', 'first aid', 'medic', 'health', 'infirmary'],
      };
      let best = 'Other'; let bestScore = 0;
      for (const [cat, words] of Object.entries(KEYWORDS)) {
        const score = words.reduce((a, w) => a + (input.includes(w) ? 1 : 0), 0);
        if (score > bestScore) { best = cat; bestScore = score; }
      }
      const ai = bestScore > 0 ? null : await callLLMJson(
        'Classify school feedback into exactly one category.',
        `Text: """${input}"""\nCategories: Academics, Facilities, Food, Bullying, Teachers, Events, Transport, Sports, Technology, Library, Hostel, Security, Cleanliness, Medical, Other.\nReturn JSON: {"category": string, "confidence": 0-1}`
      );
      const category = ai?.result?.category && Object.keys(KEYWORDS).concat('Other').includes(ai.result.category) ? ai.result.category : best;
      return res.status(200).json({
        engine: ai ? ai.engine : 'heuristic-keywords',
        category,
        confidence: ai?.result?.confidence ?? Math.min(0.95, 0.4 + bestScore * 0.18),
      });
    }

    if (task === 'summarize') {
      const ai = await callLLMJson(
        'Summarize this school feedback item in 1-2 neutral sentences for administrators.',
        `Item: ${JSON.stringify({ title: req.body.title, description: req.body.description })}\nReturn JSON: {"summary": string}`
      );
      if (ai?.result?.summary) return res.status(200).json({ engine: ai.engine, summary: ai.result.summary });
      const d = String(req.body.description || '');
      return res.status(200).json({ engine: 'heuristic-fallback', summary: `${req.body.title}. ${d.slice(0, 140)}${d.length > 140 ? '…' : ''}` });
    }

    if (task === 'poll_insight') {
      const ai = await callLLMJson(
        'You analyze school poll results and give one short, neutral insight for students and staff.',
        `Poll: ${JSON.stringify(poll)}\nReturn JSON: {"insight": string}`
      );
      if (ai?.result?.insight) return res.status(200).json({ engine: ai.engine, insight: ai.result.insight });
      const counts = poll?.vote_counts || {};
      const total = poll?.total_votes || 0;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const pct = total && top ? Math.round((top[1] / total) * 100) : 0;
      const opt = poll?.options?.[Number(top?.[0])] || 'the leading option';
      return res.status(200).json({
        engine: 'heuristic-fallback',
        insight: total === 0 ? 'No votes yet — share the poll to gather opinions.' : `"${opt}" leads with ${pct}% of ${total} vote${total !== 1 ? 's' : ''}${pct >= 70 ? ' — a strong consensus.' : pct >= 50 ? ' — a clear majority.' : ' — opinions are split.'}`,
      });
    }

    return res.status(400).json({ error: 'Unknown task' });
  } catch (err) {
    console.error('ai API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
