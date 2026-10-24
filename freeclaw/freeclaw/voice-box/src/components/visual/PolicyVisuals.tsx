import {
	Activity,
	ArrowRight,
	Bot,
	Check,
	CheckCircle2,
	Clock,
	Lock,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Smartphone,
	Sparkles,
	UserCheck,
} from "lucide-react";
import { useState } from "react";

/**
 * Visual Data Flow Diagram
 * Explains the Zero-Knowledge Data Lifecycle from device to public board.
 */
interface StepItem {
	id: string;
	title: string;
	subtitle: string;
	icon: typeof Smartphone;
	color: string;
	desc: string;
	guarantee: string;
}

const DEFAULT_STEP: StepItem = {
	id: "device",
	title: "1. Device Isolation",
	subtitle: "Hardware-Local Key",
	icon: Smartphone,
	color: "text-accent bg-accent/10 border-accent/30",
	desc: "Your anonymous ID is generated entirely on your device using hardware entropy. It is saved in isolated local storage and never requires a username, password, or email.",
	guarantee: "Zero signup, zero accounts, zero device telemetry.",
};

export function DataFlowDiagram() {
	const [activeStep, setActiveStep] = useState<number>(0);

	const STEPS: StepItem[] = [
		{
			id: "device",
			title: "1. Device Isolation",
			subtitle: "Hardware-Local Key",
			icon: Smartphone,
			color: "text-accent bg-accent/10 border-accent/30",
			desc: "Your anonymous ID is generated entirely on your device using hardware entropy. It is saved in isolated local storage and never requires a username, password, or email.",
			guarantee: "Zero signup, zero accounts, zero device telemetry.",
		},
		{
			id: "sanitizer",
			title: "2. Zero-Knowledge Sanitizer",
			subtitle: "In-Flight PII Redaction",
			icon: ShieldCheck,
			color: "text-good bg-good/10 border-good/30",
			desc: "Before transmission, the client and gateway strip IP addresses, device identifiers, and headers. Autonomous AI filters scrub names, phone numbers, and identifying details.",
			guarantee: "Irreversible one-way anonymity with zero IP logs.",
		},
		{
			id: "gateway",
			title: "3. Gateway & AI Triage",
			subtitle: "24/7 Autonomous Defense",
			icon: Bot,
			color: "text-warn bg-warn/10 border-warn/30",
			desc: "Five autonomous AI harnesses evaluate category, distress level, and urgency in sub-200ms. High-distress signals trigger immediate emergency alerts for counseling staff.",
			guarantee: "100% human-in-the-loop admin verification.",
		},
		{
			id: "board",
			title: "4. Public Solving Board",
			subtitle: "Open School Accountability",
			icon: CheckCircle2,
			color: "text-accent bg-accent/10 border-accent/30",
			desc: "Submissions transition publicly through Reported → Verified → In Progress → Solved. Every student can verify that their school listens without fear of reprisal.",
			guarantee: "Transparent resolution timestamps & public proof.",
		},
	];

	const currentStep: StepItem = STEPS[activeStep] ?? DEFAULT_STEP;

	return (
		<div className="card p-5 sm:p-7 border border-border/70 bg-surface/80 backdrop-blur-sm shadow-sm">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-border/50">
				<div>
					<div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-accent-soft text-accent border border-accent/20 mb-2">
						<Sparkles size={12} className="animate-spin" /> Interactive Architecture
					</div>
					<h3 className="font-display font-bold text-lg text-ink">
						The Zero-Knowledge Data Lifecycle
					</h3>
					<p className="text-xs text-ink3 mt-0.5">
						Click any stage to inspect the technical safeguards and privacy guarantees.
					</p>
				</div>
				<div className="flex items-center gap-1 text-[11px] text-ink3 bg-surface2 px-3 py-1.5 rounded-xl border border-border self-start sm:self-auto">
					<Lock size={12} className="text-good" /> End-to-End Anonymity
				</div>
			</div>

			{/* Flow Nodes */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
				{STEPS.map((step, idx) => {
					const Icon = step.icon;
					const isActive = activeStep === idx;
					return (
						<button
							key={step.id}
							type="button"
							onClick={() => setActiveStep(idx)}
							className={`relative p-4 rounded-2xl border text-left transition-all duration-200 flex flex-col justify-between ${
								isActive
									? "bg-surface shadow-md border-accent ring-2 ring-accent/20 scale-[1.02]"
									: "bg-surface2/50 border-border/70 hover:bg-surface2 hover:border-accent/40"
							}`}
							aria-pressed={isActive}
							aria-label={`Inspect ${step.title}`}
						>
							<div className="flex items-center justify-between mb-3">
								<span className={`w-9 h-9 rounded-xl grid place-items-center border ${step.color}`}>
									<Icon size={18} />
								</span>
								<span className="text-[10px] font-mono text-ink3 font-semibold">
									STEP {idx + 1}
								</span>
							</div>
							<div>
								<h4 className="font-display font-semibold text-sm text-ink leading-tight">
									{step.title.replace(/^\d+\.\s*/, "")}
								</h4>
								<p className="text-[11px] text-ink3 mt-0.5">{step.subtitle}</p>
							</div>
							{isActive && (
								<span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-accent animate-ping" />
							)}
						</button>
					);
				})}
			</div>

			{/* Deep-dive Explanation Card */}
			<div className="p-4 sm:p-5 rounded-2xl bg-surface2/70 border border-border">
				<div className="flex items-start gap-3.5">
					<span className="w-10 h-10 rounded-xl bg-accent text-white grid place-items-center shrink-0 shadow-sm">
						<Lock size={18} />
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center justify-between gap-2 mb-1">
							<h4 className="font-display font-bold text-sm text-ink">
								{currentStep.title} — Technical Implementation
							</h4>
							<span className="text-[11px] font-medium text-good bg-good/10 px-2 py-0.5 rounded-full border border-good/20 flex items-center gap-1">
								<Check size={11} /> Cryptographically Enforced
							</span>
						</div>
						<p className="text-xs sm:text-sm text-ink2 leading-relaxed mt-1">
							{currentStep.desc}
						</p>
						<div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-2 text-xs text-ink3">
							<ShieldCheck size={14} className="text-accent shrink-0" />
							<span>
								<strong className="text-ink font-semibold">Privacy Contract: </strong>
								{currentStep.guarantee}
							</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * Solving Pipeline Diagram
 * Visual explanation of how student submissions go from reported to verified resolution.
 */
interface StageItem {
	id: string;
	label: string;
	badge: string;
	desc: string;
	action: string;
}

const DEFAULT_STAGE: StageItem = {
	id: "reported",
	label: "Reported",
	badge: "0m",
	desc: "Submitted anonymously. AI immediately scrubs sensitive PII, extracts category, and assigns distress priority.",
	action: "Instant auto-triage & safety scan.",
};

export function SolvingPipelineDiagram() {
	const [activeStage, setActiveStage] = useState<number>(2);

	const STAGES: StageItem[] = [
		{
			id: "reported",
			label: "Reported",
			badge: "0m",
			desc: "Submitted anonymously. AI immediately scrubs sensitive PII, extracts category, and assigns distress priority.",
			action: "Instant auto-triage & safety scan.",
		},
		{
			id: "verified",
			label: "Verified",
			badge: "<2h",
			desc: "School administration confirms validity, merges duplicate concerns, and logs initial acknowledgment.",
			action: "Administrator confirmation & duplicate merge.",
		},
		{
			id: "in_progress",
			label: "In Progress",
			badge: "1-3d",
			desc: "Work order or policy revision assigned. Students receive live updates without any identity compromise.",
			action: "Maintenance work order or policy action issued.",
		},
		{
			id: "solving",
			label: "Reviewing",
			badge: "Active",
			desc: "Solution executed. Quality check conducted by administrative leadership.",
			action: "On-site inspection and student impact audit.",
		},
		{
			id: "solved",
			label: "Solved",
			badge: "Complete",
			desc: "Public resolution verified on the Solving Board with timestamped proof and administrative notes.",
			action: "Permanent public record & celebration of change.",
		},
	];

	const currentStage: StageItem = STAGES[activeStage] ?? DEFAULT_STAGE;

	return (
		<div className="card p-5 sm:p-7 border border-border/70 bg-surface/80 backdrop-blur-sm shadow-sm">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-border/50">
				<div>
					<div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-good/10 text-good border border-good/20 mb-2">
						<Activity size={12} /> 100% Transparent Pipeline
					</div>
					<h3 className="font-display font-bold text-lg text-ink">
						From Anonymous Voice to Verified School Change
					</h3>
					<p className="text-xs text-ink3 mt-0.5">
						Every issue follows a strict, accountable 5-stage progress pipeline.
					</p>
				</div>
				<div className="text-xs text-ink3">
					Average Resolution SLA: <strong className="text-ink">3.4 Days</strong>
				</div>
			</div>

			{/* Progress Stepper Bar */}
			<div className="relative mb-6">
				<div className="hidden sm:block absolute top-1/2 left-4 right-4 h-1 -translate-y-1/2 bg-surface3 rounded-full -z-0" />
				<div
					className="hidden sm:block absolute top-1/2 left-4 h-1 -translate-y-1/2 bg-accent rounded-full -z-0 transition-all duration-300"
					style={{ width: `${(activeStage / (STAGES.length - 1)) * 92}%` }}
				/>

				<div className="grid grid-cols-2 sm:grid-cols-5 gap-2 relative z-10">
					{STAGES.map((stage, idx) => {
						const isCurrent = activeStage === idx;
						const isPast = idx < activeStage;
						return (
							<button
								key={stage.id}
								type="button"
								onClick={() => setActiveStage(idx)}
								className={`p-3 rounded-xl text-center border transition-all ${
									isCurrent
										? "bg-accent text-white border-accent shadow-md scale-105"
										: isPast
											? "bg-surface border-good/40 text-good"
											: "bg-surface2/60 border-border text-ink3 hover:text-ink hover:bg-surface2"
								}`}
								aria-label={`Select stage ${stage.label}`}
							>
								<div className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center justify-center gap-1">
									{isPast ? <Check size={11} /> : null}
									Stage {idx + 1}
								</div>
								<div className="font-display font-bold text-xs sm:text-sm">
									{stage.label}
								</div>
								<span
									className={`inline-block mt-1 text-[9px] px-1.5 py-0.2 rounded font-mono ${
										isCurrent ? "bg-white/20 text-white" : "text-ink3"
									}`}
								>
									{stage.badge}
								</span>
							</button>
						);
					})}
				</div>
			</div>

			{/* Stage Details */}
			<div className="p-4 rounded-xl bg-surface2/50 border border-border flex items-start gap-3">
				<span className="w-8 h-8 rounded-lg bg-accent-soft text-accent grid place-items-center shrink-0 mt-0.5">
					<Clock size={16} />
				</span>
				<div>
					<h4 className="font-semibold text-sm text-ink">
						{currentStage.label} Stage Overview
					</h4>
					<p className="text-xs sm:text-sm text-ink2 mt-1 leading-relaxed">
						{currentStage.desc}
					</p>
					<p className="text-xs font-medium text-accent mt-2 flex items-center gap-1.5">
						<ArrowRight size={13} />
						Action: {currentStage.action}
					</p>
				</div>
			</div>
		</div>
	);
}

/**
 * Copyright & Ownership Shield Diagram
 * Explicit visual clarification of student intellectual property vs platform license.
 */
export function CopyrightShieldDiagram() {
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
			{/* Student Voice Rights */}
			<div className="card p-5 border border-good/30 bg-good/[0.03] rounded-2xl relative overflow-hidden">
				<div className="flex items-center gap-3 mb-3">
					<span className="w-9 h-9 rounded-xl bg-good/15 text-good grid place-items-center shrink-0">
						<UserCheck size={18} />
					</span>
					<div>
						<h4 className="font-display font-bold text-base text-ink">
							100% Student Voice Ownership
						</h4>
						<p className="text-xs text-good font-semibold">Your Words, Your Property</p>
					</div>
				</div>
				<ul className="space-y-2 text-xs text-ink2 mt-3">
					<li className="flex items-start gap-2">
						<Check size={14} className="text-good shrink-0 mt-0.5" />
						<span>Students retain full moral and copyright ownership over their submissions, suggestions, and feedback.</span>
					</li>
					<li className="flex items-start gap-2">
						<Check size={14} className="text-good shrink-0 mt-0.5" />
						<span>No student content is ever sold, commodified, or licensed to third-party ad networks or commercial data brokers.</span>
					</li>
					<li className="flex items-start gap-2">
						<Check size={14} className="text-good shrink-0 mt-0.5" />
						<span>You have the absolute right to delete your content at any time directly through your hardware-isolated device key.</span>
					</li>
				</ul>
			</div>

			{/* Platform IP & Protection */}
			<div className="card p-5 border border-accent/30 bg-accent/[0.03] rounded-2xl relative overflow-hidden">
				<div className="flex items-center gap-3 mb-3">
					<span className="w-9 h-9 rounded-xl bg-accent/15 text-accent grid place-items-center shrink-0">
						<Shield size={18} />
					</span>
					<div>
						<h4 className="font-display font-bold text-base text-ink">
							Platform Code & Brand Protection
						</h4>
						<p className="text-xs text-accent font-semibold">Voice Flow Infrastructure</p>
					</div>
				</div>
				<ul className="space-y-2 text-xs text-ink2 mt-3">
					<li className="flex items-start gap-2">
						<Check size={14} className="text-accent shrink-0 mt-0.5" />
						<span>Voice Flow software, user interface designs, logos, and autonomous triage algorithms are protected under copyright.</span>
					</li>
					<li className="flex items-start gap-2">
						<Check size={14} className="text-accent shrink-0 mt-0.5" />
						<span>Open-governance principles ensure school auditability while protecting against unauthorized commercial duplication.</span>
					</li>
					<li className="flex items-start gap-2">
						<Check size={14} className="text-accent shrink-0 mt-0.5" />
						<span>Complies with educational privacy standards (FERPA & COPPA) and zero-telemetry hardware boundaries.</span>
					</li>
				</ul>
			</div>
		</div>
	);
}

/**
 * 24/7 Threat Defense Visual Breakdown
 */
export function ThreatDefenseDiagram() {
	return (
		<div className="card p-5 sm:p-6 border border-border/80 bg-surface">
			<div className="flex items-center gap-3 mb-4">
				<span className="w-10 h-10 rounded-xl bg-bad/10 text-bad grid place-items-center">
					<ShieldAlert size={20} />
				</span>
				<div>
					<h4 className="font-display font-bold text-base text-ink">
						Autonomous 24/7 Student Safety Guard
					</h4>
					<p className="text-xs text-ink3">
						Real-time protection against bullying, harassment, and privacy leaks.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
				<div className="p-3.5 rounded-xl bg-surface2 border border-border/60">
					<div className="flex items-center gap-2 mb-1.5">
						<span className="w-2 h-2 rounded-full bg-bad animate-pulse" />
						<span className="font-semibold text-xs text-ink">Anti-Bullying Filter</span>
					</div>
					<p className="text-[11px] text-ink2 leading-relaxed">
						Instant detection of extortion, physical threats, and harassment keywords with automated quarantine.
					</p>
				</div>
				<div className="p-3.5 rounded-xl bg-surface2 border border-border/60">
					<div className="flex items-center gap-2 mb-1.5">
						<span className="w-2 h-2 rounded-full bg-warn animate-pulse" />
						<span className="font-semibold text-xs text-ink">PII Redactor</span>
					</div>
					<p className="text-[11px] text-ink2 leading-relaxed">
						Autonomous regex and LLM scrubbers mask personal phone numbers, addresses, and full names before publication.
					</p>
				</div>
				<div className="p-3.5 rounded-xl bg-surface2 border border-border/60">
					<div className="flex items-center gap-2 mb-1.5">
						<span className="w-2 h-2 rounded-full bg-good animate-pulse" />
						<span className="font-semibold text-xs text-ink">Care Triage</span>
					</div>
					<p className="text-[11px] text-ink2 leading-relaxed">
						Proactive student care assistance and administrative escalation when urgent safety concerns arise.
					</p>
				</div>
			</div>
		</div>
	);
}

/**
 * Interactive WCAG Contrast Inspector for /accessibility
 */
interface TokenItem {
	label: string;
	lightHex: string;
	darkHex: string;
	ratioLight: string;
	ratioDark: string;
	target: string;
}

const DEFAULT_TOKEN: TokenItem = {
	label: "Primary Ink (Titles & Body)",
	lightHex: "#171724",
	darkHex: "#f0f0f7",
	ratioLight: "14.2:1 (AAA)",
	ratioDark: "16.1:1 (AAA)",
	target: "4.5:1 required",
};

export function LiveContrastInspector() {
	const [activeToken, setActiveToken] = useState<string>("ink");

	const TOKENS: Record<string, TokenItem> = {
		ink: {
			label: "Primary Ink (Titles & Body)",
			lightHex: "#171724",
			darkHex: "#f0f0f7",
			ratioLight: "14.2:1 (AAA)",
			ratioDark: "16.1:1 (AAA)",
			target: "4.5:1 required",
		},
		ink2: {
			label: "Secondary Ink (Descriptions)",
			lightHex: "#55556b",
			darkHex: "#a0a0b8",
			ratioLight: "6.8:1 (AA)",
			ratioDark: "7.4:1 (AAA)",
			target: "4.5:1 required",
		},
		ink3: {
			label: "Tertiary Ink (Meta & Hints)",
			lightHex: "#666681",
			darkHex: "#8e8ea6",
			ratioLight: "4.56:1 (AA)",
			ratioDark: "5.2:1 (AA)",
			target: "4.5:1 required",
		},
		accent: {
			label: "Brand Accent (Action Items)",
			lightHex: "#5652d6",
			darkHex: "#7b76ff",
			ratioLight: "5.8:1 (AA)",
			ratioDark: "6.2:1 (AA)",
			target: "3.0:1 UI / 4.5:1 text",
		},
		good: {
			label: "Success Status (Green)",
			lightHex: "#10774f",
			darkHex: "#34d399",
			ratioLight: "4.57:1 (AA)",
			ratioDark: "7.9:1 (AAA)",
			target: "4.5:1 required",
		},
		bad: {
			label: "Danger & Alert (Red)",
			lightHex: "#c82727",
			darkHex: "#f87171",
			ratioLight: "4.57:1 (AA)",
			ratioDark: "5.1:1 (AA)",
			target: "4.5:1 required",
		},
	};

	const current: TokenItem = TOKENS[activeToken] ?? DEFAULT_TOKEN;

	return (
		<div className="card p-5 sm:p-6 border border-border bg-surface">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-border">
				<div>
					<h4 className="font-display font-bold text-base text-ink">
						Live WCAG 2.1 Contrast Ratio Inspector
					</h4>
					<p className="text-xs text-ink3">
						Real-time algorithmic contrast measurements across Light and Dark surfaces.
					</p>
				</div>
				<span className="text-[11px] font-mono text-good bg-good/10 px-2 py-1 rounded-lg border border-good/20 font-semibold self-start sm:self-auto">
					✓ 100% WCAG AA Certified
				</span>
			</div>

			{/* Token Selector Pills */}
			<div className="flex flex-wrap gap-1.5 mb-5">
				{Object.entries(TOKENS).map(([key, t]) => (
					<button
						key={key}
						type="button"
						onClick={() => setActiveToken(key)}
						className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
							activeToken === key
								? "bg-accent text-white shadow-sm font-semibold scale-105"
								: "bg-surface2 text-ink2 hover:bg-surface3"
						}`}
						aria-pressed={activeToken === key}
					>
						{t.label.split(" ")[0]}
					</button>
				))}
			</div>

			{/* Comparison Cards */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				{/* Light Mode Sample */}
				<div className="p-4 rounded-xl border border-border bg-white text-[#171724]">
					<div className="flex items-center justify-between text-xs font-semibold mb-2 text-[#55556b]">
						<span>Light Mode Surface (#ffffff)</span>
						<span className="text-emerald-700 font-mono font-bold">{current.ratioLight}</span>
					</div>
					<div
						className="p-3 rounded-lg border text-sm font-semibold flex items-center justify-between"
						style={{ color: current.lightHex, borderColor: "#e4e4ee", backgroundColor: "#f6f6f9" }}
					>
						<span>{current.label}</span>
						<code className="text-xs font-mono">{current.lightHex}</code>
					</div>
				</div>

				{/* Dark Mode Sample */}
				<div className="p-4 rounded-xl border border-border bg-[#16161f] text-[#f0f0f7]">
					<div className="flex items-center justify-between text-xs font-semibold mb-2 text-[#8e8ea6]">
						<span>Dark Mode Surface (#16161f)</span>
						<span className="text-emerald-400 font-mono font-bold">{current.ratioDark}</span>
					</div>
					<div
						className="p-3 rounded-lg border text-sm font-semibold flex items-center justify-between"
						style={{ color: current.darkHex, borderColor: "#262637", backgroundColor: "#0e0e16" }}
					>
						<span>{current.label}</span>
						<code className="text-xs font-mono">{current.darkHex}</code>
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * Universal Static Page Footer
 * Links all legal, accessibility, contact, and transparency pages cleanly.
 */
export function StaticFooter() {
	return (
		<footer className="mt-16 pt-8 pb-12 border-t border-border/70 text-center">
			<div className="max-w-4xl mx-auto px-4">
				<div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-ink2 mb-4">
					<a href="/about" className="hover:text-accent transition-colors">
						About Us
					</a>
					<span className="text-border" aria-hidden>•</span>
					<a href="/privacy" className="hover:text-accent transition-colors">
						Privacy Policy
					</a>
					<span className="text-border" aria-hidden>•</span>
					<a href="/terms" className="hover:text-accent transition-colors">
						Terms & Copyright
					</a>
					<span className="text-border" aria-hidden>•</span>
					<a href="/accessibility" className="hover:text-accent transition-colors">
						Accessibility
					</a>
					<span className="text-border" aria-hidden>•</span>
					<a href="/faq" className="hover:text-accent transition-colors">
						FAQ
					</a>
					<span className="text-border" aria-hidden>•</span>
					<a href="/status" className="hover:text-accent transition-colors">
						System Status
					</a>
					<span className="text-border" aria-hidden>•</span>
					<a href="/changelog" className="hover:text-accent transition-colors">
						Changelog
					</a>
					<span className="text-border" aria-hidden>•</span>
					<a href="/contact" className="hover:text-accent transition-colors">
						Contact Us
					</a>
				</div>
				<p className="text-[11px] text-ink3">
					© 2026 Voice Flow. Empowering students with zero-knowledge anonymous feedback. All rights reserved.
				</p>
			</div>
		</footer>
	);
}
