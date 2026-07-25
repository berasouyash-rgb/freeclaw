// Notification Center — in-app notifications for users.
// GET  /api/notifications?user_id=X            →  get notifications
// POST /api/notifications { user_id, type, title, body, post_id }  →  create notification
// POST /api/notifications/read { notification_id, user_id }        →  mark as read
// DELETE /api/notifications { user_id }         →  clear all notifications
import supabase from './_db-client.js';
import { cors, auditLog, rateLimitResponse } from './_auth.js';

function notificationKey(userId) { return `notifications:${userId}`; }

// Simple in-memory per-user rate limiter for write operations
const userWriteHits = new Map();
function writeRateLimited(userId, windowMs = 60000, limit = 15) {
  const now = Date.now();
  const entry = userWriteHits.get(userId);
  if (!entry || now - entry.start > windowMs) {
    userWriteHits.set(userId, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > limit;
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const userId = req.query.user_id || req.body?.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });

    // Rate limit write operations (POST, DELETE) per user
    if ((req.method === 'POST' || req.method === 'DELETE') && writeRateLimited(userId)) {
      return rateLimitResponse(res, 60, 'Too many requests. Please try again later.');
    }

    // GET: fetch notifications
    if (req.method === 'GET') {
      const { data } = await supabase.from('settings').select('value').eq('key', notificationKey(userId)).maybeSingle();
      const notifications = data?.value?.notifications || [];
      const unread = notifications.filter((n) => !n.read).length;
      return res.status(200).json({ notifications, unread_count: unread, total: notifications.length });
    }

    // POST: create notification
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.notification_id) {
        // Mark as read
        const { data } = await supabase.from('settings').select('value').eq('key', notificationKey(userId)).maybeSingle();
        const notifications = (data?.value?.notifications || []).map((n) =>
          n.id === b.notification_id ? { ...n, read: true, read_at: new Date().toISOString() } : n,
        );
        await supabase.from('settings').upsert(
          { key: notificationKey(userId), value: { notifications, updated_at: new Date().toISOString() } },
          { onConflict: 'key' },
        );
        return res.status(200).json({ success: true });
      }

      // Create new notification
      const notification = {
        id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        type: b.type || 'info',
        title: b.title || 'Notification',
        body: b.body || '',
        post_id: b.post_id || null,
        read: false,
        created_at: new Date().toISOString(),
      };

      const { data } = await supabase.from('settings').select('value').eq('key', notificationKey(userId)).maybeSingle();
      const notifications = data?.value?.notifications || [];
      notifications.unshift(notification);
      // Keep max 100 notifications
      const trimmed = notifications.slice(0, 100);

      await supabase.from('settings').upsert(
        { key: notificationKey(userId), value: { notifications: trimmed, updated_at: new Date().toISOString() } },
        { onConflict: 'key' },
      );

      return res.status(201).json(notification);
    }

    // DELETE: clear all
    if (req.method === 'DELETE') {
      await supabase.from('settings').upsert(
        { key: notificationKey(userId), value: { notifications: [], updated_at: new Date().toISOString() } },
        { onConflict: 'key' },
      );
      return res.status(200).json({ success: true, cleared: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('notifications error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
