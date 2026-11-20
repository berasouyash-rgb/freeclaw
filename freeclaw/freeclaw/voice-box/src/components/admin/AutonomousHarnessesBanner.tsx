import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { autonomousWorkforce } from "../../lib/autonomousHarnesses";

/**
 * Honest status for the moderation harnesses.
 *
 * The previous version advertised "24/7 Active" with animated dots, invented
 * 100% uptime, random latency and made-up "last action" summaries. None of it
 * came from a scheduler or a database. This panel now describes what the
 * harnesses actually are: on-demand moderation routines with no continuous
 * runtime. Real execution history lives in the AI Systems page.
 */
export default function AutonomousHarnessesBanner() {
	const [expanded, setExpanded] = useState(false);
	const harnesses = autonomousWorkforce.getAllHarnesses();

	return (
		<div className="mb-4 rounded-xl border border-border/70 bg-surface/60 overflow-hidden shadow-sm">
			<div
				className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-surface2/40 transition-colors"
				onClick={() => setExpanded(!expanded)}
				role="button"
				tabIndex={0}
				aria-expanded={expanded}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setExpanded(!expanded);
					}
				}}
			>
				<div className="flex items-center gap-2.5 flex-wrap">
					<span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase text-amber-300">
						On demand
					</span>
					<span className="text-xs font-semibold text-ink flex items-center gap-1.5">
						<Sparkles size={13} className="text-violet-400" />
						Moderation harnesses
					</span>
					<span className="text-[11px] text-ink3 hidden sm:inline">
						Five routines available on demand. No continuous scheduler is configured.
					</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-ink3 font-medium">
						{expanded ? "Hide" : "Details"}
					</span>
					{expanded ? (
						<ChevronUp size={14} className="text-ink3" />
					) : (
						<ChevronDown size={14} className="text-ink3" />
					)}
				</div>
			</div>

			{expanded && (
				<div className="p-3 border-t border-border/60 bg-surface2/20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
					{harnesses.map((h) => (
						<div
							key={h.id}
							className="rounded-lg p-2.5 bg-surface/90 border border-border/80 flex flex-col gap-1"
						>
							<div className="flex items-center gap-2">
								<span className="text-lg" aria-hidden>
									{h.avatar}
								</span>
								<div>
									<h4 className="text-xs font-bold text-ink leading-tight">{h.name}</h4>
									<p className="text-[10px] text-ink3">{h.roleTitle}</p>
								</div>
							</div>
							<p className="text-[10px] text-ink3">
								Runs only when invoked. No measured uptime or live activity yet.
							</p>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
