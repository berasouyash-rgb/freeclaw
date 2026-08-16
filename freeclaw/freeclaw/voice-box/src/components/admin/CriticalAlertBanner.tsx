// ═══════════════════════════════════════════════════════════════════
// CRITICAL DETECTION POPUP — the big danger banner (shared)
// ═══════════════════════════════════════════════════════════════════
// Fires the moment the runtime reports an OPEN critical (or high) alert.
//   • CRITICAL → full-screen danger takeover: dark backdrop + big centered
//     panel over the entire admin screen. Unmissable, requires a deliberate
//     Acknowledge (or Open console) to dismiss.
//   • HIGH     → the inline danger banner inside the page.
// It stays until the admin acknowledges it (persisted via acknowledge-alert).
//
// Used by: OpsCenter (AI Operations), Overview (Dashboard).
// ═══════════════════════════════════════════════════════════════════

import { AlertOctagon, ArrowUpRight } from "lucide-react";

export interface AlertRow {
	id: string;
	key: string | null;
	severity: string;
	title: string;
	body: string | null;
	agent: string | null;
	evidence: string | null;
	occurrences: number;
	acknowledged_at: string | null;
	acknowledged_by: string | null;
	resolved_at: string | null;
	resolved_by: string | null;
	created_at: string;
	last_at: string;
}

export function timeAgo(iso: string | null | undefined): string {
	if (!iso) return "never";
	const ms = Date.now() - new Date(iso).getTime();
	if (ms < 0) return "now";
	const s = Math.floor(ms / 1000);
	if (s < 45) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

export function agentName(id: string | null): string {
	if (!id) return "Unassigned";
	return id
		.split("-")
		.map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
		.join(" ");
}

export function CriticalAlertBanner({
	alerts,
	onAcknowledge,
	onOpenWorkforce,
}: {
	alerts: AlertRow[];
	onAcknowledge?: (id: string) => void;
	onOpenWorkforce?: () => void;
}) {
	const open = alerts.filter((a) => !a.resolved_at && !a.acknowledged_at);
	if (open.length === 0) return null;
	const critical = open.filter((a) => a.severity === "critical");
	const banner = critical.length > 0 ? critical : open;
	const a = banner[0]!;
	const isCritical = a.severity === "critical";
	const more = banner.length - 1;

	const panel = isCritical
		? "border-red-500/60 bg-gradient-to-r from-red-950/90 via-red-900/50 to-ink/95 shadow-[0_0_50px_rgba(239,68,68,0.3)]"
		: "border-amber-500/50 bg-gradient-to-r from-amber-950/80 via-amber-900/40 to-ink/95 shadow-[0_0_40px_rgba(245,158,11,0.25)]";
	const iconColor = isCritical ? "text-red-400" : "text-amber-400";

	const content = (
		<div
			className={`relative overflow-hidden rounded-xl border-2 p-4 sm:p-5 ${panel}`}
			role={isCritical ? "alertdialog" : "alert"}
			aria-modal={isCritical ? "true" : undefined}
			aria-label={isCritical ? "Critical alert" : undefined}
		>
			<div className="flex items-start gap-3.5">
				<span
					className={`grid place-items-center w-11 h-11 rounded-xl bg-red-500/15 shrink-0 animate-pulse ${iconColor}`}
				>
					<AlertOctagon size={24} />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 flex-wrap">
						<span
							className={`text-[10px] font-bold tracking-[0.2em] ${iconColor}`}
						>
							{isCritical ? "⚠ CRITICAL DETECTED" : "⚠ HIGH PRIORITY"}
						</span>
						{a.occurrences > 1 && (
							<span className="text-[10px] text-red-300/80 font-mono">
								×{a.occurrences} occurrences
							</span>
						)}
					</div>
					<h2 className="mt-1 font-display font-bold text-lg leading-snug text-white">
						{a.title}
					</h2>
					{a.body && (
						<p className="mt-1 text-[13px] text-red-100/90 leading-snug">
							{a.body}
						</p>
					)}
					<div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-red-200/70">
						{a.agent && <span>Detected by {agentName(a.agent)}</span>}
						<span>{timeAgo(a.last_at)}</span>
						{a.evidence && (
							<span
								className="truncate max-w-[30rem]"
								title={a.evidence}
							>
								evidence: {a.evidence}
							</span>
						)}
						{more > 0 && (
							<span className="font-semibold text-red-300">
								+{more} more open alert{more === 1 ? "" : "s"}
							</span>
						)}
					</div>
				</div>
				<div className="flex flex-col gap-2 shrink-0">
					<button
						type="button"
						className="btn btn-primary !bg-red-500 !border-red-500 hover:!bg-red-400 !text-white !text-xs"
						onClick={() => onAcknowledge?.(a.id)}
					>
						Acknowledge
					</button>
					<button
						type="button"
						className="btn btn-ghost !text-red-200 !text-xs"
						onClick={onOpenWorkforce}
					>
						Open console <ArrowUpRight size={12} />
					</button>
				</div>
			</div>
		</div>
	);

	// CRITICAL → full-screen takeover. The alert owns the whole viewport until
	// the admin acknowledges it, so it can never be missed.
	if (isCritical) {
		return (
			<div
				className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm animate-in fade-in"
				data-testid="critical-overlay"
			>
				<div className="w-full max-w-2xl">{content}</div>
			</div>
		);
	}

	return content;
}
