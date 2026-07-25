// Smart Search — global search across posts, comments, and polls.
// GET /api/search?q=keyword&type=all&status=all&category=all&priority=all&department=all
import supabase from './_db-client.js';
import { cors } from './_auth.js';

/** Escape LIKE metacharacters to prevent pattern injection */
function escapeLike(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

    const q = (req.query.q || '').trim();
    const type = req.query.type || 'all';
    const status = req.query.status || 'all';
    const category = req.query.category || 'all';
    const priority = req.query.priority || 'all';
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const page = Math.max(parseInt(req.query.page) || 1, 1);

    if (!q && type === 'all') {
      return res.status(200).json({ results: [], total: 0, query: '' });
    }
    // FIX-M3: enforce minimum query length of 3 characters
    if (q && q.length < 3) return res.status(400).json({ error: 'Query must be at least 3 characters' });

    const results = [];
    const lower = q.toLowerCase();

    // Search posts — fetch all non-deleted posts and filter in code for reliability
    if (type === 'all' || type === 'posts') {
      // Note: reactions and comment_count are computed in _posts.js, not actual DB columns
      let query = supabase.from('posts').select('id, type, title, description, category, status, priority, author_id, created_at, tags, deleted, hidden')
        .eq('deleted', false);
      if (status !== 'all') query = query.eq('status', status);
      if (category !== 'all') query = query.eq('category', category);
      if (priority !== 'all') query = query.eq('priority', priority);
      query = query.order('created_at', { ascending: false }).limit(type === 'posts' ? limit : Math.ceil(limit * 0.7));

      const { data: posts, error: postErr } = await query;
      if (postErr) {
        console.error('search posts query error:', JSON.stringify(postErr));
      }
      if (posts) {
        const words = q ? q.toLowerCase().split(/\s+/).filter(w => w.length > 1) : [];
        posts.forEach((p) => {
          const titleLower = (p.title || '').toLowerCase();
          const descLower = (p.description || '').toLowerCase();
          const tagsStr = Array.isArray(p.tags) ? p.tags.join(' ').toLowerCase() : '';
          // Match if ANY search word appears in title, description, or tags
          const matches = q ? words.some(w => titleLower.includes(w) || descLower.includes(w) || tagsStr.includes(w)) : true;
          if (!matches) return;
          const titleMatch = words.some(w => titleLower.includes(w));
          const descMatch = words.some(w => descLower.includes(w));
          const tagMatch = words.some(w => tagsStr.includes(w));
          const score = (titleMatch ? 3 : 0) + (descMatch ? 1 : 0) + (tagMatch ? 2 : 0);
          results.push({
            type: 'post',
            id: p.id,
            title: p.title,
            description: (p.description || '').slice(0, 200),
            category: p.category,
            status: p.status,
            priority: p.priority,
            author_id: p.author_id,
            created_at: p.created_at,
            relevance_score: score || 1,
          });
        });
      }
    }

    // Search comments — match main handler: filter hidden for non-admins
    if (type === 'all' || type === 'comments') {
      let query = supabase.from('comments').select('id, post_id, body, author_id, created_at, hidden').eq('deleted', false).eq('hidden', false);
      if (q) {
        const firstWord = q.split(/\s+/).filter(w => w.length > 1)[0] || q;
        query = query.ilike('body', `%${escapeLike(firstWord)}%`);
      }
      query = query.order('created_at', { ascending: false }).limit(type === 'comments' ? limit : Math.ceil(limit * 0.2));
      const { data: comments } = await query;
      if (comments) {
        comments.forEach((c) => {
          results.push({
            type: 'comment',
            id: c.id,
            post_id: c.post_id,
            body: (c.body || '').slice(0, 200),
            author_id: c.author_id,
            created_at: c.created_at,
            relevance_score: 1,
          });
        });
      }
    }

    // Search polls
    if (type === 'all' || type === 'polls') {
      let query = supabase.from('polls').select('id, title, options, ptype, author_id, created_at, archived').eq('deleted', false);
      if (q) {
        const firstWord = q.split(/\s+/).filter(w => w.length > 1)[0] || q;
        query = query.ilike('title', `%${escapeLike(firstWord)}%`);
      }
      query = query.order('created_at', { ascending: false }).limit(type === 'polls' ? limit : Math.ceil(limit * 0.1));
      const { data: polls } = await query;
      if (polls) {
        polls.forEach((p) => {
          results.push({
            type: 'poll',
            id: p.id,
            title: p.title,
            options: p.options,
            ptype: p.ptype,
            author_id: p.author_id,
            created_at: p.created_at,
            archived: p.archived,
            relevance_score: 1,
          });
        });
      }
    }

    // Sort by relevance score and recency
    results.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0) || new Date(b.created_at) - new Date(a.created_at));

    // Pagination
    const total = results.length;
    const start = (page - 1) * limit;
    const paged = results.slice(start, start + limit);

    return res.status(200).json({
      results: paged,
      total,
      page,
      pages: Math.ceil(total / limit),
      query: q,
      filters: { type, status, category, priority },
    });
  } catch (err) {
    console.error('search error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
