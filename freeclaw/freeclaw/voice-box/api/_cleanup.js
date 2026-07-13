// 7-Day Auto-Cleanup Middleware
// Automatically deletes data older than 7 days to conserve DB space.
// Runs on API cold start (once per function instance) and can be triggered via POST /api/cleanup.
// Designed for limited-memory Supabase instances — deletes in small batches to avoid timeouts.

import supabase from './_db-client.js';
import { cors, isAdmin } from './_auth.js';

const RETENTION_DAYS = 7;
const BATCH_SIZE = 50;

let lastRunAt = 0;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between auto-runs

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function deleteBatch(table, filter, filterCol = 'created_at') {
  const cutoff = daysAgo(RETENTION_DAYS);
  const { count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .lte(filterCol, cutoff)
    .match(filter);

  if (!count || count === 0) return 0;

  // Delete in batches to avoid timeout
  let deleted = 0;
  while (deleted < count) {
    const { data: batch, error: fetchErr } = await supabase
      .from(table)
      .select('id')
      .lte(filterCol, cutoff)
      .match(filter)
      .limit(BATCH_SIZE);

    if (fetchErr || !batch || batch.length === 0) break;

    const ids = batch.map((r) => r.id);
    const { error: delErr } = await supabase
      .from(table)
      .delete()
      .in('id', ids);

    if (delErr) break;
    deleted += batch.length;

    // Safety: if batch was smaller than requested, we're done
    if (batch.length < BATCH_SIZE) break;
  }

  return deleted;
}

async function runCleanup() {
  const now = Date.now();
  if (now - lastRunAt < COOLDOWN_MS) return null;
  lastRunAt = now;

  const results = {};

  // 1. Soft-deleted posts older than 7 days (hard delete)
  try {
    const cutoff = daysAgo(RETENTION_DAYS);
    const { count } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('deleted', true)
      .lte('created_at', cutoff);

    if (count && count > 0) {
      let deleted = 0;
      while (deleted < count) {
        const { data: batch } = await supabase
          .from('posts')
          .select('id')
          .eq('deleted', true)
          .lte('created_at', cutoff)
          .limit(BATCH_SIZE);
        if (!batch || batch.length === 0) break;
        await supabase.from('posts').delete().in('id', batch.map((r) => r.id));
        deleted += batch.length;
        if (batch.length < BATCH_SIZE) break;
      }
      results.deleted_posts = deleted;
    }
  } catch { /* empty */ }

  // 2. Comments on deleted posts or older than 7 days
  try {
    const cutoff = daysAgo(RETENTION_DAYS);
    const { data: oldComments } = await supabase
      .from('comments')
      .select('id')
      .lte('created_at', cutoff)
      .limit(BATCH_SIZE * 3);

    if (oldComments && oldComments.length > 0) {
      await supabase.from('comments').delete().in('id', oldComments.map((c) => c.id));
      results.deleted_comments = oldComments.length;
    }
  } catch { /* empty */ }

  // 3. Reactions older than 7 days
  try {
    const cutoff = daysAgo(RETENTION_DAYS);
    const { data: oldReactions } = await supabase
      .from('reactions')
      .select('id')
      .lte('created_at', cutoff)
      .limit(BATCH_SIZE * 3);

    if (oldReactions && oldReactions.length > 0) {
      await supabase.from('reactions').delete().in('id', oldReactions.map((r) => r.id));
      results.deleted_reactions = oldReactions.length;
    }
  } catch { /* empty */ }

  // 4. Chat messages older than 7 days
  try {
    const cutoff = daysAgo(RETENTION_DAYS);
    const { data: oldMessages } = await supabase
      .from('chat_messages')
      .select('id')
      .lte('created_at', cutoff)
      .limit(BATCH_SIZE * 3);

    if (oldMessages && oldMessages.length > 0) {
      await supabase.from('chat_messages').delete().in('id', oldMessages.map((m) => m.id));
      results.deleted_messages = oldMessages.length;
    }
  } catch { /* empty */ }

  // 5. Activity logs older than 7 days
  try {
    const cutoff = daysAgo(RETENTION_DAYS);
    const { data: oldLogs } = await supabase
      .from('activity_logs')
      .select('id')
      .lte('created_at', cutoff)
      .limit(BATCH_SIZE * 3);

    if (oldLogs && oldLogs.length > 0) {
      await supabase.from('activity_logs').delete().in('id', oldLogs.map((l) => l.id));
      results.deleted_logs = oldLogs.length;
    }
  } catch { /* empty */ }

  // 6. Agent conversation history older than 7 days
  try {
    const cutoff = daysAgo(RETENTION_DAYS);
    const { data: oldConvos } = await supabase
      .from('agent_conversations')
      .select('id')
      .lte('created_at', cutoff)
      .limit(BATCH_SIZE * 3);

    if (oldConvos && oldConvos.length > 0) {
      await supabase.from('agent_conversations').delete().in('id', oldConvos.map((c) => c.id));
      results.deleted_conversations = oldConvos.length;
    }
  } catch { /* empty */ }

  // 7. Archived polls older than 7 days
  try {
    const cutoff = daysAgo(RETENTION_DAYS);
    const { data: oldPolls } = await supabase
      .from('polls')
      .select('id')
      .eq('archived', true)
      .lte('created_at', cutoff)
      .limit(BATCH_SIZE);

    if (oldPolls && oldPolls.length > 0) {
      await supabase.from('polls').delete().in('id', oldPolls.map((p) => p.id));
      results.deleted_polls = oldPolls.length;
    }
  } catch { /* empty */ }

  // 8. Expired user suspensions (reset bans older than 7 days)
  try {
    const { data: bannedUsers } = await supabase
      .from('users_meta')
      .select('anon_id')
      .eq('banned', true)
      .lte('last_seen', daysAgo(RETENTION_DAYS))
      .limit(50);

    if (bannedUsers && bannedUsers.length > 0) {
      for (const u of bannedUsers) {
        await supabase
          .from('users_meta')
          .update({ banned: false, notes: '' })
          .eq('anon_id', u.anon_id);
      }
      results.unbanned_inactive = bannedUsers.length;
    }
  } catch { /* empty */ }

  const total = Object.values(results).reduce((a, b) => a + b, 0);
  return { cleaned: total, details: results, retention_days: RETENTION_DAYS };
}

// Auto-run on cold start (non-blocking)
let cleanupStarted = false;
function triggerAutoCleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  runCleanup().catch(() => {}).finally(() => { cleanupStarted = false; });
}

// HTTP handler for manual trigger
export async function cleanupHandler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const result = await runCleanup();
    if (!result) {
      return res.status(200).json({ message: 'Cleanup ran recently — skipping', cooldown_ms: COOLDOWN_MS });
    }
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('Cleanup error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export { triggerAutoCleanup };
