import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { autonomousWorkforce } from "../../lib/autonomousHarnesses";

export default function AutonomousHarnessesBanner() {
	const [expanded, setExpanded] = useState(false);
	const harnesses = autonomousWorkforce.getAllHarnesses();

	return (
		<div className="mb-4 rounded-xl border border-border/70 bg-surface/60 backdrop-blur-md overflow-hidden transition-all shadow-sm">
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
					<div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-good/15 text-good border border-good/30">
						<span className="relative flex h-1.5 w-1.5">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-good opacity-75"></span>
							<span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-good"></span>
						</span>
						24/7 Active
					</div>
					<span className="text-xs font-semibold text-ink flex items-center gap-1.5">
						<Sparkles size={13} className="text-amber-400" />
						Five Smart Autonomous Harnesses
					</span>
					<span className="text-[11px] text-ink3 hidden sm:inline">
						5 AI employees managing safety, triage, privacy, 5,000-user load & wellbeing 24/7
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
							className="rounded-lg p-2.5 bg-surface/90 border border-border/80 shadow-xs flex flex-col justify-between"
						>
							<div className="flex items-start justify-between gap-1.5 mb-1.5">
								<div className="flex items-center gap-2">
									<span className="text-lg">{h.avatar}</span>
									<div>
										<h4 className="text-xs font-bold text-ink leading-tight">
											{h.name}
										</h4>
										<p className="text-[10px] text-ink3">{h.roleTitle}</p>
									</div>
								</div>
								<span className="text-[9px] font-semibold text-good px-1.5 py-0.5 rounded bg-good/10">
									{h.uptimePercent}%
								</span>
							</div>
							<p className="text-[11px] text-ink2 mb-2 line-clamp-2 leading-relaxed">
								{h.lastActionSummary}
							</p>
							<div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-border/50">
								<span className="text-ink3 font-medium">{h.kpiLabel}:</span>
								<span className="font-bold text-ink font-mono">{h.kpiValue}</span>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
