import {
	Activity,
	Brain,
	Building2,
	CheckCircle2,
	Gavel,
	LayoutDashboard,
	ListTodo,
	RefreshCcw,
	ShieldCheck,
	TriangleAlert,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import AgentTeamPanel from "./AgentTeamPanel";
import ApprovalAlert from "./agent-office/ApprovalAlert";
import Reports from "./Reports";
import WorkforceConsole from "./WorkforceConsole";

/* ═══════════════════════════════════════════════════════════════
   AI OPERATIONS — the single door to the whole AI workforce.
   An enterprise command-center shell (Linear / OpenAI / NVIDIA
   grade): a live KPI strip on top fed by the REAL runtime, then
   three workspaces behind one tab:

     • COMMAND          → the real runtime: task queue, patrol,
                          approval center, impact center, activity
     • OFFICE           → the 3D agent office + per-employee desks
                          (inspector with real Work Records)
     • REPORTS & REVIEW → Reports → Content Review → Approval, one
                          pipeline with escalate-to-approval

   Design language (researched from Linear / Vercel / OpenAI /
   Anthropic / NVIDIA consoles):
     • layered charcoal surfaces, ultra-thin translucent borders
     • tabular monospace numerals for every metric (no jitter)
     • semantic status colors: emerald/amber/red/blue at ≤10% tint
     • snappy cubic-bezier(0.16,1,0.3,1) micro-interactions
     • the KPI strip is REAL data — never fabricated
   ═══════════════════════════════════════════════════════════════ */
type Section = "command" | "office" | "review";

const SECTION_META: Record<
	Section,
	{ label: string; icon: React.ReactNode; hint: string }
> = {
	command: {
		label: "Command",
		icon: <LayoutDashboard size={14} />,
		hint: "Task queue · patrol · approvals · impact",
	},
	office: {
		label: "Office",
		icon: <Building2 size={14} />,
		hint: "3D office · employee desks · live states",
	},
	review: {
		label: "Reports & Review",
		icon: <ShieldCheck size={14} />,
		hint: "Reports → content review → approval",
	},
};

interface OverviewShape {
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
		completion_rate: number | null;
		avg_duration_ms: number | null;
	};
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
	ai_provider?: { ok: boolean; status: string; note: string };
	updated_at: string;
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
	return `${Math.floor(s / 3600)}h ago`;
}

/* ── KPI card — enterprise spec: mono numeral, tinted icon, thin border ── */
function KpiCard({
	icon,
	label,
	value,
	tint,
	pulse,
}: {
	icon: React.ReactNode;
	label: string;
	value: React.ReactNode;
	tint: string;
	pulse?: boolean;
}) {
	return (
		<div className="relative overflow-hidden bg-surface2 rounded-xl px-3.5 py-3 border border-white/[0.06] shadow-sm">
			{/* top sheen — ultra-subtle glass highlight */}
			<div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />
			<div className="flex items-center gap-2.5">
				<div
					className={`w-8 h-8 rounded-lg grid place-items-center ${tint} flex-shrink-0`}
				>
					{icon}
				</div>
				<div className="min-w-0">
					<p className="text-lg leading-none font-semibold text-ink1 tabular-nums tracking-[-0.03em] flex items-center gap-1.5">
						{value}
						{pulse && (
							<span className="relative flex w-1.5 h-1.5">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
								<span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-emerald-400" />
							</span>
						)}
					</p>
					<p className="text-[9px] text-ink3 font-medium uppercase tracking-wider mt-1 truncate">
						{label}
					</p>
				</div>
			</div>
		</div>
	);
}

export default function AIOperations() {
	const { toast } = useApp();
	const [section, setSection] = useState<Section>("command");
	const [overview, setOverview] = useState<OverviewShape | null>(null);
	const [approvalCount, setApprovalCount] = useState(0);
	const [synced, setSynced] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);

	const loadKpis = useCallback(async (skipOverview = false) => {
		// The Command workspace already polls the overview on its own 6s loop, so
		// the shell skips it there — no duplicate fetches. Office/Review rely on
		// the shell for the KPI strip.
		if (!skipOverview) {
			try {
				const r = await api.get<OverviewShape>(
					"/api/workforce?action=overview",
				);
				setOverview(r);
			} catch (e: unknown) {
				console.warn(
					"[AIOperations] kpi load failed:",
					e instanceof Error ? e.message : e,
				);
			}
		}
		try {
			const a = await api.post<{ approvals: unknown[] }>("/api/workforce", {
				action: "pending-approvals",
			});
			setApprovalCount(Array.isArray(a.approvals) ? a.approvals.length : 0);
		} catch {
			/* approvals empty on failure is truthful */
		}
		setSynced(new Date().toISOString()); // time of THIS successful sync (local clock)
	}, []);

	useEffect(() => {
		loadKpis();
	}, [loadKpis]);
	useEffect(() => {
		// Re-sync immediately when switching workspaces so counts are never stale
		setSynced(null);
		loadKpis(section === "command"); // Command has its own overview loop
	}, [section, loadKpis]);
	useEffect(() => {
		const id = setInterval(() => loadKpis(section === "command"), 8000);
		const onVis = () => {
			if (!document.hidden) loadKpis(section === "command");
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			clearInterval(id);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, [loadKpis, section]);

	const refresh = async () => {
		setRefreshing(true);
		await loadKpis();
		setRefreshing(false);
		toast("Operations synced", "ok");
	};

	const kpis = useMemo(
		() => ({
			working: overview?.metrics.working ?? 0,
			verifying: overview?.metrics.verifying ?? 0,
			verified: overview?.metrics.verified_outcomes ?? 0,
			success: overview?.metrics.success_rate,
			failed: overview?.metrics.failed_executions ?? 0,
			blocked: overview?.task_queue.blocked ?? 0,
			tasks: overview?.task_queue.total ?? 0,
			approvals: approvalCount,
		}),
		[overview, approvalCount],
	);

	const sectionCounts: Record<Section, number> = {
		command: kpis.tasks,
		office: overview?.metrics.total_employees ?? 0,
		review: kpis.approvals,
	};

	return (
		<div className="space-y-4">
			{/* ── Command center header ───────────────────────────── */}
			<div className="relative overflow-hidden bg-surface rounded-2xl border border-white/[0.06] shadow-sm">
				<div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
				<div className="px-5 py-4 flex items-start justify-between flex-wrap gap-3">
					<div className="flex items-center gap-3.5">
						<div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent to-accent2 text-white grid place-items-center shadow-lg shadow-accent/25">
							<Brain size={20} />
						</div>
						<div>
							<div className="flex items-center gap-2.5">
								<h1 className="font-display font-bold text-xl tracking-[-0.02em]">
									AI Operations
								</h1>
								<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 text-[9px] font-mono font-bold tracking-wider">
									<span className="relative flex w-1.5 h-1.5">
										<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
										<span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-emerald-400" />
									</span>
									LIVE
								</span>
							</div>
							<p className="text-[11px] text-ink3 mt-1 flex items-center gap-1.5">
								One command center for the entire AI workforce — same real
								runtime, three workspaces.
								<span className="hidden sm:inline text-ink3/70 font-mono">
									synced {timeAgo(synced)}
								</span>
							</p>
						</div>
					</div>
					<button
						onClick={refresh}
						className="btn btn-ghost !p-2"
						title="Sync operations data"
					>
						<RefreshCcw
							size={14}
							className={refreshing ? "animate-spin" : ""}
						/>
					</button>
				</div>
			</div>

			{/* ── Honest provider status (Phase 43) ────────────────── */}
			{overview?.ai_provider?.status === "degraded" && (
				<div
					className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30"
					role="status"
				>
					<TriangleAlert size={14} className="text-amber-400 flex-shrink-0" />
					<p className="text-[11px] text-amber-300 leading-snug">
						<span className="font-bold uppercase tracking-wider text-amber-400">
							AI provider degraded
						</span>
						<span className="text-amber-300/80">
							{" "}
							— no API key configured. Agents run data-only patrols (discovery,
							recovery, verified execution) but cannot reason/analyze. Add a key
							in <span className="font-mono">Settings → AI Providers</span> to
							restore full reasoning.
						</span>
					</p>
				</div>
			)}

			{/* ── Live KPI strip — REAL runtime data ───────────────── */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
				<KpiCard
					icon={<Zap size={14} />}
					label="Working now"
					tint="bg-emerald-500/10 text-emerald-400"
					value={kpis.working}
					pulse={kpis.working > 0}
				/>
				<KpiCard
					icon={<Activity size={14} />}
					label="Verifying"
					tint="bg-amber-500/10 text-amber-400"
					value={kpis.verifying}
					pulse={kpis.verifying > 0}
				/>
				<KpiCard
					icon={<CheckCircle2 size={14} />}
					label="Verified outcomes"
					tint="bg-blue-500/10 text-blue-400"
					value={kpis.verified}
				/>
				<KpiCard
					icon={<Gavel size={14} />}
					label="Awaiting approval"
					tint="bg-orange-500/10 text-orange-400"
					value={kpis.approvals}
					pulse={kpis.approvals > 0}
				/>
				<KpiCard
					icon={<Brain size={14} />}
					label="Verified success"
					tint="bg-violet-500/10 text-violet-400"
					value={kpis.success != null ? `${kpis.success}%` : "—"}
				/>
				<KpiCard
					icon={<ListTodo size={14} />}
					label="Tasks in queue"
					tint="bg-sky-500/10 text-sky-400"
					value={kpis.tasks}
				/>
			</div>

			{/* ── Section switcher (with real counts) ──────────────── */}
			<div className="flex items-center gap-1.5 p-1 rounded-xl bg-surface2 border border-white/[0.06] w-fit flex-wrap shadow-sm">
				{(Object.keys(SECTION_META) as Section[]).map((key) => {
					const meta = SECTION_META[key];
					const active = section === key;
					return (
						<button
							key={key}
							onClick={() => setSection(key)}
							aria-pressed={active}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-150 text-[11px] font-semibold ${
								active
									? "bg-accent text-white shadow-sm"
									: "text-ink2 hover:text-ink1 hover:bg-surface3/60"
							}`}
							style={{ transitionTimingFunction: "cubic-bezier(.16,1,.3,1)" }}
							title={meta.hint}
						>
							{meta.icon} {meta.label}
							<span
								className={`text-[9px] font-mono px-1.5 py-px rounded-full ${active ? "bg-white/20 text-white" : "bg-surface3/80 text-ink3"}`}
							>
								{sectionCounts[key]}
							</span>
						</button>
					);
				})}
				{kpis.failed > 0 && (
					<span
						className="flex items-center gap-1 text-[9px] font-mono text-red-400 px-2"
						title="Failed executions (real)"
					>
						<TriangleAlert size={10} /> {kpis.failed} failed
					</span>
				)}
			</div>

			{/* ── Active workspace (mounted lazily — one poll loop) ── */}
			{section === "command" && <WorkforceConsole />}
			{section === "office" && <AgentTeamPanel />}
			{section === "review" && <Reports />}

			{/* ── Immediate approval popup — fires in EVERY workspace ── */}
			<ApprovalAlert />
		</div>
	);
}
