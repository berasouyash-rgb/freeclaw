// ═══════════════════════════════════════════════════════════════════
// ACTIVITY STREAM — Real-time operational events
// ═══════════════════════════════════════════════════════════════════
// Shows real platform events: posts, reports, security, worker activity.
// Every event comes from the actual event log or database — no fabrication.
// ═══════════════════════════════════════════════════════════════════

import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	Clock,
	MessageCircle,
	Megaphone,
	Radio,
	RefreshCw,
	Search,
	Shield,
	ShieldAlert,
	ThumbsUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import { useUpdateSignal } from "../../hooks/useUpdateSignal";
import { useAdminStream } from "../../hooks/useAdminStream";
import UpdateNotice from "../../components/admin/UpdateNotice";

interface ActivityEvent {
	id: string;
	type: string;
	source: string;
	severity: "info" | "low" | "medium" | "high" | "critical";
	target?: string;
	result?: string;
	created_at: string;
	[key: string]: unknown;
}

const EVENT_CONFIG: Record<string, { icon: typeof Megaphone; color: string; label: string }> = {
	"post.created": { icon: Megaphone, color: "var(--vb-accent)", label: "Post Created" },
	"post.updated": { icon: Megaphone, color: "var(--vb-accent)", label: "Post Updated" },
	"post.status_changed": { icon: CheckCircle2, color: "var(--vb-good)", label: "Status Changed" },
	"comment.created": { icon: MessageCircle, color: "var(--vb-accent2)", label: "Comment" },
	"reaction.added": { icon: ThumbsUp, color: "var(--vb-accent)", label: "Reaction" },
	"user.reported": { icon: ShieldAlert, color: "var(--vb-bad)", label: "User Reported" },
	"moderation.flagged": { icon: Shield, color: "var(--vb-warn)", label: "Moderation Flag" },
	"agent.completed": { icon: Bot, color: "var(--vb-accent)", label: "Agent Completed" },
	"system.alert": { icon: AlertTriangle, color: "var(--vb-warn)", label: "System Alert" },
	"task.created": { icon: Clock, color: "var(--vb-accent2)", label: "Task Created" },
	"task.assigned": { icon: Bot, color: "var(--vb-accent)", label: "Task Assigned" },
	"task.completed": { icon: CheckCircle2, color: "var(--vb-good)", label: "Task Completed" },
	"task.failed": { icon: AlertTriangle, color: "var(--vb-bad)", label: "Task Failed" },
	"security.event": { icon: Shield, color: "var(--vb-bad)", label: "Security Event" },
	"performance.regression": { icon: AlertTriangle, color: "var(--vb-warn)", label: "Perf Regression" },
};

const SEVERITY_CONFIG: Record<string, { color: string; bg: string }> = {
	info: { color: "#3b82f6", bg: "rgba(59,130,246,0.08)" },
	low: { color: "#6b7280", bg: "rgba(107,114,128,0.08)" },
	medium: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
	high: { color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
	critical: { color: "#dc2626", bg: "rgba(220,38,38,0.08)" },
};

/** Typed lookup that narrows Record<string,T> access to non-undefined. */
function getSeverityCfg(severity: string): { color: string; bg: string } {
	return SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info ?? { color: "#6b7280", bg: "rgba(107,114,128,0.08)" };
}

function timeAgo(date: string) {
	const ms = Date.now() - +new Date(date);
	if (ms < 60_000) return "just now";
	if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
	if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
	return `${Math.floor(ms / 86400_000)}d ago`;
}

export default function ActivityStream() {
	const [events, setEvents] = useState<ActivityEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [filter, setFilter] = useState<string>("all");
	const [searchQuery, setSearchQuery] = useState("");

	const loadEvents = useCallback(async () => {
		setLoading(true);
		try {
			// ops-summary is the single source: it carries recent_tasks (real
			// task rows with ids) and recent (agent executions). A previous
			// revision read `events` and `tasks?action=ledger` — keys the
			// server never sends — so the stream rendered permanently empty.
			const res = await api
				.get<{
					recent_tasks?: Array<{
						id: string;
						title?: string;
						status?: string;
						priority?: string;
						assigned_agent?: string | null;
						error?: string | null;
						created_at?: string;
						completed_at?: string | null;
					}>;
					recent?: Array<{
						worker?: string;
						action?: string;
						at?: string;
						impact?: string;
					}>;
				}>("/api/workforce?action=ops-summary");

			const taskEvents: ActivityEvent[] = (res.recent_tasks ?? []).map(
				(t) => ({
					id: String(t.id),
					type:
						t.status === "completed"
							? "task.completed"
							: t.status === "failed"
								? "task.failed"
								: "task.created",
					source: t.assigned_agent || "workforce",
					// Task PRIORITY is not a severity — map it explicitly.
					// Passing it through raw produced severities like
					// "urgent"/"p0" that match no filter button (invisible
					// unless filter=all) and inflated phantom severity counts.
					severity: (t.status === "failed"
						? "high"
						: ["critical", "urgent", "high"].includes(
								String(t.priority || "").toLowerCase(),
							)
							? "high"
							: String(t.priority || "").toLowerCase() === "medium"
								? "medium"
								: String(t.priority || "").toLowerCase() === "low"
									? "low"
									: "info") as ActivityEvent["severity"],
					target: t.title || "Untitled task",
					result: t.error || undefined,
					created_at:
						t.completed_at || t.created_at || new Date().toISOString(),
				}),
			);
			const execEvents: ActivityEvent[] = (res.recent ?? []).map((e, i) => ({
				id: `exec-${e.at || "na"}-${e.worker || "agent"}-${i}`,
				type: /fail/i.test(e.action || "")
					? "task.failed"
					: "agent.completed",
				source: e.worker || "workforce",
				severity: (/fail/i.test(e.action || "") ? "high" : "info") as ActivityEvent["severity"],
				target: e.action || "agent run",
				result: e.impact || undefined,
				created_at: e.at || new Date().toISOString(),
			}));
			const rawEvents = [...taskEvents, ...execEvents];

			// Deduplicate by id — tasks carry real ids; executions don't, so
			// they key on content. (Id-only dedupe used to collapse every
			// id-less row into one and silently drop events.)
			const seen = new Set<string>();
			const unique = rawEvents
				.filter((e) => {
					const key = e.id.startsWith("exec-") ? e.id : `row-${e.id}`;
					if (seen.has(key)) return false;
					seen.add(key);
					return true;
				})
				.sort(
					(a, b) =>
						+new Date(b.created_at) - +new Date(a.created_at),
				)
				.slice(0, 100);

			setEvents(unique);
			setLoadError(null);
		} catch (error: unknown) {
			setLoadError(
				error instanceof Error
					? error.message
					: "The activity service did not respond.",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadEvents();
	}, [loadEvents]);

	// Freshness signal only — the four tables here are the highest-write in
	// the app, and refetching the whole activity list per event is the
	// original "it keeps reloading" storm. Badge, then an explicit load.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();
	useRealtime(
		["agent_tasks", "agent_executions", "posts", "reports"],
		markUpdatesAvailable,
		1_000,
	);
	// Admin stream covers what the anon channel cannot (reports have no
	// anon read; agent tables are not published at all): same pill.
	useAdminStream(markUpdatesAvailable);

	const filtered = useMemo(() => {
		let list = events;
		if (filter !== "all") {
			list = list.filter((e) => e.severity === filter);
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			list = list.filter(
				(e) =>
					e.type.toLowerCase().includes(q) ||
					(e.target || "").toLowerCase().includes(q) ||
					(e.source || "").toLowerCase().includes(q),
			);
		}
		return list;
	}, [events, filter, searchQuery]);

	const severityCounts = useMemo(() => {
		const counts: Record<string, number> = { all: events.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
		events.forEach((e) => {
			counts[e.severity] = (counts[e.severity] || 0) + 1;
		});
		return counts;
	}, [events]);

	return (
		<div className="space-y-4 vb-tab-enter">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-display font-bold text-xl flex items-center gap-2 tracking-tight">
						<Radio size={20} className="text-accent" />
						<span className="vb-gradient-text">Activity Stream</span>
					</h1>
					<p className="text-xs text-ink3 mt-1">
						Real-time platform events · {events.length} events loaded
					</p>
				</div>
				<button
					className="btn btn-soft !py-2 !px-3 text-xs flex items-center gap-1.5"
					onClick={() => {
						// Silent refresh: keep stale rows on screen instead of
						// flashing skeletons on every manual reload.
						void loadEvents();
					}}
				>
					<RefreshCw size={13} /> Refresh
				</button>
			</div>

			{loadError && events.length > 0 && (
				<div
					role="alert"
					className="card border-warn/30 bg-warn/[0.06] p-4 flex flex-col sm:flex-row sm:items-center gap-3"
				>
					<AlertTriangle size={18} className="text-warn shrink-0" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold text-ink2">
							Showing last known events
						</p>
						<p className="text-xs text-ink3 mt-0.5">
							The activity refresh failed. Existing events are preserved.
						</p>
					</div>
					<button
						type="button"
						className="btn btn-soft !text-xs shrink-0"
						onClick={() => void loadEvents()}
					>
						Retry
					</button>
				</div>
			)}

			{loadError && events.length === 0 && !loading && (
				<div
					role="alert"
					className="card border-warn/30 bg-warn/[0.06] p-4 flex flex-col sm:flex-row sm:items-center gap-3"
				>
					<AlertTriangle size={18} className="text-warn shrink-0" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold text-ink2">
							Couldn&apos;t load activity events
						</p>
						<p className="text-xs text-ink3 mt-0.5">
							{loadError}
						</p>
					</div>
					<button
						type="button"
						className="btn btn-soft !text-xs shrink-0"
						onClick={() => void loadEvents()}
					>
						Try again
					</button>
				</div>
			)}

			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => {
					clearUpdates();
					void loadEvents();
				}}
			/>

			{/* Filters */}
			<div className="flex flex-wrap gap-2">
				<div className="relative flex-1 min-w-48">
					<Search
						size={14}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3"
					/>
					<input
						className="input !pl-8 !py-2 text-sm"
						placeholder="Search events..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
				</div>
				<div className="flex gap-1">
					{["all", "critical", "high", "medium", "low", "info"].map((s) => (
						<button
							key={s}
							onClick={() => setFilter(s)}
							className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
								filter === s
									? "bg-accent/10 text-accent"
									: "text-ink3 hover:text-ink2"
							}`}
						>
							{s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}								{(severityCounts[s] ?? 0) > 0 && (
									<span className="ml-1 text-[10px] opacity-60">
										{severityCounts[s] ?? 0}
									</span>
								)}
						</button>
					))}
				</div>
			</div>

			{/* Event List */}
			{loading && events.length === 0 ? (
				<div className="space-y-2">
					{[1, 2, 3, 4, 5].map((i) => (
						<div key={i} className="skeleton h-16" />
					))}
				</div>
			) : loadError && events.length === 0 ? null : filtered.length === 0 ? (
				<div className="card p-10 text-center">
					<Radio size={24} className="mx-auto mb-2 text-ink3" />
					<p className="text-sm text-ink3">
						{events.length === 0
							? "No events recorded yet"
							: "No events match your filter"}
					</p>
				</div>
			) : (
				<div className="space-y-1">
					{filtered.map((event) => {
						const cfg = EVENT_CONFIG[event.type] || {
							icon: Radio,
							color: "var(--vb-ink3)",
							label: event.type,
						};
						const sevCfg = getSeverityCfg(event.severity);
						const Icon = cfg.icon;

						return (
							<div
								key={event.id}
								className="card px-4 py-3 flex items-center gap-3 hover:bg-surface2/60 transition-colors"
							>
								<div
									className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
									style={{ background: sevCfg.bg }}
								>
									<Icon size={15} style={{ color: cfg.color }} />
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-sm font-semibold truncate">
											{cfg.label}
										</span>
										{event.target && (
											<span className="text-xs text-ink3 truncate">
												· {event.target}
											</span>
										)}
									</div>
									{event.result && (
										<p className="text-xs text-ink3 truncate mt-0.5">
											{event.result}
										</p>
									)}
								</div>
								<div className="flex items-center gap-2 shrink-0">
									<span
										className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
										style={{ color: sevCfg.color, background: sevCfg.bg }}
									>
										{event.severity}
									</span>
									<span className="text-[11px] text-ink3 whitespace-nowrap">
										{timeAgo(event.created_at)}
									</span>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
