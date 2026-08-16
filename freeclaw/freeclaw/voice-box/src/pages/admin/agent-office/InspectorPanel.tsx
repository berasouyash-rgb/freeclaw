import {
	AlertTriangle,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Copy,
	Download,
	FileText,
	History,
	Power,
	PowerOff,
	ShieldCheck,
	TrendingUp,
	X,
	Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { errorText, safeStringify } from "../../../lib/utils";
import { DIV_COLORS, TIER_COLORS } from "./constants";
import type { Agent, AgentActivation, AgentState, WorkTask } from "./types";

/* ── Copy button ─────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			/* */
		}
	};
	return (
		<button
			onClick={copy}
			className="p-1.5 rounded-md hover:bg-surface2 transition-colors"
			title="Copy"
		>
			{copied ? (
				<Check size={12} className="text-good" />
			) : (
				<Copy size={12} className="text-ink3" />
			)}
		</button>
	);
}

/* ── Download button ─────────────────────────────────────────── */
function DownloadBtn({
	data,
	filename,
}: {
	data: Record<string, unknown> | string;
	filename: string;
}) {
	const download = () => {
		const json = typeof data === "string" ? data : safeStringify(data, 2);
		const blob = new Blob([json], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = filename;
		a.click();
		URL.revokeObjectURL(a.href);
	};
	return (
		<button
			onClick={download}
			className="p-1.5 rounded-md hover:bg-surface2 transition-colors"
			title="Download JSON"
		>
			<Download size={12} className="text-ink3" />
		</button>
	);
}

/* ── Task status chip (real runtime status) ────────────────────
   DONE ≠ VERIFIED: a completed task is only labeled VERIFIED when
   independent database verification actually passed. completed with
   verification 'none' stays COMPLETED; 'failed' shows VERIFICATION
   FAILED. This matches the runtime truth, never the model output. */
function WorkStatusChip({
	status,
	verification,
}: {
	status: string;
	verification?: string;
}) {
	if (status === "completed") {
		const v = verification || "none";
		const cls =
			v === "passed"
				? "bg-emerald-500/15 text-emerald-400"
				: v === "failed"
					? "bg-red-500/15 text-red-400"
					: "bg-sky-500/15 text-sky-400";
		const label =
			v === "passed"
				? "VERIFIED"
				: v === "failed"
					? "VERIFICATION FAILED"
					: "COMPLETED";
		return (
			<span
				className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${cls}`}
			>
				{label}
			</span>
		);
	}
	const map: Record<string, string> = {
		queued: "bg-sky-500/15 text-sky-400",
		claimed: "bg-cyan-500/15 text-cyan-400",
		working: "bg-emerald-500/15 text-emerald-400",
		verifying: "bg-amber-500/15 text-amber-400",
		failed: "bg-red-500/15 text-red-400",
		blocked: "bg-orange-500/15 text-orange-400",
		cancelled: "bg-ink3/15 text-ink3",
	};
	return (
		<span
			className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${map[status] || map.queued}`}
		>
			{status}
		</span>
	);
}

/* ── Real execution timeline (Phase 23 of the spec) ──────────── */
function WorkTimeline({ timeline }: { timeline: WorkTask["timeline"] }) {
	if (!timeline || timeline.length === 0) return null;
	return (
		<div className="space-y-1.5">
			<p className="text-[9px] text-ink3 uppercase tracking-wider flex items-center gap-1">
				<History size={10} /> Execution Timeline
			</p>
			{timeline.map((tl, i) => {
				const stepColor =
					tl.step === "failed" || tl.step === "verification_failed"
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
							<p className="text-[9px] text-ink2 leading-snug">{tl.detail}</p>
						</div>
					</div>
				);
			})}
		</div>
	);
}

/* ── Real verified outcomes with evidence (Phase 14/16) ──────── */
function WorkOutcomes({ task }: { task: WorkTask }) {
	const [open, setOpen] = useState(false);
	if (!task.outcomes || task.outcomes.length === 0) {
		if (task.verification_status === "failed") {
			return (
				<p className="text-[10px] text-red-400 font-mono flex items-center gap-1">
					<AlertTriangle size={10} /> Verification failed — no verified change
					recorded.
				</p>
			);
		}
		return (
			<p className="text-[10px] text-ink3">
				No verified outcome — this execution changed nothing measurable.
			</p>
		);
	}
	return (
		<div className="space-y-1.5">
			<button
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1 text-[9px] text-ink3 uppercase tracking-wider hover:text-ink1 transition-colors"
			>
				{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
				<ShieldCheck size={10} /> Verified Outcomes (
				{task.outcomes.filter((o) => o.verified).length}/{task.outcomes.length})
			</button>
			{open && (
				<div className="space-y-1">
					{task.outcomes.map((o, i) => (
						<div
							key={i}
							className={`rounded-lg p-2 border ${o.verified ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/25"}`}
						>
							<p
								className={`text-[10px] font-mono font-bold ${o.verified ? "text-emerald-400" : "text-red-400"}`}
							>
								{o.verified ? "✓" : "✗"} {o.type}
								{o.target_id ? ` → ${o.target_id}` : ""}
								{o.count ? ` ×${o.count}` : ""}
							</p>
							<p className="text-[9px] text-ink2 font-mono mt-0.5 leading-snug">
								{o.evidence}
							</p>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/* ── Real impact (Phase 15 — never invented) ─────────────────── */
function WorkImpact({ impact }: { impact: WorkTask["impact"] }) {
	if (!impact) return null;
	if (!impact.measurable) {
		return (
			<p className="text-[9px] text-ink3 font-mono flex items-center gap-1">
				<TrendingUp size={10} /> Impact: {impact.note || "NOT MEASURABLE"}
			</p>
		);
	}
	return (
		<p className="text-[10px] text-blue-400 font-mono flex items-center gap-1 leading-snug">
			<TrendingUp size={10} /> Impact: {impact.summary}
		</p>
	);
}

/* ── One real work item (a task the employee actually ran) ───── */
function WorkCard({ task }: { task: WorkTask }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="rounded-xl bg-surface2 border border-border overflow-hidden">
			<button
				onClick={() => setOpen(!open)}
				className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-surface3/50 transition-colors"
			>
				<div className="min-w-0 flex-1">
					<p className="text-[11px] text-ink1 font-medium leading-snug">
						{task.title}
					</p>
					<p className="text-[9px] font-mono text-ink3 mt-0.5">
						{task.id.slice(0, 8)} · src:{task.source} ·{" "}
						{new Date(task.created_at).toLocaleString()}
					</p>
				</div>
				<div className="flex flex-col items-end gap-1 flex-shrink-0">
					<WorkStatusChip
						status={task.status}
						verification={task.verification_status}
					/>
					{task.verification_status &&
						task.verification_status !== "none" &&
						task.status !== "completed" && (
							<span
								className={`text-[8px] font-mono ${task.verification_status === "passed" ? "text-emerald-400" : task.verification_status === "failed" ? "text-red-400" : "text-amber-400"}`}
							>
								verify:{task.verification_status}
							</span>
						)}
				</div>
			</button>
			{open && (
				<div className="px-3 pb-3 space-y-2.5 border-t border-border/40 pt-2.5">
					<WorkTimeline timeline={task.timeline} />
					<WorkOutcomes task={task} />
					<WorkImpact impact={task.impact} />
					{task.error && (
						<p className="text-[10px] text-red-400 font-mono leading-snug">
							<AlertTriangle size={10} className="inline mr-1" />
							{errorText(task.error)}
						</p>
					)}
					<div className="flex items-center gap-1 pt-1">
						<span className="text-[8px] text-ink3 font-mono uppercase tracking-wider">
							Trace
						</span>
						<DownloadBtn
							data={task as unknown as Record<string, unknown>}
							filename={`task-${task.id.slice(0, 8)}.json`}
						/>
					</div>
				</div>
			)}
		</div>
	);
}

/* ── Work Record — this employee's REAL work from the runtime ── */
function WorkRecord({ tasks }: { tasks: WorkTask[] }) {
	const active = tasks.filter((t) =>
		["working", "verifying", "claimed", "queued"].includes(t.status),
	);
	const done = tasks.filter((t) =>
		["completed", "failed", "cancelled", "blocked"].includes(t.status),
	);
	return (
		<div className="space-y-2.5">
			<p className="text-[9px] font-bold text-ink3 uppercase tracking-wider flex items-center gap-1">
				<FileText size={10} /> Work Record — real tasks from the runtime
			</p>
			{active.length > 0 && (
				<div className="space-y-1.5">
					<p className="text-[8px] text-emerald-400 font-mono uppercase tracking-wider">
						● Currently working
					</p>
					{active.map((t) => (
						<WorkCard key={t.id} task={t} />
					))}
				</div>
			)}
			{done.length > 0 && (
				<div className="space-y-1.5">
					<p className="text-[8px] text-ink3 font-mono uppercase tracking-wider">
						Recent completed / failed
					</p>
					{done.slice(0, 6).map((t) => (
						<WorkCard key={t.id} task={t} />
					))}
				</div>
			)}
			{tasks.length === 0 && (
				<p className="text-[10px] text-ink3 leading-relaxed">
					No work recorded yet. This employee has not claimed a task — run a
					patrol or spawn work to give them real tasks.
				</p>
			)}
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════
   INSPECTOR PANEL — Real agent state from API
   Right sidebar showing agent detail, real task, real result
   ═══════════════════════════════════════════════════════════════ */
export default function InspectorPanel({
	agent,
	agentState,
	activation,
	workTasks,
	onClose,
	onSpawn,
	onToggleActivation,
	onToggleAutonomous,
}: {
	agent: Agent | null;
	agentState: AgentState | null;
	activation?: AgentActivation | null;
	workTasks?: WorkTask[] | null;
	onClose: () => void;
	onSpawn: (agentId: string) => void;
	onToggleActivation?: (agentId: string, active: boolean) => void;
	onToggleAutonomous?: (agentId: string, autonomous: boolean) => void;
}) {
	// All hooks must be called before any early returns
	const colors = agent
		? (DIV_COLORS[agent.division] ??
			DIV_COLORS.specialist ?? {
				bg: "bg-surface2",
				text: "text-ink2",
				border: "border-border",
			})
		: { bg: "bg-surface2", text: "text-ink2", border: "border-border" };
	const state = agentState;

	const isWorking = state?.state === "working";
	const isVerifying = state?.state === "verifying";
	const isCompleted = state?.state === "completed";
	const isError = state?.state === "error";
	const isIdle = !state || state.state === "idle";
	const isActive = activation?.active !== false;
	const isAutonomous = activation?.autonomous || false;

	// Format result for display
	const resultText = useMemo(() => {
		if (!state?.result) return "";
		return typeof state.result === "string"
			? state.result
			: safeStringify(state.result, 2);
	}, [state?.result]);

	if (!agent) return null;

	return (
		<div className="fixed inset-y-0 right-0 w-full max-w-sm z-50 flex">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/40 backdrop-blur-sm md:hidden"
				onClick={onClose}
			/>

			{/* Panel */}
			<div className="relative ml-auto w-full max-w-sm bg-surface border-l border-border shadow-2xl flex flex-col panel-slide">
				{/* Header */}
				<div
					className={`px-5 py-4 border-b ${colors.border} ${colors.bg} flex items-center gap-3`}
				>
					<span className="text-3xl">{agent.icon}</span>
					<div className="flex-1 min-w-0">
						<p className="text-sm font-bold text-ink1 truncate">{agent.name}</p>
						<p className="text-[11px] text-ink3 truncate">{agent.role}</p>
					</div>
					<div className="flex items-center gap-1">
						{resultText && (
							<>
								<CopyBtn text={resultText} />
								<DownloadBtn
									data={resultText}
									filename={`${agent.name.toLowerCase().replace(/\s+/g, "-")}-result.json`}
								/>
							</>
						)}
						<button
							onClick={onClose}
							className="p-2 rounded-lg hover:bg-surface2 transition-colors"
						>
							<X size={16} className="text-ink3" />
						</button>
					</div>
				</div>

				{/* Scrollable content */}
				<div className="flex-1 overflow-y-auto p-5 space-y-5">
					{/* Badges row */}
					<div className="flex items-center gap-1.5 flex-wrap">
						<span
							className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${TIER_COLORS[agent.tier] ?? "text-ink3 bg-surface2"}`}
						>
							{agent.tier}
						</span>
						<span
							className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}
						>
							{agent.division}
						</span>
						{/* Active/Offline badge */}
						<span
							className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full transition-colors duration-300 ${
								isActive
									? "bg-emerald-500/15 text-emerald-400"
									: "bg-ink3/15 text-ink3"
							}`}
						>
							{isActive ? "● Online" : "○ Offline"}
						</span>
						{/* Autonomous badge */}
						{isAutonomous && (
							<span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400">
								⚡ Autonomous
							</span>
						)}
						{/* Real state badge */}
						<span
							className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full transition-colors duration-300 ${
								isWorking
									? "bg-emerald-500/15 text-emerald-400"
									: isVerifying
										? "bg-amber-500/15 text-amber-400"
										: isCompleted
											? "bg-sky-500/15 text-sky-400"
											: isError
												? "bg-red-500/15 text-red-400"
												: "bg-surface2 text-ink3"
							}`}
						>
							{isWorking
								? "⚡ Working"
								: isVerifying
									? "🔍 Verifying"
									: isCompleted
										? "✓ Done"
										: isError
											? "✕ Error"
											: "◦ Idle"}
						</span>
					</div>

					{/* Description */}
					<p className="text-[11px] text-ink2 leading-relaxed">
						{agent.description}
					</p>

					{/* Real-time state panel */}
					{state && !isIdle && (
						<div className="rounded-xl bg-surface2 border border-border p-4 space-y-3 chat-msg-anim">
							<p className="text-[9px] font-bold text-ink3 uppercase tracking-wider">
								Real-time Status
							</p>

							{/* Current task */}
							{state.task && (
								<div className="space-y-1.5">
									<p className="text-[9px] text-ink3 uppercase tracking-wider">
										Current Task
									</p>
									<div className="bg-surface rounded-lg p-2.5 border border-border">
										<p className="text-[11px] text-ink1 font-mono leading-relaxed">
											{state.task}
										</p>
									</div>
								</div>
							)}

							{/* Timing */}
							<div className="grid grid-cols-2 gap-2">
								{state.started_at && (
									<div className="flex items-center gap-1.5">
										<Clock size={11} className="text-ink3" />
										<div>
											<p className="text-[8px] text-ink3 uppercase">Started</p>
											<p className="text-[10px] text-ink1 font-mono">
												{new Date(state.started_at).toLocaleTimeString()}
											</p>
										</div>
									</div>
								)}
								{state.completed_at && (
									<div className="flex items-center gap-1.5">
										<CheckCircle2 size={11} className="text-ink3" />
										<div>
											<p className="text-[8px] text-ink3 uppercase">
												Completed
											</p>
											<p className="text-[10px] text-ink1 font-mono">
												{new Date(state.completed_at).toLocaleTimeString()}
											</p>
										</div>
									</div>
								)}
							</div>

							{/* Progress bar */}
							{isWorking && (
								<div className="space-y-1">
									<div className="flex justify-between text-[9px] text-ink3">
										<span>Progress</span>
										<span className="font-mono">{state.progress}%</span>
									</div>
									<div className="w-full h-1.5 rounded-full bg-surface overflow-hidden">
										<div
											className="h-full rounded-full bg-emerald-400 transition-all duration-700 ease-out"
											style={{ width: `${state.progress}%` }}
										/>
									</div>
								</div>
							)}

							{/* Result preview */}
							{isCompleted && state.result && (
								<div className="space-y-1.5">
									<div className="flex items-center justify-between">
										<p className="text-[9px] text-ink3 uppercase tracking-wider">
											Result
										</p>
										<div className="flex items-center gap-0.5">
											<CopyBtn text={resultText} />
											<DownloadBtn
												data={state.result}
												filename={`${agent.name.toLowerCase().replace(/\s+/g, "-")}-result.json`}
											/>
										</div>
									</div>
									<div className="bg-surface rounded-lg p-2.5 border border-border max-h-40 overflow-y-auto">
										<pre className="text-[10px] text-ink1 font-mono whitespace-pre-wrap break-all leading-relaxed">
											{resultText.slice(0, 500)}
											{resultText.length > 500 && "\n… (truncated)"}
										</pre>
									</div>
								</div>
							)}

							{/* Error detail */}
							{isError && state.result && (
								<div className="space-y-1.5">
									<p className="text-[9px] text-red-400 uppercase tracking-wider flex items-center gap-1">
										<AlertTriangle size={10} /> Error
									</p>
									<div className="bg-red-500/5 rounded-lg p-2.5 border border-red-500/20">
										<p className="text-[10px] text-red-400 font-mono leading-relaxed">
											{String(state.result)}
										</p>
									</div>
								</div>
							)}
						</div>
					)}

					{/* ── REAL WORK RECORD — this employee's actual work ── */}
					<div className="pt-1">
						<WorkRecord tasks={workTasks || []} />
					</div>

					{/* Capabilities */}
					<div>
						<p className="text-[9px] font-bold text-ink3 uppercase tracking-wider mb-2">
							Capabilities
						</p>
						<div className="flex flex-wrap gap-1">
							{agent.capabilities.map((c) => (
								<span
									key={c}
									className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-surface2 border border-border text-ink2 hover:border-accent/50 transition-colors cursor-default"
								>
									{c}
								</span>
							))}
						</div>
					</div>

					{/* Permissions */}
					<div>
						<p className="text-[9px] font-bold text-ink3 uppercase tracking-wider mb-2">
							Permissions
						</p>
						<div className="flex flex-wrap gap-1">
							{agent.permissions.map((p) => (
								<span
									key={p}
									className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-accent-soft text-accent border border-accent/20"
								>
									{p}
								</span>
							))}
						</div>
					</div>

					{/* Activation Controls */}
					<div className="pt-2 border-t border-border space-y-2">
						<p className="text-[9px] font-bold text-ink3 uppercase tracking-wider">
							Controls
						</p>
						{/* Activate/Deactivate toggle */}
						<button
							onClick={() => onToggleActivation?.(agent.id, !isActive)}
							disabled={isWorking}
							className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ${
								!isActive
									? "bg-emerald-500 text-white hover:bg-emerald-600"
									: "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20"
							} ${isWorking ? "opacity-50 cursor-not-allowed" : ""}`}
						>
							{isActive ? (
								<>
									<PowerOff size={14} /> Deactivate Agent
								</>
							) : (
								<>
									<Power size={14} /> Activate Agent
								</>
							)}
						</button>
						{/* Autonomous mode toggle */}
						{isActive && (
							<button
								onClick={() => onToggleAutonomous?.(agent.id, !isAutonomous)}
								className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ${
									isAutonomous
										? "bg-violet-500 text-white hover:bg-violet-600"
										: "bg-violet-500/10 text-violet-400 border border-violet-500/30 hover:bg-violet-500/20"
								}`}
							>
								{isAutonomous ? (
									<>
										<Zap size={14} /> Disable Autonomous
									</>
								) : (
									<>
										<Zap size={14} /> Enable Autonomous
									</>
								)}
							</button>
						)}
					</div>

					{/* Spawn action */}
					<div className="pt-2 border-t border-border">
						<button
							onClick={() => onSpawn(agent.id)}
							disabled={isWorking}
							className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ${
								isWorking
									? "bg-surface2 text-ink3 cursor-not-allowed"
									: "bg-accent text-white hover:bg-accent/90 hover:shadow-lg hover:shadow-accent/10"
							}`}
						>
							{isWorking ? (
								<>
									<span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
									Running…
								</>
							) : (
								<>
									<Zap size={14} /> Spawn Agent
								</>
							)}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
