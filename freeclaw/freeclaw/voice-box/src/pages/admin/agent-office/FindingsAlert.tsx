import {
	AlertOctagon,
	AlertTriangle,
	ChevronDown,
	ChevronUp,
	Radar,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";

/* ═══════════════════════════════════════════════════════════════
   FINDINGS ALERT — Live monitor popups
   Polls the REAL patrol findings endpoint. When a monitor agent
   (report-handler, security-monitor, self-healing-ops, ...) records
   a NEW finding, an immediate popup fires with full details and the
   real snapshot of what was detected — straight from the database.
   ═══════════════════════════════════════════════════════════════ */

interface Finding {
	severity: string;
	domain: string;
	title: string;
	evidence: string;
	recommendation: string;
	agent: string;
	at: string;
	snapshot?: Array<Record<string, unknown>> | null;
}

interface FindingsScan {
	scanned_at: string | null;
	summary: string;
	findings: Finding[];
}

const SEVERITY_STYLES: Record<
	string,
	{ bg: string; text: string; border: string; glow: string }
> = {
	critical: {
		bg: "bg-red-500/15",
		text: "text-red-400",
		border: "border-red-500/40",
		glow: "shadow-red-500/20",
	},
	high: {
		bg: "bg-amber-500/15",
		text: "text-amber-400",
		border: "border-amber-500/40",
		glow: "shadow-amber-500/20",
	},
	medium: {
		bg: "bg-sky-500/15",
		text: "text-sky-400",
		border: "border-sky-500/40",
		glow: "shadow-sky-500/20",
	},
	low: {
		bg: "bg-green-500/15",
		text: "text-green-400",
		border: "border-green-500/40",
		glow: "shadow-green-500/20",
	},
};

const AGENT_ICONS: Record<string, string> = {
	"report-handler": "🚨",
	"security-monitor": "🛡️",
	"self-healing-ops": "🩹",
	"content-moderator": "📝",
	"anomaly-detector": "🔎",
};

// Dedupe on severity+domain+title (NOT the `at` timestamp) so re-running the
// patrol or re-polling the persisted scan never re-popups an already-seen
// finding — only genuinely new issues fire an alert.
function findingKey(f: Finding): string {
	return `${f.severity}|${f.domain}|${f.title}`;
}

function SnapshotTable({
	snapshot,
}: {
	snapshot?: Array<Record<string, unknown>> | null;
}) {
	const [open, setOpen] = useState(true);
	if (!snapshot || snapshot.length === 0) return null;
	const cols = Object.keys(snapshot[0] || {});
	return (
		<div className="mt-2 rounded-lg border border-border bg-surface overflow-hidden">
			<button
				onClick={() => setOpen(!open)}
				className="w-full flex items-center justify-between px-2.5 py-1.5 text-[9px] font-mono text-ink3 uppercase tracking-wider hover:bg-surface2 transition-colors"
			>
				<span>📸 Snapshot — what the agent saw</span>
				{open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
			</button>
			{open && (
				<div className="max-h-32 overflow-y-auto">
					<table className="w-full text-[9px] font-mono">
						<thead>
							<tr className="text-ink3 text-left">
								{cols.map((c) => (
									<th
										key={c}
										className="px-2.5 py-1 font-semibold border-b border-border"
									>
										{c}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{snapshot.map((row, i) => (
								<tr key={i} className="text-ink2">
									{cols.map((c) => (
										<td
											key={c}
											className="px-2.5 py-1 border-b border-border/40 truncate max-w-[140px]"
										>
											{String(row[c] ?? "—")}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

export default function FindingsAlert({ pollMs = 20000 }: { pollMs?: number }) {
	const [active, setActive] = useState<Finding[]>([]);
	const seenRef = useRef<Set<string>>(new Set());
	const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
	const dismissTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

	const dismiss = (f: Finding) =>
		setActive((prev) => prev.filter((x) => findingKey(x) !== findingKey(f)));

	// Poll the real findings endpoint; fire popups only for NEW findings
	useEffect(() => {
		const check = async () => {
			try {
				const scan = await api.get<FindingsScan>(
					"/api/agent-team?action=findings",
				);
				const findings = scan?.findings || [];
				const fresh: Finding[] = [];
				for (const f of findings) {
					const k = findingKey(f);
					if (!seenRef.current.has(k)) {
						seenRef.current.add(k);
						// Only surface findings that need attention (or that are genuinely new)
						if (
							f.severity === "critical" ||
							f.severity === "high" ||
							f.severity === "medium"
						)
							fresh.push(f);
					}
				}
				if (fresh.length > 0) {
					// Stack new findings; cap the stack at 4
					setActive((prev) => [...fresh, ...prev].slice(0, 4));
					// Auto-dismiss each after 14s — track timers so unmount clears them
					fresh.forEach((f) => {
						const t = setTimeout(() => {
							dismissTimers.current.delete(t);
							dismiss(f);
						}, 14000);
						dismissTimers.current.add(t);
					});
				}
			} catch {
				/* offline / no admin session — stay silent */
			}
		};
		check();
		pollTimer.current = setInterval(check, pollMs);
		const timers = dismissTimers.current;
		return () => {
			if (pollTimer.current) clearInterval(pollTimer.current);
			timers.forEach((t) => clearTimeout(t));
			timers.clear();
		};
	}, [pollMs]);

	if (active.length === 0) return null;

	return (
		<div className="fixed bottom-5 right-5 z-[70] space-y-2.5 w-[min(380px,calc(100vw-40px))]">
			{active.map((f) => {
				const s: { bg: string; text: string; border: string; glow: string } =
					SEVERITY_STYLES[f.severity] ?? {
						bg: "bg-sky-500/15",
						text: "text-sky-400",
						border: "border-sky-500/40",
						glow: "shadow-sky-500/20",
					};
				const isCritical = f.severity === "critical";
				return (
					<div
						key={findingKey(f)}
						className={`relative rounded-xl border bg-surface shadow-2xl overflow-hidden vb-pop ${s.border} ${s.glow} shadow-xl`}
						role="alert"
						aria-live="assertive"
					>
						{/* Severity stripe */}
						<div
							className={`h-1 w-full ${f.severity === "critical" ? "bg-red-500" : f.severity === "high" ? "bg-amber-500" : "bg-sky-500"}`}
						/>
						<div className="p-3.5 space-y-2">
							{/* Header */}
							<div className="flex items-start gap-2.5">
								<div
									className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${s.bg}`}
								>
									{isCritical ? (
										<AlertOctagon size={16} className={s.text} />
									) : (
										<AlertTriangle size={16} className={s.text} />
									)}
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-1.5">
										<span
											className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider ${s.bg} ${s.text}`}
										>
											{f.severity}
										</span>
										<span className="px-1.5 py-0.5 rounded bg-surface2 text-[9px] font-mono uppercase tracking-wider text-ink2">
											{f.domain}
										</span>
									</div>
									<p className="text-[12.5px] font-bold text-ink1 mt-1 leading-snug">
										{f.title}
									</p>
								</div>
								<button
									onClick={() => dismiss(f)}
									className="p-1 rounded-md hover:bg-surface2 transition-colors flex-shrink-0"
									aria-label="Dismiss alert"
								>
									<X size={13} className="text-ink3" />
								</button>
							</div>

							{/* Evidence */}
							<p className="text-[11px] text-ink2 leading-relaxed">
								{f.evidence}
							</p>

							{/* Real snapshot table */}
							<SnapshotTable snapshot={f.snapshot} />

							{/* Recommendation + agent */}
							<div className="flex items-start gap-1.5 pt-0.5">
								<Radar size={11} className="text-ink3 mt-0.5 flex-shrink-0" />
								<p className="text-[10px] text-ink3 leading-relaxed">
									<span className="text-ink2">Recommended:</span>{" "}
									{f.recommendation}
								</p>
							</div>
							<div className="flex items-center justify-between pt-1 border-t border-border/40">
								<span className="text-[9px] font-mono text-ink3">
									{AGENT_ICONS[f.agent] || "🤖"} {f.agent} ·{" "}
									{f.at ? new Date(f.at).toLocaleTimeString() : ""}
								</span>
								{f.snapshot && (
									<span className="text-[9px] font-mono text-ink3">
										snapshot · {f.snapshot.length} row
										{f.snapshot.length === 1 ? "" : "s"}
									</span>
								)}
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}
