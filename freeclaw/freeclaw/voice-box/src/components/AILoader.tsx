/**
 * AILoader — Master-class iridescent rotating blur loader for AI processing states.
 * 60fps GPU-accelerated with multi-harmonic glow rings.
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
		<div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
			<div className="ai-loader-container" style={containerStyle}>
				<div className="ai-loader-ring">
					<span className="ai-loader-blur-1" />
					<span className="ai-loader-blur-2" />
					<span className="ai-loader-blur-3" />
					<span className="ai-loader-blur-4" />
					<div className="ai-loader-core">
						<span className="ai-loader-pulse-dot" />
					</div>
				</div>
			</div>
			{label && (
				<span className="text-xs font-semibold tracking-wide text-ink2 animate-pulse">
					{label}
				</span>
			)}
			<style>{`
        @keyframes ai-loader-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes ai-loader-pulse {
          0%, 100% { transform: scale(0.85); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 1; }
        }

        .ai-loader-container {
          position: relative;
          border-radius: 50%;
          animation: ai-loader-rotate 1.0s linear infinite;
          background: conic-gradient(from 0deg, var(--vb-accent), #8b5cf6, #38BDF8, #10b981, var(--vb-accent));
          box-shadow: 0 0 20px -3px rgba(99, 102, 241, 0.45);
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

        .ai-loader-blur-1 { filter: blur(4px); }
        .ai-loader-blur-2 { filter: blur(8px); }
        .ai-loader-blur-3 { filter: blur(16px); }
        .ai-loader-blur-4 { filter: blur(28px); }

        .ai-loader-core {
          position: absolute;
          top: 12%;
          left: 12%;
          right: 12%;
          bottom: 12%;
          background: var(--vb-surface);
          border: 2px solid var(--vb-border);
          border-radius: 50%;
          z-index: 2;
          display: grid;
          place-items: center;
          backdrop-filter: blur(8px);
        }

        .ai-loader-pulse-dot {
          width: 35%;
          height: 35%;
          border-radius: 50%;
          background: var(--vb-accent);
          animation: ai-loader-pulse 1.4s ease-in-out infinite;
          box-shadow: 0 0 10px var(--vb-accent);
        }
      `}</style>
		</div>
	);
};

export default AILoader;
