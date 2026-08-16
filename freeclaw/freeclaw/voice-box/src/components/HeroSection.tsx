/**
 * HeroSection — Premium animated hero with gradient background, floating orbs, and glow effects.
 * Zero extra dependencies, pure Tailwind + inline CSS keyframes.
 */
import { Sparkles } from "lucide-react";
import type { FC } from "react";

interface HeroSectionProps {
	title: string;
	subtitle: string;
	action?: { label: string; onClick: () => void };
	stats?: { label: string; value: string }[];
	className?: string;
	badge?: string;
}

const HeroSection: FC<HeroSectionProps> = ({
	title,
	subtitle,
	action,
	stats,
	className = "",
	badge,
}) => {
	return (
		<section
			className={`relative overflow-hidden rounded-3xl min-h-[300px] flex items-center ${className}`}
		>
			{/* Gradient background */}
			<div className="absolute inset-0 bg-gradient-to-br from-accent/20 via-accent/5 to-transparent" />

			{/* Floating orbs */}
			<div className="absolute inset-0 overflow-hidden pointer-events-none">
				<div className="hero-orb hero-orb-1 absolute -top-20 -left-20 w-64 h-64 rounded-full bg-accent/10 blur-3xl" />
				<div className="hero-orb hero-orb-2 absolute top-1/3 -right-32 w-80 h-80 rounded-full bg-accent2/8 blur-3xl" />
				<div className="hero-orb hero-orb-3 absolute -bottom-24 left-1/4 w-72 h-72 rounded-full bg-accent/6 blur-3xl" />
			</div>

			{/* Grid overlay */}
			<div
				className="absolute inset-0 opacity-[0.03] pointer-events-none"
				style={{
					backgroundImage:
						"linear-gradient(var(--vb-ink) 1px, transparent 1px), linear-gradient(90deg, var(--vb-ink) 1px, transparent 1px)",
					backgroundSize: "60px 60px",
				}}
			/>

			{/* Content */}
			<div className="relative z-10 px-8 py-16 md:px-12 md:py-20 max-w-4xl">
				{badge && (
					<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-xs text-accent font-medium mb-6 animate-in fade-in slide-in-from-top-4">
						<Sparkles size={12} />
						<span>{badge}</span>
					</div>
				)}

				<h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-ink leading-tight mb-4 tracking-tight">
					{title}
				</h1>

				<p className="text-lg md:text-xl text-ink2 max-w-2xl mb-8 leading-relaxed">
					{subtitle}
				</p>

				{action && (
					<button
						onClick={action.onClick}
						className="hero-cta group relative inline-flex items-center gap-2.5 px-7 py-3.5 rounded-2xl bg-accent text-white font-semibold text-sm shadow-lg shadow-accent/25 transition-all duration-300 hover:shadow-xl hover:shadow-accent/30 hover:-translate-y-0.5 active:translate-y-0"
					>
						<span className="relative z-10 flex items-center gap-2">
							{action.label}
							<Sparkles
								size={15}
								className="group-hover:rotate-12 transition-transform"
							/>
						</span>
						<div className="hero-cta-glow absolute inset-0 rounded-2xl bg-accent opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-50" />
					</button>
				)}

				{stats && stats.length > 0 && (
					<div className="flex flex-wrap gap-8 mt-10 pt-8 border-t border-border/50">
						{stats.map((s, i) => (
							<div key={i} className="hero-stat">
								<p className="text-2xl md:text-3xl font-bold text-ink">
									{s.value}
								</p>
								<p className="text-xs text-ink3 font-medium mt-0.5">
									{s.label}
								</p>
							</div>
						))}
					</div>
				)}
			</div>

			<style>{`
        @keyframes hero-orb-float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.6; }
          33% { transform: translateY(-20px) scale(1.05); opacity: 0.8; }
          66% { transform: translateY(10px) scale(0.95); opacity: 0.7; }
        }
        .hero-orb { animation: hero-orb-float 8s ease-in-out infinite; }
        .hero-orb-1 { animation-delay: 0s; }
        .hero-orb-2 { animation-delay: 2.7s; }
        .hero-orb-3 { animation-delay: 5.3s; }

        @keyframes hero-cta-glow {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        .hero-cta:hover .hero-cta-glow { animation: hero-cta-glow 2s ease-in-out infinite; }

        @keyframes hero-stat-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .hero-stat { animation: hero-stat-in 0.5s ease both; }
        .hero-stat:nth-child(1) { animation-delay: 0.1s; }
        .hero-stat:nth-child(2) { animation-delay: 0.2s; }
        .hero-stat:nth-child(3) { animation-delay: 0.3s; }
        .hero-stat:nth-child(4) { animation-delay: 0.4s; }
      `}</style>
		</section>
	);
};

export default HeroSection;
