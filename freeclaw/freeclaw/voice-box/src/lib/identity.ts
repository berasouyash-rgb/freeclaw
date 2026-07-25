/**
 * Local anonymous identity — the ONLY identifier Voice Box ever uses.
 * Generated in the browser, stored in localStorage, never linked to any personal data.
 */

const ID_KEY = 'vb:anonId';
const CREATED_KEY = 'vb:anonCreated';

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const raw = Array.from(bytes).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  return `anon_${raw}`;
}

export function getAnonId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(ID_KEY, id);
    localStorage.setItem(CREATED_KEY, new Date().toISOString());
  }
  // IDs are always lowercase (case-insensitive everywhere)
  const normalized = id.toLowerCase();
  if (normalized !== id) localStorage.setItem(ID_KEY, normalized);
  return normalized;
}

export function resetAnonId(): string {
  const id = randomId();
  localStorage.setItem(ID_KEY, id);
  localStorage.setItem(CREATED_KEY, new Date().toISOString());
  // ownership data belongs to the old ID — clear it
  for (const k of ['vb:bookmarks', 'vb:recentlyViewed', 'vb:notifications', 'vb:notifSnapshot', 'vb:drafts']) {
    localStorage.removeItem(k);
  }
  return id;
}

export function anonCreatedAt(): string {
  return localStorage.getItem(CREATED_KEY) || new Date().toISOString();
}

export function clearAllLocalData() {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('vb:'));
  keys.forEach((k) => localStorage.removeItem(k));
}

// ---------- typed localStorage helpers ----------
export function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return parsed as T;
  } catch { return fallback; }
}

export function lsSet<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full — ignore */ }
}

// ---------- cooldown / flood prevention (client side) ----------
export function checkCooldown(action: string, seconds: number): number {
  const key = `vb:cd:${action}`;
  const last = Number(localStorage.getItem(key) || 0);
  const remaining = Math.ceil((last + seconds * 1000 - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

export function stampCooldown(action: string) {
  localStorage.setItem(`vb:cd:${action}`, String(Date.now()));
}
