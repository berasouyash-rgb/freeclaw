import { useState, useMemo } from 'react';
import { HelpCircle, ChevronDown, Search } from 'lucide-react';

const FAQS = [
  { q: 'Is Voice Box really anonymous?', a: 'Yes. There is no registration, and we never ask for names, emails, or phone numbers. We don\u2019t log IP addresses against posts or use tracking scripts. Your only identifier is a random ID generated in your own browser.' },
  { q: 'Can teachers or admins find out who posted?', a: 'No. Admins only ever see the random anonymous ID (like \u201canon_x7k2\u2026\u201d). There is no technical link between that ID and your real identity \u2014 it exists only in your browser\u2019s local storage.' },
  { q: 'How do I delete something I posted?', a: 'Open the post (or go to My Activity) and tap the delete button. You get a 30-second undo. Because ownership lives in your browser, only you can delete your own content.' },
  { q: 'What happens after I report a problem?', a: 'Admins review it and move it through the pipeline: Reported \u2192 Verified \u2192 In Progress \u2192 Waiting \u2192 Solved. You can follow every step with timestamps on the public Solving Board, and you\u2019ll get a notification when the status changes.' },
  { q: 'Why was my post hidden or removed?', a: 'Content that breaks the rules (bullying, spam, personal attacks, naming individuals) may be hidden by moderators. Repeated misuse can lead to your anonymous ID being suspended \u2014 but no personal data is ever involved.' },
  { q: 'What if I clear my browser data or switch devices?', a: 'Your anonymous ID lives only in this browser. Clearing site data or switching devices creates a fresh identity \u2014 your old posts stay public but can no longer be edited or deleted by you. You can export your activity first from My Activity.' },
  { q: 'How does voting work?', a: 'Each anonymous ID can support or disagree once per post, and vote once per poll (you can change your poll vote while it\u2019s open). Votes are counted anonymously.' },
  { q: 'Who runs the AI features?', a: 'AI summaries and analysis run on our server \u2014 your posts are processed to cluster duplicates and rank urgency, but no identity data exists to share. AI suggestions to admins are drafts only; a human must approve every action.' },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return FAQS.map((f, i) => ({ ...f, idx: i }));
    const q = search.toLowerCase();
    return FAQS.map((f, i) => ({ ...f, idx: i })).filter(
      (f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8 vb-rise">
        <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-accent-soft text-accent mb-3"><HelpCircle size={28} /></span>
        <h1 className="font-display font-bold text-2xl">Frequently asked questions</h1>
        <p className="text-sm text-ink3 mt-2">Everything you need to know about staying anonymous and getting heard.</p>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" />
        <input
          className="input !pl-10 !py-2.5 !text-sm"
          placeholder="Search questions…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(null); }}
          aria-label="Search frequently asked questions"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="vb-empty-icon mx-auto mb-2"><HelpCircle size={24} className="text-ink3" /></div>
          <p className="text-sm text-ink3">No questions match your search.</p>
          <p className="text-xs text-ink3 mt-1">Try different keywords or <button className="text-accent hover:underline" onClick={() => setSearch('')}>clear the search</button></p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((f) => (
            <div key={f.idx} className="card overflow-hidden vb-rise" style={{ animationDelay: `${f.idx * 40}ms` }}>
              <button className="w-full flex items-center justify-between gap-3 p-4 text-left" onClick={() => setOpen(open === f.idx ? null : f.idx)}
                aria-expanded={open === f.idx}>
                <span className="font-display font-semibold text-sm">{f.q}</span>
                <ChevronDown size={16} className={`text-ink3 shrink-0 transition-transform ${open === f.idx ? 'rotate-180' : ''}`} />
              </button>
              {open === f.idx && <p className="px-4 pb-4 text-sm text-ink2 leading-relaxed vb-rise">{f.a}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
