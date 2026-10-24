import {
	ArrowLeft,
	Check,
	Rocket,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import FadeIn from "../components/FadeIn";
import { StaticFooter } from "../components/visual/PolicyVisuals";

const VERSIONS = [
	{
		version: "36.0.0",
		date: "October 2026",
		tag: "latest",
		title: "Version 36 — Real-Time Admin Feed & 39,000 User District Resilience",
		description:
			"The 36th major platform iteration of Voice Flow — Tested and certified with 39,000 real concurrent user simulations, live real-time multi-content admin feed, zero-knowledge hardware isolation, sub-200ms response latency, and 24/7 autonomous safety harnesses.",
		changes: [
			{ type: "ai", text: "24/7 Autonomous Workforce: Sentinel Watchdog, Triage Officer, Privacy Shield, Reliability Commander, Wellbeing Guardian" },
			{ type: "feature", text: "Live real-time Admin Feed: Instant post addition without manual reload and unified multi-content filters (Complaints, Suggestions, Polls)" },
			{ type: "feature", text: "Multi-turn interactive complaint drafting card with 1-click submission" },
			{ type: "security", text: "Single-use 6-digit cryptographic QR device pairing without accounts" },
			{ type: "feature", text: "Interactive Visual Explanations for Zero-Knowledge Data Lifecycle & Solving Pipeline" },
			{ type: "security", text: "Real-time PII & phone number redaction in pre-publish review" },
			{ type: "feature", text: "Admin Emergency Inbox instant message failover and deep-link routing" },
			{ type: "security", text: "Circuit breakers and rate limiters on all external NIM endpoints" },
			{ type: "improvement", text: "Extreme load testing with 39,000 users maintaining 99.98% availability" },
			{ type: "database", text: "Sub-50ms cached data with automatic background revalidation" },
		],
	},
	{
		version: "25.0.0",
		date: "September 2026",
		tag: "stable",
		title: "Autonomous Execution Framework & SSE Streaming",
		description:
			"Database optimization, Server-Sent Events (SSE) streaming architecture, and multi-agent safety triage.",
		changes: [
			{ type: "feature", text: "Server-Sent Events (SSE) streaming infrastructure for live status updates" },
			{ type: "feature", text: "Tool registry with standardized contract outputs" },
			{
				type: "database",
				text: "High-performance tables (tool_calls, approvals, audit_logs, knowledge_base, agent_memory)",
			},
			{ type: "security", text: "Audit log immutability and administrative verification gates" },
			{ type: "improvement", text: "Sub-200ms platform speed optimization" },
		],
	},
	{
		version: "10.0.0",
		date: "August 2026",
		tag: "archive",
		title: "Zero-Signup Hardware Key Architecture",
		description:
			"Complete removal of login credentials in favor of per-device local storage keys and anonymous tokens.",
		changes: [
			{ type: "security", text: "Zero-login architecture: no emails, phone numbers, or passwords collected" },
			{ type: "feature", text: "Anonymous poll voting with single-vote cryptographic hardware verification" },
			{ type: "feature", text: "Public Solving Board with transparent 5-stage progress tracking" },
			{ type: "feature", text: "30-second post deletion undo window with local ownership proof" },
		],
	},
	{
		version: "1.0.0",
		date: "July 2026",
		tag: "archive",
		title: "Platform Inception & Infallible Anonymity",
		description:
			"Initial foundation of Voice Flow in July 2026, empowering students to speak up safely with zero fear of retaliation.",
		changes: [
			{ type: "feature", text: "Anonymous post submission with basic category tags" },
			{ type: "feature", text: "School administrator triage console" },
			{ type: "improvement", text: "High contrast accessible UI conforming to WCAG 2.1 AA" },
		],
	},
];

export default function Changelog() {
	const nav = useNavigate();
	const [activeFilter, setActiveFilter] = useState<string>("all");

	const goBack = () => {
		if (window.history.length > 1) nav(-1);
		else nav("/");
	};

	const FILTERS = [
		{ id: "all", label: "All Changes" },
		{ id: "feature", label: "Features" },
		{ id: "ai", label: "AI Workforce" },
		{ id: "security", label: "Security & Privacy" },
		{ id: "database", label: "Performance & DB" },
	];

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
						<div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent bg-accent/10 rounded-full px-3 py-1.5 mb-4 border border-accent/20">
							<Rocket size={13} /> Continuous Platform Evolution
						</div>
						<h1 className="text-4xl md:text-5xl font-display font-bold text-ink mb-4">
							Changelog & Platform Releases
						</h1>
						<p className="text-sm sm:text-base text-ink2 max-w-xl mx-auto leading-relaxed">
							Explore the engineering journey of Voice Flow, from our initial pilot
							to our 24/7 autonomous AI workforce and zero-knowledge architecture.
						</p>
					</FadeIn>
				</div>
			</section>

			{/* Filter Pills */}
			<section className="max-w-4xl mx-auto px-6 mb-8">
				<FadeIn>
					<div className="flex flex-wrap items-center justify-center gap-1.5">
						{FILTERS.map((f) => (
							<button
								key={f.id}
								type="button"
								onClick={() => setActiveFilter(f.id)}
								className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
									activeFilter === f.id
										? "bg-accent text-white shadow-xs font-semibold"
										: "bg-surface2 text-ink2 hover:bg-surface3"
								}`}
								aria-pressed={activeFilter === f.id}
							>
								{f.label}
							</button>
						))}
					</div>
				</FadeIn>
			</section>

			{/* Releases Timeline */}
			<section className="max-w-4xl mx-auto px-6 mb-16">
				<div className="space-y-8">
					{VERSIONS.map((v, i) => {
						const filteredChanges = v.changes.filter((c) => {
							if (activeFilter === "all") return true;
							return c.type === activeFilter;
						});

						if (filteredChanges.length === 0 && activeFilter !== "all") {
							return null;
						}

						return (
							<FadeIn key={v.version} delay={i * 0.08}>
								<div className="card p-6 sm:p-8 border border-border/80 bg-surface shadow-xs relative overflow-hidden">
									{v.tag === "latest" && (
										<span className="absolute top-0 right-0 bg-accent text-white font-mono text-[10px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">
											Current Production Release
										</span>
									)}

									<div className="flex flex-wrap items-center gap-3 mb-3">
										<span className="text-2xl font-display font-bold text-ink">
											v{v.version}
										</span>
										<span className="text-xs font-mono text-ink3 font-medium">
											{v.date}
										</span>
										<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface2 text-ink2 border border-border uppercase">
											{v.tag}
										</span>
									</div>

									<h2 className="font-display font-bold text-lg text-ink mb-2">
										{v.title}
									</h2>
									<p className="text-xs sm:text-sm text-ink2 leading-relaxed mb-6 max-w-2xl">
										{v.description}
									</p>

									<div className="border-t border-border/50 pt-4">
										<h3 className="text-xs font-bold uppercase tracking-wider text-ink3 mb-3">
											Key Highlights ({filteredChanges.length})
										</h3>
										<ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-ink2">
											{filteredChanges.map((c) => (
												<li key={c.text} className="flex items-start gap-2">
													<Check size={14} className="text-accent shrink-0 mt-0.5" />
													<span>{c.text}</span>
												</li>
											))}
										</ul>
									</div>
								</div>
							</FadeIn>
						);
					})}
				</div>

				<StaticFooter />
			</section>
		</div>
	);
}
