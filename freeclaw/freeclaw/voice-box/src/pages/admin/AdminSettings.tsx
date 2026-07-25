import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';
import { sha256 } from '../../lib/utils';
import ProviderSettings from './ProviderSettings';

export default function AdminSettings() {
  const { toast } = useApp();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  const changePassword = async () => {
    if (pw1.length < 6) { toast('Password must be at least 6 characters', 'err'); return; }
    if (pw1 !== pw2) { toast('Passwords do not match', 'err'); return; }
    setBusy(true);
    try {
      await api.post('/api/admin', { action: 'change_password', new_hash: await sha256(pw1) });
      setPw1(''); setPw2('');
      toast('Password updated — use it on your next login', 'ok');
    } catch (e: any) { toast(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <div className="max-w-lg">
      <h1 className="font-display font-bold text-xl mb-4">Settings</h1>

      <div className="card p-5 mb-4">
        <h2 className="font-display font-semibold text-sm flex items-center gap-2 mb-3"><KeyRound size={15} className="text-accent" /> Change admin password</h2>
        <div className="space-y-3">
          <input type="password" className="input" placeholder="New password (min 6 chars)" value={pw1} onChange={(e) => setPw1(e.target.value)} />
          <input type="password" className="input" placeholder="Confirm new password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <button className="btn btn-primary !text-xs" onClick={changePassword} disabled={busy || !pw1}>{busy ? 'Saving…' : 'Update password'}</button>
        </div>
        <p className="text-[11px] text-ink3 mt-3">Passwords are hashed with SHA-256 in your browser before transmission — the plain text never leaves this device.</p>
      </div>

      <div className="card p-5 mb-4">
        <h2 className="font-display font-semibold text-sm flex items-center gap-2 mb-2"><ShieldCheck size={15} className="text-good" /> Security posture</h2>
        <ul className="text-xs text-ink2 space-y-1.5 list-disc pl-4">
          <li>Sessions expire automatically after 60 minutes.</li>
          <li>Anonymous IDs are the only identifiers — no personal data exists in the database.</li>
          <li>All user input is sanitized server-side; profanity is masked automatically.</li>
          <li>Rate limits: 3 posts/min, 5 comments/30s, 2 polls/2min per anonymous ID.</li>
          <li>AI moderation (Claude Sonnet 4.6) runs when an <code className="font-mono">ANTHROPIC_API_KEY</code> secret is configured; otherwise a built-in heuristic engine is used.</li>
        </ul>
      </div>

      <div className="card p-5 mb-4">
        <ProviderSettings />
      </div>

      <div className="card p-5">
        <h2 className="font-display font-semibold text-sm mb-3">⚙️ Setup & deployment guide</h2>
        <div className="text-xs text-ink2 space-y-3 leading-relaxed">
          <div>
            <p className="font-bold text-ink mb-1">1 · Backend (Supabase)</p>
            <p>This deployment is pre-connected to Supabase Postgres. Tables: <code className="font-mono">posts, comments, reactions, polls, poll_votes, reports, users_meta, chat_threads, chat_messages, activity_logs, settings</code> plus a public <code className="font-mono">voicebox-media</code> storage bucket. Environment variables (already set): <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code>, <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>.</p>
          </div>
          <div>
            <p className="font-bold text-ink mb-1">2 · AI integration (Anthropic)</p>
            <p>Add a secret named <code className="font-mono bg-surface2 px-1 rounded">ANTHROPIC_API_KEY</code> in your deployment environment (Secrets tab). It is used <b>server-side only</b> — never shipped to the browser. Model: <code className="font-mono">claude-sonnet-4-6</code>, called from <code className="font-mono">/api/ai</code> with strict-JSON responses. Without the key, a deterministic heuristic engine keeps all AI features functional.</p>
          </div>
          <div>
            <p className="font-bold text-ink mb-1">3 · Admin password</p>
            <p>Default is <code className="font-mono">admin123</code> — change it above immediately. Passwords are SHA-256 hashed in the browser before transmission and stored only as a hash in the <code className="font-mono">settings</code> table.</p>
          </div>
          <div>
            <p className="font-bold text-ink mb-1">4 · Privacy guarantees</p>
            <p>No analytics, no IP logging, no fingerprinting anywhere in the codebase. User identity = one random ID in localStorage, resettable by the user at any time.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
