import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, RefreshCcw, AlertTriangle, GitMerge, TrendingUp, ShieldAlert, ArrowUp, ArrowDown, Minus, BarChart3, FileText, Brain, Lightbulb, X, Maximize2, Minimize2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../lib/api';
import { safeStringify } from '../../lib/utils';
import { useApp } from '../../contexts/AppContext';
import { lsGet, lsSet } from '../../lib/identity';
import CountUp from '../../components/CountUp';
import type { PostData } from '../../types';

interface RankedIssue {
  id: string;
  title: string;
  category: string;
  status?: string;
  flags?: string[];
  evidence?: string;
  recommended_action?: string;
  urgency_score: number;
}

interface SafetyAlert {
  id: string;
  title: string;
  reason: string;
}

interface DuplicateCluster {
  topic: string;
  count: number;
  shared_words?: string[];
  post_ids?: string[];
}

interface WeeklyInsights {
  trending_category?: string;
  recommendation?: string;
  total?: number;
  high_urgency?: number;
}

interface AnalysisResult {
  engine: string;
  ranked_issues: RankedIssue[];
  safety_alerts: SafetyAlert[];
  duplicate_clusters: DuplicateCluster[];
  weekly_insights?: WeeklyInsights;
  generated_at?: string;
  summary?: string;
}

interface AgentExecution {
  id: string;
  agent_id?: string;
  agent_name: string;
  division?: string;
  status: string;
  duration_ms?: number;
  output?: string;
  [k: string]: unknown;
}

interface Suggestion {
  id: string;
  title: string;
  description: string;
  priority: string;
  confidence?: number;
  suggestedActions?: string[];
  [k: string]: unknown;
}

/** Rank movement arrow: compares an issue's position vs the previous analysis run */
function RankMove({ id, index, prevRanks }: { id: string; index: number; prevRanks: Record<string, number> }) {
  const prev = prevRanks[id];
  if (prev === undefined) return <span className="chip !text-[9px] !px-1.5 !text-accent !border-accent/30" title="New in ranking">NEW</span>;
  const diff = prev - index;
  if (diff === 0) return <span className="inline-flex items-center text-ink3" title="No change"><Minus size={11} /></span>;
  return diff > 0
    ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-good vb-pop" title={`Up ${diff} place(s)`}><ArrowUp size={11} className="vb-trend-bounce" />{diff}</span>
    : <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-bad vb-pop" title={`Down ${-diff} place(s)`}><ArrowDown size={11} className="vb-trend-bounce" />{-diff}</span>;
}

export default function AiPanel() {
  const { toast } = useApp();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(() => lsGet('vb:aiAnalysis', null));
  const [prevRanks, setPrevRanks] = useState<Record<string, number>>(() => lsGet('vb:aiPrevRanks', {}));
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState<string>(() => lsGet('vb:aiDigest', ''));
  const [digestBusy, setDigestBusy] = useState(false);
  const [agentIntel, setAgentIntel] = useState<AgentExecution[]>([]);

  // ── Floating panel state ──
  const [isFloating, setIsFloating] = useState(() => lsGet('vb:aiPanelFloating', false));
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; pos: { x: number; y: number } } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Proactive suggestions state ──
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(true);

  /** One-click: turn a ranked issue into a linked Yes/No poll */
  const issueToPoll = async (r: RankedIssue) => {
    try {
      await api.post('/api/polls', { title: `Do you agree: ${r.title}?`, ptype: 'yesno', post_id: r.id, author_id: 'ADMIN' });
      toast('Poll created and linked to the issue 📊', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
  };

  /** AI weekly digest for staff */
  const generateDigest = async () => {
    setDigestBusy(true);
    try {
      const posts = await api.get<PostData[]>('/api/posts?all=1');
      const week = posts.filter((p) => Date.now() - +new Date(p.created_at) < 7 * 86400000);
      const solved = posts.filter((p) => (p.status_history || []).some((h) => h.status === 'solved' && Date.now() - +new Date(h.at) < 7 * 86400000));
      const cats: Record<string, number> = {};
      week.forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
      const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
      const result = await api.post<{ summary: string }>('/api/ai', {
        task: 'summarize',
        title: 'Weekly staff digest',
        description: `This week: ${week.length} new submissions, ${solved.length} issues solved. Most active category: ${topCat?.[0] || 'none'} (${topCat?.[1] || 0} posts). Top items: ${week.slice(0, 5).map((p) => p.title).join('; ')}`,
      });
      const text = `📅 Week of ${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}\n\n• ${week.length} new submissions · ${solved.length} solved\n• Most active: ${topCat?.[0] || 'N/A'} (${topCat?.[1] || 0} posts)\n\n${result.summary}`;
      setDigest(text);
      lsSet('vb:aiDigest', text);
      toast('Weekly digest generated', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
    setDigestBusy(false);
  };

  const run = useCallback(async () => {
    setBusy(true);
    try {
      // snapshot current ranking so we can show ▲/▼ movement after the new run
      const old = lsGet<AnalysisResult | null>('vb:aiAnalysis', null);
      if (old?.ranked_issues) {
        const ranks: Record<string, number> = {};
        old.ranked_issues.forEach((r, i) => { ranks[r.id] = i; });
        setPrevRanks(ranks);
        lsSet('vb:aiPrevRanks', ranks);
      }
      const posts = await api.get<PostData[]>('/api/posts?all=1');
      const result = await api.postSlow<AnalysisResult>('/api/ai', { task: 'analyze', posts });
      setAnalysis(result);
      lsSet('vb:aiAnalysis', result);
      toast(`Analysis complete (${result.engine})`, 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
    setBusy(false);
  }, [toast]);

  useEffect(() => { if (!analysis) run(); }, [analysis, run]);

  useEffect(() => {
    api.get<{ executions: AgentExecution[] }>('/api/agent-executions?action=list&limit=20')
      .then((data) => {
        const execs = data.executions || [];
        const relevant = execs.filter((e) => 
          ['analytics', 'content', 'specialist'].includes(e.division ?? '') ||
          (e.agent_id && (e.agent_id.includes('duplicate') || e.agent_id.includes('sentiment') ||
           e.agent_id.includes('nlp') || e.agent_id.includes('problem')))
        );
        setAgentIntel(relevant.slice(0, 6));
      })
      .catch((e: unknown) => { console.warn('[AiPanel] Failed to load agent intel:', e instanceof Error ? e.message : e); });
  }, []);

  // ── Fetch proactive suggestions ──
  const fetchSuggestions = useCallback(async () => {
    setSuggestionsBusy(true);
    try {
      const result = await api.get<{ suggestions: Suggestion[]; count: number }>('/api/proactive?action=detect');
      setSuggestions(result?.suggestions || []);
    } catch { /* non-critical */ }
    setSuggestionsBusy(false);
  }, []);

  useEffect(() => { fetchSuggestions(); }, [fetchSuggestions]);

  // ── Floating panel drag handlers ──
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!isFloating) return;
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      pos: { ...position },
    };
  }, [isFloating, position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.pos.x + dx,
        y: dragRef.current.pos.y + dy,
      });
    };
    const handleUp = () => { setIsDragging(false); dragRef.current = null; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [isDragging]);

  const toggleFloating = useCallback(() => {
    const next = !isFloating;
    setIsFloating(next);
    lsSet('vb:aiPanelFloating', next);
    if (next) setPosition({ x: window.innerWidth - 420, y: 80 });
  }, [isFloating]);

  // ── Dismiss suggestion ──
  const dismissSuggestion = useCallback(async (id: string) => {
    try { await api.get(`/api/proactive?action=dismiss&id=${id}`); } catch { /* dismissed */ }
    setSuggestions(prev => prev.filter(s => s.id !== id));
  }, []);

  const applySummary = async (id: string) => {
    try {
      const posts = await api.get<PostData[]>(`/api/posts?id=${id}`);
      const p = posts?.[0];
      if (!p) { toast('Post not found', 'err'); return; }
      const s = await api.post<{ summary: string }>('/api/ai', { task: 'summarize', title: p.title, description: p.description });
      await api.put('/api/posts', { id, ai_summary: s.summary });
      toast('AI summary published to post', 'ok');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Unknown error', 'err'); }
  };

  // ── Floating panel style ──
  const floatingStyle = isFloating ? {
    position: 'fixed' as const,
    top: position.y,
    left: position.x,
    zIndex: 50,
    width: isMinimized ? 280 : 400,
    maxHeight: isMinimized ? 48 : '80vh',
    borderRadius: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--vb-border)',
    overflow: 'hidden',
    transition: isDragging ? 'none' : 'all 0.2s ease',
  } : {};

  const panelContent = (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display font-bold text-xl flex items-center gap-2">
            <Sparkles className="text-accent" size={20} /> AI Analysis
          </h1>
          <p className="text-xs text-ink3 mt-0.5">
            {String(analysis?.engine || '').startsWith('rule-based')
              ? 'Rule-based engine — every score computed from live votes, comments & keywords with visible evidence.'
              : `Powered by ${analysis?.engine || 'Claude'} (real LLM analysis)`}
            {analysis?.generated_at && ` · ${new Date(analysis.generated_at).toLocaleTimeString()}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost !text-xs" onClick={generateDigest} disabled={digestBusy}><FileText size={13} /> {digestBusy ? 'Writing…' : 'Weekly digest'}</button>
          <button className="btn btn-primary !text-xs" onClick={run} disabled={busy}><RefreshCcw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'Analyzing…' : 'Re-run analysis'}</button>
          {isFloating && (
            <button className="btn btn-ghost !p-1.5" onClick={() => setIsMinimized(!isMinimized)} title={isMinimized ? 'Expand' : 'Minimize'}>
              {isMinimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
            </button>
          )}
          {isFloating && (
            <button className="btn btn-ghost !p-1.5" onClick={toggleFloating} title="Dock panel"><X size={13} /></button>
          )}
        </div>
      </div>

      {/* ── Floating mode toggle (when docked) ── */}
      {!isFloating && (
        <button className="btn btn-ghost !text-xs w-full justify-center border border-dashed border-border" onClick={toggleFloating}>
          <Maximize2 size={12} /> Float this panel
        </button>
      )}

      {digest && (
        <div className="card p-5 vb-rise" style={{ background: 'linear-gradient(135deg, rgba(22,160,106,0.06), var(--vb-surface))' }}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-good mb-2 flex items-center gap-1.5"><FileText size={12} /> Weekly staff digest</h2>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{digest}</p>
          <button className="btn btn-ghost !text-xs mt-3" onClick={() => { navigator.clipboard?.writeText(digest); toast('Copied to clipboard', 'ok'); }}>Copy for staff email</button>
        </div>
      )}

      {String(analysis?.engine || '').startsWith('rule-based') && (
        <div className="rounded-xl px-4 py-3 text-xs flex items-start gap-2" style={{ background: 'var(--vb-accent-soft)', color: 'var(--vb-accent)' }}>
          <Sparkles size={13} className="mt-0.5 shrink-0" />
          <span><b>Want deeper LLM analysis?</b> Add an <code className="font-mono">ANTHROPIC_API_KEY</code> in the Secrets tab and re-run — Claude will cluster themes semantically and write natural-language insights. The current rule-based results are still 100% real, computed from live data.</span>
        </div>
      )}

      {!analysis && busy && <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}</div>}

      {analysis && (
        <>
          <div className="card p-5" style={{ background: 'linear-gradient(135deg, var(--vb-accent-soft), var(--vb-surface))' }}>
            <h2 className="text-xs font-bold uppercase tracking-wider text-accent mb-2">Executive summary</h2>
            <p className="text-sm leading-relaxed">{analysis.summary}</p>
            {analysis.weekly_insights && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {[
                  { v: analysis.weekly_insights.total, l: 'items analyzed', c: 'text-ink' },
                  { v: analysis.weekly_insights.high_urgency, l: 'high urgency', c: 'text-bad' },
                  { v: (analysis.duplicate_clusters || []).length, l: 'duplicate clusters', c: 'text-warn' },
                ].map(({ v, l, c }) => (
                  <div key={l} className="rounded-xl bg-surface/70 border border-border px-3 py-2 text-center">
                    <p className={`font-display font-bold text-lg ${c}`}><CountUp value={Number(v) || 0} /></p>
                    <p className="text-[10px] text-ink3">{l}</p>
                  </div>
                ))}
              </div>
            )}
            {analysis.weekly_insights?.trending_category && (
              <p className="text-xs mt-3">📈 Trending category: <b className="text-accent">{analysis.weekly_insights.trending_category}</b></p>
            )}
            {analysis.weekly_insights?.recommendation && <p className="text-xs text-ink2 mt-2">💡 {analysis.weekly_insights.recommendation}</p>}
          </div>

          {(analysis.safety_alerts || []).length > 0 && (
            <div className="card !border-bad/40 p-5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-bad mb-2 flex items-center gap-1.5"><ShieldAlert size={13} /> Safety alerts</h2>
              {analysis.safety_alerts.map((a) => (
                <p key={a.id} className="text-sm py-1.5 border-b border-border last:border-0"><b>{a.title}</b> <span className="text-xs text-ink3">— {a.reason}</span></p>
              ))}
            </div>
          )}

          <div className="card p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink3 mb-3 flex items-center gap-1.5"><TrendingUp size={13} /> AI-ranked issues</h2>
            <div className="space-y-2">
              {(analysis.ranked_issues || []).map((r, i) => (
                <div key={r.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0 vb-rise" style={{ animationDelay: `${i * 45}ms` }}>
                  <div className="flex flex-col items-center w-8 shrink-0">
                    <span className={`font-display font-bold ${i === 0 ? 'text-accent' : 'text-ink3'}`}>{i + 1}</span>
                    <RankMove id={r.id} index={i} prevRanks={prevRanks} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.title}</p>
                    <div className="flex flex-wrap gap-2 text-[10px] text-ink3 mt-0.5">
                      <span>{r.category}</span>
                      {r.status && <span className="capitalize">{String(r.status).replace('_', ' ')}</span>}
                      {(r.flags || []).map((f: string) => <span key={f} className="text-warn font-semibold">⚠ {f}</span>)}
                    </div>
                    {r.evidence && <p className="text-[10px] text-ink3 mt-0.5">📋 Evidence: {r.evidence}</p>}
                    {r.recommended_action && <p className="text-[11px] text-accent mt-0.5">→ {r.recommended_action}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="w-16 h-2 rounded-full bg-surface2 overflow-hidden mb-1">
                      <div className={`h-full rounded-full vb-bar-anim ${r.urgency_score > 70 ? 'bg-bad' : r.urgency_score > 40 ? 'bg-warn' : 'bg-good'}`} style={{ width: `${r.urgency_score}%`, animationDelay: `${i * 60}ms` }} />
                    </div>
                    <span className={`text-[10px] font-mono font-semibold ${r.urgency_score > 70 ? 'text-bad' : r.urgency_score > 40 ? 'text-warn' : 'text-ink3'}`}>urgency <CountUp value={r.urgency_score} /></span>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button className="btn btn-ghost !p-1.5" onClick={() => applySummary(r.id)} title="Generate & publish AI summary"><Sparkles size={12} /></button>
                    <button className="btn btn-soft !p-1.5" onClick={() => issueToPoll(r)} title="Turn into a Yes/No poll"><BarChart3 size={12} /></button>
                  </div>
                </div>
              ))}
              {(analysis.ranked_issues || []).length === 0 && <p className="text-xs text-ink3">No issues to rank yet.</p>}
            </div>
          </div>

          {(analysis.duplicate_clusters || []).length > 0 && (
            <div className="card p-5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-ink3 mb-3 flex items-center gap-1.5"><GitMerge size={13} /> Duplicate clusters</h2>
              {analysis.duplicate_clusters.map((c, i) => (
                <div key={i} className="py-2 border-b border-border last:border-0">
                  <p className="text-sm font-medium">{c.topic} <span className="chip !text-[10px] ml-1">{c.count} similar</span></p>
                  {c.shared_words && c.shared_words.length > 0 && <p className="text-[10px] text-ink3 mt-0.5">Shared words: {c.shared_words.map((w: string) => `“${w}”`).join(', ')}</p>}
                  <p className="text-[10px] font-mono text-ink3 mt-0.5 truncate">{(c.post_ids || []).join(' · ')}</p>
                </div>
              ))}
              <p className="text-[11px] text-ink3 mt-2 flex items-center gap-1"><AlertTriangle size={11} /> Use “Merge duplicate” in the Complaints table to consolidate these.</p>
            </div>
          )}
        </>
      )}

      {/* Agent Intelligence */}
      {agentIntel.length > 0 && (
        <div className="space-y-3 mt-6 pt-5 border-t border-border">
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <Brain size={16} className="text-accent" /> Agent Intelligence
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agentIntel.map((exec) => (
              <div key={exec.id} className="card p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${exec.status === 'completed' ? 'bg-green-400' : exec.status === 'failed' ? 'bg-red-400' : 'bg-accent animate-pulse'}`} />
                  <span className="text-xs font-bold text-ink1 truncate">{exec.agent_name}</span>
                  <span className="text-[9px] text-ink3 ml-auto">{exec.duration_ms}ms</span>
                </div>
                {exec.output && (
                  <p className="text-[10px] text-ink2 line-clamp-3">
                    {typeof exec.output === 'string' ? exec.output : safeStringify(exec.output).slice(0, 200)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Proactive Suggestions ── */}
      <div className="mt-6 pt-5 border-t border-border">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}
        >
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <Lightbulb size={16} className="text-warn" /> Proactive Suggestions
            {suggestions.length > 0 && <span className="chip !text-[9px]">{suggestions.length}</span>}
          </h3>
          {suggestionsExpanded ? <ChevronUp size={14} className="text-ink3" /> : <ChevronDown size={14} className="text-ink3" />}
        </button>
        {suggestionsExpanded && (
          <div className="mt-3 space-y-2">
            {suggestionsBusy && <div className="skeleton h-16" />}
            {!suggestionsBusy && suggestions.length === 0 && (
              <p className="text-[11px] text-ink3">No suggestions right now. The assistant will proactively detect issues and opportunities.</p>
            )}
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-start gap-3 p-3 rounded-xl bg-surface/50 border border-border/60 group">
                <div className="shrink-0 mt-0.5">
                  <span className={`w-2 h-2 rounded-full ${s.priority === 'high' ? 'bg-bad' : s.priority === 'medium' ? 'bg-warn' : 'bg-good'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">{s.title}</p>
                  <p className="text-[10px] text-ink3 mt-0.5 line-clamp-2">{s.description}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[9px] text-ink3 font-mono">{Math.round((s.confidence || 0) * 100)}% confidence</span>
                    {(s.suggestedActions || []).slice(0, 2).map((action: string) => (
                      <button key={action} className="text-[9px] text-accent hover:underline font-medium">{action.replace(/_/g, ' ')}</button>
                    ))}
                  </div>
                </div>
                <button
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-ink3 hover:text-bad"
                  onClick={() => dismissSuggestion(s.id)}
                  title="Dismiss"
                ><X size={12} /></button>
              </div>
            ))}
            {!suggestionsBusy && suggestions.length > 0 && (
              <button className="btn btn-ghost !text-[10px] w-full" onClick={fetchSuggestions}>
                <RefreshCcw size={11} /> Refresh suggestions
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // ── Floating mode: draggable wrapper ──
  if (isFloating) {
    return (
      <div
        ref={panelRef}
        style={floatingStyle}
        className={`card p-5 ${isMinimized ? '' : 'overflow-y-auto'} ${isDragging ? 'cursor-grabbing' : ''}`}
        onMouseDown={handleDragStart}
      >
        {isMinimized ? (
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setIsMinimized(false)}>
            <Sparkles className="text-accent" size={16} />
            <span className="text-xs font-bold">AI Analysis</span>
            {suggestions.length > 0 && <span className="chip !text-[8px]">{suggestions.length} suggestions</span>}
          </div>
        ) : panelContent}
      </div>
    );
  }

  // ── Docked mode: normal page layout ──
  return panelContent;
}
