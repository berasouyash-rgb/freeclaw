import { useState, useEffect, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, LayoutDashboard, Table2, Lightbulb, BarChart3, MessageCircle, Users, Flag, 
ScrollText, Settings as SettingsIcon, LogOut, Sun, Moon, Sparkles, Megaphone, Menu, X, Loader2, 
Activity, Inbox, Brain, Zap, Cpu, Eye } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { api, hasAdminSession, setAdminSession, clearAdminSession } from '../lib/api';
import { sha256 } from '../lib/utils';

// Lazy loaded (all tabs)
const Overview = lazy(() => import('./admin/Overview'));
const PostsTable = lazy(() => import('./admin/PostsTable'));
const PollManager = lazy(() => import('./admin/PollManager'));
const SuggestionsTable = lazy(() => import('./admin/SuggestionsTable'));
const CommentMod = lazy(() => import('./admin/CommentMod'));
const UserManager = lazy(() => import('./admin/UserManager'));
const Reports = lazy(() => import('./admin/Reports'));
// AdminChat merged into UnifiedInbox
const Logs = lazy(() => import('./admin/Logs'));
const AdminSettings = lazy(() => import('./admin/AdminSettings'));
const AiPanel = lazy(() => import('./admin/AiPanel'));
const AgentTeamPanel = lazy(() => import('./admin/AgentTeamPanel'));
const CommandCenter = lazy(() => import('./admin/CommandCenter'));
const UnifiedInbox = lazy(() => import('./admin/UnifiedInbox'));
const AgentDashboard = lazy(() => import('./admin/AgentDashboard'));
const AgentOutputPage = lazy(() => import('./admin/AgentOutputPage'));
const AdminAI = lazy(() => import('./admin/AdminAI'));
const ContentReview = lazy(() => import('./admin/ContentReview'));

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-16 gap-2 text-ink3 text-xs">
      <Loader2 size={14} className="animate-spin" />
      <span>Loading…</span>
    </div>
  );
}

const TABS = [
  { key: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'admin-ai', label: 'Admin AI', icon: Cpu },
  { key: 'agent-team', label: 'Agent Team', icon: Users },
  { key: 'command-center', label: 'Command Center', icon: Activity },
  { key: 'agent-dashboard', label: 'Agent Dashboard', icon: Brain },
  { key: 'output', label: 'AI Output', icon: Zap },
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'ai', label: 'AI Analysis', icon: Sparkles },
  { key: 'posts', label: 'Complaints', icon: Table2 },
  { key: 'suggestions', label: 'Suggestions', icon: Lightbulb },
  { key: 'polls', label: 'Polls', icon: BarChart3 },
  { key: 'comments', label: 'Comments', icon: MessageCircle },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'reports', label: 'Reports', icon: Flag },
  { key: 'content-review', label: 'Content Review', icon: Eye },
  { key: '__divider__', label: '', icon: () => null },
  { key: 'logs', label: 'Activity Log', icon: ScrollText },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

export default function Admin() {
  const { theme, toggleTheme, toast } = useApp();
  const [authed, setAuthed] = useState(hasAdminSession());
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('overview');
  const [mobileNav, setMobileNav] = useState(false);

  // Cross-panel navigation (e.g. "Message author" → chat tab)
  useEffect(() => {
    const h = (e: Event) => setTab((e as CustomEvent).detail);
    window.addEventListener('vb:admin-tab', h);
    return () => window.removeEventListener('vb:admin-tab', h);
  }, []);

  // verify session on mount + auto-logout on expiry
  useEffect(() => {
    if (!hasAdminSession()) { setAuthed(false); return; }
    api.get<{ valid: boolean }>('/api/admin?action=verify').then((r) => {
      if (!r.valid) { clearAdminSession(); setAuthed(false); }
    }).catch((e: unknown) => { console.warn('[Admin] Session verify failed:', e instanceof Error ? e.message : e); clearAdminSession(); setAuthed(false); });
    const iv = setInterval(() => {
      if (!hasAdminSession()) { setAuthed(false); toast('Admin session expired', 'info'); }
    }, 30000);
    return () => clearInterval(iv);
  }, [toast]);

  const login = async () => {
    if (!password) return;
    setBusy(true);
    try {
      const hash = await sha256(password);
      const res = await api.post<{ token: string; expires_at: string }>('/api/admin', { action: 'login', password_hash: hash });
      setAdminSession(res.token, res.expires_at);
      setAuthed(true); setPassword('');
      toast('Welcome back, admin 👋', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Login failed', 'err'); }
    setBusy(false);
  };

  const logout = async () => {
    try { await api.post('/api/admin', { action: 'logout' }); } catch { /* ignore */ }
    clearAdminSession(); setAuthed(false);
  };

  if (!authed) {
    return (
      <div className="min-h-screen grid place-items-center px-4 bg-bg">
        <div className="card w-full max-w-sm p-7 vb-rise">
          <div className="text-center mb-6">
            <span className="inline-grid place-items-center w-13 h-13 p-3 rounded-2xl bg-accent text-white mb-3 shadow-lg shadow-accent/30"><ShieldCheck size={26} /></span>
            <h1 className="font-display font-bold text-xl">Admin access</h1>
            <p className="text-xs text-ink3 mt-1">Password-only login · hashed · 60-minute session</p>
          </div>
          <label className="text-xs font-semibold text-ink2 block mb-1.5" htmlFor="admin-pw">Password</label>
          <input id="admin-pw" type="password" className="input" placeholder="••••••••" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} autoFocus aria-describedby="admin-pw-help" />
          <p id="admin-pw-help" className="text-[10px] text-ink3 mt-1.5">Enter the admin password to access the dashboard.</p>
          <button className="btn btn-primary w-full mt-4" onClick={login} disabled={busy || !password} aria-label={busy ? 'Verifying password' : 'Sign in to admin panel'}>{busy ? 'Verifying…' : 'Sign in'}</button>
          <Link to="/" className="block text-center text-xs text-ink3 hover:text-accent mt-3">← Back to Voice Box</Link>
        </div>
      </div>
    );
  }

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {TABS.map(({ key, label, icon: Icon }) => {
        if (key === '__divider__') return <div key={key} className="border-t border-border my-2" />;
        return (
          <button key={key} onClick={() => { setTab(key); setMobileNav(false); }}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-left transition-all ${tab === key ? 'bg-accent-soft text-accent' : 'text-ink2 hover:bg-surface2'}`}>
            <Icon size={16} /> {label}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-bg">
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-surface px-3 py-5 sticky top-0 h-screen overflow-y-auto">
        <Link to="/" className="flex items-center gap-2 px-2 mb-6">
          <span className="w-8 h-8 rounded-lg bg-accent grid place-items-center text-white"><Megaphone size={15} /></span>
          <div><span className="font-display font-bold text-sm block leading-none">Voice Box</span><span className="text-[10px] text-ink3">Admin console</span></div>
        </Link>
        {nav}
        <div className="mt-auto pt-4 flex gap-1">
          <button className="btn btn-ghost !p-2 flex-1" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
          <button className="btn btn-danger !p-2 flex-1" onClick={logout} aria-label="Sign out"><LogOut size={15} /></button>
        </div>
      </aside>

      {mobileNav && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNav(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-surface p-4 overflow-y-auto vb-rise">
            <div className="flex justify-between items-center mb-4">
              <span className="font-display font-bold">Admin</span>
              <button className="btn btn-ghost !p-2" onClick={() => setMobileNav(false)}><X size={16} /></button>
            </div>
            {nav}
            <button className="btn btn-danger w-full mt-4 !text-xs" onClick={logout}><LogOut size={13} /> Sign out</button>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <header className="md:hidden sticky top-0 z-40 bg-bg/80 backdrop-blur-xl border-b border-border flex items-center gap-3 px-4 h-13 py-2">
          <button className="btn btn-ghost !p-2" onClick={() => setMobileNav(true)}><Menu size={17} /></button>
          <span className="font-display font-bold text-sm">Admin · {TABS.find((t) => t.key === tab)?.label}</span>
          <button className="btn btn-ghost !p-2 ml-auto" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
        </header>
        <main className="p-4 sm:p-6 max-w-7xl mx-auto">
          <Suspense fallback={<TabFallback />}>
            {tab === 'overview' && <Overview />}
            {tab === 'admin-ai' && <AdminAI />}
            {tab === 'agent-team' && <AgentTeamPanel />}
            {tab === 'command-center' && <CommandCenter />}
            {tab === 'agent-dashboard' && <AgentDashboard />}
            {tab === 'output' && <AgentOutputPage />}
            {tab === 'inbox' && <UnifiedInbox />}
            {tab === 'ai' && <AiPanel />}
            {tab === 'posts' && <PostsTable type="problem" />}
            {tab === 'suggestions' && <SuggestionsTable />}
            {tab === 'polls' && <PollManager />}
            {tab === 'comments' && <CommentMod />}
            {tab === 'users' && <UserManager />}
            {tab === 'reports' && <Reports />}
            {tab === 'content-review' && <ContentReview />}

            {tab === 'logs' && <Logs />}
            {tab === 'settings' && <AdminSettings />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
