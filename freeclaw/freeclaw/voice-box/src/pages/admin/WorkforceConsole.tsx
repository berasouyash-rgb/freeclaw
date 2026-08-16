import {
	Activity,
	AlertTriangle,
	ArrowRightLeft,
	Award,
	Brain,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Database,
	Gavel,
	History,
	ListTodo,
	Loader2,
	PauseCircle,
	Play,
	RefreshCcw,
	RotateCcw,
	ShieldAlert,
	ShieldCheck,
	ThumbsDown,
	ThumbsUp,
	TrendingUp,
	Users,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { errorText, safeStringify } from "../../lib/utils";

/* ── Types (mirror api/_workforce.js response) ─────────────────── */
interface Outcome {
	type: string;
	target_id: string | null;
	count: number | null;
	status: string | null;
	verified: boolean;
	evidence: string;
	at: string;
}

interface Employee {
	employee_id: string;
	name: string;
	division: string;
	role: string;
	description: string;
	icon: string;
	capabilities: string[];
	status: "working" | "verifying" | "idle" | "error";
	utilization: "working" | "utilized" | "underutilized";
	current_task: string | null;
	total_executions: number;
	completed: number;
	failed: number;
	running: number;
	tasks_received: number;
	tasks_completed: number;
	tasks_failed: number;
	outputs_created: number;
	success_rate: number | null;
	completion_rate: number | null;
	avg_duration_ms: number | null;
	last_activity: string | null;
	memory_count: number | null;
	health: "healthy" | "degraded";
}

interface TimelineEntry {
	at: string;
	step: string;
	detail: string;
}

interface Impact {
	measurable: boolean;
	summary: string;
	note?: string;
	stats?: Record<string, number>;
	verified_actions?: number;
}

interface TaskRow {
	id: string;
	title: string;
	source: string;
	priority: string;
	status: string;
	assigned_agent: string | null;
	parent_task_id: string | null;
	risk_level: string;
	attempts: number;
	verification_status: string;
	error: string | null;
	outcomes: Outcome[] | null;
	timeline: TimelineEntry[] | null;
	impact: Impact | null;
	created_at: string;
	completed_at: string | null;
}

interface ActivityRow {
	agent_id: string;
	action: string;
	severity: string;
	details?: unknown;
	created_at: string;
}

interface WorkforceOverview {
	employees: Employee[];
	task_queue: {
		total: number;
		queued: number;
		claimed: number;
		working: number;
		verifying: number;
		completed: number;
		failed: number;
		blocked: number;
	};
	recent_tasks: TaskRow[];
	activity: ActivityRow[];
	metrics: {
		working: number;
		verifying: number;
		done: number;
		total_employees: number;
		utilized: number;
		underutilized: number;
		total_executions: number;
		completed_executions: number;
		failed_executions: number;
		verified_outcomes: number;
		success_rate: number | null;
		avg_duration_ms: number | null;
	};
	updated_at: string;
}

interface PatrolResult {
	ok: boolean;
	paused?: boolean;
	discovered?: number;
	assigned?: number;
	executed?: number;
	completed?: number;
	failed?: number;
	recovered?: { executions: number; tasks: number };
	error?: string;
}

interface ImpactCenter {
	impact: {
		posts_hidden: number;
		posts_restored: number;
		posts_escalated: number;
		posts_pinned: number;
		posts_featured: number;
		reports_resolved: number;
		flags_created: number;
		content_changed: number;
		verified_actions: number;
		failed_verifications: number;
	};
	verification_rate: number | null;
	tasks_reached_verification: number;
	tasks_verified: number;
	executions: { completed: number; failed: number; total: number };
	evidence: {
		task_id: string;
		title: string;
		type: string;
		target_id: string | null;
		count: number | null;
		evidence: string;
		at: string;
	}[];
	generated_at: string;
}

interface ApprovalItem {
	id: string;
	title: string;
	description: string | null;
	source: string;
	priority: string;
	risk_level: string;
	verification_status: string;
	input: unknown;
	created_by: string;
	created_at: string;
}

interface PendingApprovals {
	ok: boolean;
	approvals: ApprovalItem[];
}

interface ApprovalDecision {
	task_id: string;
	title: string;
	decision: "approved" | "rejected";
	reason: string | null;
	risk_level: string;
	source: string;
	created_by: string;
	at: string;
}

/* ── Status chip ──────────────────────────────────────────────── */
function StatusChip({ status }: { status: string }) {
	const map: Record<string, { label: string; cls: string; dot: string }> = {
		queued: {
			label: "QUEUED",
			cls: "bg-sky-500/10 text-sky-400 border-sky-500/25",
			dot: "bg-sky-400",
		},
		claimed: {
			label: "CLAIMED",
			cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/25",
			dot: "bg-cyan-400",
		},
		working: {
			label: "WORKING",
			cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
			dot: "bg-emerald-400 animate-pulse",
		},
		verifying: {
			label: "VERIFYING",
			cls: "bg-amber-500/10 text-amber-400 border-amber-500/25",
			dot: "bg-amber-400",
		},
		completed: {
			label: "DONE",
			cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
			dot: "bg-emerald-400",
		},
		failed: {
			label: "FAILED",
			cls: "bg-red-500/10 text-red-400 border-red-500/25",
			dot: "bg-red-400",
		},
		blocked: {
			label: "BLOCKED",
			cls: "bg-orange-500/10 text-orange-400 border-orange-500/25",
			dot: "bg-orange-400",
		},
		cancelled: {
			label: "CANCELLED",
			cls: "bg-ink3/10 text-ink3 border-ink3/25",
			dot: "bg-ink3",
		},
	};
	const m = map[status] ?? map.queued!;
	return (
		<span
			className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider border ${m.cls}`}
		>
			<span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
			{m.label}
		</span>
	);
}

function PriorityTag({ p }: { p: string }) {
	const map: Record<string, string> = {
		critical: "bg-red-500/15 text-red-400",
		high: "bg-orange-500/15 text-orange-400",
		medium: "bg-amber-500/15 text-amber-400",
		low: "bg-sky-500/15 text-sky-400",
	};
	return (
		<span
			className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${map[p] || map.medium}`}
		>
			{p.toUpperCase()}
		</span>
	);
}

function timeAgo(iso: string | null | undefined): string {
	if (!iso) return "never";
	const s = Math.max(
		0,
		Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
	);
	if (s < 5) return "just now";
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

/* ═══════════════════════════════════════════════════════════════
   WORKFORCE CONSOLE — real task queue + real employees + commands
   ═══════════════════════════════════════════════════════════════ */
export default function WorkforceConsole() {
	const { toast } = useApp();
	const [overview, setOverview] = useState<WorkforceOverview | null>(null);
	const [loading, setLoading] = useState(true);
	const [patrolling, setPatrolling] = useState(false);
	const [privacyScanning, setPrivacyScanning] = useState(false);
	const [paused, setPaused] = useState(false);
	const [busyCmd, setBusyCmd] = useState<string | null>(null);
	const [expandedTask, setExpandedTask] = useState<string | null>(null);
	const [impact, setImpact] = useState<ImpactCenter | null>(null);
	const [impactLoading, setImpactLoading] = useState(false);
	const [expandedEvidence, setExpandedEvidence] = useState(false);
	const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
	const [history, setHistory] = useState<ApprovalDecision[]>([]);

	const load = useCallback(async () => {
		try {
			const r = await api.get<WorkforceOverview>(
				"/api/workforce?action=overview",
			);
			setOverview(r);
		} catch (e: unknown) {
			console.warn(
				"[WorkforceConsole] overview failed:",
				e instanceof Error ? e.message : e,
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	// Live poll every 6s (real DB state)
	useEffect(() => {
		const id = setInterval(load, 6000);
		const onVis = () => {
			if (!document.hidden) load();
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			clearInterval(id);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, [load]);

	// Impact center — aggregate real verified outcomes (loaded on demand)
	const loadImpact = useCallback(async () => {
		setImpactLoading(true);
		try {
			const r = await api.get<ImpactCenter>("/api/workforce?action=impact");
			setImpact(r);
		} catch (e: unknown) {
			console.warn(
				"[WorkforceConsole] impact failed:",
				e instanceof Error ? e.message : e,
			);
		}
		setImpactLoading(false);
	}, []);

	useEffect(() => {
		loadImpact();
	}, [loadImpact]);

	// Pending approvals — full blocked-task list (never truncated), with the WHY
	const loadApprovals = useCallback(async () => {
		try {
			const r = await api.post<PendingApprovals>("/api/workforce", {
				action: "pending-approvals",
			});
			setApprovals(r.approvals || []);
		} catch (e: unknown) {
			console.warn(
				"[WorkforceConsole] approvals load failed:",
				e instanceof Error ? e.message : e,
			);
		}
		try {
			const h = await api.post<{ ok: boolean; history: ApprovalDecision[] }>(
				"/api/workforce",
				{ action: "approval-history" },
			);
			setHistory(h.history || []);
		} catch (e: unknown) {
			console.warn(
				"[WorkforceConsole] approval history load failed:",
				e instanceof Error ? e.message : e,
			);
		}
	}, []);

	useEffect(() => {
		loadApprovals();
	}, [loadApprovals]);

	const runCommand = useCallback(
		async (
			action: string,
			body: Record<string, unknown> = {},
			label: string,
		) => {
			setBusyCmd(action);
			try {
				const r = await api.post<PatrolResult>("/api/workforce", {
					action,
					...body,
				});
				if (r.ok === false) {
					toast(r.error || `${label} failed`, "err");
					return null;
				}
				if (label !== "Patrol") toast(`${label} — ok`, "ok");
				if (r.paused) {
					setPaused(true);
					toast("Workforce paused — patrols skipped", "info");
					return r;
				}
				if (action === "pause") {
					setPaused(true);
					toast("Workforce paused", "ok");
				}
				if (action === "resume") {
					setPaused(false);
					toast("Workforce resumed", "ok");
				}
				return r;
			} catch (e: unknown) {
				toast(e instanceof Error ? e.message : String(e), "err");
				return null;
			} finally {
				setBusyCmd(null);
				load();
			}
		},
		[toast, load],
	);

	const runPatrol = useCallback(async () => {
		setPatrolling(true);
		const r = await runCommand("patrol", { limit: 8 }, "Patrol");
		if (r && r.ok !== false) {
			const recovered = r.recovered
				? ` · recovered ${r.recovered.executions} exec, ${r.recovered.tasks} tasks`
				: "";
			toast(
				`Patrol: ${r.discovered ?? 0} discovered · ${r.completed ?? 0} completed · ${r.failed ?? 0} failed${recovered}`,
				"ok",
			);
		}
		setPatrolling(false);
	}, [runCommand, toast]);

	// REAL on-demand PII scan — Privacy Guardian scans live posts for
	// emails/phones, records an execution, and raises an alert on findings.
	const runPrivacyScan = useCallback(async () => {
		setPrivacyScanning(true);
		try {
			const r = await api.post<{
				ok?: boolean;
				error?: string;
				output?: {
					posts_scanned?: number;
					pii_found?: number;
					findings?: { post_id: string; kind: string; value: string }[];
				};
			}>("/api/workforce", { action: "privacy-scan" });
			if (r?.ok === false) {
				toast(`Privacy scan failed: ${errorText(r.error)}`, "err");
			} else {
				const o = r?.output || {};
				toast(
					o.pii_found
						? `Privacy scan: ${o.pii_found} PII instance(s) found in ${o.posts_scanned} posts — alert raised`
						: `Privacy scan: clean — ${o.posts_scanned} posts scanned`,
					o.pii_found ? "info" : "ok",
				);
			}
			load();
			loadApprovals();
			loadImpact();
		} catch (e: unknown) {
			toast(`Privacy scan failed: ${errorText(e)}`, "err");
		}
		setPrivacyScanning(false);
	}, [toast, load, loadApprovals, loadImpact]);

	const refreshAll = useCallback(() => {
		load();
		loadApprovals();
		loadImpact();
	}, [load, loadApprovals, loadImpact]);
	const approveTask = useCallback(
		async (id: string) => {
			await runCommand("approve-task", { id }, "Approve");
			loadApprovals();
		},
		[runCommand, loadApprovals],
	);
	const rejectTask = useCallback(
		async (id: string) => {
			await runCommand(
				"reject-task",
				{ id, reason: "Rejected by admin in Approval Center" },
				"Reject",
			);
			loadApprovals();
		},
		[runCommand, loadApprovals],
	);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20 gap-3 text-ink3 text-sm">
				<Loader2 size={16} className="animate-spin" />
				<span>Loading workforce runtime…</span>
			</div>
		);
	}

	if (!overview) {
		return (
			<div className="card p-8 text-center text-sm text-ink3">
				<AlertTriangle size={20} className="mx-auto mb-2 text-amber-400" />
				Could not reach the workforce runtime. Check the dev server / admin
				session.
			</div>
		);
	}

	const {
		metrics,
		task_queue: q,
		employees,
		recent_tasks: tasks,
		activity,
	} = overview;

	return (
		<div className="space-y-4">
			{/* ── Header ─────────────────────────────────────────── */}
			<div className="flex items-start justify-between flex-wrap gap-3">
				<div>
					<h1 className="font-display font-bold text-xl flex items-center gap-2">
						<Brain className="text-accent" size={20} /> AI Workforce
					</h1>
					<p className="text-xs text-ink3 mt-0.5">
						{metrics.total_employees} employees ·{" "}
						<span className="text-sky-400">{metrics.utilized} utilized</span> ·{" "}
						<span className="text-ink3">{metrics.underutilized} underutilized</span>{" "}
						· synced {timeAgo(overview.updated_at)}
					</p>
				</div>
				<div className="flex gap-2 flex-wrap">
					<button
						onClick={runPatrol}
						disabled={patrolling || paused}
						className={`btn text-xs px-3 py-2 ${paused ? "opacity-40 cursor-not-allowed" : "btn-primary"}`}
					>
						{patrolling ? (
							<Loader2 size={13} className="animate-spin mr-1.5" />
						) : (
							<Play size={13} className="mr-1.5" />
						)}
						{patrolling ? "Patrolling…" : "Run Patrol"}
					</button>
					<button
						onClick={runPrivacyScan}
						disabled={privacyScanning || paused}
						title="Privacy Guardian scans posts for emails/phone numbers and raises an alert on findings"
						className={`btn text-xs px-3 py-2 ${paused ? "opacity-40 cursor-not-allowed" : "btn-soft"}`}
					>
						{privacyScanning ? (
							<Loader2 size={13} className="animate-spin mr-1.5" />
						) : (
							<ShieldCheck size={13} className="mr-1.5" />
						)}
						{privacyScanning ? "Scanning…" : "Privacy Scan"}
					</button>
					{paused ? (
						<button
							onClick={() => runCommand("resume", {}, "Resume")}
							disabled={busyCmd === "resume"}
							className="btn text-xs px-3 py-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25"
						>
							<Play size={13} className="mr-1.5" /> Resume
						</button>
					) : (
						<button
							onClick={() => runCommand("pause", {}, "Pause")}
							disabled={busyCmd === "pause"}
							className="btn text-xs px-3 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20"
						>
							<PauseCircle size={13} className="mr-1.5" /> Pause
						</button>
					)}
					<button
						onClick={refreshAll}
						className="btn btn-ghost !p-2"
						title="Refresh"
					>
						<RefreshCcw size={14} />
					</button>
				</div>
			</div>

			{/* ── Top status bar (real runtime counts) ───────────── */}
			{/* Deduped: Working / Tasks / Verified success live in the AI Operations
			   KPI strip directly above this workspace — only unique counters stay. */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
				<div className="bg-surface2 rounded-xl p-3.5 border border-border flex items-center gap-3">
					<div className="w-9 h-9 rounded-lg bg-sky-500/15 text-sky-400 grid place-items-center">
						<CheckCircle2 size={16} />
					</div>
					<div>
						<p className="text-xl font-bold text-ink1">{metrics.done}</p>
						<p className="text-[10px] text-ink3 font-medium">DONE / IDLE</p>
					</div>
				</div>
				<div className="bg-surface2 rounded-xl p-3.5 border border-border flex items-center gap-3">
					<div className="w-9 h-9 rounded-lg bg-cyan-500/15 text-cyan-400 grid place-items-center">
						<Clock size={16} />
					</div>
					<div>
						<p className="text-xl font-bold text-ink1">
							{metrics.avg_duration_ms
								? `${(metrics.avg_duration_ms / 1000).toFixed(1)}s`
								: "—"}
						</p>
						<p className="text-[10px] text-ink3 font-medium">AVG DURATION</p>
					</div>
				</div>
				<div className="bg-surface2 rounded-xl p-3.5 border border-border flex items-center gap-3">
					<div className="w-9 h-9 rounded-lg bg-red-500/15 text-red-400 grid place-items-center">
						<AlertTriangle size={16} />
					</div>
					<div>
						<p className="text-xl font-bold text-ink1">
							{metrics.failed_executions}
						</p>
						<p className="text-[10px] text-ink3 font-medium">FAILED</p>
					</div>
				</div>
			</div>

			{/* ── Verified outcomes (real product changes) ─────────── */}
			<div className="bg-surface2 rounded-xl border border-border px-4 py-3 flex items-center gap-3">
				<div className="w-9 h-9 rounded-lg bg-blue-500/15 text-blue-400 grid place-items-center flex-shrink-0">
					<CheckCircle2 size={16} />
				</div>
				<div className="min-w-0">
					<p className="text-sm font-bold text-ink1">
						{metrics.verified_outcomes}{" "}
						<span className="text-[10px] text-ink3 font-medium">
							VERIFIED OUTCOMES
						</span>
					</p>
					<p className="text-[10px] text-ink3 mt-0.5">
						Real product changes re-checked against the database: posts hidden,
						reports resolved, priorities set, admin replies posted. Failed
						verification never counts.
					</p>
				</div>
			</div>

			{/* ── Queue breakdown ────────────────────────────────── */}
			<div className="flex gap-1.5 flex-wrap">
				{(
					[
						"queued",
						"claimed",
						"working",
						"verifying",
						"completed",
						"failed",
						"blocked",
					] as const
				).map((s) => (
					<span
						key={s}
						className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-surface2 border border-border text-ink2 flex items-center gap-1.5"
					>
						<StatusChip status={s} /> {q[s]}
					</span>
				))}
			</div>

			{/* ── Approval Center — high-risk work awaiting human review ── */}
			<div className="bg-surface2 rounded-xl border border-orange-500/20 overflow-hidden">
				<div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
					<Gavel size={13} className="text-orange-400" />
					<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
						Approval Center — high-risk work awaiting admin review
					</span>
					<span className="text-[10px] text-orange-400 ml-auto">
						{approvals.length} waiting
					</span>
				</div>
				{approvals.length === 0 ? (
					<div className="px-4 py-5 text-center text-[11px] text-ink3">
						No high-risk tasks waiting for approval. When discovery creates a
						high/critical-risk task, it parks here (BLOCKED) until an admin
						approves or rejects it — never auto-executes.
					</div>
				) : (
					<div className="max-h-72 overflow-y-auto">
						{approvals.map((t) => (
							<div
								key={t.id}
								className="flex items-start gap-3 px-4 py-2.5 border-b border-border/40 last:border-0"
							>
								<ShieldAlert
									size={14}
									className="text-orange-400 mt-0.5 flex-shrink-0"
								/>
								<div className="min-w-0 flex-1">
									<p className="text-xs text-ink1">{t.title}</p>
									{t.description && (
										<p className="text-[10px] text-ink2 mt-0.5 leading-snug">
											{t.description.slice(0, 180)}
										</p>
									)}
									<p className="text-[9px] font-mono text-ink3 mt-0.5">
										{t.id.slice(0, 8)} · src:{t.source} · priority:{t.priority}{" "}
										· risk:{t.risk_level} · by:{t.created_by}
									</p>
									{t.input != null && (
										<p className="text-[9px] font-mono text-ink3 mt-0.5 truncate">
											input: {safeStringify(t.input).slice(0, 120)}
										</p>
									)}
								</div>
								<PriorityTag p={t.priority} />
								<div className="flex gap-1 flex-shrink-0">
									<button
										onClick={() => approveTask(t.id)}
										disabled={busyCmd === "approve-task"}
										className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 text-[10px] font-bold"
										title="Approve and queue for execution"
									>
										<ThumbsUp size={11} /> Approve
									</button>
									<button
										onClick={() => rejectTask(t.id)}
										disabled={busyCmd === "reject-task"}
										className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-40 text-[10px] font-bold"
										title="Reject and cancel this task"
									>
										<ThumbsDown size={11} /> Reject
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* ── Approval History — every human decision on high-risk work ── */}
			{history.length > 0 && (
				<div className="bg-surface2 rounded-xl border border-border overflow-hidden">
					<div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
						<ShieldCheck size={13} className="text-emerald-400" />
						<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
							Approval Ledger — your decisions on high-risk work
						</span>
						<span className="text-[10px] text-ink3 ml-auto">
							{history.length} decisions
						</span>
					</div>
					<div className="max-h-52 overflow-y-auto">
						{history.slice(0, 20).map((h) => (
							<div
								key={`${h.task_id}-${h.at}`}
								className="flex items-start gap-2.5 px-4 py-2 border-b border-border/40 last:border-0"
							>
								<span
									className={`mt-0.5 flex-shrink-0 ${h.decision === "approved" ? "text-emerald-400" : "text-red-400"}`}
								>
									{h.decision === "approved" ? (
										<ThumbsUp size={12} />
									) : (
										<ThumbsDown size={12} />
									)}
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-[11px] text-ink1 truncate">
										<span
											className={`font-bold uppercase tracking-wider ${h.decision === "approved" ? "text-emerald-400" : "text-red-400"}`}
										>
											{h.decision}
										</span>
										{" — "}
										{h.title}
									</p>
									<p className="text-[9px] font-mono text-ink3 mt-0.5">
										{h.task_id.slice(0, 8)} · risk:{h.risk_level} · src:
										{h.source} · by:{h.created_by}
										<span className="text-ink2"> · {timeAgo(h.at)}</span>
									</p>
									{h.reason && (
										<p className="text-[9px] text-ink2 mt-0.5">
											why: {h.reason}
										</p>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* ── Impact Center — real aggregate verified impact ────── */}
			<div className="bg-surface2 rounded-xl border border-border overflow-hidden">
				<div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
					<Award size={13} className="text-blue-400" />
					<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
						Impact Center — real aggregate verified impact
					</span>
					<button
						onClick={loadImpact}
						className="text-[10px] text-ink3 ml-auto hover:text-ink1 transition-colors flex items-center gap-1"
						title="Refresh impact"
					>
						<RefreshCcw
							size={11}
							className={impactLoading ? "animate-spin" : ""}
						/>{" "}
						{impact ? timeAgo(impact.generated_at) : "refresh"}
					</button>
				</div>
				<div className="p-4">
					{!impact ? (
						<p className="text-[11px] text-ink3 text-center py-3">
							Loading real impact…
						</p>
					) : (
						<>
							<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
								<div className="bg-surface rounded-lg border border-border p-3">
									<p className="text-lg font-bold text-ink1">
										{impact.impact.posts_hidden}
									</p>
									<p className="text-[9px] text-ink3 font-medium uppercase tracking-wider">
										Posts hidden
									</p>
								</div>
								<div className="bg-surface rounded-lg border border-border p-3">
									<p className="text-lg font-bold text-ink1">
										{impact.impact.reports_resolved}
									</p>
									<p className="text-[9px] text-ink3 font-medium uppercase tracking-wider">
										Reports resolved
									</p>
								</div>
								<div className="bg-surface rounded-lg border border-border p-3">
									<p className="text-lg font-bold text-ink1">
										{impact.impact.posts_escalated}
									</p>
									<p className="text-[9px] text-ink3 font-medium uppercase tracking-wider">
										Posts escalated
									</p>
								</div>
								<div className="bg-surface rounded-lg border border-border p-3">
									<p className="text-lg font-bold text-ink1">
										{impact.impact.flags_created}
									</p>
									<p className="text-[9px] text-ink3 font-medium uppercase tracking-wider">
										Flags created
									</p>
								</div>
								<div className="bg-surface rounded-lg border border-border p-3">
									<p className="text-lg font-bold text-ink1">
										{impact.impact.verified_actions}
									</p>
									<p className="text-[9px] text-ink3 font-medium uppercase tracking-wider">
										Verified actions
									</p>
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[10px] text-ink3 font-mono">
								<span>
									{impact.executions.total} real executions ·{" "}
									{impact.executions.completed} completed ·{" "}
									{impact.executions.failed} failed
								</span>
								<span>
									verification rate:{" "}
									<span className="text-blue-400">
										{impact.verification_rate ?? "—"}%
									</span>{" "}
									({impact.tasks_verified}/{impact.tasks_reached_verification}{" "}
									tasks verified)
								</span>
								<span>
									failed verifications:{" "}
									<span className="text-red-400">
										{impact.impact.failed_verifications}
									</span>
								</span>
								<span>content changes: {impact.impact.content_changed}</span>
							</div>
							{impact.evidence.length > 0 && (
								<div className="mt-3">
									<button
										onClick={() => setExpandedEvidence(!expandedEvidence)}
										className="flex items-center gap-1 text-[10px] text-ink3 uppercase tracking-wider hover:text-ink1 transition-colors"
									>
										{expandedEvidence ? (
											<ChevronDown size={11} />
										) : (
											<ChevronRight size={11} />
										)}
										Evidence ({impact.evidence.length}) — the actual verified
										changes behind these numbers
									</button>
									{expandedEvidence && (
										<div className="mt-2 max-h-52 overflow-y-auto space-y-1.5">
											{impact.evidence.slice(0, 50).map((ev, i) => (
												<div
													key={i}
													className="rounded-lg bg-surface border border-border/60 px-2.5 py-1.5"
												>
													<p className="text-[10px] font-mono text-ink1">
														<span className="text-emerald-400">✓</span>{" "}
														{ev.type}
														{ev.target_id
															? ` → ${String(ev.target_id).slice(0, 24)}`
															: ""}
														{ev.count ? ` ×${ev.count}` : ""}
														<span className="text-ink3 ml-2">
															{new Date(ev.at).toLocaleString()}
														</span>
													</p>
													<p className="text-[9px] text-ink2 font-mono truncate">
														{ev.evidence} · {ev.title.slice(0, 60)}
													</p>
												</div>
											))}
										</div>
									)}
								</div>
							)}
						</>
					)}
				</div>
			</div>

			{/* ── Live employees ─────────────────────────────────── */}
			<div className="bg-surface2 rounded-xl border border-border overflow-hidden">
				<div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
					<Users size={13} className="text-ink3" />
					<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
						Live Employees — real runtime state
					</span>
					<span className="text-[10px] text-ink3 ml-auto">
						{employees.length} total
					</span>
				</div>
				<div className="max-h-72 overflow-y-auto">
					{employees.map((e) => {
						const statusColor =
							e.status === "working"
								? "bg-emerald-400 animate-pulse"
								: e.status === "verifying"
									? "bg-amber-400 animate-pulse"
									: e.status === "error"
										? "bg-red-400"
										: "bg-ink3";
						const divColor = (e.division || "specialist").includes("eng")
							? "text-blue-400"
							: e.division === "security"
								? "text-red-400"
								: e.division === "moderation"
									? "text-orange-400"
									: e.division === "analytics"
										? "text-violet-400"
										: e.division === "executive"
											? "text-amber-400"
											: e.division === "users"
												? "text-emerald-400"
												: "text-ink3";
						return (
							<div
								key={e.employee_id}
								className="flex items-center gap-3 px-4 py-2 border-b border-border/40 last:border-0 hover:bg-surface3/40 transition-colors"
							>
								<span className="text-lg w-8 text-center flex-shrink-0">
									{e.icon || "🤖"}
								</span>
								<span
									className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`}
								/>
								<div className="min-w-0 flex-1">
									<p className="text-xs font-bold text-ink1 truncate">
										{e.name}{" "}
										<span className="text-[9px] font-mono text-ink3 ml-1">
											{e.employee_id}
										</span>
									</p>
									<p className="text-[10px] text-ink3 truncate">
										<span className={divColor}>{e.division}</span> · {e.role}
										{e.current_task && (
											<span className="text-ink2">
												{" "}
												· “{e.current_task.slice(0, 70)}”
											</span>
										)}
									</p>
								</div>
								<div className="hidden md:flex items-center gap-3 text-[10px] text-ink3 flex-shrink-0">
									<span title="Tasks received">{e.tasks_received} tasks</span>
									{e.outputs_created > 0 && (
										<span
											title="Verified real outcomes"
											className="text-blue-400 font-bold"
										>
											{e.outputs_created} ✓
										</span>
									)}
									{e.success_rate !== null && (
										<span title="Verified success rate — DB-verified ÷ tasks that reached verification">
											{e.success_rate}% ✓
										</span>
									)}
									{e.completion_rate !== null && (
										<span title="Completion rate — completed ÷ received (unverified 'done' is not success)">
											{e.completion_rate}% done
										</span>
									)}
									{e.avg_duration_ms !== null && (
										<span title="Avg duration">
											{(e.avg_duration_ms / 1000).toFixed(1)}s
										</span>
									)}
									{e.memory_count !== null && (
										<span
											title="Memory entries"
											className="flex items-center gap-0.5"
										>
											<Database size={10} />
											{e.memory_count}
										</span>
									)}
									{e.utilization === "underutilized" && (
										<span
											title="No real work received — truthful idle"
											className="text-ink3 font-bold"
										>
											IDLE
										</span>
									)}
									{e.health === "degraded" && (
										<span className="text-amber-400 font-bold">DEGRADED</span>
									)}
								</div>
								<span className="text-[9px] text-ink3 flex-shrink-0">
									{timeAgo(e.last_activity)}
								</span>
							</div>
						);
					})}
					{employees.length === 0 && (
						<div className="px-4 py-8 text-center text-xs text-ink3">
							No employees defined.
						</div>
					)}
				</div>
			</div>

			{/* ── Task queue board ───────────────────────────────── */}
			<div className="bg-surface2 rounded-xl border border-border overflow-hidden">
				<div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
					<ListTodo size={13} className="text-ink3" />
					<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
						Persistent Task Queue — real work
					</span>
					<span className="text-[10px] text-ink3 ml-auto">
						{tasks.length} shown
					</span>
				</div>
				<div className="max-h-80 overflow-y-auto">
					{tasks.map((t) => {
						const expanded = expandedTask === t.id;
						return (
							<div
								key={t.id}
								className="border-b border-border/40 last:border-0 hover:bg-surface3/40 transition-colors"
							>
								<div
									className="flex items-start gap-3 px-4 py-2 cursor-pointer"
									onClick={() => setExpandedTask(expanded ? null : t.id)}
								>
									<button
										className="p-0.5 mt-0.5 text-ink3 hover:text-ink1 transition-colors"
										title="Execution timeline"
										aria-label={expanded ? "Collapse task" : "Expand task"}
										onClick={(e) => {
											e.stopPropagation();
											setExpandedTask(expanded ? null : t.id);
										}}
									>
										{expanded ? (
											<ChevronDown size={13} />
										) : (
											<ChevronRight size={13} />
										)}
									</button>
									<div className="min-w-0 flex-1">
										<p className="text-xs text-ink1 truncate">{t.title}</p>
										<p className="text-[9px] font-mono text-ink3 mt-0.5">
											{t.id.slice(0, 8)} · src:{t.source} · agent:
											{t.assigned_agent || "unassigned"} · attempts:{t.attempts}
											{t.parent_task_id && (
												<span className="text-cyan-400">
													{" "}
													· handoff:{t.parent_task_id.slice(0, 8)}
												</span>
											)}
											{t.verification_status !== "none" && (
												<span
													className={
														t.verification_status === "passed"
															? "text-emerald-400"
															: t.verification_status === "failed"
																? "text-red-400"
																: "text-amber-400"
													}
												>
													{" "}
													· verified:{t.verification_status}
												</span>
											)}
											{t.error && (
												<span className="text-red-400">
													{" "}
													· {t.error.slice(0, 60)}
												</span>
											)}
										</p>
										{t.outcomes && t.outcomes.length > 0 && (
											<div className="flex flex-wrap gap-1 mt-1">
												{t.outcomes.map((o, i) => (
													<span
														key={i}
														title={o.evidence}
														className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${o.verified ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : "bg-red-500/10 text-red-400 border-red-500/25"}`}
													>
														{o.verified ? "✓" : "✗"} {o.type}
														{o.target_id
															? `:${String(o.target_id).slice(0, 10)}`
															: ""}
														{o.count ? ` ×${o.count}` : ""}
													</span>
												))}
											</div>
										)}
										{t.impact && t.impact.summary && (
											<p
												className={`text-[9px] mt-1 flex items-center gap-1 ${t.impact.measurable ? "text-blue-400" : "text-ink3"}`}
											>
												<TrendingUp size={10} /> Impact: {t.impact.summary}
											</p>
										)}
										{expanded && t.timeline && t.timeline.length > 0 && (
											<div className="mt-2 pl-1 space-y-1.5">
												<p className="text-[9px] font-bold text-ink3 uppercase tracking-wider flex items-center gap-1">
													<History size={10} /> Execution Timeline (real runtime
													telemetry)
												</p>
												{t.timeline.map((tl, i) => {
													const stepColor =
														tl.step === "failed" ||
														tl.step === "verification_failed"
															? "text-red-400"
															: tl.step === "verifying"
																? "text-amber-400"
																: tl.step === "completed"
																	? "text-emerald-400"
																	: tl.step === "claimed"
																		? "text-cyan-400"
																		: "text-ink3";
													return (
														<div key={i} className="flex items-start gap-2">
															<span
																className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${stepColor} ${tl.step === "working" || tl.step === "verifying" ? "animate-pulse" : ""}`}
															/>
															<div className="min-w-0">
																<p className="text-[10px] font-mono text-ink1 leading-snug">
																	<span
																		className={`font-bold uppercase tracking-wide ${stepColor}`}
																	>
																		{tl.step.replace(/_/g, " ")}
																	</span>
																	<span className="text-ink3 ml-1.5">
																		{new Date(tl.at).toLocaleTimeString()}
																	</span>
																</p>
																<p className="text-[9px] text-ink2 leading-snug">
																	{tl.detail}
																</p>
															</div>
														</div>
													);
												})}
											</div>
										)}
									</div>
									<PriorityTag p={t.priority} />
									<StatusChip status={t.status} />
									<div
										className="flex gap-1 flex-shrink-0"
										onClick={(e) => e.stopPropagation()}
									>
										<button
											onClick={() =>
												runCommand("retry-task", { id: t.id }, "Retry")
											}
											disabled={
												busyCmd === "retry-task" ||
												!["failed", "cancelled", "blocked"].includes(t.status)
											}
											className="p-1.5 rounded-lg bg-surface3 border border-border text-ink2 hover:text-emerald-400 hover:border-emerald-500/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
											title="Retry task"
										>
											<RotateCcw size={11} />
										</button>
										<button
											onClick={() =>
												runCommand("reassign-task", { id: t.id }, "Reassign")
											}
											disabled={
												busyCmd === "reassign-task" ||
												["completed", "failed", "cancelled"].includes(t.status)
											}
											className="p-1.5 rounded-lg bg-surface3 border border-border text-ink2 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
											title="Reassign (auto)"
										>
											<ArrowRightLeft size={11} />
										</button>
										<button
											onClick={() =>
												runCommand("cancel-task", { id: t.id }, "Cancel")
											}
											disabled={
												busyCmd === "cancel-task" ||
												["completed", "failed", "cancelled"].includes(t.status)
											}
											className="p-1.5 rounded-lg bg-surface3 border border-border text-ink2 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
											title="Cancel task"
										>
											<XCircle size={11} />
										</button>
									</div>
								</div>
							</div>
						);
					})}
					{tasks.length === 0 && (
						<div className="px-4 py-8 text-center text-xs text-ink3">
							Queue is empty — run a patrol to discover work from real signals
							(reports, failures, moderation queue).
						</div>
					)}
				</div>
			</div>

			{/* ── Live activity stream ───────────────────────────── */}
			<div className="bg-surface2 rounded-xl border border-border overflow-hidden">
				<div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
					<Activity size={13} className="text-ink3" />
					<span className="text-[10px] font-mono text-ink3 uppercase tracking-wider">
						Live Activity — real events
					</span>
					<span className="text-[10px] text-ink3 ml-auto">
						{activity.length} events
					</span>
				</div>
				<div className="max-h-56 overflow-y-auto">
					{activity.map((a, i) => {
						const sev =
							a.severity === "error"
								? "text-red-400"
								: a.severity === "warning"
									? "text-amber-400"
									: "text-emerald-400";
						return (
							<div
								key={i}
								className="flex items-start gap-2 px-4 py-1.5 border-b border-border/30 last:border-0"
							>
								<span className={`text-[10px] font-mono ${sev}`}>●</span>
								<span className="text-[10px] font-mono text-ink1 flex-shrink-0">
									{a.agent_id || "system"}
								</span>
								<span className="text-[10px] text-ink2 flex-1 truncate">
									{a.action}
								</span>
								<span className="text-[9px] text-ink3 flex-shrink-0">
									{timeAgo(a.created_at)}
								</span>
							</div>
						);
					})}
					{activity.length === 0 && (
						<div className="px-4 py-8 text-center text-xs text-ink3">
							No activity yet — the cron or a patrol will generate real events.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
