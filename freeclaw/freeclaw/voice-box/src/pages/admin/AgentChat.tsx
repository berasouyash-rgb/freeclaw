import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, PlayCircle, Check, X, AlertTriangle,
  Loader2, Trash2, ArrowRight, UserX, UserCheck, BarChart3,
  Megaphone, Eye, EyeOff, TrendingUp, Flag, Clock, Ban, Zap, Sparkles,
  Shield, CheckCircle2, XCircle, ExternalLink, PartyPopper,
  MessageCircle, FileText, Pin, PinOff, Star, StarOff,
  Lock, Unlock, Search, Calendar, UserPlus, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../contexts/AppContext';

/* ── Types ─────────────────────────────────────────────────── */
interface Action {
  id: string;
  tool: string;
  args: Record<string, any>;
  reason: string;
  destructive: boolean;
  result?: { success: boolean; error?: string; data?: any };
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  actions?: Action[];
  provider?: string;
  model?: string;
  created_at: string;
}

/* ── Tool metadata ─────────────────────────────────────────── */
const TOOL_META: Record<string, {
  label: string;
  icon: typeof Eye;
  color: string;
  bgColor: string;
  borderColor: string;
  accentColor: string;
  redirectTab?: string;
}> = {
  get_posts:          { label: 'View posts',          icon: Eye,          color: 'text-blue-400',   bgColor: 'bg-blue-500/10',   borderColor: 'border-blue-500/20',   accentColor: 'blue',    redirectTab: 'posts' },
  update_post:        { label: 'Update post',         icon: TrendingUp,   color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/20', accentColor: 'yellow',  redirectTab: 'posts' },
  delete_post:        { label: 'Delete post',         icon: Trash2,       color: 'text-red-400',    bgColor: 'bg-red-500/10',    borderColor: 'border-red-500/20',    accentColor: 'red',     redirectTab: 'posts' },
  warn_user:          { label: 'Warn user',           icon: AlertTriangle,color: 'text-orange-400', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/20', accentColor: 'orange',  redirectTab: 'users' },
  ban_user:           { label: 'Ban user',            icon: Ban,          color: 'text-red-400',    bgColor: 'bg-red-500/10',    borderColor: 'border-red-500/20',    accentColor: 'red',     redirectTab: 'users' },
  unban_user:         { label: 'Unban user',          icon: UserCheck,    color: 'text-green-400',  bgColor: 'bg-green-500/10',  borderColor: 'border-green-500/20',  accentColor: 'green',   redirectTab: 'users' },
  get_user_posts:     { label: 'User posts',          icon: Eye,          color: 'text-blue-400',   bgColor: 'bg-blue-500/10',   borderColor: 'border-blue-500/20',   accentColor: 'blue',    redirectTab: 'posts' },
  create_poll:        { label: 'Create poll',         icon: BarChart3,    color: 'text-purple-400', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/20', accentColor: 'purple',  redirectTab: 'polls' },
  close_poll:         { label: 'Close poll',          icon: BarChart3,    color: 'text-orange-400', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/20', accentColor: 'orange',  redirectTab: 'polls' },
  get_analytics:      { label: 'Analytics',           icon: BarChart3,    color: 'text-cyan-400',   bgColor: 'bg-cyan-500/10',   borderColor: 'border-cyan-500/20',   accentColor: 'cyan',    redirectTab: 'overview' },
  get_activity_logs:  { label: 'Activity logs',       icon: Clock,        color: 'text-slate-400',  bgColor: 'bg-slate-500/10',  borderColor: 'border-slate-500/20',  accentColor: 'slate',   redirectTab: 'logs' },
  set_announcement:   { label: 'Set announcement',    icon: Megaphone,    color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/20', accentColor: 'yellow' },
  get_reports:        { label: 'Reports',             icon: Flag,         color: 'text-red-400',    bgColor: 'bg-red-500/10',    borderColor: 'border-red-500/20',    accentColor: 'red',     redirectTab: 'reports' },
  create_comment:     { label: 'Post comment',        icon: MessageCircle, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20', accentColor: 'emerald', redirectTab: 'posts' },
  hide_post:          { label: 'Hide post',           icon: EyeOff,       color: 'text-amber-400',  bgColor: 'bg-amber-500/10',  borderColor: 'border-amber-500/20',  accentColor: 'amber',   redirectTab: 'posts' },
  set_priority:       { label: 'Set priority',        icon: TrendingUp,   color: 'text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/20', accentColor: 'violet',  redirectTab: 'posts' },
  admin_reply:        { label: 'Admin reply',         icon: MessageCircle, color: 'text-teal-400',   bgColor: 'bg-teal-500/10',   borderColor: 'border-teal-500/20',   accentColor: 'teal',    redirectTab: 'posts' },
  lock_post:          { label: 'Lock post',           icon: Lock,         color: 'text-orange-400', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/20', accentColor: 'orange',  redirectTab: 'posts' },
  pin_post:           { label: 'Pin post',            icon: Pin,          color: 'text-pink-400',   bgColor: 'bg-pink-500/10',   borderColor: 'border-pink-500/20',   accentColor: 'pink',    redirectTab: 'posts' },
  feature_post:       { label: 'Feature post',        icon: Star,         color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/20', accentColor: 'yellow',  redirectTab: 'posts' },
  search_users:       { label: 'Search users',        icon: Search,       color: 'text-cyan-400',   bgColor: 'bg-cyan-500/10',   borderColor: 'border-cyan-500/20',   accentColor: 'cyan',    redirectTab: 'users' },
  clear_announcement: { label: 'Clear announcement',  icon: X,            color: 'text-red-400',    bgColor: 'bg-red-500/10',    borderColor: 'border-red-500/20',    accentColor: 'red' },
  set_eta:            { label: 'Set ETA',             icon: Calendar,     color: 'text-indigo-400', bgColor: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20', accentColor: 'indigo',  redirectTab: 'posts' },
  assign_post:        { label: 'Assign post',         icon: UserPlus,     color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20', accentColor: 'emerald', redirectTab: 'posts' },
  create_presentation:{ label: 'Presentation',        icon: FileText,     color: 'text-amber-400',  bgColor: 'bg-amber-500/10',  borderColor: 'border-amber-500/20',  accentColor: 'amber' },
  generate_csv:    { label: 'Generate CSV',        icon: FileText,     color: 'text-teal-400',   bgColor: 'bg-teal-500/10',   borderColor: 'border-teal-500/20',   accentColor: 'teal' },
  bulk_update:     { label: 'Bulk update',         icon: TrendingUp,   color: 'text-blue-400',   bgColor: 'bg-blue-500/10',   borderColor: 'border-blue-500/20',   accentColor: 'blue' },
  generate_summary:{ label: 'Summary',             icon: BarChart3,    color: 'text-purple-400', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/20', accentColor: 'purple' },
  search_content:  { label: 'Search content',      icon: Search,       color: 'text-cyan-400',   bgColor: 'bg-cyan-500/10',   borderColor: 'border-cyan-500/20',   accentColor: 'cyan' },
  trend_analysis:  { label: 'Trend analysis',      icon: TrendingUp,   color: 'text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/20', accentColor: 'violet' },
};

const QUICK_ACTIONS = [
  { label: 'Analytics', msg: 'Show me a summary of platform activity' },
  { label: 'Recent posts', msg: 'Show me the 5 most recent posts' },
  { label: 'Find posts', msg: 'find post cricket' },
  { label: 'Post comment', msg: 'comment on the first post: Thank you for your feedback, we are looking into this!' },
  { label: 'Hide a post', msg: 'hide post The cricket ground is wet' },
  { label: 'Lock comments', msg: 'lock post post_mrhlae8o6xkxok' },
  { label: 'Set ETA', msg: 'set eta post_mrhlae8o6xkxok to end of march' },
  { label: 'Search users', msg: 'search user anonymous' },
  { label: 'Clear announcement', msg: 'clear announcement' },
  { label: 'Generate CSV', msg: 'generate a csv of all posts with titles and dates' },
  { label: 'Health check', msg: 'run a full health check analysis on the platform' },
  { label: 'Presentation', msg: 'create a weekly problems report presentation' },
];

/* ═══════════════════════════════════════════════════════════════
   VISUAL PREVIEW COMPONENTS — each renders a rich animated mock
   ═══════════════════════════════════════════════════════════════ */

/** Animated poll card — shows exactly how the poll will look to users */
function PollPreview({ args }: { args: Record<string, any> }) {
  const options = args.options || ['Yes', 'No'];
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
      <p className="text-sm font-bold text-ink mb-3">{args.title || 'Untitled Poll'}</p>
      <div className="space-y-1.5">
        {options.map((opt: string, i: number) => (
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
function HidePreview({ args }: { args: Record<string, any> }) {
  const hidden = args.hidden;
  return (
    <div className="vb-action-preview rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-amber-500/15 border-2 border-amber-400/30 flex items-center justify-center vb-stage-pop shrink-0">
          {hidden ? <EyeOff size={18} className="text-amber-400" /> : <Eye size={18} className="text-amber-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink truncate">{args.title || args.post_id}</p>
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
function PriorityPreview({ args }: { args: Record<string, any> }) {
  const p = (args.priority || 'medium').toLowerCase();
  const colors: Record<string, { bg: string; text: string; border: string; label: string }> = {
    high: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/25', label: 'HIGH' },
    medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/25', label: 'MEDIUM' },
    low: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/25', label: 'LOW' },
  };
  const c = colors[p] || colors.medium;
  return (
    <div className="vb-action-preview rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center vb-stage-pop">
          <TrendingUp size={13} className="text-violet-400" />
        </div>
        <p className="text-[9px] font-mono text-violet-400/70 uppercase tracking-widest">Set Priority</p>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-violet-500/5 border border-violet-500/10 vb-slide-in">
        <span className="text-[11px] text-ink2 font-medium truncate">{args.title || args.post_id}</span>
        <ArrowRight size={12} className="text-violet-400/50 shrink-0" />
        <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${c.bg} ${c.text} border ${c.border} font-bold vb-pop`}>
          {c.label}
        </span>
      </div>
    </div>
  );
}

/** Admin reply preview — shows the reply on a post */
function AdminReplyPreview({ args }: { args: Record<string, any> }) {
  return (
    <div className="vb-action-preview rounded-xl border border-teal-500/25 bg-gradient-to-br from-teal-500/5 via-surface2 to-surface p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-teal-500/15 flex items-center justify-center vb-stage-pop">
          <MessageCircle size={13} className="text-teal-400" />
        </div>
        <p className="text-[9px] font-mono text-teal-400/70 uppercase tracking-widest">Admin Reply</p>
      </div>
      {/* Post card mockup */}
      <div className="rounded-lg border border-border/60 bg-surface/80 p-3 mb-3">
        <p className="text-[10px] text-ink3 truncate">Post: {args.title || args.post_id}</p>
      </div>
      {/* Reply bubble */}
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
            <p className="text-xs text-ink2 leading-relaxed">{args.reply || 'Reply text'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Lock / Unlock post preview */
function LockPreview({ args }: { args: Record<string, any> }) {
  const locked = args.locked;
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
            <p className="text-sm font-bold text-ink truncate">{args.title || args.post_id}</p>
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
function PinPreview({ args }: { args: Record<string, any> }) {
  const pinned = args.pinned;
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
            <p className="text-sm font-bold text-ink truncate">{args.title || args.post_id}</p>
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
function FeaturePreview({ args }: { args: Record<string, any> }) {
  const featured = args.featured;
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
            <p className="text-sm font-bold text-ink truncate">{args.title || args.post_id}</p>
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
function BanPreview({ args }: { args: Record<string, any> }) {
  const userId = args.user_id || args.anon_id || args.target_id || 'Unknown';
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
      {args.reason && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10">
          <p className="text-[10px] text-ink3 uppercase tracking-wider mb-0.5">Reason</p>
          <p className="text-xs text-ink2 italic">"{args.reason}"</p>
        </div>
      )}
    </div>
  );
}

/** Unban preview */
function UnbanPreview({ args }: { args: Record<string, any> }) {
  const userId = args.user_id || args.anon_id || args.target_id || 'Unknown';
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
function WarnPreview({ args }: { args: Record<string, any> }) {
  const userId = args.user_id || args.anon_id || args.target_id || 'Unknown';
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
      {args.reason && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-orange-500/5 border border-orange-500/10">
          <p className="text-[10px] text-ink3 uppercase tracking-wider mb-0.5">Warning reason</p>
          <p className="text-xs text-ink2 italic">"{args.reason}"</p>
        </div>
      )}
    </div>
  );
}

/** Delete post preview */
function DeletePostPreview({ args }: { args: Record<string, any> }) {
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
            <span className="font-mono">ID: {args.post_id || args.target_id || '—'}</span>
          </div>
        </div>
      </div>
      {args.reason && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10">
          <p className="text-[10px] text-ink3 uppercase tracking-wider mb-0.5">Reason</p>
          <p className="text-xs text-ink2 italic">"{args.reason}"</p>
        </div>
      )}
    </div>
  );
}

/** Announcement preview — shows how the banner will look */
function AnnouncementPreview({ args }: { args: Record<string, any> }) {
  const text = args.message || args.text || args.content || 'New announcement';
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
function ClearAnnouncePreview() {
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
function CommentPreview({ args }: { args: Record<string, any> }) {
  return (
    <div className="vb-action-preview rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 via-surface2 to-surface p-4 overflow-hidden">
      <div className="rounded-lg border border-border/60 bg-surface/80 p-3 mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-5 h-5 rounded-full bg-accent/15 flex items-center justify-center vb-stage-pop">
            <Eye size={10} className="text-accent" />
          </div>
          <span className="text-[9px] font-mono text-ink3 uppercase tracking-wider">Post</span>
          <span className="text-[8px] font-mono text-ink3/60 ml-auto">{args.post_id || '—'}</span>
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
            <p className="text-xs text-ink2 leading-relaxed">{args.body || args.message || 'Comment text'}</p>
          </div>
        </div>
      </div>
      <p className="mt-2.5 text-[10px] text-emerald-400/60">Admin comment will be posted publicly with the ADMIN badge</p>
    </div>
  );
}

/** Update post preview — shows the status/priority change */
function UpdatePostPreview({ args }: { args: Record<string, any> }) {
  const changes = Object.entries(args).filter(([k]) => k !== 'post_id' && k !== 'reason');
  return (
    <div className="vb-action-preview rounded-xl border border-yellow-500/25 bg-gradient-to-br from-yellow-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-yellow-500/15 flex items-center justify-center vb-stage-pop">
          <TrendingUp size={13} className="text-yellow-400" />
        </div>
        <p className="text-[9px] font-mono text-yellow-400/70 uppercase tracking-widest">Update Post</p>
        <span className="text-[8px] font-mono text-ink3 ml-auto">{args.post_id || '—'}</span>
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
function ETAPreview({ args }: { args: Record<string, any> }) {
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
        <span className="text-[11px] text-ink2 font-medium truncate">{args.title || args.post_id}</span>
        <ArrowRight size={12} className="text-indigo-400/50 shrink-0" />
        <span className="text-[11px] text-indigo-400 font-bold">{args.eta || 'TBD'}</span>
      </div>
    </div>
  );
}

/** Assign preview — shows post being assigned to someone */
function AssignPreview({ args }: { args: Record<string, any> }) {
  return (
    <div className="vb-action-preview rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center vb-stage-pop">
          <UserPlus size={13} className="text-emerald-400" />
        </div>
        <p className="text-[9px] font-mono text-emerald-400/70 uppercase tracking-widest">Assign Post</p>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 vb-slide-in">
        <span className="text-[11px] text-ink2 font-medium truncate">{args.title || args.post_id}</span>
        <ArrowRight size={12} className="text-emerald-400/50 shrink-0" />
        <span className="text-[11px] text-emerald-400 font-bold">{args.assigned_to || '—'}</span>
      </div>
    </div>
  );
}

/** Presentation preview — shows a mini slide deck mockup */
function PresentationPreview({ args }: { args: Record<string, any> }) {
  const periodLabel = args.period === 'week' ? 'This Week' : args.period === 'month' ? 'This Month' : args.period === 'day' ? 'Today' : 'All Time';
  const slideCount = Math.min((args.post_ids?.length || 5) + 3, 18); // +3 for title/overview/closing
  return (
    <div className="vb-action-preview rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-500/5 via-surface2 to-surface p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center vb-stage-pop">
          <FileText size={13} className="text-amber-400" />
        </div>
        <p className="text-[9px] font-mono text-amber-400/70 uppercase tracking-widest">Presentation Generator</p>
      </div>

      {/* Title slide preview */}
      <div className="vb-slide-in rounded-lg bg-gradient-to-br from-amber-500/10 via-surface2 to-surface border border-amber-500/15 p-3 mb-2">
        <div className="text-[8px] font-mono text-amber-400/50 uppercase tracking-widest mb-1">ADMIN REPORT</div>
        <p className="text-xs font-semibold text-ink1 truncate">{args.topic || 'Weekly Problems Report'}</p>
        <p className="text-[10px] text-ink3 mt-0.5">{periodLabel} · {slideCount} slides</p>
      </div>

      {/* Slide thumbnails strip */}
      <div className="flex gap-1.5 overflow-hidden">
        {Array.from({ length: Math.min(slideCount, 8) }, (_, i) => {
          const isTitle = i === 0;
          const isChart = i === 1;
          const isAction = i >= slideCount - 2 && i < slideCount - 1;
          const isClose = i === slideCount - 1;
          return (
            <div
              key={i}
              className="vb-stage-pop shrink-0 rounded border border-amber-500/10 bg-surface2/60 flex flex-col items-center justify-center overflow-hidden"
              style={{
                width: '32px',
                height: '22px',
                animationDelay: `${i * 60}ms`,
              }}
            >
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
function MetaAgentPreview({ args }: { args: Record<string, any> }) {
  const query = args.query || args.message || args.request || '';
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
function CSVPreview({ args, result }: { args: Record<string, any>; result?: any }) {
  const rows = args.row_count || result?.data?.row_count || '?';
  const cols = args.columns?.length || '?';
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
          <p className="text-xs text-ink font-medium">{args.filename || 'export.csv'}</p>
          <p className="text-[10px] text-ink3">{rows} rows × {cols} columns</p>
        </div>
        {result?.success && (
          <a
            href={`data:text/csv;base64,${btoa(result.data?.csv || '')}`}
            download={args.filename || 'export.csv'}
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
function TrendAnalysisPreview({ args }: { args: Record<string, any> }) {
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
function AnalyticsPreview() {
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
function ReportsPreview() {
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
function UserSearchPreview({ args }: { args: Record<string, any> }) {
  return (
    <div className="vb-action-preview rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/5 via-surface2 to-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-cyan-500/15 flex items-center justify-center vb-stage-pop">
          <Search size={13} className="text-cyan-400" />
        </div>
        <p className="text-[9px] font-mono text-cyan-400/70 uppercase tracking-widest">Search Users</p>
      </div>
      <div className="px-3 py-2 rounded-lg bg-cyan-500/5 border border-cyan-500/10 vb-slide-in">
        <p className="text-xs text-ink2">Query: "<span className="font-medium text-cyan-400">{args.query || '—'}</span>"</p>
      </div>
      <p className="mt-2 text-[10px] text-cyan-400/60">Searching user database for matching anonymous IDs…</p>
    </div>
  );
}

/** Generic parameter preview */
function GenericPreview({ args }: { args: Record<string, any> }) {
  return (
    <div className="rounded-lg bg-surface2/60 border border-border p-2.5">
      <p className="text-[10px] font-mono text-ink3 uppercase tracking-wider mb-1">Parameters</p>
      <pre className="text-[10px] font-mono text-ink2 whitespace-pre-wrap break-all">
        {JSON.stringify(args, null, 2)}
      </pre>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EXPANDABLE ACTION CARD — click header to expand full preview
   ═══════════════════════════════════════════════════════════════ */
function ActionCard({
  action,
  onExecute,
  onDismiss,
  executing,
}: {
  action: Action;
  onExecute: () => void;
  onDismiss: () => void;
  executing: boolean;
}) {
  const [expanded, setExpanded] = useState(!action.result); // auto-expand pending actions

  const meta = TOOL_META[action.tool] || {
    label: action.tool, icon: Eye, color: 'text-ink3',
    bgColor: 'bg-surface2', borderColor: 'border-border', accentColor: 'slate',
  };
  const Icon = meta.icon;
  const { args } = action;

  /* Animated visual preview by tool type */
  const renderPreview = () => {
    switch (action.tool) {
      case 'create_poll':      return <PollPreview args={args} />;
      case 'ban_user':         return <BanPreview args={args} />;
      case 'unban_user':       return <UnbanPreview args={args} />;
      case 'warn_user':        return <WarnPreview args={args} />;
      case 'delete_post':      return <DeletePostPreview args={args} />;
      case 'set_announcement': return <AnnouncementPreview args={args} />;
      case 'get_analytics':    return <AnalyticsPreview />;
      case 'get_reports':      return <ReportsPreview />;
      case 'create_comment':   return <CommentPreview args={args} />;
      case 'update_post':      return <UpdatePostPreview args={args} />;
      case 'hide_post':        return <HidePreview args={args} />;
      case 'set_priority':     return <PriorityPreview args={args} />;
      case 'admin_reply':      return <AdminReplyPreview args={args} />;
      case 'lock_post':        return <LockPreview args={args} />;
      case 'pin_post':         return <PinPreview args={args} />;
      case 'feature_post':     return <FeaturePreview args={args} />;
      case 'search_users':     return <UserSearchPreview args={args} />;
      case 'clear_announcement': return <ClearAnnouncePreview />;
      case 'set_eta':          return <ETAPreview args={args} />;
      case 'assign_post':      return <AssignPreview args={args} />;
      case 'generate_csv':     return <CSVPreview args={args} result={action.result} />;
      case 'bulk_update':      return <MetaAgentPreview args={{ query: `Bulk update: ${JSON.stringify(args)}` }} />;
      case 'generate_summary': return <TrendAnalysisPreview args={args} />;
      case 'search_content':   return <MetaAgentPreview args={{ query: args.query || args.keyword || 'Search content' }} />;
      case 'trend_analysis':   return <TrendAnalysisPreview args={args} />;
      default:                 return <GenericPreview args={args} />;
    }
  };

  /* Execution result — animated success/failure */
  const renderResult = () => {
    if (!action.result) return null;
    const { success, error, data } = action.result;
    return (
      <div className={`vb-action-result rounded-xl p-3.5 border text-xs vb-stage-pop ${
        success ? 'bg-green-500/5 border-green-500/25' : 'bg-red-500/5 border-red-500/25'
      }`}>
        <div className="flex items-center gap-2.5 font-semibold">
          {success ? (
            <div className="w-7 h-7 rounded-full bg-green-500/15 flex items-center justify-center vb-pop">
              <CheckCircle2 size={14} className="text-green-400" />
            </div>
          ) : (
            <div className="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center vb-pop">
              <XCircle size={14} className="text-red-400" />
            </div>
          )}
          <div>
            <p className={success ? 'text-green-400' : 'text-red-400'}>
              {success ? 'Action completed successfully' : `Failed: ${error || 'Unknown error'}`}
            </p>
            {success && (
              <p className="text-[10px] text-ink3 mt-0.5">
                Redirecting to {meta.redirectTab || 'relevant'} tab…
              </p>
            )}
          </div>
        </div>
        {success && data && (
          <pre className="mt-2 text-[10px] font-mono text-ink3/70 whitespace-pre-wrap max-h-20 overflow-auto">
            {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
          </pre>
        )}
        {/* Presentation open-in-tab button */}
        {success && action.tool === 'create_presentation' && action.result?.data?.html && (
          <button
            className="mt-2 btn btn-primary !text-[11px] !py-2 flex items-center gap-1.5 rounded-xl"
            onClick={() => {
              const blob = new Blob([action.result!.data.html], { type: 'text/html' });
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            }}
          >
            <ExternalLink size={12} /> Open Presentation
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={`vb-action-card rounded-2xl border overflow-hidden transition-all duration-300 vb-rise ${
      action.result?.success === true ? 'border-green-500/30 bg-green-500/[0.03]'
      : action.result?.success === false ? 'border-red-500/30 bg-red-500/[0.03]'
      : `${meta.borderColor} bg-surface2/50 hover:bg-surface2`
    }`}>
      {/* ── Clickable header ── */}
      <button
        className="w-full text-left p-3.5 flex items-center gap-2.5 flex-wrap cursor-pointer select-none hover:bg-surface2/30 transition-colors"
        onClick={() => !action.result && setExpanded(!expanded)}
      >
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${meta.bgColor} vb-stage-pop`}>
          <Icon size={13} className={meta.color} />
        </div>
        <span className="font-semibold text-ink text-[13px] flex-1">{meta.label}</span>
        {action.destructive && (
          <span className="text-[8px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-bold border border-red-500/20 uppercase tracking-wider vb-pop">
            Destructive
          </span>
        )}
        {!action.result && (
          <>
            <span className="text-[8px] text-ink3 font-mono">{expanded ? 'CLICK TO COLLAPSE' : 'CLICK TO EXPAND'}</span>
            {expanded ? <ChevronUp size={12} className="text-ink3" /> : <ChevronDown size={12} className="text-ink3" />}
          </>
        )}
        {action.result?.success === true && <CheckCircle2 size={14} className="text-green-400" />}
        {action.result?.success === false && <XCircle size={14} className="text-red-400" />}
      </button>

      {/* ── Collapsed reason (when not expanded) ── */}
      {!expanded && action.reason && (
        <p className="text-[11px] text-ink3 leading-relaxed px-3.5 pb-3 pl-14 truncate">{action.reason}</p>
      )}

      {/* ── Expanded content: preview + buttons ── */}
      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-3">
          {/* Reason */}
          {action.reason && (
            <p className="text-[11px] text-ink3 leading-relaxed pl-9">{action.reason}</p>
          )}

          {/* Visual preview — animated */}
          <div className="pl-1">
            {renderPreview()}
          </div>

          {/* Execution result */}
          {renderResult()}

          {/* Action buttons */}
          {!action.result && (
            <div className="flex gap-2 pt-1 pl-1">
              <button
                className={`btn !text-[11px] !py-2 !px-4 flex items-center gap-1.5 font-bold rounded-xl transition-all duration-200 ${
                  action.destructive
                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20 hover:shadow-red-500/40'
                    : 'bg-accent hover:bg-accent2 text-white shadow-lg shadow-accent/20 hover:shadow-accent/40'
                }`}
                disabled={executing}
                onClick={onExecute}
              >
                {executing ? (
                  <><Loader2 size={12} className="animate-spin" /><span>Executing…</span></>
                ) : (
                  <><PlayCircle size={12} /><span>Execute</span></>
                )}
              </button>
              <button
                className="btn btn-ghost !text-[11px] !py-2 !px-4 rounded-xl"
                onClick={onDismiss}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────── */
export default function AgentChat() {
  const { toast } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId] = useState(() => `s_${Date.now()}`);
  const [busy, setBusy] = useState(false);
  const [executingIds, setExecutingIds] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  /* Load session history */
  const loadHistory = useCallback(async () => {
    try {
      const data = await api.postLong('/api/agent-chat', { action: 'history', session_id: sessionId });
      if (Array.isArray(data)) {
        setMessages(data.map((d: any) => ({
          role: d.role,
          content: d.content,
          actions: d.actions,
          created_at: d.created_at,
        })));
      }
    } catch { /* empty */ }
  }, [sessionId]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.postLong('/api/agent-chat', { action: 'sessions' });
      setSessions(data);
    } catch { /* empty */ }
  }, []);

  useEffect(() => { loadHistory(); loadSessions(); }, [loadHistory, loadSessions]);

  /* Auto-scroll */
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  /* Send message */
  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg, created_at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const r = await api.postLong('/api/agent-chat', { action: 'chat', message: msg, session_id: sessionId });
      const assistantMsg: Message = {
        role: 'assistant',
        content: r.reply,
        actions: r.actions,
        provider: r.provider,
        model: r.model,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, assistantMsg]);
      loadSessions();
    } catch (e: any) {
      toast(e.message, 'err');
      setMessages((m) => [...m, { role: 'system', content: `Error: ${e.message}`, created_at: new Date().toISOString() }]);
    }
    setBusy(false);
  };

  /* Execute a single action */
  const executeAction = async (msgIndex: number, actionId: string) => {
    const msg = messages[msgIndex];
    const action = msg.actions?.find((a) => a.id === actionId);
    if (!action) return;

    setExecutingIds((s) => new Set([...s, actionId]));
    try {
      const r = await api.postLong('/api/agent-chat', {
        action: 'execute',
        actions: [{ id: action.id, tool: action.tool, args: action.args }],
        session_id: sessionId,
      });
      const result = r.results?.[0] || { success: false, error: 'No result returned' };

      setMessages((m) => m.map((msg, i) => {
        if (i !== msgIndex || !msg.actions) return msg;
        return { ...msg, actions: msg.actions.map((a) => a.id === actionId ? { ...a, result } : a) };
      }));

      if (result.success) {
        toast(`${TOOL_META[action.tool]?.label || action.tool} completed`, 'ok');
        const redirectTab = TOOL_META[action.tool]?.redirectTab;
        if (redirectTab) setTimeout(() => window.dispatchEvent(new CustomEvent('vb:admin-tab', { detail: redirectTab })), 1200);
      } else {
        toast(`Failed: ${result.error}`, 'err');
      }
    } catch (e: any) {
      toast(e.message, 'err');
      setMessages((m) => m.map((msg, i) => {
        if (i !== msgIndex || !msg.actions) return msg;
        return { ...msg, actions: msg.actions.map((a) => a.id === actionId ? { ...a, result: { success: false, error: e.message } } : a) };
      }));
    }
    setExecutingIds((s) => { const next = new Set(s); next.delete(actionId); return next; });
  };

  /* Execute all actions in a message */
  const executeAll = async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg.actions) return;
    for (const action of msg.actions) {
      if (!action.result) await executeAction(msgIndex, action.id);
    }
  };

  /* Dismiss (remove) a single action */
  const dismissAction = (msgIndex: number, actionId: string) => {
    setMessages((m) => m.map((msg, i) => {
      if (i !== msgIndex || !msg.actions) return msg;
      const filtered = msg.actions.filter((a) => a.id !== actionId);
      return { ...msg, actions: filtered.length > 0 ? filtered : undefined };
    }));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-semibold text-sm flex items-center gap-2">
            <MessageSquare size={15} className="text-accent" /> Admin Agent
          </h2>
          <p className="text-[11px] text-ink3 mt-0.5">
            Natural language admin — ask questions, get analytics, manage content. Click action cards to expand and preview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost !text-xs" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Current chat' : `History (${sessions.length})`}
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="card p-4 max-h-64 overflow-auto">
          {sessions.length === 0 && <p className="text-xs text-ink3">No previous sessions</p>}
          {sessions.map((s) => (
            <div key={s.session_id} className="text-xs text-ink2 py-1 border-b border-border last:border-0">
              <span className="font-mono text-ink3">{s.session_id}</span>
              <span className="ml-2 text-ink3">{new Date(s.last_message).toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Chat area */}
          <div ref={chatRef} className="card p-4 min-h-[300px] max-h-[500px] overflow-auto space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8 vb-rise">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-accent/10 flex items-center justify-center mb-3 vb-pop">
                  <Sparkles size={28} className="text-accent" />
                </div>
                <p className="font-display font-semibold text-sm text-ink">Admin Agent</p>
                <p className="text-xs text-ink3 mt-1 max-w-xs mx-auto">Ask me anything about your platform. I can manage posts, users, polls, announcements, and more.</p>
              </div>
            )}
            {messages.map((m, mi) => (
              <div key={mi} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} vb-slide-in`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === 'user' ? 'bg-accent text-white shadow-lg shadow-accent/20' :
                  m.role === 'system' ? 'bg-warn/10 text-warn border border-warn/20' :
                  'bg-surface2 text-ink'
                }`}>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>

                  {/* Provider badge */}
                  {m.provider && m.provider !== 'none' && (
                    <p className="text-[9px] font-mono mt-1.5 opacity-50 flex items-center gap-1">
                      <Zap size={8} /> {m.provider}/{m.model}
                    </p>
                  )}

                  {/* Visual action cards */}
                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-3 space-y-2.5">
                      <p className="text-[11px] font-semibold text-ink3 flex items-center gap-1.5">
                        <ArrowRight size={10} /> Proposed actions — click to expand
                      </p>
                      {m.actions.map((a, ai) => (
                        <div key={a.id} style={{ animationDelay: `${ai * 100}ms` }} className="vb-rise">
                          <ActionCard
                            action={a}
                            executing={executingIds.has(a.id)}
                            onExecute={() => executeAction(mi, a.id)}
                            onDismiss={() => dismissAction(mi, a.id)}
                          />
                        </div>
                      ))}
                      {/* Execute all button */}
                      {m.actions.filter((a) => !a.result).length > 1 && (
                        <button
                          className="btn btn-primary !text-[11px] !py-2 flex items-center gap-1.5 rounded-xl shadow-lg shadow-accent/20"
                          onClick={() => executeAll(mi)}
                          disabled={executingIds.size > 0}
                        >
                          <Check size={12} /> Execute all {m.actions.filter((a) => !a.result).length} actions
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start vb-slide-in">
                <div className="bg-surface2 rounded-2xl px-4 py-2.5 text-xs text-ink3 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((qa) => (
              <button key={qa.label} className="btn btn-ghost !text-[10px] !py-1 !px-2 rounded-xl" onClick={() => send(qa.msg)}>
                {qa.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              className="input flex-1 !text-xs !py-2.5"
              placeholder="Ask the agent… (e.g. 'hide post The cricket ground is wet')"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              disabled={busy}
            />
            <button className="btn btn-primary !text-xs !py-2.5 !px-5 rounded-xl shadow-lg shadow-accent/20" onClick={() => send()} disabled={busy || !input.trim()}>
              <Send size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
