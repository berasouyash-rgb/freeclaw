// ═══════════════════════════════════════════════════════════════════
// PreloaderFallback — CSS/SVG version used when WebGL is unavailable.
// ═══════════════════════════════════════════════════════════════════
// Same visual concept (central glow, orbital dots, directional signals,
// thin progress line) rendered with pure CSS + SVG so the user never
// sees a broken canvas. Calm, premium, zero GPU requirements.
// ═══════════════════════════════════════════════════════════════════

import { type CSSProperties, useMemo } from "react";
import type { Quality } from "./useDeviceCapability";

interface PreloaderFallbackProps {
	quality: Quality;
	reducedMotion: boolean;
	status: string;
}

export function PreloaderFallback({
	quality,
	reducedMotion,
	status,
}: PreloaderFallbackProps) {
	const nodeCount = quality === "LOW" ? 6 : quality === "MEDIUM" ? 10 : 14;
	const nodes = useMemo(
		() =>
			Array.from({ length: nodeCount }, (_, i) => ({
				angle: (i / nodeCount) * Math.PI * 2,
				delay: (i % 5) * 0.25,
			})),
		[nodeCount],
	);

	return (
		<div
			className="vpl-fallback"
			data-testid="vpl-fallback"
			aria-hidden="true"
		>
			<div className="vpl-fallback__glow" />
			<div className="vpl-fallback__core" />
			<div className="vpl-fallback__orbit">
				{nodes.map((n, i) => (
					<span
						key={i}
						className="vpl-fallback__node"
						style={
							{
								"--vpl-angle": `${n.angle}rad`,
								"--vpl-delay": `${n.delay}s`,
								animationDelay: reducedMotion ? "0s" : `${n.delay}s`,
							} as CSSProperties
						}
					/>
				))}
			</div>
			<div className="vpl-fallback__signal" />
			<div className="vpl-fallback__status">{status}</div>
		</div>
	);
}
