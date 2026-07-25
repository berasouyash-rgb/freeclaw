/** Thin fetch wrapper for Voice Box API routes with offline queue for failed writes. */

import { queueAction, flushQueue, queuedCount } from './offline';

function adminToken(): string | null {
  try {
    const raw = sessionStorage.getItem('vb:adminAuth');
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw);
    if (exp && exp < Date.now()) { sessionStorage.removeItem('vb:adminAuth'); return null; }
    return token;
  } catch { return null; }
}

export function hasAdminSession(): boolean { return !!adminToken(); }

export function setAdminSession(token: string, exp: string | number) {
  sessionStorage.setItem('vb:adminAuth', JSON.stringify({ token, exp }));
}

export function clearAdminSession() { sessionStorage.removeItem('vb:adminAuth'); }

export { queuedCount } from './offline';

const TIMEOUT_MS = 8000; // hard ceiling — no request may hang forever
const UPLOAD_TIMEOUT_MS = 30000; // uploads need more time
const AGENT_TIMEOUT_MS = 28000; // agent chat does multiple DB queries + intent matching
const LLM_TIMEOUT_MS = 28000; // LLM analysis calls (near Vercel's 30s max)

/** Flush offline queue on startup and after successful writes. */
let flushScheduled = false;
function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(async () => {
    flushScheduled = false;
    try { await flushQueue(); } catch { /* best effort */ }
  }, 500);
}

// Flush on page load (if there are queued items from a previous session)
if (typeof window !== 'undefined' && queuedCount() > 0) {
  scheduleFlush();
}

// ---- GET request deduplication + short-lived cache ----
// Prevents duplicate in-flight requests (e.g. React double-render) and
// caches GET responses for 5s to avoid redundant fetches within a single
// page lifecycle (e.g. mount → realtime → re-render).
const inflight = new Map<string, Promise<unknown>>();
const getCache = new Map<string, { data: unknown; expiresAt: number }>();
const GET_CACHE_TTL_MS = 5000;

function cacheKey(method: string, path: string): string {
  return `${method}:${path}`;
}

async function request<T = unknown>(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = adminToken();
  if (t) headers['X-Admin-Token'] = t;

  // For GET requests: check cache, deduplicate in-flight
  if (method === 'GET') {
    const key = cacheKey(method, path);
    const cached = getCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const reqPromise = (async () => {
    try {
      const res = await fetch(path, { method, headers, body: body != null ? JSON.stringify(body) : null, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      // After successful write, flush any queued offline actions
      if (method !== 'GET') scheduleFlush();
      // Cache successful GET responses briefly
      if (method === 'GET') {
        getCache.set(cacheKey(method, path), { data, expiresAt: Date.now() + GET_CACHE_TTL_MS });
      }
      return data as T;
    } catch (err: unknown) {
      // Auto-queue failed writes (POST/PUT/DELETE) on network/timeout errors
      const isNetworkError = err instanceof Error && (err.name === 'AbortError' || err.message.includes('Failed to fetch') || err.message.includes('NetworkError'));
      if (isNetworkError && method !== 'GET' && body) {
        queueAction(method, path, body);
      }
      if (err instanceof Error && err.name === 'AbortError') throw new Error('Request timed out — check your connection and retry.');
      throw err;
    } finally {
      clearTimeout(timer);
      if (method === 'GET') inflight.delete(cacheKey(method, path));
    }
  })();

  // Track in-flight GET requests for deduplication
  if (method === 'GET') inflight.set(cacheKey(method, path), reqPromise);
  return reqPromise;
}

/**
 * Upload image with automatic retry and fallback.
 * Strategy: try server upload → if fails, return data URL (works everywhere, no storage needed).
 */
async function uploadImage(fileBase64: string, contentType: string, author_id: string): Promise<string> {
  // Attempt 1: server-side storage upload
  try {
    const up = await request<{ url?: string }>('POST', '/api/upload', { fileBase64, contentType, author_id }, UPLOAD_TIMEOUT_MS);
    if (up.url) return up.url;
  } catch (e: unknown) {
    console.warn('Upload to storage failed, using data URL fallback:', e instanceof Error ? e.message : 'unknown error');
  }
  // Fallback: inline data URL — works without any storage
  return `data:${contentType};base64,${fileBase64}`;
}

export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body: unknown) => request<T>('POST', path, body),
  postLong: <T = unknown>(path: string, body: unknown) => request<T>('POST', path, body, AGENT_TIMEOUT_MS),
  postSlow: <T = unknown>(path: string, body: unknown) => request<T>('POST', path, body, LLM_TIMEOUT_MS), // for LLM analysis
  put: <T = unknown>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = unknown>(path: string, body: unknown) => request<T>('DELETE', path, body),
  uploadImage,
  /**
   * Cursor-based paginated request.
   * Returns { data: T[], nextCursor: string | null, total: number }
   */
  paginated: <T = unknown>(path: string, params: { cursor?: string | null; limit?: number } = {}): Promise<{ data: T[]; nextCursor: string | null; total: number }> => {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('paginate', '1');
    if (params.cursor) url.searchParams.set('cursor', params.cursor);
    if (params.limit) url.searchParams.set('limit', String(params.limit));
    return request<{ data: T[]; nextCursor: string | null; total: number }>('GET', url.pathname + url.search);
  },
  /**
   * Paginated POST request (for admin actions like users).
   */
  postPaginated: <T = unknown>(path: string, body: unknown): Promise<{ data: T[]; nextCursor: string | null; total: number }> => {
    return request<{ data: T[]; nextCursor: string | null; total: number }>('POST', path, { ...(body as object), paginate: true });
  },
};
