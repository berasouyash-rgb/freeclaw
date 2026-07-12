import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Eye, Send, ImagePlus, X, Save, AlertTriangle, Lightbulb, Megaphone, BarChart3, Copy, Mic, MicOff } from 'lucide-react';
import { speechSupported, startDictation, type SpeechSession } from '../lib/speech';
import { useApp } from '../contexts/AppContext';
import { api } from '../lib/api';
import { CATEGORIES, CAT_EMOJI, sanitize } from '../lib/utils';
import { lsGet, lsSet, checkCooldown, stampCooldown } from '../lib/identity';
import { fireConfetti } from '../components/Confetti';

const DRAFT_KEY = 'vb:drafts';

export default function Submit() {
  const { anonId, toast, pushNotif, accountStatus } = useApp();
  const restricted = !!(accountStatus?.banned || accountStatus?.suspended);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const initialType = params.get('type') === 'suggestion' ? 'suggestion' : params.get('type') === 'poll' ? 'poll' : 'problem';

  const [type, setType] = useState<'problem' | 'suggestion' | 'poll'>(initialType as any);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState('Academics');
  const [priority, setPriority] = useState('medium');
  const [tags, setTags] = useState('');
  const [image, setImage] = useState<{ preview: string; base64: string; type: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  // poll fields
  const [pollType, setPollType] = useState<'yesno' | 'single' | 'multi'>('yesno');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [expiry, setExpiry] = useState('');
  const [linkPost, setLinkPost] = useState('');
  const [linkablePosts, setLinkablePosts] = useState<any[]>([]);

  // Load open problems for the "link poll to complaint" selector
  useEffect(() => {
    if (type !== 'poll') return;
    api.get('/api/posts?type=problem')
      .then((all) => setLinkablePosts(all.filter((p: any) => !['solved', 'archived'].includes(p.status)).slice(0, 50)))
      .catch(() => {});
  }, [type]);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const allPostsRef = useRef<any[] | null>(null);
  /** Real-time AI suggestions (category + tags + priority + improved title) */
  const [aiSuggest, setAiSuggest] = useState<any>(null);
  const suggestSeq = useRef(0);

  useEffect(() => {
    if (type === 'poll') { setAiSuggest(null); return; }
    const text = `${title}. ${desc}`.trim();
    if (text.length < 10) { setAiSuggest(null); return; }
    const seq = ++suggestSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.post('/api/assist', { task: 'suggest', text });
        if (seq === suggestSeq.current && r.category) setAiSuggest(r);
      } catch { /* non-blocking */ }
    }, 600);
    return () => clearTimeout(t);
  }, [title, desc, type]);

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
      toast('Listening… say “full stop” or “comma” for punctuation', 'info');
    }
  };

  useEffect(() => () => sessionRef.current?.stop(), []);

  /** Duplicate detection: word-overlap similarity against open posts in the same category */
  const checkDuplicates = useCallback(async (titleText: string, descText: string, category: string) => {
    const words = (t: string) => new Set(t.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const mine = words(titleText + ' ' + descText);
    if (mine.size < 2) { setDuplicates([]); return; }
    try {
      if (!allPostsRef.current) allPostsRef.current = await api.get('/api/posts');
      const matches = (allPostsRef.current || [])
        .filter((p: any) => p.category === category && !['solved', 'archived'].includes(p.status))
        .map((p: any) => {
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
    const d = lsGet<any>(DRAFT_KEY, null);
    if (d && (d.title || d.desc)) {
      setTitle(d.title || ''); setDesc(d.desc || ''); setCategory(d.category || 'Academics');
      setPriority(d.priority || 'medium'); setTags(d.tags || ''); setType(d.type || initialType);
      toast('Draft restored ✍️', 'info');
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
      setImage({ preview: result, base64: result.split(',')[1], type: f.type });
    };
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    const cd = checkCooldown('post', 20);
    if (cd) { toast(`Cooldown active — wait ${cd}s before posting again`, 'err'); return; }

    if (type === 'poll') {
      if (title.trim().length < 5) { toast('Poll question must be at least 5 characters', 'err'); return; }
      const opts = pollType === 'yesno' ? [] : options.map((o) => sanitize(o, 60)).filter(Boolean);
      if (pollType !== 'yesno' && opts.length < 2) { toast('Add at least 2 options', 'err'); return; }
      setBusy(true);
      try {
        await api.post('/api/polls', { title: sanitize(title, 140), ptype: pollType, options: opts, author_id: anonId, expires_at: expiry ? new Date(expiry).toISOString() : null, post_id: linkPost || null });
        stampCooldown('post');
        lsSet(DRAFT_KEY, null);
        fireConfetti();
        toast('Poll published anonymously 🎉', 'ok');
        nav('/polls');
      } catch (e: any) { toast(e.message, 'err'); }
      setBusy(false);
      return;
    }

    if (title.trim().length < 5) { toast('Title must be at least 5 characters', 'err'); return; }
    if (desc.trim().length < 10) { toast('Description must be at least 10 characters', 'err'); return; }
    setBusy(true);
    try {
      let image_url = null;
      if (image) {
        image_url = await api.uploadImage(image.base64, image.type, anonId);
      }
      const post = await api.post('/api/posts', {
        type, title: sanitize(title, 120), description: sanitize(desc, 500),
        category, priority, author_id: anonId, image_url,
        tags: tags.split(',').map((t) => sanitize(t.trim(), 24)).filter(Boolean).slice(0, 6),
      });
      stampCooldown('post');
      lsSet(DRAFT_KEY, null);
      pushNotif({ kind: 'submitted', title: '📨 Your post is live', body: post.title, link: `/post/${post.id}` });
      fireConfetti();
      toast('Submitted anonymously 🎉', 'ok');
      nav(type === 'suggestion' ? '/suggestions' : `/post/${post.id}`);
    } catch (e: any) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const TABS = [
    { key: 'problem', label: 'Problem', icon: Megaphone },
    { key: 'suggestion', label: 'Suggestion', icon: Lightbulb },
    { key: 'poll', label: 'Poll', icon: BarChart3 },
  ] as const;

  return (
    <div className="max-w-2xl mx-auto">
      {restricted && (
        <div className="card p-4 mb-5 text-sm font-medium vb-rise" style={{ borderColor: 'rgba(220,75,75,0.35)', color: '#dc4b4b' }} role="alert">
          {accountStatus?.banned
            ? '🚫 This anonymous ID has been permanently banned — publishing is disabled.'
            : `⏸️ Your ID is suspended until ${new Date(accountStatus!.suspended_until!).toLocaleDateString()} — publishing is paused.`}
        </div>
      )}
      <h1 className="font-display font-bold text-2xl mb-1">Submit anonymously</h1>
      <p className="text-sm text-ink3 mb-5">No name, no email, no tracking. Only your anonymous browser ID is attached — and only you know it's yours.</p>

      <div className="flex gap-2 mb-5" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={type === key} onClick={() => setType(key)}
            className={`btn flex-1 ${type === key ? 'btn-primary' : 'btn-ghost'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="card p-5 space-y-4 vb-rise">
        <div>
          <label className="text-xs font-semibold text-ink2 block mb-1.5" htmlFor="f-title">{type === 'poll' ? 'Poll question' : 'Title'} <span className="text-bad">*</span></label>
          <input id="f-title" className="input" placeholder={type === 'poll' ? 'Should the library stay open until 8pm?' : type === 'suggestion' ? 'Add water fountains near the gym' : 'Broken AC in classroom 2B'} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={type === 'poll' ? 140 : 120} />
          <p className="text-[10px] text-ink3 mt-1 text-right">{title.length}/{type === 'poll' ? 140 : 120}</p>
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
                <textarea id="f-desc" className={`input min-h-32 resize-y ${dictating ? '!border-bad' : ''}`} placeholder={dictating ? '🎤 Listening… speak clearly' : 'Describe the issue clearly. What happened? Where? How often? (max 500 characters)'} value={desc} onChange={(e) => setDesc(e.target.value.slice(0, 500))} maxLength={500} />
                {dictating && interim && (
                  <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs vb-rise" style={{ background: 'rgba(220,75,75,0.08)', border: '1px solid rgba(220,75,75,0.25)' }} aria-live="polite">
                    <span className="w-2 h-2 rounded-full bg-bad shrink-0" style={{ animation: 'vb-pulse 1s ease-in-out infinite' }} aria-hidden />
                    <span className="text-ink2 truncate italic">{interim}</span>
                  </div>
                )}
              </div>
              <div className="flex justify-between mt-1">
                {dictating ? <p className="text-[10px] text-bad font-semibold">● Recording — say “full stop”, “comma” or “new line” for punctuation</p> : <span />}
                <p className={`text-[10px] ${desc.length > 450 ? 'text-warn font-semibold' : 'text-ink3'}`}>{desc.length}/500</p>
              </div>
            </div>

            {/* Live AI suggestions: category, priority, tags, improved title */}
            {aiSuggest?.category && (
              <div className="rounded-xl p-3 vb-rise" style={{ background: 'var(--vb-accent-soft)', border: '1px solid rgba(86,82,214,0.2)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-2">✨ AI suggestions · updating live</p>
                <div className="flex flex-wrap gap-1.5">
                  {aiSuggest.category !== category ? (
                    <button type="button" className="chip cursor-pointer !bg-surface hover:!border-accent transition-all"
                      onClick={() => { setCategory(aiSuggest.category); toast(`Category → ${aiSuggest.category}`, 'ok'); }}>
                      {CAT_EMOJI[aiSuggest.category]} {aiSuggest.category} · {Math.round((aiSuggest.confidence || 0) * 100)}% <span className="text-accent font-bold">apply</span>
                    </button>
                  ) : (
                    <span className="chip !border-transparent" style={{ background: 'rgba(22,160,106,0.12)', color: 'var(--vb-good)' }}>✓ {CAT_EMOJI[category]} {category}</span>
                  )}
                  {aiSuggest.priority && aiSuggest.priority !== priority && (
                    <button type="button" className="chip cursor-pointer !bg-surface hover:!border-accent transition-all capitalize"
                      onClick={() => setPriority(aiSuggest.priority)}>
                      ⚡ {aiSuggest.priority} priority <span className="text-accent font-bold">apply</span>
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
                  <button type="button" className="w-full text-left text-xs mt-2 px-2.5 py-2 rounded-lg bg-surface border border-border hover:border-accent transition-all"
                    onClick={() => setTitle(aiSuggest.improved_title.slice(0, 120))}>
                    ✏️ Better title: <b>“{aiSuggest.improved_title}”</b> <span className="text-accent font-bold">use</span>
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
                  <option value="low">🟢 Low</option><option value="medium">🔵 Medium</option>
                  <option value="high">🟠 High</option><option value="critical">🔴 Critical</option>
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
                <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><ImagePlus size={15} /> Attach image</button>
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

        <div className="flex items-center gap-2 pt-1">
          {type !== 'poll' && <button className="btn btn-ghost" onClick={() => setPreview((p) => !p)}><Eye size={15} /> {preview ? 'Hide' : 'Preview'}</button>}
          <span className={`text-[11px] text-ink3 flex items-center gap-1 transition-opacity ${draftSaved ? 'opacity-100' : 'opacity-0'}`}><Save size={11} /> Draft saved</span>
          <button className="btn btn-primary ml-auto" onClick={submit} disabled={busy || restricted}>
            {busy ? 'Publishing…' : <><Send size={15} /> Publish anonymously</>}
          </button>
        </div>

        <p className="text-[11px] text-ink3 flex items-start gap-1.5 pt-1 border-t border-border">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Posts are public. Content is filtered for abuse and spam. Repeated misuse can lead to your anonymous ID being suspended — no personal data is ever collected.
        </p>
      </div>
    </div>
  );
}
