/**
 * GradientButton — Premium animated button with shimmer gradient, glow, and press states.
 * Replaces basic buttons with a stunning interactive experience.
 */

import { Loader2 } from "lucide-react";
import type { FC, ReactNode } from "react";

interface GradientButtonProps {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	busy?: boolean;
	variant?: "primary" | "secondary" | "danger" | "ghost";
	size?: "sm" | "md" | "lg";
	className?: string;
	icon?: ReactNode;
	type?: "button" | "submit";
}

const GradientButton: FC<GradientButtonProps> = ({
	children,
	onClick,
	disabled,
	busy,
	variant = "primary",
	size = "md",
	className = "",
	icon,
	type = "button",
}) => {
	const sizeStyles = {
		sm: "px-4 py-2 text-xs rounded-xl",
		md: "px-6 py-3 text-sm rounded-2xl",
		lg: "px-8 py-4 text-base rounded-2xl",
	};

	const variantBase = {
		primary:
			"bg-accent text-white shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/30",
		secondary:
			"bg-surface text-ink border border-border hover:border-accent/40 hover:text-accent",
		danger:
			"bg-bad/10 text-bad border border-bad/20 hover:bg-bad/20 hover:border-bad/30",
		ghost: "bg-transparent text-ink2 hover:text-accent hover:bg-accent/5",
	};

	return (
		<button
			type={type}
			onClick={onClick}
			disabled={disabled || busy}
			className={`gradient-btn group relative inline-flex items-center justify-center gap-2.5 font-semibold transition-all duration-300 ${
				sizeStyles[size]
			} ${variantBase[variant]} ${
				disabled || busy
					? "opacity-50 cursor-not-allowed"
					: "active:scale-[0.97]"
			} ${className}`}
		>
			{/* Shimmer overlay for primary variant */}
			{variant === "primary" && !disabled && (
				<div className="gradient-btn-shimmer absolute inset-0 rounded-[inherit] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
			)}

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
        @keyframes btn-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .gradient-btn-shimmer {
          background: linear-gradient(90deg, 
            transparent 0%, 
            rgba(255,255,255,0.15) 50%, 
            transparent 100%);
          background-size: 200% 100%;
          animation: btn-shimmer 2s ease-in-out infinite;
        }
        .gradient-btn {
          position: relative;
          overflow: hidden;
        }
      `}</style>
		</button>
	);
};

export default GradientButton;
