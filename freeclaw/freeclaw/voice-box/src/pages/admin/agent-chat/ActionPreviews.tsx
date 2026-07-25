import {
  BarChart3, Eye, EyeOff, TrendingUp, ArrowRight, Lock, Unlock,
  Pin, PinOff, Star, StarOff, Megaphone, X, MessageCircle,
  Trash2, UserCheck, UserX, AlertTriangle, Search, Calendar,
  UserPlus, FileText, Flag, Clock, Zap, Check, Shield, Sparkles,
} from 'lucide-react';
import { safeStringify } from '../../../lib/utils';

/* ═══════════════════════════════════════════════════════════════
   VISUAL PREVIEW COMPONENTS
   Each renders a rich animated mock for its tool type.
   ═══════════════════════════════════════════════════════════════ */

type P = { args: Record<string, unknown> };

/** Animated poll card — shows exactly how the poll will look to users */
export function PollPreview({ args }: P) {
  const options = (args.options as string[]) || ['Yes', 'No'];
  return (
    <div className="vb-action-preview rounded-xl border border-purple-500/25 bg-gradient-to-br from-purple-500/5 via-surface2 to-surface p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center vb-stage-pop">
          <BarChart3 size={13} className="text-purple-400" />
        </div>
        <div className="flex-1">
          <p className="text-[9px] font-mono text-purple-400/70 uppercase tracking-widest">New Poll</p>
        </div>
        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">LIVE</span>
      </div>
      <p className="text-sm font-bold text-ink mb-3">{String(args.title || 'Untitled Poll')}</p>
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-purple-500/15 bg-purple-500/[0.03] vb-slide-in" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="w-5 h-5 rounded-full border-2 border-purple-400/30 flex items-center justify-center shrink-0">
              <div className="w-2 h-2 rounded-full bg-purple-400/0 group-hover:bg-purple-400" />
            </div>
            <span className="text-xs text-ink2 font-medium">{opt}</span>
            <div className="ml-auto flex-1 h-1.5 rounded-full bg-purple-500/10 overflow-hidden">
              <div className="h-full rounded-full bg-purple-400/30 vb-bar-anim" style={{ width: '0%' }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[9px] text-ink3">
        <span>0 votes</span>
        <span>·</span>
        <span>Posted by ADMIN</span>
      </div>
    </div>
  );
}

/** Hide / Unhide post preview */
export function HidePreview({ args }: P) {
  const hidden = args.hidden as boolean;
  return (
    <div className="vb-action-preview rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-amber-500/15 border-2 border-amber-400/30 flex items-center justify-center vb-stage-pop shrink-0">
          {hidden ? <EyeOff size={18} className="text-amber-400" /> : <Eye size={18} className="text-amber-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink truncate">{String(args.title || args.post_id)}</p>
            <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border shrink-0 vb-pop ${
              hidden ? 'bg-amber-500/15 text-amber-400 border-amber-500/25' : 'bg-green-500/15 text-green-400 border-green-500/25'
            }`}>
              {hidden ? 'HIDDEN' : 'VISIBLE'}
            </span>
          </div>
          <p className="text-[11px] text-amber-400/80 mt-0.5">
            {hidden ? 'Post will be hidden from public view' : 'Post will be restored to public view'}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] text-amber-400/70">
        <Shield size={10} />
        <span>{hidden ? 'This action requires admin approval' : 'Post will be visible to all users again'}</span>
      </div>
    </div>
  );
}

/** Set priority preview — shows badge change */
export function PriorityPreview({ args }: P) {
  const p = String(args.priority || 'medium').toLowerCase();
  const colors: Record<string, { bg: string; text: string; border: string; label: string }> = {
    high:   { bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/25',    label: 'HIGH' },
    medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/25', label: 'MEDIUM' },
    low:    { bg: 'bg-green-500/15',  text: 'text-green-400',  border: 'border-green-500/25',  label: 'LOW' },
  };
  const fallback = { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/25', label: 'MEDIUM' };
  const c = colors[p] ?? fallback;
  return (
    <div className="vb-action-preview rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center vb-stage-pop">
          <TrendingUp size={13} className="text-violet-400" />
        </div>
        <p className="text-[9px] font-mono text-violet-400/70 uppercase tracking-widest">Set Priority</p>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-violet-500/5 border border-violet-500/10 vb-slide-in">
        <span className="text-[11px] text-ink2 font-medium truncate">{String(args.title || args.post_id)}</span>
        <ArrowRight size={12} className="text-violet-400/50 shrink-0" />
        <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${c.bg} ${c.text} border ${c.border} font-bold vb-pop`}>
          {c.label}
        </span>
      </div>
    </div>
  );
}

/** Admin reply preview — shows the reply on a post */
export function AdminReplyPreview({ args }: P) {
  return (
    <div className="vb-action-preview rounded-xl border border-teal-500/25 bg-gradient-to-br from-teal-500/5 via-surface2 to-surface p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-teal-500/15 flex items-center justify-center vb-stage-pop">
          <MessageCircle size={13} className="text-teal-400" />
        </div>
        <p className="text-[9px] font-mono text-teal-400/70 uppercase tracking-widest">Admin Reply</p>
      </div>
      <div className="rounded-lg border border-border/60 bg-surface/80 p-3 mb-3">
        <p className="text-[10px] text-ink3 truncate">Post: {String(args.title || args.post_id)}</p>
      </div>
      <div className="flex gap-2.5 vb-slide-in">
        <div className="w-8 h-8 rounded-full bg-teal-500/15 border-2 border-teal-400/30 flex items-center justify-center shrink-0 vb-stage-pop">
          <span className="text-[10px] font-bold text-teal-400">A</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold text-ink">ADMIN</span>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/25">REPLY</span>
          </div>
          <div className="rounded-lg bg-teal-500/5 border border-teal-500/15 p-2.5">
            <p className="text-xs text-ink2 leading-relaxed">{String(args.reply || 'Reply text')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Lock / Unlock post preview */
export function LockPreview({ args }: P) {
  const locked = args.locked as boolean;
  return (
    <div className="vb-action-preview rounded-xl border border-orange-500/25 bg-gradient-to-br from-orange-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center vb-stage-pop shrink-0 ${
          locked ? 'bg-orange-500/15 border-2 border-orange-400/30' : 'bg-green-500/15 border-2 border-green-400/30'
        }`}>
          {locked ? <Lock size={18} className="text-orange-400" /> : <Unlock size={18} className="text-green-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink truncate">{String(args.title || args.post_id)}</p>
            <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border shrink-0 vb-pop ${
              locked ? 'bg-orange-500/15 text-orange-400 border-orange-500/25' : 'bg-green-500/15 text-green-400 border-green-500/25'
            }`}>
              {locked ? 'LOCKED' : 'UNLOCKED'}
            </span>
          </div>
          <p className="text-[11px] text-orange-400/80 mt-0.5">
            {locked ? 'Comments will be disabled' : 'Comments will be re-enabled'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Pin / Unpin post preview */
export function PinPreview({ args }: P) {
  const pinned = args.pinned as boolean;
  return (
    <div className="vb-action-preview rounded-xl border border-pink-500/25 bg-gradient-to-br from-pink-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center vb-stage-pop shrink-0 ${
          pinned ? 'bg-pink-500/15 border-2 border-pink-400/30' : 'bg-slate-500/15 border-2 border-slate-400/30'
        }`}>
          {pinned ? <Pin size={18} className="text-pink-400" /> : <PinOff size={18} className="text-slate-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink truncate">{String(args.title || args.post_id)}</p>
            <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border shrink-0 vb-pop ${
              pinned ? 'bg-pink-500/15 text-pink-400 border-pink-500/25' : 'bg-slate-500/15 text-slate-400 border-slate-500/25'
            }`}>
              {pinned ? 'PINNED' : 'UNPINNED'}
            </span>
          </div>
          <p className="text-[11px] text-pink-400/80 mt-0.5">
            {pinned ? 'Post will appear at the top of the feed' : 'Post will no longer be pinned'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Feature / Unfeature post preview */
export function FeaturePreview({ args }: P) {
  const featured = args.featured as boolean;
  return (
    <div className="vb-action-preview rounded-xl border border-yellow-500/25 bg-gradient-to-br from-yellow-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center vb-stage-pop shrink-0 ${
          featured ? 'bg-yellow-500/15 border-2 border-yellow-400/30' : 'bg-slate-500/15 border-2 border-slate-400/30'
        }`}>
          {featured ? <Star size={18} className="text-yellow-400" /> : <StarOff size={18} className="text-slate-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink truncate">{String(args.title || args.post_id)}</p>
            <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border shrink-0 vb-pop ${
              featured ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' : 'bg-slate-500/15 text-slate-400 border-slate-500/25'
            }`}>
              {featured ? 'FEATURED' : 'NOT FEATURED'}
            </span>
          </div>
          <p className="text-[11px] text-yellow-400/80 mt-0.5">
            {featured ? 'Post will be highlighted on the homepage' : 'Post will no longer be featured'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Ban preview */
export function BanPreview({ args }: P) {
  const userId = String(args.user_id || args.anon_id || args.target_id || 'Unknown');
  return (
    <div className="vb-action-preview rounded-xl border border-red-500/25 bg-gradient-to-br from-red-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-red-500/15 border-2 border-red-400/30 flex items-center justify-center vb-stage-pop">
          <UserX size={20} className="text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink truncate">{userId}</p>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25 shrink-0 vb-pop">BANNED</span>
          </div>
          <p className="text-[11px] text-red-400/80 mt-0.5">Will be blocked from all platform activity</p>
        </div>
      </div>
      {args.reason != null && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10">
          <p className="text-[10px] text-ink3 uppercase tracking-wider mb-0.5">Reason</p>
          <p className="text-xs text-ink2 italic">"{String(args.reason)}"</p>
        </div>
      )}
    </div>
  );
}

/** Unban preview */
export function UnbanPreview({ args }: P) {
  const userId = String(args.user_id || args.anon_id || args.target_id || 'Unknown');
  return (
    <div className="vb-action-preview rounded-xl border border-green-500/25 bg-gradient-to-br from-green-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-green-500/15 border-2 border-green-400/30 flex items-center justify-center vb-stage-pop">
          <UserCheck size={20} className="text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink truncate">{userId}</p>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25 shrink-0 vb-pop">RESTORED</span>
          </div>
          <p className="text-[11px] text-green-400/80 mt-0.5">Posting privileges will be restored</p>
        </div>
      </div>
    </div>
  );
}

/** Warn preview */
export function WarnPreview({ args }: P) {
  const userId = String(args.user_id || args.anon_id || args.target_id || 'Unknown');
  return (
    <div className="vb-action-preview rounded-xl border border-orange-500/25 bg-gradient-to-br from-orange-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-orange-500/15 border-2 border-orange-400/30 flex items-center justify-center vb-stage-pop">
          <AlertTriangle size={20} className="text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink truncate">{userId}</p>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/25 shrink-0">WARNING</span>
          </div>
          <p className="text-[11px] text-orange-400/80 mt-0.5">Will receive an official warning</p>
        </div>
      </div>
      {args.reason != null && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-orange-500/5 border border-orange-500/10">
          <p className="text-[10px] text-ink3 uppercase tracking-wider mb-0.5">Warning reason</p>
          <p className="text-xs text-ink2 italic">"{String(args.reason)}"</p>
        </div>
      )}
    </div>
  );
}

/** Delete post preview */
export function DeletePostPreview({ args }: P) {
  return (
    <div className="vb-action-preview rounded-xl border border-red-500/25 bg-gradient-to-br from-red-500/5 via-surface2 to-surface p-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-red-500/15 border-2 border-red-400/30 flex items-center justify-center vb-stage-pop shrink-0">
          <Trash2 size={18} className="text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-ink">Post will be deleted</p>
          <p className="text-[11px] text-red-400/80 mt-0.5">Soft-deleted — hidden from public view</p>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-ink3">
            <span className="font-mono">ID: {String(args.post_id || args.target_id || '—')}</span>
          </div>
        </div>
      </div>
      {args.reason != null && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10">
          <p className="text-[10px] text-ink3 uppercase tracking-wider mb-0.5">Reason</p>
          <p className="text-xs text-ink2 italic">"{String(args.reason)}"</p>
        </div>
      )}
    </div>
  );
}

/** Announcement preview — shows how the banner will look */
export function AnnouncementPreview({ args }: P) {
  const text = String(args.message || args.text || args.content || 'New announcement');
  return (
    <div className="vb-action-preview rounded-xl border border-yellow-500/25 bg-gradient-to-br from-yellow-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-yellow-500/15 flex items-center justify-center vb-stage-pop">
          <Megaphone size={13} className="text-yellow-400" />
        </div>
        <p className="text-[9px] font-mono text-yellow-400/70 uppercase tracking-widest">Site Announcement</p>
      </div>
      <div className="rounded-lg bg-yellow-500/8 border border-yellow-500/15 p-3 vb-slide-in">
        <div className="flex items-center gap-2">
          <Megaphone size={14} className="text-yellow-400 shrink-0" />
          <p className="text-xs text-ink font-medium leading-relaxed">{text}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-yellow-400/60">This banner will appear at the top of the site for all visitors</p>
    </div>
  );
}

/** Clear announcement preview */
export function ClearAnnouncePreview() {
  return (
    <div className="vb-action-preview rounded-xl border border-red-500/25 bg-gradient-to-br from-red-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center vb-stage-pop">
          <X size={13} className="text-red-400" />
        </div>
        <p className="text-[9px] font-mono text-red-400/70 uppercase tracking-widest">Clear Announcement</p>
      </div>
      <div className="rounded-lg bg-red-500/5 border border-red-500/15 p-3 vb-slide-in">
        <div className="flex items-center gap-2">
          <Megaphone size={14} className="text-red-400/40 shrink-0" />
          <p className="text-xs text-ink2 line-through opacity-50">Current announcement will be removed</p>
          <X size={12} className="text-red-400/60 shrink-0 ml-auto" />
        </div>
      </div>
      <p className="mt-2 text-[10px] text-red-400/60">Announcement banner will no longer appear on the site</p>
    </div>
  );
}

/** Comment preview — shows how the admin comment will appear on the post */
export function CommentPreview({ args }: P) {
  return (
    <div className="vb-action-preview rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 via-surface2 to-surface p-4 overflow-hidden">
      <div className="rounded-lg border border-border/60 bg-surface/80 p-3 mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-5 h-5 rounded-full bg-accent/15 flex items-center justify-center vb-stage-pop">
            <Eye size={10} className="text-accent" />
          </div>
          <span className="text-[9px] font-mono text-ink3 uppercase tracking-wider">Post</span>
          <span className="text-[8px] font-mono text-ink3/60 ml-auto">{String(args.post_id || '—')}</span>
        </div>
        <p className="text-[10px] text-ink3 truncate">This is the post the comment will appear on</p>
      </div>
      <div className="flex gap-2.5 vb-slide-in">
        <div className="w-8 h-8 rounded-full bg-emerald-500/15 border-2 border-emerald-400/30 flex items-center justify-center shrink-0 vb-stage-pop">
          <span className="text-[10px] font-bold text-emerald-400">A</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold text-ink">ADMIN</span>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">OFFICIAL</span>
            <span className="text-[9px] text-ink3 ml-auto">just now</span>
          </div>
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-2.5">
            <p className="text-xs text-ink2 leading-relaxed">{String(args.body || args.message || 'Comment text')}</p>
          </div>
        </div>
      </div>
      <p className="mt-2.5 text-[10px] text-emerald-400/60">Admin comment will be posted publicly with the ADMIN badge</p>
    </div>
  );
}

/** Update post preview — shows the status/priority change */
export function UpdatePostPreview({ args }: P) {
  const changes = Object.entries(args).filter(([k]) => k !== 'post_id' && k !== 'reason');
  return (
    <div className="vb-action-preview rounded-xl border border-yellow-500/25 bg-gradient-to-br from-yellow-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-yellow-500/15 flex items-center justify-center vb-stage-pop">
          <TrendingUp size={13} className="text-yellow-400" />
        </div>
        <p className="text-[9px] font-mono text-yellow-400/70 uppercase tracking-widest">Update Post</p>
        <span className="text-[8px] font-mono text-ink3 ml-auto">{String(args.post_id || '—')}</span>
      </div>
      <div className="space-y-2">
        {changes.map(([key, val], i) => (
          <div key={key} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-yellow-500/5 border border-yellow-500/10 vb-slide-in" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="text-[10px] font-mono text-ink3 uppercase w-16 shrink-0">{key}</span>
            <ArrowRight size={10} className="text-yellow-400/50 shrink-0" />
            <span className="text-xs text-ink font-medium">{String(val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** ETA preview — shows the time estimate changing */
export function ETAPreview({ args }: P) {
  return (
    <div className="vb-action-preview rounded-xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center vb-stage-pop">
          <Calendar size={13} className="text-indigo-400" />
        </div>
        <p className="text-[9px] font-mono text-indigo-400/70 uppercase tracking-widest">Set ETA</p>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-indigo-500/5 border border-indigo-500/10 vb-slide-in">
        <Clock size={14} className="text-indigo-400 shrink-0" />
        <span className="text-[11px] text-ink2 font-medium truncate">{String(args.title || args.post_id)}</span>
        <ArrowRight size={12} className="text-indigo-400/50 shrink-0" />
        <span className="text-[11px] text-indigo-400 font-bold">{String(args.eta || 'TBD')}</span>
      </div>
    </div>
  );
}

/** Assign preview — shows post being assigned to someone */
export function AssignPreview({ args }: P) {
  return (
    <div className="vb-action-preview rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center vb-stage-pop">
          <UserPlus size={13} className="text-emerald-400" />
        </div>
        <p className="text-[9px] font-mono text-emerald-400/70 uppercase tracking-widest">Assign Post</p>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 vb-slide-in">
        <span className="text-[11px] text-ink2 font-medium truncate">{String(args.title || args.post_id)}</span>
        <ArrowRight size={12} className="text-emerald-400/50 shrink-0" />
        <span className="text-[11px] text-emerald-400 font-bold">{String(args.assigned_to || '—')}</span>
      </div>
    </div>
  );
}

/** Presentation preview — shows a mini slide deck mockup */
export function PresentationPreview({ args }: P) {
  const periodLabel = args.period === 'week' ? 'This Week' : args.period === 'month' ? 'This Month' : args.period === 'day' ? 'Today' : 'All Time';
  const postIds = args.post_ids as unknown[] | undefined;
  const slideCount = Math.min((postIds?.length || 5) + 3, 18);
  return (
    <div className="vb-action-preview rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-500/5 via-surface2 to-surface p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center vb-stage-pop">
          <FileText size={13} className="text-amber-400" />
        </div>
        <p className="text-[9px] font-mono text-amber-400/70 uppercase tracking-widest">Presentation Generator</p>
      </div>
      <div className="vb-slide-in rounded-lg bg-gradient-to-br from-amber-500/10 via-surface2 to-surface border border-amber-500/15 p-3 mb-2">
        <div className="text-[8px] font-mono text-amber-400/50 uppercase tracking-widest mb-1">ADMIN REPORT</div>
        <p className="text-xs font-semibold text-ink1 truncate">{String(args.topic || 'Weekly Problems Report')}</p>
        <p className="text-[10px] text-ink3 mt-0.5">{periodLabel} · {slideCount} slides</p>
      </div>
      <div className="flex gap-1.5 overflow-hidden">
        {Array.from({ length: Math.min(slideCount, 8) }, (_, i) => {
          const isTitle = i === 0;
          const isChart = i === 1;
          const isAction = i >= slideCount - 2 && i < slideCount - 1;
          const isClose = i === slideCount - 1;
          return (
            <div key={i} className="vb-stage-pop shrink-0 rounded border border-amber-500/10 bg-surface2/60 flex flex-col items-center justify-center overflow-hidden" style={{ width: '32px', height: '22px', animationDelay: `${i * 60}ms` }}>
              {isTitle ? (
                <div className="w-full h-full bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center">
                  <div className="w-4 h-0.5 bg-amber-400/30 rounded" />
                </div>
              ) : isChart ? (
                <div className="w-full h-full bg-surface p-0.5 flex items-end gap-px">
                  {[40, 70, 55, 85, 30].map((h, j) => (
                    <div key={j} className="flex-1 bg-amber-400/30 rounded-t" style={{ height: `${h}%` }} />
                  ))}
                </div>
              ) : isAction ? (
                <div className="w-full h-full bg-surface p-0.5 space-y-px">
                  {[1, 2, 3].map((j) => (
                    <div key={j} className="h-1 rounded bg-amber-400/15" style={{ width: `${50 + j * 12}%` }} />
                  ))}
                </div>
              ) : isClose ? (
                <div className="w-full h-full bg-gradient-to-br from-amber-500/15 to-amber-500/5 flex items-center justify-center">
                  <Check size={6} className="text-amber-400/50" />
                </div>
              ) : (
                <div className="w-full h-full bg-surface p-0.5 space-y-px">
                  <div className="h-1 rounded bg-ink2/10" style={{ width: '60%' }} />
                  <div className="h-0.5 rounded bg-ink2/5" style={{ width: '80%' }} />
                  <div className="h-0.5 rounded bg-ink2/5" style={{ width: '45%' }} />
                </div>
              )}
            </div>
          );
        })}
        {slideCount > 8 && (
          <div className="shrink-0 w-8 h-[22px] rounded border border-amber-500/10 bg-surface2/60 flex items-center justify-center">
            <span className="text-[7px] text-ink3">+{slideCount - 8}</span>
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] text-amber-400/60">
        Opens as full-screen HTML slide deck · ← → keyboard nav
      </p>
    </div>
  );
}

/** Meta-agent / data generation preview */
export function MetaAgentPreview({ args }: P) {
  const query = String(args.query || args.message || args.request || '');
  return (
    <div className="vb-action-preview rounded-xl border border-teal-500/25 bg-gradient-to-br from-teal-500/5 via-surface2 to-surface p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-teal-500/15 flex items-center justify-center vb-stage-pop">
          <Sparkles size={13} className="text-teal-400" />
        </div>
        <p className="text-[9px] font-mono text-teal-400/70 uppercase tracking-widest">Meta-Agent Coordinator</p>
      </div>
      <div className="rounded-lg bg-teal-500/5 border border-teal-500/15 p-3 mb-2 vb-slide-in">
        <p className="text-[10px] text-ink3 uppercase tracking-wider mb-0.5">Request</p>
        <p className="text-xs text-ink2 font-medium">{query}</p>
      </div>
      <div className="flex gap-2 mb-2">
        <div className="flex-1 rounded-lg bg-teal-500/5 border border-teal-500/10 p-2 text-center vb-stage-pop" style={{ animationDelay: '100ms' }}>
          <p className="text-[8px] font-mono text-teal-400/60 uppercase">Researcher</p>
          <p className="text-[9px] text-ink3">Search & gather data</p>
        </div>
        <div className="flex-1 rounded-lg bg-teal-500/5 border border-teal-500/10 p-2 text-center vb-stage-pop" style={{ animationDelay: '200ms' }}>
          <p className="text-[8px] font-mono text-teal-400/60 uppercase">Builder</p>
          <p className="text-[9px] text-ink3">Execute & export</p>
        </div>
        <div className="flex-1 rounded-lg bg-teal-500/5 border border-teal-500/10 p-2 text-center vb-stage-pop" style={{ animationDelay: '300ms' }}>
          <p className="text-[8px] font-mono text-teal-400/60 uppercase">Analyzer</p>
          <p className="text-[9px] text-ink3">Score & prioritize</p>
        </div>
      </div>
      <p className="text-[10px] text-teal-400/60">Spawns subagents in parallel · Builds custom tools if needed</p>
    </div>
  );
}

/** CSV / data export preview */
export function CSVPreview({ args, result }: P & { result?: { success: boolean; data?: { csv?: string; row_count?: number } } }) {
  const rows = args.row_count || result?.data?.row_count || '?';
  const cols = (args.columns as unknown[] | undefined)?.length || '?';
  return (
    <div className="vb-action-preview rounded-xl border border-teal-500/25 bg-gradient-to-br from-teal-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-teal-500/15 flex items-center justify-center vb-stage-pop">
          <FileText size={13} className="text-teal-400" />
        </div>
        <p className="text-[9px] font-mono text-teal-400/70 uppercase tracking-widest">CSV Export</p>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-teal-500/5 border border-teal-500/10 vb-slide-in">
        <FileText size={14} className="text-teal-400 shrink-0" />
        <div className="flex-1">
          <p className="text-xs text-ink font-medium">{String(args.filename || 'export.csv')}</p>
          <p className="text-[10px] text-ink3">{String(rows)} rows × {String(cols)} columns</p>
        </div>
        {result?.success && result.data?.csv && (
          <a
            href={`data:text/csv;base64,${btoa(result.data.csv)}`}
            download={String(args.filename || 'export.csv')}
            className="text-[10px] text-teal-400 underline hover:text-teal-300"
          >
            Download
          </a>
        )}
      </div>
      {result?.success && (
        <p className="mt-2 text-[10px] text-green-400/70">✓ CSV generated — click Download to save</p>
      )}
    </div>
  );
}

/** Health/trend analysis preview */
export function TrendAnalysisPreview({ args: _args }: P) {
  return (
    <div className="vb-action-preview rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center vb-stage-pop">
          <TrendingUp size={13} className="text-violet-400" />
        </div>
        <p className="text-[9px] font-mono text-violet-400/70 uppercase tracking-widest">Trend Analysis</p>
      </div>
      <div className="space-y-2">
        {['Engagement', 'Growth', 'Sentiment'].map((label, i) => (
          <div key={label} className="flex items-center gap-2" style={{ animationDelay: `${i * 100}ms` }}>
            <span className="text-[10px] text-ink3 w-16">{label}</span>
            <div className="flex-1 h-3 rounded-full bg-violet-500/10 overflow-hidden">
              <div className="h-full rounded-full bg-violet-400/40 vb-bar-anim" style={{ width: `${40 + i * 18}%`, animationDelay: `${i * 150}ms` }} />
            </div>
            <TrendingUp size={10} className="text-violet-400/50 vb-trend-bounce" style={{ animationDelay: `${i * 200}ms` }} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-violet-400/60">Analyzing platform health and engagement trends…</p>
    </div>
  );
}

/** Analytics preview */
export function AnalyticsPreview() {
  return (
    <div className="vb-action-preview rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-cyan-500/15 flex items-center justify-center vb-stage-pop">
          <BarChart3 size={13} className="text-cyan-400" />
        </div>
        <p className="text-[9px] font-mono text-cyan-400/70 uppercase tracking-widest">Fetching Analytics</p>
      </div>
      <div className="space-y-2">
        {['Posts', 'Users', 'Comments', 'Reactions'].map((label, i) => (
          <div key={label} className="flex items-center gap-2" style={{ animationDelay: `${i * 100}ms` }}>
            <span className="text-[10px] text-ink3 w-16">{label}</span>
            <div className="flex-1 h-3 rounded-full bg-cyan-500/10 overflow-hidden">
              <div className="h-full rounded-full bg-cyan-400/40 vb-bar-anim" style={{ width: `${30 + i * 20}%`, animationDelay: `${i * 150}ms` }} />
            </div>
            <Zap size={10} className="text-cyan-400/50 vb-trend-bounce" style={{ animationDelay: `${i * 200}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Reports preview */
export function ReportsPreview() {
  return (
    <div className="vb-action-preview rounded-xl border border-red-500/25 bg-gradient-to-br from-red-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center vb-stage-pop">
          <Flag size={13} className="text-red-400" />
        </div>
        <p className="text-[9px] font-mono text-red-400/70 uppercase tracking-widest">Pending Reports</p>
      </div>
      <div className="space-y-1.5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-red-500/5 border border-red-500/10 vb-slide-in" style={{ animationDelay: `${i * 80}ms` }}>
            <Flag size={10} className="text-red-400/50" />
            <div className="flex-1 h-2 rounded-full bg-red-500/10" style={{ width: `${40 + i * 15}%` }} />
            <span className="text-[9px] text-ink3">#{i}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-red-400/60">Loading reported content for review…</p>
    </div>
  );
}

/** User search preview */
export function UserSearchPreview({ args }: P) {
  return (
    <div className="vb-action-preview rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-cyan-500/15 flex items-center justify-center vb-stage-pop">
          <Search size={13} className="text-cyan-400" />
        </div>
        <p className="text-[9px] font-mono text-cyan-400/70 uppercase tracking-widest">Search Users</p>
      </div>
      <div className="px-3 py-2 rounded-lg bg-cyan-500/5 border border-cyan-500/10 vb-slide-in">
        <p className="text-xs text-ink2">Query: "<span className="font-medium text-cyan-400">{String(args.query || '—')}</span>"</p>
      </div>
      <p className="mt-2 text-[10px] text-cyan-400/60">Searching user database for matching anonymous IDs…</p>
    </div>
  );
}

/** Generic parameter preview */
export function GenericPreview({ args }: P) {
  return (
    <div className="rounded-lg bg-surface2/60 border border-border p-2.5">
      <p className="text-[10px] font-mono text-ink3 uppercase tracking-wider mb-1">Parameters</p>
      <pre className="text-[10px] font-mono text-ink2 whitespace-pre-wrap break-all">
        {safeStringify(args, 2)}
      </pre>
    </div>
  );
}

/* ── Preview router — picks the right component by tool name ── */
export function getToolPreview(tool: string, args: Record<string, unknown>, result?: { success: boolean; data?: unknown }) {
  switch (tool) {
    case 'create_poll':         return <PollPreview args={args} />;
    case 'ban_user':            return <BanPreview args={args} />;
    case 'unban_user':          return <UnbanPreview args={args} />;
    case 'warn_user':           return <WarnPreview args={args} />;
    case 'delete_post':         return <DeletePostPreview args={args} />;
    case 'set_announcement':    return <AnnouncementPreview args={args} />;
    case 'get_analytics':       return <AnalyticsPreview />;
    case 'get_reports':         return <ReportsPreview />;
    case 'create_comment':      return <CommentPreview args={args} />;
    case 'update_post':         return <UpdatePostPreview args={args} />;
    case 'hide_post':           return <HidePreview args={args} />;
    case 'set_priority':        return <PriorityPreview args={args} />;
    case 'admin_reply':         return <AdminReplyPreview args={args} />;
    case 'lock_post':           return <LockPreview args={args} />;
    case 'pin_post':            return <PinPreview args={args} />;
    case 'feature_post':        return <FeaturePreview args={args} />;
    case 'search_users':        return <UserSearchPreview args={args} />;
    case 'clear_announcement':  return <ClearAnnouncePreview />;
    case 'set_eta':             return <ETAPreview args={args} />;
    case 'assign_post':         return <AssignPreview args={args} />;
    case 'generate_csv':        return <CSVPreview args={args} result={result as { success: boolean; data?: { csv?: string; row_count?: number } } | undefined} />;
    case 'bulk_update':         return <MetaAgentPreview args={{ query: `Bulk update: ${safeStringify(args)}` }} />;
    case 'generate_summary':    return <TrendAnalysisPreview args={args} />;
    case 'search_content':      return <MetaAgentPreview args={{ query: String(args.query || args.keyword || 'Search content') }} />;
    case 'trend_analysis':      return <TrendAnalysisPreview args={args} />;
    default:                    return <GenericPreview args={args} />;
  }
}
