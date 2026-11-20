import {
	ArrowLeft,
	ArrowUpRight,
	Award,
	Brain,
	Code2,
	Compass,
	Cpu,
	Globe,
	Home,
	Lightbulb,
	MessageSquare,
	Moon,
	Palette,
	Rocket,
	Share2,
	ShieldCheck,
	Sparkles,
	Sun,
	Workflow,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import BlurFade from "../components/ui/blur-fade";
import BorderBeam from "../components/ui/border-beam";
import ShimmerButton from "../components/ui/shimmer-button";
import StudioRiver from "../components/visual/StudioRiver";
import { StaticFooter } from "../components/visual/PolicyVisuals";
import { triggerHaptic } from "../lib/haptics";
import { useApp } from "../contexts/AppContext";

export default function Developer() {
	const nav = useNavigate();
	const { toast } = useApp();
	const [studioTheme, setStudioTheme] = useState<"white" | "obsidian">("white");
	const [activeInterest, setActiveInterest] = useState<string | null>(null);

	const goBack = () => {
		triggerHaptic("light");
		if (typeof window !== "undefined" && window.history.length > 1) {
			window.history.back();
		} else {
			nav("/");
		}
	};

	const handleShare = async () => {
		triggerHaptic("medium");
		if (typeof navigator !== "undefined" && navigator.share) {
			try {
				await navigator.share({
					title: "Souyash Bera — Founder of VoiceFlow",
					text: "Explore the journey, craft, and philosophy of Souyash Bera, Independent Developer & Creator of VoiceFlow.",
					url: window.location.href,
				});
				return;
			} catch {
				// Fall through to clipboard
			}
		}
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			await navigator.clipboard.writeText(window.location.href);
			toast("Studio link copied to clipboard ✨", "ok");
		}
	};

	const INTERESTS = [
		{
			id: "tech",
			label: "Technology",
			icon: Cpu,
			desc: "Exploring cutting-edge platforms, architectures, and computing paradigms.",
			color: "from-blue-500/20 to-indigo-500/10 text-blue-600 dark:text-blue-400",
		},
		{
			id: "innov",
			label: "Innovation",
			icon: Zap,
			desc: "Challenging conventional boundaries and discovering smarter alternatives.",
			color: "from-amber-500/20 to-orange-500/10 text-amber-600 dark:text-amber-400",
		},
		{
			id: "software",
			label: "Software Development",
			icon: Code2,
			desc: "Crafting robust, high-performance systems with meticulous code quality.",
			color: "from-emerald-500/20 to-teal-500/10 text-emerald-800 dark:text-emerald-300",
		},
		{
			id: "product",
			label: "Product Building",
			icon: Rocket,
			desc: "Transforming raw ideas into cohesive, end-to-end digital software.",
			color: "from-violet-500/20 to-purple-500/10 text-violet-600 dark:text-violet-400",
		},
		{
			id: "creative",
			label: "Creative Thinking",
			icon: Lightbulb,
			desc: "Connecting disparate dots to reimagine everyday human interactions.",
			color: "from-yellow-500/20 to-amber-500/10 text-yellow-600 dark:text-yellow-400",
		},
		{
			id: "design",
			label: "Design",
			icon: Palette,
			desc: "Polishing typography, micro-interactions, motion physics, and visual calm.",
			color: "from-pink-500/20 to-rose-500/10 text-pink-600 dark:text-pink-400",
		},
		{
			id: "problem",
			label: "Problem-Solving",
			icon: Brain,
			desc: "Unpicking root causes of friction and engineering permanent resolutions.",
			color: "from-cyan-500/20 to-blue-500/10 text-cyan-600 dark:text-cyan-400",
		},
		{
			id: "experience",
			label: "Digital Experiences",
			icon: Sparkles,
			desc: "Creating intuitive, responsive journeys that feel effortless and human.",
			color: "from-indigo-500/20 to-violet-500/10 text-indigo-600 dark:text-indigo-400",
		},
		{
			id: "entrepreneur",
			label: "Entrepreneurship",
			icon: Globe,
			desc: "Building sustainable, purposeful ventures that make a lasting positive impact.",
			color: "from-teal-500/20 to-emerald-500/10 text-teal-600 dark:text-teal-400",
		},
	];

	const isWhite = studioTheme === "white";

	return (
		<div
			className={`min-h-screen transition-colors duration-500 ${
				isWhite
					? "bg-[#fafbff] text-slate-900"
					: "bg-[#090A0F] text-[#F5F5FA]"
			}`}
		>
			{/* ── Ambient Studio Lighting Rig ── */}
			<div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
				{/* Top-Right Soft Violet Ambient Cone */}
				<div
					className="absolute -top-32 -right-32 w-[550px] h-[550px] rounded-full transition-opacity duration-700"
					style={{
						background: isWhite
							? "radial-gradient(circle, rgba(118,87,255,0.12) 0%, rgba(169,154,255,0.04) 50%, transparent 75%)"
							: "radial-gradient(circle, rgba(118,87,255,0.20) 0%, rgba(99,102,241,0.08) 50%, transparent 75%)",
						filter: "blur(60px)",
					}}
				/>
				{/* Center-Left Soft Cyan/Ice Ambient Glow */}
				<div
					className="absolute top-1/3 -left-40 w-[600px] h-[600px] rounded-full transition-opacity duration-700"
					style={{
						background: isWhite
							? "radial-gradient(circle, rgba(56,189,248,0.10) 0%, rgba(147,197,253,0.03) 50%, transparent 75%)"
							: "radial-gradient(circle, rgba(14,165,233,0.14) 0%, rgba(99,102,241,0.05) 50%, transparent 75%)",
						filter: "blur(70px)",
					}}
				/>
				{/* Bottom-Center Warm Gold Diffused Pool */}
				<div
					className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full opacity-60 pointer-events-none"
					style={{
						background: isWhite
							? "radial-gradient(ellipse, rgba(251,191,36,0.07) 0%, transparent 70%)"
							: "radial-gradient(ellipse, rgba(245,158,11,0.09) 0%, transparent 70%)",
						filter: "blur(80px)",
					}}
				/>
			</div>

			<div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-20">
				{/* ── Studio Top Bar ── */}
				<header className="flex items-center justify-between pb-6 border-b border-black/5 dark:border-white/10">
					<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={goBack}
							className={`inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl transition-all cursor-pointer shadow-2xs ${
								isWhite
									? "bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-slate-900"
									: "bg-surface/80 hover:bg-surface border border-white/10 text-white/80 hover:text-white"
							}`}
							aria-label="Go back"
						>
							<ArrowLeft size={14} /> Back
						</button>
						<Link
							to="/"
							className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-accent dark:text-white/60 transition-colors"
						>
							<Home size={13} /> Feed
						</Link>
					</div>

					<div className="flex items-center gap-2">
						{/* Ambient Studio Lighting Switcher */}
						<div
							className={`flex items-center p-1 rounded-xl border transition-all ${
								isWhite
									? "bg-white border-slate-200 shadow-2xs"
									: "bg-surface border-white/10"
							}`}
							role="group"
							aria-label="Studio lighting ambiance switch"
						>
							<button
								type="button"
								onClick={() => {
									triggerHaptic("light");
									setStudioTheme("white");
								}}
								className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
									isWhite
										? "bg-accent/10 text-accent font-semibold shadow-2xs"
										: "text-slate-400 hover:text-white"
								}`}
								title="White Studio Lighting"
								aria-pressed={isWhite}
							>
								<Sun size={12} /> Studio White
							</button>
							<button
								type="button"
								onClick={() => {
									triggerHaptic("light");
									setStudioTheme("obsidian");
								}}
								className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
									!isWhite
										? "bg-white/15 text-white font-semibold shadow-2xs"
										: "text-slate-500 hover:text-slate-900"
								}`}
								title="Obsidian Dark Studio Lighting"
								aria-pressed={!isWhite}
							>
								<Moon size={12} /> Obsidian
							</button>
						</div>

						{/* Share Button */}
						<button
							type="button"
							onClick={handleShare}
							className={`p-2 rounded-xl border transition-all text-xs font-medium ${
								isWhite
									? "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
									: "bg-surface hover:bg-surface2 border-white/10 text-white/80"
							}`}
							title="Share developer profile"
							aria-label="Share developer profile"
						>
							<Share2 size={14} />
						</button>
					</div>
				</header>

				{/* ── Main Hero Composition (Matching User's Sketch) ── */}
				{/* Sketch layout: Left = Flowing River Stream; Right = Large Rounded Studio Card */}
				<main className="mt-8">
					<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
						{/* ── LEFT: The Flowing River Stream (from sketch) ── */}
						<div className="lg:col-span-4 xl:col-span-3">
							<BlurFade delay={0.05} yOffset={16}>
								<div
									className={`p-5 rounded-[28px] border transition-all duration-300 relative overflow-hidden ${
										isWhite
											? "bg-white/80 border-slate-200/90 shadow-[0_12px_32px_-8px_rgba(118,87,255,0.08)]"
											: "bg-[#11131c]/90 border-white/10 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.6)]"
									}`}
								>
									<div className="flex items-center justify-between mb-3 px-1">
										<span className="text-[11px] font-mono uppercase tracking-widest text-accent font-semibold flex items-center gap-1.5">
											<Workflow size={13} /> Ideation River
										</span>
										<span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
											Live Stream
										</span>
									</div>

									{/* Generative River Animation */}
									<StudioRiver
										ambientColor={isWhite ? "violet" : "cyan"}
										flowSpeed={1.2}
										className="h-[380px] sm:h-[480px] lg:h-[580px] w-full"
									/>

									<p
										className={`text-xs mt-4 text-center leading-relaxed font-sans ${
											isWhite ? "text-slate-600" : "text-white/70"
										}`}
									>
										"Curiosity flows like a river — winding through friction,
										surfacing truth, and shaping intuitive human experiences."
									</p>
								</div>
							</BlurFade>
						</div>

						{/* ── RIGHT: The Smooth Studio Stage Container (from sketch) ── */}
						<div className="lg:col-span-8 xl:col-span-9 space-y-8">
							{/* ── Developer Stage Hero Card ── */}
							<BlurFade delay={0.1} yOffset={20}>
								<div
									className={`p-6 sm:p-10 rounded-[32px] border relative overflow-hidden transition-all duration-300 ${
										isWhite
											? "bg-white border-slate-200 shadow-[0_20px_50px_-12px_rgba(118,87,255,0.12)]"
											: "bg-[#11131d] border-white/10 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)]"
									}`}
								>
									<BorderBeam
										duration={14}
										size={240}
										colorFrom={isWhite ? "rgba(118, 87, 255, 0.4)" : "rgba(169, 154, 255, 0.5)"}
										colorTo="transparent"
									/>

									<div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
										<div className="flex-1 min-w-0">
											{/* Badges & Location Pill */}
											<div className="flex flex-wrap items-center gap-2 mb-4">
												<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-accent-soft text-accent border border-accent/20">
													<Sparkles size={12} className="animate-spin" /> Independent Developer
												</span>
												<span
													className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
														isWhite
															? "bg-slate-100 text-slate-700 border-slate-200"
															: "bg-surface2 text-white/80 border-white/10"
													}`}
												>
													<Globe size={12} className="text-emerald-500" /> India 🇮🇳
												</span>
												<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20">
													<ShieldCheck size={12} /> Founder of VoiceFlow
												</span>
											</div>

											{/* Name & Titles with Motion */}
											<div className="space-y-2">
												<h1
													className={`text-3xl sm:text-4xl lg:text-5xl font-display font-bold tracking-tight ${
														isWhite ? "text-slate-950" : "text-white"
													}`}
												>
													Souyash Bera
												</h1>
												<p className="text-sm sm:text-base font-semibold text-accent leading-snug">
													Independent Developer · Technology Enthusiast · Founder of VoiceFlow
												</p>
											</div>

											{/* Opening Bio Summary with refined typography */}
											<p
												className={`text-sm sm:text-base leading-relaxed mt-4 max-w-2xl ${
													isWhite ? "text-slate-700" : "text-[#9295A5]"
												}`}
											>
												I'm an independent developer and technology enthusiast from India with a passion for
												creativity, innovation, problem-solving, and building meaningful digital experiences.
												I enjoy exploring new ideas, understanding how technology works, and discovering ways to
												make everyday experiences simpler, more useful, and more enjoyable.
											</p>
										</div>

										{/* ── Studio Photo Stage (Matching "photo" from user sketch) ── */}
										<div className="shrink-0 relative group self-center lg:self-auto">
											<div
												className="absolute -inset-4 rounded-3xl opacity-75 blur-xl transition-all duration-700 group-hover:opacity-100"
												style={{
													background: isWhite
														? "radial-gradient(circle, rgba(118,87,255,0.25) 0%, rgba(99,102,241,0.12) 60%, transparent 80%)"
														: "radial-gradient(circle, rgba(118,87,255,0.4) 0%, rgba(169,154,255,0.18) 60%, transparent 80%)",
												}}
											/>
											<div
												className={`relative w-48 h-56 sm:w-56 sm:h-64 rounded-3xl border-2 p-3.5 flex flex-col items-center justify-center text-center shadow-xl transition-all duration-300 group-hover:scale-[1.03] ${
													isWhite
														? "bg-white/95 border-slate-200/90 shadow-slate-200/50"
														: "bg-surface/95 border-white/15 shadow-black/80"
												}`}
											>
												<div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-2xl bg-gradient-to-tr from-accent via-[#6366f1] to-[#a855f7] p-1 shadow-lg mb-2.5 flex items-center justify-center overflow-hidden">
													<img
														src="/souyash-bera.jpeg"
														alt="Souyash Bera — Founder & Lead Developer of VoiceFlow"
														className="w-full h-full rounded-[14px] object-cover object-center group-hover:scale-105 transition-transform duration-500"
														loading="eager"
													/>
													<span className="absolute bottom-2 right-2 flex h-3 w-3">
														<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
														<span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-white dark:border-slate-900" />
													</span>
												</div>
												<p
													className={`text-sm font-bold font-display tracking-tight ${
														isWhite ? "text-slate-900" : "text-white"
													}`}
												>
													Souyash Bera
												</p>
												<p className="text-[10.5px] text-accent font-semibold tracking-wide mt-0.5">
													Founder & Lead Developer
												</p>
												<div className="mt-1.5 flex items-center gap-1.5 text-[9.5px] font-medium text-emerald-800 dark:text-emerald-300">
													<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
													Independent Creator · India 🇮🇳
												</div>
											</div>
										</div>
									</div>

									{/* Interactive Quick Links / Action Row */}
									<div className="flex flex-wrap items-center gap-3 mt-8 pt-6 border-t border-black/5 dark:border-white/10">
										<Link to="/submit" onClick={() => triggerHaptic("medium")}>
											<ShimmerButton
												shimmerColor="rgba(255,255,255,0.7)"
												background="linear-gradient(135deg, #7657FF 0%, #6366f1 100%)"
												className="!text-white !font-semibold !px-5 !py-2.5 !text-xs shadow-md"
											>
												<Sparkles size={14} /> Experience VoiceFlow Live
											</ShimmerButton>
										</Link>

										<a
											href="https://github.com"
											target="_blank"
											rel="noopener noreferrer"
											onClick={() => triggerHaptic("light")}
											className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold border transition-all ${
												isWhite
													? "bg-slate-100 hover:bg-slate-200/80 text-slate-800 border-slate-200"
													: "bg-surface2 hover:bg-surface3 text-white border-white/10"
											}`}
										>
											<Code2 size={14} /> Code & Projects <ArrowUpRight size={13} />
										</a>

										<Link
											to="/about"
											onClick={() => triggerHaptic("light")}
											className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline ml-auto"
										>
											VoiceFlow Mission <ArrowUpRight size={13} />
										</Link>
									</div>
								</div>
							</BlurFade>

							{/* ── Chapter 01: The Spark & Curiosity ── */}
							<BlurFade delay={0.15} yOffset={20}>
								<section
									className={`p-6 sm:p-8 rounded-[28px] border transition-all ${
										isWhite
											? "bg-white border-slate-200/90 shadow-sm"
											: "bg-[#11131d] border-white/10"
									}`}
								>
									<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent mb-3">
										<Lightbulb size={14} /> Chapter 01 · The Approach
									</div>
									<h2
										className={`text-2xl sm:text-3xl font-display font-bold mb-4 ${
											isWhite ? "text-slate-900" : "text-white"
										}`}
									>
										Driven by Curiosity & First Principles
									</h2>
									<div
										className={`space-y-4 text-sm sm:text-base leading-relaxed ${
											isWhite ? "text-slate-700" : "text-[#9295A5]"
										}`}
									>
										<p>
											My approach to building starts with curiosity. I observe everyday problems, explore
											existing solutions, question conventional approaches, and imagine how things could be
											improved.
										</p>
										<p>
											I believe even the simplest idea can become something meaningful when developed with
											the right vision, effort, and attention to detail. I'm particularly interested in the
											intersection of technology, creativity, design, and human experiences.
										</p>
									</div>

									{/* 3 Steps Bento Cards */}
									<div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-6">
										<div
											className={`p-4 rounded-2xl border transition-all ${
												isWhite ? "bg-slate-50 border-slate-200/80" : "bg-surface border-white/5"
											}`}
										>
											<div className="w-8 h-8 rounded-xl bg-accent/10 text-accent grid place-items-center mb-2 font-bold text-sm">
												01
											</div>
											<h3
												className={`text-sm font-bold font-display mb-1 ${
													isWhite ? "text-slate-900" : "text-white"
												}`}
											>
												Observe Friction
											</h3>
											<p className="text-xs text-slate-500 dark:text-white/60 leading-relaxed">
												Listening closely to where people hesitate, struggle, or feel silenced.
											</p>
										</div>

										<div
											className={`p-4 rounded-2xl border transition-all ${
												isWhite ? "bg-slate-50 border-slate-200/80" : "bg-surface border-white/5"
											}`}
										>
											<div className="w-8 h-8 rounded-xl bg-accent/10 text-accent grid place-items-center mb-2 font-bold text-sm">
												02
											</div>
											<h3
												className={`text-sm font-bold font-display mb-1 ${
													isWhite ? "text-slate-900" : "text-white"
												}`}
											>
												Question Convention
											</h3>
											<p className="text-xs text-slate-500 dark:text-white/60 leading-relaxed">
												Rejecting needless bureaucracy and asking why systems were designed that way.
											</p>
										</div>

										<div
											className={`p-4 rounded-2xl border transition-all ${
												isWhite ? "bg-slate-50 border-slate-200/80" : "bg-surface border-white/5"
											}`}
										>
											<div className="w-8 h-8 rounded-xl bg-accent/10 text-accent grid place-items-center mb-2 font-bold text-sm">
												03
											</div>
											<h3
												className={`text-sm font-bold font-display mb-1 ${
													isWhite ? "text-slate-900" : "text-white"
												}`}
											>
												Craft Solutions
											</h3>
											<p className="text-xs text-slate-500 dark:text-white/60 leading-relaxed">
												Iterating obsessively until the interface feels calm, tactile, and natural.
											</p>
										</div>
									</div>
								</section>
							</BlurFade>

							{/* ── Chapter 02: The Creation of VoiceFlow ── */}
							<BlurFade delay={0.2} yOffset={20}>
								<section
									className={`p-6 sm:p-8 rounded-[28px] border relative overflow-hidden transition-all ${
										isWhite
											? "bg-gradient-to-br from-white via-indigo-50/30 to-violet-50/40 border-indigo-200/60 shadow-sm"
											: "bg-gradient-to-br from-[#121422] to-[#17192b] border-white/10"
									}`}
								>
									<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent mb-3">
										<Rocket size={14} /> Chapter 02 · The Flagship Product
									</div>
									<h2
										className={`text-2xl sm:text-3xl font-display font-bold mb-4 ${
											isWhite ? "text-slate-900" : "text-white"
										}`}
									>
										The Genesis of VoiceFlow
									</h2>
									<div
										className={`space-y-4 text-sm sm:text-base leading-relaxed ${
											isWhite ? "text-slate-700" : "text-[#9295A5]"
										}`}
									>
										<p>
											I'm the creator of <strong>VoiceFlow</strong>, a project driven by my vision of
											creating a more intuitive, accessible, and seamless digital experience. Through
											VoiceFlow, I explore new possibilities in product development, functionality, design,
											and the way people interact with technology.
										</p>
										<p>
											VoiceFlow was conceived around a fundamental realization: students and community
											members desperately need a psychologically safe, zero-trace method to report urgent
											concerns without social retaliation or cumbersome logins.
										</p>
									</div>

									{/* VoiceFlow Pillars Display */}
									<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
										<div
											className={`p-4 rounded-2xl border ${
												isWhite ? "bg-white border-slate-200" : "bg-black/30 border-white/10"
											}`}
										>
											<div className="flex items-center gap-2 text-accent font-bold text-xs uppercase mb-1">
												<ShieldCheck size={14} /> Zero-Trace Privacy
											</div>
											<p className="text-xs text-slate-500 dark:text-white/60">
												Quad-tier persistent browser identity with zero logins or phone numbers.
											</p>
										</div>

										<div
											className={`p-4 rounded-2xl border ${
												isWhite ? "bg-white border-slate-200" : "bg-black/30 border-white/10"
											}`}
										>
											<div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-xs uppercase mb-1">
												<Brain size={14} /> Intelligent Triage
											</div>
											<p className="text-xs text-slate-500 dark:text-white/60">
												Real-time campus issue validation, respect checking, and automatic priority.
											</p>
										</div>

										<div
											className={`p-4 rounded-2xl border ${
												isWhite ? "bg-white border-slate-200" : "bg-black/30 border-white/10"
											}`}
										>
											<div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 font-bold text-xs uppercase mb-1">
												<Sparkles size={14} /> Tactile Polish
											</div>
											<p className="text-xs text-slate-500 dark:text-white/60">
												Apple/Linear-grade micro-interactions, haptics, and zero console noise.
											</p>
										</div>
									</div>
								</section>
							</BlurFade>

							{/* ── Chapter 03: The Guiding Philosophy (Featured Quote Banner) ── */}
							<BlurFade delay={0.25} yOffset={20}>
								<section
									className={`p-8 sm:p-12 rounded-[32px] border text-center relative overflow-hidden transition-all ${
										isWhite
											? "bg-gradient-to-b from-indigo-50/60 to-white border-indigo-200 shadow-md"
											: "bg-gradient-to-b from-[#181a2e] to-[#10121d] border-accent/30 shadow-xl"
									}`}
								>
									<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-widest text-accent bg-accent/10 border border-accent/20 mb-4">
										<Compass size={13} /> Core Philosophy
									</span>

									<blockquote
										className={`text-xl sm:text-2xl md:text-3xl font-display font-semibold italic max-w-2xl mx-auto leading-relaxed ${
											isWhite ? "text-slate-900" : "text-white"
										}`}
									>
										"I believe technology should bring people closer to possibilities, remove unnecessary
										complexity, and make everyday life better."
									</blockquote>

									<div className="mt-8 pt-8 border-t border-black/5 dark:border-white/10">
										<p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
											The Three Immutable Pillars
										</p>
										<div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
											<span className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-accent text-white shadow-sm">
												Think creatively.
											</span>
											<span className="text-slate-400 font-mono">→</span>
											<span className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-indigo-600 text-white shadow-sm">
												Build purposefully.
											</span>
											<span className="text-slate-400 font-mono">→</span>
											<span className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-violet-600 text-white shadow-sm">
												Improve continuously.
											</span>
										</div>
									</div>
								</section>
							</BlurFade>

							{/* ── Chapter 04: Interactive Interests Constellation ── */}
							<BlurFade delay={0.3} yOffset={20}>
								<section
									className={`p-6 sm:p-8 rounded-[28px] border transition-all ${
										isWhite
											? "bg-white border-slate-200/90 shadow-sm"
											: "bg-[#11131d] border-white/10"
									}`}
								>
									<div className="flex items-center justify-between mb-4">
										<div>
											<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent mb-1">
												<Palette size={14} /> Chapter 04 · Creative Spectrum
											</div>
											<h2
												className={`text-2xl sm:text-3xl font-display font-bold ${
													isWhite ? "text-slate-900" : "text-white"
												}`}
											>
												My Interests & Passions
											</h2>
										</div>
										<span className="text-xs font-mono text-slate-400 hidden sm:inline">
											Tap any to explore
										</span>
									</div>

									<p
										className={`text-sm mb-6 ${
											isWhite ? "text-slate-600" : "text-[#9295A5]"
										}`}
									>
										Beyond my own projects, I enjoy discovering innovative products, exploring different
										creative tools, experimenting with new technologies, and learning from the people and
										companies shaping the digital world.
									</p>

									{/* Interactive Pill Grid */}
									<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
										{INTERESTS.map((item) => {
											const Icon = item.icon;
											const isSelected = activeInterest === item.id;
											return (
												<button
													key={item.id}
													type="button"
													onClick={() => {
														triggerHaptic("light");
														setActiveInterest(isSelected ? null : item.id);
													}}
													className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
														isSelected
															? "ring-2 ring-accent border-accent/40 shadow-sm scale-[1.02]"
															: isWhite
																? "bg-slate-50/80 hover:bg-slate-100/90 border-slate-200/70"
																: "bg-surface/80 hover:bg-surface2 border-white/5"
													}`}
												>
													<div className="flex items-center gap-2.5 mb-1.5">
														<span className={`p-1.5 rounded-lg bg-gradient-to-tr ${item.color}`}>
															<Icon size={16} />
														</span>
														<span
															className={`font-display font-bold text-sm ${
																isWhite ? "text-slate-900" : "text-white"
															}`}
														>
															{item.label}
														</span>
													</div>
													<p
														className={`text-xs leading-relaxed ${
															isWhite ? "text-slate-600" : "text-white/60"
														}`}
													>
														{item.desc}
													</p>
												</button>
											);
										})}
									</div>
								</section>
							</BlurFade>

							{/* ── Chapter 05: Engineering Values & Craft ── */}
							<BlurFade delay={0.35} yOffset={20}>
								<section
									className={`p-6 sm:p-8 rounded-[28px] border transition-all ${
										isWhite
											? "bg-white border-slate-200/90 shadow-sm"
											: "bg-[#11131d] border-white/10"
									}`}
								>
									<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent mb-3">
										<Award size={14} /> Chapter 05 · Craftsmanship
									</div>
									<h2
										className={`text-2xl sm:text-3xl font-display font-bold mb-4 ${
											isWhite ? "text-slate-900" : "text-white"
										}`}
									>
										Building for Real Utility
									</h2>
									<p
										className={`text-sm sm:text-base leading-relaxed ${
											isWhite ? "text-slate-700" : "text-[#9295A5]"
										}`}
									>
										I value simplicity, thoughtful design, reliability, creativity, and continuous
										improvement. For me, building something isn't just about making it work; it's about
										making it genuinely useful for the people who use it.
									</p>
									<p
										className={`text-sm sm:text-base leading-relaxed mt-3 ${
											isWhite ? "text-slate-700" : "text-[#9295A5]"
										}`}
									>
										I'm continuously learning, experimenting, and developing my skills, with the ambition of
										creating products that can make a positive difference in people's everyday lives.
									</p>

									<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
										<div
											className={`p-3.5 rounded-2xl border text-center ${
												isWhite ? "bg-slate-50 border-slate-200/80" : "bg-surface border-white/5"
											}`}
										>
											<p className="font-display font-bold text-accent text-lg">Simplicity</p>
											<p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5">
												Eliminating the extraneous
											</p>
										</div>
										<div
											className={`p-3.5 rounded-2xl border text-center ${
												isWhite ? "bg-slate-50 border-slate-200/80" : "bg-surface border-white/5"
											}`}
										>
											<p className="font-display font-bold text-indigo-600 dark:text-indigo-400 text-lg">
												Thoughtful
											</p>
											<p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5">
												Respecting user attention
											</p>
										</div>
										<div
											className={`p-3.5 rounded-2xl border text-center ${
												isWhite ? "bg-slate-50 border-slate-200/80" : "bg-surface border-white/5"
											}`}
										>
											<p className="font-display font-bold text-emerald-800 dark:text-emerald-300 text-lg">
												Reliable
											</p>
											<p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5">
												Predictable & dependable
											</p>
										</div>
										<div
											className={`p-3.5 rounded-2xl border text-center ${
												isWhite ? "bg-slate-50 border-slate-200/80" : "bg-surface border-white/5"
											}`}
										>
											<p className="font-display font-bold text-amber-600 dark:text-amber-400 text-lg">
												Adaptive
											</p>
											<p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5">
												Iterative improvement
											</p>
										</div>
									</div>
								</section>
							</BlurFade>

							{/* ── Chapter 06: Collaborative Inquiries & Connect ── */}
							<BlurFade delay={0.4} yOffset={20}>
								<section
									className={`p-6 sm:p-8 rounded-[28px] border text-center transition-all ${
										isWhite
											? "bg-slate-100/80 border-slate-200"
											: "bg-surface border-white/10"
									}`}
								>
									<h2
										className={`text-xl sm:text-2xl font-display font-bold mb-2 ${
											isWhite ? "text-slate-900" : "text-white"
										}`}
									>
										Let's Build the Future Together
									</h2>
									<p
										className={`text-xs sm:text-sm max-w-md mx-auto leading-relaxed mb-6 ${
											isWhite ? "text-slate-600" : "text-[#9295A5]"
										}`}
									>
										Interested in discussing technology, product architecture, or collaboration? Let's connect.
									</p>

									<div className="flex flex-wrap items-center justify-center gap-3">
										<Link
											to="/contact"
											onClick={() => triggerHaptic("medium")}
											className="btn btn-primary !px-6 !py-2.5 !text-xs !font-semibold shadow-md"
										>
											<MessageSquare size={14} /> Send a Message
										</Link>
										<Link
											to="/"
											onClick={() => triggerHaptic("light")}
											className={`btn !px-6 !py-2.5 !text-xs !font-semibold border ${
												isWhite
													? "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
													: "bg-surface2 hover:bg-surface3 border-white/10 text-white"
											}`}
										>
											Explore VoiceFlow
										</Link>
									</div>
								</section>
							</BlurFade>
						</div>
					</div>
				</main>
			</div>

			{/* Universal Static Footer */}
			<StaticFooter />
		</div>
	);
}
