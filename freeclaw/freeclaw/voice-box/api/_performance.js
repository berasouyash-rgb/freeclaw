// Performance Dashboard — real-time performance metrics for the platform.
// GET /api/performance  →  API response times, DB latency, error rates, storage stats
import supabase from './_db-client.js';
import { cors, isAdmin } from './_auth.js';

async function measureQuery(tableName, operation = 'count') {
  const start = Date.now();
  try {
    if (operation === 'count') {
      const { count } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
      return { latency_ms: Date.now() - start, count: count || 0, status: 'ok' };
    }
    if (operation === 'select') {
      const { data } = await supabase.from(tableName).select('id').order('created_at', { ascending: false }).limit(1);
      return { latency_ms: Date.now() - start, status: 'ok', sample: data?.[0]?.id };
    }
  } catch (err) {
    return { latency_ms: Date.now() - start, status: 'error', error: err.message };
  }
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const startTime = Date.now();

    // Measure API response times for each table
    const [postsCount, commentsCount, reactionsCount, pollsCount, usersCount, reportsCount, chatCount, logsCount] = await Promise.all([
      measureQuery('posts'), measureQuery('comments'), measureQuery('reactions'),
      measureQuery('polls'), measureQuery('users_meta'), measureQuery('reports'),
      measureQuery('chat_threads'), measureQuery('activity_logs'),
    ]);

    // DB latency (simple query)
    const dbLatency = await measureQuery('settings', 'select');

    // Active users (seen in last 5 minutes)
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    let activeUsers = 0;
    try {
      const { count } = await supabase.from('users_meta').select('*', { count: 'exact', head: true }).gte('last_seen', fiveMinAgo);
      activeUsers = count || 0;
    } catch { /* non-fatal */ }

    // Error rate (last hour)
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    let errorCount = 0;
    try {
      const { count } = await supabase.from('activity_logs').select('*', { count: 'exact', head: true }).gte('created_at', oneHourAgo).like('action', '%error%');
      errorCount = count || 0;
    } catch { /* non-fatal */ }

    // Pending jobs
    let pendingReports = 0;
    try {
      const { count } = await supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open');
      pendingReports = count || 0;
    } catch { /* non-fatal */ }

    const totalLatency = Date.now() - startTime;

    return res.status(200).json({
      api_response_times: {
        posts_ms: postsCount.latency_ms,
        comments_ms: commentsCount.latency_ms,
        reactions_ms: reactionsCount.latency_ms,
        polls_ms: pollsCount.latency_ms,
        users_ms: usersCount.latency_ms,
        reports_ms: reportsCount.latency_ms,
        chat_ms: chatCount.latency_ms,
        logs_ms: logsCount.latency_ms,
      },
      database_latency_ms: dbLatency.latency_ms,
      active_users: activeUsers,
      error_rate_per_hour: errorCount,
      storage: {
        posts: postsCount.count,
        comments: commentsCount.count,
        reactions: reactionsCount.count,
        polls: pollsCount.count,
        users: usersCount.count,
        reports: reportsCount.count,
        chat_threads: chatCount.count,
        activity_logs: logsCount.count,
      },
      pending_jobs: { reports: pendingReports },
      total_calculation_ms: totalLatency,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('performance error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
