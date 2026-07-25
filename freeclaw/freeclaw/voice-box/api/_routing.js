// AI Department Routing — auto-categorizes complaints into departments using keyword analysis.
// POST /api/routing { post_id }        →  route a specific post to a department
// POST /api/routing/auto               →  auto-route all unrouted posts
// GET  /api/routing/stats              →  routing statistics
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog } from './_auth.js';

const DEPARTMENTS = {
  Academics:      ['homework', 'exam', 'class', 'teacher', 'grades', 'syllabus', 'curriculum', 'assignment', 'marks', 'lecture', 'study', 'course', 'professor', 'textbook', 'test', 'quiz', 'grading'],
  Facilities:     ['building', 'room', 'furniture', 'AC', 'leak', 'electricity', 'maintenance', 'repair', 'toilet', 'washroom', 'ceiling', 'fan', 'light', 'bench', 'infra', 'plumbing', 'paint', 'window', 'door', 'roof'],
  Canteen:        ['food', 'meal', 'lunch', 'cafeteria', 'hygiene', 'menu', 'water', 'taste', 'stale', 'price', 'quality', 'vegetarian', 'breakfast', 'snack', 'serving'],
  Transport:      ['bus', 'transport', 'route', 'driver', 'pick-up', 'drop-off', 'commute', 'parking', 'vehicle', 'stop', 'timetable', 'conductor'],
  Discipline:     ['fight', 'bullying', 'behavior', 'rule', 'punishment', 'uniform', 'lateness', 'truancy', 'misconduct', 'harassment', 'abuse', 'violence', 'ragging'],
  Sports:         ['sports', 'team', 'match', 'coach', 'gym', 'playground', 'tournament', 'cricket', 'football', 'basketball', 'athletics', 'stadium', 'equipment'],
  IT:             ['computer', 'internet', 'WiFi', 'software', 'network', 'laptop', 'technical', 'server', 'email', 'portal', 'login', 'password', 'website', 'app', 'hack'],
  Administration: ['fee', 'payment', 'admission', 'certificate', 'letter', 'document', 'office', 'principal', 'staff', 'register', 'record', 'transfer', 'receipt'],
  Events:         ['event', 'function', 'festival', 'celebration', 'trip', 'excursion', 'cultural', 'annual day', 'assembly', 'program', 'competition', 'workshop'],
};

function classifyDepartment(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [dept, keywords] of Object.entries(DEPARTMENTS)) {
    scores[dept] = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) scores[dept] += 1;
    }
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  return { department: best[1] > 0 ? best[0] : 'Administration', confidence: best[1] > 0 ? Math.min(best[1] / 5, 1) : 0.3, all_scores: Object.fromEntries(sorted.filter(([, s]) => s > 0)) };
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // GET: routing statistics
    if (req.method === 'GET' && req.query.action === 'stats') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const { data: posts } = await supabase.from('posts').select('category, status, priority, created_at').eq('deleted', false).order('created_at', { ascending: false }).limit(500);
      if (!posts) return res.status(200).json({ stats: {}, departments: {} });

      const byDept = {};
      const byStatus = {};
      const byPriority = {};
      posts.forEach((p) => {
        const dept = classifyDepartment(`${p.title || ''} ${p.description || ''}`).department;
        byDept[dept] = (byDept[dept] || 0) + 1;
        if (p.status) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
        if (p.priority) byPriority[p.priority] = (byPriority[p.priority] || 0) + 1;
      });

      return res.status(200).json({
        total_routed: posts.length,
        by_department: byDept,
        by_status: byStatus,
        by_priority: byPriority,
      });
    }

    // POST
    if (req.method === 'POST') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const b = req.body || {};

      // Auto-route all unrouted posts
      if (b.action === 'auto') {
        const { data: posts } = await supabase.from('posts')
          .select('id, title, description, category, status')
          .eq('deleted', false).order('created_at', { ascending: false }).limit(200);
        if (!posts) return res.status(200).json({ routed: 0 });

        let routed = 0;
        for (const post of posts) {
          const classification = classifyDepartment(`${post.title} ${post.description || ''}`);
          // Store routing decision in settings
          await supabase.from('settings').upsert(
            { key: `routing:${post.id}`, value: { department: classification.department, confidence: classification.confidence, scores: classification.all_scores, routed_at: new Date().toISOString() } },
            { onConflict: 'key' },
          );
          routed++;
        }
        await auditLog('admin', 'auto_route', `Auto-routed ${routed} posts`);
        return res.status(200).json({ routed });
      }

      // Route a specific post
      if (!b.post_id) return res.status(400).json({ error: 'post_id required' });
      const { data: post } = await supabase.from('posts').select('*').eq('id', b.post_id).maybeSingle();
      if (!post) return res.status(404).json({ error: 'Post not found' });

      const classification = classifyDepartment(`${post.title} ${post.description || ''}`);
      const routing = {
        post_id: b.post_id,
        department: classification.department,
        confidence: classification.confidence,
        scores: classification.all_scores,
        routed_at: new Date().toISOString(),
      };

      await supabase.from('settings').upsert(
        { key: `routing:${b.post_id}`, value: routing },
        { onConflict: 'key' },
      );

      await auditLog('admin', 'route_post', `Routed ${b.post_id} → ${classification.department} (${Math.round(classification.confidence * 100)}%)`);
      return res.status(200).json(routing);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('routing error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
