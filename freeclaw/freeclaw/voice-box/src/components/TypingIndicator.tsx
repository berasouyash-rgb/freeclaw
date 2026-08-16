/**
 * TypingIndicator — Premium animated typing indicator for AI chat.
 * Three bouncing dots with colorful glow, Claude/ChatGPT-tier styling.
 */

import { Bot } from "lucide-react";
import type { FC } from "react";

interface TypingIndicatorProps {
	label?: string;
	className?: string;
	variant?: "default" | "preview" | "minimal";
}

const TypingIndicator: FC<TypingIndicatorProps> = ({
	label = "AI is thinking...",
	className = "",
	variant = "default",
}) => {
	if (variant === "minimal") {
		return (
			<div className={`flex items-center gap-2 ${className}`}>
				<div className="flex items-center gap-1">
					<span className="typing-dot w-1.5 h-1.5 rounded-full bg-current opacity-60" />
					<span className="typing-dot w-1.5 h-1.5 rounded-full bg-current opacity-60" />
					<span className="typing-dot w-1.5 h-1.5 rounded-full bg-current opacity-60" />
				</div>
			</div>
		);
	}

	if (variant === "preview") {
		return (
			<div
				className={`inline-flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-surface2 border border-border/50 ${className}`}
			>
				<div className="relative flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-accent/60 typing-dot" />
					<span className="w-2 h-2 rounded-full bg-accent/60 typing-dot" />
					<span className="w-2 h-2 rounded-full bg-accent/60 typing-dot" />
				</div>
				<span className="text-xs text-ink3 font-medium">{label}</span>
			</div>
		);
	}

	return (
		<div className={`flex justify-start ${className}`}>
			<div className="max-w-[80%] rounded-2xl rounded-bl-md px-4 py-3.5 bg-surface2 border border-border/50 shadow-sm">
				<div className="flex items-center gap-2.5 mb-2">
					<div className="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center">
						<Bot size={11} className="text-accent" />
					</div>
					<span className="text-[10px] font-semibold text-accent/70 uppercase tracking-wider">
						AI Assistant
					</span>
				</div>
				<div className="flex items-center gap-1.5 mb-2">
					<div className="relative">
						<span className="inline-block w-2.5 h-2.5 rounded-full bg-accent/50 typing-dot" />
						<span
							className="absolute inset-0 rounded-full bg-accent/20 animate-ping typing-dot"
							style={{ animationDuration: "1.4s" }}
						/>
					</div>
					<span className="inline-block w-2 h-2 rounded-full bg-accent/60 typing-dot" />
					<span className="inline-block w-2 h-2 rounded-full bg-accent/70 typing-dot" />
				</div>
				<span className="text-[11px] text-ink3/60 font-medium">{label}</span>
			</div>
		</div>
	);
};

export default TypingIndicator;
