/**
 * AILoader — Colorful rotating blur loader for AI processing states.
 * Inspired by premium UI patterns from top-tier AI interfaces.
 * Pure CSS, zero dependencies, GPU-accelerated.
 */
import type { FC } from "react";

interface AILoaderProps {
	size?: number;
	className?: string;
	label?: string;
}

const AILoader: FC<AILoaderProps> = ({ size = 48, className = "", label }) => {
	const containerStyle = {
		width: size,
		height: size,
	};

	return (
		<div
			className={`flex flex-col items-center justify-center gap-3 ${className}`}
		>
			<div className="ai-loader-container" style={containerStyle}>
				<div className="ai-loader-ring">
					<span className="ai-loader-blur-1" />
					<span className="ai-loader-blur-2" />
					<span className="ai-loader-blur-3" />
					<span className="ai-loader-blur-4" />
					<div className="ai-loader-core" />
				</div>
			</div>
			{label && (
				<span className="text-xs text-ink3 font-medium animate-pulse">
					{label}
				</span>
			)}
			<style>{`
        @keyframes ai-loader-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .ai-loader-container {
          position: relative;
          border-radius: 50%;
          animation: ai-loader-rotate 1.2s linear infinite;
          background: linear-gradient(135deg, var(--vb-accent), var(--vb-accent2), #38BDF8);
        }

        .ai-loader-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
        }

        .ai-loader-ring span {
          position: absolute;
          border-radius: 50%;
          inset: 0;
          background: inherit;
        }

        .ai-loader-blur-1 { filter: blur(5px); }
        .ai-loader-blur-2 { filter: blur(10px); }
        .ai-loader-blur-3 { filter: blur(20px); }
        .ai-loader-blur-4 { filter: blur(40px); }

        .ai-loader-core {
          position: absolute;
          top: 12.5%;
          left: 12.5%;
          right: 12.5%;
          bottom: 12.5%;
          background: var(--vb-surface);
          border: 3px solid var(--vb-surface);
          border-radius: 50%;
          z-index: 1;
        }

        /* Dark mode compatibility */
        .dark .ai-loader-core {
          background: var(--vb-surface);
          border-color: var(--vb-surface);
        }
      `}</style>
		</div>
	);
};

export default AILoader;
