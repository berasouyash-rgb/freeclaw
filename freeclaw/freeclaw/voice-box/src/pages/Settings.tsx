// ─── User Settings Page ──────────────────────────────────────────
// Allows users to manage notification preferences, display settings,
// and account options like resetting their anonymous identity.
import { useState } from 'react';
import {
  Settings as SettingsIcon, Bell, Eye, Shield, RotateCcw,
  Trash2, Download, Check, Moon, Sun, Monitor,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { resetTutorial } from '../components/Tutorial';
import { resetAnonId, clearAllLocalData } from '../lib/identity';
import { ConfirmDialog } from '../components/ui';

type SettingsTab = 'notifications' | 'display' | 'account' | 'privacy';

export default function Settings() {
  const { anonId, toast, refreshIdentity, notifications: _notifications, bookmarks, recentlyViewed } = useApp();
  const [tab, setTab] = useState<SettingsTab>('notifications');
  const [dialog, setDialog] = useState<'resetId' | 'clearData' | 'resetTutorial' | null>(null);

  // Notification preferences (stored in localStorage)
  const [notifPrefs, setNotifPrefs] = useState(() => {
    try {
      const raw = localStorage.getItem('vb:notif-prefs');
      return raw ? JSON.parse(raw) : { push: true, email: false, sound: true, mentions: true, replies: true, updates: false };
    } catch {
      return { push: true, email: false, sound: true, mentions: true, replies: true, updates: false };
    }
  });

  // Display preferences
  const [displayPrefs, setDisplayPrefs] = useState(() => {
    try {
      const raw = localStorage.getItem('vb:display-prefs');
      return raw ? JSON.parse(raw) : { theme: 'system', compactMode: false, showAvatars: true, animationsEnabled: true };
    } catch {
      return { theme: 'system', compactMode: false, showAvatars: true, animationsEnabled: true };
    }
  });

  const saveNotifPrefs = (prefs: typeof notifPrefs) => {
    setNotifPrefs(prefs);
    localStorage.setItem('vb:notif-prefs', JSON.stringify(prefs));
    toast('Notification preferences saved', 'ok');
  };

  const saveDisplayPrefs = (prefs: typeof displayPrefs) => {
    setDisplayPrefs(prefs);
    localStorage.setItem('vb:display-prefs', JSON.stringify(prefs));
    toast('Display preferences saved', 'ok');
  };

  const handleResetId = () => {
    resetAnonId();
    refreshIdentity();
    toast('Anonymous ID reset. You now have a new identity.', 'ok');
    setDialog(null);
  };

  const handleClearData = () => {
    clearAllLocalData();
    toast('All local data cleared', 'ok');
    setDialog(null);
  };

  const handleResetTutorial = () => {
    resetTutorial();
    toast('Tutorial will show again on next visit', 'ok');
    setDialog(null);
  };

  const tabs: { key: SettingsTab; label: string; icon: typeof Bell }[] = [
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'display', label: 'Display', icon: Eye },
    { key: 'account', label: 'Account', icon: Shield },
    { key: 'privacy', label: 'Privacy', icon: Shield },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 vb-page-enter">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <SettingsIcon size={20} className="text-accent" />
        </div>
        <div>
          <h1 className="font-display font-bold text-xl">Settings</h1>
          <p className="text-sm text-ink3">Manage your preferences and account</p>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Tab sidebar */}
        <nav className="w-48 flex-shrink-0 space-y-1">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all ${
                tab === key
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-ink3 hover:text-ink hover:bg-surface2'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* ── Notifications Tab ─────────────────────────── */}
          {tab === 'notifications' && (
            <div className="space-y-6">
              <Section title="Notification Preferences" desc="Control how and when you receive notifications" />
              <ToggleRow
                label="Push notifications"
                desc="Receive browser push notifications for new activity"
                checked={notifPrefs.push}
                onChange={(v) => saveNotifPrefs({ ...notifPrefs, push: v })}
              />
              <ToggleRow
                label="Sound alerts"
                desc="Play a sound when notifications arrive"
                checked={notifPrefs.sound}
                onChange={(v) => saveNotifPrefs({ ...notifPrefs, sound: v })}
              />
              <ToggleRow
                label="Mentions"
                desc="Get notified when someone mentions you"
                checked={notifPrefs.mentions}
                onChange={(v) => saveNotifPrefs({ ...notifPrefs, mentions: v })}
              />
              <ToggleRow
                label="Replies"
                desc="Get notified when someone replies to your posts"
                checked={notifPrefs.replies}
                onChange={(v) => saveNotifPrefs({ ...notifPrefs, replies: v })}
              />
              <ToggleRow
                label="System updates"
                desc="Receive notifications about platform updates and changes"
                checked={notifPrefs.updates}
                onChange={(v) => saveNotifPrefs({ ...notifPrefs, updates: v })}
              />
              <ToggleRow
                label="Email notifications"
                desc="Receive digest emails (requires email in the future)"
                checked={notifPrefs.email}
                onChange={(v) => saveNotifPrefs({ ...notifPrefs, email: v })}
              />
            </div>
          )}

          {/* ── Display Tab ───────────────────────────────── */}
          {tab === 'display' && (
            <div className="space-y-6">
              <Section title="Display Settings" desc="Customize how Voice Box looks and feels" />

              {/* Theme selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Theme</label>
                <p className="text-xs text-ink3">Choose your preferred color scheme</p>
                <div className="flex gap-2 mt-2">
                  {([
                    { value: 'dark', label: 'Dark', icon: Moon },
                    { value: 'light', label: 'Light', icon: Sun },
                    { value: 'system', label: 'System', icon: Monitor },
                  ] as const).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => saveDisplayPrefs({ ...displayPrefs, theme: value })}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${
                        displayPrefs.theme === value
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border hover:border-accent/30 text-ink3'
                      }`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <ToggleRow
                label="Compact mode"
                desc="Reduce spacing and padding for a denser layout"
                checked={displayPrefs.compactMode}
                onChange={(v) => saveDisplayPrefs({ ...displayPrefs, compactMode: v })}
              />
              <ToggleRow
                label="Show avatars"
                desc="Display user avatars next to posts and comments"
                checked={displayPrefs.showAvatars}
                onChange={(v) => saveDisplayPrefs({ ...displayPrefs, showAvatars: v })}
              />
              <ToggleRow
                label="Animations"
                desc="Enable smooth transitions and motion effects"
                checked={displayPrefs.animationsEnabled}
                onChange={(v) => saveDisplayPrefs({ ...displayPrefs, animationsEnabled: v })}
              />
            </div>
          )}

          {/* ── Account Tab ───────────────────────────────── */}
          {tab === 'account' && (
            <div className="space-y-6">
              <Section title="Account Settings" desc="Manage your anonymous identity and data" />

              {/* Identity info */}
              <div className="p-4 rounded-xl border border-border bg-surface2/50">
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={14} className="text-accent" />
                  <span className="text-sm font-medium text-ink">Anonymous Identity</span>
                </div>
                <p className="text-xs text-ink3 mb-2">
                  Your anonymous ID: <code className="font-mono text-accent bg-accent/5 px-1.5 py-0.5 rounded">{anonId}</code>
                </p>
                <p className="text-xs text-ink3">
                  This ID is stored locally in your browser and is used to identify your posts, comments, and votes.
                  No personal information is collected.
                </p>
              </div>

              {/* Action rows */}
              <ActionRow
                icon={RotateCcw}
                label="Reset anonymous ID"
                desc="Generate a new anonymous identity. Your old posts will remain but won't be linked to you."
                action="Reset ID"
                onClick={() => setDialog('resetId')}
                variant="warning"
              />
              <ActionRow
                icon={RotateCcw}
                label="Show tutorial again"
                desc="Re-enable the onboarding tutorial for next visit"
                action="Reset"
                onClick={() => setDialog('resetTutorial')}
                variant="default"
              />
              <ActionRow
                icon={Download}
                label="Export your data"
                desc="Download all your posts, comments, and votes as JSON"
                action="Export"
                onClick={() => {
                  const data = {
                    anonymous_id: anonId,
                    exported_at: new Date().toISOString(),
                    bookmarks,
                    recently_viewed: recentlyViewed,
                    notification_prefs: notifPrefs,
                    display_prefs: displayPrefs,
                  };
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `voicebox-data-${anonId.slice(0, 8)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast('Data exported', 'ok');
                }}
                variant="default"
              />
              <ActionRow
                icon={Trash2}
                label="Clear all local data"
                desc="Remove all local data including bookmarks, recently viewed, and preferences"
                action="Clear Data"
                onClick={() => setDialog('clearData')}
                variant="danger"
              />
            </div>
          )}

          {/* ── Privacy Tab ───────────────────────────────── */}
          {tab === 'privacy' && (
            <div className="space-y-6">
              <Section title="Privacy Settings" desc="Control your privacy and data sharing" />

              <div className="p-4 rounded-xl border border-border bg-surface2/50 space-y-3">
                <h3 className="text-sm font-medium text-ink">Anonymous by Design</h3>
                <p className="text-xs text-ink3 leading-relaxed">
                  Voice Box is built for anonymous participation. Here's what we collect and don't collect:
                </p>
                <ul className="text-xs text-ink3 space-y-2">
                  <li className="flex items-start gap-2">
                    <Check size={12} className="text-good mt-0.5 flex-shrink-0" />
                    <span><strong className="text-ink">Collected:</strong> Posts, comments, votes, and reactions (linked to anonymous ID only)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check size={12} className="text-good mt-0.5 flex-shrink-0" />
                    <span><strong className="text-ink">Not collected:</strong> Names, emails, IP addresses, device fingerprints, browsing history</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check size={12} className="text-good mt-0.5 flex-shrink-0" />
                    <span><strong className="text-ink">No tracking:</strong> No analytics, no third-party cookies, no advertising scripts</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check size={12} className="text-good mt-0.5 flex-shrink-0" />
                    <span><strong className="text-ink">Your data:</strong> Export or delete anytime. Reset your ID to disconnect your history.</span>
                  </li>
                </ul>
              </div>

              <div className="p-4 rounded-xl border border-border bg-surface2/50">
                <h3 className="text-sm font-medium text-ink mb-2">Data Retention</h3>
                <p className="text-xs text-ink3 leading-relaxed">
                  Posts and comments are retained indefinitely unless you delete them. Anonymous IDs are
                  stored in your browser's localStorage and never leave your device. Server-side data
                  contains no personally identifiable information.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-border bg-surface2/50">
                <h3 className="text-sm font-medium text-ink mb-2">Open Source</h3>
                <p className="text-xs text-ink3 leading-relaxed">
                  Voice Box is open source. You can audit the code to verify our privacy claims.
                  No hidden telemetry, no sneaky data collection.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm dialogs */}
      {dialog === 'resetId' && (
        <ConfirmDialog
          open
          title="Reset Anonymous ID?"
          message="This will generate a new anonymous identity. Your old posts will remain visible but won't be linked to your new ID. This action cannot be undone."
          confirmLabel="Reset ID"
          onConfirm={handleResetId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'clearData' && (
        <ConfirmDialog
          open
          title="Clear All Local Data?"
          message="This will remove all bookmarks, recently viewed posts, notification preferences, display settings, and tutorial state. Your posts and comments on the server will not be affected."
          confirmLabel="Clear Data"
          onConfirm={handleClearData}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'resetTutorial' && (
        <ConfirmDialog
          open
          title="Reset Tutorial?"
          message="The onboarding tutorial will show again on your next page visit."
          confirmLabel="Reset"
          onConfirm={handleResetTutorial}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/* ─── Helper components ──────────────────────────────────────────── */
function Section({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="pb-4 border-b border-border">
      <h2 className="font-display font-bold text-base text-ink">{title}</h2>
      <p className="text-xs text-ink3 mt-0.5">{desc}</p>
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/50">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink3 mt-0.5">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
          checked ? 'bg-accent' : 'bg-surface2 border border-border'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  );
}

function ActionRow({ icon: Icon, label, desc, action, onClick, variant }: {
  icon: typeof RotateCcw; label: string; desc: string; action: string; onClick: () => void; variant: 'default' | 'warning' | 'danger';
}) {
  const colors = {
    default: 'text-accent hover:bg-accent/5',
    warning: 'text-amber-400 hover:bg-amber-400/5',
    danger: 'text-red-400 hover:bg-red-400/5',
  };
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/50">
      <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
        <Icon size={16} className="text-ink3 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="text-xs text-ink3 mt-0.5">{desc}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        className={`btn !text-xs !px-3 !py-1.5 flex-shrink-0 transition-all ${colors[variant]}`}
      >
        {action}
      </button>
    </div>
  );
}
