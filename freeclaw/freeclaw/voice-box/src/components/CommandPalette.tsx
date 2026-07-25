import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Home, PlusCircle, Lightbulb, BarChart3, KanbanSquare,
  MessageSquare, UserCircle2, ShieldCheck, Moon, Sun, FileText,
  CornerDownLeft, Clock, Tag, Filter, TrendingUp
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import type { PostData } from '../types';

interface Cmd { id: string; label: string; hint?: string; icon: LucideIcon; run: () => void; section: string; }

const CATEGORIES = ['All', 'Academics', 'Facilities', 'Technology', 'Sports', 'Other'];
const TYPES = ['All', 'problem', 'suggestion'];
const RECENT_KEY = 'vb_recent_searches';
const MAX_RECENT = 5;

function getRecentSearches(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecentSearch(q: string) {
  if (!q.trim()) return;
  const recent = getRecentSearches().filter((r) => r !== q);
  recent.unshift(q);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}
function clearRecentSearches() { localStorage.removeItem(RECENT_KEY); }

/** Linear/Raycast-style ⌘K command palette with filters, recent searches, autocomplete */
export default function CommandPalette() {
  const nav = useNavigate();
  const { theme, toggleTheme } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [posts, setPosts] = useState<PostData[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [catFilter, setCatFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [showFilters, setShowFilters] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ⌘K / Ctrl+K toggle — use capture phase to beat browser's native search intercept
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h, { capture: true });
    return () => window.removeEventListener('keydown', h, { capture: true });
  }, []);

  // Focus trap + focus management when open
  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement;
    setTimeout(() => inputRef.current?.focus(), 30);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  // lazy-load posts for search on first open
  useEffect(() => {
    if (open) {
      setQuery(''); setActive(0);
      setRecentSearches(getRecentSearches());
      if (!fetchedRef.current) {
        fetchedRef.current = true;
        api.get<PostData[]>('/api/posts').then(setPosts).catch((e: unknown) => { console.warn('[CommandPalette] Failed to load posts for search:', e instanceof Error ? e.message : e); });
      }
    }
  }, [open]);

  const go = useCallback((path: string) => { setOpen(false); nav(path); }, [nav]);

  const commands: Cmd[] = useMemo(() => [
    { id: 'home', label: 'Go to Feed', hint: 'G', icon: Home, run: () => go('/'), section: 'Navigate' },
    { id: 'submit', label: 'Report a problem', hint: 'N', icon: PlusCircle, run: () => go('/submit'), section: 'Navigate' },
    { id: 'suggest', label: 'Suggestion board', icon: Lightbulb, run: () => go('/suggestions'), section: 'Navigate' },
    { id: 'polls', label: 'Polls', icon: BarChart3, run: () => go('/polls'), section: 'Navigate' },
    { id: 'board', label: 'Solving board', icon: KanbanSquare, run: () => go('/board'), section: 'Navigate' },
    { id: 'chat', label: 'Anonymous inbox', icon: MessageSquare, run: () => go('/chat'), section: 'Navigate' },
    { id: 'activity', label: 'My activity', hint: 'A', icon: UserCircle2, run: () => go('/activity'), section: 'Navigate' },
    { id: 'privacy', label: 'Privacy policy', icon: ShieldCheck, run: () => go('/privacy'), section: 'Navigate' },
    { id: 'theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`, hint: 'T', icon: theme === 'dark' ? Sun : Moon, run: () => { toggleTheme(); setOpen(false); }, section: 'Actions' },
  ], [go, theme, toggleTheme]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cmds = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;

    // Filter posts by category and type
    let filtered = posts;
    if (catFilter !== 'All') filtered = filtered.filter((p) => p.category === catFilter);
    if (typeFilter !== 'All') filtered = filtered.filter((p) => p.type === typeFilter);

    // Search posts
    const postHits = q.length >= 2
      ? filtered.filter((p) => {
          const haystack = `${p.title} ${(p.description || '')} ${(p.tags || []).join(' ')} ${p.category} ${p.type}`.toLowerCase();
          return q.split(/\s+/).every((w) => haystack.includes(w));
        }).slice(0, 8)
        .map((p): Cmd => ({
          id: `post-${p.id}`,
          label: p.title,
          hint: `${p.category} · ${p.type}`,
          icon: FileText,
          run: () => { saveRecentSearch(q); go(`/post/${p.id}`); },
          section: p.type === 'suggestion' ? 'Suggestions' : 'Problems'
        }))
      : [];

    // Autocomplete suggestions when query is short
    const suggestions = q.length === 1
      ? filtered.filter((p) => {
          const haystack = `${p.title} ${p.category}`.toLowerCase();
          return haystack.includes(q);
        }).slice(0, 3)
        .map((p): Cmd => ({
          id: `suggest-${p.id}`,
          label: p.title,
          hint: p.category,
          icon: TrendingUp,
          run: () => { setQuery(p.title); },
          section: 'Suggestions'
        }))
      : [];

    return [...cmds, ...suggestions, ...postHits];
  }, [query, commands, posts, catFilter, typeFilter, go]);

  useEffect(() => setActive(0), [query, catFilter, typeFilter]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && results[active]) results[active].run();
  };

  if (!open) return null;

  let lastSection = '';
  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setOpen(false)} aria-hidden />
      <div className="relative w-full max-w-lg card shadow-2xl overflow-hidden vb-rise">
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 border-b border-border">
          <Search size={16} className="text-ink3 shrink-0" />
          <input ref={inputRef} className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-ink3"
            placeholder="Search posts, suggestions, polls…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
            aria-label="Command search" />
          <button onClick={() => setShowFilters(!showFilters)} className={`p-1.5 rounded-lg transition-colors ${showFilters ? 'bg-accent-soft text-accent' : 'text-ink3 hover:text-ink2'}`} title="Filters">
            <Filter size={14} />
          </button>
          <kbd className="chip !text-[9px] shrink-0">ESC</kbd>
        </div>

        {/* Filters row */}
        {showFilters && (
          <div className="px-4 py-2.5 border-b border-border flex flex-wrap gap-2">
            {/* Category filter */}
            <div className="flex items-center gap-1">
              <Tag size={11} className="text-ink3" />
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCatFilter(c)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${catFilter === c ? 'bg-accent-soft text-accent' : 'text-ink3 hover:text-ink2 hover:bg-surface2'}`}>
                  {c}
                </button>
              ))}
            </div>
            {/* Type filter */}
            <div className="flex items-center gap-1 ml-2 border-l border-border pl-2">
              <FileText size={11} className="text-ink3" />
              {TYPES.map((t) => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${typeFilter === t ? 'bg-accent-soft text-accent' : 'text-ink3 hover:text-ink2 hover:bg-surface2'}`}>
                  {t === 'All' ? 'All' : t === 'problem' ? 'Problems' : 'Suggestions'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent searches when empty */}
        {!query && recentSearches.length > 0 && !showFilters && (
          <div className="px-4 py-2 border-b border-border">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink3">Recent searches</p>
              <button onClick={() => { clearRecentSearches(); setRecentSearches([]); }} className="text-[10px] text-ink3 hover:text-bad transition-colors">Clear</button>
            </div>
            {recentSearches.map((r) => (
              <button key={r} onClick={() => setQuery(r)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left text-ink3 hover:text-ink2 hover:bg-surface2 transition-colors">
                <Clock size={12} className="shrink-0" />
                <span className="truncate">{r}</span>
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="text-sm text-ink3 text-center py-8">No matches for "{query}"</p>}
          {results.map((r, i) => {
            const showSection = r.section !== lastSection;
            lastSection = r.section;
            return (
              <div key={r.id}>
                {showSection && <p className="text-[10px] font-bold uppercase tracking-wider text-ink3 px-2.5 pt-2 pb-1">{r.section}</p>}
                <button onClick={r.run} onMouseEnter={() => setActive(i)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm text-left transition-colors ${i === active ? 'bg-accent-soft text-accent' : 'text-ink2'}`}>
                  <r.icon size={15} className="shrink-0" />
                  <span className="flex-1 truncate font-medium">{r.label}</span>
                  {r.hint && <span className="chip !text-[9px] shrink-0">{r.hint}</span>}
                  {i === active && <CornerDownLeft size={12} className="shrink-0 opacity-60" />}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-[10px] text-ink3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          {catFilter !== 'All' && <span className="text-accent">{catFilter}</span>}
          {typeFilter !== 'All' && <span className="text-accent">{typeFilter}</span>}
          <span className="ml-auto">Voice Box ⌘K</span>
        </div>
      </div>
    </div>
  );
}
