import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getAnonId, lsGet, lsSet } from '../lib/identity';
import { api } from '../lib/api';
import type { Notification, NotificationKind, AccountStatus, PostData, ChatMessage } from '../types';

/** Lightweight shapes for the notification-polling responses */
interface PollVote { poll_id: string; }
interface ChatResponse { messages?: ChatMessage[]; }

interface NotifSnapshot {
  [postId: string]: { status: string; comments: number; reply: boolean } | boolean | number;
}

export type { Notification, NotificationKind };

interface Toast { id: number; text: string; kind: 'ok' | 'err' | 'info'; action?: { label: string; fn: () => void }; }

interface AppCtx {
  anonId: string;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  bookmarks: string[];
  toggleBookmark: (id: string) => void;
  notifications: Notification[];
  markNotifsRead: () => void;
  clearNotifs: () => void;
  pushNotif: (n: Omit<Notification, 'id' | 'at' | 'read'>) => void;
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  toasts: Toast[];
  refreshIdentity: () => void;
  recentlyViewed: string[];
  addRecentlyViewed: (id: string) => void;
  chatUnread: number;
  setChatUnread: (n: number) => void;
  accountStatus: AccountStatus | null;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within <AppProvider>');
  return ctx;
};

let toastSeq = 1;

export function AppProvider({ children }: { children: ReactNode }) {
  const [anonId, setAnonId] = useState(getAnonId);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    lsGet<'light' | 'dark'>('vb:theme', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [bookmarks, setBookmarks] = useState<string[]>(() => lsGet('vb:bookmarks', []));
  const [notifications, setNotifications] = useState<Notification[]>(() => lsGet('vb:notifications', []));
  const [recentlyViewed, setRecentlyViewed] = useState<string[]>(() => lsGet('vb:recentlyViewed', []));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const [accountStatus, setAccountStatus] = useState<AppCtx['accountStatus']>(null);

  // Heartbeat: registers this browser's anonymous ID (so it appears in admin
  // immediately, before any post) AND returns live ban/suspension status.
  useEffect(() => {
    let cancelled = false;
    const beat = () => api.post<AccountStatus>('/api/users', { anon_id: anonId })
      .then((s) => { if (!cancelled) setAccountStatus(s); })
      .catch((e: unknown) => { console.warn('[AppContext] heartbeat failed:', e instanceof Error ? e.message : e); });
    beat();
    const iv = setInterval(beat, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [anonId]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    lsSet('vb:theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const toggleBookmark = useCallback((id: string) => {
    setBookmarks((prev) => {
      const next = prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id];
      lsSet('vb:bookmarks', next);
      return next;
    });
  }, []);

  const addRecentlyViewed = useCallback((id: string) => {
    setRecentlyViewed((prev) => {
      const next = [id, ...prev.filter((p) => p !== id)].slice(0, 20);
      lsSet('vb:recentlyViewed', next);
      return next;
    });
  }, []);

  const pushNotif = useCallback((n: Omit<Notification, 'id' | 'at' | 'read'>) => {
    setNotifications((prev) => {
      const next = [{ ...n, id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), read: false }, ...prev].slice(0, 60);
      lsSet('vb:notifications', next);
      return next;
    });
  }, []);

  const markNotifsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      lsSet('vb:notifications', next);
      return next;
    });
  }, []);

  const clearNotifs = useCallback(() => { setNotifications([]); lsSet('vb:notifications', []); }, []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) => {
    const id = toastSeq++;
    setToasts((prev) => [...prev, { id, text, kind, action }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), action ? 30000 : 3800);
  }, []);

  const refreshIdentity = useCallback(() => {
    setAnonId(getAnonId());
    setBookmarks(lsGet('vb:bookmarks', []));
    setNotifications(lsGet('vb:notifications', []));
    setRecentlyViewed(lsGet('vb:recentlyViewed', []));
  }, []);

  // ---------- background notification engine ----------
  // Runs every 120s, pauses when tab is hidden to save API calls.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      // Skip if tab is hidden — will catch up when user returns
      if (document.hidden) return;
      try {
        const [mine, chat] = await Promise.all([
          api.get<PostData[]>(`/api/posts?author=${anonId}`).catch((): PostData[] => []),
          api.get<ChatResponse | null>(`/api/chat?thread_id=${anonId}`).catch((): null => null),
        ]);
        if (cancelled) return;
        const snapshot = lsGet<NotifSnapshot>('vb:notifSnapshot', {});
        const nextSnap: NotifSnapshot = {};
        for (const p of mine) {
          nextSnap[p.id] = { status: p.status, comments: p.comment_count ?? 0, reply: !!p.admin_reply };
          const prev = snapshot[p.id];
          if (!prev || typeof prev !== 'object' || !('status' in prev)) continue;
          if (prev.status !== p.status) {
            pushNotif({ kind: 'status', title: p.status === 'solved' ? '✅ Your issue was solved!' : `Status updated: ${p.status.replace('_', ' ')}`, body: p.title, link: `/post/${p.id}` });
          }
          if (!prev.reply && p.admin_reply) {
            pushNotif({ kind: 'reply', title: '💬 Admin replied to your post', body: p.title, link: `/post/${p.id}` });
          }
          if ((p.comment_count ?? 0) > prev.comments) {
            pushNotif({ kind: 'comment', title: `💬 ${(p.comment_count ?? 0) - prev.comments} new comment(s)`, body: p.title, link: `/post/${p.id}` });
          }
        }
        // unread admin chat messages → badge in nav + notification
        if (chat) {
          const unreadAdmin = (chat.messages ?? []).filter((m) => m.sender === 'admin' && !m.read).length;
          setChatUnread(unreadAdmin);
          const prevUnread = typeof snapshot.__chatUnread === 'number' ? snapshot.__chatUnread : 0;
          if (unreadAdmin > prevUnread) {
            pushNotif({ kind: 'chat', title: '✉️ New message from admin', body: 'Open your inbox to read it.', link: '/chat' });
          }
          nextSnap.__chatUnread = unreadAdmin;
        }

        // poll endings — single call with voter param merged
        try {
          const polls = await api.get<PollVote[]>(`/api/polls?voter=${anonId}`).catch((): PollVote[] => []);
          const votedIds = new Set(polls.map((v) => v.poll_id));
          // Check if polls list is also returned (single merged endpoint)
          const allPolls = Array.isArray(polls) ? polls : [];
          for (const poll of allPolls) {
            if (!votedIds.has((poll as unknown as { id: string }).id)) continue;
            const pollWithMeta = poll as unknown as { id: string; archived: boolean; expires_at?: string; title: string };
            const ended = pollWithMeta.archived || (pollWithMeta.expires_at && new Date(pollWithMeta.expires_at) < new Date());
            nextSnap[`poll_${pollWithMeta.id}`] = !!ended;
            if (ended && snapshot[`poll_${pollWithMeta.id}`] === false) {
              pushNotif({ kind: 'poll', title: '📊 A poll you voted in has ended', body: pollWithMeta.title, link: '/polls' });
            }
          }
        } catch { /* skip */ }

        lsSet('vb:notifSnapshot', nextSnap);

      } catch { /* offline-friendly: silently skip */ }
    }
    check();
    const iv = setInterval(check, 120000);
    // Also catch up when user returns to the tab
    const onVisChange = () => { if (!document.hidden && !cancelled) check(); };
    document.addEventListener('visibilitychange', onVisChange);
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVisChange); };
  }, [anonId, pushNotif]);

  return (
    <Ctx.Provider value={{ anonId, theme, toggleTheme, bookmarks, toggleBookmark, notifications, markNotifsRead, clearNotifs, pushNotif, toast, toasts, refreshIdentity, recentlyViewed, addRecentlyViewed, chatUnread, setChatUnread, accountStatus }}>
      {children}
    </Ctx.Provider>
  );
}
