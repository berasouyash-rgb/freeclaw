import { ShieldCheck, EyeOff, Fingerprint, Server, Trash2, Lock, KeyRound } from 'lucide-react';
import { useApp } from '../contexts/AppContext';

export default function Privacy() {
  const { anonId } = useApp();
  const ITEMS = [
    { icon: EyeOff, title: 'No personal data — ever', body: 'Voice Box never asks for or stores names, emails, phone numbers, student IDs, or any other personal information. There is no registration and no login for students.' },
    { icon: Fingerprint, title: 'No IP logging or fingerprinting', body: 'We do not log IP addresses, track devices, use analytics cookies, or fingerprint your browser. Your activity cannot be traced back to you.' },
    { icon: KeyRound, title: 'One random anonymous ID', body: 'The only identifier is a random ID generated in your browser (yours is shown below). It links your posts together so you can edit or delete them — nobody can connect it to your identity.' },
    { icon: Server, title: 'Shared content vs. your data', body: 'Posts, comments, and poll results are shared so everyone can see them. Ownership data — your ID, bookmarks, drafts, and notifications — stays only in your browser’s local storage.' },
    { icon: Trash2, title: 'You control everything', body: 'Delete your posts and comments any time (with a 30-second undo). Reset your anonymous ID or wipe all local data from the My Activity page in one click.' },
    { icon: Lock, title: 'Security built in', body: 'All input is sanitized and HTML-escaped to prevent XSS. Admin access uses a hashed password with automatic session timeout. Rate limits and cooldowns prevent spam and flooding.' },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8 vb-rise">
        <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-accent-soft text-accent mb-3"><ShieldCheck size={28} /></span>
        <h1 className="font-display font-bold text-2xl">Privacy comes first</h1>
        <p className="text-sm text-ink3 mt-2 max-w-md mx-auto">Voice Box was designed so that honest feedback is completely safe. Here's exactly how it works.</p>
      </div>
      <div className="space-y-3">
        {ITEMS.map(({ icon: Icon, title, body }, i) => (
          <div key={title} className="card p-5 flex gap-4 vb-rise" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="w-10 h-10 rounded-xl bg-accent-soft text-accent grid place-items-center shrink-0"><Icon size={19} /></span>
            <div>
              <h2 className="font-display font-semibold text-[15px]">{title}</h2>
              <p className="text-sm text-ink2 mt-1 leading-relaxed">{body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="card p-5 mt-5 text-center bg-surface2/50">
        <p className="text-xs text-ink3">Your current anonymous ID (stored only in this browser)</p>
        <code className="font-mono text-accent font-semibold">{anonId}</code>
      </div>
      <p className="text-center text-[11px] text-ink3 mt-6">Keyboard shortcuts: <kbd className="chip !text-[10px]">n</kbd> new post · <kbd className="chip !text-[10px]">g</kbd> feed · <kbd className="chip !text-[10px]">a</kbd> activity · <kbd className="chip !text-[10px]">t</kbd> theme · <kbd className="chip !text-[10px]">/</kbd> search</p>
    </div>
  );
}
