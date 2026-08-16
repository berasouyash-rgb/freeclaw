import {
	Activity,
	AlertTriangle,
	ArrowRight,
	Brain,
	CheckCircle,
	Database,
	Radar,
	RefreshCcw,
	Shield,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { errorText, safeStringify } from "../../lib/utils";
import FindingsAlert from "./agent-office/FindingsAlert";

/* ── Types ─────────────────────────────────────────────────── */
interface AgentExecution {
	id: string;
	agent_id: string;
	agent_name: string;
	division: string;
	task: string;
	status: string;
	output: unknown;
	error: string | null;
	started_at: string;
	completed_at: string | null;
	duration_ms: number | null;
}

interface ActivityLog {
	id: string;
	agent_id: string;
	event_type: string;
	severity: string;
	message: string;
	details: Record<string, unknown>;
	created_at: string;
}

interface AgentStats {
	total: number;
	by_division: Record<string, number>;
	active: number;
	completed: number;
	failed: number;
}

/* ── Metric Card ────────────────────────────────────────────── */
function MetricCard({
	label,
	value,
	icon,
	color,
}: {
	label: string;
	value: string | number;
	icon: React.ReactNode;
	color: string;
}) {
	return (
		<div className="bg-surface2 rounded-lg p-3 border border-border/30">
			<div className="flex items-center gap-2 mb-1">
				<span style={{ color }} className="text-sm">
					{icon}
				</span>
				<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
					{label}
				</span>
			</div>
			<div className="text-xl font-bold text-ink1">{value}</div>
		</div>
	);
}

/* ── Execution Row ──────────────────────────────────────────── */
function ExecutionRow({ exec }: { exec: AgentExecution }) {
	const [expanded, setExpanded] = useState(false);
	const statusColor =
		exec.status === "completed"
			? "#4CAF50"
			: exec.status === "failed"
				? "#F44336"
				: "#FF9800";
	return (
		<div className="border-b border-border/20 last:border-0">
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface2/50 transition-colors text-left"
			>
				<span
					className="w-2 h-2 rounded-full flex-shrink-0"
					style={{ background: statusColor }}
				/>
				<span className="text-xs font-mono text-ink1 flex-shrink-0 w-32 truncate">
					{exec.agent_name || exec.agent_id}
				</span>
				<span className="text-[10px] text-ink3 flex-1 truncate">
					{exec.task || "—"}
				</span>
				<span className="text-[10px] text-ink3 flex-shrink-0">
					{exec.duration_ms ? `${(exec.duration_ms / 1000).toFixed(1)}s` : "—"}
				</span>
				<ArrowRight
					size={10}
					className={`text-ink3 transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
			</button>
			{expanded && (
				<div className="px-3 pb-3 space-y-2 bg-surface3/30">
					<div className="grid grid-cols-2 gap-2 text-[10px]">
						<div>
							<span className="text-ink3">Status:</span>{" "}
							<span className="text-ink1">{exec.status}</span>
						</div>
						<div>
							<span className="text-ink3">Division:</span>{" "}
							<span className="text-ink1">{exec.division}</span>
						</div>
						<div>
							<span className="text-ink3">Started:</span>{" "}
							<span className="text-ink1">
								{exec.started_at
									? new Date(exec.started_at).toLocaleString()
									: "—"}
							</span>
						</div>
						<div>
							<span className="text-ink3">Completed:</span>{" "}
							<span className="text-ink1">
								{exec.completed_at
									? new Date(exec.completed_at).toLocaleString()
									: "—"}
							</span>
						</div>
					</div>
					{exec.task && (
						<div className="text-[10px] text-ink2 mt-1">
							<span className="text-ink3">Task:</span> {exec.task}
						</div>
					)}
					{exec.error && (
						<div className="text-[10px] text-red-400 mt-1">
							<span className="text-ink3">Error:</span> {errorText(exec.error)}
						</div>
					)}
					{!!exec.output && (
						<div className="bg-surface3 rounded-lg p-3 mt-2">
							<p className="text-[10px] font-mono text-ink3 mb-1">OUTPUT:</p>
							<pre className="text-[10px] text-ink1 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
								{typeof exec.output === "string"
									? exec.output
									: safeStringify(exec.output, 2)}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/* ── Live finding ─────────────────────────────────────────── */
interface Finding {
	severity: "critical" | "high" | "medium" | "low";
	domain: string;
	title: string;
	evidence: string;
	recommendation: string;
	agent: string;
	at: string;
}

interface FindingsScan {
	scanned_at: string | null;
	summary: string;
	findings: Finding[];
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string }> = {
	critical: { bg: "bg-red-500/15", text: "text-red-400" },
	high: { bg: "bg-amber-500/15", text: "text-amber-400" },
	medium: { bg: "bg-sky-500/15", text: "text-sky-400" },
	low: { bg: "bg-green-500/15", text: "text-green-400" },
};

/* ── Activity log row ──────────────────────────────────────── */
function ActivityRow({ log }: { log: ActivityLog }) {
	const severityColors: Record<string, string> = {
		info: "text-sky-400",
		warning: "text-amber-400",
		error: "text-red-400",
		critical: "text-red-500",
	};
	return (
		<div className="flex items-start gap-2 px-3 py-2 border-b border-border/30 last:border-0">
			<span
				className={`text-[10px] font-mono ${severityColors[log.severity] || "text-ink3"}`}
			>
				●
			</span>
			<span className="text-[10px] font-mono text-ink1 flex-1 truncate">
				{log.agent_id}
			</span>
			<span className="text-[10px] text-ink3 flex-1 truncate">
				{log.message}
			</span>
			<span className="text-[10px] text-ink3 flex-shrink-0">
				{log.created_at ? new Date(log.created_at).toLocaleTimeString() : "—"}
			</span>
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════
   AGENT DASHBOARD — Real agent metrics + execution history
   ═══════════════════════════════════════════════════════════════ */
export default function AgentDashboard() {
	const [stats, setStats] = useState<AgentStats | null>(null);
	const [executions, setExecutions] = useState<AgentExecution[]>([]);
	const [activities, setActivities] = useState<ActivityLog[]>([]);
	const [findings, setFindings] = useState<Finding[]>([]);
	const [scannedAt, setScannedAt] = useState<string | null>(null);
	const [patrolBusy, setPatrolBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [autoRefresh, setAutoRefresh] = useState(true);

	const loadData = useCallback(async () => {
		try {
			const [execRes, actRes, findRes] = await Promise.all([
				api.get<{ executions: AgentExecution[] }>(
					"/api/agent-executions?limit=50",
				),
				api.get<{ activities: ActivityLog[] }>(
					"/api/agent-executions?action=activity&limit=30",
				),
				api.get<FindingsScan>("/api/agent-team?action=findings"),
			]);

			setFindings(findRes?.findings || []);
			setScannedAt(findRes?.scanned_at || null);

			const execs = execRes?.executions || [];
			setExecutions(execs);

			// Compute stats from executions
			const byDivision: Record<string, number> = {};
			let active = 0,
				completed = 0,
				failed = 0;
			for (const e of execs) {
				byDivision[e.division || "general"] =
					(byDivision[e.division || "general"] || 0) + 1;
				if (e.status === "running" || e.status === "pending") active++;
				else if (e.status === "completed") completed++;
				else if (e.status === "failed") failed++;
			}
			setStats({
				total: execs.length,
				by_division: byDivision,
				active,
				completed,
				failed,
			});

			setActivities(actRes?.activities || []);
		} catch (e: unknown) {
			console.warn(
				"[AgentDashboard] Failed to load data:",
				e instanceof Error ? e.message : e,
			);
		} finally {
			setLoading(false);
		}
	}, []);

	const runPatrol = useCallback(async () => {
		setPatrolBusy(true);
		try {
			const scan = await api.post<FindingsScan>("/api/agent-team", {
				action: "findings",
				run: true,
			});
			setFindings(scan?.findings || []);
			setScannedAt(scan?.scanned_at || null);
		} catch (e: unknown) {
			console.warn(
				"[AgentDashboard] Patrol failed:",
				e instanceof Error ? e.message : e,
			);
		} finally {
			setPatrolBusy(false);
		}
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	useEffect(() => {
		if (!autoRefresh) return;
		const onVis = () => {
			if (!document.hidden) loadData();
		};
		document.addEventListener("visibilitychange", onVis);
		const id = setInterval(() => {
			if (!document.hidden) loadData();
		}, 30000);
		return () => {
			clearInterval(id);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, [autoRefresh, loadData]);

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-bold text-ink1">Agent Dashboard</h2>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setAutoRefresh(!autoRefresh)}
						className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${autoRefresh ? "bg-green-500/20 text-green-400" : "bg-surface2 text-ink3"}`}
					>
						{autoRefresh ? "AUTO" : "PAUSED"}
					</button>
					<button
						onClick={loadData}
						className="p-1.5 rounded hover:bg-surface2 transition-colors"
						title="Refresh"
					>
						<RefreshCcw size={12} className="text-ink3" />
					</button>
				</div>
			</div>

			{/* Summary Metrics */}
			{loading ? (
				<div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
					{[1, 2, 3, 4].map((i) => (
						<div
							key={i}
							className="bg-surface2 rounded-lg p-3 border border-border/30"
						>
							<div className="skeleton h-3 w-20 mb-2" />
							<div className="skeleton h-6 w-12" />
						</div>
					))}
				</div>
			) : (
				stats && (
					<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
						<MetricCard
							label="Total Executions"
							value={stats.total}
							icon={<Database size={14} />}
							color="#8e8ea5"
						/>
						<MetricCard
							label="Active"
							value={stats.active}
							icon={<Activity size={14} />}
							color="#4FC3F7"
						/>
						<MetricCard
							label="Completed"
							value={stats.completed}
							icon={<CheckCircle size={14} />}
							color="#4CAF50"
						/>
						<MetricCard
							label="Failed"
							value={stats.failed}
							icon={<AlertTriangle size={14} />}
							color="#F44336"
						/>
					</div>
				)
			)}

			{/* Live Findings — real patrol output surfaced on the main dashboard */}
			<div className="bg-surface2 rounded-lg border border-border/30 overflow-hidden">
				<div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
					<Radar size={12} className="text-ink3" />
					<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
						Live Findings
					</span>
					<span className="text-[10px] text-ink3 ml-auto">
						{scannedAt
							? `Patrol ${new Date(scannedAt).toLocaleTimeString()}`
							: "No patrol run yet"}
					</span>
					<button
						onClick={runPatrol}
						disabled={patrolBusy}
						className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-[10px] font-mono hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
					>
						{patrolBusy ? "Scanning…" : "Run Patrol"}
					</button>
				</div>
				{patrolBusy ? (
					<div className="px-3 py-6 text-center text-[10px] text-ink3">
						Inspecting reports, review queue, agent tasks, failed logins,
						community volume…
					</div>
				) : findings.length === 0 ? (
					<div className="px-3 py-6 text-center text-[10px] text-ink3">
						All monitored domains healthy — no actionable findings.
					</div>
				) : (
					<div className="max-h-80 overflow-y-auto divide-y divide-border/20">
						{findings.map((f, i) => {
							const style = SEVERITY_STYLES[f.severity] || {
								bg: "bg-surface3",
								text: "text-ink2",
							};
							return (
								<div key={i} className="px-3 py-2.5 space-y-1">
									<div className="flex items-center gap-2">
										<span
											className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider ${style.bg} ${style.text}`}
										>
											{f.severity}
										</span>
										<span className="px-1.5 py-0.5 rounded bg-surface3 text-[9px] font-mono uppercase tracking-wider text-ink2">
											{f.domain}
										</span>
										<span className="text-[11px] font-semibold text-ink1 flex-1 truncate">
											{f.title}
										</span>
									</div>
									<p className="text-[10px] text-ink2 pl-1">{f.evidence}</p>
									<p className="text-[10px] text-ink3 pl-1">
										<span className="text-ink2">Recommendation:</span>{" "}
										{f.recommendation}
									</p>
									<p className="text-[9px] font-mono text-ink3 pl-1">
										Agent: {f.agent} ·{" "}
										{f.at ? new Date(f.at).toLocaleString() : ""}
									</p>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Division Breakdown */}
			{stats && Object.keys(stats.by_division).length > 0 && (
				<div className="bg-surface2 rounded-lg p-3 border border-border/30">
					<div className="flex items-center gap-2 mb-2">
						<Brain size={12} className="text-ink3" />
						<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
							Divisions
						</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{Object.entries(stats.by_division).map(([div, count]) => (
							<span
								key={div}
								className="px-2 py-0.5 rounded bg-surface3 text-[10px] text-ink2 font-mono"
							>
								{div}: {count}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Recent Executions */}
			<div className="bg-surface2 rounded-lg border border-border/30 overflow-hidden">
				<div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
					<Zap size={12} className="text-ink3" />
					<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
						Recent Executions
					</span>
					<span className="text-[10px] text-ink3 ml-auto">
						{executions.length} total
					</span>
				</div>
				{loading ? (
					<div className="px-3 py-4 space-y-3">
						{[1, 2, 3, 4, 5].map((i) => (
							<div
								key={i}
								className="flex items-center gap-3 px-3 animate-pulse"
							>
								<div className="w-2 h-2 rounded-full skeleton flex-shrink-0" />
								<div className="skeleton h-3 w-32" />
								<div className="skeleton h-3 flex-1" />
								<div className="skeleton h-3 w-10" />
							</div>
						))}
					</div>
				) : executions.length === 0 ? (
					<div className="px-3 py-6 text-center text-[10px] text-ink3">
						No executions yet
					</div>
				) : (
					<div className="max-h-96 overflow-y-auto">
						{executions.map((exec) => (
							<ExecutionRow key={exec.id} exec={exec} />
						))}
					</div>
				)}
			</div>

			{/* Activity Log */}
			<div className="bg-surface2 rounded-lg border border-border/30 overflow-hidden">
				<div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
					<Shield size={12} className="text-ink3" />
					<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
						Activity Log
					</span>
					<span className="text-[10px] text-ink3 ml-auto">
						{activities.length} events
					</span>
				</div>
				{loading ? (
					<div className="px-3 py-4 space-y-3 animate-pulse">
						{[1, 2, 3, 4].map((i) => (
							<div key={i} className="flex items-center gap-2 px-3">
								<div className="skeleton w-2 h-2 rounded-full" />
								<div className="skeleton h-3 w-24" />
								<div className="skeleton h-3 flex-1" />
								<div className="skeleton h-3 w-16" />
							</div>
						))}
					</div>
				) : activities.length === 0 ? (
					<div className="px-3 py-6 text-center text-[10px] text-ink3">
						No activity yet
					</div>
				) : (
					<div className="max-h-64 overflow-y-auto">
						{activities.map((log) => (
							<ActivityRow key={log.id} log={log} />
						))}
					</div>
				)}
			</div>

			{/* Live monitor alerts — immediate popup on new findings */}
			<FindingsAlert pollMs={20000} />
		</div>
	);
}
