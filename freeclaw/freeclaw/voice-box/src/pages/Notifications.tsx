import {
	AlertCircle,
	BarChart3,
	Bell,
	CheckCheck,
	CheckCircle2,
	Clock,
	Filter,
	Info,
	MessageSquare,
	Send,
	Settings,
	ShieldAlert,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { NotificationKind } from "../contexts/AppContext";
import { useApp } from "../contexts/AppContext";

const KIND_META: Record<
	NotificationKind,
	{ label: string; icon: typeof Bell; color: string }
> = {
	status: { label: "Status Update", icon: AlertCircle, color: "text-blue-400" },
	reply: { label: "Reply", icon: MessageSquare, color: "text-green-400" },
	comment: { label: "Comment", icon: MessageSquare, color: "text-purple-400" },
	chat: { label: "Message", icon: MessageSquare, color: "text-cyan-400" },
	poll: { label: "Poll", icon: BarChart3, color: "text-amber-400" },
	info: { label: "Info", icon: Info, color: "text-ink3" },
	submitted: { label: "Submitted", icon: Send, color: "text-accent" },
	mention: { label: "Mention", icon: MessageSquare, color: "text-violet-400" },
	warning: { label: "Warning", icon: ShieldAlert, color: "text-warn" },
	success: { label: "Success", icon: CheckCircle2, color: "text-good" },
	suspension: { label: "Suspension", icon: ShieldAlert, color: "text-warn" },
	suspension_lifted: { label: "Suspension lifted", icon: CheckCircle2, color: "text-good" },
	ban: { label: "Ban", icon: ShieldAlert, color: "text-bad" },
	unban: { label: "Unban", icon: CheckCircle2, color: "text-good" },
	moderation: { label: "Moderation", icon: ShieldAlert, color: "text-violet-400" },
};

function timeAgo(iso: string) {
	if (!iso) return "—";
	const diff = Date.now() - new Date(iso).getTime();
	if (!Number.isFinite(diff)) return "—";
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

const ALL_KINDS: NotificationKind[] = [
	"status",
	"reply",
	"comment",
	"chat",
	"poll",
	"info",
	"submitted",
	"mention",
	"warning",
	"success",
	"suspension",
	"suspension_lifted",
	"ban",
	"unban",
	"moderation",
];

export default function Notifications() {
	const { notifications, markNotifsRead, markNotifRead, clearNotifs } = useApp();
	const [filter, setFilter] = useState<NotificationKind | "all">("all");
	const [showUnreadOnly, setShowUnreadOnly] = useState(false);

	/* "2m ago" is rendered, not stored — without a tick it freezes at the
	 * string computed on first paint and a page left open all morning still
	 * says "just now". Re-render on a slow visible-only interval; a hidden tab
	 * does no work at all. */
	const [, setClockTick] = useState(0);
	useEffect(() => {
		const id = window.setInterval(() => {
			if (document.visibilityState !== "visible") return;
			setClockTick((t) => t + 1);
		}, 30_000);
		return () => window.clearInterval(id);
	}, []);

	const filtered = useMemo(() => {
		let list = [...notifications];
		if (filter !== "all") list = list.filter((n) => n.kind === filter);
		if (showUnreadOnly) list = list.filter((n) => !n.read);
		const sorted = list.sort(
			(a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
		);
		/* Group consecutive notifications sharing kind + link (several comments
		 * on one post). Sorted newest-first, the head of a group IS the newest
		 * entry, so its body and timestamp stay authoritative — an older
		 * sibling must never overwrite them. A group reads as unread while ANY
		 * member is unread, and opening it clears every member; otherwise the
		 * header badge would keep counting rows the list already showed read. */
		type Grouped = (typeof sorted)[number] & {
			_count?: number;
			_unread?: boolean;
			_ids?: string[];
		};
		const grouped: Grouped[] = [];
		for (const n of sorted) {
			const last = grouped[grouped.length - 1];
			if (
				last &&
				last.kind === n.kind &&
				last.link === n.link &&
				last.body !== n.body
			) {
				last._count = (last._count || 1) + 1;
				last._ids = [...(last._ids ?? [last.id]), n.id];
				last._unread = last._unread || !n.read;
			} else {
				grouped.push({ ...n, _count: 1, _ids: [n.id], _unread: !n.read });
			}
		}
		return grouped;
	}, [notifications, filter, showUnreadOnly]);

	const unreadCount = notifications.filter((n) => !n.read).length;
	const counts = useMemo(() => {
		const c: Record<string, number> = { all: notifications.length };
		ALL_KINDS.forEach((k) => {
			c[k] = notifications.filter((n) => n.kind === k).length;
		});
		return c;
	}, [notifications]);

	return (
		<div className="max-w-3xl mx-auto px-4 py-6 space-y-6 vb-page-enter">
			{/* Header */}
			{/* Stacks on phones: title + two action buttons on one row did not fit
			    a 375px viewport, so the page scrolled sideways. */}
			<div className="vb-page-header flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
				<div>
					<h1 className="flex items-center gap-2">
						<Bell size={22} /> Notifications
					</h1>
					<p aria-live="polite">
						{unreadCount > 0
							? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
							: "All caught up"}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button
						onClick={markNotifsRead}
						disabled={unreadCount === 0}
						className="btn btn-ghost !text-xs !px-3 !py-1.5 flex items-center gap-1.5 disabled:opacity-40"
					>
						<CheckCheck size={14} /> Mark all read
					</button>
					<Link
						to="/settings"
						className="btn btn-ghost !text-xs !px-3 !py-1.5 flex items-center gap-1.5"
					>
						<Settings size={14} /> Preferences
					</Link>
				</div>
			</div>

			{/* Filters */}
			<div
				className="flex flex-wrap items-center gap-2"
				role="group"
				aria-label="Filter notifications"
			>
				<Filter size={13} className="text-ink3" aria-hidden />
				<button
					onClick={() => setFilter("all")}
					aria-pressed={filter === "all"}
					className={`px-3 py-1 rounded-full text-xs font-semibold transition-all duration-150 ${filter === "all" ? "bg-accent text-on-accent shadow-sm" : "text-ink3 hover:text-ink2 hover:bg-surface2"}`}
				>
					All ({counts.all})
				</button>
				{ALL_KINDS.map(
					(k) =>
						(counts[k] ?? 0) > 0 && (
							<button
								key={k}
								onClick={() => setFilter(k)}
								aria-pressed={filter === k}
								aria-label={`Filter by ${KIND_META[k]?.label ?? k}: ${counts[k] ?? 0} notifications`}
								className={`px-3 py-1 rounded-full text-xs font-semibold transition-all duration-150 ${filter === k ? "bg-accent text-on-accent shadow-sm" : "text-ink3 hover:text-ink2 hover:bg-surface2"}`}
							>
								{KIND_META[k]?.label ?? k} ({counts[k] ?? 0})
							</button>
						),
				)}
				<div className="ml-auto flex items-center gap-2">
					<label className="flex items-center gap-1.5 text-xs text-ink3 cursor-pointer">
						<input
							type="checkbox"
							name="unread-only"
							checked={showUnreadOnly}
							onChange={(e) => setShowUnreadOnly(e.target.checked)}
							className="w-3.5 h-3.5 rounded border-border accent-accent"
						/>
						Unread only
					</label>
				</div>
			</div>

			{/* Notification list */}
			<div className="space-y-0.5">
				{filtered.length === 0 && (
					<div className="text-center py-16" role="status">
						<div className="vb-empty-icon" aria-hidden>
							<Bell size={28} />
						</div>
						<p className="text-sm font-medium text-ink2">
							{notifications.length === 0
								? "No notifications yet"
								: "No matching notifications"}
						</p>
						<p className="text-xs text-ink3 mt-1 max-w-xs mx-auto">
							{notifications.length === 0
								? "You'll be notified about status updates, replies, and poll results."
								: "Try adjusting your filters to see more."}
						</p>
					</div>
				)}
				{filtered.map((n) => {
					// Belt-and-braces: unknown future kinds render as info
					// instead of crashing on meta.icon.
					const meta = KIND_META[n.kind] ?? KIND_META.info;
					const Icon = meta.icon;
					const ids = n._ids ?? [n.id];
					return (
						<Link
							key={n.id}
							to={n.link || "#"}
							onClick={() => {
								for (const id of ids) markNotifRead(id);
							}}
							className={`vb-notif-item flex items-start gap-3 px-4 py-3 rounded-xl ${n._unread ? "bg-accent-soft/30" : ""}`}
						>
							<div className={`mt-0.5 shrink-0 ${meta.color}`} aria-hidden>
								<Icon size={16} />
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-sm font-medium">
									{n.title}
									{(n._count ?? 0) > 1 && (
										<span className="ml-1.5 text-[10px] font-semibold bg-accent/10 text-accent rounded-full px-1.5 py-0.5">
											×{n._count}
										</span>
									)}
									{n._unread && <span className="sr-only"> (unread)</span>}
								</p>
								<p className="text-xs text-ink3 truncate mt-0.5">{n.body}</p>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{n._unread && (
									<span
										className="w-2 h-2 rounded-full bg-accent"
										aria-hidden
									/>
								)}
								<span className="text-[10px] text-ink3 flex items-center gap-1">
									<Clock size={10} aria-hidden /> {timeAgo(n.at)}
								</span>
							</div>
						</Link>
					);
				})}
			</div>

			{/* Clear all */}
			{notifications.length > 0 && (
				<div className="text-center pt-4 border-t border-border">
					<button
						onClick={clearNotifs}
						className="btn btn-danger !text-xs flex items-center gap-1.5 mx-auto"
					>
						<Trash2 size={13} /> Clear all notifications
					</button>
				</div>
			)}
		</div>
	);
}
