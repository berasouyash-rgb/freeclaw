/**
 * GlowButton — Premium button with an animated glowing border and glassmorphism fill.
 * The border is a rotating conic gradient masked to a 1.5px ring; the fill is a
 * translucent glass panel (backdrop blur) with a pulsing outer glow (box-shadow,
 * which is not clipped by the button's overflow:hidden).
 * Sits alongside GradientButton as the "glow" flavor of primary action buttons.
 */

import { Loader2 } from "lucide-react";
import type { FC, ReactNode } from "react";

export interface GlowButtonProps {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	busy?: boolean;
	variant?: "violet" | "cyan" | "gold" | "neutral";
	size?: "sm" | "md" | "lg";
	className?: string;
	icon?: ReactNode;
	type?: "button" | "submit";
	/** Set to false to freeze the rotating border animation (still shows glow). */
	animate?: boolean;
	/** Set to false to disable the pulsing outer glow. */
	pulse?: boolean;
	"aria-label"?: string;
}

const GLOW_VARS: Record<NonNullable<GlowButtonProps["variant"]>, string> = {
	violet: "--glow-a:#8b5cf6; --glow-b:#22d3ee;",
	cyan: "--glow-a:#06b6d4; --glow-b:#3b82f6;",
	gold: "--glow-a:#f59e0b; --glow-b:#fbbf24;",
	neutral: "--glow-a:#94a3b8; --glow-b:#e2e8f0;",
};

const SIZE_STYLES: Record<NonNullable<GlowButtonProps["size"]>, string> = {
	sm: "px-4 py-2 text-xs rounded-xl",
	md: "px-6 py-3 text-sm rounded-2xl",
	lg: "px-8 py-4 text-base rounded-2xl",
};

const GlowButton: FC<GlowButtonProps> = ({
	children,
	onClick,
	disabled,
	busy,
	variant = "violet",
	size = "md",
	className = "",
	icon,
	type = "button",
	animate = true,
	pulse = true,
	"aria-label": ariaLabel,
}) => {
	const glowVars = GLOW_VARS[variant];
	return (
		<button
			type={type}
			onClick={onClick}
			disabled={disabled || busy}
			aria-label={ariaLabel}
			className={`glow-btn group relative inline-flex items-center justify-center gap-2.5 font-semibold text-white transition-transform duration-300 ${
				SIZE_STYLES[size]
			} ${disabled || busy ? "opacity-50 cursor-not-allowed" : "hover:scale-[1.03] active:scale-[0.97]"} ${className}`}
		>
			{/* Animated glowing border ring */}
			<span aria-hidden className="glow-btn-ring" />
			{/* Glassmorphism fill */}
			<span aria-hidden className="glow-btn-glass" />

			{/* Content */}
			<span className="relative z-10 flex items-center gap-2">
				{busy ? (
					<Loader2 size={size === "lg" ? 18 : 14} className="animate-spin" />
				) : (
					icon
				)}
				{children}
			</span>

			<style>{`
        .glow-btn {
          position: relative;
          overflow: hidden;
          isolation: isolate;
          background: transparent;
          ${glowVars}
          ${pulse ? "animation: glow-btn-pulse 2.6s ease-in-out infinite;" : ""}
        }
        .glow-btn-ring {
          position: absolute;
          inset: -150%;
          z-index: 0;
          background: conic-gradient(var(--glow-a) 0deg, var(--glow-b) 90deg, var(--glow-a) 180deg, var(--glow-b) 270deg, var(--glow-a) 360deg);
          animation: ${animate ? "glow-btn-rotate 3s linear infinite" : "none"};
        }
        .glow-btn-glass {
          position: absolute;
          inset: 1.5px;
          z-index: 1;
          border-radius: inherit;
          background: rgba(17, 17, 27, 0.55);
          backdrop-filter: blur(14px) saturate(140%);
          -webkit-backdrop-filter: blur(14px) saturate(140%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
        }
        @keyframes glow-btn-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes glow-btn-pulse {
          0%, 100% { box-shadow: 0 0 14px -2px var(--glow-a), 0 0 30px -8px var(--glow-b); }
          50% { box-shadow: 0 0 26px 0 var(--glow-a), 0 0 48px -6px var(--glow-b); }
        }
      `}</style>
		</button>
	);
};

export default GlowButton;
