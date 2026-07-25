// AI Trend Detection — analyzes platform trends over time.
// GET  /api/trends?period=month  →  trend analysis for the specified period
// POST /api/trends { period, custom_from, custom_to }  →  custom period analysis
import supabase from './_db-client.js';
import { cors, isAdmin } from './_auth.js';

function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // Require admin auth — exposes aggregate trend data
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const period = req.body?.period || req.query.period || 'month';
    let daysBack;
    switch (period) {
      case 'week': daysBack = 7; break;
      case 'quarter': daysBack = 90; break;
      case 'year': daysBack = 365; break;
      default: daysBack = 30;
    }

    const fromDate = daysAgo(daysBack);
    const midPoint = daysAgo(Math.floor(daysBack / 2));

    // Fetch posts in the analysis window (comment_count and reactions are NOT real DB columns)
    let { data: posts } = await supabase.from('posts')
      .select('id, title, description, category, status, priority, created_at')
      .eq('deleted', false)
      .gte('created_at', fromDate)
      .order('created_at', { ascending: true });

    // Fallback: if no posts in the period, show all-time data
    let usedFallback = false;
    if (!posts || posts.length === 0) {
      usedFallback = true;
      const allResult = await supabase.from('posts')
        .select('id, title, description, category, status, priority, created_at')
        .eq('deleted', false)
        .order('created_at', { ascending: true });
      posts = allResult.data;
    }

    if (!posts || posts.length === 0) {
      return res.status(200).json({
        period, days_back: daysBack, total_posts: 0,
        daily_frequency: [], category_distribution: {}, priority_trends: {},
        emerging_topics: [], resolution_rate: 0, avg_resolution_time_days: 0,
      });
    }

    // Enrich posts with reactions and comment counts from separate tables
    const postIds = posts.map((p) => p.id);
    const [{ data: allReactions }, { data: allComments }] = await Promise.all([
      supabase.from('reactions').select('target_id, kind').in('target_id', postIds.length ? postIds : ['_']),
      supabase.from('comments').select('post_id').in('post_id', postIds.length ? postIds : ['_']),
    ]);
    const rMap = {};
    (allReactions || []).forEach((r) => { rMap[r.target_id] = rMap[r.target_id] || {}; rMap[r.target_id][r.kind] = (rMap[r.target_id][r.kind] || 0) + 1; });
    const cMap = {};
    (allComments || []).forEach((c) => { cMap[c.post_id] = (cMap[c.post_id] || 0) + 1; });
    posts = posts.map((p) => ({ ...p, reactions: rMap[p.id] || {}, comment_count: cMap[p.id] || 0 }));

    // Daily post frequency
    const dailyFreq = {};
    posts.forEach((p) => {
      const day = p.created_at.split('T')[0];
      dailyFreq[day] = (dailyFreq[day] || 0) + 1;
    });

    // Category distribution
    const byCategory = {};
    posts.forEach((p) => {
      const cat = p.category || 'Uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    // Priority trends
    const byPriority = { high: 0, medium: 0, low: 0 };
    posts.forEach((p) => { if (byPriority[p.priority] !== undefined) byPriority[p.priority]++; });

    // Resolution rate
    const resolved = posts.filter((p) => p.status === 'solved' || p.status === 'closed').length;
    const resolutionRate = posts.length > 0 ? Math.round((resolved / posts.length) * 100) : 0;

    // Emerging topics: compare recent half vs first half
    const recentHalf = posts.filter((p) => new Date(p.created_at) >= new Date(midPoint));
    const firstHalf = posts.filter((p) => new Date(p.created_at) < new Date(midPoint));

    const recentCats = {};
    const firstCats = {};
    recentHalf.forEach((p) => { const c = p.category || 'Uncategorized'; recentCats[c] = (recentCats[c] || 0) + 1; });
    firstHalf.forEach((p) => { const c = p.category || 'Uncategorized'; firstCats[c] = (firstCats[c] || 0) + 1; });

    const emergingTopics = Object.entries(recentCats).map(([cat, count]) => {
      const prevCount = firstCats[cat] || 0;
      const growth = prevCount > 0 ? Math.round(((count - prevCount) / prevCount) * 100) : count > 0 ? 100 : 0;
      return { category: cat, recent_count: count, previous_count: prevCount, growth_pct: growth };
    }).filter((t) => t.growth_pct > 0).sort((a, b) => b.growth_pct - a.growth_pct);

    // Average resolution time (for solved posts)
    const solvedPosts = posts.filter((p) => p.status === 'solved' || p.status === 'closed');
    let avgResolutionDays = 0;
    if (solvedPosts.length > 0) {
      const totalDays = solvedPosts.reduce((sum, p) => sum + (Date.now() - new Date(p.created_at).getTime()) / 86400000, 0);
      avgResolutionDays = Math.round(totalDays / solvedPosts.length * 10) / 10;
    }

    // Most active categories
    const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 10);

    return res.status(200).json({
      period,
      days_back: daysBack,
      total_posts: posts.length,
      all_time: usedFallback,
      daily_frequency: Object.entries(dailyFreq).map(([date, count]) => ({ date, count })),
      category_distribution: byCategory,
      top_categories: topCategories.map(([name, count]) => ({ name, count })),
      priority_trends: byPriority,
      emerging_topics: emergingTopics,
      resolution_rate: resolutionRate,
      avg_resolution_time_days: avgResolutionDays,
      recent_vs_previous: { recent: recentHalf.length, previous: firstHalf.length },
    });
  } catch (err) {
    console.error('trends error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
