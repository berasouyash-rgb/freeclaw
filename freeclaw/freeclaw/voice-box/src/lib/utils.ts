/** Safe JSON.stringify — handles circular references, functions, undefined */
export function safeStringify(obj: unknown, indent?: number): string {
  try {
    const seen = new WeakSet();
    return JSON.stringify(obj, (_key, val) => {
      if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`;
      if (val === undefined) return '[undefined]';
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    }, indent);
  } catch {
    try { return String(obj); } catch { return '[Unserializable]'; }
  }
}

/** Sanitize user input before sending: strip tags & control chars */
export function sanitize(str: string, max = 500): string {
  return String(str).replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
}

/** SHA-256 hash (hex) using Web Crypto — used for admin password */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timeAgo(dateStr: string): string {
  const parsed = new Date(dateStr).getTime();
  if (Number.isNaN(parsed)) return 'unknown';
  const s = Math.floor((Date.now() - parsed) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDate(d: string): string {
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

import type { PostData } from '../types';

/** Trending score: engagement decayed by age */
export function trendingScore(p: PostData): number {
  const r = p.reactions || {};
  const engage = (r.support || 0) * 3 + (p.comment_count || 0) * 2;
  const hours = Math.max(1, (Date.now() - new Date(p.created_at).getTime()) / 3600000);
  return engage / Math.pow(hours + 2, 1.2);
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const first = rows[0];
  if (!first) return '';
  const keys = Object.keys(first);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k])).join(','))].join('\n');
}

export const CATEGORIES = ['Academics','Facilities','Food','Bullying','Teachers','Events','Transport','Sports','Technology','Library','Hostel','Security','Cleanliness','Medical','Other'];

export const CAT_EMOJI: Record<string, string> = {
  Academics: '📚', Facilities: '🏫', Food: '🍽️', Bullying: '🛡️', Teachers: '👩‍🏫',
  Events: '🎉', Transport: '🚌', Sports: '⚽', Technology: '💻', Library: '📖',
  Hostel: '🏠', Security: '🔒', Cleanliness: '🧹', Medical: '🏥', Other: '📌',
};

export const STATUS_META: Record<string, { label: string; color: string; pct: number }> = {
  reported: { label: 'Reported', color: '#8e8ea5', pct: 5 },
  verified: { label: 'Verified', color: '#3b82f6', pct: 20 },
  in_progress: { label: 'In Progress', color: '#d98a0b', pct: 50 },
  waiting: { label: 'Waiting', color: '#a855f7', pct: 70 },
  solved: { label: 'Solved', color: '#16a06a', pct: 100 },
  archived: { label: 'Archived', color: '#6e6e88', pct: 100 },
};

export const PRIORITY_META: Record<string, { label: string; color: string }> = {
  low: { label: 'Low', color: '#8e8ea5' },
  medium: { label: 'Medium', color: '#3b82f6' },
  high: { label: 'High', color: '#d98a0b' },
  critical: { label: 'Critical', color: '#dc4b4b' },
};
