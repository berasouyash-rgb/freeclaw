// ═══════════════════════════════════════════════════════════════════
// SECURITY CENTER — Security operations and event monitoring
// ═══════════════════════════════════════════════════════════════════
// Shows real security events: auth failures, rate limits, suspicious
// activity, PII detections. No fabricated security metrics.
// ═══════════════════════════════════════════════════════════════════

import {
	AlertTriangle,
	Eye,
	RefreshCw,
	Search,
	Shield,
	ShieldAlert,
	ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import { useUpdateSignal } from "../../hooks/useUpdateSignal";
import UpdateNotice from "../../components/admin/UpdateNotice";

interface SecurityEvent {
	id: string;
	type: string;
	severity: "info" | "low" | "medium" | "high" | "critical";
	source: string;
	description: string;
	target?: string;
	action_taken?: string;
	created_at: string;
}

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; icon: typeof Shield }> = {
	info: { color: "#3b82f6", bg: "rgba(59,130,246,0.08)", icon: Eye },
	low: { color: "#6b7280", bg: "rgba(107,114,128,0.08)", icon: Shield },
	medium: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", icon: AlertTriangle },
	high: { color: "#ef4444", bg: "rgba(239,68,68,0.08)", icon: ShieldAlert },
	critical: { color: "#dc2626", bg: "rgba(220,38,38,0.08)", icon: ShieldAlert },
};

/** Typed lookup that narrows Record<string,T> access to non-undefined. */
function getSeverityCfg(severity: string): { color: string; bg: string; icon: typeof Shield } {
	return SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info ?? { color: "#6b7280", bg: "rgba(107,114,128,0.08)", icon: Shield };
}

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
	"auth.failure": { label: "Auth Failure", color: "var(--vb-bad)" },
	"rate.limit": { label: "Rate Limited", color: "var(--vb-warn)" },
	"suspicious.activity": { label: "Suspicious Activity", color: "var(--vb-bad)" },
	"pii.detected": { label: "PII Detected", color: "var(--vb-warn)" },
	"permission.denied": { label: "Permission Denied", color: "var(--vb-bad)" },
	"security.scan": { label: "Security Scan", color: "var(--vb-accent)" },
	"injection.detected": { label: "Injection Attempt", color: "#dc2626" },
	"abuse.detected": { label: "Abuse Detected", color: "var(--vb-bad)" },
};

function timeAgo(date: string) {
	const ms = Date.now() - +new Date(date);
	if (ms < 60_000) return "just now";
	if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
	if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
	return `${Math.floor(ms / 86400_000)}d ago`;
}

export default function SecurityCenter() {
	const [events, setEvents] = useState<SecurityEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [filter, setFilter] = useState<string>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [lastUpdate, setLastUpdate] = useState<string | null>(null);

	const loadEvents = useCallback(async () => {
		setLoading(true);
		try {
			const r = await api.get<{ events?: SecurityEvent[] }>(
				"/api/security?action=events",
			);
			setEvents((r.events ?? []).sort(
				(a, b) => +new Date(b.created_at) - +new Date(a.created_at),
			));
			setLastUpdate(new Date().toISOString());
			setLoadError(null);
		} catch (error: unknown) {
			setLoadError(
				error instanceof Error
					? error.message
					: "The security service did not respond.",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadEvents();
	}, [loadEvents]);

	// Freshness signal only — settings writes are rare but the 5s refetch
	// still fired on every unrelated change to the settings table. Badge
	// first, load on demand.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();
	useRealtime(["settings"], markUpdatesAvailable, 1_000);

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
					e.description.toLowerCase().includes(q) ||
					(e.target || "").toLowerCase().includes(q),
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
						<Shield size={20} className="text-accent" />
						<span className="vb-gradient-text">Security Center</span>
					</h1>
					<p className="text-xs text-ink3 mt-1">
						{lastUpdate
							? `Last updated ${new Date(lastUpdate).toLocaleTimeString()}`
							: "Loading..."}{" "}
						· {events.length} events
					</p>
				</div>
				<button
					className="btn btn-soft !py-2 !px-3 text-xs flex items-center gap-1.5"
					onClick={() => {
						// Silent refresh: keep current readings instead of
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
							The security refresh failed. Existing events are preserved.
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
							Couldn&apos;t load security events
						</p>
						<p className="text-xs text-ink3 mt-0.5">{loadError}</p>
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

			{/* Summary Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				{[
					{ label: "Critical", count: severityCounts.critical, color: "#dc2626", bg: "rgba(220,38,38,0.08)" },
					{ label: "High", count: severityCounts.high, color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
					{ label: "Medium", count: severityCounts.medium, color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },						{ label: "Info", count: (severityCounts.info ?? 0) + (severityCounts.low ?? 0), color: "#3b82f6", bg: "rgba(59,130,246,0.08)" },
				].map(({ label, count, color, bg: _bg }) => (
					<div key={label} className="card p-3" style={{ borderLeft: `3px solid ${color}` }}>
						<p className="text-[10px] font-bold uppercase tracking-wider text-ink3">{label}</p>
						<p className="font-display font-bold text-2xl mt-1" style={{ color }}>
							{count}
						</p>
					</div>
				))}
			</div>

			{/* Filters */}
			<div className="flex flex-wrap gap-2">
				<div className="relative flex-1 min-w-48">
					<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
					<input
						className="input !pl-8 !py-2 text-sm"
						placeholder="Search security events..."
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
								filter === s ? "bg-accent/10 text-accent" : "text-ink3 hover:text-ink2"
							}`}
						>
							{s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
						</button>
					))}
				</div>
			</div>

			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => {
					clearUpdates();
					void loadEvents();
				}}
			/>

			{/* Events List */}
			{loading && events.length === 0 ? (
				<div className="space-y-2">
					{[1, 2, 3, 4, 5].map((i) => (
						<div key={i} className="skeleton h-16" />
					))}
				</div>
			) : loadError && events.length === 0 ? null : filtered.length === 0 ? (
				<div className="card p-10 text-center">
					<ShieldCheck size={24} className="mx-auto mb-2 text-good" />
					<p className="text-sm text-ink3">
						{events.length === 0
							? "No security events recorded"
							: "No events match your filter"}
					</p>
				</div>
			) : (
				<div className="space-y-1">
					{filtered.map((event) => {
						const sevCfg = getSeverityCfg(event.severity);
						const typeCfg = EVENT_TYPE_CONFIG[event.type] || { label: event.type, color: "var(--vb-ink3)" };
						const SevIcon = sevCfg.icon;

						return (
							<div
								key={event.id}
								className="card px-4 py-3 flex items-center gap-3 hover:bg-surface2/60 transition-colors"
							>
								<div
									className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
									style={{ background: sevCfg.bg }}
								>
									<SevIcon size={15} style={{ color: sevCfg.color }} />
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-sm font-semibold" style={{ color: typeCfg.color }}>
											{typeCfg.label}
										</span>
										{event.target && (
											<span className="text-xs text-ink3 truncate">· {event.target}</span>
										)}
									</div>
									<p className="text-xs text-ink3 truncate mt-0.5">
										{event.description}
									</p>
									{event.action_taken && (
										<p className="text-[10px] text-good mt-0.5">
											Action: {event.action_taken}
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
