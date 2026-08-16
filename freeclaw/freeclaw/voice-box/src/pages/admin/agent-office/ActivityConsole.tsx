import {
	ChevronDown,
	ChevronRight,
	Terminal,
	Wifi,
	WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import type { WorkflowResult } from "./types";

/* ═══════════════════════════════════════════════════════════════
   ACTIVITY CONSOLE — ONE real event feed from the runtime
   Merges two real sources, clearly labeled by origin:
     • WORKFORCE  → the persistent runtime activity log
       (task claimed / completed / verified / failed, patrol
       discoveries, recovery) — the same source the Command tab
       reads. This is the single source of truth.
     • AGENT TEAM → manual workflow spawns/results.
   No event is invented — everything shown came from the backend.
   ═══════════════════════════════════════════════════════════════ */

interface RuntimeEvent {
	agent_id: string;
	action: string;
	severity: string;
	details?: unknown;
	created_at: string;
}

interface ActivityEvent {
	id: string;
	ts: number; // epoch ms — used for true chronological sorting
	time: string; // display-only (locale-aware) rendering
	type:
		| "spawn"
		| "complete"
		| "error"
		| "info"
		| "warning"
		| "verify"
		| "claim";
	icon: string;
	agent: string;
	message: string;
	source: "workforce" | "agent-team";
}

const TYPE_STYLES: Record<
	string,
	{ label: string; color: string; dot: string }
> = {
	spawn: { label: "spawned", color: "text-amber-400", dot: "bg-amber-400" },
	complete: { label: "done", color: "text-emerald-400", dot: "bg-emerald-400" },
	error: { label: "error", color: "text-red-400", dot: "bg-red-400" },
	warning: { label: "warning", color: "text-amber-400", dot: "bg-amber-400" },
	verify: { label: "verified", color: "text-blue-400", dot: "bg-blue-400" },
	claim: { label: "claimed", color: "text-cyan-400", dot: "bg-cyan-400" },
	info: { label: "info", color: "text-sky-400", dot: "bg-sky-400" },
};
const DEFAULT_STYLE = {
	label: "info",
	color: "text-sky-400",
	dot: "bg-sky-400",
};

/* Map runtime action names → meaningful feed entries. Every runtime action
   is a REAL backend event — we only translate, never fabricate. */
const ACTION_META: Record<
	string,
	{ type: ActivityEvent["type"]; icon: string; label: string }
> = {
	task_claimed: { type: "claim", icon: "🤝", label: "Claimed task" },
	task_started: { type: "claim", icon: "▶️", label: "Started task" },
	task_completed: { type: "complete", icon: "✅", label: "Completed task" },
	task_failed: { type: "error", icon: "❌", label: "Task failed" },
	task_failed_retry: {
		type: "warning",
		icon: "🔁",
		label: "Task failed — retrying",
	},
	task_cancelled: { type: "info", icon: "⛔", label: "Task cancelled" },
	task_created: { type: "info", icon: "📥", label: "Task created" },
	task_reassigned: { type: "info", icon: "🔀", label: "Task reassigned" },
	task_blocked: {
		type: "warning",
		icon: "⛔",
		label: "Task blocked — approval",
	},
	verification_passed: {
		type: "verify",
		icon: "🛡️",
		label: "Verification passed",
	},
	verification_failed: {
		type: "error",
		icon: "⚠️",
		label: "Verification failed",
	},
	outcome_verified: { type: "verify", icon: "✓", label: "Outcome verified" },
	execution_recovered: {
		type: "info",
		icon: "🩹",
		label: "Execution recovered",
	},
	discovery: { type: "info", icon: "🔎", label: "Discovered work" },
	patrol_started: { type: "info", icon: "🚔", label: "Patrol started" },
	patrol_completed: { type: "info", icon: "🏁", label: "Patrol completed" },
};

function fmtTime(iso: string): { ts: number; time: string } {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return { ts: 0, time: "" };
	return { ts: d.getTime(), time: d.toLocaleTimeString() };
}

function runtimeEvent(e: RuntimeEvent, i: number): ActivityEvent {
	const meta = ACTION_META[e.action];
	const details = e.details as Record<string, unknown> | null | undefined;
	const title =
		details && (details.title || details.task_id)
			? ` — ${String(details.title || details.task_id).slice(0, 60)}`
			: "";
	const impact =
		details && details.impact
			? ` · impact: ${String(details.impact).slice(0, 60)}`
			: "";
	const { ts, time } = fmtTime(e.created_at);
	return {
		id: `rt-${e.created_at}-${i}`,
		ts,
		time,
		type: meta?.type ?? "info",
		icon: meta?.icon ?? "⚙️",
		agent: e.agent_id || "system",
		message: `${meta?.label ?? e.action.replace(/_/g, " ")}${title}${impact}`,
		source: "workforce",
	};
}

function workflowEvent(wf: WorkflowResult, i: number): ActivityEvent {
	const { ts, time } = fmtTime(wf.created_at);
	return {
		id: `wf-${wf.workflow_id}-${i}`,
		ts,
		time,
		type: "spawn",
		icon: "🚀",
		agent: wf.agents_used[0]?.name || "System",
		message: `Spawned ${wf.agents_used.length} agents for: ${wf.task?.slice(0, 50) || "task"}`,
		source: "agent-team",
	};
}

export default function ActivityConsole() {
	const [events, setEvents] = useState<ActivityEvent[]>([]);
	const [expanded, setExpanded] = useState(true);
	const [live, setLive] = useState(true);
	const [loading, setLoading] = useState(true);
	const scrollRef = useRef<HTMLDivElement>(null);

	// Load the real runtime activity log (source of truth) + workflow spawns
	const load = useCallback(async () => {
		try {
			const [rt, wf] = await Promise.all([
				api
					.post<{ ok: boolean; activity: RuntimeEvent[] }>("/api/workforce", {
						action: "activity",
					})
					.catch(() => ({ ok: false, activity: [] })),
				api
					.get<{ results?: WorkflowResult[] }>(
						"/api/agent-team?action=results&limit=10",
					)
					.catch(() => ({ results: [] })),
			]);
			const merged: ActivityEvent[] = [
				...(rt.activity || []).slice(0, 30).map((e, i) => runtimeEvent(e, i)),
				...(wf.results || []).slice(0, 10).map((w, i) => workflowEvent(w, i)),
			]
				.sort((a, b) => b.ts - a.ts)
				.slice(0, 40);
			setEvents((prev) => {
				if (merged.length === 0) return prev;
				const ids = new Set(prev.map((e) => e.id));
				const fresh = merged.filter((e) => !ids.has(e.id));
				const combined = [...fresh, ...prev];
				// True chronological order — never trust display strings
				return combined.sort((a, b) => b.ts - a.ts).slice(0, 40);
			});
			setLive(true);
		} catch {
			setLive(false);
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		load();
	}, [load]);
	useEffect(() => {
		const onVis = () => {
			if (!document.hidden) load();
		};
		document.addEventListener("visibilitychange", onVis);
		const iv = setInterval(() => {
			if (!document.hidden) load();
		}, 15000);
		return () => {
			clearInterval(iv);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, [load]);

	// Auto-scroll to top on new events
	useEffect(() => {
		if (scrollRef.current && expanded) scrollRef.current.scrollTop = 0;
	}, [events.length, expanded]);

	return (
		<div className="bg-surface2 rounded-xl border border-border overflow-hidden">
			{/* Header */}
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface2/80 transition-colors"
			>
				<Terminal size={14} className="text-ink3" />
				<span className="text-[11px] font-bold text-ink1 flex-1 text-left">
					Activity Console
				</span>
				<span
					className={`flex items-center gap-1 text-[9px] font-mono ${live ? "text-emerald-400" : "text-red-400"}`}
				>
					{live ? <Wifi size={10} /> : <WifiOff size={10} />}
					{live ? "live" : "offline"}
				</span>
				<span className="text-[9px] text-ink3 font-mono">
					{events.length} events
				</span>
				{expanded ? (
					<ChevronDown size={12} className="text-ink3" />
				) : (
					<ChevronRight size={12} className="text-ink3" />
				)}
			</button>

			{/* Event list */}
			{expanded && (
				<div
					ref={scrollRef}
					className="max-h-48 overflow-y-auto border-t border-border"
				>
					{!loading && events.length === 0 && (
						<div className="px-4 py-6 text-center">
							<p className="text-[10px] text-ink3">No activity yet.</p>
							<p className="text-[9px] text-ink3/60 mt-1">
								Run a patrol or spawn agents — real events will appear here.
							</p>
						</div>
					)}
					{events.map((evt) => {
						const style = TYPE_STYLES[evt.type] ?? DEFAULT_STYLE;
						const sourceBadge =
							evt.source === "workforce" ? (
								<span
									className="text-[8px] font-mono px-1 py-px rounded bg-surface3/60 text-ink3"
									title="Persistent runtime activity log"
								>
									runtime
								</span>
							) : (
								<span
									className="text-[8px] font-mono px-1 py-px rounded bg-violet-500/10 text-violet-400"
									title="Manual agent-team workflow"
								>
									spawn
								</span>
							);
						return (
							<div
								key={evt.id}
								className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface/50 transition-colors chat-msg-anim"
							>
								{/* Status dot */}
								<span
									className={`w-2 h-2 rounded-full ${style.dot} flex-shrink-0 mt-1.5`}
								/>

								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-[11px]">{evt.icon}</span>
										<span className="text-[10px] font-bold text-ink1 truncate">
											{evt.agent}
										</span>
										<span
											className={`text-[9px] font-mono font-bold flex-shrink-0 ${style.color}`}
										>
											{style.label}
										</span>
										{sourceBadge}
									</div>
									<p className="text-[9px] text-ink3 truncate font-mono mt-0.5">
										{evt.message}
									</p>
								</div>
								<span className="text-[8px] text-ink3/60 font-mono flex-shrink-0 mt-0.5">
									{evt.time}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
