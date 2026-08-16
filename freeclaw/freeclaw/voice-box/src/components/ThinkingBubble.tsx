/**
 * ThinkingBubble — Premium AI thinking animation.
 * Animated pulsing dots with glow effects for AI processing states.
 * Used when AI is reasoning, analyzing, or generating a response.
 */

import { Sparkles } from "lucide-react";
import type { FC } from "react";

interface ThinkingBubbleProps {
	label?: string;
	sublabel?: string;
	className?: string;
	size?: "sm" | "md" | "lg";
}

const SIZES = {
	sm: {
		dot: "w-1.5 h-1.5",
		container: "px-3 py-2",
		text: "text-[10px]",
		icon: 12,
	},
	md: { dot: "w-2 h-2", container: "px-4 py-3", text: "text-[11px]", icon: 14 },
	lg: { dot: "w-2.5 h-2.5", container: "px-5 py-4", text: "text-xs", icon: 16 },
};

const ThinkingBubble: FC<ThinkingBubbleProps> = ({
	label = "Analyzing",
	sublabel,
	className = "",
	size = "md",
}) => {
	const s = SIZES[size];

	return (
		<div className={`flex justify-start ${className}`}>
			<div
				className={`max-w-[85%] rounded-2xl rounded-bl-md bg-surface2 border border-border/50 shadow-sm ${s.container}`}
			>
				<div className="flex items-center gap-2.5 mb-1.5">
					<div className="relative">
						<Sparkles size={s.icon} className="text-accent" />
						<span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent/40 animate-ping" />
					</div>
					<div className="flex items-center gap-3">
						<span className={`font-semibold text-accent/80 ${s.text}`}>
							{label}
						</span>
						<div className="flex items-center gap-1">
							<span
								className={`${s.dot} rounded-full bg-accent/50 thinking-pulse-dot`}
								style={{ animationDelay: "0s" }}
							/>
							<span
								className={`${s.dot} rounded-full bg-accent/60 thinking-pulse-dot`}
								style={{ animationDelay: "0.3s" }}
							/>
							<span
								className={`${s.dot} rounded-full bg-accent/70 thinking-pulse-dot`}
								style={{ animationDelay: "0.6s" }}
							/>
						</div>
					</div>
				</div>
				{sublabel && (
					<p
						className={`text-ink3/60 font-normal ${s.text === "text-xs" ? "text-[11px]" : s.text}`}
					>
						{sublabel}
					</p>
				)}
				<style>{`
          @keyframes thinking-pulse {
            0%, 100% { opacity: 0.3; transform: scale(0.8); }
            50% { opacity: 1; transform: scale(1.2); }
          }
          .thinking-pulse-dot {
            animation: thinking-pulse 1.6s ease-in-out infinite;
          }
        `}</style>
			</div>
		</div>
	);
};

export default ThinkingBubble;
