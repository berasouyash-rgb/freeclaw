import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Trash2, Settings, Filter, MessageSquare, BarChart3, Info, Clock, AlertCircle, Send } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import type { NotificationKind } from '../contexts/AppContext';

const KIND_META: Record<NotificationKind, { label: string; icon: typeof Bell; color: string }> = {
  status: { label: 'Status Update', icon: AlertCircle, color: 'text-blue-400' },
  reply: { label: 'Reply', icon: MessageSquare, color: 'text-green-400' },
  comment: { label: 'Comment', icon: MessageSquare, color: 'text-purple-400' },
  chat: { label: 'Message', icon: MessageSquare, color: 'text-cyan-400' },
  poll: { label: 'Poll', icon: BarChart3, color: 'text-amber-400' },
  info: { label: 'Info', icon: Info, color: 'text-ink3' },
  submitted: { label: 'Submitted', icon: Send, color: 'text-accent' },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ALL_KINDS: NotificationKind[] = ['status', 'reply', 'comment', 'chat', 'poll', 'info', 'submitted'];

export default function Notifications() {
  const { notifications, markNotifsRead, clearNotifs } = useApp();
  const [filter, setFilter] = useState<NotificationKind | 'all'>('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const filtered = useMemo(() => {
    let list = [...notifications];
    if (filter !== 'all') list = list.filter((n) => n.kind === filter);
    if (showUnreadOnly) list = list.filter((n) => !n.read);
    return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [notifications, filter, showUnreadOnly]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: notifications.length };
    ALL_KINDS.forEach((k) => { c[k] = notifications.filter((n) => n.kind === k).length; });
    return c;
  }, [notifications]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 vb-page-enter">
      {/* Header */}
      <div className="vb-page-header flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2">
            <Bell size={22} /> Notifications
          </h1>
          <p>
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={markNotifsRead} disabled={unreadCount === 0}
            className="btn btn-ghost !text-xs !px-3 !py-1.5 flex items-center gap-1.5 disabled:opacity-40">
            <CheckCheck size={14} /> Mark all read
          </button>
          <Link to="/settings" className="btn btn-ghost !text-xs !px-3 !py-1.5 flex items-center gap-1.5">
            <Settings size={14} /> Preferences
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={13} className="text-ink3" />
        <button onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all duration-150 ${filter === 'all' ? 'bg-accent text-white shadow-sm' : 'text-ink3 hover:text-ink2 hover:bg-surface2'}`}>
          All ({counts.all})
        </button>
        {ALL_KINDS.map((k) => (
          (counts[k] ?? 0) > 0 && (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all duration-150 ${filter === k ? 'bg-accent text-white shadow-sm' : 'text-ink3 hover:text-ink2 hover:bg-surface2'}`}>
              {KIND_META[k]?.label ?? k} ({counts[k] ?? 0})
            </button>
          )
        ))}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink3 cursor-pointer">
            <input type="checkbox" checked={showUnreadOnly} onChange={(e) => setShowUnreadOnly(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border accent-accent" />
            Unread only
          </label>
        </div>
      </div>

      {/* Notification list */}
      <div className="space-y-0.5">
        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="vb-empty-icon">
              <Bell size={28} />
            </div>
            <p className="text-sm font-medium text-ink2">
              {notifications.length === 0 ? 'No notifications yet' : 'No matching notifications'}
            </p>
            <p className="text-xs text-ink3 mt-1 max-w-xs mx-auto">
              {notifications.length === 0
                ? "You'll be notified about status updates, replies, and poll results."
                : 'Try adjusting your filters to see more.'}
            </p>
          </div>
        )}
        {filtered.map((n) => {
          const meta = KIND_META[n.kind];
          const Icon = meta.icon;
          return (
            <Link key={n.id} to={n.link || '#'}
              className={`vb-notif-item flex items-start gap-3 px-4 py-3 rounded-xl ${!n.read ? 'bg-accent-soft/30' : ''}`}>
              <div className={`mt-0.5 ${meta.color}`}>
                <Icon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-ink3 truncate mt-0.5">{n.body}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!n.read && <span className="w-2 h-2 rounded-full bg-accent" />}
                <span className="text-[10px] text-ink3 flex items-center gap-1">
                  <Clock size={10} /> {timeAgo(n.at)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Clear all */}
      {notifications.length > 0 && (
        <div className="text-center pt-4 border-t border-border">
          <button onClick={clearNotifs} className="btn btn-danger !text-xs flex items-center gap-1.5 mx-auto">
            <Trash2 size={13} /> Clear all notifications
          </button>
        </div>
      )}
    </div>
  );
}
