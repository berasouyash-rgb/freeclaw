// AI Resolution Assistant — analyzes complaints and provides root cause, resolution steps, department routing.
// POST /api/ai-resolution { post_id }  →  AI analysis of a complaint
// GET  /api/ai-resolution?post_id=X   →  fetch cached resolution for a post
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';
import { callLLMChain } from './_providers.js';

const DEPARTMENTS = [
  'Academics', 'Facilities', 'Canteen', 'Transport', 'Discipline',
  'Sports', 'IT', 'Administration', 'Events',
];

const DEPARTMENT_KEYWORDS = {
  Academics:    ['homework', 'exam', 'class', 'teacher', 'grades', 'syllabus', 'curriculum', 'assignment', 'marks', 'lecture', 'study', 'course', 'professor'],
  Facilities:   ['building', 'room', 'furniture', 'AC', 'leak', 'electricity', 'maintenance', 'repair', 'toilet', 'washroom', 'ceiling', 'fan', 'light', 'bench', 'infra'],
  Canteen:      ['food', 'meal', 'lunch', 'cafeteria', 'hygiene', 'menu', 'water', 'taste', 'stale', 'price', 'quality', 'vegetarian'],
  Transport:    ['bus', 'transport', 'route', 'driver', 'pick-up', 'drop-off', 'commute', 'parking', 'vehicle'],
  Discipline:   ['fight', 'bullying', 'behavior', 'rule', 'punishment', 'uniform', 'lateness', 'truancy', 'misconduct', 'harassment'],
  Sports:       ['sports', 'team', 'match', 'coach', 'gym', 'playground', 'tournament', 'cricket', 'football', 'basketball', 'athletics'],
  IT:           ['computer', 'internet', 'WiFi', 'software', 'network', 'laptop', 'technical', 'server', 'email', 'portal', 'login'],
  Administration: ['fee', 'payment', 'admission', 'certificate', 'letter', 'document', 'office', 'principal', 'staff', 'register'],
  Events:       ['event', 'function', 'festival', 'celebration', 'trip', 'excursion', 'cultural', 'annual day', 'assembly'],
};

const PRIORITY_KEYWORDS = {
  critical: ['emergency', 'dangerous', 'safety', 'injury', 'violence', 'death', 'sexual', 'assault', 'threat'],
  high:     ['urgent', 'immediate', 'serious', 'severe', 'broken', 'flooding', 'fire', 'theft', 'crime', 'hospital'],
  medium:   ['problem', 'issue', 'complaint', 'concern', 'unfair', 'unhappy', 'dissatisfied', 'not working'],
  low:      ['suggestion', 'improve', 'minor', 'cosmetic', 'idea', 'feedback', 'small', 'tiny'],
};

function classifyDepartment(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [dept, keywords] of Object.entries(DEPARTMENT_KEYWORDS)) {
    scores[dept] = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) scores[dept] += 1;
    }
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] > 0 ? sorted[0][0] : 'Administration';
}

function classifyPriority(text) {
  const lower = text.toLowerCase();
  for (const [level, keywords] of Object.entries(PRIORITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return level;
    }
  }
  return 'medium';
}

function generateResolutionSteps(category, priority) {
  const steps = [];
  if (priority === 'critical') {
    steps.push('Immediate escalation required — notify school administration within the hour');
    steps.push('Contact the affected student(s) to ensure safety');
  }
  steps.push(`Assign to the ${category || 'Administration'} department for review`);
  steps.push('Acknowledge receipt to the complainant within 24 hours');
  steps.push('Investigate the issue and gather relevant information');
  if (category === 'Academics') {
    steps.push('Consult with the department head or class coordinator');
    steps.push('Review academic policies relevant to the complaint');
  } else if (category === 'Facilities') {
    steps.push('Conduct a physical inspection of the reported area');
    steps.push('Log a maintenance request if repair is needed');
  } else if (category === 'Canteen') {
    steps.push('Review food safety and hygiene records');
    steps.push('Gather feedback from other students on the same issue');
  } else if (category === 'Discipline') {
    steps.push('Involve the discipline committee or student affairs');
    steps.push('Follow the school\'s disciplinary procedure');
  } else if (category === 'IT') {
    steps.push('Check technical systems for reported issues');
    steps.push('Coordinate with IT support team');
  }
  steps.push('Provide a resolution update to the complainant');
  steps.push('Document the outcome for future reference');
  return steps;
}

function generateFollowUpChecklist(category) {
  const base = [
    'Confirm complainant is satisfied with the resolution',
    'Update the complaint status in the system',
  ];
  const extras = {
    Academics: ['Verify academic improvement if applicable', 'Schedule follow-up with teacher if needed'],
    Facilities: ['Schedule maintenance recheck in 1 week', 'Verify the fix is permanent'],
    Canteen: ['Monitor food quality for 1 week post-resolution', 'Check hygiene compliance'],
    Discipline: ['Monitor behavior for 30 days', 'Schedule counseling if needed'],
    IT: ['Verify the technical fix works for 3 days', 'Check user satisfaction'],
  };
  return [...base, ...(extras[category] || [])];
}

function estimateResolutionTime(priority, category) {
  if (priority === 'critical') return '2-4 hours';
  if (priority === 'high') return '1-3 days';
  if (category === 'Facilities') return '3-7 days';
  if (category === 'Academics') return '1-5 days';
  if (category === 'Canteen') return '1-2 days';
  return '3-5 days';
}

async function findSimilarComplaints(title, description, category) {
  const words = `${title} ${description}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  if (words.length === 0) return [];
  const { data } = await supabase.from('posts').select('id, title, category, status, created_at')
    .eq('deleted', false).neq('id', '').order('created_at', { ascending: false }).limit(100);
  if (!data) return [];
  const scored = data.map((post) => {
    const postWords = `${post.title} ${post.description || ''}`.toLowerCase().split(/\W+/);
    const overlap = words.filter((w) => postWords.includes(w)).length;
    const score = overlap / Math.max(words.length, 1);
    return { ...post, similarity: Math.round(score * 100) };
  }).filter((p) => p.similarity > 20).sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, 5);
}

async function analyzeWithLLM(post) {
  const prompt = `Analyze this school complaint and provide resolution advice.
Title: ${post.title}
Description: ${post.description || 'No description'}
Category: ${post.category || 'Unknown'}
Priority: ${post.priority || 'medium'}

Provide a JSON response with:
- root_cause_analysis: string (1-2 sentences about likely root cause)
- resolution_steps: array of specific steps
- estimated_resolution_time: time estimate
- follow_up_checklist: array of follow-up items

Return ONLY valid JSON.`;

  try {
    const result = await callLLMChain('You are a school complaint resolution AI assistant.', prompt, { profile: 'sentiment-analysis' });
    if (result?.text) {
      const cleaned = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    }
  } catch { /* fall through to heuristic */ }
  return null;
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const b = req.body || {};
    const postId = b.post_id || req.query.post_id;

    // GET: retrieve cached resolution
    if (req.method === 'GET') {
      if (!postId) return res.status(400).json({ error: 'post_id required' });
      const { data } = await supabase.from('settings').select('value').eq('key', `ai_resolution:${postId}`).maybeSingle();
      if (!data?.value) return res.status(404).json({ error: 'No resolution found for this post' });
      return res.status(200).json(data.value);
    }

    // POST: generate new resolution
    if (req.method === 'POST') {
      if (!postId) return res.status(400).json({ error: 'post_id required' });
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

      // Fetch the post
      const { data: post, error: postErr } = await supabase.from('posts').select('*').eq('id', postId).maybeSingle();
      if (postErr || !post) return res.status(404).json({ error: 'Post not found' });

      const combinedText = `${post.title} ${post.description || ''}`;
      const department = classifyDepartment(combinedText);
      const priority = classifyPriority(combinedText);
      const similar = await findSimilarComplaints(post.title, post.description || '', post.category);

      // Try LLM analysis first, fall back to heuristic
      let llmAnalysis = null;
      try { llmAnalysis = await analyzeWithLLM(post); } catch { /* use heuristic */ }

      const resolution = {
        post_id: postId,
        problem_summary: post.title,
        root_cause_analysis: llmAnalysis?.root_cause_analysis || `This is a ${department.toLowerCase()} issue categorized as ${priority} priority. The complaint relates to: ${post.title}`,
        similar_complaints: similar.map((s) => ({ id: s.id, title: s.title, category: s.category, similarity: s.similarity, status: s.status })),
        resolution_steps: llmAnalysis?.resolution_steps || generateResolutionSteps(department, priority),
        priority_level: priority,
        estimated_resolution_time: llmAnalysis?.estimated_resolution_time || estimateResolutionTime(priority, department),
        recommended_department: department,
        follow_up_checklist: llmAnalysis?.follow_up_checklist || generateFollowUpChecklist(department),
        analyzed_at: new Date().toISOString(),
        analyzer: llmAnalysis ? 'llm' : 'heuristic',
      };

      // Cache the result
      await supabase.from('settings').upsert(
        { key: `ai_resolution:${postId}`, value: resolution },
        { onConflict: 'key' },
      );

      await auditLog('admin', 'ai_resolution', `Analyzed complaint: ${postId} → ${department}/${priority}`);

      return res.status(200).json(resolution);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('ai-resolution error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
