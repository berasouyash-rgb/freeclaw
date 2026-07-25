/** Offline queue: failed writes are stored locally and retried when back online. */
import { lsGet, lsSet } from './identity';

interface QueuedAction { id: string; method: string; path: string; body: unknown; queuedAt: string; }

const KEY = 'vb:offlineQueue';
/** Canonical admin token key — must match api.ts (sessionStorage, JSON {token, exp}) */
const ADMIN_AUTH_KEY = 'vb:adminAuth';

export function queueAction(method: string, path: string, body: unknown) {
  const q = lsGet<QueuedAction[]>(KEY, []);
  q.push({ id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, method, path, body, queuedAt: new Date().toISOString() });
  lsSet(KEY, q.slice(-20)); // cap queue size
}

export function queuedCount(): number {
  return lsGet<QueuedAction[]>(KEY, []).length;
}

/** Check if a path requires admin authentication */
function isAdminEndpoint(path: string): boolean {
  return path.startsWith('/api/admin') || path.startsWith('/api/cleanup')
    || path.startsWith('/api/chat?threads=1') || path.includes('action=read')
    || path.includes('action=list') || path.includes('action=stats')
    || path.includes('action=pending') || path.includes('action=audit');
}

export async function flushQueue(): Promise<number> {
  const q = lsGet<QueuedAction[]>(KEY, []);
  if (!q.length) return 0;
  let flushed = 0;
  const remaining: QueuedAction[] = [];
  for (const a of q) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // Attach admin token for admin-only endpoints — read from canonical sessionStorage key
      if (isAdminEndpoint(a.path)) {
        try {
          const raw = sessionStorage.getItem(ADMIN_AUTH_KEY);
          if (raw) {
            const { token, exp } = JSON.parse(raw);
            if (token && (!exp || exp > Date.now())) headers['x-admin-token'] = token;
          }
        } catch { /* no valid session */ }
      }
      const res = await fetch(a.path, {
        method: a.method,
        headers,
        body: a.body != null ? JSON.stringify(a.body) : null,
      });
      if (res.ok) flushed++;
      else if (res.status >= 500) remaining.push(a); // retry server errors later
      // 4xx: drop — it would never succeed
    } catch {
      remaining.push(a);
    }
  }
  lsSet(KEY, remaining);
  return flushed;
}
