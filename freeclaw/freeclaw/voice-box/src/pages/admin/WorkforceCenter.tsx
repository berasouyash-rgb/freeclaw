import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Loader2,
	Play,
	ShieldAlert,
	ShieldCheck,
	SkipForward,
	XCircle,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";

interface LedgerRow {
	id: string;
	worker_id: string;
	name: string;
	event_id: string;
	started_at: string;
	outcome:
		| "verified_success"
		| "verified_failure"
		| "execution_failed"
		| "skipped"
		| "escalated"
		| "budget_blocked";
	decision: string | null;
	evidence: string | null;
	verification: string | null;
	metrics: { metric: string; before: unknown; after: unknown } | null;
	error: string | null;
	duration_ms: number | null;
}

interface WorkerSpec {
	worker_id: string;
	name: string;
	responsibility: string;
	execution_class: "A" | "B" | "C";
	risk_level: string;
	trigger_types: string[];
	budget: { max_runs_per_hour: number; max_affected_records: number };
	tools: string[];
}

interface Health {
	total_executions_24h: number;
	verified_success_24h: number;
	verified_failure_24h: number;
	execution_failed_24h: number;
	budget_blocked_24h: number;
	escalated_24h: number;
	workers_registered: number;
}

const OUTCOME_STYLE: Record<
	string,
	{ cls: string; icon: typeof Zap; label: string }
> = {
	verified_success: {
		cls: "text-good bg-good/10 border-good/25",
		icon: CheckCircle2,
		label: "VERIFIED",
	},
	verified_failure: {
		cls: "text-bad bg-bad/10 border-bad/25",
		icon: XCircle,
		label: "FAILED VERIFICATION",
	},
	execution_failed: {
		cls: "text-bad bg-bad/10 border-bad/25",
		icon: AlertTriangle,
		label: "EXECUTION FAILED",
	},
	skipped: {
		cls: "text-ink3 bg-surface2 border-border",
		icon: SkipForward,
		label: "NO-OP",
	},
	escalated: {
		cls: "text-warn bg-warn/10 border-warn/30",
		icon: ShieldAlert,
		label: "ESCALATED",
	},
	budget_blocked: {
		cls: "text-ink3 bg-surface2 border-border",
		icon: Clock,
		label: "BUDGET BLOCKED",
	},
};

export default function WorkforceCenter() {
	const { toast } = useApp();
	const [loading, setLoading] = useState(true);
	const [scanning, setScanning] = useState(false);
	const [workers, setWorkers] = useState<WorkerSpec[]>([]);
	const [health, setHealth] = useState<Health | null>(null);
	const [ledger, setLedger] = useState<LedgerRow[]>([]);

	const load = useCallback(async () => {
		try {
			const data = await api.get<{
				workers: WorkerSpec[];
				health: Health;
				ledger: LedgerRow[];
			}>("/api/workforce-center");
			setWorkers(data.workers || []);
			setHealth(data.health || null);
			setLedger(data.ledger || []);
		} catch (e: unknown) {
			toast(
				e instanceof Error ? e.message : "Failed to load workforce",
				"err",
			);
		}
		setLoading(false);
	}, [toast]);

	useEffect(() => {
		load();
	}, [load]);

	const runScan = async () => {
		if (scanning) return;
		setScanning(true);
		try {
			await api.post("/api/workforce-center", { action: "run_scan" });
			toast("Roster executed — every result below is a recorded run", "ok");
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Scan failed", "err");
		}
		setScanning(false);
	};

	return (
		<div className="max-w-5xl mx-auto vb-page-enter">
			<div className="flex items-start justify-between gap-3 mb-1">
				<div>
					<h1 className="font-display font-bold text-xl sm:text-2xl">
						AI Workforce · Command Center
					</h1>
					<p className="text-xs text-ink3 mt-0.5">
						Hidden operations workforce. Every entry below is a real recorded
						execution — nothing here is simulated.
					</p>
				</div>
				<button
					className={`btn btn-primary !py-2 shrink-0 ${scanning ? "btn-loading" : ""}`}
					onClick={runScan}
					disabled={scanning}
				>
					{scanning ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						<Play size={14} />
					)}
					Run roster
				</button>
			</div>

			{/* Health strip — computed ONLY from ledger rows */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 my-4">
				{[
					{
						label: "Workers",
						value: health?.workers_registered ?? "—",
						icon: Activity,
					},
					{
						label: "Runs 24h",
						value: health?.total_executions_24h ?? "—",
						icon: Zap,
					},
					{
						label: "Verified",
						value: health?.verified_success_24h ?? "—",
						icon: ShieldCheck,
						tone: "text-good",
					},
					{
						label: "Failed verify",
						value: health?.verified_failure_24h ?? "—",
						icon: XCircle,
						tone: "text-bad",
					},
					{
						label: "Escalated",
						value: health?.escalated_24h ?? "—",
						icon: ShieldAlert,
						tone: "text-warn",
					},
					{
						label: "Budget blocked",
						value: health?.budget_blocked_24h ?? "—",
						icon: Clock,
					},
				].map(({ label, value, icon: Icon, tone }) => (
					<div key={label} className="card p-3">
						<p className="text-[9px] font-bold uppercase tracking-wider text-ink3 flex items-center gap-1">
							<Icon size={11} /> {label}
						</p>
						<p
							className={`font-display font-bold text-xl mt-1 ${tone ?? ""}`}
						>
							{value}
						</p>
					</div>
				))}
			</div>

			{/* Worker registry */}
			<h2 className="text-xs font-bold uppercase tracking-wider text-ink3 mb-2">
				Registered workers
			</h2>
			<div className="grid sm:grid-cols-2 gap-2.5 mb-6">
				{(workers || []).map((w) => (
					<div key={w.worker_id} className="card p-3.5">
						<div className="flex items-center gap-2 flex-wrap">
							<p className="font-semibold text-sm">{w.name}</p>
							<span
								className={`chip !text-[9px] ${
									w.execution_class === "A"
										? "!bg-good/10 !text-good !border-good/25"
										: "!bg-warn/10 !text-warn !border-warn/25"
								}`}
								title={
									w.execution_class === "A"
										? "Class A: safe autonomous action"
										: w.execution_class === "C"
											? "Class C: evidence only — never executes"
											: "Class B: mitigates and notifies"
								}
							>
								CLASS {w.execution_class}
							</span>
						</div>
						<p className="text-[11px] text-ink3 mt-1 leading-snug">
							{w.responsibility}
						</p>
						<p className="text-[10px] text-ink3 mt-1.5 font-mono truncate">
							tools: {w.tools.join(", ") || "—"}
						</p>
					</div>
				))}
				{!loading && workers.length === 0 && (
					<p className="text-xs text-ink3">No workers registered.</p>
				)}
			</div>

			{/* Live ledger stream */}
			<h2 className="text-xs font-bold uppercase tracking-wider text-ink3 mb-2">
				Action ledger · recent executions
			</h2>
			<div className="card divide-y divide-border">
				{loading && (
					<div className="p-6 flex items-center gap-2 text-xs text-ink3">
						<Loader2 size={13} className="animate-spin" /> Loading recorded
						activity…
					</div>
				)}
				{!loading && ledger.length === 0 && (
					<div className="p-8 text-center">
						<Activity size={22} className="mx-auto text-ink3/40 mb-2" />
						<p className="text-sm font-medium">
							No executions recorded yet
						</p>
						<p className="text-[11px] text-ink3 mt-1">
							The workforce runs on the daily cron — or press “Run roster” to
							execute it now. Only real runs will appear here.
						</p>
					</div>
				)}
				{ledger.map((r) => {
					const st = OUTCOME_STYLE[r.outcome] ?? {
						cls: "text-ink3 bg-surface2 border-border",
						icon: SkipForward,
						label: r.outcome,
					};
					const Icon = st.icon;
					return (
						<div key={r.id} className="p-3.5">
							<div className="flex items-center gap-2 flex-wrap">
								<span
									className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold ${st.cls}`}
								>
									<Icon size={10} /> {st.label}
								</span>
								<span className="text-xs font-semibold">{r.name}</span>
								<span className="ml-auto text-[10px] text-ink3 font-mono">
									{new Date(r.started_at).toLocaleTimeString()} ·{" "}
									{r.duration_ms != null ? `${r.duration_ms}ms` : ""}
								</span>
							</div>
							{r.decision && (
								<p className="text-[11px] text-ink2 mt-1.5">{r.decision}</p>
							)}
							{r.verification && (
								<p className="text-[10px] text-ink3 mt-0.5 font-mono break-all">
									✓ {r.verification}
								</p>
							)}
							{r.metrics && (
								<p className="text-[10px] mt-1 font-mono text-accent">
									{r.metrics.metric}: {String(r.metrics.before)} →{" "}
									{String(r.metrics.after)}
								</p>
							)}
							{r.error && (
								<p className="text-[10px] text-bad mt-1 break-all">
									{r.error}
								</p>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
