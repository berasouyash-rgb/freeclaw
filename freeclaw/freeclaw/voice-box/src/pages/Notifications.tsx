import {
	AlertCircle,
	BarChart3,
	Bell,
	CheckCheck,
	CheckCircle2,
	ChevronRight,
	Clock,
	ExternalLink,
	Filter,
	Info,
	MessageSquare,
	Send,
	Settings,
	ShieldAlert,
	Trash2,
	X,
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

interface NotificationItemData {
	id: string;
	kind: NotificationKind;
	title: string;
	body: string;
	link?: string;
	at: string;
	read: boolean;
	_count?: number;
	_unread?: boolean;
	_ids?: string[];
}

export default function Notifications() {
	const { notifications, markNotifsRead, markNotifRead, clearNotifs } = useApp();
	const [filter, setFilter] = useState<NotificationKind | "all">("all");
	const [showUnreadOnly, setShowUnreadOnly] = useState(false);
	const [selectedNotif, setSelectedNotif] = useState<NotificationItemData | null>(null);

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

	const filtered = useMemo<NotificationItemData[]>(() => {
		let list = [...notifications];
		if (filter !== "all") list = list.filter((n) => n.kind === filter);
		if (showUnreadOnly) list = list.filter((n) => !n.read);
		const sorted = list.sort(
			(a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
		);

		const grouped: NotificationItemData[] = [];
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

	const handleOpenDetail = (n: NotificationItemData) => {
		const ids = n._ids ?? [n.id];
		for (const id of ids) markNotifRead(id);
		setSelectedNotif(n);
	};

	return (
		<div className="max-w-3xl mx-auto px-4 py-6 space-y-6 vb-page-enter">
			{/* Header */}
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
			<div className="space-y-1.5">
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
					const meta = KIND_META[n.kind] ?? KIND_META.info;
					const Icon = meta.icon;
					return (
						<div
							key={n.id}
							role="link"
							tabIndex={0}
							onClick={() => handleOpenDetail(n)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									handleOpenDetail(n);
								}
							}}
							className={`vb-notif-item flex items-start gap-3.5 px-4 py-3 rounded-xl border border-transparent hover:border-border/60 transition-all cursor-pointer ${
								n._unread
									? "bg-accent-soft/30 dark:bg-white/[0.04]"
									: "hover:bg-surface2/60 dark:hover:bg-white/[0.02]"
							}`}
							aria-label={n.title}
						>
							<div className={`mt-0.5 shrink-0 ${meta.color}`} aria-hidden>
								<Icon size={18} />
							</div>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-1.5 flex-wrap">
									<p className="text-sm font-medium text-ink">
										{n.title}
									</p>
									{(n._count ?? 0) > 1 && (
										<span className="text-[10px] font-semibold bg-accent/10 text-accent rounded-full px-1.5 py-0.5">
											×{n._count}
										</span>
									)}
									{n._unread && <span className="sr-only"> (unread)</span>}
								</div>
								{/* 2-line preview so users can read the notice explanation */}
								<p className="text-xs text-ink3 line-clamp-2 mt-1 leading-relaxed">
									{n.body}
								</p>
							</div>
							<div className="flex items-center gap-2 shrink-0 self-center">
								{n._unread && (
									<span
										className="w-2 h-2 rounded-full bg-accent"
										aria-hidden
									/>
								)}
								<span className="text-[10px] text-ink3 flex items-center gap-1">
									<Clock size={10} aria-hidden /> {timeAgo(n.at)}
								</span>
								<ChevronRight size={14} className="text-ink3/40" aria-hidden />
							</div>
						</div>
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

			{/* Visual Notification Detail & Problem Explanation Modal */}
			{selectedNotif && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
					role="dialog"
					aria-modal="true"
					aria-labelledby="notif-detail-title"
				>
					<div
						className="bg-surface dark:bg-[#14141c] border border-border/80 dark:border-white/10 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 relative overflow-hidden"
					>
						{/* Close button */}
						<button
							onClick={() => setSelectedNotif(null)}
							className="absolute top-4 right-4 p-1.5 rounded-full text-ink3 hover:text-ink hover:bg-surface2 transition-colors cursor-pointer"
							aria-label="Close notification details"
						>
							<X size={18} />
						</button>

						{/* Badge & Type Header */}
						<div className="flex items-center gap-3">
							<div
								className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
									selectedNotif.kind === "warning" || selectedNotif.kind === "suspension" || selectedNotif.kind === "ban"
										? "bg-amber-500/10 text-amber-500"
										: selectedNotif.kind === "moderation"
											? "bg-purple-500/10 text-purple-500"
											: selectedNotif.kind === "status" || selectedNotif.kind === "success"
												? "bg-emerald-500/10 text-emerald-500"
												: "bg-accent/10 text-accent"
								}`}
							>
								{selectedNotif.kind === "warning" || selectedNotif.kind === "suspension" || selectedNotif.kind === "ban" ? (
									<ShieldAlert size={22} />
								) : selectedNotif.kind === "status" ? (
									<CheckCircle2 size={22} />
								) : (
									<Info size={22} />
								)}
							</div>
							<div className="min-w-0 pr-6">
								<span className="text-[10px] font-bold uppercase tracking-wider text-ink3">
									{KIND_META[selectedNotif.kind]?.label || "Official Notice"}
								</span>
								<h2 id="notif-detail-title" className="text-base font-bold text-ink leading-tight mt-0.5">
									{selectedNotif.title}
								</h2>
							</div>
						</div>

						{/* Timestamp & Metadata */}
						<div className="flex items-center gap-2 text-xs text-ink3 pb-1 border-b border-border/60">
							<Clock size={13} />
							<span>{new Date(selectedNotif.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
							<span>•</span>
							<span>{timeAgo(selectedNotif.at)}</span>
						</div>

						{/* Detailed Problem Explanation Box */}
						<div className="space-y-3">
							<div className="p-4 rounded-xl bg-surface2/70 dark:bg-white/[0.04] border border-border/70 space-y-2">
								<p className="text-xs font-semibold uppercase tracking-wider text-ink3">
									Notice Explanation & Details
								</p>
								<p className="text-sm text-ink leading-relaxed whitespace-pre-wrap select-text">
									{selectedNotif.body || "No additional description provided."}
								</p>
							</div>

							{/* Helpful context for moderation notices */}
							{(selectedNotif.kind === "warning" ||
								selectedNotif.kind === "suspension" ||
								selectedNotif.kind === "ban" ||
								selectedNotif.kind === "moderation") && (
								<div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 space-y-1">
									<p className="font-semibold flex items-center gap-1.5">
										<AlertCircle size={14} /> School Moderation & Guidelines
									</p>
									<p className="leading-relaxed opacity-90">
										This action was issued regarding school safety standards. Your anonymous ID remains fully protected. You can inspect all active strikes, account privileges, and resolution options on the My Activity page.
									</p>
								</div>
							)}
						</div>

						{/* Action Buttons */}
						<div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-border/60">
							{selectedNotif.link && selectedNotif.link.startsWith("/post/") && (
								<Link
									to={selectedNotif.link}
									onClick={() => setSelectedNotif(null)}
									className="btn btn-primary !text-xs !py-2 !px-4 flex items-center gap-1.5"
								>
									<ExternalLink size={14} /> View Affected Post
								</Link>
							)}
							{(selectedNotif.kind === "warning" ||
								selectedNotif.kind === "suspension" ||
								selectedNotif.kind === "ban" ||
								selectedNotif.kind === "moderation") && (
								<Link
									to="/activity"
									onClick={() => setSelectedNotif(null)}
									className="btn btn-secondary !text-xs !py-2 !px-4 flex items-center gap-1.5"
								>
									<ShieldAlert size={14} /> View My Activity & Strikes
								</Link>
							)}
							<button
								onClick={() => setSelectedNotif(null)}
								className="btn btn-ghost !text-xs !py-2 !px-4 cursor-pointer"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
