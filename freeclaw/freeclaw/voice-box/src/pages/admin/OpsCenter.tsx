// ═══════════════════════════════════════════════════════════════════
// OPS CENTER — hidden AI workforce command view
// ═══════════════════════════════════════════════════════════════════
// The admin is the boss. They see RESULTS, INCIDENTS, RISKS, ATTENTION-
// REQUIRED work and VERIFIED OUTCOMES — not 100 agent cards. The workforce
// itself stays hidden behind the "Open workforce" button.
//
// Every number on this page comes from the real runtime via
// /api/workforce?action=ops-summary (persisted agent_tasks + execution
// records). Nothing is simulated: if no incidents exist, the page says
// "no active incidents" — it never invents busyness.
// ═══════════════════════════════════════════════════════════════════

import {
	Activity,
	AlertOctagon,
	AlertTriangle,
	ArrowUpRight,
	BellRing,
	CalendarDays,
	CheckCircle2,
	Clock,
	Cpu,
	Database,
	Gauge,
	Radar,
	RefreshCw,
	Users,
	Zap,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import { useSmartPoll } from "../../lib/useSmartPoll";
import { errorText } from "../../lib/utils";
import {
	agentName,
	CriticalAlertBanner,
	timeAgo,
	type AlertRow,
} from "../../components/admin/CriticalAlertBanner";
import ApprovalAlert from "./agent-office/ApprovalAlert";

// ─── Types (mirrors the ops-summary contract in api/_workforce.js) ──
interface OpsRow {
	id: string;
	title: string;
	agent: string | null;
	priority: string;
	risk_level: string;
	status: string;
	verification_status: string;
	created_at: string;
	completed_at: string | null;
	error: string | null;
	// impact arrives from measureImpact() as { measurable, summary, note, … }
	// — older rows may still carry a plain string. Render via impactText().
	impact: unknown;
	evidence_count: number;
	timeline_count: number;
	outcomes: { what: string; impact: unknown }[];
}

interface OpsReport {
	tasks_created_24h: number;
	tasks_completed_24h: number;
	tasks_failed_24h: number;
	verified_outcomes_24h: number;
	auto_resolved_24h: number;
	incidents_open: number;
	attention_open: number;
	alerts_open: number;
	top_risks: { label: string; count: number }[];
}

interface OpsSummary {
	ok: boolean;
	employees: { status: string; utilization: string }[];
	task_queue: Record<string, number>;
	metrics: {
		working: number;
		verifying: number;
		total_employees: number;
		utilized: number;
		underutilized: number;
		verified_outcomes: number;
		success_rate: number | null;
		avg_duration_ms: number | null;
	};
	ai_provider: { ok: boolean; status: string; note: string };
	config: { paused: boolean };
	activity: {
		agent_id: string;
		action: string;
		severity: string;
		details: string;
		created_at: string;
	}[];
	incidents: OpsRow[];
	attention: OpsRow[];
	auto_resolved: OpsRow[];
	verified_today: number;
	alerts: {
		ok: boolean;
		alerts: AlertRow[];
		open: number;
		critical_open: number;
		acknowledged_open?: number;
		resolved?: number;
	};
	report: OpsReport;
	live_work: {
		id: string;
		title: string;
		agent: string | null;
		status: string;
		started_at: string | null;
		heartbeat_at: string | null;
		priority: string;
	}[];
	platform: {
		posts: number;
		pending_reports: number;
		users: number;
		comments: number;
		reactions: number;
		pulse?: {
			recent: {
				id: string;
				title: string;
				category?: string;
				priority?: string;
				status?: string;
				type?: string;
				created_at?: string;
				engagement?: number;
			}[];
			trending: {
				id: string;
				title: string;
				category?: string;
				priority?: string;
				status?: string;
				type?: string;
				created_at?: string;
				engagement?: number;
			}[];
			emergency: {
				id: string;
				title: string;
				category?: string;
				priority?: string;
				status?: string;
				created_at?: string;
			}[];
			emergency_count: number;
			reports_open: number;
			suggestions: number;
			polls: { id: string; title?: string; created_at?: string }[];
			polls_active: number;
		};
	};
	last_patrol_at: string | null;
	updated_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────
// Task `impact` arrives as { measurable, summary, note, … } (measureImpact)
// OR a legacy plain string — always render it as a safe one-line string so
// the page can never crash on an object child.
function impactText(impact: unknown): string {
	if (typeof impact === "string") return impact;
	if (impact && typeof impact === "object") {
		const o = impact as Record<string, unknown>;
		if (typeof o.summary === "string" && o.summary) return o.summary;
		if (typeof o.note === "string" && o.note) return o.note;
	}
	return "";
}

// Activity `details` may arrive as a string OR an object (logActivity stores
// structured details) — render it as a safe one-line string so the page can
// never crash on an object child.
function activityDetail(d: unknown): string {
	if (typeof d === "string") return d;
	if (d && typeof d === "object") {
		const o = d as Record<string, unknown>;
		if (typeof o.message === "string" && o.message) return o.message;
		if (typeof o.title === "string") return o.title;
		try {
			const s = JSON.stringify(d);
			return s && s.length > 2 ? s.slice(0, 200) : "";
		} catch {
			return "";
		}
	}
	return d == null ? "" : String(d);
}

const PRIO_STYLES: Record<string, string> = {
	critical: "bg-red-500/10 text-red-400 border-red-500/25",
	high: "bg-amber-500/10 text-amber-400 border-amber-500/25",
	medium: "bg-blue-500/10 text-blue-400 border-blue-500/25",
	low: "bg-ink3/10 text-ink3 border-ink3/20",
};

const STATUS_STYLES: Record<string, string> = {
	queued: "bg-ink3/10 text-ink3 border-ink3/20",
	claimed: "bg-blue-500/10 text-blue-400 border-blue-500/25",
	working: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
	verifying: "bg-amber-500/10 text-amber-400 border-amber-500/25",
	blocked: "bg-orange-500/10 text-orange-400 border-orange-500/25",
	waiting_approval: "bg-violet-500/10 text-violet-400 border-violet-500/25",
	failed: "bg-red-500/10 text-red-400 border-red-500/25",
	completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
};

function chip(text: string, style: string): React.ReactNode {
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${style}`}
		>
			{text}
		</span>
	);
}

const ALERT_SEVERITY_STYLES: Record<string, string> = {
	critical: "bg-red-500/10 text-red-400 border-red-500/30",
	high: "bg-amber-500/10 text-amber-400 border-amber-500/25",
	medium: "bg-blue-500/10 text-blue-400 border-blue-500/25",
	low: "bg-ink3/10 text-ink3 border-ink3/20",
	info: "bg-ink3/10 text-ink3 border-ink3/20",
};

function VerificationChip({ status }: { status: string }) {
	if (status === "passed")
		return chip(
			"VERIFIED ✓",
			"bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
		);
	if (status === "failed")
		return chip(
			"VERIFICATION FAILED",
			"bg-red-500/10 text-red-400 border-red-500/25",
		);
	if (status === "awaiting_approval")
		return chip(
			"WAITING APPROVAL",
			"bg-violet-500/10 text-violet-400 border-violet-500/25",
		);
	return chip("NOT VERIFIED", "bg-ink3/10 text-ink3 border-ink3/20");
}

function openWorkforce() {
	window.dispatchEvent(
		new CustomEvent("vb:admin-tab", { detail: "ai-operations" }),
	);
}
function openReports() {
	window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: "reports" }));
}
function openSuggestions() {
	window.dispatchEvent(
		new CustomEvent("vb:admin-tab", { detail: "suggestions" }),
	);
}
function openPolls() {
	window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: "polls" }));
}

// ─── Admin alert row ────────────────────────────────────────────────
// Three lifecycle states, three visual treatments (all real runtime state):
//   OPEN         → needs acknowledgment, red/amber, [Acknowledge] button
//   ACKNOWLEDGED → seen by an admin but the issue is still open, violet
//   RESOLVED     → the issue was actually fixed (resolved_at), green
function AlertRowItem({
	alert,
	onAcknowledge,
}: {
	alert: AlertRow;
	onAcknowledge?: (id: string) => void;
}) {
	const resolved = !!alert.resolved_at;
	const acknowledged = !resolved && !!alert.acknowledged_at;
	const critical = alert.severity === "critical";
	const panel = resolved
		? "border-emerald-500/25 bg-emerald-500/[0.04]"
		: acknowledged
			? "border-violet-500/25 bg-violet-500/[0.04]"
			: critical
				? "border-red-500/40 bg-red-500/[0.06]"
				: "border-amber-500/25 bg-amber-500/[0.04]";
	return (
		<div className={`rounded-lg border p-3 ${panel}`}>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						{chip(
							alert.severity.toUpperCase(),
							ALERT_SEVERITY_STYLES[alert.severity] ??
								ALERT_SEVERITY_STYLES.medium!,
						)}
						{resolved
							? chip(
									"RESOLVED ✓",
									"bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
								)
							: acknowledged
								? chip(
										"ACKNOWLEDGED · STILL OPEN",
										"bg-violet-500/10 text-violet-400 border-violet-500/25",
									)
								: null}
						<span className="text-[13px] font-semibold text-ink leading-snug">
							{alert.title}
						</span>
						{alert.occurrences > 1 && (
							<span className="text-[10px] text-ink3 font-mono">
								×{alert.occurrences} occurrences
							</span>
						)}
					</div>
					{alert.body && (
						<p className="mt-1 text-[11px] text-ink2 leading-snug">
							{alert.body}
						</p>
					)}
					<div className="mt-1.5 flex items-center gap-2 flex-wrap text-[10px] text-ink3">
						{alert.agent && <span>by {agentName(alert.agent)}</span>}
						{resolved ? (
							<span className="inline-flex items-center gap-1 text-emerald-400">
								<CheckCircle2 size={11} /> resolved {timeAgo(alert.resolved_at)}{" "}
								by {alert.resolved_by ?? "system"}
							</span>
						) : acknowledged ? (
							<span className="text-violet-400/90">
								acknowledged {timeAgo(alert.acknowledged_at)} · issue still open
							</span>
						) : (
							<span>{timeAgo(alert.last_at)}</span>
						)}
						{alert.evidence && (
							<span
								className="text-ink2 truncate max-w-[26rem]"
								title={alert.evidence}
							>
								evidence: {alert.evidence}
							</span>
						)}
					</div>
				</div>
				{!resolved && !acknowledged && (
					<button
						type="button"
						className="btn btn-ghost !text-[11px] !py-1 shrink-0"
						onClick={() => onAcknowledge?.(alert.id)}
						aria-label={`Acknowledge ${alert.title}`}
					>
						Acknowledge
					</button>
				)}
			</div>
		</div>
	);
}

// ─── Section shell ──────────────────────────────────────────────────
function Section({
	icon,
	title,
	accent,
	children,
	action,
}: {
	icon: React.ReactNode;
	title: string;
	accent: string;
	children: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<section className="card p-4 flex flex-col min-h-0">
			<header className="flex flex-wrap items-center justify-between gap-2 mb-3">
				<h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink2 min-w-0">
					<span
						className={`grid place-items-center w-6 h-6 rounded-md shrink-0 ${accent}`}
					>
						{icon}
					</span>
					<span className="min-w-0 break-words">{title}</span>
				</h2>
				{action}
			</header>
			{children}
		</section>
	);
}

// ─── Empty state ────────────────────────────────────────────────────
function Empty({ text }: { text: string }) {
	return (
		<div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-ink3">
			{text}
		</div>
	);
}

// ─── Row (incident / attention) ─────────────────────────────────────
function OpsRowItem({ row }: { row: OpsRow }) {
	return (
		<div className="rounded-lg border border-border bg-bg/60 p-3 transition-colors hover:border-accent/40">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-[13px] font-semibold text-ink leading-snug">
							{row.title}
						</span>
						{chip(
							row.priority.toUpperCase(),
							PRIO_STYLES[row.priority] ?? PRIO_STYLES.medium!,
						)}
					</div>
					<div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-ink3">
						<span className="inline-flex items-center gap-1">
							<Users size={11} /> {agentName(row.agent)}
						</span>
						<span className="inline-flex items-center gap-1">
							<Clock size={11} /> {timeAgo(row.created_at)}
						</span>
						{row.evidence_count > 0 && (
							<span className="inline-flex items-center gap-1 text-emerald-400">
								<CheckCircle2 size={11} /> {row.evidence_count} evidence
							</span>
						)}
						{row.timeline_count > 0 && (
							<span className="inline-flex items-center gap-1">
								<Activity size={11} /> {row.timeline_count} steps
							</span>
						)}
					</div>
				</div>
				<div className="flex flex-col items-end gap-1 shrink-0">
					{chip(
						row.status.toUpperCase().replace("_", " "),
						STATUS_STYLES[row.status] ?? STATUS_STYLES.queued!,
					)}
					<VerificationChip status={row.verification_status} />
				</div>
			</div>
			{row.error && (
				<p className="mt-2 text-[11px] text-red-400/90 leading-snug">
					⚠ {errorText(row.error)}
				</p>
			)}
			{impactText(row.impact) && (
				<p className="mt-2 text-[11px] text-emerald-400/90 leading-snug">
					Impact: {impactText(row.impact)}
				</p>
			)}
		</div>
	);
}

// ═══════════════════════════════════════════════════════════════════
export default function OpsCenter() {
	const { toast } = useApp();
	const [data, setData] = useState<OpsSummary | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [patrolling, setPatrolling] = useState(false);
	const lastRefreshRef = useRef(0);

	const load = useCallback(async () => {
		lastRefreshRef.current = Date.now();
		try {
			// getSlow (28s timeout) — ops-summary runs real DB scans + exact counts
			// (~3.6s live); the default 8s api.get timeout trips into the hard
			// "OPS DATA UNAVAILABLE" screen whenever the DB is briefly loaded.
			const r = await api.getSlow<OpsSummary>(
				"/api/workforce?action=ops-summary",
			);
			setData(r);
			setError(null);
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Ops data unavailable");
		}
	}, []);

	const { forceRefresh } = useSmartPoll(load, { intervalMs: 20000 });

	// Refresh on runtime events — but never more than once per 5s, so a burst
	// of task/execution events can't hammer the endpoint on top of the poll.
	useRealtime(["agent_tasks", "agent_executions", "workforce_config"], () => {
		if (Date.now() - lastRefreshRef.current > 5000) void forceRefresh();
	});

	const acknowledgeAlert = async (id: string) => {
		try {
			await api.post("/api/workforce", { action: "acknowledge-alert", id });
			toast("Alert acknowledged", "ok");
			void forceRefresh();
		} catch (e: unknown) {
			toast(
				`Acknowledge failed: ${e instanceof Error ? e.message : "unknown error"}`,
				"err",
			);
		}
	};

	const runPatrol = async () => {
		if (patrolling) return;
		setPatrolling(true);
		try {
			const r = await api.post<{
				executed?: number;
				failed?: number;
				paused?: boolean;
			}>("/api/workforce", {
				action: "patrol",
				limit: 2,
			});
			if (r.paused) {
				toast("Workforce is paused — resume it before patrolling", "info");
			} else {
				toast(
					`Patrol complete: ${r.executed ?? 0} agent(s) executed, ${r.failed ?? 0} failed`,
					"ok",
				);
			}
		} catch (e: unknown) {
			toast(
				`Patrol failed: ${e instanceof Error ? e.message : "unknown error"}`,
				"err",
			);
		} finally {
			setPatrolling(false);
			void forceRefresh();
		}
	};

	const tq = data?.task_queue ?? {};
	const m = data?.metrics;
	const activeNow = (tq.working ?? 0) + (tq.verifying ?? 0);

	// ─── Hard failure / degraded state — never pretend ────────────────
	if (error && !data) {
		return (
			<div className="space-y-4 min-w-0">
				<div className="card p-8 text-center">
					<AlertTriangle size={28} className="mx-auto mb-3 text-amber-400" />
					<h1 className="font-display font-bold text-lg">
						OPS DATA UNAVAILABLE
					</h1>
					<p className="text-xs text-ink3 mt-2 max-w-md mx-auto">
						The workforce runtime could not be reached: {error}. No numbers are
						shown rather than inventing them.
					</p>
					<button
						className="btn btn-primary mt-4"
						onClick={() => void forceRefresh()}
					>
						<RefreshCw size={14} /> Retry
					</button>
				</div>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="space-y-4 min-w-0">
				<div className="card p-8 grid place-items-center gap-3">
					<div className="skeleton w-64 h-6" />
					<div className="skeleton w-96 h-3" />
					<div className="skeleton w-72 h-3" />
				</div>
			</div>
		);
	}

	const incidents = data.incidents ?? [];
	const attention = data.attention ?? [];
	const autoResolved = data.auto_resolved ?? [];
	const activity = (data.activity ?? []).slice(0, 10);
	const providerOk = data.ai_provider?.ok !== false;
	const paused = !!data.config?.paused;
	const allAlerts = data.alerts?.alerts ?? [];
	const openAlerts = allAlerts.filter(
		(a) => !a.resolved_at && !a.acknowledged_at,
	);
	const pendingAlerts = allAlerts.filter(
		(a) => !a.resolved_at && a.acknowledged_at,
	);
	const resolvedAlerts = allAlerts.filter((a) => a.resolved_at);
	const criticalAlerts = data.alerts?.critical_open ?? 0;
	const openCount = data.alerts?.open ?? openAlerts.length;
	const pendingCount = data.alerts?.acknowledged_open ?? pendingAlerts.length;
	const resolvedCount = data.alerts?.resolved ?? resolvedAlerts.length;
	const report = data.report;

	const kpis = [
		{
			label: "ACTIVE NOW",
			value: activeNow,
			accent: "text-emerald-400",
			icon: <Zap size={16} />,
			note: "working + verifying",
		},
		{
			label: "QUEUED",
			value: tq.queued ?? 0,
			accent: "text-blue-400",
			icon: <Clock size={16} />,
			note: "waiting for a worker",
		},
		{
			label: "BLOCKED",
			value: tq.blocked ?? 0,
			accent: "text-orange-400",
			icon: <AlertTriangle size={16} />,
			note: "needs decision",
		},
		{
			label: "FAILED",
			value: tq.failed ?? 0,
			accent: "text-red-400",
			icon: <AlertOctagon size={16} />,
			note: "execution errors",
		},
		{
			label: "INCIDENTS",
			value: incidents.length,
			accent: "text-red-400",
			icon: <Radar size={16} />,
			note: "open high/critical",
		},
		{
			label: "ATTENTION",
			value: attention.length,
			accent: "text-violet-400",
			icon: <AlertTriangle size={16} />,
			note: "requires review",
		},
		{
			label: "VERIFIED 24H",
			value: data.verified_today ?? 0,
			accent: "text-emerald-400",
			icon: <CheckCircle2 size={16} />,
			note: "independently confirmed",
		},
	];

	return (
		<div className="space-y-4 min-w-0" data-testid="ops-center">
			{/* Immediate approval popups — the hidden workforce parks high-risk
          work here and this alert fires the moment a NEW task blocks. */}
			<ApprovalAlert />

			{/* BIG DANGER POPUP — fires the moment a critical/high alert is open.
          Unmissable red/amber panel (not a small list row), stays until the
          admin acknowledges it. */}
			<CriticalAlertBanner
				alerts={allAlerts}
				onAcknowledge={acknowledgeAlert}
				onOpenWorkforce={openWorkforce}
			/>

			{/* ── Header ─────────────────────────────────────────────────── */}
			{error && data && (
				<div
					className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400"
					role="status"
				>
					Refresh failed — showing last known state. {error}
				</div>
			)}

			<header className="flex flex-wrap items-center gap-3 justify-between">
				<div className="flex items-center gap-3">
					<span className="grid place-items-center w-10 h-10 rounded-xl bg-accent text-white shadow-lg shadow-accent/30">
						<Radar size={20} />
					</span>
					<div>
						<h1 className="font-display font-bold text-lg leading-tight">
							AI Operations
						</h1>
						<p className="text-[11px] text-ink3 flex items-center gap-1.5">
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
								<span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
							</span>
							LIVE · updated {timeAgo(data.updated_at)}
							{paused &&
								chip(
									"PAUSED",
									"bg-amber-500/10 text-amber-400 border-amber-500/25",
								)}
						</p>
					</div>
				</div>

				<div className="flex items-center gap-2 flex-wrap">
					{chip(
						providerOk ? "AI PROVIDER READY" : "AI PROVIDER DEGRADED",
						providerOk
							? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
							: "bg-amber-500/10 text-amber-400 border-amber-500/25",
					)}
					{chip(
						`PATROL ${timeAgo(data.last_patrol_at).toUpperCase()}`,
						"bg-ink3/10 text-ink3 border-ink3/20",
					)}
					<button
						className="btn btn-ghost !p-2"
						onClick={() => void forceRefresh()}
						aria-label="Refresh ops data"
						title="Refresh"
					>
						<RefreshCw size={15} />
					</button>
					<button
						className="btn btn-ghost"
						onClick={() => void runPatrol()}
						disabled={patrolling}
					>
						{patrolling ? (
							<span className="animate-spin inline-block">
								<RefreshCw size={14} />
							</span>
						) : (
							<Zap size={14} />
						)}
						{patrolling ? "Patrolling…" : "Run patrol"}
					</button>
					<button className="btn btn-primary" onClick={openWorkforce}>
						Open workforce <ArrowUpRight size={14} />
					</button>
				</div>
			</header>

			{/* ── LIVE WORKFORCE — what agents are working on RIGHT NOW ── */}
			{(() => {
				const liveWork = data.live_work ?? [];
				const now = Date.now();
				const liveChip = (s: string) =>
					STATUS_STYLES[s] ?? STATUS_STYLES.working!;
				return (					<Section
						icon={<Zap size={13} />}
						title={`LIVE WORKFORCE · WORKING NOW${liveWork.length > 0 ? ` · ${liveWork.length}` : ""}`}
						accent="bg-emerald-500/10 text-emerald-400"
					>
					{liveWork.length === 0 ? (
						<Empty text="NO TASKS IN PROGRESS — the workforce is idle right now. It wakes the moment real work is detected." />
					) : (
						<div className="space-y-1.5">							{liveWork.map((w) => {
								const hb = w.heartbeat_at
									? now - new Date(w.heartbeat_at).getTime()
									: null;
								// A working/verifying agent with a recent heartbeat is LIVE.
								// A claimed task with no heartbeat yet just hasn't started
								// (waiting), NOT stale — only a task that has started and
								// then lost its heartbeat deserves the amber treatment.
								const fresh = hb !== null && hb < 90 * 1000;
								const waiting = !w.started_at && !w.heartbeat_at;
								const dot =
									fresh
										? { text: "text-emerald-400", bg: "bg-emerald-400" }
										: waiting
											? { text: "text-ink3", bg: "bg-ink3" }
											: { text: "text-amber-400", bg: "bg-amber-400" };
								return (
									<div
										key={w.id}
										className="flex items-center gap-2.5 rounded-lg border border-border bg-bg/60 px-2.5 py-2 hover:border-emerald-500/30 transition-colors"
									>
										<span className={`relative flex h-2 w-2 shrink-0 ${dot.text}`}>
											<span
													className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${dot.bg}`}
											/>
											<span
													className={`relative inline-flex rounded-full h-2 w-2 ${dot.bg}`}
											/>
										</span>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="text-[13px] font-semibold text-ink leading-snug truncate">
													{w.title}
												</span>
												{chip(w.status.toUpperCase(), liveChip(w.status))}
											</div>
											<div className="mt-0.5 flex items-center gap-2 flex-wrap text-[10px] text-ink3">
												<span className="inline-flex items-center gap-1">
													<Activity size={10} /> {agentName(w.agent)}
												</span>
												<span className="inline-flex items-center gap-1">
													<Clock size={10} /> started {timeAgo(w.started_at)}
												</span>
												{fresh ? (
													<span className="text-emerald-400">● live</span>
												) : waiting ? (
													<span className="text-ink3">○ waiting to start</span>
												) : (
													<span className="text-amber-400">● heartbeat stale</span>
												)}
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</Section>
				);
			})()}

			{/* ── Admin alerts (persist until acknowledged) ─────────────── */}
			<Section
				icon={<BellRing size={13} />}
				title={`ADMIN ALERTS${criticalAlerts > 0 ? " · CRITICAL" : ""}`}
				accent={
					criticalAlerts > 0
						? "bg-red-500/10 text-red-400"
						: "bg-amber-500/10 text-amber-400"
				}
			>
				{openAlerts.length === 0 &&
				pendingAlerts.length === 0 &&
				resolvedAlerts.length === 0 ? (
					<Empty text="NO ACTIVE ALERTS — nothing requires attention or acknowledgment." />
				) : (
					<div className="space-y-3">
						{openAlerts.length > 0 && (
							<div className="space-y-2">
								<div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.12em] text-red-400">
									<span className="h-1.5 w-1.5 rounded-full bg-red-400" />
									ACTIVE · {openCount} REQUIRE{openCount === 1 ? "S" : ""}{" "}
									ACTION
								</div>
								{openAlerts.slice(0, 6).map((a) => (
									<AlertRowItem
										key={a.id}
										alert={a}
										onAcknowledge={acknowledgeAlert}
									/>
								))}
							</div>
						)}
						{pendingAlerts.length > 0 && (
							<div className="space-y-2">
								<div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.12em] text-violet-400">
									<span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
									ACKNOWLEDGED · SEEN, ISSUE STILL OPEN · {pendingCount}
								</div>
								{pendingAlerts.slice(0, 4).map((a) => (
									<AlertRowItem key={a.id} alert={a} />
								))}
							</div>
						)}
						{resolvedAlerts.length > 0 && (
							<div className="space-y-2">
								<div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.12em] text-emerald-400">
									<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
									RESOLVED · ISSUE FIXED · {resolvedCount}
								</div>
								{resolvedAlerts.slice(0, 3).map((a) => (
									<AlertRowItem key={a.id} alert={a} />
								))}
							</div>
						)}
					</div>
				)}
			</Section>

			{/* ── KPI row ────────────────────────────────────────────────── */}
			<div
				className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5"
				data-testid="ops-kpis"
			>
				{kpis.map((k) => (
					<div key={k.label} className="card p-3">
						<div
							className={`flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em] text-ink3 ${k.accent}`}
						>
							{k.icon} {k.label}
						</div>
						<div className="mt-1.5 font-display font-bold text-2xl leading-none text-ink">
							{k.value}
						</div>
						<div className="mt-1 text-[10px] text-ink3 truncate" title={k.note}>
							{k.note}
						</div>
					</div>
				))}
			</div>

			{/* ── Incidents + System health ──────────────────────────────── */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				<div className="lg:col-span-2 space-y-4 min-w-0">
					<Section
						icon={<Radar size={13} />}
						title="ACTIVE INCIDENTS"
						accent="bg-red-500/10 text-red-400"
					>
						{incidents.length === 0 ? (
							<Empty text="NO ACTIVE INCIDENTS — no high-priority work requires attention right now." />
						) : (
							<div className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
								{incidents.map((row) => (
									<OpsRowItem key={row.id} row={row} />
								))}
							</div>
						)}
					</Section>

					<Section
						icon={<AlertTriangle size={13} />}
						title="AI ATTENTION REQUIRED"
						accent="bg-violet-500/10 text-violet-400"
						action={
							<button
								className="btn btn-ghost !text-[11px] !py-1"
								onClick={openReports}
							>
								Open approvals <ArrowUpRight size={12} />
							</button>
						}
					>
						{attention.length === 0 ? (
							<Empty text="NO ATTENTION REQUIRED — the workforce is handling everything automatically." />
						) : (
							<div className="space-y-2 max-h-[24rem] overflow-y-auto pr-1">
								{attention.map((row) => (
									<OpsRowItem key={row.id} row={row} />
								))}
							</div>
						)}
					</Section>
				</div>

				{/* ── System health ────────────────────────────────────────── */}
				<div className="space-y-4 min-w-0">
					<Section
						icon={<Database size={13} />}
						title="SYSTEM HEALTH"
						accent="bg-blue-500/10 text-blue-400"
					>
						<div className="space-y-2">
							<div className="flex items-center justify-between rounded-lg border border-border bg-bg/60 px-3 py-2">
								<span className="flex items-center gap-2 text-xs text-ink2">
									<Database size={13} className="text-blue-400" /> Database
								</span>
								<span className="text-xs font-semibold text-ink">
									{data.platform?.posts ?? 0} posts ·{" "}
									{data.platform?.pending_reports ?? 0} pending reports
								</span>
							</div>
							<div className="flex items-center justify-between rounded-lg border border-border bg-bg/60 px-3 py-2">
								<span className="flex items-center gap-2 text-xs text-ink2">
									<Cpu size={13} className="text-emerald-400" /> AI provider
								</span>
								{chip(
									providerOk ? "READY" : "DEGRADED",
									providerOk
										? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
										: "bg-amber-500/10 text-amber-400 border-amber-500/25",
								)}
							</div>
							<div className="flex items-center justify-between rounded-lg border border-border bg-bg/60 px-3 py-2">
								<span className="flex items-center gap-2 text-xs text-ink2">
									<Activity size={13} className="text-violet-400" /> Realtime
								</span>
								<span className="text-[11px] text-ink3">
									{timeAgo(data.last_patrol_at)} since patrol
								</span>
							</div>
							<div className="flex items-center justify-between rounded-lg border border-border bg-bg/60 px-3 py-2">
								<span className="flex items-center gap-2 text-xs text-ink2">
									<Users size={13} className="text-amber-400" /> Users
								</span>
								<span className="text-xs font-semibold text-ink">
									{data.platform?.users ?? 0} · {data.platform?.comments ?? 0}{" "}
									comments
								</span>
							</div>
						</div>
					</Section>

					<Section
						icon={<Gauge size={13} />}
						title="WORKFORCE HEALTH"
						accent="bg-emerald-500/10 text-emerald-400"
					>
						<div className="space-y-2">
							<div className="grid grid-cols-2 gap-2">
								<div className="rounded-lg border border-border bg-bg/60 p-3 text-center">
									<div className="font-display font-bold text-xl text-ink">
										{m?.total_employees ?? 0}
									</div>
									<div className="text-[10px] text-ink3 font-semibold tracking-wide">
										EMPLOYEES
									</div>
								</div>
								<div className="rounded-lg border border-border bg-bg/60 p-3 text-center">
									<div className="font-display font-bold text-xl text-emerald-400">
										{m?.utilized ?? 0}
									</div>
									<div className="text-[10px] text-ink3 font-semibold tracking-wide">
										UTILIZED
									</div>
								</div>
								<div className="rounded-lg border border-border bg-bg/60 p-3 text-center">
									<div className="font-display font-bold text-xl text-amber-400">
										{m?.underutilized ?? 0}
									</div>
									<div className="text-[10px] text-ink3 font-semibold tracking-wide">
										UNDERUSED
									</div>
								</div>
								<div className="rounded-lg border border-border bg-bg/60 p-3 text-center">
									<div className="font-display font-bold text-xl text-blue-400">
										{activeNow}
									</div>
									<div className="text-[10px] text-ink3 font-semibold tracking-wide">
										ACTIVE NOW
									</div>
								</div>
							</div>
							<div className="rounded-lg border border-border bg-bg/60 px-3 py-2 flex items-center justify-between">
								<span className="text-xs text-ink2">Verified success rate</span>
								<span className="text-xs font-bold text-emerald-400">
									{m?.success_rate != null
										? `${m.success_rate}%`
										: "no verified data"}
								</span>
							</div>
							<div className="rounded-lg border border-border bg-bg/60 px-3 py-2 flex items-center justify-between">
								<span className="text-xs text-ink2">Avg execution</span>
								<span className="text-xs font-semibold text-ink">
									{m?.avg_duration_ms != null
										? `${(m.avg_duration_ms / 1000).toFixed(1)}s`
										: "—"}
								</span>
							</div>
						</div>
					</Section>
				</div>
			</div>

			{/* ── Platform pulse (real recent / trending / emergency content) ── */}
			{data.platform?.pulse && (
				<Section
					icon={<Activity size={13} />}
					title="PLATFORM PULSE · LIVE CONTENT"
					accent="bg-blue-500/10 text-blue-400"
					action={
						<button
							className="btn btn-ghost !text-[11px] !py-1"
							onClick={openReports}
						>
							Open reports <ArrowUpRight size={12} />
						</button>
					}
				>
					{(() => {
						const pulse = data.platform!.pulse!;
						const prioColor = (p?: string) =>
							p === "critical"
								? "text-red-400"
								: p === "high"
									? "text-amber-400"
									: "text-ink3";
						return (
							<div className="space-y-4">
								{/* Emergency strip — only when something is actually critical/high */}
								{pulse.emergency.length > 0 && (
									<div className="rounded-lg border border-red-500/25 bg-red-500/[0.05] p-3">
										<div className="flex items-center gap-2 mb-2">
											<AlertOctagon size={13} className="text-red-400" />
											<span className="text-[10px] font-bold tracking-[0.14em] text-red-400">
												EMERGENCY · {pulse.emergency_count} CRITICAL/HIGH
											</span>
										</div>
										<div className="space-y-1.5">
											{pulse.emergency.slice(0, 4).map((p) => (
													<div
														key={p.id}
														className="flex items-center gap-2 text-[11px]"
													>
														<span
																className={`chip !text-[9px] ${prioColor(p.priority)}`}
															>
															{p.priority}
															</span>
														<span className="truncate min-w-0">{p.title}</span>
													</div>
												))}
										</div>
									</div>
								)}

								<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
									{/* Recent */}
									<div>
										<div className="text-[10px] font-bold tracking-[0.12em] text-ink3 mb-1.5">
											RECENT
										</div>
										<div className="space-y-1.5">
											{pulse.recent.length === 0 && (
												<p className="text-[10px] text-ink3">No posts yet</p>
											)}
											{pulse.recent.slice(0, 5).map((p) => (
												<div key={p.id} className="flex items-start gap-1.5 text-[11px]">
													<span className="text-ink3 mt-0.5 shrink-0">•</span>
													<div className="min-w-0">
														<p className="truncate text-ink2">{p.title}</p>
														<p className="text-[9px] text-ink3">
															{p.category || "uncategorized"} · {timeAgo(p.created_at)}
														</p>
													</div>
												</div>
											))}
										</div>
									</div>

									{/* Trending — REAL engagement (reactions + comments) */}
									<div>
										<div className="text-[10px] font-bold tracking-[0.12em] text-ink3 mb-1.5">
											TRENDING
										</div>
										<div className="space-y-1.5">
											{pulse.trending.length === 0 && (
												<p className="text-[10px] text-ink3">No activity yet</p>
											)}
											{pulse.trending.slice(0, 5).map((p, i) => (
												<div key={p.id} className="flex items-center gap-1.5 text-[11px]">
													<span className="font-bold text-[9px] text-ink3 w-3 shrink-0">
														{i + 1}
													</span>
													<p className="truncate min-w-0 text-ink2">{p.title}</p>
													<span className="text-[9px] text-emerald-400 shrink-0 font-mono">
														{p.engagement ?? 0}↑
													</span>
												</div>
											))}
										</div>
									</div>

									{/* Counts: Reports / Suggestions / Polls */}
									<div>
										<div className="text-[10px] font-bold tracking-[0.12em] text-ink3 mb-1.5">
											QUEUES
										</div>
										<div className="space-y-1.5">
											<button
												className="w-full flex items-center justify-between rounded-lg border border-border bg-bg/60 px-2.5 py-1.5 text-[11px] hover:border-accent/40 transition-colors"
												onClick={openReports}
											>
												<span className="text-ink2">Open reports</span>
												<span className="font-bold text-red-400">
													{pulse.reports_open}
												</span>
											</button>
											<button
												className="w-full flex items-center justify-between rounded-lg border border-border bg-bg/60 px-2.5 py-1.5 text-[11px] hover:border-accent/40 transition-colors"
												onClick={openSuggestions}
											>
												<span className="text-ink2">Suggestions</span>
												<span className="font-bold text-amber-400">
													{pulse.suggestions}
												</span>
											</button>
											<button
												className="w-full flex items-center justify-between rounded-lg border border-border bg-bg/60 px-2.5 py-1.5 text-[11px] hover:border-accent/40 transition-colors"
												onClick={openPolls}
											>
												<span className="text-ink2">Active polls</span>
												<span className="font-bold text-blue-400">
													{pulse.polls_active}
												</span>
											</button>
											{pulse.polls.length > 0 && (
												<div className="pt-1 space-y-0.5">
													{pulse.polls.slice(0, 3).map((p) => (
														<div
															key={p.id}
															className="text-[10px] text-ink3 truncate"
															title={p.title}
														>
															📊 {p.title}
														</div>
													))}
												</div>
											)}
										</div>
									</div>
								</div>
							</div>
						);
					})()}
				</Section>
			)}

			{/* ── Automatically resolved (verified outcomes) ─────────────── */}
			<Section
				icon={<CheckCircle2 size={13} />}
				title="AUTOMATICALLY RESOLVED · VERIFIED OUTCOMES"
				accent="bg-emerald-500/10 text-emerald-400"
			>
				{autoResolved.length === 0 ? (
					<Empty text="NO VERIFIED ACTIONS YET — no platform change has been independently verified." />
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
						{autoResolved.map((row) => (
							<div
								key={row.id}
								className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="text-[13px] font-semibold text-ink leading-snug truncate">
										{row.title}
									</span>
									{chip(
										row.verification_status === "passed"
											? "VERIFIED ✓"
											: "VERIFIED",
										"bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
									)}
								</div>
								<div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-ink3">
									<span className="inline-flex items-center gap-1">
										<Users size={11} /> {agentName(row.agent)}
									</span>
									<span className="inline-flex items-center gap-1">
										<Clock size={11} /> {timeAgo(row.completed_at)}
									</span>
									{row.evidence_count > 0 && (
										<span className="inline-flex items-center gap-1 text-emerald-400">
											<CheckCircle2 size={11} /> {row.evidence_count} evidence
										</span>
									)}
								</div>
								{row.outcomes.length > 0 && (
									<ul className="mt-2 space-y-1">
										{row.outcomes.map((o, i) => (
											<li
												key={i}
												className="text-[11px] text-ink2 leading-snug"
											>
												<span className="text-emerald-400">✓</span> {o.what}
												{impactText(o.impact) && (
													<span className="text-ink3">
														{" "}— {impactText(o.impact)}
													</span>
												)}
											</li>
										))}
									</ul>
								)}
							</div>
						))}
					</div>
				)}
			</Section>

			{/* ── Daily operations report ────────────────────────────────── */}
			{report && (
				<Section
					icon={<CalendarDays size={13} />}
					title="OPERATIONS REPORT · LAST 24H"
					accent="bg-blue-500/10 text-blue-400"
				>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
						{[
							{ label: "Tasks created", value: report.tasks_created_24h },
							{ label: "Tasks completed", value: report.tasks_completed_24h },
							{
								label: "Failed",
								value: report.tasks_failed_24h,
								tone: "text-red-400",
							},
							{
								label: "Verified outcomes",
								value: report.verified_outcomes_24h,
								tone: "text-emerald-400",
							},
							{
								label: "Auto-resolved",
								value: report.auto_resolved_24h,
								tone: "text-emerald-400",
							},
							{
								label: "Incidents open",
								value: report.incidents_open,
								tone: "text-red-400",
							},
							{
								label: "Attention open",
								value: report.attention_open,
								tone: "text-violet-400",
							},
							{
								label: "Alerts open",
								value: report.alerts_open,
								tone: criticalAlerts > 0 ? "text-red-400" : "text-amber-400",
							},
						].map((s) => (
							<div
								key={s.label}
								className="rounded-lg border border-border bg-bg/60 p-3"
							>
								<div
									className={`font-display font-bold text-xl leading-none ${s.tone ?? "text-ink"}`}
								>
									{s.value}
								</div>
								<div className="mt-1 text-[10px] text-ink3 font-semibold tracking-wide">
									{s.label}
								</div>
							</div>
						))}
					</div>
					{report.top_risks.length > 0 && (
						<div className="mt-3 flex items-center gap-2 flex-wrap">
							<span className="text-[10px] text-ink3 font-bold tracking-[0.12em]">
								TOP RISK SOURCES:
							</span>
							{report.top_risks.map((r) => (
								<span
									key={r.label}
									className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-ink2"
								>
									{r.label}{" "}
									<span className="text-ink3 font-mono">×{r.count}</span>
								</span>
							))}
						</div>
					)}
				</Section>
			)}

			{/* ── Live activity (real runtime events only) ───────────────── */}
			<Section
				icon={<Activity size={13} />}
				title="REAL-TIME ACTIVITY"
				accent="bg-ink3/10 text-ink2"
				action={
					<button
						className="btn btn-ghost !text-[11px] !py-1"
						onClick={openWorkforce}
					>
						Full log <ArrowUpRight size={12} />
					</button>
				}
			>
				{activity.length === 0 ? (
					<Empty text="NO ACTIVITY YET — the runtime has not emitted events since the last restart." />
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
						{activity.map((a, i) => {
							const detailText = activityDetail(a.details);
							return (
								<div
									key={`${a.created_at}-${i}`}
									className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface2/60 transition-colors"
								>
									<span className="text-[10px] text-ink3 font-mono mt-0.5 shrink-0">
										{timeAgo(a.created_at)}
									</span>
									<div className="min-w-0">
										<div className="text-[11px] leading-snug">
											<span className="font-semibold text-ink2">
												{agentName(a.agent_id)}
											</span>
											<span className="text-ink3"> — </span>
											<span className="text-ink2 break-words">{a.action}</span>
										</div>
										{detailText && (
											<p
												className="text-[10px] text-ink3 truncate max-w-[38ch]"
												title={detailText}
											>
												{detailText}
											</p>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</Section>
		</div>
	);
}
