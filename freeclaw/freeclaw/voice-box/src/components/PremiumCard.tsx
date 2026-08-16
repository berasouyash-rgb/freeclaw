/**
 * PremiumCard — Hover-glow card with animated border gradient.
 * Perfect for post cards, poll cards, feedback items.
 */
import type { FC, ReactNode } from "react";

interface PremiumCardProps {
	children: ReactNode;
	className?: string;
	glowColor?: string;
	onClick?: () => void;
	hoverable?: boolean;
	variant?: "default" | "glass" | "bordered";
}

const PremiumCard: FC<PremiumCardProps> = ({
	children,
	className = "",
	glowColor,
	onClick,
	hoverable = true,
	variant = "default",
}) => {
	const glassStyles =
		variant === "glass"
			? "bg-surface/80 backdrop-blur-xl border border-white/10 dark:border-white/5"
			: variant === "bordered"
				? "bg-transparent border-2 border-accent/20"
				: "bg-surface border border-border";

	return (
		<div
			onClick={onClick}
			className={`premium-card relative rounded-2xl p-5 transition-all duration-300 ${glassStyles} ${
				hoverable ? "hover:shadow-lg hover:-translate-y-0.5 cursor-pointer" : ""
			} ${onClick ? "cursor-pointer" : ""} ${className}`}
			style={
				glowColor
					? ({ "--glow-color": glowColor } as React.CSSProperties)
					: undefined
			}
		>
			{hoverable && (
				<div className="premium-card-glow absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 pointer-events-none" />
			)}
			<div className="relative z-10">{children}</div>
			<style>{`
        .premium-card {
          transition: transform 0.25s cubic-bezier(.22,.9,.3,1),
                      box-shadow 0.25s cubic-bezier(.22,.9,.3,1),
                      border-color 0.25s ease;
        }
        .premium-card:hover {
          border-color: color-mix(in srgb, var(--vb-accent) 40%, transparent);
          box-shadow: 0 8px 30px -8px color-mix(in srgb, var(--vb-accent) 20%, transparent);
          transform: translateY(-2px);
        }
        .premium-card:active {
          transform: translateY(0) scale(0.98);
        }
        .premium-card-glow {
          background: radial-gradient(600px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), 
                      color-mix(in srgb, var(--glow-color, var(--vb-accent)) 8%, transparent), 
                      transparent 60%);
        }
        .premium-card:hover .premium-card-glow {
          opacity: 1;
        }
      `}</style>
		</div>
	);
};

export default PremiumCard;
