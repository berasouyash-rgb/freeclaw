import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Eye, Send, ImagePlus, X, Save, AlertTriangle, Lightbulb, Megaphone, BarChart3, Copy, Mic, MicOff, ShieldAlert, ShieldCheck, Sparkles, CheckCircle2, Zap, Pencil } from 'lucide-react';
import { speechSupported, startDictation, type SpeechSession } from '../lib/speech';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import { CATEGORIES, CAT_EMOJI, sanitize } from '../lib/utils';
import { lsGet, lsSet, checkCooldown, stampCooldown } from '../lib/identity';
import { fireConfetti } from '../components/Confetti';
import { moderateContent, isBlocked, getModerationSummary, type ModerationResult } from '../lib/moderation';
import type { PostData, PostType } from '../types';

const DRAFT_KEY = 'vb:drafts';

interface Draft { title?: string; desc?: string; category?: string; priority?: string; tags?: string; type?: PostType; savedAt?: string }
interface AiSuggest { category: string; confidence?: number; priority?: string; tags?: string[]; improved_title?: string }
interface PrePubResult {
  decision: string; reason: string; risk_score: number; review_id?: string;
  checks?: { privacy: { pass: boolean; issues: string[] }; safety: { pass: boolean; issues: string[] }; spam: { pass: boolean; issues: string[] }; quality: { pass: boolean; issues: string[] } };
  analysis?: { priority: string; department: string; summary: string; estimated_resolution_time: string; llm_analyzed: boolean };
}

export default function Submit() {
  const { anonId, toast, pushNotif, accountStatus } = useApp();
  const restricted = !!(accountStatus?.banned || accountStatus?.suspended);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const initialType: PostType = params.get('type') === 'suggestion' ? 'suggestion' : params.get('type') === 'poll' ? 'poll' : 'problem';

  const [type, setType] = useState<PostType>(initialType);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState('Academics');
  const [priority, setPriority] = useState('medium');
  const [tags, setTags] = useState('');
  const [image, setImage] = useState<{ preview: string; base64: string; type: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  // Inline validation errors
  const [titleError, setTitleError] = useState('');
  const [descError, setDescError] = useState('');
  // poll fields
  const [pollType, setPollType] = useState<'yesno' | 'single' | 'multi'>('yesno');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [expiry, setExpiry] = useState('');
  const [linkPost, setLinkPost] = useState('');
  const [linkablePosts, setLinkablePosts] = useState<PostData[]>([]);

  // Load open problems for the "link poll to complaint" selector
  useEffect(() => {
    if (type !== 'poll') return;
    api.get<PostData[]>('/api/posts?type=problem')
      .then((all) => setLinkablePosts(all.filter((p) => !['solved', 'archived'].includes(p.status)).slice(0, 50)))
      .catch((e: unknown) => { console.warn('[Submit] Failed to load linkable posts:', e instanceof Error ? e.message : e); });
  }, [type]);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const [duplicates, setDuplicates] = useState<PostData[]>([]);
  const allPostsRef = useRef<PostData[] | null>(null);
  /** Real-time AI suggestions (category + tags + priority + improved title) */
  const [aiSuggest, setAiSuggest] = useState<AiSuggest | null>(null);
  const suggestSeq = useRef(0);

  /** Content moderation state — live checks as user types */
  const [moderation, setModeration] = useState<ModerationResult | null>(null);
  const modSeq = useRef(0);

  /** Pre-publish AI review result */
  const [prePubResult, setPrePubResult] = useState<PrePubResult | null>(null);
  const [prePubBusy, setPrePubBusy] = useState(false);

  useEffect(() => {
    if (type === 'poll') { setAiSuggest(null); return; }
    const text = `${title}. ${desc}`.trim();
    if (text.length < 10) { setAiSuggest(null); return; }
    const seq = ++suggestSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.post<AiSuggest>('/api/assist', { task: 'suggest', text });
        if (seq === suggestSeq.current && r.category) setAiSuggest(r);
      } catch { /* non-blocking */ }
    }, 600);
    return () => clearTimeout(t);
  }, [title, desc, type]);

  // Live validation — show errors as user types (after first blur or submit attempt)
  const [touched, setTouched] = useState({ title: false, desc: false });

  useEffect(() => {
    if (touched.title) {
      if (title.trim().length === 0) setTitleError('Title is required');
      else if (title.trim().length < 5) setTitleError('Title must be at least 5 characters');
      else setTitleError('');
    }
  }, [title, touched.title]);

  useEffect(() => {
    if (touched.desc) {
      if (type !== 'poll') {
        if (desc.trim().length === 0) setDescError('Description is required');
        else if (desc.trim().length < 10) setDescError('Description must be at least 10 characters');
        else setDescError('');
      }
    }
  }, [desc, touched.desc, type]);

  // Live moderation checks on title + description
  useEffect(() => {
    const text = `${title} ${desc}`.trim();
    if (text.length < 3) { setModeration(null); return; }
    const seq = ++modSeq.current;
    const t = setTimeout(() => {
      if (seq === modSeq.current) {
        setModeration(moderateContent(text));
      }
    }, 200); // fast debounce for instant feel
    return () => clearTimeout(t);
  }, [title, desc]);

  /** Optimized dictation: continuous, live interim text, vocabulary correction */
  const [dictating, setDictating] = useState(false);
  const [interim, setInterim] = useState('');
  const sessionRef = useRef<SpeechSession | null>(null);

  const toggleDictation = () => {
    if (dictating) { sessionRef.current?.stop(); return; }
    const session = startDictation({
      onInterim: setInterim,
      onFinal: (chunk) => { setDesc((d) => (d + (d && !d.endsWith(' ') ? ' ' : '') + chunk).slice(0, 500)); setInterim(''); },
      onEnd: () => { setDictating(false); setInterim(''); },
      onError: (msg) => { toast(msg, 'err'); setDictating(false); setInterim(''); },
    });
    if (session) {
      sessionRef.current = session; setDictating(true);
      toast('Listening… say "full stop" or "comma" for punctuation', 'info');
    }
  };

  useEffect(() => () => sessionRef.current?.stop(), []);

  /** Duplicate detection: word-overlap similarity against open posts in the same category */
  const checkDuplicates = useCallback(async (titleText: string, descText: string, category: string) => {
    const words = (t: string) => new Set(t.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const mine = words(titleText + ' ' + descText);
    if (mine.size < 2) { setDuplicates([]); return; }
    try {
      if (!allPostsRef.current) allPostsRef.current = await api.get<PostData[]>('/api/posts');
      const matches = (allPostsRef.current || [])
        .filter((p) => p.category === category && !['solved', 'archived'].includes(p.status))
        .map((p) => {
          const theirs = words(p.title + ' ' + p.description);
          const overlap = [...mine].filter((w) => theirs.has(w)).length;
          return { post: p, score: overlap / Math.max(3, Math.min(mine.size, theirs.size)) };
        })
        .filter((m) => m.score >= 0.45)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
      setDuplicates(matches.map((m) => m.post));
    } catch { /* non-blocking */ }
  }, []);

  useEffect(() => {
    if (type === 'poll') { setDuplicates([]); return; }
    const t = setTimeout(() => checkDuplicates(title, desc, category), 700);
    return () => clearTimeout(t);
  }, [title, desc, category, type, checkDuplicates]);

  // restore draft once
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const d = lsGet<Draft | null>(DRAFT_KEY, null);
    if (d && (d.title || d.desc)) {
      setTitle(d.title || ''); setDesc(d.desc || ''); setCategory(d.category || 'Academics');
      setPriority(d.priority || 'medium'); setTags(d.tags || ''); setType(d.type || initialType);
      toast('Draft restored', 'info');
    }
  }, [initialType, toast]);

  // autosave draft (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      if (title || desc) {
        lsSet(DRAFT_KEY, { title, desc, category, priority, tags, type, savedAt: new Date().toISOString() });
        setDraftSaved(true);
        setTimeout(() => setDraftSaved(false), 1600);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [title, desc, category, priority, tags, type]);

  const pickImage = (f: File) => {
    if (f.size > 3 * 1024 * 1024) { toast('Image must be under 3 MB', 'err'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImage({ preview: result, base64: result.split(',')[1] ?? '', type: f.type });
    };
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    // Mark fields as touched to show inline errors
    setTouched({ title: true, desc: true });
    
    const cd = checkCooldown('post', 20);
    if (cd) { toast(`Cooldown active — wait ${cd}s before posting again`, 'err'); return; }

    // Check moderation before allowing submission
    const fullText = `${title} ${desc}`.trim();
    const mod = moderateContent(fullText);
    if (isBlocked(mod)) {
      toast('Content blocked: ' + getModerationSummary(mod), 'err');
      return;
    }

    if (type === 'poll') {
      if (title.trim().length < 5) { toast('Poll question must be at least 5 characters', 'err'); return; }
      const opts = pollType === 'yesno' ? [] : options.map((o) => sanitize(o, 60)).filter(Boolean);
      if (pollType !== 'yesno' && opts.length < 2) { toast('Add at least 2 options', 'err'); return; }
      setBusy(true);
      try {
        await api.post('/api/polls', { title: sanitize(mod.maskedText, 140), ptype: pollType, options: opts, author_id: anonId, expires_at: expiry ? new Date(expiry).toISOString() : null, post_id: linkPost || null });
        stampCooldown('post');
        lsSet(DRAFT_KEY, null);
        fireConfetti();
        toast('Poll published anonymously', 'ok');
        nav('/polls');
      } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Publish failed', 'err'); }
      setBusy(false);
      return;
    }

    if (title.trim().length < 5) { toast('Title must be at least 5 characters', 'err'); return; }
    if (desc.trim().length < 10) { toast('Description must be at least 10 characters', 'err'); return; }

    setBusy(true);
    setPrePubResult(null);
    try {
      // Step 1: Call server-side pre-publish AI agent for moderation
      setPrePubBusy(true);
      let prePub: PrePubResult | null = null;
      try {
        prePub = await api.post<PrePubResult>('/api/pre-publish', {
          content_type: type,
          title: sanitize(title, 140),
          description: sanitize(desc, 500),
          category,
          author_id: anonId,
        });
      } catch (ppErr) {
        // Pre-publish endpoint failure should not block posting — server-side serverModerate() is the safety net
        console.warn('[Submit] pre-publish check failed, continuing:', ppErr);
      }
      setPrePubBusy(false);

      // Step 2: Handle pre-publish decision
      if (prePub) {
        setPrePubResult(prePub);
        if (prePub.decision === 'high_risk') {
          toast(`Content held for review: ${prePub.reason}`, 'err');
          setBusy(false);
          return;
        }
        if (prePub.decision === 'revision') {
          toast(`AI flagged this: ${prePub.reason}. You can still submit, but it may be reviewed.`, 'ok');
          // Fall through — allow submission with warning
        }
      }

      // Step 3: Publish the post
      let image_url = null;
      if (image) {
        image_url = await api.uploadImage(image.base64, image.type, anonId);
      }
      const post = await api.post<{ id: string; title?: string }>('/api/posts', {
        type, title: sanitize(mod.maskedText.split(/\s+/).slice(0, 20).join(' ').slice(0, 120), 120), description: sanitize(mod.maskedText, 500),
        category, priority, author_id: anonId, image_url,
        tags: tags.split(',').map((t) => sanitize(t.trim(), 24)).filter(Boolean).slice(0, 6),
      });
      stampCooldown('post');
      lsSet(DRAFT_KEY, null);
      pushNotif({ kind: 'submitted', title: 'Your post is live', body: post.title ?? title, link: `/post/${post.id}` });
      fireConfetti();
      toast('Submitted anonymously', 'ok');
      nav(type === 'suggestion' ? '/suggestions' : `/post/${post.id}`);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Publish failed', 'err'); }
    setBusy(false);
  };

  const TABS = [
    { key: 'problem', label: 'Problem', icon: Megaphone },
    { key: 'suggestion', label: 'Suggestion', icon: Lightbulb },
    { key: 'poll', label: 'Poll', icon: BarChart3 },
  ] as const;

  return (
    <div className="max-w-2xl mx-auto vb-page-enter">
      {restricted && (
        <div className="card p-4 mb-5 text-sm font-medium vb-rise" style={{ borderColor: 'rgba(220,75,75,0.35)', color: '#dc4b4b' }} role="alert">
          {accountStatus?.banned
            ? 'This anonymous ID has been permanently banned — publishing is disabled.'
            : `Your ID is suspended until ${new Date(accountStatus!.suspended_until!).toLocaleDateString()} — publishing is paused.`}
        </div>
      )}
      <h1 className="font-display font-bold text-2xl mb-1" id="submit-heading">Submit anonymously</h1>
      <p className="text-sm text-ink3 mb-5" id="submit-description">No name, no email, no tracking. Only your anonymous browser ID is attached — and only you know it's yours.</p>

      <div className="flex gap-2 mb-5" role="tablist" aria-label="Content type selection">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={type === key} onClick={() => setType(key)}
            className={`btn flex-1 ${type === key ? 'btn-primary' : 'btn-ghost'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="card p-5 sm:p-6 space-y-5 vb-rise">
        <div>
          <label className="text-xs font-semibold text-ink2 block mb-1.5" htmlFor="f-title">{type === 'poll' ? 'Poll question' : 'Title'} <span className="text-bad">*</span></label>
          <input id="f-title" className={`input ${titleError ? 'moderation-flag' : ''} ${moderation?.flags.some(f => f.category === 'profanity' || f.category === 'hate_speech') ? 'moderation-flag' : moderation && moderation.flags.length === 0 && title.length > 10 ? 'moderation-ok' : ''}`} placeholder={type === 'poll' ? 'Should the library stay open until 8pm?' : type === 'suggestion' ? 'Add water fountains near the gym' : 'Broken AC in classroom 2B'} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, title: true }))} maxLength={type === 'poll' ? 140 : 120} aria-required="true" aria-describedby="f-title-help" aria-invalid={!!titleError} />
          {titleError && <p className="text-[11px] text-bad mt-1 font-medium flex items-center gap-1"><AlertTriangle size={11} /> {titleError}</p>}
          <p id="f-title-help" className="text-[10px] text-ink3 mt-1 text-right">{title.length}/{type === 'poll' ? 140 : 120}</p>
        </div>

        {type === 'poll' ? (
          <>
            <div>
              <label className="text-xs font-semibold text-ink2 block mb-1.5">Poll type</label>
              <div className="flex gap-2">
                {([['yesno', 'Yes / No'], ['single', 'Single choice'], ['multi', 'Multiple choice']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setPollType(k)} className={`btn flex-1 !text-xs ${pollType === k ? 'btn-soft' : 'btn-ghost'}`}>{l}</button>
                ))}
              </div>
            </div>
            {pollType !== 'yesno' && (
              <div>
                <label className="text-xs font-semibold text-ink2 block mb-1.5">Options (2–10)</label>
                <div className="space-y-2">
                  {options.map((o, i) => (
                    <div key={i} className="flex gap-2">
                      <input className="input" placeholder={`Option ${i + 1}`} value={o} maxLength={60}
                        onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} />
                      {options.length > 2 && <button className="btn btn-ghost !p-2.5" onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove option"><X size={14} /></button>}
                    </div>
                  ))}
                </div>
                {options.length < 10 && <button className="btn btn-ghost !text-xs mt-2" onClick={() => setOptions((p) => [...p, ''])}>+ Add option</button>}
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-ink2 block mb-1.5" htmlFor="f-link">Link to a complaint (optional)</label>
              <select id="f-link" className="input" value={linkPost} onChange={(e) => setLinkPost(e.target.value)}>
                <option value="">— Standalone poll (no link) —</option>
                {linkablePosts.map((p) => <option key={p.id} value={p.id}>{p.title.slice(0, 60)}</option>)}
              </select>
              <p className="text-[10px] text-ink3 mt-1">Linked polls appear on the complaint's page and help admins gauge community opinion.</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink2 block mb-1.5" htmlFor="f-expiry">Expiration date (optional)</label>
              <input id="f-expiry" type="datetime-local" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} min={new Date().toISOString().slice(0, 16)} />
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-ink2" htmlFor="f-desc">Description <span className="text-bad">*</span></label>
                {speechSupported && (
                  <button type="button" onClick={toggleDictation} aria-pressed={dictating}
                    className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg transition-all ${dictating ? 'text-white vb-pop' : 'text-accent bg-accent-soft hover:brightness-95'}`}
                    style={dictating ? { background: 'var(--vb-bad)', animation: 'vb-pulse 1.2s ease-in-out infinite' } : undefined}>
                    {dictating ? <><MicOff size={12} /> Stop dictating</> : <><Mic size={12} /> Speak instead</>}
                  </button>
                )}
              </div>
              <div className="relative">
                <textarea id="f-desc" className={`input min-h-32 resize-y ${descError ? 'moderation-flag' : ''} ${dictating ? '!border-bad' : moderation?.flags.some(f => f.category === 'profanity' || f.category === 'hate_speech' || f.category === 'dangerous') ? 'moderation-flag' : moderation && moderation.flags.length === 0 && desc.length > 10 ? 'moderation-ok' : ''}`} placeholder={dictating ? 'Listening… speak clearly' : 'Describe the issue clearly. What happened? Where? How often? (max 500 characters)'} value={desc} onChange={(e) => setDesc(e.target.value.slice(0, 500))} onBlur={() => setTouched((t) => ({ ...t, desc: true }))} maxLength={500} aria-required="true" aria-describedby="f-desc-help" aria-invalid={!!descError} />
                {dictating && interim && (
                  <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs vb-rise" style={{ background: 'rgba(220,75,75,0.08)', border: '1px solid rgba(220,75,75,0.25)' }} aria-live="polite">
                    <span className="w-2 h-2 rounded-full bg-bad shrink-0" style={{ animation: 'vb-pulse 1s ease-in-out infinite' }} aria-hidden />
                    <span className="text-ink2 truncate italic">{interim}</span>
                  </div>
                )}
              </div>
              <div className="flex justify-between mt-1">
                {dictating ? <p className="text-[10px] text-bad font-semibold">Recording — say "full stop", "comma" or "new line" for punctuation</p> : descError ? <p className="text-[11px] text-bad font-medium flex items-center gap-1"><AlertTriangle size={11} /> {descError}</p> : <span />}
                <p id="f-desc-help" className={`text-[10px] ${desc.length > 450 ? 'text-warn font-semibold' : 'text-ink3'}`}>{desc.length}/500</p>
              </div>
            </div>

            {/* Live content moderation feedback */}
            {moderation && moderation.flags.length > 0 && (
              <div className={`rounded-xl p-3.5 vb-rise ${isBlocked(moderation) ? 'moderation-blocked' : moderation.overallSeverity === 'high' ? 'moderation-danger' : moderation.overallSeverity === 'medium' ? 'moderation-warn' : 'moderation-info'}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  {isBlocked(moderation) ? <><ShieldAlert size={12} /> Content blocked</> : <><ShieldCheck size={12} /> Content review</>}
                </p>
                <div className="space-y-1.5">
                  {moderation.flags.map((flag, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className={`shrink-0 mt-0.5 ${
                        flag.severity === 'critical' ? 'text-bad' :
                        flag.severity === 'high' ? 'text-bad' :
                        flag.severity === 'medium' ? 'text-warn' : 'text-ink3'
                      }`}>
                        {flag.severity === 'critical' || flag.severity === 'high' ? <X size={12} /> : flag.severity === 'medium' ? <AlertTriangle size={12} /> : <AlertTriangle size={12} />}
                      </span>
                      <span className="text-ink2">{flag.message}</span>
                    </div>
                  ))}
                </div>
                {isBlocked(moderation) && (
                  <p className="text-[11px] mt-2 font-semibold" style={{ color: 'var(--vb-bad)' }}>
                    Please remove the flagged content to continue. Repeated violations may result in a temporary suspension.
                  </p>
                )}
                {!isBlocked(moderation) && moderation.overallSeverity !== 'none' && (
                  <p className="text-[11px] mt-2 text-ink3">
                    Your content will be reviewed before publishing. Please ensure all feedback is constructive and respectful.
                  </p>
                )}
              </div>
            )}
            {moderation && moderation.flags.length === 0 && (title.length > 10 || desc.length > 10) && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs vb-rise" style={{ background: 'rgba(22,160,106,0.08)', border: '1px solid rgba(22,160,106,0.2)' }}>
                <ShieldCheck size={13} style={{ color: 'var(--vb-good)' }} />
                <span style={{ color: 'var(--vb-good)' }}>Content looks good — no issues detected</span>
              </div>
            )}

            {/* Pre-publish AI review panel — shows after server-side AI analysis */}
            {prePubBusy && (
              <div className="rounded-xl p-4 vb-rise animate-pulse" style={{ background: 'var(--vb-accent-soft)', border: '1px solid rgba(86,82,214,0.2)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={12} className="text-accent animate-spin" />
                  <p className="text-[10px] font-bold uppercase tracking-wider text-accent">AI analyzing your content…</p>
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full rounded bg-accent/10" />
                  <div className="h-3 w-3/4 rounded bg-accent/10" />
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="h-6 rounded bg-accent/10" />
                    <div className="h-6 rounded bg-accent/10" />
                    <div className="h-6 rounded bg-accent/10" />
                    <div className="h-6 rounded bg-accent/10" />
                  </div>
                </div>
                <p className="text-[10px] text-ink3 mt-2 italic">Checking for safety, privacy, spam, and quality issues…</p>
              </div>
            )}
            {prePubResult && (
              <div className={`rounded-xl p-4 vb-rise ${
                prePubResult.decision === 'high_risk' ? 'moderation-blocked' :
                prePubResult.decision === 'revision' ? 'moderation-warn' : 'moderation-info'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                    {prePubResult.decision === 'high_risk' ? <><ShieldAlert size={12} /> AI review — blocked</> :
                     prePubResult.decision === 'revision' ? <><AlertTriangle size={12} /> AI review — needs attention</> :
                     <><ShieldCheck size={12} /> AI review — safe to publish</>}
                  </p>
                  {prePubResult.analysis?.llm_analyzed && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(86,82,214,0.15)', color: 'var(--vb-accent)' }}>
                      {prePubResult.analysis.estimated_resolution_time ? `~${prePubResult.analysis.estimated_resolution_time}` : 'analyzed'}
                    </span>
                  )}
                </div>

                {/* Risk score bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-ink2">Risk score</span>
                    <span className={`text-[11px] font-bold ${
                      prePubResult.risk_score >= 70 ? 'text-bad' :
                      prePubResult.risk_score >= 30 ? 'text-warn' : 'text-good'
                    }`}>{prePubResult.risk_score}/100</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--vb-border)' }}>
                    <div className={`h-full rounded-full transition-all duration-700 ${
                      prePubResult.risk_score >= 70 ? 'bg-bad' :
                      prePubResult.risk_score >= 30 ? 'bg-warn' : 'bg-good'
                    }`} style={{ width: `${Math.min(100, prePubResult.risk_score)}%` }} />
                  </div>
                </div>

                {/* Check results grid */}
                {prePubResult.checks && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {([
                      ['privacy', 'Personal info', prePubResult.checks.privacy],
                      ['safety', 'Safety', prePubResult.checks.safety],
                      ['spam', 'Spam', prePubResult.checks.spam],
                      ['quality', 'Quality', prePubResult.checks.quality],
                    ] as const).map(([key, label, check]) => (
                      <div key={key} className="flex items-center gap-1.5 text-[11px]">
                        {check.pass ?
                          <span className="text-good"><CheckCircle2 size={11} /></span> :
                          <span className="text-bad"><X size={11} /></span>
                        }
                        <span className={check.pass ? 'text-ink3' : 'text-ink2 font-semibold'}>{label}</span>
                        {check.issues.length > 0 && (
                          <span className="text-[9px] text-bad font-mono">({check.issues.length})</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* AI reason */}
                <p className="text-[11px] text-ink2 leading-relaxed">{prePubResult.reason}</p>

                {/* Action hint */}
                {prePubResult.decision === 'high_risk' && (
                  <p className="text-[11px] mt-2 font-semibold text-bad">
                    Content held for admin review. You can edit and try again with different wording.
                  </p>
                )}
                {prePubResult.decision === 'revision' && (
                  <p className="text-[11px] mt-2 text-warn">
                    AI flagged something — you can still submit, but it will be reviewed before going public.
                  </p>
                )}
                {prePubResult.decision === 'safe' && (
                  <p className="text-[11px] mt-2 text-good">
                    All checks passed — ready to publish.
                  </p>
                )}
              </div>
            )}

            {/* Live AI suggestions: category, priority, tags, improved title */}
            {aiSuggest?.category && (
              <div className="rounded-xl p-3.5 vb-rise" style={{ background: 'var(--vb-accent-soft)', border: '1px solid rgba(86,82,214,0.2)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-2 flex items-center gap-1.5"><Sparkles size={12} /> AI suggestions · updating live</p>
                <div className="flex flex-wrap gap-1.5">
                  {aiSuggest.category !== category ? (
                    <button type="button" className="chip cursor-pointer !bg-surface hover:!border-accent transition-all"
                      onClick={() => { setCategory(aiSuggest.category); toast(`Category → ${aiSuggest.category}`, 'ok'); }}>
                      {CAT_EMOJI[aiSuggest.category]} {aiSuggest.category} · {Math.round((aiSuggest.confidence || 0) * 100)}% <span className="text-accent font-bold">apply</span>
                    </button>
                  ) : (
                    <span className="chip !border-transparent" style={{ background: 'rgba(22,160,106,0.12)', color: 'var(--vb-good)' }}><CheckCircle2 size={11} /> {CAT_EMOJI[category]} {category}</span>
                  )}
                  {aiSuggest.priority && aiSuggest.priority !== priority && (
                    <button type="button" className="chip cursor-pointer !bg-surface hover:!border-accent transition-all capitalize"
                      onClick={() => setPriority(aiSuggest.priority ?? 'medium')}>
                      <Zap size={11} /> {aiSuggest.priority} priority <span className="text-accent font-bold">apply</span>
                    </button>
                  )}
                  {(aiSuggest.tags || []).filter((t: string) => !tags.toLowerCase().includes(t.toLowerCase())).slice(0, 3).map((t: string) => (
                    <button key={t} type="button" className="chip cursor-pointer !bg-surface hover:!border-accent transition-all"
                      onClick={() => setTags((prev) => (prev ? `${prev}, ${t}` : t))}>
                      #{t} <span className="text-accent font-bold">+</span>
                    </button>
                  ))}
                </div>
                {aiSuggest.improved_title && aiSuggest.improved_title.toLowerCase() !== title.toLowerCase() && (
                  <button type="button" className="w-full text-left text-xs mt-2 px-2.5 py-2 rounded-lg bg-surface border border-border hover:border-accent transition-all flex items-center gap-2"
                    onClick={() => setTitle(aiSuggest.improved_title!.slice(0, 120))}>
                    <Pencil size={12} className="text-accent shrink-0" /> Better title: <b>"{aiSuggest.improved_title}"</b> <span className="text-accent font-bold ml-auto">use</span>
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-ink2 block mb-1.5" htmlFor="f-cat">Category</label>
                <select id="f-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-ink2 block mb-1.5" htmlFor="f-prio">Priority</label>
                <select id="f-prio" className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">Low</option><option value="medium">Medium</option>
                  <option value="high">High</option><option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink2 block mb-1.5" htmlFor="f-tags">Tags (optional, comma-separated)</label>
              <input id="f-tags" className="input" placeholder="wifi, second-floor, recurring" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink2 block mb-1.5">Image (optional)</label>
              {image ? (
                <div className="relative inline-block">
                  <img src={image.preview} alt="Upload preview" className="h-28 rounded-xl border border-border object-cover" />
                  <button className="absolute -top-2 -right-2 bg-bad text-white rounded-full p-1" onClick={() => setImage(null)} aria-label="Remove image"><X size={12} /></button>
                </div>
              ) : (
                <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} aria-label="Attach image to your submission"><ImagePlus size={15} /> Attach image</button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])} />
            </div>
          </>
        )}

        {/* Duplicate warning — similar open posts in this category */}
        {type !== 'poll' && duplicates.length > 0 && (
          <div className="rounded-xl p-3.5 vb-rise" style={{ background: 'rgba(217,138,11,0.08)', border: '1px solid rgba(217,138,11,0.3)' }}>
            <p className="text-xs font-bold flex items-center gap-1.5 text-warn mb-2"><Copy size={12} /> Similar post{duplicates.length > 1 ? 's' : ''} already exist{duplicates.length === 1 ? 's' : ''}</p>
            {duplicates.map((d) => (
              <Link key={d.id} to={`/post/${d.id}`} className="block text-sm font-medium py-1.5 border-b last:border-0 hover:text-accent transition-colors" style={{ borderColor: 'rgba(217,138,11,0.15)' }}>
                {d.title} <span className="text-[11px] text-ink3">· {d.status.replace('_', ' ')} · {(d.reactions?.support || 0)} supports</span>
              </Link>
            ))}
            <p className="text-[11px] text-ink3 mt-2">Consider supporting the existing post instead — combined votes get solved faster. You can still publish yours.</p>
          </div>
        )}

        {type !== 'poll' && preview && (
          <div className="border border-dashed border-accent/40 rounded-xl p-4 bg-accent-soft/40">
            <p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-2">Preview</p>
            <div className="flex gap-2 mb-1.5"><span className="chip">{category}</span><span className="chip capitalize">{priority}</span></div>
            <h3 className="font-display font-semibold">{title || 'Your title'}</h3>
            <p className="text-sm text-ink2 mt-1 prose-desc">{desc || 'Your description will appear here.'}</p>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          {type !== 'poll' && <button className="btn btn-ghost" onClick={() => setPreview((p) => !p)} aria-label={preview ? 'Hide preview' : 'Show preview'}><Eye size={15} /> {preview ? 'Hide' : 'Preview'}</button>}
          <span className={`text-[11px] text-ink3 flex items-center gap-1 transition-opacity duration-300 ${draftSaved ? 'opacity-100' : 'opacity-0'}`}><Save size={11} /> Draft saved</span>
          <button className={`btn btn-primary ml-auto ${busy ? 'btn-loading' : ''}`} onClick={submit} disabled={busy || restricted || prePubBusy || (moderation ? isBlocked(moderation) : false)} aria-label={busy ? 'Publishing your submission' : prePubBusy ? 'Running AI content check' : moderation && isBlocked(moderation) ? 'Content has issues that must be fixed first' : 'Publish anonymously'}>
            {prePubBusy ? <><Sparkles size={15} /> AI checking…</> : busy ? 'Publishing…' : moderation && isBlocked(moderation) ? <><ShieldAlert size={15} /> Fix issues first</> : <><Send size={15} /> Publish anonymously</>}
          </button>
        </div>

        <p className="text-[11px] text-ink3 flex items-start gap-1.5 pt-1">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Posts are public. Content is filtered for abuse and spam. Repeated misuse can lead to your anonymous ID being suspended — no personal data is ever collected.
        </p>
      </div>
    </div>
  );
}
