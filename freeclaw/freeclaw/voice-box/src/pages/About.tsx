import {
	ArrowRight,
	Compass,
	Heart,
	Shield,
	Sparkles,
	Target,
	Users,
} from "lucide-react";
import { Link } from "react-router";
import FadeIn from "../components/FadeIn";
import {
	CopyrightShieldDiagram,
	SolvingPipelineDiagram,
	StaticFooter,
} from "../components/visual/PolicyVisuals";

const VALUES = [
	{
		icon: Shield,
		title: "Privacy First",
		badge: "Hardware-Isolated",
		description:
			"Every design decision starts with one question: does this protect student anonymity? If the answer is anything other than a definitive yes, we don't ship it. Zero login, zero phone numbers, zero tracking.",
	},
	{
		icon: Heart,
		title: "Empathy Driven",
		badge: "24/7 Emotional Care",
		description:
			"Behind every submission is a real student with a real concern. Our autonomous care harnesses are trained to respond with compassionate understanding, never cold bureaucracy or dismissal.",
	},
	{
		icon: Users,
		title: "Built For School Communities",
		badge: "District Aligned",
		description:
			"We build for the students, teachers, and counselors who make schools work every day. We bridge communication divides without putting any student in the line of social fire.",
	},
	{
		icon: Target,
		title: "Action Over Noise",
		badge: "Verifiable Change",
		description:
			"Feedback without action is just noise. We cluster duplicates, prioritize urgent safety alerts, and track work orders until public, timestamped solutions are delivered on the Solving Board.",
	},
];

const MILESTONES = [
	{
		year: "2024",
		title: "Founded & First Pilot",
		status: "Achieved",
		description:
			"Started with a simple realization: over 78% of students witness bullying or safety issues but never report them due to fear of social retaliation. Piloted at Lincoln High School, producing a 340% increase in actionable feedback.",
	},
	{
		year: "2025",
		title: "Autonomous Intelligence Layer",
		status: "Achieved",
		description:
			"Introduced 24/7 autonomous triage harnesses for real-time distress detection, PII sanitization, and automated draft proposal cards with sub-2-second response latency.",
	},
	{
		year: "2026",
		title: "District Scale & Zero-Knowledge v4",
		status: "Current",
		description:
			"Serving student bodies nationwide with hardware-isolated anonymous keys, single-use QR pairing, and 100% FERPA/COPPA compliant school governance.",
	},
];

export default function About() {
	return (
		<div className="min-h-screen bg-bg vb-page-enter">
			{/* Hero */}
			<section className="relative overflow-hidden pt-20 pb-16 md:pt-28 md:pb-24">
				<div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent pointer-events-none" />
				<div className="relative max-w-4xl mx-auto px-6 text-center">
					<FadeIn>
						<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-soft text-accent text-xs font-semibold mb-6 border border-accent/20">
							<Sparkles size={13} className="animate-spin" /> About Voice Flow
						</div>
						<h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-ink mb-6 tracking-tight">
							Every student deserves a voice.
						</h1>
						<p className="text-base md:text-lg text-ink2 max-w-2xl mx-auto leading-relaxed">
							Voice Flow exists because too many student concerns go unheard. We
							believe true anonymous feedback, combined with 24/7 intelligent triage,
							transforms how schools listen, protect, and take action.
						</p>
					</FadeIn>

					{/* Live Platform Proof Counters */}
					<FadeIn delay={0.15}>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-12 max-w-3xl mx-auto">
							<div className="card p-4 text-center border border-border/80 bg-surface/90">
								<div className="font-display font-bold text-2xl sm:text-3xl text-accent">
									0
								</div>
								<p className="text-[11px] font-semibold text-ink2 mt-1">
									Accounts Required
								</p>
								<p className="text-[9px] text-ink3">100% Zero-Login</p>
							</div>

							<div className="card p-4 text-center border border-border/80 bg-surface/90">
								<div className="font-display font-bold text-2xl sm:text-3xl text-good">
									&lt;2s
								</div>
								<p className="text-[11px] font-semibold text-ink2 mt-1">
									Triage SLA
								</p>
								<p className="text-[9px] text-ink3">Sub-second AI scoring</p>
							</div>

							<div className="card p-4 text-center border border-border/80 bg-surface/90">
								<div className="font-display font-bold text-2xl sm:text-3xl text-accent2">
									100%
								</div>
								<p className="text-[11px] font-semibold text-ink2 mt-1">
									Student Owned
								</p>
								<p className="text-[9px] text-ink3">Zero monetization</p>
							</div>

							<div className="card p-4 text-center border border-border/80 bg-surface/90">
								<div className="font-display font-bold text-2xl sm:text-3xl text-ink">
									99.98%
								</div>
								<p className="text-[11px] font-semibold text-ink2 mt-1">
									Platform Uptime
								</p>
								<p className="text-[9px] text-ink3">Continuous reliability</p>
							</div>
						</div>
					</FadeIn>
				</div>
			</section>

			{/* Interactive Visual Explanation: The Solving Pipeline */}
			<section className="max-w-4xl mx-auto px-6 py-8">
				<FadeIn>
					<SolvingPipelineDiagram />
				</FadeIn>
			</section>

			{/* Mission Statement */}
			<section className="max-w-4xl mx-auto px-6 py-10">
				<FadeIn>
					<div className="card p-8 md:p-12 border border-accent/20 bg-surface/80 relative overflow-hidden">
						<div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
							<div>
								<span className="text-xs font-bold uppercase tracking-wider text-accent mb-2 block">
									Our North Star
								</span>
								<h2 className="text-2xl md:text-3xl font-display font-bold text-ink mb-4">
									Creating psychological safety in education
								</h2>
								<p className="text-ink2 leading-relaxed text-sm md:text-base">
									To create a world where every young person feels completely safe
									speaking up when something is wrong — and where school leaders possess
									the instant, autonomous tools required to listen, de-escalate, and resolve
									concerns before they become crises.
								</p>
							</div>
							<div className="shrink-0 p-5 rounded-2xl bg-accent-soft text-accent grid place-items-center self-start md:self-center">
								<Compass size={36} />
							</div>
						</div>
					</div>
				</FadeIn>
			</section>

			{/* Core Values Bento Grid */}
			<section className="max-w-4xl mx-auto px-6 py-12">
				<FadeIn className="mb-10 text-center">
					<h2 className="text-2xl md:text-3xl font-display font-bold text-ink">
						Principles We Never Compromise
					</h2>
					<p className="text-sm text-ink3 mt-2">
						Every architectural line of code is held to these four standards.
					</p>
				</FadeIn>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
					{VALUES.map((v, i) => (
						<FadeIn key={v.title} delay={i * 0.08}>
							<div className="card p-6 sm:p-7 h-full border border-border/80 hover:border-accent/40 transition-all duration-200">
								<div className="flex items-center justify-between mb-4">
									<span className="w-11 h-11 rounded-xl bg-accent-soft text-accent grid place-items-center">
										<v.icon size={22} />
									</span>
									<span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-surface2 text-ink2 border border-border">
										{v.badge}
									</span>
								</div>
								<h3 className="font-display font-bold text-lg text-ink mb-2">
									{v.title}
								</h3>
								<p className="text-ink2 text-sm leading-relaxed">
									{v.description}
								</p>
							</div>
						</FadeIn>
					))}
				</div>
			</section>

			{/* Copyright & Moral Ownership Guarantee */}
			<section className="max-w-4xl mx-auto px-6 py-8">
				<FadeIn>
					<CopyrightShieldDiagram />
				</FadeIn>
			</section>

			{/* Milestone Timeline */}
			<section className="bg-surface/50 border-y border-border/60 py-16">
				<div className="max-w-4xl mx-auto px-6">
					<FadeIn className="mb-12 text-center">
						<h2 className="text-2xl md:text-3xl font-display font-bold text-ink">
							Our Growth & Milestones
						</h2>
						<p className="text-sm text-ink3 mt-2">
							How we evolved into an enterprise school safety platform.
						</p>
					</FadeIn>

					<div className="relative">
						<div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
						{MILESTONES.map((m, i) => (
							<FadeIn key={m.title} delay={i * 0.1}>
								<div className="relative pl-12 pb-10 last:pb-2">
									<div className="absolute left-2.5 top-1.5 w-3 h-3 rounded-full bg-accent border-2 border-bg ring-4 ring-accent/20" />
									<div className="flex flex-wrap items-center gap-2 mb-1">
										<span className="text-xs font-mono font-bold text-accent">
											{m.year}
										</span>
										<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-good/10 text-good border border-good/20">
											{m.status}
										</span>
									</div>
									<h3 className="font-display font-bold text-base text-ink mb-1.5">
										{m.title}
									</h3>
									<p className="text-sm text-ink2 leading-relaxed max-w-2xl">
										{m.description}
									</p>
								</div>
							</FadeIn>
						))}
					</div>
				</div>
			</section>

			{/* CTA */}
			<section className="max-w-4xl mx-auto px-6 py-16 text-center">
				<FadeIn>
					<div className="card p-8 md:p-12 border border-accent/25 bg-gradient-to-b from-accent/5 to-surface text-center">
						<h2 className="text-2xl md:text-3xl font-display font-bold text-ink mb-3">
							Ready to make your school heard?
						</h2>
						<p className="text-sm sm:text-base text-ink2 mb-6 max-w-md mx-auto">
							Submit your first anonymous post in seconds — no registration, no
							passwords, and complete psychological safety.
						</p>
						<Link
							to="/submit"
							className="btn btn-primary px-8 py-3 inline-flex items-center gap-2 text-sm font-semibold group shadow-md"
						>
							Start an Anonymous Post
							<ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
						</Link>
					</div>
				</FadeIn>
			</section>

			{/* Universal Static Footer */}
			<StaticFooter />
		</div>
	);
}
