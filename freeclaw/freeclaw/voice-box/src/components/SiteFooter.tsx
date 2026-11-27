import {
	ArrowUp,
	CheckCircle2,
	EyeOff,
	Image as ImageIcon,
	Layers,
	Shield,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { useApp } from "../contexts/AppContext";
import { triggerHaptic } from "../lib/haptics";
import VoiceLogo from "./VoiceLogo";

const FOOTER_STYLE_KEY = "vb:footer-style";

export function SiteFooter() {
	const { theme } = useApp();
	const [styleMode, setStyleMode] = useState<"art" | "clean">(() => {
		try {
			const saved = localStorage.getItem(FOOTER_STYLE_KEY);
			return saved === "clean" ? "clean" : "art";
		} catch {
			return "art";
		}
	});

	const toggleStyle = useCallback(() => {
		triggerHaptic("light");
		setStyleMode((prev) => {
			const next = prev === "art" ? "clean" : "art";
			try {
				localStorage.setItem(FOOTER_STYLE_KEY, next);
			} catch {
				/* storage disabled or quota reached */
			}
			return next;
		});
	}, []);

	const scrollToTop = useCallback(() => {
		triggerHaptic("light");
		window.scrollTo({ top: 0, behavior: "smooth" });
	}, []);

	const linkClass =
		"text-ink3 hover:text-ink dark:hover:text-white transition-colors duration-150 inline-block py-0.5";

	const isArt = styleMode === "art";
	const isDark = theme === "dark";

	return (
		<footer
			data-testid="site-footer"
			className="relative mt-14 mb-8 rounded-3xl overflow-hidden border border-border/80 dark:border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_12px_40px_rgb(0,0,0,0.6)] bg-surface/90 dark:bg-[#0e1322]/95 backdrop-blur-xl transition-all duration-300"
		>
			{/* ── Ambient Campus Artwork Backdrop ── */}
			{isArt && (
				<div
					className="absolute inset-0 pointer-events-none overflow-hidden select-none"
					aria-hidden="true"
				>
					<picture className="w-full h-full">
						<source
							srcSet={
								isDark
									? "/campus/campus-night.webp"
									: "/campus/campus-day.webp"
							}
							type="image/webp"
						/>
						<img
							src={
								isDark
									? "/campus/campus-night.jpg"
									: "/campus/campus-day.jpg"
							}
							alt=""
							className="w-full h-full object-cover object-[center_35%] opacity-30 dark:opacity-35 saturate-125 contrast-105 motion-safe:transition-all motion-safe:duration-700"
						/>
					</picture>

					{/* Layered Gradient Overlays for Flawless Readability */}
					<div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/90 to-surface/50 dark:from-[#0e1322] dark:via-[#0e1322]/92 dark:to-[#0e1322]/55" />
					<div className="absolute inset-0 bg-gradient-to-r from-surface/80 via-transparent to-surface/80 dark:from-[#0e1322]/85 dark:via-transparent dark:to-[#0e1322]/85" />

					{/* Soft Decorative Accent Wave Lights */}
					<div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-accent/15 dark:bg-accent/25 blur-3xl" />
					<div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-violet-500/10 dark:bg-violet-500/20 blur-3xl" />
				</div>
			)}

			<div className="relative z-10 px-6 sm:px-8 py-8 sm:py-10">
				{/* ── Brand & Campus Credential Row ── */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 border-b border-border/70 dark:border-white/10">
					<div className="flex items-center gap-3.5">
						<VoiceLogo
							size={38}
							className="shadow-lg shadow-accent/25 rounded-2xl shrink-0"
						/>
						<div>
							<div className="flex items-center gap-2 flex-wrap">
								<span className="font-display font-bold text-lg sm:text-xl tracking-tight text-ink dark:text-white">
									Voice Flow
								</span>
								<span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
									<Shield size={11} className="stroke-[2.5]" />
									Vision International School
								</span>
							</div>
							<p className="text-xs text-ink3 mt-0.5 font-medium tracking-tight">
								Every voice deserves to be heard. Speak up. Stay invisible.
							</p>
						</div>
					</div>

					{/* Top Right Controls: Theme/Backdrop Toggle + Back to Top */}
					<div className="flex items-center gap-2 self-start md:self-auto">
						<button
							type="button"
							onClick={toggleStyle}
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border border-border/80 dark:border-white/15 bg-surface2/60 dark:bg-white/5 hover:bg-surface2 dark:hover:bg-white/10 text-ink2 dark:text-zinc-200 transition-all shadow-xs active:scale-95"
							title={
								isArt
									? "Switch to clean minimal footer"
									: "Switch to campus artwork footer"
							}
							aria-label="Toggle footer background style"
						>
							{isArt ? (
								<>
									<ImageIcon size={13} className="text-accent" />
									<span className="hidden sm:inline">Campus Backdrop</span>
									<span className="sm:hidden">Art</span>
								</>
							) : (
								<>
									<Layers size={13} className="text-ink3" />
									<span className="hidden sm:inline">Clean Minimal</span>
									<span className="sm:hidden">Clean</span>
								</>
							)}
						</button>

						<button
							type="button"
							onClick={scrollToTop}
							className="inline-flex items-center justify-center w-8 h-8 rounded-xl border border-border/80 dark:border-white/15 bg-surface2/60 dark:bg-white/5 hover:bg-surface2 dark:hover:bg-white/10 text-ink3 hover:text-accent transition-all active:scale-95"
							title="Back to top"
							aria-label="Scroll back to top"
						>
							<ArrowUp size={14} />
						</button>
					</div>
				</div>

				{/* ── 4-Column Navigation & Explainer Grid ── */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-8 text-left text-xs">
					{/* Col 1: Platform & Anonymity Guarantee */}
					<div className="col-span-2 md:col-span-1 pr-2">
						<p className="font-display font-semibold text-ink dark:text-white mb-2.5 flex items-center gap-1.5">
							<EyeOff size={13} className="text-accent" /> 100% Anonymous
						</p>
						<p className="text-ink3 leading-relaxed mb-3">
							Random client-generated identifiers protect student identities.
							Never asks for names, emails, or phone numbers.
						</p>
						<div className="inline-flex items-center gap-1 text-[11px] font-medium text-accent">
							<CheckCircle2 size={12} />
							<span>Zero student tracking</span>
						</div>
					</div>

					{/* Col 2: Navigation / Explore */}
					<div>
						<p className="font-display font-semibold text-ink dark:text-white mb-2.5">
							Explore
						</p>
						<ul className="space-y-1.5">
							<li>
								<Link to="/" className={linkClass}>
									Feed
								</Link>
							</li>
							<li>
								<Link to="/search" className={linkClass}>
									Search
								</Link>
							</li>
							<li>
								<Link to="/polls" className={linkClass}>
									Polls
								</Link>
							</li>
							<li>
								<Link to="/communities" className={linkClass}>
									Communities
								</Link>
							</li>
							<li>
								<Link to="/insights" className={linkClass}>
									Campus Insights
								</Link>
							</li>
						</ul>
					</div>

					{/* Col 3: Community & Governance */}
					<div>
						<p className="font-display font-semibold text-ink dark:text-white mb-2.5">
							Community
						</p>
						<ul className="space-y-1.5">
							<li>
								<Link to="/about" className={linkClass}>
									About Voice Flow
								</Link>
							</li>
							<li>
								<Link to="/faq" className={linkClass}>
									FAQ
								</Link>
							</li>
							<li>
								<Link to="/solving" className={linkClass}>
									Solving Pipeline
								</Link>
							</li>
							<li>
								<Link to="/leaderboard" className={linkClass}>
									Leaderboard
								</Link>
							</li>
							<li>
								<Link to="/contact" className={linkClass}>
									Contact Support
								</Link>
							</li>
						</ul>
					</div>

					{/* Col 4: Legal & System */}
					<div>
						<p className="font-display font-semibold text-ink dark:text-white mb-2.5">
							System & Legal
						</p>
						<ul className="space-y-1.5">
							<li>
								<Link to="/privacy" className={linkClass}>
									Privacy Policy
								</Link>
							</li>
							<li>
								<Link to="/terms" className={linkClass}>
									Terms of Service
								</Link>
							</li>
							<li>
								<Link to="/accessibility" className={linkClass}>
									Accessibility
								</Link>
							</li>
							<li>
								<Link to="/status" className={linkClass}>
									System Status
								</Link>
							</li>
							<li>
								<Link to="/download" className={linkClass}>
									Download App
								</Link>
							</li>
						</ul>
					</div>
				</div>

				{/* ── Bottom Credits & Copyright Row ── */}
				<div className="pt-6 border-t border-border/70 dark:border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-ink3">
					<p>© 2026 Voice Flow · Vision International School</p>
					<p className="flex items-center gap-1 font-medium">
						<span>Designed & built for</span>
						<span className="font-semibold text-ink dark:text-zinc-200">
							Souyash Bera
						</span>
						<span className="text-accent">·</span>
						<span>Voice Flow Production</span>
					</p>
				</div>
			</div>
		</footer>
	);
}

export default SiteFooter;
