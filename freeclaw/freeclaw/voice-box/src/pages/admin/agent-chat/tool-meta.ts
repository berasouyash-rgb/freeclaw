import {
  Eye, TrendingUp, Trash2, AlertTriangle, Ban, UserCheck,
  BarChart3, Clock, Flag, MessageCircle, EyeOff, Lock, Unlock,
  Pin, PinOff, Star, StarOff, Search, Calendar, UserPlus,
  Megaphone, FileText, X, Sparkles, ArrowRight,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────── */
export interface Action {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  destructive: boolean;
  result?: { success: boolean; error?: string; data?: unknown };
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  actions?: Action[];
  provider?: string;
  model?: string;
  created_at: string;
}

/* ── Tool metadata ─────────────────────────────────────────── */
export type ToolMeta = {
  label: string;
  icon: typeof Eye;
  color: string;
  bgColor: string;
  borderColor: string;
  accentColor: string;
  redirectTab?: string;
};

export const TOOL_META: Record<string, ToolMeta> = {
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

export const DEFAULT_TOOL_META: ToolMeta = {
  label: 'Tool action',
  icon: Eye,
  color: 'text-ink3',
  bgColor: 'bg-surface2',
  borderColor: 'border-border',
  accentColor: 'slate',
};

/* ── Quick action prompts ──────────────────────────────────── */
export const QUICK_ACTIONS = [
  { label: 'Analytics', msg: 'Show me a summary of platform activity' },
  { label: 'Recent posts', msg: 'Show me the 5 most recent posts' },
  { label: 'Find posts', msg: 'find post cricket' },
  { label: 'Post comment', msg: 'comment on the first post: Thank you for your feedback, we are looking into this!' },
  { label: 'Hide a post', msg: 'hide the most recent spam post' },
  { label: 'Lock comments', msg: 'lock comments on the most flagged post' },
  { label: 'Set ETA', msg: 'set eta on the oldest open post to end of this month' },
  { label: 'Search users', msg: 'search users by anonymous id' },
  { label: 'Clear announcement', msg: 'clear announcement' },
  { label: 'Generate CSV', msg: 'generate a csv of all posts with titles and dates' },
  { label: 'Health check', msg: 'run a full health check analysis on the platform' },
  { label: 'Presentation', msg: 'create a weekly problems report presentation' },
];

/* ── Fallback icon component for unknown tools ─────────────── */
export { ArrowRight as FallbackIcon };
