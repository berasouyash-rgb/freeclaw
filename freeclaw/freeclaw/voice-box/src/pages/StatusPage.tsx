import {
	ArrowLeft,
	CheckCircle2,
} from "lucide-react";
import { useNavigate } from "react-router";
import FadeIn from "../components/FadeIn";
import { StaticFooter } from "../components/visual/PolicyVisuals";

const STATIC_SERVICES = [
	{ name: "Web Application & Client", status: "operational", uptime: 99.98, latency: "42ms" },
	{ name: "API Gateway & Router", status: "operational", uptime: 99.97, latency: "28ms" },
	{ name: "24/7 Autonomous AI Intelligence", status: "operational", uptime: 99.95, latency: "185ms" },
	{ name: "Real-time Live Events & SSE", status: "operational", uptime: 99.99, latency: "15ms" },
	{ name: "Encrypted File & Evidence Uploads", status: "operational", uptime: 99.96, latency: "65ms" },
	{ name: "Email & Notification Delivery", status: "operational", uptime: 99.94, latency: "110ms" },
];

const STATIC_INCIDENTS = [
	{
		date: "2026-01-15",
		title: "Scheduled Maintenance & DB Index Rebuild",
		status: "resolved",
		duration: "30 minutes",
		description:
			"Database optimization and cache warming. All operations completed seamlessly with zero user impact during the maintenance window.",
	},
	{
		date: "2026-09-20",
		title: "Elevated AI Gateway Latency",
		status: "resolved",
		duration: "15 minutes",
		description:
			"Increased response times on AI classification endpoints due to upstream cloud provider rate limiting. Resolved immediately via automatic circuit breaker fallback.",
	},
	{
		date: "2026-08-15",
		title: "Brief Real-time Connection Interruption",
		status: "resolved",
		duration: "5 minutes",
		description:
			"Temporary degradation of live board push notifications. Caused by connection pool exhaustion during a high-traffic vote surge. Auto-scaled and resolved.",
	},
];

export default function StatusPage() {
	const nav = useNavigate();
	const refreshedAt = "Just now";

	const goBack = () => {
		if (window.history.length > 1) nav(-1);
		else nav("/");
	};

	return (
		<div className="min-h-screen bg-bg vb-page-enter">
			{/* Hero */}
			<section className="relative overflow-hidden pt-20 pb-12 md:pt-28 md:pb-16 text-center">
				<div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent pointer-events-none" />
				<div className="relative max-w-3xl mx-auto px-6">
					<FadeIn>
						<button
							type="button"
							className="btn btn-ghost !px-3 mb-6"
							onClick={goBack}
							aria-label="Go back"
						>
							<ArrowLeft size={15} /> Back
						</button>
						<h1 className="text-4xl md:text-5xl font-display font-bold text-ink mb-4">
							System Status
						</h1>
						<div className="mx-auto max-w-2xl space-y-2 text-ink2 text-sm mb-4">
							<p className="font-medium text-ink">
								Static snapshot — not a live health check.
							</p>
							<p>
								This page shows illustrative service history and incidents from
								the status-page dataset; it does not fetch current production
								availability.
							</p>
						</div>
					</FadeIn>
				</div>
			</section>

			{/* Operational Banner */}
			<section className="max-w-4xl mx-auto px-6 mb-10">
				<FadeIn>
					<div className="card p-6 border-2 border-good/30 bg-good/[0.04] rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
						<div className="flex items-center gap-3.5">
							<span className="w-12 h-12 rounded-2xl bg-good/15 text-good grid place-items-center shrink-0">
								<CheckCircle2 size={26} />
							</span>
							<div>
								<div className="flex items-center gap-2">
									<h2 className="font-display font-bold text-lg text-ink">
										All Systems Fully Operational
									</h2>
									<span className="w-2.5 h-2.5 rounded-full bg-good animate-ping" />
								</div>
								<p className="text-xs text-ink3 mt-0.5">
									Zero active service interruptions across all regional gateways.
								</p>
							</div>
						</div>

						<div className="text-left sm:text-right self-start sm:self-auto">
							<div className="text-xs font-mono font-bold text-good">
								99.98% 90-Day Uptime
							</div>
							<div className="text-[10px] text-ink3 mt-0.5">
								Refreshed: {refreshedAt}
							</div>
						</div>
					</div>
				</FadeIn>
			</section>

			{/* Services Telemetry List */}
			<section className="max-w-4xl mx-auto px-6 mb-12">
				<FadeIn>
					<div className="card p-6 border border-border/80 bg-surface shadow-xs">
						<div className="flex items-center justify-between mb-6 pb-3 border-b border-border">
							<h3 className="font-display font-bold text-base text-ink">
								Core Infrastructure Components
							</h3>
							<span className="text-[11px] font-mono text-ink3">
								Region: Global Edge Nodes
							</span>
						</div>

						<div className="space-y-3">
							{STATIC_SERVICES.map((s) => (
								<div
									key={s.name}
									className="p-4 rounded-xl border border-border/60 bg-surface2/40 hover:bg-surface2/70 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
								>
									<div className="flex items-center gap-3">
										<span className="w-2.5 h-2.5 rounded-full bg-good shrink-0" />
										<span className="font-semibold text-xs sm:text-sm text-ink">
											{s.name}
										</span>
									</div>

									<div className="flex items-center gap-4 text-xs">
										<span className="text-ink3 font-mono">Latency: {s.latency}</span>
										<span className="font-mono font-semibold text-good">
											{s.uptime}%
										</span>
										<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-good/10 text-good border border-good/20">
											Operational
										</span>
									</div>
								</div>
							))}
						</div>
					</div>
				</FadeIn>
			</section>

			{/* 90-Day Historical Uptime Strip */}
			<section className="max-w-4xl mx-auto px-6 mb-12">
				<FadeIn>
					<div className="card p-6 border border-border/80 bg-surface">
						<div className="flex items-center justify-between mb-3 text-xs">
							<span className="font-semibold text-ink">90-Day Reliability Timeline</span>
							<span className="text-good font-mono font-semibold">99.98% Historical Average</span>
						</div>
						<div className="flex gap-1 h-8 items-center overflow-hidden" aria-hidden>
							{Array.from({ length: 60 }).map((_, i) => (
								<div
									key={i}
									className={`flex-1 h-6 rounded-xs transition-all ${
										i === 12 || i === 34 ? "bg-emerald-400" : "bg-emerald-500"
									} hover:scale-110 hover:opacity-80`}
									title={`Day ${60 - i}: 100% operational`}
								/>
							))}
						</div>
						<div className="flex justify-between text-[10px] text-ink3 font-mono mt-2">
							<span>60 days ago</span>
							<span>Today</span>
						</div>
					</div>
				</FadeIn>
			</section>

			{/* Past Incidents */}
			<section className="max-w-4xl mx-auto px-6 mb-16">
				<FadeIn className="mb-6">
					<h3 className="font-display font-bold text-lg text-ink">
						Recent Incident Logs & Root Cause Analysis
					</h3>
					<p className="text-xs text-ink3 mt-0.5">
						Full transparent reporting on past service interruptions and mitigations.
					</p>
				</FadeIn>

				<div className="space-y-4">
					{STATIC_INCIDENTS.map((inc) => (
						<FadeIn key={inc.title}>
							<div className="card p-5 border border-border/80 bg-surface">
								<div className="flex flex-wrap items-center justify-between gap-2 mb-2">
									<div className="flex items-center gap-2">
										<CheckCircle2 size={16} className="text-good shrink-0" />
										<h4 className="font-display font-semibold text-sm text-ink">
											{inc.title}
										</h4>
									</div>
									<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-good/10 text-good border border-good/20">
										Resolved ({inc.duration})
									</span>
								</div>
								<p className="text-xs text-ink2 leading-relaxed mb-3">
									{inc.description}
								</p>
								<div className="text-[10px] font-mono text-ink3">
									Date: {inc.date} • Root Cause Mitigated
								</div>
							</div>
						</FadeIn>
					))}
				</div>

				<StaticFooter />
			</section>
		</div>
	);
}
