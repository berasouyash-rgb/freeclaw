// ═══════════════════════════════════════════════════════════════════
// SYSTEM HEALTH — Interactive system map with real health data
// ═══════════════════════════════════════════════════════════════════
// Each node represents a real subsystem with actual health status.
// Clicking a node opens a detailed operational view.
// No decorative values — every status comes from /api/health.
// ═══════════════════════════════════════════════════════════════════

import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Database,
	HardDrive,
	Radio,
	RefreshCw,
	Search,
	Server,
	Shield,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

interface SubsystemHealth {
	name: string;
	status: "healthy" | "degraded" | "warning" | "critical" | "unknown";
	latency_ms?: number;
	error_rate?: number;
	last_check?: string;
	details?: Record<string, unknown>;
}

interface HealthResponse {
	status: string;
	subsystems: SubsystemHealth[];
	overall_score: number;
	checked_at: string;
	database?: SubsystemHealth;
	api?: SubsystemHealth;
	realtime?: SubsystemHealth;
	search?: SubsystemHealth;
	cache?: SubsystemHealth;
	storage?: SubsystemHealth;
	workers?: SubsystemHealth;
	security?: SubsystemHealth;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof CheckCircle2 }> = {
	healthy: { color: "#22c55e", bg: "rgba(34,197,94,0.12)", icon: CheckCircle2 },
	degraded: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: AlertTriangle },
	warning: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: AlertTriangle },
	critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", icon: AlertTriangle },
	unknown: { color: "#6b7280", bg: "rgba(107,114,128,0.12)", icon: Clock },
};

/** Typed lookup that narrows Record<string,T> access to non-undefined. */
function getStatusCfg(status: string): { color: string; bg: string; icon: typeof CheckCircle2 } {
	return STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown ?? { color: "#6b7280", bg: "rgba(107,114,128,0.12)", icon: Clock };
}

const SUBSYSTEM_ICONS: Record<string, typeof Database> = {
	database: Database,
	api: Server,
	realtime: Radio,
	search: Search,
	cache: HardDrive,
	storage: HardDrive,
	workers: Activity,
	security: Shield,
};

export default function SystemHealth() {
	const [health, setHealth] = useState<HealthResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [selectedNode, setSelectedNode] = useState<string | null>(null);
	const [lastUpdate, setLastUpdate] = useState<string | null>(null);

	const loadHealth = useCallback(async () => {
		try {
			const r = await api.get<HealthResponse>("/api/health");
			setHealth(r);
			setLastUpdate(new Date().toISOString());
		} catch {
			setHealth({
				status: "unknown",
				subsystems: [],
				overall_score: 0,
				checked_at: new Date().toISOString(),
			});
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		void loadHealth();
	}, [loadHealth]);

	// The visible Refresh control is the only refresh boundary for this
	// read-only health view; a quiet page does not poll the database.

	const subsystems: SubsystemHealth[] = health?.subsystems ?? [];
	const overallStatus = health?.status ?? "unknown";
	// Clamp: a bad/missing server value must never render NaN or overflow
	// the score ring.
	const overallScore = Math.max(
		0,
		Math.min(100, Number(health?.overall_score) || 0),
	);
	const cfg = getStatusCfg(overallStatus);

	const selectedDetail = selectedNode
		? subsystems.find((s) => s.name === selectedNode)
		: null;

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between vb-tab-enter">
				<div>
					<h1 className="font-display font-bold text-xl flex items-center gap-2 tracking-tight">
						<Server size={20} className="text-accent" />
						<span className="vb-gradient-text">System Health</span>
					</h1>
					<p className="text-xs text-ink3 mt-1">
						{lastUpdate
							? `Last checked ${new Date(lastUpdate).toLocaleTimeString()}`
							: "Loading..."}
					</p>
				</div>
				<button
					className="btn btn-soft !py-2 !px-3 text-xs flex items-center gap-1.5"
					// Silent refresh: keep current readings on screen instead
					// of flashing skeletons on every manual reload.
					onClick={() => {
						void loadHealth();
					}}
				>
					<RefreshCw size={13} /> Refresh
				</button>
			</div>

			{loading ? (
				<div className="space-y-4">
					<div className="skeleton h-48" />
					<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
						{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
							<div key={i} className="skeleton h-28" />
						))}
					</div>
				</div>
			) : (
				<>
					{/* Overall Health */}
					<div className="card p-6 flex items-center gap-6">
						<div className="relative w-24 h-24 shrink-0">
							<svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
								<circle
									cx="50"
									cy="50"
									r="42"
									fill="none"
									stroke="var(--vb-border)"
									strokeWidth="6"
								/>
								<circle
									cx="50"
									cy="50"
									r="42"
									fill="none"
									stroke={cfg.color}
									strokeWidth="6"
									strokeLinecap="round"
									strokeDasharray={`${(overallScore / 100) * 264} 264`}
									className="transition-all duration-1000"
								/>
							</svg>
							<div className="absolute inset-0 flex flex-col items-center justify-center">
								<span className="font-display font-bold text-2xl" style={{ color: cfg.color }}>
									{overallScore}
								</span>
								<span className="text-[9px] text-ink3 uppercase tracking-wider">Score</span>
							</div>
						</div>
						<div className="flex-1">
							<div className="flex items-center gap-2 mb-1">
								<div
									className="w-3 h-3 rounded-full"
									style={{ background: cfg.color }}
								/>
								<span className="font-display font-bold text-lg capitalize">
									{overallStatus}
								</span>
							</div>
							<p className="text-sm text-ink3">
								{overallStatus === "healthy"
									? "All subsystems operating normally"
									: overallStatus === "degraded"
										? "Some subsystems experiencing issues"
										: overallStatus === "critical"
											? "Critical issues detected — investigate immediately"
											: "System status unknown"}
							</p>
						</div>
					</div>

					{/* Subsystem Grid */}
					<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
						{subsystems.map((s) => {
							const sCfg = getStatusCfg(s.status);
							const Icon = SUBSYSTEM_ICONS[s.name] ?? Server;
							const isSelected = selectedNode === s.name;

							return (
								<button
									key={s.name}
									type="button"
									onClick={() => setSelectedNode(isSelected ? null : s.name)}
									className={`card p-4 text-left transition-all ${
										isSelected
											? "ring-2 ring-accent/50 shadow-lg"
											: "hover:shadow-md"
									}`}
								>
									<div className="flex items-center gap-2 mb-2">
										<div
											className="w-8 h-8 rounded-lg flex items-center justify-center"
											style={{ background: sCfg.bg }}
										>
											<Icon size={16} style={{ color: sCfg.color }} />
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-xs font-semibold capitalize truncate">
												{s.name}
											</p>
											<div className="flex items-center gap-1">
												<div
													className="w-1.5 h-1.5 rounded-full"
													style={{ background: sCfg.color }}
												/>
												<span
													className="text-[10px] font-medium capitalize"
													style={{ color: sCfg.color }}
												>
													{s.status}
												</span>
											</div>
										</div>
									</div>
									{s.latency_ms !== undefined && (
										<p className="text-[10px] text-ink3">
											Latency: <span className="font-mono">{s.latency_ms}ms</span>
										</p>
									)}
									{s.error_rate !== undefined && s.error_rate > 0 && (
										<p className="text-[10px] text-bad">
											Error rate: <span className="font-mono">{s.error_rate}%</span>
										</p>
									)}
								</button>
							);
						})}
					</div>

					{/* Detail Panel */}
					{selectedDetail && (
						<div className="card p-5 vb-rise">
							<div className="flex items-center gap-3 mb-4">
								<div
									className="w-10 h-10 rounded-xl flex items-center justify-center"
									style={{
										background:
											STATUS_CONFIG[selectedDetail.status]?.bg ?? "transparent",
									}}
								>
									{(() => {
										const Icon =
											SUBSYSTEM_ICONS[selectedDetail.name] ?? Server;
										return (
											<Icon
												size={20}
												style={{
													color:
														STATUS_CONFIG[selectedDetail.status]?.color ??
														"#888",
												}}
											/>
										);
									})()}
								</div>
								<div>
									<h2 className="font-display font-bold text-lg capitalize">
										{selectedDetail.name}
									</h2>
									<p className="text-xs text-ink3">
										Status:{" "}
										<span
											className="font-semibold capitalize"
											style={{
												color:
													STATUS_CONFIG[selectedDetail.status]?.color ?? "#888",
											}}
										>
											{selectedDetail.status}
										</span>
									</p>
								</div>
							</div>

							<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
								<div className="bg-surface2 rounded-lg p-3">
									<p className="text-[9px] font-bold uppercase tracking-wider text-ink3">
										Latency
									</p>
									<p className="font-display font-bold text-lg mt-1">
										{selectedDetail.latency_ms ?? "—"}
										{selectedDetail.latency_ms !== undefined && (
											<span className="text-xs font-normal text-ink3">ms</span>
										)}
									</p>
								</div>
								<div className="bg-surface2 rounded-lg p-3">
									<p className="text-[9px] font-bold uppercase tracking-wider text-ink3">
										Error Rate
									</p>
									<p className="font-display font-bold text-lg mt-1">
										{selectedDetail.error_rate ?? 0}%
									</p>
								</div>
								<div className="bg-surface2 rounded-lg p-3">
									<p className="text-[9px] font-bold uppercase tracking-wider text-ink3">
										Last Check
									</p>
									<p className="font-display font-bold text-sm mt-1">
										{selectedDetail.last_check
											? new Date(selectedDetail.last_check).toLocaleTimeString()
											: "—"}
									</p>
								</div>
								<div className="bg-surface2 rounded-lg p-3">
									<p className="text-[9px] font-bold uppercase tracking-wider text-ink3">
										Health
									</p>
									<p className="font-display font-bold text-sm mt-1 capitalize">
										{selectedDetail.status}
									</p>
								</div>
							</div>

							{selectedDetail.details && Object.keys(selectedDetail.details).length > 0 && (
								<div className="mt-4">
									<h3 className="text-xs font-semibold text-ink2 mb-2">Details</h3>
									<pre className="bg-surface2 rounded-lg p-3 text-[11px] font-mono overflow-x-auto max-h-48 overflow-y-auto">
										{JSON.stringify(selectedDetail.details, null, 2)}
									</pre>
								</div>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}
