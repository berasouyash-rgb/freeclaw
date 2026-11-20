import { memo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface StudioRiverProps {
	className?: string;
	flowSpeed?: number;
	ambientColor?: "violet" | "cyan" | "gold";
}

export const StudioRiver = memo(function StudioRiver({
	className = "",
	flowSpeed = 1,
	ambientColor = "violet",
}: StudioRiverProps) {
	const reduced = useReducedMotion();
	const [mouseY, setMouseY] = useState(0.5);
	const [activeSparkles, setActiveSparkles] = useState<
		Array<{ id: number; x: number; y: number; size: number }>
	>([]);

	const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		const relativeY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
		setMouseY(relativeY);

		if (Math.random() > 0.6) {
			const relativeX = (e.clientX - rect.left) / rect.width;
			setActiveSparkles((prev) => [
				...prev.slice(-8),
				{
					id: Date.now() + Math.random(),
					x: relativeX * 100,
					y: relativeY * 100,
					size: 3 + Math.random() * 4,
				},
			]);
		}
	};

	// Colors for gradient
	const themeStyles = {
		violet: {
			gradStart: "rgba(118, 87, 255, 0.22)",
			gradMid: "rgba(169, 154, 255, 0.14)",
			gradEnd: "rgba(99, 102, 241, 0.05)",
			stroke: "rgba(118, 87, 255, 0.4)",
			waveColor: "rgba(169, 154, 255, 0.55)",
			ambientGlow: "rgba(118, 87, 255, 0.18)",
			textColor: "#7657FF",
			textPill: "rgba(118, 87, 255, 0.15)",
			textBorder: "rgba(118, 87, 255, 0.4)",
		},
		cyan: {
			gradStart: "rgba(6, 182, 212, 0.22)",
			gradMid: "rgba(56, 189, 248, 0.14)",
			gradEnd: "rgba(14, 165, 233, 0.05)",
			stroke: "rgba(6, 182, 212, 0.4)",
			waveColor: "rgba(56, 189, 248, 0.55)",
			ambientGlow: "rgba(6, 182, 212, 0.18)",
			textColor: "#06b6d4",
			textPill: "rgba(6, 182, 212, 0.15)",
			textBorder: "rgba(6, 182, 212, 0.4)",
		},
		gold: {
			gradStart: "rgba(245, 158, 11, 0.22)",
			gradMid: "rgba(251, 191, 36, 0.14)",
			gradEnd: "rgba(217, 119, 6, 0.05)",
			stroke: "rgba(245, 158, 11, 0.4)",
			waveColor: "rgba(251, 191, 36, 0.55)",
			ambientGlow: "rgba(245, 158, 11, 0.18)",
			textColor: "#d97706",
			textPill: "rgba(245, 158, 11, 0.15)",
			textBorder: "rgba(245, 158, 11, 0.4)",
		},
	}[ambientColor];

	return (
		<div
			className={`relative overflow-hidden rounded-3xl select-none flex items-center justify-center ${className}`}
			aria-label="Studio River Flow — generative stream of ideas"
		>
			{/* Ambient Light Cone behind the river */}
			<div
				className="absolute inset-0 pointer-events-none transition-all duration-700 opacity-60"
				style={{
					background: `radial-gradient(ellipse at 50% ${mouseY * 100}%, ${themeStyles.ambientGlow} 0%, transparent 70%)`,
					filter: "blur(40px)",
				}}
			/>

			<svg
				viewBox="0 0 240 680"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				className="w-full h-full max-h-[720px] drop-shadow-sm transition-transform duration-300"
				onPointerMove={handlePointerMove}
			>
				<defs>
					<linearGradient id={`river-gradient-${ambientColor}`} x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stopColor={themeStyles.gradStart} />
						<stop offset="50%" stopColor={themeStyles.gradMid} />
						<stop offset="100%" stopColor={themeStyles.gradEnd} />
					</linearGradient>
					<filter id="soft-glow" x="-20%" y="-20%" width="140%" height="140%">
						<feGaussianBlur stdDeviation="3" result="blur" />
						<feComposite in="SourceGraphic" in2="blur" operator="over" />
					</filter>
				</defs>

				{/* River Stream Bed (Curving flowing river matching the user's sketch) */}
				<motion.path
					d="M 50 0 C 95 120, 15 220, 65 340 C 115 460, 25 560, 70 680 L 190 680 C 145 560, 235 460, 185 340 C 135 220, 215 120, 170 0 Z"
					fill={`url(#river-gradient-${ambientColor})`}
					stroke={themeStyles.stroke}
					strokeWidth="2.5"
					strokeDasharray="6 3"
					className="transition-all duration-700 origin-center"
					animate={
						reduced
							? undefined
							: {
									scaleX: [1, 1.025, 0.985, 1],
									y: [0, -3, 3, 0],
								}
					}
					transition={{
						repeat: Infinity,
						duration: 8 / flowSpeed,
						ease: "easeInOut",
					}}
				/>

				{/* ── Internal Wave Ripples (The undulating lines from the sketch) ── */}
				{/* Wave 1: Top section */}
				<motion.path
					d="M 70 120 Q 95 105 120 120 T 170 120"
					stroke={themeStyles.waveColor}
					strokeWidth="2.8"
					strokeLinecap="round"
					fill="none"
					animate={
						reduced
							? undefined
							: {
									y: [0, 8, 0],
									x: [-3, 3, -3],
								}
					}
					transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}
				/>

				{/* Wave 2: Middle section */}
				<motion.path
					d="M 60 270 Q 100 250 140 270 T 180 270"
					stroke={themeStyles.waveColor}
					strokeWidth="3.2"
					strokeLinecap="round"
					fill="none"
					animate={
						reduced
							? undefined
							: {
									y: [0, -7, 0],
									x: [4, -4, 4],
								}
					}
					transition={{ repeat: Infinity, duration: 4.1, ease: "easeInOut", delay: 0.3 }}
				/>

				{/* Wave 3: Lower-mid section */}
				<motion.path
					d="M 80 430 Q 115 410 150 430 T 185 430"
					stroke={themeStyles.waveColor}
					strokeWidth="2.8"
					strokeLinecap="round"
					fill="none"
					animate={
						reduced
							? undefined
							: {
									y: [0, 9, 0],
									x: [-3, 3, -3],
								}
					}
					transition={{ repeat: Infinity, duration: 3.6, ease: "easeInOut", delay: 0.7 }}
				/>

				{/* Wave 4: Bottom section */}
				<motion.path
					d="M 75 580 Q 110 560 145 580 T 175 580"
					stroke={themeStyles.waveColor}
					strokeWidth="2.5"
					strokeLinecap="round"
					fill="none"
					animate={
						reduced
							? undefined
							: {
									y: [0, -6, 0],
									x: [3, -3, 3],
								}
					}
					transition={{ repeat: Infinity, duration: 3.8, ease: "easeInOut", delay: 1 }}
				/>

				{/* Fluid Stream Particles / Idea Bubbles */}
				{[
					{ cx: 105, cy: 170, r: 3.5, dur: 4.2 },
					{ cx: 125, cy: 330, r: 4.2, dur: 5.1 },
					{ cx: 95, cy: 490, r: 3.2, dur: 4.7 },
					{ cx: 135, cy: 620, r: 3.8, dur: 4.5 },
				].map((pt, i) => (
					<motion.circle
						key={i}
						cx={pt.cx}
						cy={pt.cy}
						r={pt.r}
						fill={themeStyles.waveColor}
						filter="url(#soft-glow)"
						animate={
							reduced
								? undefined
								: {
										y: [-12, 12, -12],
										opacity: [0.4, 0.9, 0.4],
									}
						}
						transition={{ repeat: Infinity, duration: pt.dur, ease: "easeInOut", delay: i * 0.4 }}
					/>
				))}

				{/* ── River Text Streams (matching user sketch with "text" inside river) ── */}
				{[
					{ y: 80, text: "Curiosity", x: 120 },
					{ y: 220, text: "Innovation", x: 120 },
					{ y: 360, text: "VoiceFlow", x: 125 },
					{ y: 500, text: "Craft", x: 115 },
					{ y: 620, text: "Philosophy", x: 125 },
				].map((t, idx) => (
					<g key={t.text}>
						<motion.rect
							x={t.x - 44}
							y={t.y - 13}
							width="88"
							height="24"
							rx="12"
							fill={themeStyles.textPill}
							stroke={themeStyles.textBorder}
							strokeWidth="1.2"
							animate={
								reduced
									? undefined
									: {
											y: [0, idx % 2 === 0 ? 5 : -5, 0],
											x: [0, idx % 2 === 0 ? -3 : 3, 0],
										}
							}
							transition={{ repeat: Infinity, duration: 3.5 + idx * 0.4, ease: "easeInOut" }}
						/>
						<motion.text
							x={t.x}
							y={t.y + 3.5}
							textAnchor="middle"
							fontSize="10"
							fontWeight="700"
							fontFamily="system-ui, -apple-system, sans-serif"
							fill={themeStyles.textColor}
							letterSpacing="0.05em"
							animate={
								reduced
									? undefined
									: {
											y: [0, idx % 2 === 0 ? 5 : -5, 0],
											x: [0, idx % 2 === 0 ? -3 : 3, 0],
										}
							}
							transition={{ repeat: Infinity, duration: 3.5 + idx * 0.4, ease: "easeInOut" }}
						>
							{t.text}
						</motion.text>
					</g>
				))}

				{/* Pointer Interactive Sparkles */}
				{activeSparkles.map((sp) => (
					<motion.circle
						key={sp.id}
						cx={`${sp.x}%`}
						cy={`${sp.y}%`}
						r={sp.size}
						fill="#ffffff"
						initial={{ opacity: 1, scale: 0.5 }}
						animate={{ opacity: 0, scale: 2 }}
						transition={{ duration: 0.8, ease: "easeOut" }}
					/>
				))}
			</svg>

			{/* Flow Annotation Pill */}
			<div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-surface/90 dark:bg-black/80 border border-border/60 backdrop-blur-md shadow-xs text-[10px] font-mono tracking-widest uppercase text-ink3 flex items-center gap-1.5 whitespace-nowrap">
				<span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
				VoiceFlow Stream
			</div>
		</div>
	);
});

export default StudioRiver;
