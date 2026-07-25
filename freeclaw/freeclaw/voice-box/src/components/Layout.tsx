import { useState, useEffect } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { Megaphone, Home, PlusCircle, BarChart3, Lightbulb, KanbanSquare, UserCircle2, ShieldCheck, Bell, Sun, Moon, MessageSquare, X, Menu, CheckCheck, Trash2, Search, HelpCircle, WifiOff } from 'lucide-react';
import { flushQueue, queuedCount } from '../lib/offline';
import { useApp } from '../contexts/AppContext';
import { timeAgo } from '../lib/utils';
import { api } from '../lib/api';
import { lsGet, lsSet } from '../lib/identity';
import CommandPalette from './CommandPalette';
import Tutorial from './Tutorial';

const NAV = [
  { to: '/', label: 'Feed', icon: Home, tour: '' },
  { to: '/submit', label: 'Submit', icon: PlusCircle, tour: '' },
  { to: '/suggestions', label: 'Suggestions', icon: Lightbulb, tour: '' },
  { to: '/polls', label: 'Polls', icon: BarChart3, tour: 'nav-polls' },
  { to: '/board', label: 'Solving Board', icon: KanbanSquare, tour: 'nav-board' },
  { to: '/chat', label: 'Inbox', icon: MessageSquare, tour: '' },
  { to: '/activity', label: 'My Activity', icon: UserCircle2, tour: 'nav-activity' },
  { to: '/privacy', label: 'Privacy', icon: ShieldCheck, tour: 'nav-privacy' },
  { to: '/faq', label: 'FAQ', icon: HelpCircle, tour: '' },
];

export default function Layout() {
  const { theme, toggleTheme, notifications, markNotifsRead, clearNotifs, toasts, anonId, chatUnread, accountStatus } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [announcement, setAnnouncement] = useState<{ kind?: string; text: string; at: string } | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [queued, setQueued] = useState(queuedCount());

  // offline detection + queued-action flush on reconnect
  useEffect(() => {
    const goOnline = async () => {
      setOffline(false);
      await flushQueue();
      setQueued(queuedCount());
    };
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const iv = setInterval(() => setQueued((prev) => { const c = queuedCount(); return prev === c ? prev : c; }), 5000);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); clearInterval(iv); };
  }, []);

  useEffect(() => {
    api.get<{ kind?: string; text: string; at: string }>('/api/announcement').then((a) => {
      if (a && lsGet('vb:dismissedAnnouncement', '') !== a.at) setAnnouncement(a);
    }).catch((e: unknown) => { console.warn('[Layout] Failed to load announcement:', e instanceof Error ? e.message : e); });
  }, []);
  const nav = useNavigate();
  const loc = useLocation();
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => { setMobileOpen(false); setNotifOpen(false); }, [loc.pathname]);

  // keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      // Don't intercept modifier combos (Ctrl+K handled by CommandPalette)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n') nav('/submit');
      if (e.key === 'g') nav('/');
      if (e.key === 'a') nav('/activity');
      if (e.key === 't') toggleTheme();
      if (e.key === '/') { e.preventDefault(); (document.querySelector('#feed-search') as HTMLInputElement)?.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [nav, toggleTheme]);

  const sidebar = (
    <nav className="flex flex-col gap-1" aria-label="Main navigation">
      {NAV.map(({ to, label, icon: Icon, tour }) => (
        <NavLink key={to} to={to} end={to === '/'} {...(tour ? { 'data-tour': tour } : {})}
          className={({ isActive }) => `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-accent-soft text-accent' : 'text-ink2 hover:bg-surface2 hover:text-ink'}`}>
          <Icon size={18} strokeWidth={2.2} aria-hidden />
          {label}
          {to === '/chat' && chatUnread > 0 && <span className="ml-auto text-[10px] font-bold bg-bad text-white rounded-full px-1.5 py-0.5 vb-pop">{chatUnread}</span>}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen flex">
      {/* Skip to main content — accessibility */}
      <a href="#main-content" className="skip-to-content">Skip to main content</a>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-border bg-surface px-4 py-6 sticky top-0 h-screen">
        <Link to="/" className="flex items-center gap-2.5 px-2 mb-8" aria-label="Voice Box home">
          <span className="w-9 h-9 rounded-xl bg-accent grid place-items-center text-white shadow-lg shadow-accent/30"><Megaphone size={18} /></span>
          <span className="font-display font-bold text-lg tracking-tight">Voice Box</span>
        </Link>
        {sidebar}
        <div className="mt-auto pt-6 border-t border-border">
          <div className="text-[11px] text-ink3 px-2 leading-relaxed">
            <p className="font-semibold text-ink2 mb-1">100% anonymous</p>
            <p>Your ID: <code className="font-mono text-accent">{anonId.slice(0, 8)}…</code></p>
            <Link to="/admin" className="mt-3 inline-block text-ink3 hover:text-accent transition-colors">Admin →</Link>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 mobile-overlay-enter" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-surface p-5 mobile-drawer-enter">
            <div className="flex items-center justify-between mb-6">
              <span className="font-display font-bold text-lg">Voice Box</span>
              <button className="btn btn-ghost !p-2" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button>
            </div>
            {sidebar}
            <Link to="/admin" className="mt-6 inline-block text-xs text-ink3">Admin →</Link>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-40 border-b border-border" style={{ background: 'var(--vb-bg)' }}>
          <div className="flex items-center gap-3 px-4 sm:px-6 h-14">
            <button className="lg:hidden btn btn-ghost !p-2" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
            <Link to="/" className="lg:hidden flex items-center gap-2 font-display font-bold"><span className="w-7 h-7 rounded-lg bg-accent grid place-items-center text-white"><Megaphone size={14} /></span>Voice Box</Link>
            <div className="ml-auto flex items-center gap-1.5">
              <button className="hidden md:flex items-center gap-2 text-xs text-ink3 border border-border rounded-xl px-3 py-2 hover:border-accent hover:text-accent transition-colors"
                onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))} aria-label="Open command palette">
                <Search size={13} /> Search… <kbd className="chip !text-[9px] !py-0">⌘K</kbd>
              </button>
              <Link to="/submit" className="btn btn-primary !py-2 hidden sm:inline-flex"><PlusCircle size={16} /> New post</Link>
              <button className="btn btn-ghost !p-2.5 relative" onClick={() => { setNotifOpen((o) => !o); }} aria-label={`Notifications, ${unread} unread`}>
                <Bell size={17} />
                {unread > 0 && <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 min-w-4 text-[9px] font-bold grid place-items-center bg-bad text-white rounded-full px-1">{unread}</span>}
              </button>
              <button className="btn btn-ghost !p-2.5" onClick={toggleTheme} aria-label="Toggle dark mode">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
            </div>
          </div>

          {/* Notification panel */}
          {notifOpen && (
            <div className="absolute right-4 top-14 w-[min(92vw,380px)] card shadow-2xl p-3 vb-rise z-50" role="region" aria-label="Notifications">
              <div className="flex items-center justify-between px-2 pb-2 border-b border-border">
                <span className="font-display font-semibold text-sm">Notifications {unread > 0 && <span className="text-[10px] font-bold bg-accent text-white rounded-full px-1.5 py-0.5 ml-1">{unread}</span>}</span>
                <div className="flex gap-1">
                  {notifications.length > 0 && <button className="btn btn-ghost !p-1.5 !text-xs" onClick={markNotifsRead} title="Mark all read"><CheckCheck size={14} /></button>}
                  {notifications.length > 0 && <button className="btn btn-ghost !p-1.5 !text-xs" onClick={clearNotifs} title="Clear all"><Trash2 size={14} /></button>}
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 && (
                <div className="text-center py-8">
                  <div className="vb-empty-icon mx-auto mb-2"><Bell size={24} /></div>
                  <p className="text-sm text-ink3">No notifications yet.</p>
                  <p className="text-xs text-ink3 mt-1">You'll be notified about status updates, replies and poll results.</p>
                </div>
              )}
                {notifications.map((n) => (
                  <button key={n.id} onClick={() => { if (n.link) nav(n.link); setNotifOpen(false); markNotifsRead(); }}
                    className={`w-full text-left px-2.5 py-2.5 rounded-lg vb-notif-item transition-colors ${!n.read ? 'bg-accent-soft/60' : ''}`}>
                    <p className="text-sm font-medium leading-snug">{n.title}</p>
                    <p className="text-xs text-ink3 truncate mt-0.5">{n.body} · {timeAgo(n.at)}</p>
                  </button>
                ))}
              </div>
              {notifications.length > 0 && (
                <div className="px-2 pt-2 border-t border-border">
                  <button onClick={() => { nav('/notifications'); setNotifOpen(false); }}
                    className="w-full text-center text-xs text-accent hover:underline py-1">
                    View all notifications
                  </button>
                </div>
              )}
            </div>
          )}
        </header>

        {/* Ban / suspension banner — writes are blocked server-side; this makes it visible */}
        {accountStatus?.banned && (
          <div className="flex items-center gap-2.5 px-4 sm:px-6 py-2.5 text-sm font-semibold" style={{ background: 'rgba(220,75,75,0.12)', color: '#dc4b4b', borderBottom: '1px solid rgba(220,75,75,0.25)' }} role="alert">
            🚫 This anonymous ID has been permanently banned. You can browse, but posting, commenting and voting are disabled.
          </div>
        )}
        {!accountStatus?.banned && accountStatus?.suspended && (
          <div className="flex items-center gap-2.5 px-4 sm:px-6 py-2.5 text-sm font-semibold" style={{ background: 'rgba(217,138,11,0.12)', color: '#d98a0b', borderBottom: '1px solid rgba(217,138,11,0.25)' }} role="alert">
            ⏸️ Your anonymous ID is suspended until {new Date(accountStatus.suspended_until!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}. Browsing is allowed; posting and voting are paused.
          </div>
        )}
        {offline && (
          <div className="flex items-center gap-2 px-4 sm:px-6 py-2 text-xs font-semibold border-b" style={{ background: 'rgba(217,138,11,0.1)', color: 'var(--vb-warn)', borderColor: 'rgba(217,138,11,0.2)' }} role="status">
            <WifiOff size={13} /> You're offline — actions are queued and will send when you reconnect.{queued > 0 && ` (${queued} queued)`}
          </div>
        )}
        {announcement && (
          <div className={`vb-rise flex items-start gap-2.5 px-4 sm:px-6 py-2.5 text-sm font-medium border-b ${announcement.kind === 'warning' ? 'bg-warn/10 text-warn border-warn/20' : announcement.kind === 'success' ? 'bg-good/10 text-good border-good/20' : 'bg-accent-soft text-accent border-accent/20'}`} role="status">
            <Megaphone size={15} className="mt-0.5 shrink-0" />
            <span className="flex-1">{announcement.text}</span>
            <button className="shrink-0 opacity-70 hover:opacity-100" onClick={() => { lsSet('vb:dismissedAnnouncement', announcement.at); setAnnouncement(null); }} aria-label="Dismiss announcement"><X size={15} /></button>
          </div>
        )}
        <main id="main-content" className="flex-1 px-4 sm:px-6 py-6 max-w-6xl w-full mx-auto pb-24 lg:pb-8" role="main" aria-label="Main content">
          <Outlet />
        </main>

        {/* Mobile bottom nav — includes Inbox with unread badge */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border flex" style={{ background: 'var(--vb-surface)' }} aria-label="Mobile navigation">
          {[NAV[0], NAV[1], NAV[2], NAV[3], NAV[5], NAV[6]].map((item) => {
            if (!item) return null;
            const { to, label, icon: Icon, tour } = item;
            return (
              <NavLink key={to} to={to} end={to === '/'} {...(tour ? { 'data-tour': tour } : {})}
                className={({ isActive }) => `relative flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[9.5px] font-medium ${isActive ? 'text-accent' : 'text-ink3'}`}
                aria-label={label}>
                <span className="relative">
                  <Icon size={19} />
                  {to === '/chat' && chatUnread > 0 && <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 text-[8px] font-bold grid place-items-center bg-bad text-white rounded-full">{chatUnread}</span>}
                </span>
                {label === 'My Activity' ? 'Me' : label === 'Solving Board' ? 'Board' : label}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* First-visit interactive tutorial (users only — never on /admin) */}
      <Tutorial />

      <CommandPalette />

      {/* Toasts */}
      <div className="fixed bottom-20 lg:bottom-6 right-4 z-[60] flex flex-col gap-2 items-end" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`vb-rise card !rounded-xl shadow-xl px-4 py-3 text-sm font-medium flex items-center gap-3 max-w-sm ${t.kind === 'err' ? '!border-bad/40 text-bad' : t.kind === 'ok' ? '!border-good/40' : ''}`}>
            <span>{t.text}</span>
            {t.action && <button className="btn btn-soft !py-1 !px-2.5 !text-xs shrink-0" onClick={t.action.fn}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
