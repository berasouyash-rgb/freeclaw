import { useState, useEffect, useRef } from 'react';
import { Megaphone, ShieldCheck, BarChart3, KanbanSquare, ChevronRight, X } from 'lucide-react';
import { lsGet, lsSet } from '../lib/identity';

const STEPS = [
  { icon: ShieldCheck, title: 'You are 100% anonymous', body: 'No names, emails, or tracking — ever. Only a random ID in this browser links your posts so you can edit or delete them.' },
  { icon: Megaphone, title: 'Report problems & share ideas', body: 'Post issues about your school, support others with a tap, and discuss in anonymous comment threads.' },
  { icon: BarChart3, title: 'Vote in polls', body: 'Yes/No and multiple-choice polls with live animated results. Change your vote anytime while a poll is open.' },
  { icon: KanbanSquare, title: 'Watch things get solved', body: 'The public Solving Board tracks every issue from Reported to Solved — with timestamps and progress, in full view.' },
];

/** Allow re-triggering the tutorial (e.g. from My Activity) */
export function resetTutorial() {
  lsSet('vb:tutorialDone', false);
  window.dispatchEvent(new CustomEvent('vb:show-tutorial'));
}

/** First-run tutorial — shows once per browser, never on /admin */
export default function Tutorial() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (window.location.pathname.startsWith('/admin')) return;
    if (!lsGet('vb:tutorialDone', false)) setOpen(true);
    const h = () => { setStep(0); setOpen(true); };
    window.addEventListener('vb:show-tutorial', h);
    return () => window.removeEventListener('vb:show-tutorial', h);
  }, []);

  // Focus trap when open
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    setTimeout(() => dialogRef.current?.focus(), 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  const finish = () => { lsSet('vb:tutorialDone', true); setOpen(false); };

  if (!open) return null;
  const s = STEPS[step];
  if (!s) return null;
  const Icon = s.icon;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Welcome tutorial">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={finish} aria-hidden />
      <div ref={dialogRef} tabIndex={-1} className="relative card w-full max-w-sm p-6 text-center vb-rise outline-none">
        <button className="absolute top-3 right-3 btn btn-ghost !p-1.5" onClick={finish} aria-label="Skip tutorial"><X size={15} /></button>
        <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-accent-soft text-accent mb-4 vb-pop" key={step}><Icon size={26} /></span>
        <h2 className="font-display font-bold text-lg">{s.title}</h2>
        <p className="text-sm text-ink2 mt-2 leading-relaxed">{s.body}</p>
        <div className="flex items-center justify-center gap-1.5 mt-5" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className="rounded-full transition-all" style={{ width: i === step ? 20 : 6, height: 6, background: i === step ? 'var(--vb-accent)' : 'var(--vb-border)' }} />
          ))}
        </div>
        <div className="flex gap-2 mt-5">
          <button className="btn btn-ghost flex-1" onClick={finish}>Skip</button>
          {step < STEPS.length - 1
            ? <button className="btn btn-primary flex-1" onClick={() => setStep((x) => x + 1)}>Next <ChevronRight size={15} /></button>
            : <button className="btn btn-primary flex-1" onClick={finish}>Start using Voice Box</button>}
        </div>
      </div>
    </div>
  );
}
