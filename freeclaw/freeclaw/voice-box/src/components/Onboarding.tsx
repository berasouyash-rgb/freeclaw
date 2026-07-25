import { useState, useEffect, useRef } from 'react';
import { Megaphone, ShieldCheck, BarChart3, ArrowRight, X } from 'lucide-react';
import { lsGet, lsSet } from '../lib/identity';

const STEPS = [
  { icon: Megaphone, title: 'Your voice, fully anonymous', body: 'Report problems, share ideas and vote in polls — no name, email or login. Ever.' },
  { icon: ShieldCheck, title: 'Nothing traces back to you', body: 'Only a random ID in your browser links your posts so you can edit or delete them. No IP logging, no tracking.' },
  { icon: BarChart3, title: 'Watch things actually get fixed', body: 'Every report moves through a public Reported → In Progress → Solved board with real timestamps.' },
];

/** First-visit welcome tour — shows once, dismissible, remembers via localStorage */
export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(() => !lsGet('vb:onboarded', false));
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

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

  if (!open) return null;
  const done = () => { lsSet('vb:onboarded', true); setOpen(false); };
  const s = STEPS[step];
  if (!s) return null;

  return (
    <div className="fixed inset-0 z-[75] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={done} aria-hidden />
      <div ref={dialogRef} tabIndex={-1} className="relative card w-full max-w-sm p-7 text-center shadow-2xl vb-rise overflow-hidden outline-none">
        <div className="absolute top-0 inset-x-0 h-1 flex">
          {STEPS.map((_, i) => (
            <div key={i} className="flex-1 transition-all duration-500" style={{ background: i <= step ? 'var(--vb-accent)' : 'var(--vb-surface2)' }} />
          ))}
        </div>
        <button className="absolute top-3 right-3 btn btn-ghost !p-1.5" onClick={done} aria-label="Skip tour"><X size={15} /></button>
        <div key={step} className="vb-rise">
          <span className="inline-grid place-items-center w-16 h-16 rounded-2xl mb-4 vb-glow" style={{ background: 'var(--vb-accent-soft)', color: 'var(--vb-accent)' }}>
            <s.icon size={30} />
          </span>
          <h2 className="font-display font-bold text-lg">{s.title}</h2>
          <p className="text-sm text-ink2 mt-2 leading-relaxed">{s.body}</p>
        </div>
        <div className="flex items-center justify-between mt-6">
          <button className="text-xs font-semibold text-ink3 hover:text-ink2" onClick={done}>Skip</button>
          {step < STEPS.length - 1
            ? <button className="btn btn-primary !py-2" onClick={() => setStep((x) => x + 1)}>Next <ArrowRight size={14} /></button>
            : <button className="btn btn-primary !py-2" onClick={done}>Start speaking up 🎉</button>}
        </div>
      </div>
    </div>
  );
}
