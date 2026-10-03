import { ArrowLeft, Check, Ear, Eye, Keyboard, Mail, Monitor } from "lucide-react";
import { Link, useNavigate } from "react-router";
import FadeIn from "../components/FadeIn";

const COMMITMENTS = [
	{
		icon: Eye,
		title: "Visual Accessibility",
		items: [
			"Minimum 4.5:1 color contrast ratio for normal text",
			"3:1 contrast ratio for large text and UI components",
			"No information conveyed by color alone",
			"Resizable text up to 200% without loss of functionality",
			"Focus indicators visible on all interactive elements",
		],
	},
	{
		icon: Keyboard,
		title: "Keyboard Accessibility",
		items: [
			"All interactive elements reachable via keyboard",
			"Logical tab order throughout the interface",
			"No keyboard traps",
			"Skip navigation links provided",
			"Keyboard shortcuts documented and discoverable",
		],
	},
	{
		icon: Ear,
		title: "Screen Reader Support",
		items: [
			"Semantic HTML structure with proper headings",
			"ARIA labels on all interactive elements",
			"Alt text for informative images",
			"Form labels associated with inputs",
			"Live regions for dynamic content updates",
		],
	},
	{
		icon: Monitor,
		title: "Motor Accessibility",
		items: [
			"Minimum 44x44px touch targets on mobile",
			"No time-limited interactions without option to extend",
			"Drag-and-drop alternatives provided",
			"No content that flashes more than 3 times per second",
		],
	},
];

const STANDARDS = [
	{ level: "A", criteria: "29", met: 29 },
	{ level: "AA", criteria: "20", met: 18 },
	{ level: "AAA", criteria: "28", met: 12 },
];

export default function Accessibility() {
	const nav = useNavigate();
	// Deep links land here with no history to go back to — fall home
	// instead of a dead button.
	const goBack = () => {
		if (window.history.length > 1) nav(-1);
		else nav("/");
	};
	return (
		<div className="min-h-screen bg-bg">
			<section className="relative overflow-hidden">
				<div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
				<div className="relative max-w-3xl mx-auto px-6 pt-24 pb-16 md:pt-32 md:pb-20 text-center">
					<FadeIn>
						<button
							type="button"
							className="btn btn-ghost !px-3 mb-6"
							onClick={goBack}
							aria-label="Go back"
						>
							<ArrowLeft size={15} /> Back
						</button>
						<p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-accent bg-accent/10 rounded-full px-3 py-1.5 mb-4">
							WCAG 2.1 AA baseline
						</p>
						<h1 className="text-4xl md:text-5xl font-bold text-ink mb-6">
							Accessibility
						</h1>
						<p className="text-lg text-ink2 max-w-xl mx-auto">
							Voice Flow is committed to ensuring digital accessibility for all
							users, including those with disabilities.
						</p>
					</FadeIn>
				</div>
			</section>

			{/* Commitments */}
			<section className="max-w-4xl mx-auto px-6 py-16">
				<FadeIn className="mb-12">
					<h2 className="text-2xl font-bold text-ink text-center">
						Our Commitments
					</h2>
				</FadeIn>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					{COMMITMENTS.map((c, i) => (
						<FadeIn key={c.title} delay={i * 0.1}>
							<div className="card p-6 h-full">
								<c.icon className="w-8 h-8 text-accent mb-4" />
								<h3 className="font-semibold text-ink mb-3">{c.title}</h3>
								<ul className="space-y-2">
									{c.items.map((item) => (
										<li
											key={item}
											className="flex items-start gap-2 text-sm text-ink2"
										>
											<Check className="w-4 h-4 text-good mt-0.5 shrink-0" />
											{item}
										</li>
									))}
								</ul>
							</div>
						</FadeIn>
					))}
				</div>
			</section>

			{/* WCAG Status */}
			<section className="bg-surface/50 border-y border-border/50">
				<div className="max-w-4xl mx-auto px-6 py-16">
					<FadeIn className="text-center mb-8">
						<h2 className="text-2xl font-bold text-ink">WCAG 2.1 Compliance</h2>
						<p className="text-ink2 mt-2">
							We target WCAG 2.1 Level AA as our baseline standard.
						</p>
					</FadeIn>
					<FadeIn>
						<div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
							{STANDARDS.map((s) => (
								<div key={s.level} className="card p-4 text-center">
									<div className="text-2xl font-bold text-ink mb-1">
										Level {s.level}
									</div>
									<div className="text-sm text-ink2">
										{s.met}/{s.criteria} criteria met
									</div>
									<div className="mt-2 h-2 bg-border rounded-full overflow-hidden">
										<div
											className="h-full bg-accent rounded-full"
											style={{
												width: `${(parseInt(String(s.met)) / parseInt(String(s.criteria))) * 100}%`,
											}}
										/>
									</div>
								</div>
							))}
						</div>
					</FadeIn>
				</div>
			</section>

			{/* Known Issues */}
			<section className="max-w-3xl mx-auto px-6 py-16">
				<FadeIn>
					<h2 className="text-2xl font-bold text-ink mb-6">
						Known Limitations
					</h2>
					<div className="space-y-4">
						{[
							{
								issue:
									"Complex data visualizations may not be fully accessible to screen readers",
								mitigation:
									"We provide text-based alternatives for all charts and graphs",
								status: "In Progress",
							},
							{
								issue:
									"Some animations may not respect prefers-reduced-motion in all browsers",
								mitigation:
									"All animations can be disabled via system preferences",
								status: "Resolved",
							},
							{
								issue:
									"Third-party embedded content may not meet our accessibility standards",
								mitigation:
									"We are working with vendors to improve accessibility",
								status: "In Progress",
							},
						].map((item, i) => (
							<div key={i} className="card p-4">
								<div className="flex items-start justify-between mb-1">
									<h3 className="font-medium text-ink text-sm">{item.issue}</h3>
									<span												className={`text-xs px-2 py-0.5 rounded-full ${item.status === "Resolved" ? "bg-good/10 text-good" : "bg-warn/10 text-warn"}`}
									>
										{item.status}
									</span>
								</div>
								<p className="text-xs text-ink2">
									Mitigation: {item.mitigation}
								</p>
							</div>
						))}
					</div>
				</FadeIn>
			</section>

			{/* Contact */}
			<section className="max-w-3xl mx-auto px-6 py-16 text-center">
				<FadeIn>
					<h2 className="text-2xl font-bold text-ink mb-4">
						Accessibility Feedback
					</h2>
					<p className="text-ink2 mb-6">
						We welcome your feedback on the accessibility of Voice Flow. Please
						let us know if you encounter any barriers.
					</p>
					<Link
						to="/contact"
						className="btn-primary px-6 py-3 inline-flex items-center gap-2"
					>
						<Mail className="w-4 h-4" />
						Contact Accessibility Team
					</Link>
				</FadeIn>
			</section>
		</div>
	);
}
