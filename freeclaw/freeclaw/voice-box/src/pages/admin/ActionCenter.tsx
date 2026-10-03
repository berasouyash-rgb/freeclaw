import {
	ArrowUpRight,
	CheckCircle2,
	ClipboardList,
	Flag,
	Inbox,
	RefreshCw,
	ShieldAlert,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import UpdateNotice from "../../components/admin/UpdateNotice";
import { useUpdateSignal } from "../../hooks/useUpdateSignal";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import { timeAgo } from "../../lib/utils";

export interface ActionCenterTask {
	id: string;
	status: string;
	category: string;
	title: string;
	created_at: string;
	resolved_at: string | null;
	resolution: string | null;
}

export interface ActionCenterSummary {
	generated_at: string;
	total: number;
	open: number;
	critical: number;
	by_category: Array<{ category: string; label: string; count: number }>;
	recent: ActionCenterTask[];
}

const SUMMARY_ENDPOINT = "/api/action-center?action=summary";
const TERMINAL_STATUSES = new Set(["RESOLVED", "DISMISSED", "CLOSED"]);

function errorText(error: unknown): string {
	return error instanceof Error
		? error.message
		: "The Action Center could not be reached right now.";
}

function isSummary(value: unknown): value is ActionCenterSummary {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<ActionCenterSummary>;
	return (
		typeof candidate.generated_at === "string" &&
		typeof candidate.total === "number" &&
		typeof candidate.open === "number" &&
		typeof candidate.critical === "number" &&
		Array.isArray(candidate.by_category) &&
		Array.isArray(candidate.recent)
	);
}

function openAdminTab(tab: string) {
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: tab }));
	}
}

function taskStatus(task: ActionCenterTask): string {
	if (task.resolved_at || TERMINAL_STATUSES.has(task.status.toUpperCase())) {
		return task.resolution || "Resolved";
	}
	return task.status.replaceAll("_", " ").toLowerCase();
}

export default function ActionCenter() {
	const [snapshot, setSnapshot] = useState<ActionCenterSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
	const snapshotRef = useRef<ActionCenterSummary | null>(null);
	const requestIdRef = useRef(0);
	const {
		updatesAvailable,
		markUpdatesAvailable,
		clearUpdates,
	} = useUpdateSignal();

	const loadSnapshot = useCallback(async (fresh = false): Promise<boolean> => {
		const requestId = ++requestIdRef.current;
		setRefreshing(true);
		if (!snapshotRef.current) setLoading(true);
		try {
			const result = fresh
				? await api.getFresh<ActionCenterSummary>(SUMMARY_ENDPOINT)
				: await api.get<ActionCenterSummary>(SUMMARY_ENDPOINT);
			if (requestId !== requestIdRef.current || !isSummary(result)) {
				if (requestId === requestIdRef.current) {
					setError("The Action Center returned an incomplete snapshot.");
				}
				return false;
			}
			snapshotRef.current = result;
			setSnapshot(result);
			setLastUpdatedAt(Date.now());
			setError(null);
			return true;
		} catch (loadError: unknown) {
			if (requestId === requestIdRef.current) setError(errorText(loadError));
			return false;
		} finally {
			if (requestId === requestIdRef.current) {
				setLoading(false);
				setRefreshing(false);
			}
		}
	}, []);

	useEffect(() => {
		void loadSnapshot();
	}, [loadSnapshot]);

	useRealtime(
		["reports", "posts", "polls", "poll_votes"],
		markUpdatesAvailable,
		1_000,
	);

	const handleViewUpdates = async () => {
		if (await loadSnapshot(true)) clearUpdates();
	};

	const openTasks = (snapshot?.recent ?? []).filter(
		(task) => !task.resolved_at && !TERMINAL_STATUSES.has(task.status.toUpperCase()),
	);
	const outcomes = (snapshot?.recent ?? []).filter(
		(task) => task.resolved_at || TERMINAL_STATUSES.has(task.status.toUpperCase()),
	);
	const categories = (snapshot?.by_category ?? []).filter(
		(category) => category.count > 0,
	);

	return (
		<div className="space-y-5" data-testid="action-center">
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
						Admin workspace
					</p>
					<h1 className="font-display text-2xl font-bold text-ink mt-1">
						Action Center
					</h1>
					<p className="text-sm text-ink2 mt-1 max-w-2xl">
						Human-required work, verified outcomes, and the state of the
						admin queue in one calm snapshot.
					</p>
				</div>
				<button
					type="button"
					className="btn btn-soft !text-xs"
					onClick={() => void loadSnapshot(true)}
					disabled={refreshing}
					aria-label="Refresh Action Center"
				>
					<RefreshCw
						size={13}
						aria-hidden
						className={refreshing ? "animate-spin" : ""}
					/>
					{refreshing ? "Refreshing…" : "Refresh"}
				</button>
			</header>

			{error && (
				<div
					role="alert"
					className="card border-warn/30 bg-warn/[0.06] p-4 text-sm text-ink2"
				>
					<p className="font-semibold">
						{snapshot ? "Showing the last known snapshot." : "Action Center unavailable."}
					</p>
					<p className="text-xs text-ink3 mt-1">{error}</p>
				</div>
			)}

			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => void handleViewUpdates()}
				refreshing={refreshing}
				lastUpdatedAt={lastUpdatedAt}
			/>

			{loading && !snapshot ? (
				<div className="space-y-3" aria-busy="true" aria-label="Loading Action Center">
					<div className="skeleton h-24" />
					<div className="skeleton h-40" />
				</div>
			) : snapshot ? (
				<>
					<section aria-labelledby="attention-heading" className="space-y-3">
						<div className="flex items-center justify-between gap-3">
							<h2 id="attention-heading" className="font-display text-lg font-semibold text-ink">
								Needs attention
							</h2>
							<span className="text-xs text-ink3">
								{lastUpdatedAt ? `Updated ${timeAgo(new Date(lastUpdatedAt).toISOString())}` : "Snapshot loaded"}
							</span>
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
							<div className="card p-4">
								<p className="text-xs text-ink3">Open work</p>
								<p className="font-display text-2xl font-bold text-ink mt-1">{snapshot.open}</p>
							</div>
							<div className="card p-4">
								<p className="text-xs text-ink3">Critical</p>
								<p className="font-display text-2xl font-bold text-bad mt-1">{snapshot.critical}</p>
							</div>
							<div className="card p-4">
								<p className="text-xs text-ink3">Recorded tasks</p>
								<p className="font-display text-2xl font-bold text-ink mt-1">{snapshot.total}</p>
							</div>
						</div>
						{categories.length ? (
							<div className="card divide-y divide-[var(--vb-border)]">
								{categories.map((category) => (
									<button
										key={category.category}
										type="button"
										className="w-full flex items-center justify-between gap-3 p-3.5 text-left hover:bg-[var(--vb-surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
										onClick={() => openAdminTab(category.category === "CRITICAL_MODERATION" ? "reports" : "reports")}
									>
										<span className="flex items-center gap-2 text-sm text-ink2">
											<Flag size={14} className="text-warn" aria-hidden />
											{category.label}
										</span>
										<span className="flex items-center gap-2 text-xs font-semibold text-ink2">
											{category.count} open <ArrowUpRight size={13} aria-hidden />
										</span>
									</button>
								))}
							</div>
						) : (
							<div className="card p-4 text-sm text-ink2">No human-required work is waiting.</div>
						)}
						{openTasks.length ? (
							<div className="card divide-y divide-[var(--vb-border)]">
								{openTasks.map((task) => (
									<button
										key={task.id}
										type="button"
										className="w-full flex items-start gap-3 p-3.5 text-left hover:bg-[var(--vb-surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
										onClick={() => openAdminTab("reports")}
									>
										<ShieldAlert size={18} className="text-accent shrink-0 mt-0.5" aria-hidden />
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-semibold text-ink">{task.title}</span>
											<span className="block text-xs text-ink3 mt-1">
												{taskStatus(task)} · opened {timeAgo(task.created_at)}
											</span>
										</span>
										<ArrowUpRight size={13} className="shrink-0 mt-1 text-ink3" aria-hidden />
									</button>
								))}
							</div>
						) : null}
					</section>

					<section aria-labelledby="outcomes-heading" className="space-y-3">
						<div className="flex items-center justify-between gap-3">
							<h2 id="outcomes-heading" className="font-display text-lg font-semibold text-ink">
								Recent outcomes
							</h2>
							<button type="button" className="btn btn-ghost !text-xs" onClick={() => openAdminTab("reports")}>
								Open reports <ArrowUpRight size={13} aria-hidden />
							</button>
						</div>
						{outcomes.length ? (
							<div className="card divide-y divide-[var(--vb-border)]">
								{outcomes.map((task) => (
									<div key={task.id} className="p-3.5 flex items-start gap-3">
										<CheckCircle2 size={16} className="text-good shrink-0 mt-0.5" aria-hidden />
										<div className="min-w-0">
											<p className="text-sm font-medium text-ink2">{task.title}</p>
											<p className="text-xs text-ink3 mt-1">
												{taskStatus(task)} · {timeAgo(task.resolved_at || task.created_at)}
											</p>
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="card p-4 text-sm text-ink2">No verified outcomes yet.</div>
						)}
					</section>

					<nav aria-label="Admin workspaces" className="grid grid-cols-2 sm:grid-cols-5 gap-2">
						<button type="button" className="btn btn-soft !text-xs justify-start" onClick={() => openAdminTab("reports")}>
							<Flag size={13} aria-hidden /> Reports
						</button>
						<button type="button" className="btn btn-soft !text-xs justify-start" onClick={() => openAdminTab("posts")}>
							<ClipboardList size={13} aria-hidden /> Feed
						</button>
						<button type="button" className="btn btn-soft !text-xs justify-start" onClick={() => openAdminTab("users")}>
							<Users size={13} aria-hidden /> Users
						</button>
						<button type="button" className="btn btn-soft !text-xs justify-start" onClick={() => openAdminTab("polls")}>
							<ClipboardList size={13} aria-hidden /> Polls
						</button>
						<button type="button" className="btn btn-soft !text-xs justify-start" onClick={() => openAdminTab("inbox")}>
							<Inbox size={13} aria-hidden /> Inbox
						</button>
					</nav>
				</>
			) : (
				<div className="card p-5 text-sm text-ink2">No Action Center snapshot is available.</div>
			)}
		</div>
	);
}
