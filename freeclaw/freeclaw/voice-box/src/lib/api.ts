/** Thin fetch wrapper for Voice Box API routes */

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

export function setAdminSession(token: string, exp: number) {
  sessionStorage.setItem('vb:adminAuth', JSON.stringify({ token, exp }));
}

export function clearAdminSession() { sessionStorage.removeItem('vb:adminAuth'); }

const TIMEOUT_MS = 8000; // hard ceiling — no request may hang forever
const UPLOAD_TIMEOUT_MS = 30000; // uploads need more time

async function request(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = adminToken();
  if (t) headers['X-Admin-Token'] = t;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Request timed out — check your connection and retry.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upload image with automatic retry and fallback.
 * Strategy: try server upload → if fails, return data URL (works everywhere, no storage needed).
 */
async function uploadImage(fileBase64: string, contentType: string, author_id: string): Promise<string> {
  // Attempt 1: server-side storage upload
  try {
    const up = await request('POST', '/api/upload', { fileBase64, contentType, author_id }, UPLOAD_TIMEOUT_MS);
    if (up.url) return up.url;
  } catch (e: any) {
    console.warn('Upload to storage failed, using data URL fallback:', e.message);
  }
  // Fallback: inline data URL — works without any storage
  return `data:${contentType};base64,${fileBase64}`;
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, body: unknown) => request('POST', path, body),
  put: (path: string, body: unknown) => request('PUT', path, body),
  del: (path: string, body: unknown) => request('DELETE', path, body),
  uploadImage,
};
